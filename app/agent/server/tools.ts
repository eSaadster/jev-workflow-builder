import "server-only";

import {
  getByPath,
  renderAgentTemplate,
  type ToolDoc,
} from "../shared";

const MAX_TOOL_TIMEOUT_MS = 30_000;
const CACHE_TTL_MS = 5 * 60_000;

export type ToolRunOutcome =
  | {
      status: "complete";
      outputs: Record<string, unknown>;
      raw: unknown;
      fromCache: boolean;
    }
  | { status: "error"; error: string }
  | { status: "cooldown"; error: string };

/**
 * Shared per-conversation cache passed in (and mutated) by the turn engine.
 * `last:<toolId>` entries track the most recent run for cooldowns; everything
 * else is keyed by the rendered request for `cache: true` tools.
 */
export type ToolCache = Record<string, { at: number; response: unknown }>;

function renderQuery(
  query: { key: string; value: string }[],
  scope: Record<string, unknown>
): string {
  const params = new URLSearchParams();

  for (const entry of query) {
    const key = renderAgentTemplate(entry.key, scope).trim();
    const value = renderAgentTemplate(entry.value, scope);

    if (key) {
      params.set(key, value);
    }
  }

  return params.toString();
}

function buildCacheKey(
  tool: ToolDoc,
  url: string,
  query: string,
  body: string
): string {
  return `${tool.id}|${tool.method}|${url}|${query}|${body}`;
}

function parseResponseText(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

/**
 * Runs one custom HTTP tool. Values render from request data, extracted
 * variables, earlier tool outputs and the model's own arguments (args win).
 * Sensitive outputs are excluded from what the model sees and show as
 * `[REDACTED]` in the transcript.
 */
export async function executeToolCall(options: {
  tool: ToolDoc;
  args: Record<string, unknown>;
  scope: Record<string, unknown>;
  cache: ToolCache;
  signal?: AbortSignal;
}): Promise<ToolRunOutcome> {
  const { tool, cache } = options;
  const scope = { ...options.scope, ...options.args };

  for (const input of tool.inputs) {
    if (!input.name) {
      continue;
    }

    const value = scope[input.name];

    if (
      input.required &&
      (value === undefined || value === null || String(value).trim() === "")
    ) {
      return {
        status: "error",
        error: `Missing required input "${input.name}": ${input.instructions || "fill this from the conversation"}`,
      };
    }
  }

  const url = renderAgentTemplate(tool.url, scope).trim();
  const query = renderQuery(tool.query, scope);
  const body = tool.method === "GET" ? "" : renderAgentTemplate(tool.body, scope);
  const cacheKey = buildCacheKey(tool, url, query, body);

  const last = cache[`last:${tool.id}`];
  const now = Date.now();

  if (
    tool.cooldownS !== null &&
    last &&
    now - last.at < tool.cooldownS * 1000
  ) {
    return {
      status: "cooldown",
      error: `${tool.name} is cooling down (${tool.cooldownS}s between runs).`,
    };
  }

  cache[`last:${tool.id}`] = { at: now, response: null };

  if (tool.cache) {
    const hit = cache[cacheKey];

    if (hit && now - hit.at < CACHE_TTL_MS) {
      return mapOutputs(tool, hit.response, true);
    }
  }

  if (!/^https?:\/\//.test(url)) {
    return {
      status: "error",
      error: `Tool "${tool.name}" has no valid http(s) URL configured.`,
    };
  }

  const timeout = Math.max(
    1_000,
    Math.min(tool.timeoutMs || MAX_TOOL_TIMEOUT_MS, MAX_TOOL_TIMEOUT_MS)
  );
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeout);

  const onOuterAbort = () => abort.abort();
  options.signal?.addEventListener("abort", onOuterAbort);

  try {
    const headers: Record<string, string> = {};

    for (const entry of tool.headers) {
      const key = renderAgentTemplate(entry.key, scope).trim();

      if (key) {
        headers[key] = renderAgentTemplate(entry.value, scope);
      }
    }

    const fullUrl = query ? `${url}?${query}` : url;
    const hasBody = tool.method !== "GET" && body.trim() !== "";

    if (hasBody) {
      headers["content-type"] = headers["content-type"] ?? "application/json";
    }

    const response = await fetch(fullUrl, {
      method: tool.method,
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      body: hasBody ? body : undefined,
      signal: abort.signal,
    });

    const raw = parseResponseText(await response.text());

    if (!response.ok) {
      return {
        status: "error",
        error: `${tool.name} responded ${response.status}.`,
      };
    }

    if (tool.cache) {
      cache[cacheKey] = { at: now, response: raw };
    }

    return mapOutputs(tool, raw, false);
  } catch (error) {
    const reason =
      error instanceof Error && error.name === "AbortError"
        ? `${tool.name} timed out after ${timeout / 1000}s.`
        : error instanceof Error
          ? error.message
          : "Unknown tool error";
    return { status: "error", error: reason };
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", onOuterAbort);
  }
}

function mapOutputs(
  tool: ToolDoc,
  raw: unknown,
  fromCache: boolean
): ToolRunOutcome {
  const outputs: Record<string, unknown> = {};

  for (const output of tool.outputs) {
    if (!output.name || output.sensitive) {
      continue;
    }

    outputs[output.name] = getByPath(raw, output.path) ?? null;
  }

  return { status: "complete", outputs, raw, fromCache };
}

/**
 * The transcript-facing outputs: sensitive values render as [REDACTED] so the
 * UI matches what the model was allowed to see.
 */
export function transcriptOutputs(
  tool: ToolDoc,
  outputs: Record<string, unknown>
): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  for (const output of tool.outputs) {
    if (!output.name) {
      continue;
    }

    result[output.name] = output.sensitive
      ? "[REDACTED]"
      : (outputs[output.name] ?? null);
  }

  return result;
}

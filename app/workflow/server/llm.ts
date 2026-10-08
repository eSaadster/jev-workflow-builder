import "server-only";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { ToolSet } from "ai";

// OpenCode Zen's OpenAI-compatible API. The base URL is the prefix only: the
// provider appends `/chat/completions` itself.
const DEFAULT_LLM_BASE_URL = "https://opencode.ai/zen/go/v1";

// Zen requires clients to identify themselves and to send a stable session id
// per conversation; requests without `x-opencode-session` fail with HTTP 400
// `MissingSessionID`.
const SESSION_HEADER = "x-opencode-session";
const USER_AGENT = "jev-workflow-builder/1.0";

// Zen model ids are bare ("deepseek-v4.1-flash"). Ids copied from catalogs that
// use an "openai/..." style prefix are normalized so they still resolve.
function resolveModelId(model: string): string {
  return model.replace(/^[^/]+\//, "");
}

function createProvider(sessionId: string) {
  const apiKey = process.env.OPENCODE_ZEN_API_KEY;

  if (!apiKey) {
    return null;
  }

  return createOpenAICompatible({
    name: "opencode-zen",
    baseURL: (process.env.OPENCODE_ZEN_BASE_URL || DEFAULT_LLM_BASE_URL).replace(
      /\/+$/,
      ""
    ),
    apiKey,
    headers: {
      [SESSION_HEADER]: sessionId,
      "user-agent": USER_AGENT,
    },
  });
}

export type LlmRunOptions = {
  system: string;
  prompt: string;
  model: string;
  // Stable id for the whole conversation, sent as `x-opencode-session`.
  sessionId?: string;
  // Called with the full text so far. Throttled by the caller.
  onChunk: (text: string) => void | Promise<void>;
  signal?: AbortSignal;
};

export type LlmResult = {
  text: string;
  mock: boolean;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

/* -------------------------------------------------------------------------- */
/*                         Conversation turns with tools                      */
/* -------------------------------------------------------------------------- */

export type ConversationLlmMessage = {
  role: "user" | "assistant";
  content: string;
};

export type AgentToolSpec = {
  name: string;
  description: string;
  // Raw JSON Schema for the tool arguments.
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
  execute: (args: Record<string, unknown>) => Promise<unknown>;
};

export type ConversationTurnResult = {
  text: string;
  mock: boolean;
  model: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

/**
 * One conversation turn: message history plus optional function-calling tools
 * (executed inline, with the model continuing over their results). Used by the
 * call-agent turn engine.
 */
export async function runConversationTurn(options: {
  system: string;
  messages: ConversationLlmMessage[];
  model: string;
  sessionId?: string;
  tools?: AgentToolSpec[];
  maxSteps?: number;
  signal?: AbortSignal;
  onChunk?: (text: string) => void | Promise<void>;
}): Promise<ConversationTurnResult> {
  const provider = createProvider(options.sessionId ?? crypto.randomUUID());

  if (!provider) {
    return mockConversationTurn(options);
  }

  const { streamText, jsonSchema, stepCountIs } = await import("ai");
  const tools: ToolSet = {};

  for (const spec of options.tools ?? []) {
    tools[spec.name] = {
      description: spec.description || undefined,
      inputSchema: jsonSchema(
        spec.inputSchema as Parameters<typeof jsonSchema>[0]
      ),
      execute: async (args: Record<string, unknown>) => spec.execute(args),
    };
  }

  const result = streamText({
    model: provider.chatModel(resolveModelId(options.model)),
    system: options.system || undefined,
    messages: options.messages,
    tools: Object.keys(tools).length > 0 ? tools : undefined,
    stopWhen: stepCountIs(options.maxSteps ?? 4),
    abortSignal: options.signal,
  });

  let text = "";

  for await (const delta of result.textStream) {
    text += delta;
    await options.onChunk?.(text);
  }

  const usage = await result.usage;

  return {
    text,
    mock: false,
    model: options.model,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Keyless fallback for conversation turns: a short canned reply in the
 * persona's voice. Tools are not simulated here — use the tool test runner
 * to exercise HTTP tools without keys.
 */
async function mockConversationTurn(options: {
  messages: ConversationLlmMessage[];
  signal?: AbortSignal;
  onChunk?: (text: string) => void | Promise<void>;
}): Promise<ConversationTurnResult> {
  const lastUser = [...options.messages]
    .reverse()
    .find((message) => message.role === "user");
  const opening = options.messages.length === 0;
  const reply = opening
    ? "Hi! This is your agent speaking — I'm running in mock mode without an API key, but the conversation flow, routing and variables all work. Set OPENCODE_ZEN_API_KEY for real replies."
    : lastUser
      ? `Got it — "${lastUser.content.slice(0, 80)}". Mock mode on: I heard you, and the scenarios, tools and variables around this turn are all live. Add OPENCODE_ZEN_API_KEY for real replies.`
      : "Mock mode on.";

  const words = reply.split(" ");
  let text = "";

  for (const word of words) {
    if (options.signal?.aborted) {
      break;
    }

    text += (text ? " " : "") + word;
    await options.onChunk?.(text);
    await sleep(30);
  }

  return { text, mock: true, model: "mock" };
}

export async function runLlm(options: LlmRunOptions): Promise<LlmResult> {
  const provider = createProvider(options.sessionId ?? crypto.randomUUID());

  if (!provider) {
    return streamMockReply(options);
  }

  // A provider instance (rather than a plain model id string) is what routes
  // the call away from the AI SDK's default gateway provider.
  const { streamText } = await import("ai");
  const result = streamText({
    model: provider.chatModel(resolveModelId(options.model)),
    system: options.system || undefined,
    prompt: options.prompt,
    abortSignal: options.signal,
  });

  let text = "";

  for await (const delta of result.textStream) {
    text += delta;
    await options.onChunk(text);
  }

  const usage = await result.usage;
  return {
    text,
    mock: false,
    model: options.model,
    usage: { inputTokens: usage.inputTokens, outputTokens: usage.outputTokens },
  };
}

/**
 * Keyless fallback: streams a canned reply built from the resolved prompt, so
 * the rest of the workflow (and downstream Jev nodes) still has text to work
 * with.
 */
async function streamMockReply(options: LlmRunOptions): Promise<LlmResult> {
  const firstLine =
    options.prompt
      .split("\n")
      .map((line) => line.trim())
      .find((line) => line.length > 0) ?? "the request";
  const reply = [
    "Thanks for reaching out, and sorry for the trouble.",
    `Here is a mock reply for: "${firstLine.slice(0, 120)}".`,
    "Set OPENCODE_ZEN_API_KEY to stream a real model response through this node.",
  ].join(" ");
  const words = reply.split(" ");
  let text = "";

  for (const word of words) {
    if (options.signal?.aborted) {
      break;
    }

    text += (text ? " " : "") + word;
    await options.onChunk(text);
    await sleep(35);
  }

  return { text, mock: true, model: "mock" };
}

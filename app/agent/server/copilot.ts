import "server-only";

import { mutateFlow } from "@liveblocks/react-flow/node";
import { nanoid } from "nanoid";
import {
  runConversationTurn,
  type AgentToolSpec,
  type ConversationLlmMessage,
} from "../../workflow/server/llm";
import { fetchPages, webSearch } from "../../workflow/server/tinyfish";
import { liveblocks } from "../../workflow/server/liveblocks";
import { readAgentGraph } from "./storage";
import { startConversation, processTurn } from "./turn-engine";
import {
  isConversationEvent,
  type AgentEvent,
  type ConversationEvent,
} from "../conversation";
import {
  createAgentEdge,
  createScenarioNode,
  createJevStepNode,
  createLlmStepNode,
  createWebSearchStepNode,
  createFetchStepNode,
  createDispositionsNode,
  createToolboxNode,
  truncate,
  type AgentEdge,
  type AgentGraphNode,
  type ExtractedVariable,
  type RoutingRule,
} from "../shared";
import { questionHandleId, type QuestionDef } from "../../workflow/shared";

/**
 * The build copilot: a chat that edits the agent graph through the same
 * primitives the canvas uses (mutateFlow over the room's flow storage), so
 * edits appear live for everyone watching. Its toolbox is the flow builder
 * itself — node factories, edge wiring, and the real turn engine for testing —
 * plus web search/fetch for research. One copilot chat = one feed
 * (copilot-<id>, trigger "copilot"), separate from caller conversations.
 */

const FLOW_STORAGE_KEY = "flow";
const COPILOT_MODEL = "claude-haiku-5-5";
const COPILOT_TURN_TIMEOUT_MS = 90_000;
const COPILOT_MAX_STEPS = 12;
const MAX_HISTORY_MESSAGES = 40;
const STREAM_THROTTLE_MS = 150;
const TOOL_RESULT_CHARS = 1_500;
const TRANSCRIPT_CHARS = 3_000;

/* -------------------------------------------------------------------------- */
/*                                Feed helpers                                 */
/* -------------------------------------------------------------------------- */

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.error("Copilot feed write failed", error);
    return undefined;
  }
}

async function writeEvent(
  roomId: string,
  conversationId: string,
  event: ConversationEvent
): Promise<string | undefined> {
  const created = await safe(() =>
    liveblocks.createFeedMessage({
      roomId,
      feedId: conversationId,
      id: event.id,
      data: event as never,
    })
  );
  return created?.id ?? event.id;
}

async function updateEvent(
  roomId: string,
  conversationId: string,
  messageId: string | undefined,
  event: ConversationEvent
): Promise<void> {
  if (!messageId) {
    return;
  }

  await safe(() =>
    liveblocks.updateFeedMessage({
      roomId,
      feedId: conversationId,
      messageId,
      data: event as never,
    })
  );
}

async function loadEvents(
  roomId: string,
  conversationId: string
): Promise<ConversationEvent[] | null> {
  try {
    const response = await liveblocks.getFeedMessages({
      roomId,
      feedId: conversationId,
    });

    if (!Array.isArray(response.data)) {
      return null;
    }

    return response.data
      .map((message) => (message as { data?: unknown }).data)
      .filter(isConversationEvent)
      .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/*                              Copilot lifecycle                              */
/* -------------------------------------------------------------------------- */

export async function startCopilotConversation(options: {
  roomId: string;
}): Promise<{ conversationId: string }> {
  const conversationId = `copilot-${nanoid(10)}`;

  await safe(() =>
    liveblocks.createFeed({
      roomId: options.roomId,
      feedId: conversationId,
      metadata: {
        status: "running",
        trigger: "copilot",
        input: "(new copilot chat)",
        startedAt: String(Date.now()),
      },
    })
  );

  return { conversationId };
}

export async function processCopilotTurn(options: {
  roomId: string;
  conversationId: string;
  text: string;
}): Promise<{ reply: string; error?: string }> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), COPILOT_TURN_TIMEOUT_MS);

  try {
    const events = await loadEvents(options.roomId, options.conversationId);

    if (events === null) {
      return { reply: "", error: "Copilot chat not found." };
    }

    // A previous turn can die mid-flight (dev recompile, client abort), leaving
    // a tool "running" forever and an empty agent event rendering as typing
    // dots. Sweep those before continuing so the transcript is honest again.
    for (const event of events) {
      if (event.kind === "tool" && event.status === "running") {
        await updateEvent(options.roomId, options.conversationId, event.id, {
          ...event,
          status: "error",
          error: "interrupted",
        });
      }

      if (event.kind === "agent" && event.text === "") {
        await updateEvent(options.roomId, options.conversationId, event.id, {
          ...event,
          text: "(interrupted)",
        });
      }
    }

    // Keep the full metadata set intact (updateFeed may replace, not merge).
    let startedAt = String(Date.now());

    try {
      const feed = await liveblocks.getFeed({
        roomId: options.roomId,
        feedId: options.conversationId,
      });
      startedAt = feed.metadata.startedAt ?? startedAt;
    } catch {
      // Keep the fallback; the feed existence was already checked above.
    }

    await safe(() =>
      liveblocks.updateFeed({
        roomId: options.roomId,
        feedId: options.conversationId,
        metadata: {
          status: "running",
          trigger: "copilot",
          input: truncate(options.text, 200),
          startedAt,
        },
      })
    );

    await writeEvent(options.roomId, options.conversationId, {
      id: `user-${nanoid(8)}`,
      at: Date.now(),
      kind: "user",
      text: options.text,
    });

    const history = historyOf(events);

    const agentEventId = `agent-${nanoid(8)}`;
    const agentEvent: AgentEvent = {
      id: agentEventId,
      at: Date.now(),
      kind: "agent",
      text: "",
    };
    const agentMessageId = await writeEvent(
      options.roomId,
      options.conversationId,
      agentEvent
    );

    let lastWrite = 0;
    let pending: Promise<unknown> = Promise.resolve();

    const result = await runConversationTurn({
      system: COPILOT_SYSTEM_PROMPT,
      messages: [...history, { role: "user", content: options.text }],
      model: COPILOT_MODEL,
      sessionId: options.conversationId,
      tools: buildCopilotTools(options.roomId, options.conversationId),
      maxSteps: COPILOT_MAX_STEPS,
      signal: abort.signal,
      onChunk: (partial) => {
        const now = Date.now();

        if (now - lastWrite < STREAM_THROTTLE_MS) {
          return;
        }

        lastWrite = now;
        pending = pending.then(() =>
          updateEvent(
            options.roomId,
            options.conversationId,
            agentMessageId,
            { ...agentEvent, text: partial }
          )
        );
      },
    });

    await pending;
    await updateEvent(options.roomId, options.conversationId, agentMessageId, {
      ...agentEvent,
      text: result.text || "(no reply)",
      model: result.model,
      mock: result.mock,
    });

    // Chats don't end like conversations do; "complete" here just means the
    // turn finished (the next message flips it back to running).
    await safe(() =>
      liveblocks.updateFeed({
        roomId: options.roomId,
        feedId: options.conversationId,
        metadata: {
          status: "complete",
          trigger: "copilot",
          input: truncate(options.text, 200),
          startedAt,
        },
      })
    );

    return { reply: result.text };
  } catch (error) {
    console.error("Copilot turn failed", error);
    return { reply: "", error: "Copilot turn failed." };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Rebuilds the model's message history from the feed. Tool calls are folded
 * in as bracketed user-side lines so node ids created in earlier turns stay
 * visible to the model (the transcript itself only keeps user/agent text).
 */
function historyOf(events: ConversationEvent[]): ConversationLlmMessage[] {
  const messages = events.flatMap((event): ConversationLlmMessage[] => {
    if (event.kind === "user") {
      return [{ role: "user", content: event.text }];
    }

    if (event.kind === "agent" && event.text.trim() !== "") {
      return [{ role: "assistant", content: event.text }];
    }

    if (event.kind === "tool" && event.status !== "running") {
      const result =
        event.status === "error"
          ? `error: ${event.error ?? "unknown"}`
          : JSON.stringify(event.outputs ?? {});
      return [
        {
          role: "user",
          content: `[${event.toolName}(${JSON.stringify(event.args ?? {})}) → ${result}]`,
        },
      ];
    }

    return [];
  });

  return messages.slice(-MAX_HISTORY_MESSAGES);
}

/* -------------------------------------------------------------------------- */
/*                                System prompt                                */
/* -------------------------------------------------------------------------- */

const COPILOT_SYSTEM_PROMPT = [
  "You are the build copilot for a visual call-agent builder. You edit the agent's graph through tools; every edit shows up live on the user's canvas.",
  "",
  "The graph defines a phone/chat agent:",
  "- start (singleton): request data (facts exposed as {{variables}}) and the sample chat opening.",
  "- agent (singleton): model, systemPrompt (persona), taskPrompt (the job), variables to extract, guardrails, tool flags.",
  "- scenario: a pathway sub-behavior — routing (conditions on extracted variables, or ai_decides with a description the judge model reads), a prompt chunk active while it runs, an exit condition, its own variables and tools.",
  "- jev: deterministic judgment questions (choice / score / noul yes-no with threshold). A jev node wired into a scenario (edge from an answer handle) runs every turn and routes explicitly; unwired jev nodes judge the transcript at end of call and their answer handles gate downstream steps.",
  "- toolbox: custom HTTP tools (name, description, method, url, {{variable}} templating) and knowledge sources (text or url).",
  "- dispositions: Jev questions answered over the transcript when a conversation ends.",
  "- llm / web-search / fetch steps: end-of-call processing (note writers, research), gated by incoming edges from jev answer handles or other steps.",
  "",
  "How to work:",
  "1. Call read_flow first; ground every edit in the ids and labels it returns.",
  "2. Build incrementally: add nodes, wire edges, then update the agent persona/task so the graph tells one coherent story.",
  "3. Test what you built: start_test_conversation, send_test_message as a realistic caller, read_transcript — then fix what misbehaved.",
  "4. Finish with a short summary of what exists now (labels + ids) and what to try next.",
  "",
  "Rules: never invent node ids — only use ids from read_flow or tool results; reference nodes by id or exact label; prefer updating over deleting; ask before destructive bulk changes; keep prompts short and voice-friendly (this agent speaks on phone calls).",
].join("\n");

/* -------------------------------------------------------------------------- */
/*                                Graph helpers                                */
/* -------------------------------------------------------------------------- */

type FlowJson = { nodes: AgentGraphNode[]; edges: AgentEdge[] };

/** The mutateFlow callback surface the tools rely on. */
type FlowApi = {
  toJSON(): FlowJson;
  getNode(id: string): AgentGraphNode | undefined;
  addNode(node: AgentGraphNode): void;
  updateNode(id: string, updater: (node: AgentGraphNode) => AgentGraphNode): void;
  removeNode(id: string): void;
  removeEdges(ids: string[]): void;
  addEdge(edge: AgentEdge): void;
};

async function mutateFlowWith<T>(roomId: string, fn: (flow: FlowApi) => T): Promise<T> {
  let result!: T;

  await mutateFlow<AgentGraphNode, AgentEdge>(
    { client: liveblocks, roomId, storageKey: FLOW_STORAGE_KEY },
    (flow) => {
      result = fn(flow as unknown as FlowApi);
    }
  );

  return result;
}

function findNode(json: FlowJson, ref: string): AgentGraphNode | undefined {
  const id = ref.trim();
  return (
    json.nodes.find((node) => node.id === id) ??
    json.nodes.find(
      (node) => "label" in node.data && node.data.label.toLowerCase() === id.toLowerCase()
    )
  );
}

function findToolbox(
  json: FlowJson
): Extract<AgentGraphNode, { type: "toolbox" }> | undefined {
  return json.nodes.find(
    (node): node is Extract<AgentGraphNode, { type: "toolbox" }> =>
      node.type === "toolbox"
  );
}

/** Patches one node's data through a shallow-record transform. */
function patchNode(
  flow: FlowApi,
  id: string,
  patch: (data: Record<string, unknown>) => Record<string, unknown>
): void {
  flow.updateNode(id, (current) => ({
    ...current,
    data: patch({ ...(current.data as Record<string, unknown>) }),
  }) as AgentGraphNode);
}

/** Fresh nodes land on a new row below the current graph. */
function nextPosition(json: FlowJson): { x: number; y: number } {
  const maxY = json.nodes.reduce((max, node) => Math.max(max, node.position.y), 0);
  return { x: 40 + (json.nodes.length % 3) * 340, y: maxY + 160 };
}

function nodeSummary(node: AgentGraphNode): Record<string, unknown> {
  const base = { id: node.id, kind: node.type };

  switch (node.type) {
    case "start":
      return { ...base, label: node.data.label, sample: node.data.sample, requestData: node.data.requestData };
    case "agent":
      return {
        ...base,
        label: node.data.label,
        model: node.data.model,
        systemPrompt: node.data.systemPrompt,
        taskPrompt: node.data.taskPrompt,
        variables: node.data.variables.map((v) => v.name),
        guardrails: node.data.guardrails,
      };
    case "scenario":
      return {
        ...base,
        label: node.data.label,
        routing: node.data.routing,
        prompt: node.data.prompt,
        exitCondition: node.data.exitCondition,
        toolIds: node.data.toolIds,
      };
    case "jev":
      return { ...base, label: node.data.label, questions: node.data.questions, handles: questionHandlesOf(node.data.questions) };
    case "toolbox":
      return {
        ...base,
        label: node.data.label,
        tools: node.data.tools.map((tool) => ({ id: tool.id, name: tool.name })),
        knowledge: node.data.knowledge.map((k) => ({ id: k.id, name: k.name, type: k.type })),
      };
    case "dispositions":
      return { ...base, label: node.data.label, questions: node.data.questions };
    case "llm":
      return { ...base, label: node.data.label, model: node.data.model, system: node.data.system, prompt: node.data.prompt };
    case "web-search":
      return { ...base, label: node.data.label, query: node.data.query, maxResults: node.data.maxResults };
    case "fetch":
      return { ...base, label: node.data.label, urls: node.data.urls };
  }
}

function questionHandlesOf(questions: QuestionDef[]): string[] {
  const handles: string[] = ["any"];

  for (const question of questions) {
    switch (question.type) {
      case "choice":
        for (const option of question.options) {
          handles.push(questionHandleId(question.id, option.key));
        }
        break;
      case "score":
        for (const level of question.levels) {
          handles.push(questionHandleId(question.id, level.key));
        }
        break;
      case "noul":
        handles.push(questionHandleId(question.id, "yes"), questionHandleId(question.id, "no"));
        break;
    }
  }

  return handles;
}

/** Normalizes model-provided questions (ids, defaults) into QuestionDefs. */
function normalizeQuestions(raw: unknown): { questions?: QuestionDef[]; error?: string } {
  if (!Array.isArray(raw)) {
    return { questions: undefined };
  }

  const questions: QuestionDef[] = [];

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }

    const q = entry as Record<string, unknown>;
    const instructions = typeof q.instructions === "string" ? q.instructions : "";
    const type = q.type === "score" || q.type === "noul" ? q.type : "choice";
    const criteria = (items: unknown) =>
      Array.isArray(items)
        ? items
            .map((item) => {
              const c = (item ?? {}) as Record<string, unknown>;
              return {
                key: String(c.key ?? "").trim(),
                description: typeof c.description === "string" ? c.description : "",
              };
            })
            .filter((c) => c.key !== "")
        : [];

    if (instructions.trim() === "") {
      return { error: "every question needs `instructions`" };
    }

    if (type === "noul") {
      const threshold = typeof q.threshold === "number" ? q.threshold : 0.7;
      questions.push({ id: `q-${nanoid(6)}`, type, instructions, threshold });
    } else {
      const items = criteria(q.options ?? q.levels);
      const keyed = items.map((item, index) => ({ ...item, key: item.key || `${index + 1}` }));

      if (keyed.length < 2) {
        return { error: `${type} questions need at least 2 ${type === "choice" ? "options" : "levels"} with keys` };
      }

      questions.push(
        type === "choice"
          ? { id: `q-${nanoid(6)}`, type, instructions, options: keyed }
          : { id: `q-${nanoid(6)}`, type, instructions, levels: keyed }
      );
    }
  }

  return { questions };
}

function normalizeVariables(raw: unknown): ExtractedVariable[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry, index): ExtractedVariable => {
      const v = (entry ?? {}) as Record<string, unknown>;
      return {
        id: `variable-${nanoid(8)}`,
        name: String(v.name ?? "").trim() || `variable_${index + 1}`,
        type: v.type === "number" || v.type === "boolean" ? v.type : "string",
        prompt: typeof v.prompt === "string" ? v.prompt : "",
      };
    })
    .filter((v) => v.name !== "");
}

function normalizeRules(raw: unknown): RoutingRule[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  return raw
    .map((entry): RoutingRule => {
      const r = (entry ?? {}) as Record<string, unknown>;
      const op = r.op === "not_equals" || r.op === "contains" ? r.op : "equals";
      return {
        variable: String(r.variable ?? "").trim(),
        op,
        value: String(r.value ?? ""),
      };
    })
    .filter((r) => r.variable !== "");
}

/** Compact answer rendering for transcript lines (choice key / yes-no / level). */
function answerText(answer: unknown): string {
  if (typeof answer !== "object" || answer === null) {
    return "?";
  }

  const a = answer as Record<string, unknown>;

  if (a.type === "choice") {
    return String(a.choice ?? "?");
  }

  if (a.type === "score") {
    return `level ${String(a.level ?? "?")}`;
  }

  if (a.type === "noul") {
    const noul = typeof a.noul === "number" ? a.noul : 0;
    const threshold = typeof a.threshold === "number" ? a.threshold : 0.5;
    return `${noul >= threshold ? "yes" : "no"} (${Math.round(noul * 100)}%)`;
  }

  return "?";
}

function truncateResult(value: unknown): unknown {
  const text = JSON.stringify(value) ?? "";

  return text.length > TOOL_RESULT_CHARS
    ? `${text.slice(0, TOOL_RESULT_CHARS)}…(truncated)`
    : value;
}

/* -------------------------------------------------------------------------- */
/*                                 Tool specs                                  */
/* -------------------------------------------------------------------------- */

function buildCopilotTools(roomId: string, feedId: string): AgentToolSpec[] {
  const tools: AgentToolSpec[] = [];

  const graphTool = (
    name: string,
    description: string,
    properties: Record<string, unknown>,
    required: string[],
    run: (args: Record<string, unknown>) => Promise<unknown>
  ) => {
    tools.push({
      name,
      description,
      inputSchema: { type: "object", properties, required },
      execute: async (args) => {
        const eventId = `tool-${nanoid(8)}`;
        const startedAt = Date.now();

        await writeEvent(roomId, feedId, {
          id: eventId,
          at: startedAt,
          kind: "tool",
          toolId: `copilot:${name}`,
          toolName: name,
          status: "running",
          args,
        });

        let outcome: unknown;

        try {
          outcome = truncateResult(await run(args));
        } catch (error) {
          outcome = { error: error instanceof Error ? error.message : "tool failed" };
        }

        const outputs = outcome as Record<string, unknown>;

        await updateEvent(roomId, feedId, eventId, {
          id: eventId,
          at: startedAt,
          kind: "tool",
          toolId: `copilot:${name}`,
          toolName: name,
          status: outputs && typeof outputs === "object" && "error" in outputs ? "error" : "complete",
          args,
          outputs,
          durationMs: Date.now() - startedAt,
        });

        return outcome;
      },
    });
  };

  /* ------------------------------- Reads -------------------------------- */

  graphTool(
    "read_flow",
    "Read the current agent graph: nodes (ids, labels, key configuration) and edges. Always call this before editing.",
    {},
    [],
    async () => {
      const { nodes, edges } = await readAgentGraph(roomId);
      return {
        nodes: nodes.map(nodeSummary),
        edges: edges.map((edge) => ({
          from: edge.source,
          fromHandle: edge.sourceHandle ?? "out",
          to: edge.target,
        })),
      };
    }
  );

  /* ------------------------------ Add nodes ------------------------------ */

  graphTool(
    "add_scenario",
    "Add a scenario (pathway) node: a sub-behavior with its own routing, prompt chunk and exit condition.",
    {
      label: { type: "string", description: "Short name shown on the canvas." },
      prompt: { type: "string", description: "Instructions that replace the main task while this scenario is active." },
      routingMode: { type: "string", enum: ["ai_decides", "conditions"] },
      routingDescription: { type: "string", description: "For ai_decides: when this scenario should activate." },
      rules: {
        type: "array",
        description: "For conditions mode: every rule must match an extracted variable.",
        items: {
          type: "object",
          properties: {
            variable: { type: "string" },
            op: { type: "string", enum: ["equals", "not_equals", "contains"] },
            value: { type: "string" },
          },
          required: ["variable", "op", "value"],
        },
      },
      exitCondition: { type: "string", description: "Move on once this is achieved." },
    },
    ["label", "prompt"],
    async (args) => {
      const label = String(args.label ?? "").trim();
      const mode = args.routingMode === "conditions" ? "conditions" : "ai_decides";

      if (label === "") {
        return { error: "label is required" };
      }

      const node = await mutateFlowWith(roomId, (flow) => {
        const json = flow.toJSON();
        const created = createScenarioNode({
          position: nextPosition(json),
          label,
          selected: true,
        });
        created.data.prompt = String(args.prompt ?? "");
        created.data.exitCondition = String(args.exitCondition ?? "");
        created.data.routing =
          mode === "conditions"
            ? { mode, rules: normalizeRules(args.rules) }
            : { mode, description: String(args.routingDescription ?? "") };
        flow.addNode(created);
        return created;
      });

      return { id: node.id, label, kind: "scenario" };
    }
  );

  graphTool(
    "add_jev",
    "Add a Jev judgment node with questions (choice, score, or noul yes/no). Wire an answer handle into a scenario for per-turn routing, or leave it unwired to judge at end of call.",
    {
      label: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            instructions: { type: "string", description: "The judgment, in plain language." },
            type: { type: "string", enum: ["choice", "score", "noul"] },
            options: {
              type: "array",
              description: "choice questions: the answer keys.",
              items: {
                type: "object",
                properties: { key: { type: "string" }, description: { type: "string" } },
                required: ["key"],
              },
            },
            levels: {
              type: "array",
              description: "score questions: ordered from lowest to highest.",
              items: {
                type: "object",
                properties: { key: { type: "string" }, description: { type: "string" } },
                required: ["key"],
              },
            },
            threshold: { type: "number", description: "noul questions: yes/no cutoff, 0–1 (default 0.7)." },
          },
          required: ["instructions", "type"],
        },
      },
    },
    ["label", "questions"],
    async (args) => {
      const { questions, error } = normalizeQuestions(args.questions);

      if (error) {
        return { error };
      }

      if (!questions || questions.length === 0) {
        return { error: "at least one question is required" };
      }

      const node = await mutateFlowWith(roomId, (flow) => {
        const created = createJevStepNode({
          position: nextPosition(flow.toJSON()),
          label: String(args.label ?? "Jev"),
          selected: true,
        });
        created.data.questions = questions;
        flow.addNode(created);
        return created;
      });

      return { id: node.id, label: node.data.label, kind: "jev", handles: questionHandlesOf(questions) };
    }
  );

  graphTool(
    "add_llm_step",
    "Add an end-of-call LLM step (note writer, summarizer). Use {{input}} for the gated transcript and {{answers.<question>}} for Jev answers.",
    {
      label: { type: "string" },
      system: { type: "string" },
      prompt: { type: "string", description: "Defaults to {{input}} (the transcript or wired parent output)." },
      model: { type: "string" },
    },
    ["label"],
    async (args) => {
      const node = await mutateFlowWith(roomId, (flow) => {
        const created = createLlmStepNode({
          position: nextPosition(flow.toJSON()),
          label: String(args.label ?? "LLM"),
          selected: true,
        });

        if (typeof args.system === "string") {
          created.data.system = args.system;
        }
        if (typeof args.prompt === "string" && args.prompt.trim() !== "") {
          created.data.prompt = args.prompt;
        }
        if (typeof args.model === "string" && args.model.trim() !== "") {
          created.data.model = args.model.trim();
        }

        flow.addNode(created);
        return created;
      });

      return { id: node.id, label: node.data.label, kind: "llm" };
    }
  );

  graphTool(
    "add_web_search_step",
    "Add an end-of-call web search step (TinyFish).",
    {
      label: { type: "string" },
      query: { type: "string", description: "Defaults to {{input}}." },
      maxResults: { type: "number" },
    },
    ["label"],
    async (args) => {
      const node = await mutateFlowWith(roomId, (flow) => {
        const created = createWebSearchStepNode({
          position: nextPosition(flow.toJSON()),
          label: String(args.label ?? "Web search"),
          selected: true,
        });

        if (typeof args.query === "string" && args.query.trim() !== "") {
          created.data.query = args.query;
        }
        if (typeof args.maxResults === "number") {
          created.data.maxResults = Math.max(1, Math.min(10, Math.round(args.maxResults)));
        }

        flow.addNode(created);
        return created;
      });

      return { id: node.id, label: node.data.label, kind: "web-search" };
    }
  );

  graphTool(
    "add_fetch_step",
    "Add an end-of-call fetch step (TinyFish): fetch 1–3 URLs as markdown.",
    {
      label: { type: "string" },
      urls: { type: "string", description: "URLs or a {{input}} template, whitespace/newline separated." },
    },
    ["label"],
    async (args) => {
      const node = await mutateFlowWith(roomId, (flow) => {
        const created = createFetchStepNode({
          position: nextPosition(flow.toJSON()),
          label: String(args.label ?? "Fetch"),
          selected: true,
        });

        if (typeof args.urls === "string" && args.urls.trim() !== "") {
          created.data.urls = args.urls;
        }

        flow.addNode(created);
        return created;
      });

      return { id: node.id, label: node.data.label, kind: "fetch" };
    }
  );

  graphTool(
    "add_dispositions",
    "Add a dispositions node: Jev questions answered over the transcript when a conversation ends.",
    {
      label: { type: "string" },
      questions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            type: { type: "string", enum: ["choice", "score", "noul"] },
            options: { type: "array", items: { type: "object", properties: { key: { type: "string" }, description: { type: "string" } }, required: ["key"] } },
            levels: { type: "array", items: { type: "object", properties: { key: { type: "string" }, description: { type: "string" } }, required: ["key"] } },
            threshold: { type: "number" },
          },
          required: ["instructions", "type"],
        },
      },
    },
    ["label", "questions"],
    async (args) => {
      const { questions, error } = normalizeQuestions(args.questions);

      if (error) {
        return { error };
      }

      if (!questions || questions.length === 0) {
        return { error: "at least one question is required" };
      }

      const node = await mutateFlowWith(roomId, (flow) => {
        const created = createDispositionsNode({
          id: `dispositions-${nanoid(8)}`,
          position: nextPosition(flow.toJSON()),
          selected: true,
        });
        created.data.label = String(args.label ?? "Dispositions");
        created.data.questions = questions;
        flow.addNode(created);
        return created;
      });

      return { id: node.id, label: node.data.label, kind: "dispositions" };
    }
  );

  graphTool(
    "add_tool",
    "Add a custom HTTP tool to the toolbox. The agent can call it mid-conversation; {{variables}} resolve from request data, extracted variables and the model's own arguments.",
    {
      name: { type: "string", description: "Function name, snake_case." },
      description: { type: "string", description: "What it does — the model reads this to decide when to call it." },
      method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      url: { type: "string" },
      query: {
        type: "array",
        description: "Query params ({{var}} templates allowed).",
        items: {
          type: "object",
          properties: { key: { type: "string" }, value: { type: "string" } },
          required: ["key", "value"],
        },
      },
      agentSpeech: { type: "string", description: "What the agent says while it runs, e.g. 'Let me pull that up.'" },
    },
    ["name", "description", "url"],
    async (args) => {
      const name = String(args.name ?? "").trim().replace(/\s+/g, "_");

      if (name === "" || typeof args.url !== "string" || !/^https?:\/\//.test(args.url)) {
        return { error: "name and a valid http(s) url are required" };
      }

      return mutateFlowWith(roomId, (flow) => {
        const json = flow.toJSON();
        let toolbox = findToolbox(json);

        if (!toolbox) {
          const created = createToolboxNode({
            id: `toolbox-${nanoid(6)}`,
            position: nextPosition(json),
            selected: true,
          });
          flow.addNode(created);
          toolbox = created;
        }

        const tool = {
          id: `tool-${nanoid(8)}`,
          name,
          description: String(args.description ?? ""),
          agentSpeech: String(args.agentSpeech ?? ""),
          method: (args.method === "POST" || args.method === "PUT" || args.method === "PATCH" || args.method === "DELETE"
            ? args.method
            : "GET") as "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
          url: String(args.url),
          query: Array.isArray(args.query)
            ? args.query
                .map((entry) => {
                  const q = (entry ?? {}) as Record<string, unknown>;
                  return { key: String(q.key ?? ""), value: String(q.value ?? "") };
                })
                .filter((q) => q.key !== "")
            : [],
          headers: [],
          body: "",
          inputs: [],
          outputs: [],
          timeoutMs: 30_000,
          cooldownS: null,
          cache: false,
        };

        const existingTools = toolbox.data.tools;
        patchNode(flow, toolbox.id, (data) => ({
          ...data,
          tools: [...existingTools, tool],
        }));

        return { id: tool.id, name, toolboxId: toolbox.id };
      });
    }
  );

  graphTool(
    "add_knowledge",
    "Attach a knowledge source (verbatim text, or a URL fetched once per conversation) to the toolbox.",
    {
      name: { type: "string" },
      text: { type: "string", description: "Raw knowledge text." },
      url: { type: "string", description: "Alternatively, a URL to fetch." },
    },
    ["name"],
    async (args) => {
      const text = typeof args.text === "string" ? args.text : "";
      const url = typeof args.url === "string" ? args.url : "";

      if (text === "" && !/^https?:\/\//.test(url)) {
        return { error: "provide `text` or a valid `url`" };
      }

      return mutateFlowWith(roomId, (flow) => {
        const json = flow.toJSON();
        let toolbox = findToolbox(json);

        if (!toolbox) {
          const created = createToolboxNode({
            id: `toolbox-${nanoid(6)}`,
            position: nextPosition(json),
            selected: true,
          });
          flow.addNode(created);
          toolbox = created;
        }

        const source = {
          id: `source-${nanoid(8)}`,
          name: String(args.name ?? "Source"),
          type: (url !== "" ? "url" : "text") as "text" | "url",
          source: url !== "" ? url : text,
          attached: true,
        };

        const existingKnowledge = toolbox.data.knowledge;
        patchNode(flow, toolbox.id, (data) => ({
          ...data,
          knowledge: [...existingKnowledge, source],
        }));

        return { id: source.id, name: source.name, toolboxId: toolbox.id };
      });
    }
  );

  /* ----------------------------- Update / wire ---------------------------- */

  graphTool(
    "update_node",
    "Update an existing node by id or label. Only provided fields change.",
    {
      ref: { type: "string", description: "Node id or exact label." },
      label: { type: "string" },
      // start
      sample: { type: "string" },
      requestData: {
        type: "array",
        items: { type: "object", properties: { key: { type: "string" }, value: { type: "string" } }, required: ["key", "value"] },
      },
      // agent
      model: { type: "string" },
      systemPrompt: { type: "string", description: "agent node: persona." },
      taskPrompt: { type: "string", description: "agent node: the job for this conversation." },
      variables: {
        type: "array",
        description: "agent/scenario: variables to extract mid-conversation.",
        items: {
          type: "object",
          properties: { name: { type: "string" }, type: { type: "string", enum: ["string", "number", "boolean"] }, prompt: { type: "string" } },
          required: ["name", "prompt"],
        },
      },
      // scenario
      prompt: { type: "string", description: "scenario prompt chunk or llm step prompt." },
      exitCondition: { type: "string" },
      routingMode: { type: "string", enum: ["ai_decides", "conditions"] },
      routingDescription: { type: "string" },
      rules: {
        type: "array",
        items: { type: "object", properties: { variable: { type: "string" }, op: { type: "string", enum: ["equals", "not_equals", "contains"] }, value: { type: "string" } }, required: ["variable", "op", "value"] },
      },
      // jev / dispositions
      questions: {
        type: "array",
        description: "Replaces the node's questions.",
        items: {
          type: "object",
          properties: {
            instructions: { type: "string" },
            type: { type: "string", enum: ["choice", "score", "noul"] },
            options: { type: "array", items: { type: "object", properties: { key: { type: "string" }, description: { type: "string" } }, required: ["key"] } },
            levels: { type: "array", items: { type: "object", properties: { key: { type: "string" }, description: { type: "string" } }, required: ["key"] } },
            threshold: { type: "number" },
          },
          required: ["instructions", "type"],
        },
      },
      // llm / search / fetch steps
      system: { type: "string" },
      query: { type: "string" },
      urls: { type: "string" },
    },
    ["ref"],
    async (args) => {
      const ref = String(args.ref ?? "").trim();

      // Question shapes are validated before any mutation is applied.
      const { questions: normalizedQuestions, error: questionError } =
        args.questions !== undefined ? normalizeQuestions(args.questions) : {};

      if (questionError) {
        return { error: questionError };
      }

      return mutateFlowWith(roomId, (flow) => {
        const node = findNode(flow.toJSON(), ref);

        if (!node) {
          return { error: `no node matches "${ref}"` };
        }

        flow.updateNode(node.id, (current) => {
          const data = { ...(current.data as Record<string, unknown>) };

          const set = (key: string, value: unknown) => {
            if (value !== undefined) {
              data[key] = value;
            }
          };

          set("label", typeof args.label === "string" && args.label.trim() !== "" ? args.label.trim() : undefined);
          set("sample", typeof args.sample === "string" ? args.sample : undefined);
          set("model", typeof args.model === "string" && args.model.trim() !== "" ? args.model.trim() : undefined);
          set("systemPrompt", typeof args.systemPrompt === "string" ? args.systemPrompt : undefined);
          set("taskPrompt", typeof args.taskPrompt === "string" ? args.taskPrompt : undefined);
          set("prompt", typeof args.prompt === "string" ? args.prompt : undefined);
          set("exitCondition", typeof args.exitCondition === "string" ? args.exitCondition : undefined);
          set("system", typeof args.system === "string" ? args.system : undefined);
          set("query", typeof args.query === "string" ? args.query : undefined);
          set("urls", typeof args.urls === "string" ? args.urls : undefined);

          if (Array.isArray(args.requestData)) {
            data.requestData = args.requestData
              .map((entry) => {
                const r = (entry ?? {}) as Record<string, unknown>;
                return { key: String(r.key ?? ""), value: String(r.value ?? "") };
              })
              .filter((r) => r.key !== "");
          }

          if (Array.isArray(args.variables)) {
            data.variables = normalizeVariables(args.variables);
          }

          if (normalizedQuestions !== undefined) {
            data.questions = normalizedQuestions ?? [];
          }

          if (args.routingMode === "conditions" || Array.isArray(args.rules)) {
            data.routing = {
              mode: "conditions",
              rules: normalizeRules(args.rules),
            };
          } else if (args.routingMode === "ai_decides" || args.routingDescription !== undefined) {
            const previous =
              data.routing !== null && typeof data.routing === "object"
                ? (data.routing as { description?: unknown }).description
                : undefined;
            data.routing = {
              mode: "ai_decides",
              description:
                typeof args.routingDescription === "string"
                  ? args.routingDescription
                  : typeof previous === "string"
                    ? previous
                    : "",
            };
          }

          return { ...current, data } as AgentGraphNode;
        });

        return { id: node.id, updated: true };
      });
    }
  );

  graphTool(
    "connect",
    "Wire an edge: from a node (optionally a specific source handle, e.g. a Jev answer handle like q:<questionId>:yes) into a target node. Jev-answer edges into a scenario make it run every turn; edges into steps gate them.",
    {
      from: { type: "string", description: "Source node id or label." },
      fromHandle: { type: "string", description: "Source handle id; defaults to the node's main output." },
      to: { type: "string", description: "Target node id or label." },
    },
    ["from", "to"],
    async (args) => {
      return mutateFlowWith(roomId, (flow) => {
        const json = flow.toJSON();
        const from = findNode(json, String(args.from ?? ""));
        const to = findNode(json, String(args.to ?? ""));

        if (!from || !to) {
          return { error: `no node matches "${!from ? args.from : args.to}"` };
        }

        if (from.id === to.id) {
          return { error: "cannot connect a node to itself" };
        }

        const edge = createAgentEdge({
          source: from.id,
          sourceHandle: typeof args.fromHandle === "string" && args.fromHandle.trim() !== "" ? args.fromHandle.trim() : undefined,
          target: to.id,
        });

        flow.addEdge(edge);

        return { edgeId: edge.id, from: from.id, fromHandle: edge.sourceHandle ?? "out", to: to.id };
      });
    }
  );

  graphTool(
    "remove_node",
    "Remove a node (and its edges). The start and agent singletons cannot be removed — update them instead.",
    { ref: { type: "string", description: "Node id or exact label." } },
    ["ref"],
    async (args) => {
      return mutateFlowWith(roomId, (flow) => {
        const json = flow.toJSON();
        const node = findNode(json, String(args.ref ?? ""));

        if (!node) {
          return { error: `no node matches "${args.ref}"` };
        }

        if (node.type === "start" || node.type === "agent") {
          return { error: `the ${node.type} node is pinned; use update_node instead` };
        }

        const edgeIds = json.edges
          .filter((edge) => edge.source === node.id || edge.target === node.id)
          .map((edge) => edge.id);

        flow.removeEdges(edgeIds);
        flow.removeNode(node.id);

        return { removed: node.id, removedEdges: edgeIds.length };
      });
    }
  );

  /* --------------------------- Test the built agent ---------------------- */

  graphTool(
    "start_test_conversation",
    "Start a real test conversation with the agent as built (same engine the Chat tab uses). Returns the conversationId for send_test_message / read_transcript.",
    { opening: { type: "string", description: "First caller message; empty = agent speaks first." } },
    [],
    async (args) => {
      const opening = typeof args.opening === "string" ? args.opening.trim() : "";
      const { conversationId } = await startConversation({
        roomId,
        opening: opening === "" ? undefined : opening,
      });
      return { conversationId };
    }
  );

  graphTool(
    "send_test_message",
    "Send one caller turn to a test conversation and get the agent's reply.",
    {
      conversationId: { type: "string" },
      text: { type: "string" },
    },
    ["conversationId", "text"],
    async (args) => {
      const result = await processTurn({
        roomId,
        conversationId: String(args.conversationId ?? ""),
        text: String(args.text ?? ""),
      });

      return { reply: result.reply, ended: result.ended, ...(result.error ? { error: result.error } : {}) };
    }
  );

  graphTool(
    "read_transcript",
    "Read a conversation's transcript (caller/agent turns, tool calls, dispositions) to verify how the built agent behaved.",
    { conversationId: { type: "string" } },
    ["conversationId"],
    async (args) => {
      const events = await loadEvents(roomId, String(args.conversationId ?? ""));

      if (events === null) {
        return { error: "conversation not found" };
      }

      const lines = events
        .filter((event) => event.kind !== "state")
        .map((event) => {
          switch (event.kind) {
            case "user":
              return `caller: ${event.text}`;
            case "agent":
              return `agent: ${event.text}`;
            case "tool":
              return `tool ${event.toolName}: ${event.status}${event.outputs ? ` ${truncate(JSON.stringify(event.outputs), 200)}` : ""}`;
            case "routing":
              return `routing: entered [${event.entered.join(", ")}] exited [${event.exited.join(", ")}]`;
            case "extraction":
              return `extracted: ${event.changed.map((name) => `${name}=${event.variables[name]}`).join(", ")}`;
            case "disposition":
              return `disposition: ${Object.entries(event.answers)
                .map(([id, answer]) => `${id}=${answerText(answer)}`)
                .join(", ")}`;
            case "jev":
              return `jev (${event.phase}): ${Object.entries(event.answers)
                .map(([id, answer]) => `${id}=${answerText(answer)}`)
                .join(", ")}`;
            case "guardrail":
              return `guardrail: ${event.checks.map((c) => `${c.id}=${c.pass ? "pass" : "fail"}`).join(", ")}`;
            case "step":
              return `step ${event.label}: ${event.status}${event.output ? ` ${truncate(event.output, 200)}` : ""}`;
            case "call":
              return `call: ${event.direction} ${event.status}`;
            case "error":
              return `error: ${event.message}`;
            default:
              return undefined;
          }
        })
        .filter((line): line is string => line !== undefined);

      return { transcript: truncate(lines.join("\n"), TRANSCRIPT_CHARS) };
    }
  );

  /* -------------------------------- Research ------------------------------ */

  graphTool(
    "web_search",
    "Search the web (TinyFish) — useful for researching the domain before designing the agent.",
    { query: { type: "string" } },
    ["query"],
    async (args) => {
      const result = await webSearch({
        query: String(args.query ?? ""),
        maxResults: 5,
      });
      return { results: truncate(result.text, TOOL_RESULT_CHARS), mock: result.mock };
    }
  );

  graphTool(
    "fetch_page",
    "Fetch one web page as markdown (TinyFish).",
    { url: { type: "string" } },
    ["url"],
    async (args) => {
      const url = String(args.url ?? "");

      if (!/^https?:\/\//.test(url)) {
        return { error: "a valid http(s) url is required" };
      }

      const result = await fetchPages({ urls: [url] });
      return { page: truncate(result.text, TOOL_RESULT_CHARS), mock: result.mock };
    }
  );

  return tools;
}

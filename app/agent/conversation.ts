import type { Answer } from "../workflow/runs";

/**
 * One agent conversation = one Liveblocks feed (like workflow runs). Every
 * turn writes append-only messages; the `state` message is updated in place
 * so the engine can rebuild context from the feed on every request.
 */

export type ConversationStatus = "running" | "complete" | "error";

export type ConversationEventBase = {
  // Feed message id, set by the engine so updates can target the message.
  id: string;
  at: number;
};

export type UserEvent = ConversationEventBase & {
  kind: "user";
  text: string;
};

export type AgentEvent = ConversationEventBase & {
  kind: "agent";
  text: string;
  mock?: boolean;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
};

export type ToolEvent = ConversationEventBase & {
  kind: "tool";
  toolId: string;
  toolName: string;
  status: "running" | "complete" | "error";
  // The line the agent says while the tool runs.
  speech?: string;
  args?: Record<string, unknown>;
  outputs?: Record<string, unknown>;
  error?: string;
  durationMs?: number;
};

export type RoutingDetail = {
  scenarioId: string;
  scenarioLabel: string;
  answer: string;
  probability: number;
};

export type RoutingEvent = ConversationEventBase & {
  kind: "routing";
  entered: string[];
  exited: string[];
  active: string[];
  detail: RoutingDetail[];
  mock?: boolean;
};

export type ExtractionEvent = ConversationEventBase & {
  kind: "extraction";
  // Full variable map after this extraction, so the latest one is current.
  variables: Record<string, string>;
  changed: string[];
  mock?: boolean;
};

export type GuardrailCheck = {
  id: string;
  pass: boolean;
  detail: string;
};

export type GuardrailEvent = ConversationEventBase & {
  kind: "guardrail";
  checks: GuardrailCheck[];
};

export type DispositionEvent = ConversationEventBase & {
  kind: "disposition";
  // Dispositions node that produced this event (one askJev call per node).
  nodeId?: string;
  answers: Record<string, Answer>;
  mock?: boolean;
};

/**
 * Answers from a Jev node dropped on the agent canvas. Nodes wired into a
 * scenario run every turn (explicit routing); the rest run at end of call
 * alongside the dispositions.
 */
export type JevEvent = ConversationEventBase & {
  kind: "jev";
  nodeId: string;
  phase: "turn" | "end";
  answers: Record<string, Answer>;
  mock?: boolean;
};

/** One executed canvas step (LLM note writer, web search, fetch) at end of call. */
export type StepEvent = ConversationEventBase & {
  kind: "step";
  nodeId: string;
  nodeType: "llm" | "web-search" | "fetch";
  label: string;
  status: "running" | "complete" | "skipped" | "error";
  output?: string;
  error?: string;
  durationMs?: number;
  mock?: boolean;
};

export type ConversationStateEvent = ConversationEventBase & {
  kind: "state";
  variables: Record<string, string>;
  activeScenarios: string[];
  turn: number;
  ended: boolean;
  // Set once the AI disclosure guardrail has been satisfied.
  disclosedAi: boolean;
  handoff: boolean;
  // Latest Jev answers (template value form) from per-turn canvas nodes.
  answers: Record<string, { value: string; probability: number; confidence: number }>;
  // Jev node id -> handles that fired on the latest turn.
  jevFires: Record<string, string[]>;
  // tool cache key -> last response (and when), for cooldown/cache settings.
  toolCache: Record<string, { at: number; response: unknown }>;
  // knowledge source id -> fetched text (URL sources are fetched once).
  knowledgeCache: Record<string, string>;
};

export type ConversationErrorEvent = ConversationEventBase & {
  kind: "error";
  message: string;
};

export type ConversationEvent =
  | UserEvent
  | AgentEvent
  | ToolEvent
  | RoutingEvent
  | ExtractionEvent
  | GuardrailEvent
  | DispositionEvent
  | JevEvent
  | StepEvent
  | ConversationStateEvent
  | ConversationErrorEvent;

export function isConversationEvent(
  value: unknown
): value is ConversationEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { kind?: unknown }).kind === "string"
  );
}

export const STATE_MESSAGE_ID = "state";

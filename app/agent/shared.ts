import type { Edge, Node } from "@xyflow/react";
import { nanoid } from "nanoid";
import {
  DEFAULT_LLM_MODEL,
  slugify,
  truncate,
  type QuestionDef,
} from "../workflow/shared";

/**
 * Call-agent builder (see CALL_AGENT_BLUEPRINT.md). One agent = one Liveblocks
 * room, separate from workflow rooms. All authoring state lives in the flow
 * storage key as typed nodes, so multiplayer editing, undo/redo and the
 * server-side snapshot read all work through the same primitives as workflows.
 */

export const AGENT_EXAMPLE_ID = "jev-call-agent-builder";
export const AGENT_ROOM_ID_PREFIX = `liveblocks:examples:${AGENT_EXAMPLE_ID}`;
export const AGENT_FLOW_STORAGE_KEY = "flow" as const;
export const AGENT_EDGE_TYPE = "smoothstep" as const;

// Singleton node ids, like the workflow input/output nodes.
export const START_NODE_ID = "start";
export const AGENT_NODE_ID = "agent";
export const TOOLBOX_NODE_ID = "toolbox";
export const DISPOSITIONS_NODE_ID = "dispositions";

export const AGENT_NODE_WIDTH = 296;

/* -------------------------------------------------------------------------- */
/*                             Shared doc fragments                            */
/* -------------------------------------------------------------------------- */

export type VariableType = "string" | "number" | "boolean";

/**
 * A value the agent pulls out of the conversation as it goes (Bland's
 * "variables to extract"). Fills tool inputs, routing conditions and
 * dispositions.
 */
export type ExtractedVariable = {
  id: string;
  name: string;
  type: VariableType;
  // How to extract this value, in plain language.
  prompt: string;
};

export type RoutingRuleOperator = "equals" | "not_equals" | "contains";

export type RoutingRule = {
  variable: string;
  op: RoutingRuleOperator;
  value: string;
};

/**
 * How a scenario is entered, mirroring Bland's routing condition:
 * - `conditions`: deterministic match over extracted variables (no model).
 * - `ai_decides`: one batched Jev choice question over all such scenarios.
 */
export type ScenarioRouting =
  | { mode: "conditions"; rules: RoutingRule[] }
  | { mode: "ai_decides"; description: string };

export type ScenarioNodeData = {
  label: string;
  routing: ScenarioRouting;
  // Prompt chunk appended while this scenario is active.
  prompt: string;
  // "Move forward once <this> is achieved" — Jev noul check each turn.
  exitCondition: string;
  variables: ExtractedVariable[];
  // Ids into the toolbox registry.
  toolIds: string[];
};

export type ToolInput = {
  name: string;
  // What the agent should fill this with.
  instructions: string;
  type: VariableType;
  required: boolean;
  // Redacted everywhere except the live HTTP request.
  sensitive: boolean;
};

export type ToolOutput = {
  name: string;
  type: VariableType;
  // JSON path into the response, e.g. `$.data.items[0].name`.
  path: string;
  sensitive: boolean;
};

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A custom HTTP tool. The model sees `description` + `inputs` as a function
 * schema; `agentSpeech` is what the agent says while the request runs.
 */
export type ToolDoc = {
  id: string;
  name: string;
  description: string;
  agentSpeech: string;
  method: HttpMethod;
  // `{{variable}}` templates resolved from request data, extracted variables
  // and the model's own tool-call arguments.
  url: string;
  query: { key: string; value: string }[];
  headers: { key: string; value: string }[];
  // Optional JSON body template for non-GET requests.
  body: string;
  inputs: ToolInput[];
  outputs: ToolOutput[];
  timeoutMs: number;
  cooldownS: number | null;
  cache: boolean;
};

export type KnowledgeSourceDoc = {
  id: string;
  name: string;
  type: "text" | "url";
  // Raw text, or a URL fetched via TinyFish on first use.
  source: string;
  attached: boolean;
};

export type GuardrailsDoc = {
  // The agent must disclose it is an AI within this many turns.
  aiDisclosure: { enabled: boolean; withinTurns: number };
  // A clear opt-out ends the conversation immediately.
  optOut: boolean;
};

export type StartNodeData = {
  label: string;
  // Default first caller message for chat tests.
  sample: string;
  // Facts the agent knows from the start, exposed as {{variables}}.
  requestData: { key: string; value: string }[];
};

export type AgentNodeData = {
  label: string;
  model: string;
  // Global persona: who the agent is and how it talks.
  systemPrompt: string;
  // The job for this conversation (Bland's node prompt).
  taskPrompt: string;
  memory: boolean;
  variables: ExtractedVariable[];
  guardrails: GuardrailsDoc;
  // Built-in tools offered to the model in addition to the toolbox.
  endCallTool: boolean;
  handoffTool: boolean;
  // TinyFish-backed research tools the model can call mid-conversation.
  webSearchTool: boolean;
  fetchPageTool: boolean;
};

export type ToolboxNodeData = {
  label: string;
  tools: ToolDoc[];
  knowledge: KnowledgeSourceDoc[];
};

export type DispositionsNodeData = {
  label: string;
  // Jev questions evaluated over the transcript when the conversation ends.
  questions: QuestionDef[];
};

/**
 * How a step node with several incoming edges decides to run, like the
 * workflow builder: `any` (OR) fires on the first parent handle, `all` (AND)
 * requires every incoming handle to have fired.
 */
export type ActivationMode = "any" | "all";

export type JevStepData = {
  label: string;
  questions: QuestionDef[];
  activation?: ActivationMode;
};

export type LlmStepData = {
  label: string;
  model: string;
  system: string;
  prompt: string;
  activation?: ActivationMode;
};

export type WebSearchStepData = {
  label: string;
  query: string;
  maxResults: number;
  activation?: ActivationMode;
};

export type FetchStepData = {
  label: string;
  urls: string;
  activation?: ActivationMode;
};

/* -------------------------------------------------------------------------- */
/*                                   Nodes                                    */
/* -------------------------------------------------------------------------- */

export type StartNode = Node<StartNodeData, "start">;
export type AgentNode = Node<AgentNodeData, "agent">;
export type ScenarioNode = Node<ScenarioNodeData, "scenario">;
export type ToolboxNode = Node<ToolboxNodeData, "toolbox">;
export type DispositionsNode = Node<DispositionsNodeData, "dispositions">;

// Droppable workflow-style nodes. Data mirrors the workflow builder's shapes
// so the editors (and the Jev question system) stay interchangeable.
export type AgentJevNode = Node<JevStepData, "jev">;
export type AgentLlmNode = Node<LlmStepData, "llm">;
export type AgentWebSearchNode = Node<WebSearchStepData, "web-search">;
export type AgentFetchNode = Node<FetchStepData, "fetch">;

export type AgentGraphNode =
  | StartNode
  | AgentNode
  | ScenarioNode
  | ToolboxNode
  | DispositionsNode
  | AgentJevNode
  | AgentLlmNode
  | AgentWebSearchNode
  | AgentFetchNode;

export type AgentGraphNodeType = AgentGraphNode["type"];

export type AgentEdgeData = Record<string, never>;
export type AgentEdge = Edge<AgentEdgeData, typeof AGENT_EDGE_TYPE>;

export type Point = { x: number; y: number };

export function createAgentEdge(args: {
  id?: string;
  source: string;
  sourceHandle?: string;
  target: string;
}): AgentEdge {
  return {
    id:
      args.id ??
      `e-${args.source}-${args.sourceHandle ?? "out"}-${args.target}-${nanoid(6)}`,
    type: AGENT_EDGE_TYPE,
    source: args.source,
    sourceHandle: args.sourceHandle,
    target: args.target,
    data: {},
  };
}

/* -------------------------------------------------------------------------- */
/*                                 Factories                                  */
/* -------------------------------------------------------------------------- */

export function createVariable(index: number): ExtractedVariable {
  return {
    id: `variable-${nanoid(8)}`,
    name: `variable_${index}`,
    type: "string",
    prompt: "",
  };
}

export function createToolInput(): ToolInput {
  return {
    name: "",
    instructions: "",
    type: "string",
    required: true,
    sensitive: false,
  };
}

export function createTool(): ToolDoc {
  return {
    id: `tool-${nanoid(8)}`,
    name: "",
    description: "",
    agentSpeech: "",
    method: "GET",
    url: "",
    query: [],
    headers: [],
    body: "",
    inputs: [],
    outputs: [],
    timeoutMs: 30_000,
    cooldownS: null,
    cache: false,
  };
}

export function createKnowledgeSource(): KnowledgeSourceDoc {
  return { id: `source-${nanoid(8)}`, name: "", type: "text", source: "", attached: true };
}

export function createStartNode(args: {
  position: Point;
  sample?: string;
  selected?: boolean;
}): StartNode {
  return {
    id: START_NODE_ID,
    type: "start",
    position: args.position,
    selected: args.selected,
    deletable: false,
    data: {
      label: "Call start",
      sample: args.sample ?? "",
      requestData: [],
    },
  };
}

export function createAgentNode(args: {
  position: Point;
  selected?: boolean;
}): AgentNode {
  return {
    id: AGENT_NODE_ID,
    type: "agent",
    position: args.position,
    selected: args.selected,
    deletable: false,
    data: {
      label: "Agent",
      model: DEFAULT_LLM_MODEL,
      systemPrompt: "",
      taskPrompt: "",
      memory: false,
      variables: [],
      guardrails: {
        aiDisclosure: { enabled: true, withinTurns: 2 },
        optOut: true,
      },
      endCallTool: true,
      handoffTool: false,
      webSearchTool: true,
      fetchPageTool: false,
    },
  };
}

export function createJevStepNode(args: {
  id?: string;
  position: Point;
  label?: string;
  selected?: boolean;
}): AgentJevNode {
  return {
    id: args.id ?? `jev-${nanoid(8)}`,
    type: "jev",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Jev",
      questions: [],
      activation: "any",
    },
  };
}

export function createLlmStepNode(args: {
  id?: string;
  position: Point;
  label?: string;
  selected?: boolean;
}): AgentLlmNode {
  return {
    id: args.id ?? `llm-${nanoid(8)}`,
    type: "llm",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "LLM",
      model: DEFAULT_LLM_MODEL,
      system: "",
      prompt: "{{input}}",
      activation: "any",
    },
  };
}

export function createWebSearchStepNode(args: {
  id?: string;
  position: Point;
  label?: string;
  selected?: boolean;
}): AgentWebSearchNode {
  return {
    id: args.id ?? `web-search-${nanoid(8)}`,
    type: "web-search",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Web search",
      query: "{{input}}",
      maxResults: 5,
      activation: "any",
    },
  };
}

export function createFetchStepNode(args: {
  id?: string;
  position: Point;
  label?: string;
  selected?: boolean;
}): AgentFetchNode {
  return {
    id: args.id ?? `fetch-${nanoid(8)}`,
    type: "fetch",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Fetch",
      urls: "{{input}}",
      activation: "any",
    },
  };
}

export function getActivation(data: {
  activation?: ActivationMode;
}): ActivationMode {
  return data.activation ?? "any";
}

export function createScenarioNode(args: {
  id?: string;
  position: Point;
  label?: string;
  selected?: boolean;
}): ScenarioNode {
  return {
    id: args.id ?? `scenario-${nanoid(8)}`,
    type: "scenario",
    position: args.position,
    selected: args.selected,
    deletable: true,
    data: {
      label: args.label ?? "Scenario",
      routing: { mode: "ai_decides", description: "" },
      prompt: "",
      exitCondition: "",
      variables: [],
      toolIds: [],
    },
  };
}

export function createToolboxNode(args: {
  id?: string;
  position: Point;
  selected?: boolean;
}): ToolboxNode {
  return {
    id: args.id ?? TOOLBOX_NODE_ID,
    type: "toolbox",
    position: args.position,
    selected: args.selected,
    data: { label: "Tools & knowledge", tools: [], knowledge: [] },
  };
}

export function createDispositionsNode(args: {
  id?: string;
  position: Point;
  selected?: boolean;
}): DispositionsNode {
  return {
    id: args.id ?? DISPOSITIONS_NODE_ID,
    type: "dispositions",
    position: args.position,
    selected: args.selected,
    data: { label: "Dispositions", questions: [] },
  };
}

/* -------------------------------------------------------------------------- */
/*                                  Helpers                                   */
/* -------------------------------------------------------------------------- */

/**
 * Replaces `{{name}}` placeholders from a flat scope. Unknown names resolve
 * to "" (missing required inputs are validated separately).
 */
export function renderAgentTemplate(
  template: string,
  scope: Record<string, unknown>
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, name: string) => {
    const value = scope[name];
    return value === undefined || value === null ? "" : String(value);
  });
}

/**
 * Resolves a JSON path like `$.data.items[0].name` against a parsed response.
 */
export function getByPath(value: unknown, path: string): unknown {
  const trimmed = path.trim().replace(/^\$\.?/, "");

  if (trimmed === "") {
    return value;
  }

  let current: unknown = value;

  for (const segment of trimmed.split(".")) {
    const match = segment.match(/^(\w+)(?:\[(\d+)\])?$/);

    if (!match) {
      return undefined;
    }

    if (current !== null && typeof current === "object") {
      current = (current as Record<string, unknown>)[match[1]];
    } else {
      return undefined;
    }

    if (match[2] !== undefined) {
      if (Array.isArray(current)) {
        current = current[Number(match[2])];
      } else {
        return undefined;
      }
    }
  }

  return current;
}

/**
 * The JSON Schema handed to the model for one tool's arguments.
 */
export function toolInputSchema(tool: ToolDoc): {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
} {
  const properties: Record<string, unknown> = {};

  for (const input of tool.inputs) {
    if (!input.name) {
      continue;
    }

    properties[input.name] = {
      type: input.type,
      description: input.instructions || undefined,
    };
  }

  const required = tool.inputs
    .filter((input) => input.name && input.required)
    .map((input) => input.name);

  return {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
  };
}

export function evaluateRoutingRule(
  rule: RoutingRule,
  variables: Record<string, string>
): boolean {
  const value = variables[rule.variable] ?? "";

  switch (rule.op) {
    case "equals":
      return value.trim().toLowerCase() === rule.value.trim().toLowerCase();
    case "not_equals":
      return value.trim().toLowerCase() !== rule.value.trim().toLowerCase();
    case "contains":
      return value.toLowerCase().includes(rule.value.trim().toLowerCase());
  }
}

/** URL/handle-safe id for scenario routing options. */
export { slugify, truncate };

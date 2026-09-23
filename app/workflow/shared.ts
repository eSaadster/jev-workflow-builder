import type { Edge, Node } from "@xyflow/react";
import { nanoid } from "nanoid";

export const EXAMPLE_ID = "nextjs-typesafe-workflow-builder";
export const ROOM_ID_PREFIX = `liveblocks:examples:${EXAMPLE_ID}`;
export const FLOW_STORAGE_KEY = "flow" as const;
// Edges use React Flow's built-in smoothstep renderer.
export const WORKFLOW_EDGE_TYPE = "smoothstep" as const;
export const INPUT_NODE_ID = "input";
export const OUTPUT_NODE_ID = "output";

// Most target handles use `in`; the output node has a handle per property.
export const IN_HANDLE = "in";
export const OUT_HANDLE = "out";
// Every Jev node has one "always" handle in addition to its answer handles.
export const ANY_HANDLE = "any";

// Models served over Zen's `/zen/go/v1/chat/completions` endpoint, verified with
// a live request each. Zen also offers grok-4.6, grok-4.7, gpt-5.6-luna and the
// muse-spark-* models, but those only answer on `/zen/go/v1/responses` and need
// `@ai-sdk/openai` instead of the provider used here.
export const LLM_MODEL_GROUPS = [
  {
    label: "DeepSeek",
    models: [
      { id: "deepseek-v4.1-flash", label: "DeepSeek V4.1 Flash" },
      { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
      { id: "deepseek-v4-flash", label: "DeepSeek V4 Flash" },
      { id: "deepseek-flash", label: "DeepSeek Flash" },
      {
        id: "deepseek-v4-flash-vision-exp",
        label: "DeepSeek V4 Flash Vision (exp)",
      },
    ],
  },
  {
    label: "Z.ai",
    models: [
      { id: "glm-5.3", label: "GLM 5.3" },
      { id: "glm-5.3-flash", label: "GLM 5.3 Flash" },
      { id: "glm-5.2", label: "GLM 5.2" },
      { id: "glm-5.1", label: "GLM 5.1" },
    ],
  },
  {
    label: "Qwen",
    models: [
      { id: "qwen3.8-max", label: "Qwen3.8 Max" },
      { id: "qwen3.7-max", label: "Qwen3.7 Max" },
      { id: "qwen3.8-flash", label: "Qwen3.8 Flash" },
      { id: "qwen3.7-plus", label: "Qwen3.7 Plus" },
      { id: "qwen3.6-plus", label: "Qwen3.6 Plus" },
    ],
  },
  {
    label: "Moonshot AI",
    models: [
      { id: "kimi-k3", label: "Kimi K3" },
      { id: "kimi-k2.7-code", label: "Kimi K2.7 Code" },
      { id: "kimi-k2.6", label: "Kimi K2.6" },
    ],
  },
  {
    label: "MiniMax",
    models: [
      { id: "minimax-m3", label: "MiniMax M3" },
      { id: "minimax-m2.5", label: "MiniMax M2.5" },
    ],
  },
  {
    label: "MiMo",
    models: [
      { id: "mimo-v2.5-pro", label: "MiMo V2.5 Pro" },
      { id: "mimo-v2.5", label: "MiMo V2.5" },
    ],
  },
  {
    label: "Other",
    models: [
      { id: "longcat-2.0", label: "LongCat 2.0" },
      { id: "hy4-preview", label: "HY4 (preview)" },
      { id: "hy3", label: "HY3" },
      { id: "omen-alpha", label: "Omen Alpha" },
    ],
  },
];
export const LLM_MODELS = LLM_MODEL_GROUPS.flatMap((group) => group.models);
export const DEFAULT_LLM_MODEL = "deepseek-v4.1-flash";
export const DEFAULT_NOUL_THRESHOLD = 0.7;

export type QuestionType = "choice" | "score" | "noul";

export type Criterion = {
  // Used as the handle id suffix and, for Choice, as the option label sent to
  // TypeSafe. Kept URL/handle-safe (see `slugify`).
  key: string;
  description: string;
};

export type ChoiceQuestionDef = {
  id: string;
  type: "choice";
  instructions: string;
  options: Criterion[];
};

export type ScoreQuestionDef = {
  id: string;
  type: "score";
  instructions: string;
  // Ordered from lowest (index 0) to highest.
  levels: Criterion[];
};

export type NoulQuestionDef = {
  id: string;
  type: "noul";
  instructions: string;
  // `yes` fires when the returned probability is >= threshold.
  threshold: number;
};

export type QuestionDef =
  | ChoiceQuestionDef
  | ScoreQuestionDef
  | NoulQuestionDef;

export type InputNodeData = {
  label: string;
  // Used by the "Run" button in the side panel as the default input.
  sample: string;
};

/**
 * How a node with several incoming edges decides to run:
 * - `any` (default, OR): at least one incoming handle fired.
 * - `all` (AND): every incoming handle fired. Connect two answer handles
 *   (e.g. `intent = billing` and `urgent = yes`) into one node and set it to
 *   `all` to express "if this AND that".
 */
export type ActivationMode = "any" | "all";

export type JevNodeData = {
  label: string;
  questions: QuestionDef[];
  activation?: ActivationMode;
};

export type LlmNodeData = {
  label: string;
  model: string;
  system: string;
  prompt: string;
  activation?: ActivationMode;
};

/**
 * Unique sink, like the input node. Collects parent texts into named output
 * properties, according to the connected target handle.
 * To merge several drafts into one string, run them through an LLM node first.
 */
/**
 * TinyFish web search. `query` is a template; results become a numbered text
 * list (title, URL, snippet) so a downstream fetch node can pick up the URLs.
 */
export type WebSearchNodeData = {
  label: string;
  query: string;
  maxResults: number;
  activation?: ActivationMode;
};

/**
 * TinyFish fetch. `urls` is a template; every http(s) URL found in the
 * rendered text is fetched (up to `MAX_FETCH_URLS`) and returned as markdown.
 */
export type FetchNodeData = {
  label: string;
  urls: string;
  activation?: ActivationMode;
};

export const WEB_SEARCH_RESULT_COUNTS = [3, 5, 10] as const;
export const DEFAULT_WEB_SEARCH_RESULTS = 5;
export const MAX_FETCH_URLS = 3;

export type OutputNodeData = {
  label: string;
  activation?: ActivationMode;
  properties?: OutputProperty[];
};

export type OutputProperty = {
  // Stable handle id: renaming a property keeps its connections intact.
  id: string;
  name: string;
};

const DEFAULT_OUTPUT_PROPERTIES: OutputProperty[] = [
  { id: "customer", name: "customer" },
  { id: "team", name: "team" },
];

export function getOutputProperties(data: OutputNodeData): OutputProperty[] {
  return data.properties ?? DEFAULT_OUTPUT_PROPERTIES;
}

export function getOutputPropertyId(
  handleId: string | null | undefined
): string {
  // The original single input becomes the default Customer property.
  return !handleId || handleId === IN_HANDLE ? "customer" : handleId;
}

export function createOutputProperty(
  properties: readonly OutputProperty[]
): OutputProperty {
  const names = new Set(properties.map((property) => property.name));
  let index = properties.length + 1;
  while (names.has(`property_${index}`)) index++;
  return { id: `property-${nanoid(8)}`, name: `property_${index}` };
}

export function getActivation(data: {
  activation?: ActivationMode;
}): ActivationMode {
  return data.activation ?? "any";
}

export type InputNode = Node<InputNodeData, "input">;
export type JevNode = Node<JevNodeData, "jev">;
export type LlmNode = Node<LlmNodeData, "llm">;
export type WebSearchNode = Node<WebSearchNodeData, "web-search">;
export type FetchNode = Node<FetchNodeData, "fetch">;
export type OutputNode = Node<OutputNodeData, "output">;
export type WorkflowNode =
  | InputNode
  | JevNode
  | LlmNode
  | WebSearchNode
  | FetchNode
  | OutputNode;
export type WorkflowNodeType = WorkflowNode["type"];

export type WorkflowEdgeData = Record<string, never>;
export type WorkflowEdge = Edge<WorkflowEdgeData, typeof WORKFLOW_EDGE_TYPE>;

export type Point = { x: number; y: number };

/* -------------------------------------------------------------------------- */
/*                                   Handles                                  */
/* -------------------------------------------------------------------------- */

export type HandleDef = {
  id: string;
  // Short label rendered next to the handle.
  label: string;
  // Longer description shown as a tooltip.
  title: string;
  questionId?: string;
};

export function questionHandleId(questionId: string, key: string) {
  return `q:${questionId}:${key}`;
}

export function getQuestionHandles(question: QuestionDef): HandleDef[] {
  switch (question.type) {
    case "choice":
      return question.options.map((option) => ({
        id: questionHandleId(question.id, option.key),
        label: option.key,
        title: `${question.id} = ${option.key}`,
        questionId: question.id,
      }));
    case "score":
      return question.levels.map((level, index) => ({
        id: questionHandleId(question.id, String(index)),
        label: level.key || `level ${index}`,
        title: `${question.id} rounds to level ${index}${level.key ? ` (${level.key})` : ""}`,
        questionId: question.id,
      }));
    case "noul":
      return [
        {
          id: questionHandleId(question.id, "yes"),
          label: "yes",
          title: `${question.id} ≥ ${question.threshold}`,
          questionId: question.id,
        },
        {
          id: questionHandleId(question.id, "no"),
          label: "no",
          title: `${question.id} < ${question.threshold}`,
          questionId: question.id,
        },
      ];
  }
}

export function getSourceHandles(node: WorkflowNode): HandleDef[] {
  switch (node.type) {
    case "input":
    case "llm":
    case "web-search":
    case "fetch":
      return [{ id: OUT_HANDLE, label: "output", title: "Output text" }];
    case "jev":
      return [
        ...node.data.questions.flatMap(getQuestionHandles),
        {
          id: ANY_HANDLE,
          label: "always",
          title: "Fires on every run that reaches this node",
        },
      ];
    case "output":
      return [];
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Factories                                 */
/* -------------------------------------------------------------------------- */

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 32);
}

export function createQuestion(type: QuestionType, index: number): QuestionDef {
  const id = `question_${index}`;

  switch (type) {
    case "choice":
      return {
        id,
        type,
        instructions: "",
        options: [
          { key: "option_a", description: "" },
          { key: "option_b", description: "" },
        ],
      };
    case "score":
      return {
        id,
        type,
        instructions: "",
        levels: [
          { key: "low", description: "" },
          { key: "medium", description: "" },
          { key: "high", description: "" },
        ],
      };
    case "noul":
      return { id, type, instructions: "", threshold: DEFAULT_NOUL_THRESHOLD };
  }
}

export function createInputNode(args: {
  position: Point;
  sample?: string;
  selected?: boolean;
}): InputNode {
  return {
    id: INPUT_NODE_ID,
    type: "input",
    position: args.position,
    selected: args.selected,
    deletable: false,
    data: { label: "Input", sample: args.sample ?? "" },
  };
}

export function createJevNode(args: {
  id?: string;
  position: Point;
  label?: string;
  questions?: QuestionDef[];
  activation?: ActivationMode;
  selected?: boolean;
}): JevNode {
  return {
    id: args.id ?? `jev-${nanoid(8)}`,
    type: "jev",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Jev",
      questions: args.questions ?? [createQuestion("choice", 1)],
      activation: args.activation ?? "any",
    },
  };
}

export function createOutputNode(args: {
  position: Point;
  label?: string;
  activation?: ActivationMode;
  selected?: boolean;
  properties?: OutputProperty[];
}): OutputNode {
  return {
    id: OUTPUT_NODE_ID,
    type: "output",
    position: args.position,
    deletable: false,
    selected: args.selected,
    data: {
      label: args.label ?? "Output",
      activation: args.activation ?? "any",
      properties:
        args.properties ??
        DEFAULT_OUTPUT_PROPERTIES.map((property) => ({ ...property })),
    },
  };
}

export function createLlmNode(args: {
  id?: string;
  position: Point;
  label?: string;
  model?: string;
  system?: string;
  prompt?: string;
  activation?: ActivationMode;
  selected?: boolean;
}): LlmNode {
  return {
    id: args.id ?? `llm-${nanoid(8)}`,
    type: "llm",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "LLM",
      model: args.model ?? DEFAULT_LLM_MODEL,
      system: args.system ?? "",
      prompt: args.prompt ?? "{{input}}",
      activation: args.activation ?? "any",
    },
  };
}

export function createWebSearchNode(args: {
  id?: string;
  position: Point;
  label?: string;
  query?: string;
  maxResults?: number;
  activation?: ActivationMode;
  selected?: boolean;
}): WebSearchNode {
  return {
    id: args.id ?? `web-search-${nanoid(8)}`,
    type: "web-search",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Web search",
      query: args.query ?? "{{input}}",
      maxResults: args.maxResults ?? DEFAULT_WEB_SEARCH_RESULTS,
      activation: args.activation ?? "any",
    },
  };
}

export function createFetchNode(args: {
  id?: string;
  position: Point;
  label?: string;
  urls?: string;
  activation?: ActivationMode;
  selected?: boolean;
}): FetchNode {
  return {
    id: args.id ?? `fetch-${nanoid(8)}`,
    type: "fetch",
    position: args.position,
    selected: args.selected,
    data: {
      label: args.label ?? "Fetch",
      urls: args.urls ?? "{{input}}",
      activation: args.activation ?? "any",
    },
  };
}

/**
 * Unique http(s) URLs in `text`, in order of appearance. Trailing punctuation
 * and markdown link syntax are stripped.
 */
export function extractUrls(text: string, max: number): string[] {
  const urls = new Set<string>();

  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`)\]]+/g)) {
    urls.add(match[0].replace(/[.,;:!?]+$/, ""));

    if (urls.size >= max) {
      break;
    }
  }

  return [...urls];
}

export function createWorkflowEdge(args: {
  id?: string;
  source: string;
  sourceHandle: string;
  target: string;
  targetHandle?: string;
}): WorkflowEdge {
  return {
    id:
      args.id ??
      `e-${args.source}-${args.sourceHandle}-${args.target}-${nanoid(6)}`,
    type: WORKFLOW_EDGE_TYPE,
    source: args.source,
    sourceHandle: args.sourceHandle,
    target: args.target,
    targetHandle: args.targetHandle ?? IN_HANDLE,
    data: {},
  };
}

/* -------------------------------------------------------------------------- */
/*                                Graph helpers                               */
/* -------------------------------------------------------------------------- */

/**
 * Returns true if adding an edge from `source` to `target` would create a
 * cycle (i.e. `source` is reachable from `target`).
 */
export function wouldCreateCycle(
  edges: readonly WorkflowEdge[],
  source: string,
  target: string
): boolean {
  if (source === target) {
    return true;
  }

  const visited = new Set<string>();
  const stack = [target];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (current === source) {
      return true;
    }

    if (visited.has(current)) {
      continue;
    }

    visited.add(current);

    for (const edge of edges) {
      if (edge.source === current) {
        stack.push(edge.target);
      }
    }
  }

  return false;
}

/**
 * Ids of nodes reachable from the input node. Anything else never runs.
 */
export function getReachableNodeIds(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[]
): Set<string> {
  const reachable = new Set<string>();

  if (!nodes.some((node) => node.id === INPUT_NODE_ID)) {
    return reachable;
  }

  const stack = [INPUT_NODE_ID];

  while (stack.length > 0) {
    const current = stack.pop()!;

    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);

    for (const edge of edges) {
      if (edge.source === current) {
        stack.push(edge.target);
      }
    }
  }

  return reachable;
}

/**
 * Kahn's algorithm. Returns `null` if the graph contains a cycle.
 */
export function topologicalOrder(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[]
): WorkflowNode[] | null {
  const indegree = new Map<string, number>();
  const byId = new Map<string, WorkflowNode>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    byId.set(node.id, node);
  }

  for (const edge of edges) {
    if (indegree.has(edge.target) && byId.has(edge.source)) {
      indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
    }
  }

  const queue = nodes.filter((node) => indegree.get(node.id) === 0);
  const order: WorkflowNode[] = [];

  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);

    for (const edge of edges) {
      if (edge.source !== node.id) {
        continue;
      }

      const next = indegree.get(edge.target);

      if (next === undefined) {
        continue;
      }

      indegree.set(edge.target, next - 1);

      if (next - 1 === 0) {
        const target = byId.get(edge.target);

        if (target) {
          queue.push(target);
        }
      }
    }
  }

  return order.length === nodes.length ? order : null;
}

/* -------------------------------------------------------------------------- */
/*                                 Templating                                 */
/* -------------------------------------------------------------------------- */

export type AnswerValue = {
  // Human-readable value: the chosen option, the level key, or "yes"/"no".
  value: string;
  probability: number;
  confidence: number;
};

/**
 * Resolves `{{input}}`, `{{urls.<n>}}` (the nth http(s) URL in the input,
 * from 1), `{{answers.<id>}}`, `{{answers.<id>.probability}}` and
 * `{{answers.<id>.confidence}}`. Unknown placeholders resolve to "".
 */
export function renderTemplate(
  template: string,
  context: { input: string; answers: Record<string, AnswerValue> }
): string {
  return template.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, path: string) => {
    if (path === "input") {
      return context.input;
    }

    const [root, id, field] = path.split(".");

    // Lets parallel branches each pick one web search result, e.g. a Jev node
    // judging result 3 followed by a fetch of `{{urls.3}}`.
    if (root === "urls" && /^[1-9]\d*$/.test(id ?? "")) {
      const index = Number(id);
      return extractUrls(context.input, index)[index - 1] ?? "";
    }

    if (root !== "answers" || !id) {
      return "";
    }

    const answer = context.answers[id];

    if (!answer) {
      return "";
    }

    if (field === "probability") {
      return answer.probability.toFixed(2);
    }

    if (field === "confidence") {
      return answer.confidence.toFixed(2);
    }

    return answer.value;
  });
}

export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

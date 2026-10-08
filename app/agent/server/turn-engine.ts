import "server-only";

import { nanoid } from "nanoid";
import {
  runConversationTurn,
  runLlm,
  type AgentToolSpec,
  type ConversationLlmMessage,
} from "../../workflow/server/llm";
import { askJev, type JevState } from "../../workflow/server/typesafe";
import { fetchPages, webSearch } from "../../workflow/server/tinyfish";
import { liveblocks } from "../../workflow/server/liveblocks";
import {
  STATE_MESSAGE_ID,
  isConversationEvent,
  type AgentEvent,
  type ConversationEvent,
  type ConversationStateEvent,
  type ExtractionEvent,
  type GuardrailCheck,
  type JevEvent,
  type RoutingDetail,
  type StepEvent,
} from "../conversation";
import {
  evaluateRoutingRule,
  getActivation,
  slugify,
  truncate,
  type AgentEdge,
  type AgentGraphNode,
  type AgentNodeData,
  type DispositionsNodeData,
  type FetchStepData,
  type JevStepData,
  type LlmStepData,
  type ScenarioNodeData,
  type StartNodeData,
  type ToolboxNodeData,
  type WebSearchStepData,
} from "../shared";
import { readAgentGraph } from "./storage";
import {
  executeToolCall,
  transcriptOutputs,
  type ToolCache,
} from "./tools";
import {
  extractUrls,
  questionHandleId,
  renderTemplate,
  type AnswerValue,
  type QuestionDef,
} from "../../workflow/shared";
import type { Answer } from "../../workflow/runs";
import { createStartNode, createToolboxNode } from "../shared";

const TURN_TIMEOUT_MS = 90_000;
const STREAM_THROTTLE_MS = 150;
const MAX_HISTORY_MESSAGES = 24;
const MAX_TURNS = 40;
const KNOWLEDGE_CHAR_BUDGET = 4_000;
const KNOWLEDGE_SOURCE_CHAR_BUDGET = 2_000;
const TRANSCRIPT_TAIL_CHARS = 1_500;
const ROUTING_NONE = "none";

const OPT_OUT_THRESHOLD = 0.7;
const EXIT_THRESHOLD = 0.6;

/* -------------------------------------------------------------------------- */
/*                            Agent configuration                             */
/* -------------------------------------------------------------------------- */

type ScenarioEntry = { id: string; data: ScenarioNodeData };

type JevStepEntry = {
  id: string;
  data: JevStepData;
  // True when an answer handle is wired into a scenario: the node runs every
  // turn and its edges route the scenario explicitly. Unwired Jev nodes judge
  // the transcript at end of call and gate downstream steps.
  wiredToScenario: boolean;
};

type StepEntry =
  | { id: string; type: "llm"; data: LlmStepData }
  | { id: string; type: "web-search"; data: WebSearchStepData }
  | { id: string; type: "fetch"; data: FetchStepData };

type AgentConfig = {
  agent: AgentNodeData;
  start: StartNodeData;
  toolbox: ToolboxNodeData;
  scenarios: ScenarioEntry[];
  dispositions: { id: string; data: DispositionsNodeData }[];
  jevSteps: JevStepEntry[];
  steps: StepEntry[];
  edges: AgentEdge[];
};

function findNode<T extends AgentGraphNode["type"]>(
  nodes: AgentGraphNode[],
  type: T
): Extract<AgentGraphNode, { type: T }> | undefined {
  return nodes.find((node) => node.type === type) as
    | Extract<AgentGraphNode, { type: T }>
    | undefined;
}

async function loadAgentConfig(roomId: string): Promise<AgentConfig | null> {
  const { nodes, edges } = await readAgentGraph(roomId);

  const agentNode = findNode(nodes, "agent");
  const startNode = findNode(nodes, "start");

  if (!agentNode) {
    return null;
  }

  const jevSourceIds = new Set(
    edges
      .filter((edge) => scenarioIdsOf(nodes).has(edge.target))
      .map((edge) => edge.source)
  );

  // Multiple toolbox / dispositions nodes merge: tools and knowledge
  // concatenate, and each dispositions node runs its own judgment call.
  const toolboxNodes = nodes.filter(
    (node): node is Extract<AgentGraphNode, { type: "toolbox" }> =>
      node.type === "toolbox"
  );
  const toolbox: ToolboxNodeData = toolboxNodes.reduce<ToolboxNodeData>(
    (merged, node) => ({
      label: merged.label,
      tools: [...merged.tools, ...node.data.tools],
      knowledge: [...merged.knowledge, ...node.data.knowledge],
    }),
    createToolboxNode({ position: { x: 0, y: 0 } }).data
  );

  return {
    agent: agentNode.data,
    start: startNode
      ? startNode.data
      : createStartNode({ position: { x: 0, y: 0 } }).data,
    toolbox,
    dispositions: nodes
      .filter(
        (node): node is Extract<AgentGraphNode, { type: "dispositions" }> =>
          node.type === "dispositions"
      )
      .map((node) => ({ id: node.id, data: node.data })),
    scenarios: nodes
      .filter(
        (node): node is Extract<AgentGraphNode, { type: "scenario" }> =>
          node.type === "scenario"
      )
      .map((node) => ({ id: node.id, data: node.data })),
    jevSteps: nodes
      .filter(
        (node): node is Extract<AgentGraphNode, { type: "jev" }> =>
          node.type === "jev"
      )
      .map((node) => ({
        id: node.id,
        data: node.data,
        wiredToScenario: jevSourceIds.has(node.id),
      })),
    steps: nodes.flatMap((node): StepEntry[] => {
      if (node.type === "llm") {
        return [{ id: node.id, type: "llm", data: node.data }];
      }
      if (node.type === "web-search") {
        return [{ id: node.id, type: "web-search", data: node.data }];
      }
      if (node.type === "fetch") {
        return [{ id: node.id, type: "fetch", data: node.data }];
      }
      return [];
    }),
    edges,
  };
}

function scenarioIdsOf(nodes: AgentGraphNode[]): Set<string> {
  return new Set(
    nodes.filter((node) => node.type === "scenario").map((node) => node.id)
  );
}

/**
 * Picks which handle an answer fires, in the same shape as the workflow
 * executor's resolveAnswer (kept local: the executor's is not exported).
 */
function resolveAnswerHandles(
  question: QuestionDef,
  answer: Answer
): string {
  switch (answer.type) {
    case "choice":
      return answer.choice;
    case "score":
      return String(answer.level);
    case "noul":
      return answer.noul >= answer.threshold ? "yes" : "no";
  }
}

/* -------------------------------------------------------------------------- */
/*                             Feed writes (safe)                             */
/* -------------------------------------------------------------------------- */

async function safe<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (error) {
    console.error("Conversation feed write failed", error);
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
      // Pass the id so updates can target this exact message.
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

/* -------------------------------------------------------------------------- */
/*                           Conversation snapshots                           */
/* -------------------------------------------------------------------------- */

function initialState(): ConversationStateEvent {
  return {
    id: STATE_MESSAGE_ID,
    at: Date.now(),
    kind: "state",
    variables: {},
    activeScenarios: [],
    turn: 0,
    ended: false,
    disclosedAi: false,
    handoff: false,
    answers: {},
    jevFires: {},
    toolCache: {},
    knowledgeCache: {},
  };
}

async function loadConversation(
  roomId: string,
  conversationId: string
): Promise<{ events: ConversationEvent[]; state: ConversationStateEvent } | null> {
  let data: unknown;

  try {
    const response = await liveblocks.getFeedMessages({
      roomId,
      feedId: conversationId,
    });
    data = response.data;
  } catch (error) {
    console.error("Conversation read failed", error);
    return null;
  }

  if (!Array.isArray(data)) {
    return null;
  }

  const events = data
    .map((message) => (message as { data?: unknown }).data)
    .filter(isConversationEvent)
    .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));

  const state =
    ([...events]
      .reverse()
      .find((event): event is ConversationStateEvent => event.kind === "state") ??
      undefined) ?? initialState();

  return { events, state };
}

function transcriptOf(events: ConversationEvent[]): ConversationLlmMessage[] {
  return events.flatMap((event): ConversationLlmMessage[] => {
    if (event.kind === "user") {
      return [{ role: "user", content: event.text }];
    }

    if (event.kind === "agent" && event.text.trim() !== "") {
      return [{ role: "assistant", content: event.text }];
    }

    return [];
  });
}

function transcriptTail(
  events: ConversationEvent[],
  max = TRANSCRIPT_TAIL_CHARS
): string {
  return transcriptOf(events)
    .map((message) => `${message.role === "user" ? "Caller" : "Agent"}: ${message.content}`)
    .join("\n")
    .slice(-max);
}

/* -------------------------------------------------------------------------- */
/*                            Conversation lifecycle                          */
/* -------------------------------------------------------------------------- */

export async function startConversation(options: {
  roomId: string;
  opening?: string;
}): Promise<{ conversationId: string }> {
  const conversationId = `conv-${nanoid(10)}`;
  const opening = options.opening?.trim() ?? "";

  await safe(() =>
    liveblocks.createFeed({
      roomId: options.roomId,
      feedId: conversationId,
      metadata: {
        status: "running",
        trigger: "test",
        input: truncate(opening || "(new conversation)", 200),
        startedAt: String(Date.now()),
      },
    })
  );

  await safe(() =>
    liveblocks.createFeedMessage({
      roomId: options.roomId,
      feedId: conversationId,
      id: STATE_MESSAGE_ID,
      data: initialState() as never,
    })
  );

  // An opening caller message runs a full first turn; without one the agent
  // speaks first (its greeting).
  await processTurn({
    roomId: options.roomId,
    conversationId,
    text: opening || null,
  });

  return { conversationId };
}

export type TurnResult = {
  reply: string;
  ended: boolean;
  error?: string;
};

/**
 * Runs one conversation turn:
 * user message → guardrails + scenario routing (one batched Jev call) →
 * knowledge → reply with tools (function calling) → variable extraction →
 * exit checks → dispositions when the conversation ends.
 */
export async function processTurn(options: {
  roomId: string;
  conversationId: string;
  text?: string | null;
  end?: boolean;
}): Promise<TurnResult> {
  const abort = new AbortController();
  const timeout = setTimeout(() => abort.abort(), TURN_TIMEOUT_MS);

  try {
    return await runTurn(options, abort.signal);
  } finally {
    clearTimeout(timeout);
  }
}

async function runTurn(
  options: {
    roomId: string;
    conversationId: string;
    text?: string | null;
    end?: boolean;
  },
  signal: AbortSignal
): Promise<TurnResult> {
  const { roomId, conversationId } = options;
  const config = await loadAgentConfig(roomId);

  if (!config) {
    return { reply: "", ended: false, error: "This agent has no agent node." };
  }

  const snapshot = await loadConversation(roomId, conversationId);

  if (!snapshot) {
    return { reply: "", ended: false, error: "Conversation not found." };
  }

  const state = snapshot.state;

  if (state.ended) {
    return { reply: "", ended: true };
  }

  const text = options.text?.trim() ?? "";
  const turn = state.turn + 1;

  if (options.end) {
    await finalizeConversation(roomId, conversationId, config, snapshot.events, {
      ...state,
      turn,
    });
    return { reply: "", ended: true };
  }

  if (turn > MAX_TURNS) {
    await finalizeConversation(roomId, conversationId, config, snapshot.events, {
      ...state,
      turn,
    });
    return { reply: "", ended: true, error: `Conversation hit the ${MAX_TURNS}-turn limit.` };
  }

  const variables: Record<string, string> = { ...state.variables };
  const activeScenarios = new Set(state.activeScenarios);
  const toolCache: ToolCache = { ...state.toolCache };
  const knowledgeCache: Record<string, string> = { ...state.knowledgeCache };
  const guardrailChecks: GuardrailCheck[] = [];

  if (text !== "") {
    await writeEvent(roomId, conversationId, {
      id: `user-${nanoid(8)}`,
      at: Date.now(),
      kind: "user",
      text,
    });
  }

  const history = transcriptOf(snapshot.events);
  const lastUserText = text !== "" ? text : [...history].reverse().find((m) => m.role === "user")?.content ?? "";
  const tailBefore = transcriptTail(snapshot.events);

  /* ------------------------- Routing and guardrails ----------------------- */

  const routingDetails: RoutingDetail[] = [];
  let routingQuestions: QuestionDef[] = [];

  // Jev nodes wired into scenarios run every turn (explicit routing); their
  // answers also feed {{answers.*}} templates and gate end-of-call steps.
  const routingJevSteps = config.jevSteps.filter(
    (step) => step.wiredToScenario && step.data.questions.length > 0
  );
  const scenarioIds = new Set(config.scenarios.map((scenario) => scenario.id));
  const explicitScenarioIds = new Set(
    config.edges
      .filter((edge) => scenarioIds.has(edge.target))
      .map((edge) => edge.target)
  );
  const turnAnswers: Record<string, AnswerValue> = { ...state.answers };
  const jevFires: Record<string, string[]> = { ...state.jevFires };

  const pendingScenarios = config.scenarios.filter(
    (scenario) =>
      scenario.data.routing.mode === "ai_decides" &&
      !activeScenarios.has(scenario.id) &&
      !explicitScenarioIds.has(scenario.id) &&
      scenario.data.routing.description.trim() !== ""
  );
  const exitingScenarios = config.scenarios.filter(
    (scenario) =>
      activeScenarios.has(scenario.id) &&
      scenario.data.exitCondition.trim() !== ""
  );

  if (config.agent.guardrails.optOut && lastUserText !== "") {
    routingQuestions.push({
      id: "opt_out",
      type: "noul",
      instructions:
        "The caller clearly asked to stop being contacted, opted out of calls, or demanded the call end immediately.",
      threshold: OPT_OUT_THRESHOLD,
    });
  }

  if (
    config.agent.guardrails.aiDisclosure.enabled &&
    !state.disclosedAi &&
    turn > 1
  ) {
    routingQuestions.push({
      id: "ai_disclosed",
      type: "noul",
      instructions:
        "At some point so far in this conversation, has the assistant already clearly said that it is an AI or automated assistant?",
      threshold: 0.6,
    });
  }

  if (pendingScenarios.length > 0) {
    routingQuestions.push({
      id: "scenario_routing",
      type: "choice",
      instructions:
        "Which kind of job does this turn of the conversation call for? Judge from the latest exchange.",
      options: [
        ...pendingScenarios.map((scenario) => ({
          key: scenario.id,
          description:
            scenario.data.routing.mode === "ai_decides"
              ? scenario.data.routing.description
              : "",
        })),
        { key: ROUTING_NONE, description: "None of these: ordinary conversation for the main agent." },
      ],
    });
  }

  for (const scenario of exitingScenarios) {
    routingQuestions.push({
      id: `exit_${scenario.id}`,
      type: "noul",
      instructions: `The scenario "${scenario.data.label}" is finished once: ${scenario.data.exitCondition}. Judging the conversation so far, has that been achieved?`,
      threshold: EXIT_THRESHOLD,
    });
  }

  for (const step of routingJevSteps) {
    for (const question of step.data.questions) {
      routingQuestions.push({
        ...question,
        id: `${step.id}::${question.id}`,
      });
    }
  }

  // Deterministic condition routing runs alongside the Jev batch.
  for (const scenario of config.scenarios) {
    if (scenario.data.routing.mode !== "conditions" || activeScenarios.has(scenario.id)) {
      continue;
    }

    const entered = scenario.data.routing.rules.every((rule) =>
      evaluateRoutingRule(rule, variables)
    );

    if (entered && scenario.data.routing.rules.length > 0) {
      activeScenarios.add(scenario.id);
      routingDetails.push({
        scenarioId: scenario.id,
        scenarioLabel: scenario.data.label,
        answer: "conditions",
        probability: 1,
      });
    }
  }

  let jevMock: boolean | undefined;

  if (routingQuestions.length > 0 && lastUserText !== "") {
    const jevState: JevState = {
      input: lastUserText,
      conversation: tailBefore.slice(-800),
      ...Object.fromEntries(
        Object.entries(variables).map(([key, value]) => [slugify(key), value])
      ),
    };

    const result = await askJev(
      { label: "routing", questions: routingQuestions },
      jevState
    );
    jevMock = result.mock;

    const routing = result.answers["scenario_routing"];

    if (routing?.type === "choice" && routing.choice !== ROUTING_NONE) {
      const scenario = config.scenarios.find((entry) => entry.id === routing.choice);

      if (scenario && !activeScenarios.has(scenario.id)) {
        activeScenarios.add(scenario.id);
        routingDetails.push({
          scenarioId: scenario.id,
          scenarioLabel: scenario.data.label,
          answer: routing.choice,
          probability: routing.probabilities[routing.choice] ?? 0,
        });
      }
    }

    for (const scenario of exitingScenarios) {
      const answer = result.answers[`exit_${scenario.id}`];

      if (
        answer?.type === "noul" &&
        answer.noul >= EXIT_THRESHOLD &&
        activeScenarios.has(scenario.id)
      ) {
        activeScenarios.delete(scenario.id);
        routingDetails.push({
          scenarioId: scenario.id,
          scenarioLabel: scenario.data.label,
          answer: "exit",
          probability: answer.noul,
        });
      }
    }

    // Explicit routing: wired Jev answer handles fire into scenarios.
    for (const step of routingJevSteps) {
      const nodeAnswers: Record<string, Answer> = {};
      const fires = new Set<string>(["any"]);

      for (const question of step.data.questions) {
        const answer = result.answers[`${step.id}::${question.id}`];

        if (!answer) {
          continue;
        }

        nodeAnswers[question.id] = answer;
        fires.add(
          questionHandleId(question.id, resolveAnswerHandles(question, answer))
        );
        turnAnswers[question.id] = answerValueOf(question, answer);
      }

      jevFires[step.id] = [...fires];

      if (Object.keys(nodeAnswers).length > 0) {
        const event: JevEvent = {
          id: `jev-${step.id}-${nanoid(6)}`,
          at: Date.now(),
          kind: "jev",
          nodeId: step.id,
          phase: "turn",
          answers: nodeAnswers,
          mock: result.mock,
        };
        await writeEvent(roomId, conversationId, event);
      }
    }

    for (const edge of config.edges) {
      if (!scenarioIds.has(edge.target) || activeScenarios.has(edge.target)) {
        continue;
      }

      const fires = jevFires[edge.source];
      const scenario = config.scenarios.find(
        (entry) => entry.id === edge.target
      );

      if (fires?.includes(edge.sourceHandle ?? "any") && scenario) {
        activeScenarios.add(scenario.id);
        routingDetails.push({
          scenarioId: scenario.id,
          scenarioLabel: scenario.data.label,
          answer: edge.sourceHandle ?? "any",
          probability: 1,
        });
      }
    }

    const optOut = result.answers["opt_out"];

    if (optOut?.type === "noul" && optOut.noul >= OPT_OUT_THRESHOLD) {
      guardrailChecks.push({
        id: "opt_out",
        pass: true,
        detail: "Caller opted out: conversation ended immediately.",
      });
      await writeGuardrails(roomId, conversationId, guardrailChecks);
      await writeEvent(roomId, conversationId, {
        id: `agent-${nanoid(8)}`,
        at: Date.now(),
        kind: "agent",
        text: "Understood — I'll let you go. Sorry for the trouble, and I won't call again.",
      });
      await finalizeConversation(roomId, conversationId, config, snapshot.events, {
        ...state,
        turn,
        activeScenarios: [...activeScenarios],
        variables,
        toolCache,
        knowledgeCache,
      });
      return {
        reply: "Understood — I'll let you go. Sorry for the trouble, and I won't call again.",
        ended: true,
      };
    }

    const disclosed = result.answers["ai_disclosed"];

    if (disclosed?.type === "noul" && disclosed.noul >= 0.6) {
      state.disclosedAi = true;
      guardrailChecks.push({
        id: "ai_disclosure",
        pass: turn <= config.agent.guardrails.aiDisclosure.withinTurns,
        detail: `AI disclosure appeared by turn ${turn}.`,
      });
    }
  }

  if (
    config.agent.guardrails.aiDisclosure.enabled &&
    !state.disclosedAi &&
    guardrailChecks.every((check) => check.id !== "ai_disclosure")
  ) {
    guardrailChecks.push({
      id: "ai_disclosure",
      pass: false,
      detail: `Not yet disclosed (window: ${config.agent.guardrails.aiDisclosure.withinTurns} turns).`,
    });
  }

  await writeGuardrails(roomId, conversationId, guardrailChecks);

  const enteredIds = routingDetails
    .filter((detail) => detail.answer !== "exit")
    .map((detail) => detail.scenarioId);
  const exitedIds = routingDetails
    .filter((detail) => detail.answer === "exit")
    .map((detail) => detail.scenarioId);

  if (routingDetails.length > 0) {
    await writeEvent(roomId, conversationId, {
      id: `routing-${nanoid(8)}`,
      at: Date.now(),
      kind: "routing",
      entered: enteredIds,
      exited: exitedIds,
      active: [...activeScenarios],
      detail: routingDetails,
      mock: jevMock,
    });
  }

  const activeScenarioEntries = config.scenarios.filter((scenario) =>
    activeScenarios.has(scenario.id)
  );

  /* -------------------------------- Knowledge ----------------------------- */

  const knowledge = await loadKnowledge(config, knowledgeCache, signal);

  /* ------------------------------- Compose reply -------------------------- */

  let ended = false;
  let handoff = false;

  const system = composeSystemPrompt({
    config,
    activeScenarios: activeScenarioEntries.map((entry) => entry.data),
    variables,
    knowledge,
    discloseAi:
      config.agent.guardrails.aiDisclosure.enabled && !state.disclosedAi,
  });

  const messages: ConversationLlmMessage[] = [
    ...history.slice(-MAX_HISTORY_MESSAGES),
    ...(text !== "" ? [{ role: "user" as const, content: text }] : []),
  ];

  const tools = buildToolSpecs({
    config,
    activeScenarioIds: [...activeScenarios],
    variables,
    toolCache,
    roomId,
    conversationId,
    signal,
    onEnded: () => {
      ended = true;
    },
    onHandoff: () => {
      handoff = true;
    },
  });

  const agentEventId = `agent-${nanoid(8)}`;
  const agentEvent: AgentEvent = {
    id: agentEventId,
    at: Date.now(),
    kind: "agent",
    text: "",
  };
  const agentMessageId = await writeEvent(roomId, conversationId, agentEvent);

  let lastWrite = 0;
  let pending: Promise<unknown> = Promise.resolve();

  const result = await runConversationTurn({
    system,
    messages,
    model: config.agent.model,
    sessionId: conversationId,
    tools,
    signal,
    onChunk: (partial) => {
      const now = Date.now();

      if (now - lastWrite < STREAM_THROTTLE_MS) {
        return;
      }

      lastWrite = now;
      pending = pending.then(() =>
        updateEvent(
          roomId,
          conversationId,
          agentMessageId,
          { ...agentEvent, text: partial }
        )
      );
    },
  });

  await pending;
  await updateEvent(roomId, conversationId, agentMessageId, {
    ...agentEvent,
    text: result.text || "(no reply)",
    mock: result.mock,
    model: result.model,
    usage: result.usage,
  });

  /* ------------------------------- Extraction ----------------------------- */

  const extractionTargets = dedupeVariables([
    ...config.agent.variables,
    ...activeScenarioEntries.flatMap((entry) => entry.data.variables),
  ]);

  let extractionMock: boolean | undefined;
  const changed: string[] = [];

  if (extractionTargets.length > 0 && text !== "") {
    const extraction = await extractVariables({
      targets: extractionTargets,
      variables,
      exchange: `${lastUserText}\nAgent: ${result.text}`,
      model: config.agent.model,
      sessionId: conversationId,
      signal,
    });
    extractionMock = extraction.mock;

    for (const [name, value] of Object.entries(extraction.values)) {
      if (variables[name] !== value) {
        changed.push(name);
      }
      variables[name] = value;
    }
  }

  if (changed.length > 0) {
    const event: ExtractionEvent = {
      id: `extraction-${nanoid(8)}`,
      at: Date.now(),
      kind: "extraction",
      variables: { ...variables },
      changed,
      mock: extractionMock,
    };
    await writeEvent(roomId, conversationId, event);
  }

  /* ------------------------------ Wrap the turn --------------------------- */

  const nextState: ConversationStateEvent = {
    ...state,
    at: Date.now(),
    turn,
    variables,
    activeScenarios: [...activeScenarios],
    answers: turnAnswers,
    jevFires,
    toolCache,
    knowledgeCache,
    disclosedAi: state.disclosedAi,
    handoff: handoff || state.handoff,
    ended,
  };

  if (ended) {
    // Re-read events so finalization sees this turn's messages.
    const fresh = await loadConversation(roomId, conversationId);
    await finalizeConversation(
      roomId,
      conversationId,
      config,
      fresh?.events ?? snapshot.events,
      nextState
    );
  } else {
    await updateEvent(roomId, conversationId, STATE_MESSAGE_ID, nextState);
  }

  return { reply: result.text, ended };
}

async function writeGuardrails(
  roomId: string,
  conversationId: string,
  checks: GuardrailCheck[]
): Promise<void> {
  if (checks.length === 0) {
    return;
  }

  await writeEvent(roomId, conversationId, {
    id: `guardrail-${nanoid(8)}`,
    at: Date.now(),
    kind: "guardrail",
    checks,
  });
}

/* -------------------------------------------------------------------------- */
/*                                  Knowledge                                 */
/* -------------------------------------------------------------------------- */

async function loadKnowledge(
  config: AgentConfig,
  cache: Record<string, string>,
  signal: AbortSignal
): Promise<string> {
  const attached = config.toolbox.knowledge.filter(
    (source) => source.attached && source.source.trim() !== ""
  );
  const blocks: string[] = [];
  let budget = KNOWLEDGE_CHAR_BUDGET;

  for (const source of attached) {
    if (budget <= 0) {
      break;
    }

    let text = source.source;

    if (source.type === "url") {
      if (!cache[source.id]) {
        try {
          const result = await fetchPages({ urls: [source.source], signal });
          cache[source.id] = truncate(result.text, KNOWLEDGE_SOURCE_CHAR_BUDGET);
        } catch {
          cache[source.id] = "";
        }
      }

      text = cache[source.id];
    }

    if (text.trim() === "") {
      continue;
    }

    const slice = truncate(text, Math.min(KNOWLEDGE_SOURCE_CHAR_BUDGET, budget));
    budget -= slice.length;
    blocks.push(`### ${source.name || "Source"}\n${slice}`);
  }

  return blocks.join("\n\n");
}

/* -------------------------------------------------------------------------- */
/*                               Prompt composition                           */
/* -------------------------------------------------------------------------- */

function composeSystemPrompt(args: {
  config: AgentConfig;
  activeScenarios: ScenarioNodeData[];
  variables: Record<string, string>;
  knowledge: string;
  discloseAi: boolean;
}): string {
  const { config } = args;
  const parts: string[] = [];

  if (config.agent.systemPrompt.trim() !== "") {
    parts.push(config.agent.systemPrompt.trim());
  }

  if (config.agent.taskPrompt.trim() !== "") {
    parts.push(`## Your job on this call\n${config.agent.taskPrompt.trim()}`);
  }

  for (const scenario of args.activeScenarios) {
    if (scenario.prompt.trim() !== "") {
      parts.push(
        `## Active scenario: ${scenario.label}\nFollow these instructions for as long as this scenario applies.\n${scenario.prompt.trim()}`
      );
    }
  }

  if (args.discloseAi) {
    parts.push(
      "## Required this turn\nBefore finishing this reply, naturally mention that you are an AI assistant."
    );
  }

  if (config.agent.guardrails.optOut) {
    parts.push(
      "If the caller asks you to stop contacting them, apologize in one short line and end the call."
    );
  }

  if (config.agent.endCallTool) {
    parts.push(
      "When the call has reached its natural end (task done, or the caller says goodbye), call the end_conversation tool instead of dragging the conversation on."
    );
  }

  if (config.agent.handoffTool) {
    parts.push(
      "If a human needs to take over, say so briefly and call the handoff tool."
    );
  }

  const scope: Record<string, string> = {};

  for (const entry of config.start.requestData) {
    if (entry.key.trim() !== "") {
      scope[entry.key.trim()] = entry.value;
    }
  }

  Object.assign(scope, args.variables);

  if (Object.keys(scope).length > 0) {
    const lines = Object.entries(scope)
      .map(([key, value]) => `- ${key}: ${value === "" ? "(unknown)" : value}`)
      .join("\n");
    parts.push(`## Facts known so far\n${lines}`);
  }

  if (args.knowledge !== "") {
    parts.push(`## Knowledge you can use\n${args.knowledge}`);
  }

  return parts.join("\n\n");
}

/* -------------------------------------------------------------------------- */
/*                                   Tools                                    */
/* -------------------------------------------------------------------------- */

function buildToolSpecs(args: {
  config: AgentConfig;
  activeScenarioIds: string[];
  variables: Record<string, string>;
  toolCache: ToolCache;
  roomId: string;
  conversationId: string;
  signal: AbortSignal;
  onEnded: () => void;
  onHandoff: () => void;
}): AgentToolSpec[] {
  const specs: AgentToolSpec[] = [];
  const registry = new Map(
    args.config.toolbox.tools
      .filter((tool) => tool.name.trim() !== "")
      .map((tool) => [tool.id, tool])
  );

  // While a scenario lists tools, those replace the default set.
  const scenarioToolIds = args.config.scenarios
    .filter((scenario) => args.activeScenarioIds.includes(scenario.id))
    .flatMap((scenario) => scenario.data.toolIds);

  const available =
    scenarioToolIds.length > 0
      ? scenarioToolIds
          .map((id) => registry.get(id))
          .filter((tool): tool is NonNullable<typeof tool> => tool !== undefined)
      : [...registry.values()];

  const scope: Record<string, unknown> = {};

  for (const entry of args.config.start.requestData) {
    if (entry.key.trim() !== "") {
      scope[entry.key.trim()] = entry.value;
    }
  }

  Object.assign(scope, args.variables);

  for (const tool of available) {
    specs.push({
      name: tool.name.trim().replace(/\s+/g, "_"),
      description:
        tool.description.trim() !== ""
          ? tool.description
          : `Call ${tool.name}.`,
      inputSchema: toolInputSchemaOf(tool),
      execute: async (callArgs) => {
        const eventId = `tool-${nanoid(8)}`;
        const startedAt = Date.now();

        await writeEvent(args.roomId, args.conversationId, {
          id: eventId,
          at: startedAt,
          kind: "tool",
          toolId: tool.id,
          toolName: tool.name,
          status: "running",
          speech: tool.agentSpeech || undefined,
          args: callArgs,
        });

        const outcome = await executeToolCall({
          tool,
          args: callArgs,
          scope,
          cache: args.toolCache,
          signal: args.signal,
        });

        if (outcome.status === "complete") {
          await updateEvent(args.roomId, args.conversationId, eventId, {
            id: eventId,
            at: startedAt,
            kind: "tool",
            toolId: tool.id,
            toolName: tool.name,
            status: "complete",
            speech: tool.agentSpeech || undefined,
            args: callArgs,
            outputs: transcriptOutputs(tool, outcome.outputs),
            durationMs: Date.now() - startedAt,
          });

          return outcome.outputs;
        }

        await updateEvent(args.roomId, args.conversationId, eventId, {
          id: eventId,
          at: startedAt,
          kind: "tool",
          toolId: tool.id,
          toolName: tool.name,
          status: "error",
          speech: tool.agentSpeech || undefined,
          args: callArgs,
          error: outcome.error,
          durationMs: Date.now() - startedAt,
        });

        return { error: outcome.error };
      },
    });
  }

  if (args.config.agent.endCallTool) {
    specs.push({
      name: "end_conversation",
      description:
        "End the call politely. Use once the task is done or the caller is saying goodbye. Say a one-line wrap-up in the same reply.",
      inputSchema: {
        type: "object",
        properties: {
          reason: {
            type: "string",
            description: "One short line on why the call is ending.",
          },
        },
      },
      execute: async () => {
        args.onEnded();
        return { ended: true };
      },
    });
  }

  if (args.config.agent.handoffTool) {
    specs.push({
      name: "handoff",
      description:
        "Flag this conversation for a human to take over or follow up. Say that someone will reach out.",
      inputSchema: {
        type: "object",
        properties: {
          note: { type: "string", description: "What the human needs to know." },
        },
        required: ["note"],
      },
      execute: async () => {
        args.onHandoff();
        return { handoff: true };
      },
    });
  }

  // Research tools carried over from the workflow builder (TinyFish).
  if (args.config.agent.webSearchTool ?? true) {
    specs.push({
      name: "web_search",
      description:
        "Search the web for current information. Returns a numbered list of titles, URLs and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "What to search for." },
        },
        required: ["query"],
      },
      execute: async (callArgs) => {
        const query = String(callArgs.query ?? "").trim();

        if (query === "") {
          return { error: "query is required" };
        }

        const result = await webSearch({
          query,
          maxResults: 5,
          signal: args.signal,
        });
        return { results: result.text, mock: result.mock };
      },
    });
  }

  if (args.config.agent.fetchPageTool ?? false) {
    specs.push({
      name: "fetch_page",
      description:
        "Fetch one web page and return its content as markdown. Use a URL from web_search or the conversation.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full http(s) URL to fetch." },
        },
        required: ["url"],
      },
      execute: async (callArgs) => {
        const url = String(callArgs.url ?? "").trim();

        if (!/^https?:\/\//.test(url)) {
          return { error: "a valid http(s) url is required" };
        }

        const result = await fetchPages({ urls: [url], signal: args.signal });
        return { page: result.text, mock: result.mock };
      },
    });
  }

  return specs;
}

function toolInputSchemaOf(tool: {
  inputs: { name: string; instructions: string; type: "string" | "number" | "boolean"; required: boolean }[];
}): {
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

/* -------------------------------------------------------------------------- */
/*                                 Extraction                                 */
/* -------------------------------------------------------------------------- */

function dedupeVariables(
  variables: { id: string; name: string; type: string; prompt: string }[]
) {
  const byName = new Map<string, { id: string; name: string; type: string; prompt: string }>();

  for (const variable of variables) {
    if (variable.name.trim() !== "" && !byName.has(variable.name)) {
      byName.set(variable.name, variable);
    }
  }

  return [...byName.values()];
}

async function extractVariables(args: {
  targets: { name: string; type: string; prompt: string }[];
  variables: Record<string, string>;
  exchange: string;
  model: string;
  sessionId: string;
  signal: AbortSignal;
}): Promise<{ values: Record<string, string>; mock: boolean }> {
  const result = await runLlm({
    system: [
      "You extract variables from a phone conversation exchange.",
      "Reply with ONLY a JSON object mapping each variable name to its value taken from the exchange.",
      'Use "" when the exchange does not reveal it. Never guess, never invent.',
    ].join(" "),
    prompt: JSON.stringify({
      variables: args.targets.map((target) => ({
        name: target.name,
        type: target.type,
        how_to_extract: target.prompt,
        current_value: args.variables[target.name] ?? "",
      })),
      exchange: args.exchange,
    }),
    model: args.model,
    sessionId: args.sessionId,
    signal: args.signal,
    onChunk: () => {},
  });

  if (result.mock) {
    return { values: mockExtract(args.targets, args.exchange), mock: true };
  }

  const values: Record<string, string> = {};

  try {
    const start = result.text.indexOf("{");
    const end = result.text.lastIndexOf("}");
    const parsed = JSON.parse(result.text.slice(start, end + 1)) as Record<
      string,
      unknown
    >;

    for (const target of args.targets) {
      const value = parsed[target.name];

      if (
        value !== undefined &&
        value !== null &&
        ["string", "number", "boolean"].includes(typeof value)
      ) {
        values[target.name] = String(value);
      }
    }
  } catch {
    // Malformed JSON: keep the previous values.
  }

  return { values, mock: false };
}

/**
 * Keyless heuristic: catches names and simple counts well enough to demo the
 * variables panel without an API key.
 */
function mockExtract(
  targets: { name: string; prompt: string }[],
  exchange: string
): Record<string, string> {
  const values: Record<string, string> = {};

  for (const target of targets) {
    const name = target.name.toLowerCase();

    if (name.includes("name")) {
      const match = exchange.match(
        /(?:my name is|this is|i'm|i am|speaking,?)\s+([A-Z][a-zA-Z]+)/
      );
      if (match) {
        values[target.name] = match[1];
      }
    } else if (name.includes("count") || name.includes("number")) {
      const match = exchange.match(/(\d{1,4})\s*(?:trucks|power units|units|drivers)/i);
      if (match) {
        values[target.name] = match[1];
      }
    }
  }

  return values;
}

/* -------------------------------------------------------------------------- */
/*                                Finalization                                */
/* -------------------------------------------------------------------------- */

function answerValueOf(question: QuestionDef, answer: Answer): AnswerValue {
  switch (answer.type) {
    case "choice":
      return {
        value: answer.choice,
        probability: answer.probabilities[answer.choice] ?? 0,
        confidence: answer.confidence,
      };
    case "score":
      return {
        value: String(answer.level),
        probability: answer.probabilities[String(answer.level)] ?? 0,
        confidence: answer.confidence,
      };
    case "noul": {
      const yes = answer.noul >= answer.threshold;
      return {
        value: yes ? "yes" : "no",
        probability: answer.noul,
        confidence: Math.abs(answer.noul - 0.5) * 2,
      };
    }
  }
}

async function finalizeConversation(
  roomId: string,
  conversationId: string,
  config: AgentConfig,
  events: ConversationEvent[],
  state: ConversationStateEvent
): Promise<void> {
  const tail = transcriptTail(events, 3_000);

  for (const dispositions of config.dispositions) {
    if (dispositions.data.questions.length === 0) {
      continue;
    }

    const jevState: JevState = {
      input: tail,
      ...Object.fromEntries(
        Object.entries(state.variables).map(([key, value]) => [slugify(key), value])
      ),
    };

    const result = await askJev(
      { label: "dispositions", questions: dispositions.data.questions },
      jevState
    );

    await writeEvent(roomId, conversationId, {
      id: `disposition-${dispositions.id}-${nanoid(6)}`,
      at: Date.now(),
      kind: "disposition",
      nodeId: dispositions.id,
      answers: result.answers,
      mock: result.mock,
    });
  }

  await runEndOfCallSteps({
    roomId,
    conversationId,
    config,
    transcript: tail,
    variables: state.variables,
    answers: state.answers,
    jevFires: state.jevFires,
  });

  await updateEvent(roomId, conversationId, STATE_MESSAGE_ID, {
    ...state,
    at: Date.now(),
    ended: true,
  });

  await safe(() =>
    liveblocks.updateFeed({
      roomId,
      feedId: conversationId,
      metadata: {
        status: "complete",
        trigger: "test",
        input: truncate(tail.split("\n")[0] || "(conversation)", 200),
        startedAt: String(events[0]?.at ?? Date.now()),
        completedAt: String(Date.now()),
      },
    })
  );
}

/**
 * Runs the canvas's end-of-call subgraph: unwired Jev nodes judge the
 * transcript, then LLM / web search / fetch steps run in topological order,
 * gated by their incoming edges (a Jev answer handle, or another step). This
 * is the drayage-workflow pattern (jev judges → note writers → outputs)
 * re-expressed as post-call processing of a live conversation.
 */
async function runEndOfCallSteps(args: {
  roomId: string;
  conversationId: string;
  config: AgentConfig;
  transcript: string;
  variables: Record<string, string>;
  answers: Record<string, AnswerValue>;
  jevFires: Record<string, string[]>;
}): Promise<void> {
  const endJev = args.config.jevSteps.filter(
    (step) => !step.wiredToScenario && step.data.questions.length > 0
  );

  if (endJev.length === 0 && args.config.steps.length === 0) {
    return;
  }

  const answers: Record<string, AnswerValue> = { ...args.answers };
  const fired = new Map<string, Set<string>>();
  const outputs = new Map<string, string>();

  // Per-turn Jev nodes: their latest fires gate downstream steps.
  for (const [nodeId, fires] of Object.entries(args.jevFires)) {
    fired.set(nodeId, new Set(fires));
    outputs.set(nodeId, args.transcript);
  }

  // One batched judgment call for all end-of-call Jev nodes.
  if (endJev.length > 0) {
    const questions: QuestionDef[] = [];

    for (const step of endJev) {
      for (const question of step.data.questions) {
        questions.push({ ...question, id: `${step.id}::${question.id}` });
      }
    }

    const result = await askJev(
      { label: "end-of-call", questions },
      {
        input: args.transcript,
        ...Object.fromEntries(
          Object.entries(args.variables).map(([key, value]) => [
            slugify(key),
            value,
          ])
        ),
      }
    );

    for (const step of endJev) {
      const nodeAnswers: Record<string, Answer> = {};
      const fires = new Set<string>(["any"]);

      for (const question of step.data.questions) {
        const answer = result.answers[`${step.id}::${question.id}`];

        if (!answer) {
          continue;
        }

        nodeAnswers[question.id] = answer;
        fires.add(
          questionHandleId(question.id, resolveAnswerHandles(question, answer))
        );
        answers[question.id] = answerValueOf(question, answer);
      }

      fired.set(step.id, fires);
      outputs.set(step.id, args.transcript);

      if (Object.keys(nodeAnswers).length > 0) {
        await writeEvent(args.roomId, args.conversationId, {
          id: `jev-${step.id}-${nanoid(6)}`,
          at: Date.now(),
          kind: "jev",
          nodeId: step.id,
          phase: "end",
          answers: nodeAnswers,
          mock: result.mock,
        });
      }
    }
  }

  if (args.config.steps.length === 0) {
    return;
  }

  // Edges between judgment sources (Jev nodes) and steps, or step → step.
  const stepIds = new Set(args.config.steps.map((step) => step.id));
  const judgmentIds = new Set([...fired.keys()]);
  const relevantEdges = args.config.edges.filter(
    (edge) =>
      stepIds.has(edge.target) &&
      (judgmentIds.has(edge.source) || stepIds.has(edge.source))
  );
  // Judgment sources sit outside the step subgraph, so only step → step edges
  // count towards ordering; judgment edges are gating inputs, available from
  // the start.
  const stepToStepEdges = relevantEdges.filter((edge) =>
    stepIds.has(edge.source)
  );

  // Kahn topological order over the step subgraph.
  const indegree = new Map<string, number>(
    args.config.steps.map((step) => [step.id, 0])
  );

  for (const edge of stepToStepEdges) {
    indegree.set(edge.target, (indegree.get(edge.target) ?? 0) + 1);
  }

  const byId = new Map(args.config.steps.map((step) => [step.id, step]));
  const queue = args.config.steps.filter(
    (step) => indegree.get(step.id) === 0
  );
  const order: StepEntry[] = [];

  while (queue.length > 0) {
    const step = queue.shift()!;
    order.push(step);

    for (const edge of stepToStepEdges) {
      if (edge.source !== step.id) {
        continue;
      }

      const next = (indegree.get(edge.target) ?? 1) - 1;
      indegree.set(edge.target, next);

      if (next === 0) {
        const target = byId.get(edge.target);

        if (target) {
          queue.push(target);
        }
      }
    }
  }

  const results = new Map<string, Promise<{ output: string; ran: boolean }>>();

  for (const step of order) {
    results.set(
      step.id,
      executeStep(step).catch(() => ({ output: "", ran: false }))
    );
  }

  async function executeStep(step: StepEntry): Promise<{ output: string; ran: boolean }> {
    const incoming = relevantEdges.filter((edge) => edge.target === step.id);
    const firedTexts: string[] = [];
    let firedCount = 0;

    for (const edge of incoming) {
      let isFired = false;
      let text = "";

      if (stepIds.has(edge.source)) {
        const parent = await results.get(edge.source);
        isFired = parent?.ran === true && (edge.sourceHandle ?? "out") === "out";
        text = parent?.output ?? "";
      } else {
        isFired =
          fired.get(edge.source)?.has(edge.sourceHandle ?? "any") ?? false;
        text = outputs.get(edge.source) ?? "";
      }

      if (isFired) {
        firedCount++;
        if (text !== "") {
          firedTexts.push(text);
        }
      }
    }

    const requireAll = getActivation(step.data) === "all";

    // Root steps (no incoming edges) run unconditionally, like the workflow
    // builder's input-less nodes; otherwise at least one handle must fire.
    if (
      (incoming.length > 0 && firedCount === 0) ||
      (requireAll && firedCount < incoming.length)
    ) {
      return { output: "", ran: false };
    }

    const input =
      firedTexts.length > 0 ? firedTexts.join("\n\n") : args.transcript;
    const startedAt = Date.now();

    try {
      let output = "";
      let mock: boolean | undefined;
      let skipped = false;

      if (step.type === "llm") {
        const prompt = renderTemplate(step.data.prompt, {
          input,
          answers,
        }).trim();
        const system = renderTemplate(step.data.system, { input, answers });

        if (prompt === "") {
          skipped = true;
        } else {
          const result = await runLlm({
            system,
            prompt,
            model: step.data.model,
            sessionId: args.conversationId,
            onChunk: () => {},
          });
          output = result.text;
          mock = result.mock;
        }
      } else if (step.type === "web-search") {
        const query = renderTemplate(step.data.query, { input, answers }).trim();

        if (query === "") {
          skipped = true;
        } else {
          const result = await webSearch({
            query,
            maxResults: step.data.maxResults,
          });
          output = result.text;
          mock = result.mock;
        }
      } else {
        const urls = extractUrls(
          renderTemplate(step.data.urls, { input, answers }),
          3
        );

        if (urls.length === 0) {
          skipped = true;
        } else {
          const result = await fetchPages({ urls });
          output = result.text;
          mock = result.mock;
        }
      }

      const event: StepEvent = {
        id: `step-${step.id}-${nanoid(6)}`,
        at: Date.now(),
        kind: "step",
        nodeId: step.id,
        nodeType: step.type,
        label: step.data.label,
        status: skipped ? "skipped" : "complete",
        ...(skipped ? {} : { output: truncate(output, 4_000) }),
        durationMs: Date.now() - startedAt,
        mock,
      };
      await writeEvent(args.roomId, args.conversationId, event);

      return { output, ran: !skipped };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown error";
      await writeEvent(args.roomId, args.conversationId, {
        id: `step-${step.id}-${nanoid(6)}`,
        at: Date.now(),
        kind: "step",
        nodeId: step.id,
        nodeType: step.type,
        label: step.data.label,
        status: "error",
        error: reason,
        durationMs: Date.now() - startedAt,
      });
      return { output: "", ran: false };
    }
  }

  await Promise.all([...results.values()]);
}

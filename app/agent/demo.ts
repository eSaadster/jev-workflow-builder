import { nanoid } from "nanoid";
import type { QuestionDef } from "../workflow/shared";
import {
  createAgentEdge,
  createAgentNode,
  createDispositionsNode,
  createScenarioNode,
  createStartNode,
  createToolboxNode,
  type AgentEdge,
  type AgentGraphNode,
} from "./shared";

export const DEMO_AGENT_NAME = "Drayage qualification agent";

/**
 * The seeded agent mirrors the shape of Bland's "Norma": one global persona,
 * one conversation job, four extracted variables, one custom HTTP tool, one
 * knowledge snippet, one scenario with its own exit condition, and post-call
 * dispositions — but for the repo's home use case, qualifying drayage
 * carriers. Everything runs keyless through the mock providers (the tool's
 * httpbin request is real).
 */
export function createDemoAgentGraph(): {
  nodes: AgentGraphNode[];
  edges: AgentEdge[];
} {
  const start = createStartNode({
    position: { x: 0, y: 160 },
    sample: "Yeah hi — someone called me about container runs out of Newark?",
  });
  start.data.requestData = [
    { key: "dispatch_office", value: "Port Dispatch, Newark NJ" },
  ];

  const agent = createAgentNode({ position: { x: 320, y: 120 } });
  agent.data.label = "Dana";
  agent.data.systemPrompt = [
    "You are Dana, a dispatch assistant for a drayage board that matches carriers to container runs out of the NJ/NY ports.",
    "You are warm, direct, and quick — two or three short sentences a turn, one question at a time.",
    "Never invent carrier details. If you don't know something about the board, say the dispatch team will confirm it.",
  ].join("\n");
  agent.data.taskPrompt = [
    "Find out whether this caller's trucking company is a good fit for port drayage runs, and get them on the board if so.",
    "You need, one at a time: whether they already run containers (intermodal), where their trucks are based, roughly how many trucks, and their USDOT number if they offer it.",
    "If they mention a USDOT number, look them up before going further.",
    "When you have what you need — or it's clearly not a fit — thank them briefly and call end_conversation.",
  ].join("\n");
  agent.data.variables = [
    {
      id: "var-contact-name",
      name: "contact_name",
      type: "string",
      prompt:
        "The caller's first name as they gave it. Empty if they never gave one.",
    },
    {
      id: "var-home-base",
      name: "home_base",
      type: "string",
      prompt:
        "Where their trucks are based, in one or two words (city or region). Empty if unknown.",
    },
    {
      id: "var-truck-count",
      name: "truck_count",
      type: "string",
      prompt:
        'Roughly how many trucks they run, as text (e.g. "12" or "about thirty"). Empty if unknown.',
    },
    {
      id: "var-runs-containers",
      name: "runs_containers",
      type: "string",
      prompt:
        'One of "yes", "no", or "unsure": do they already run intermodal container loads?',
    },
  ];

  const toolbox = createToolboxNode({ position: { x: 0, y: 460 } });
  toolbox.data.tools = [
    {
      id: "tool-carrier-lookup",
      name: "look_up_carrier",
      description:
        "Look up a trucking carrier by USDOT number. Call this as soon as the caller gives you their DOT number. Returns the echoed carrier snapshot from the registry.",
      agentSpeech: "Let me pull you up real quick.",
      method: "GET",
      url: "https://httpbin.org/anything",
      query: [{ key: "dot_number", value: "{{dot_number}}" }],
      headers: [],
      body: "",
      inputs: [
        {
          name: "dot_number",
          instructions: "The carrier's USDOT number, digits only.",
          type: "string",
          required: true,
          sensitive: false,
        },
      ],
      outputs: [
        {
          name: "registry",
          type: "string",
          path: "$.args.dot_number",
          sensitive: false,
        },
      ],
      timeoutMs: 30_000,
      cooldownS: null,
      cache: true,
    },
  ];
  toolbox.data.knowledge = [
    {
      id: "source-glossary",
      name: "Drayage glossary",
      type: "text",
      attached: true,
      source: [
        "Drayage: short-haul moves of shipping containers between a port/yard and a nearby warehouse or rail ramp.",
        "Chassis: the wheel frame a container sits on for the road leg. Carriers often bring their own or rent at the port.",
        "Dual turn: a truck that picks up and drops off a container in one port visit, so the carrier is paid for both legs.",
      ].join("\n"),
    },
  ];

  const scenario = createScenarioNode({
    id: "scenario-not-interested",
    position: { x: 320, y: 440 },
    label: "Not interested",
  });
  scenario.data.routing = {
    mode: "ai_decides",
    description:
      "The caller is brushing the call off: they're busy, not interested, or want to be called back another time.",
  };
  scenario.data.prompt = [
    "Don't push. Acknowledge it in one line, offer one concrete reason it might be worth two minutes (port runs pay for both legs of a dual turn), and if they still decline, ask for nothing except whether a callback next week is okay.",
    "Keep it to a single exchange before you wrap up.",
  ].join("\n");
  scenario.data.exitCondition =
    "They re-engage with real questions, or the exchange is clearly over.";

  const dispositions = createDispositionsNode({
    position: { x: 660, y: 220 },
  });
  const outcome: QuestionDef = {
    id: "outcome",
    type: "choice",
    instructions: "Classify how this qualification call ended.",
    options: [
      { key: "qualified", description: "Runs or would run port containers, based near NJ/NY, and open to loads." },
      { key: "callback", description: "Asked to be called back at another time." },
      { key: "not_interested", description: "Declined the offer or was a wrong number." },
    ],
  };
  const portRuns: QuestionDef = {
    id: "port_runs_confirmed",
    type: "noul",
    instructions:
      "Did the caller confirm they already run intermodal container loads to or from ports?",
    threshold: 0.6,
  };
  dispositions.data.questions = [outcome, portRuns];

  return {
    nodes: [start, agent, toolbox, scenario, dispositions],
    edges: [
      createAgentEdge({ id: "e-start-agent", source: start.id, target: agent.id }),
      createAgentEdge({ id: "e-agent-scenario", source: agent.id, target: scenario.id }),
      createAgentEdge({ id: "e-agent-dispositions", source: agent.id, target: dispositions.id }),
    ],
  };
}

export function createBlankAgentGraph(): {
  nodes: AgentGraphNode[];
  edges: AgentEdge[];
} {
  const start = createStartNode({ position: { x: 0, y: 160 } });
  const agent = createAgentNode({ position: { x: 320, y: 160 } });
  const toolbox = createToolboxNode({ position: { x: 0, y: 460 } });
  const dispositions = createDispositionsNode({ position: { x: 660, y: 160 } });

  return {
    nodes: [start, agent, toolbox, dispositions],
    edges: [
      createAgentEdge({ id: `e-${nanoid(6)}`, source: start.id, target: agent.id }),
      createAgentEdge({ id: `e-${nanoid(6)}`, source: agent.id, target: dispositions.id }),
    ],
  };
}

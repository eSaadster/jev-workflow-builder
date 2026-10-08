"use client";

import {
  useCanRedo,
  useCanUndo,
  useRedo,
  useUndo,
  useUser,
} from "@liveblocks/react";
import {
  Cursors,
  useLiveblocksFlow,
  type CursorsCursorProps,
} from "@liveblocks/react-flow";
import { Cursor } from "@liveblocks/react-ui";
import {
  Background,
  BackgroundVariant,
  ConnectionLineType,
  Controls,
  ControlButton,
  MarkerType,
  Panel,
  ReactFlow,
  SelectionMode,
  useReactFlow,
  type Connection,
  type Edge,
  type IsValidConnection,
  type NodeChange,
} from "@xyflow/react";
import { Bot, FileOutput, Globe, MessageSquareText, Plus, Redo2, Route, Search, Sparkles, Undo2, Wrench } from "lucide-react";
import { nanoid } from "nanoid";
import { useCallback } from "react";
import type { ComponentProps } from "react";
import { agentNodeTypes } from "./nodes";
import {
  AGENT_EDGE_TYPE,
  AGENT_FLOW_STORAGE_KEY,
  AGENT_NODE_ID,
  AGENT_NODE_WIDTH,
  START_NODE_ID,
  createAgentEdge,
  createAgentNode,
  createDispositionsNode,
  createFetchStepNode,
  createJevStepNode,
  createLlmStepNode,
  createScenarioNode,
  createStartNode,
  createToolboxNode,
  createWebSearchStepNode,
  type AgentEdge,
  type AgentGraphNode,
  type Point,
} from "./shared";

function FlowCursor({ userId }: CursorsCursorProps) {
  const { user, isLoading } = useUser(userId);

  if (isLoading) {
    return null;
  }

  return <Cursor color={user?.color} label={user?.name} />;
}

export function AgentEditor({ className, ...props }: ComponentProps<"div">) {
  const reactFlow = useReactFlow<AgentGraphNode, AgentEdge>();
  const undo = useUndo();
  const redo = useRedo();
  const canUndo = useCanUndo();
  const canRedo = useCanRedo();

  const { nodes, edges, onNodesChange, onEdgesChange, onDelete } =
    useLiveblocksFlow<AgentGraphNode, AgentEdge>({
      suspense: true,
      storageKey: AGENT_FLOW_STORAGE_KEY,
    });

  // Edges carry meaning: a Jev answer handle wired into a scenario routes it
  // explicitly, and handles gate end-of-call steps. Only uniqueness (per
  // handle pair) is enforced.
  const isValidConnection = useCallback<IsValidConnection<AgentEdge>>(
    (connection: Connection | Edge) => {
      if (!connection.source || !connection.target) {
        return false;
      }

      return !edges.some(
        (edge) =>
          edge.source === connection.source &&
          edge.target === connection.target &&
          (edge.sourceHandle ?? "out") === (connection.sourceHandle ?? "out")
      );
    },
    [edges]
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target) {
        return;
      }

      onEdgesChange([
        {
          type: "add",
          item: createAgentEdge({
            source: connection.source,
            sourceHandle: connection.sourceHandle ?? "out",
            target: connection.target,
          }),
        },
      ]);
    },
    [onEdgesChange]
  );

  const addNode = useCallback(
    (
      kind:
        | "scenario"
        | "jev"
        | "llm"
        | "web-search"
        | "fetch"
        | "toolbox"
        | "dispositions"
    ) => {
      const container = document.querySelector(".react-flow");
      const width = container?.clientWidth ?? 800;
      const height = container?.clientHeight ?? 600;
      const center = reactFlow.screenToFlowPosition({
        x: width / 2,
        y: height / 2,
      });
      const jitter = (Math.random() - 0.5) * 80;
      const position: Point = {
        x: center.x - AGENT_NODE_WIDTH / 2 + jitter,
        y: center.y + 120 + jitter,
      };
      const deselect: NodeChange<AgentGraphNode>[] = reactFlow
        .getNodes()
        .filter((node) => node.selected)
        .map((node) => ({ type: "select", id: node.id, selected: false }));

      const item =
        kind === "scenario"
          ? createScenarioNode({ position, selected: true })
          : kind === "jev"
            ? createJevStepNode({ position, selected: true })
            : kind === "llm"
              ? createLlmStepNode({ position, selected: true })
              : kind === "web-search"
                ? createWebSearchStepNode({ position, selected: true })
                : kind === "fetch"
                  ? createFetchStepNode({ position, selected: true })
                  : kind === "toolbox"
                    ? createToolboxNode({
                        id: `toolbox-${nanoid(6)}`,
                        position,
                        selected: true,
                      })
                    : createDispositionsNode({
                        id: `dispositions-${nanoid(6)}`,
                        position,
                        selected: true,
                      });

      onNodesChange([...deselect, { type: "add", item }]);
    },
    [reactFlow, onNodesChange]
  );

  // The agent and the call start are pinned singletons: their buttons select
  // and focus the node when it exists, and re-add it if it ever went missing.
  const focusOrRestoreSingleton = useCallback(
    (kind: "start" | "agent") => {
      const id = kind === "start" ? START_NODE_ID : AGENT_NODE_ID;

      if (nodes.some((node) => node.id === id)) {
        reactFlow.setNodes(
          reactFlow.getNodes().map((node) => ({
            ...node,
            selected: node.id === id,
          }))
        );
        void reactFlow.fitView({
          nodes: [{ id }],
          duration: 400,
          maxZoom: 1,
          padding: 0.4,
        });
        return;
      }

      const factories: Record<
        "start" | "agent",
        (args: { position: Point }) => AgentGraphNode
      > = { start: createStartNode, agent: createAgentNode };
      onNodesChange([
        { type: "add", item: factories[kind]({ position: { x: 40, y: 220 } }) },
      ]);
    },
    [nodes, reactFlow, onNodesChange]
  );

  return (
    <div className={`workflow-canvas relative ${className ?? ""}`} {...props}>
      <ReactFlow<AgentGraphNode, AgentEdge>
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={handleConnect}
        onDelete={onDelete}
        isValidConnection={isValidConnection}
        nodeTypes={agentNodeTypes}
        defaultEdgeOptions={{
          type: AGENT_EDGE_TYPE,
          markerEnd: { type: MarkerType.ArrowClosed },
        }}
        connectionLineType={ConnectionLineType.SmoothStep}
        panOnScroll
        panOnDrag={[1, 2]}
        selectionOnDrag
        selectionMode={SelectionMode.Partial}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1 }}
        minZoom={0.2}
        proOptions={{ hideAttribution: true }}
        deleteKeyCode={["Backspace", "Delete"]}
      >
        <Cursors components={{ Cursor: FlowCursor }} />
        <Background
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="#d8d6d1"
        />
        <Controls
          orientation="horizontal"
          showInteractive={false}
          position="bottom-left"
        >
          <ControlButton
            onClick={undo}
            disabled={!canUndo}
            title="Undo"
            aria-label="Undo"
          >
            <Undo2 />
          </ControlButton>
          <ControlButton
            onClick={redo}
            disabled={!canRedo}
            title="Redo"
            aria-label="Redo"
          >
            <Redo2 />
          </ControlButton>
        </Controls>
        <Panel position="top-left">
          <div
            className="node-toolbar floating-surface flex items-center gap-0.5 p-1"
            role="group"
            aria-label="Add a node"
          >
            <span className="hidden items-center gap-1.5 border-r border-neutral-200 px-2 py-1 text-[11px] font-medium text-neutral-400 xl:flex">
              <Plus className="size-3.5" aria-hidden /> Add node
            </span>
            <button
              type="button"
              onClick={() => addNode("scenario")}
              className="toolbar-button hover:bg-amber-50 hover:text-amber-700"
              title="Pathway with its own routing, prompt and exit condition"
            >
              <span className="toolbar-icon bg-amber-50 text-amber-600">
                <Route className="size-4" />
              </span>{" "}
              Scenario
            </button>
            <button
              type="button"
              onClick={() => addNode("jev")}
              className="toolbar-button hover:bg-violet-50 hover:text-violet-700"
              title="Jev questions — wire an answer into a Scenario to route it, or leave unwired to judge at end of call"
            >
              <span className="toolbar-icon bg-violet-50 text-violet-600">
                <Sparkles className="size-4" />
              </span>{" "}
              Jev
            </button>
            <button
              type="button"
              onClick={() => addNode("llm")}
              className="toolbar-button hover:bg-sky-50 hover:text-sky-700"
              title="LLM note writer — runs at end of call over the transcript"
            >
              <span className="toolbar-icon bg-sky-50 text-sky-600">
                <Bot className="size-4" />
              </span>{" "}
              LLM
            </button>
            <button
              type="button"
              onClick={() => addNode("web-search")}
              className="toolbar-button hover:bg-amber-50 hover:text-amber-700"
              title="TinyFish web search — end-of-call research step"
            >
              <span className="toolbar-icon bg-amber-50 text-amber-600">
                <Search className="size-4" />
              </span>{" "}
              Web search
            </button>
            <button
              type="button"
              onClick={() => addNode("fetch")}
              className="toolbar-button hover:bg-teal-50 hover:text-teal-700"
              title="TinyFish fetch — end-of-call page fetch"
            >
              <span className="toolbar-icon bg-teal-50 text-teal-600">
                <Globe className="size-4" />
              </span>{" "}
              Fetch
            </button>
            <button
              type="button"
              onClick={() => addNode("toolbox")}
              className="toolbar-button hover:bg-teal-50 hover:text-teal-700"
              title="Custom HTTP tools and knowledge sources (multiple merge)"
            >
              <span className="toolbar-icon bg-teal-50 text-teal-600">
                <Wrench className="size-4" />
              </span>{" "}
              Tools
            </button>
            <button
              type="button"
              onClick={() => addNode("dispositions")}
              className="toolbar-button hover:bg-emerald-50 hover:text-emerald-700"
              title="Post-call outcome questions — runs when the call ends (multiple merge)"
            >
              <span className="toolbar-icon bg-emerald-50 text-emerald-600">
                <FileOutput className="size-4" />
              </span>{" "}
              Dispositions
            </button>
            <button
              type="button"
              onClick={() => focusOrRestoreSingleton("start")}
              className="toolbar-button hover:bg-neutral-100 hover:text-neutral-900"
              title="Call start — sample opening + request data (pinned; selects it if present)"
            >
              <span className="toolbar-icon bg-neutral-100 text-neutral-600">
                <MessageSquareText className="size-4" />
              </span>{" "}
              Start
            </button>
            <button
              type="button"
              onClick={() => focusOrRestoreSingleton("agent")}
              className="toolbar-button hover:bg-violet-50 hover:text-violet-700"
              title="Agent — persona, task, variables, guardrails (pinned; selects it if present)"
            >
              <span className="toolbar-icon bg-violet-50 text-violet-600">
                <Bot className="size-4" />
              </span>{" "}
              Agent
            </button>
          </div>
        </Panel>
      </ReactFlow>
    </div>
  );
}

"use client";

import {
  Handle,
  Position,
  useNodes,
  useReactFlow,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import {
  Bot,
  Flag,
  FlaskConical,
  Globe,
  Loader2,
  MessageSquareText,
  Pencil,
  Plus,
  Route,
  Search,
  Sparkles,
  Trash2,
  Wrench,
} from "lucide-react";
import { useParams } from "next/navigation";
import {
  memo,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { FieldLabel, Select, TextArea, TextField } from "../workflow/fields";
import type { Answer } from "../workflow/runs";
import {
  LLM_MODEL_GROUPS,
  LLM_MODELS,
  WEB_SEARCH_RESULT_COUNTS,
  createQuestion,
  getQuestionHandles,
  slugify,
  truncate,
  type HandleDef,
  type QuestionDef,
} from "../workflow/shared";
import { useConversation } from "./conversation-context";
import {
  AGENT_NODE_WIDTH,
  createFetchStepNode,
  createJevStepNode,
  createKnowledgeSource,
  createLlmStepNode,
  createTool,
  createToolInput,
  createVariable,
  createWebSearchStepNode,
  getActivation,
  type ActivationMode,
  type AgentEdge,
  type AgentFetchNode,
  type AgentGraphNode,
  type AgentJevNode,
  type AgentLlmNode,
  type AgentNode,
  type AgentWebSearchNode,
  type DispositionsNode,
  type ExtractedVariable,
  type KnowledgeSourceDoc,
  type ScenarioNode,
  type StartNode,
  type ToolDoc,
  type ToolboxNode,
  type VariableType,
} from "./shared";

const IN_HANDLE = "in";
const OUT_HANDLE = "out";

const DISPOSITION_TYPE_LABELS: Record<"choice" | "noul", string> = {
  choice: "Choice",
  noul: "Yes / no",
};

/* -------------------------------------------------------------------------- */
/*                                   Frame                                    */
/* -------------------------------------------------------------------------- */

function AgentNodeFrame({
  id,
  label,
  selected,
  icon,
  accent,
  summary,
  editor,
  active,
  handles,
}: {
  id: string;
  label: string;
  selected: boolean | undefined;
  icon: ReactNode;
  accent: string;
  summary: ReactNode;
  editor: ReactNode;
  active?: boolean;
  /** Source handles; defaults to a single decorative "next" handle. */
  handles?: HandleDef[];
}) {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
  const [isEditing, setEditing] = useState(false);
  const editAreaRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  useEffect(() => {
    if (!isEditing) {
      return;
    }

    editAreaRef.current
      ?.querySelector<HTMLElement>("input, textarea, select, button")
      ?.focus({ preventScroll: true });

    const onPointerDown = (event: PointerEvent) => {
      const editArea = editAreaRef.current;

      if (
        !editArea ||
        !(event.target instanceof Node) ||
        editArea.contains(event.target)
      ) {
        return;
      }

      const activeElement = document.activeElement;
      if (
        activeElement instanceof HTMLElement &&
        editArea.contains(activeElement)
      ) {
        activeElement.blur();
      }

      setEditing(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  }, [isEditing]);

  return (
    <div
      className="workflow-node"
      style={{ width: AGENT_NODE_WIDTH }}
      data-selected={selected ? "" : undefined}
      data-active={active ? "" : undefined}
    >
      <Handle
        type="target"
        position={Position.Left}
        id={IN_HANDLE}
        className="workflow-handle"
      />

      <div className="workflow-node-header">
        <span
          className="workflow-node-icon"
          style={{ color: accent, background: `${accent}12` }}
        >
          {icon}
        </span>
        <div className="flex min-w-0 flex-1 items-center">
          <TextField
            aria-label="Node name"
            fit
            value={label}
            onCommit={(next) => updateNodeData(id, { label: next })}
            className="!border-transparent !bg-transparent !font-semibold hover:!border-neutral-200"
          />
        </div>
        {active ? (
          <span className="rounded bg-violet-100 px-1 text-[9px] font-semibold tracking-wide text-violet-700">
            ACTIVE
          </span>
        ) : null}
      </div>

      <div
        ref={editAreaRef}
        className={`workflow-node-body px-2.5 py-2 ${isEditing ? "nodrag nopan" : ""}`}
        data-editing={isEditing ? "" : undefined}
      >
        {!isEditing ? (
          <button
            type="button"
            className="workflow-node-edit-button nodrag nopan"
            aria-label={`Edit ${label}`}
            aria-expanded={false}
            aria-controls={bodyId}
            onClick={(event) => {
              event.stopPropagation();
              setEditing(true);
            }}
          >
            <Pencil className="size-3" /> Edit
          </button>
        ) : null}
        <div id={bodyId}>
          {isEditing ? (
            <div className="flex flex-col gap-2">{editor}</div>
          ) : (
            <div className="workflow-node-summary">{summary}</div>
          )}
        </div>
      </div>

      <div className="workflow-node-ports">
        {(handles ?? [{ id: OUT_HANDLE, label: "next", title: "Next step" }]).map(
          (handle) => (
            <div
              key={handle.id}
              className="workflow-node-port relative flex h-6 items-center justify-end pr-2.5"
              title={handle.title}
            >
              <span className="max-w-[200px] truncate text-xs text-neutral-500">
                {handle.questionId ? (
                  <span className="text-neutral-400">{handle.questionId} · </span>
                ) : null}
                {handle.label}
              </span>
              <Handle
                type="source"
                position={Position.Right}
                id={handle.id}
                className="workflow-handle"
              />
            </div>
          )
        )}
      </div>
    </div>
  );
}

/**
 * "Runs when" toggle for step nodes with incoming edges, mirroring the
 * workflow builder's activation control.
 */
function RunsWhenControl({
  id,
  activation,
}: {
  id: string;
  activation: ActivationMode;
}) {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();

  return (
    <div className="flex flex-col gap-1">
      <FieldLabel>Runs when</FieldLabel>
      <div className="flex rounded-md bg-neutral-100 p-0.5 text-[11px]">
        {(
          [
            ["any", "Any input fires"],
            ["all", "All inputs fire"],
          ] as const
        ).map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            onClick={() => updateNodeData(id, { activation: mode })}
            aria-pressed={activation === mode}
            className={`nodrag min-h-7 flex-1 rounded-md px-1.5 py-1 ${
              activation === mode
                ? "bg-white font-medium text-neutral-900 shadow-sm"
                : "text-neutral-600 hover:bg-neutral-100"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                              Shared editors                                */
/* -------------------------------------------------------------------------- */

function ToggleRow({
  label,
  checked,
  onChange,
  hint,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2 text-xs text-neutral-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="nodrag nopan mt-0.5 accent-violet-600"
      />
      <span>
        {label}
        {hint ? (
          <span className="block text-[10px] leading-relaxed text-neutral-400">
            {hint}
          </span>
        ) : null}
      </span>
    </label>
  );
}

function VariablesEditor({
  variables,
  onChange,
}: {
  variables: ExtractedVariable[];
  onChange: (variables: ExtractedVariable[]) => void;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {variables.map((variable, index) => (
        <div
          key={variable.id}
          className="flex flex-col gap-1 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-1.5"
        >
          <div className="flex items-center gap-1">
            <TextField
              aria-label="Variable name"
              value={variable.name}
              placeholder="variable_name"
              className="!w-28 shrink-0 font-mono"
              onCommit={(name) =>
                onChange(
                  variables.map((entry, i) =>
                    i === index ? { ...entry, name: slugify(name) } : entry
                  )
                )
              }
            />
            <Select
              aria-label="Variable type"
              value={variable.type}
              onChange={(event) =>
                onChange(
                  variables.map((entry, i) =>
                    i === index
                      ? { ...entry, type: event.target.value as VariableType }
                      : entry
                  )
                )
              }
            >
              {(["string", "number", "boolean"] as VariableType[]).map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </Select>
            <button
              type="button"
              aria-label="Remove variable"
              onClick={() => onChange(variables.filter((_, i) => i !== index))}
              className="nodrag icon-button ml-auto shrink-0 hover:!text-red-600"
            >
              <Trash2 className="size-3" />
            </button>
          </div>
          <TextArea
            aria-label="Extraction prompt"
            rows={2}
            value={variable.prompt}
            placeholder="How to extract this value…"
            onCommit={(prompt) =>
              onChange(
                variables.map((entry, i) =>
                  i === index ? { ...entry, prompt } : entry
                )
              )
            }
          />
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange([...variables, createVariable(variables.length + 1)])
        }
        className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
      >
        <Plus className="size-3" /> Add variable
      </button>
    </div>
  );
}

function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
}: {
  rows: { key: string; value: string }[];
  onChange: (rows: { key: string; value: string }[]) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1">
          <TextField
            aria-label={keyPlaceholder}
            value={row.key}
            placeholder={keyPlaceholder}
            className="!w-28 shrink-0 font-mono"
            onCommit={(key) =>
              onChange(
                rows.map((entry, i) =>
                  i === index ? { ...entry, key: slugify(key) } : entry
                )
              )
            }
          />
          <TextField
            aria-label={valuePlaceholder}
            value={row.value}
            placeholder={valuePlaceholder}
            onCommit={(value) =>
              onChange(
                rows.map((entry, i) => (i === index ? { ...entry, value } : entry))
              )
            }
          />
          <button
            type="button"
            aria-label="Remove row"
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
            className="nodrag icon-button shrink-0 hover:!text-red-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
      >
        <Plus className="size-3" /> Add
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Start node                                 */
/* -------------------------------------------------------------------------- */

const StartNodeView = memo(({ id, data, selected }: NodeProps<StartNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<MessageSquareText className="size-3.5" />}
      accent="#171717"
      summary={
        <div className="flex flex-col gap-1.5">
          <p className="text-xs leading-relaxed text-neutral-600">
            {data.sample
              ? truncate(data.sample, 140)
              : "First caller message for chat tests. Leave empty and the agent speaks first."}
          </p>
          {data.requestData.length > 0 ? (
            <p className="text-[11px] text-neutral-400">
              {data.requestData.length} request data default
              {data.requestData.length === 1 ? "" : "s"}
            </p>
          ) : null}
        </div>
      }
      editor={
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>Sample first caller message</FieldLabel>
            <TextArea
              rows={3}
              value={data.sample}
              placeholder="What the caller says to open the test chat…"
              onCommit={(sample) => updateNodeData(id, { sample })}
            />
          </label>
          <div className="flex flex-col gap-1">
            <FieldLabel>Request data</FieldLabel>
            <p className="text-[10px] leading-relaxed text-neutral-400">
              Facts the agent knows from the start, available as{" "}
              <code>{"{{variables}}"}</code>.
            </p>
            <KeyValueEditor
              rows={data.requestData}
              keyPlaceholder="key"
              valuePlaceholder="value"
              onChange={(requestData) => updateNodeData(id, { requestData })}
            />
          </div>
        </div>
      }
    />
  );
});

/* -------------------------------------------------------------------------- */
/*                                 Agent node                                 */
/* -------------------------------------------------------------------------- */

const AgentNodeView = memo(({ id, data, selected }: NodeProps<AgentNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
  const { state } = useConversation();
  const modelLabel =
    LLM_MODELS.find((model) => model.id === data.model)?.label ?? data.model;

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<Bot className="size-3.5" />}
      accent="#7c3aed"
      summary={
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-neutral-500">
            <span className="font-medium text-neutral-700">{modelLabel}</span>
            {data.memory ? " · memory on" : ""}
            {data.variables.length > 0
              ? ` · ${data.variables.length} variable${data.variables.length === 1 ? "" : "s"}`
              : ""}
          </p>
          <p className="text-xs leading-relaxed text-neutral-600">
            {data.taskPrompt
              ? truncate(data.taskPrompt, 150)
              : "What is this agent's job on the call? Click Edit to write its task prompt."}
          </p>
          {state && Object.keys(state.variables).length > 0 ? (
            <p className="text-[11px] text-neutral-400">
              extracted:{" "}
              {Object.entries(state.variables)
                .filter(([, value]) => value !== "")
                .slice(0, 4)
                .map(([key, value]) => `${key}=${truncate(value, 18)}`)
                .join(" · ") || "nothing yet"}
            </p>
          ) : null}
        </div>
      }
      editor={
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>Model</FieldLabel>
            <Select
              value={data.model}
              onChange={(event) =>
                updateNodeData(id, { model: event.target.value })
              }
            >
              {!LLM_MODELS.some((model) => model.id === data.model) ? (
                <option value={data.model}>{data.model}</option>
              ) : null}
              {LLM_MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>System prompt (persona)</FieldLabel>
            <TextArea
              rows={4}
              value={data.systemPrompt}
              placeholder="Who the agent is and how it talks — used across all scenarios…"
              onCommit={(systemPrompt) => updateNodeData(id, { systemPrompt })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Task prompt (this conversation&apos;s job)</FieldLabel>
            <TextArea
              rows={5}
              value={data.taskPrompt}
              placeholder="What the agent has to get done on the call…"
              onCommit={(taskPrompt) => updateNodeData(id, { taskPrompt })}
            />
          </label>
          <ToggleRow
            label="Memory"
            hint="Retain context per contact across conversations (summary carry-over)."
            checked={data.memory}
            onChange={(memory) => updateNodeData(id, { memory })}
          />
          <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-2">
            <FieldLabel>Guardrails</FieldLabel>
            <ToggleRow
              label="AI disclosure"
              hint="The agent must say it is an AI within the turn window."
              checked={data.guardrails.aiDisclosure.enabled}
              onChange={(enabled) =>
                updateNodeData(id, {
                  guardrails: {
                    ...data.guardrails,
                    aiDisclosure: {
                      ...data.guardrails.aiDisclosure,
                      enabled,
                    },
                  },
                })
              }
            />
            {data.guardrails.aiDisclosure.enabled ? (
              <label className="flex items-center gap-2 pl-5 text-[11px] text-neutral-600">
                within
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={data.guardrails.aiDisclosure.withinTurns}
                  onChange={(event) =>
                    updateNodeData(id, {
                      guardrails: {
                        ...data.guardrails,
                        aiDisclosure: {
                          ...data.guardrails.aiDisclosure,
                          withinTurns: Math.max(
                            1,
                            Math.min(10, Number(event.target.value) || 2)
                          ),
                        },
                      },
                    })
                  }
                  className="workflow-field nodrag nopan w-12 rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-xs"
                />
                turns
              </label>
            ) : null}
            <ToggleRow
              label="Opt-out"
              hint="A clear opt-out ends the conversation immediately."
              checked={data.guardrails.optOut}
              onChange={(optOut) =>
                updateNodeData(id, {
                  guardrails: { ...data.guardrails, optOut },
                })
              }
            />
          </div>
          <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-2">
            <FieldLabel>Built-in tools</FieldLabel>
            <ToggleRow
              label="end_conversation"
              hint="Lets the agent end the call when it's done."
              checked={data.endCallTool}
              onChange={(endCallTool) => updateNodeData(id, { endCallTool })}
            />
            <ToggleRow
              label="handoff"
              hint="Flags the conversation for a human."
              checked={data.handoffTool}
              onChange={(handoffTool) => updateNodeData(id, { handoffTool })}
            />
            <ToggleRow
              label="web_search"
              hint="TinyFish web search the model can call mid-conversation."
              checked={data.webSearchTool ?? true}
              onChange={(webSearchTool) => updateNodeData(id, { webSearchTool })}
            />
            <ToggleRow
              label="fetch_page"
              hint="Fetch one URL as markdown mid-conversation."
              checked={data.fetchPageTool ?? false}
              onChange={(fetchPageTool) => updateNodeData(id, { fetchPageTool })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Variables to extract</FieldLabel>
            <p className="text-[10px] leading-relaxed text-neutral-400">
              Pulled from the conversation as it goes. Extraction adds latency
              to each turn.
            </p>
            <VariablesEditor
              variables={data.variables}
              onChange={(variables) => updateNodeData(id, { variables })}
            />
          </div>
        </div>
      }
    />
  );
});

/* -------------------------------------------------------------------------- */
/*                                Scenario node                               */
/* -------------------------------------------------------------------------- */

const OPERATOR_LABELS: Record<string, string> = {
  equals: "=",
  not_equals: "≠",
  contains: "contains",
};

const ScenarioNodeView = memo(
  ({ id, data, selected }: NodeProps<ScenarioNode>) => {
    const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
    const { state, activeScenarioIds } = useConversation();
    // Tools can live on any number of Tools & knowledge nodes; they merge.
    const allNodes = useNodes<AgentGraphNode>();
    const tools = allNodes.flatMap((node) =>
      node.type === "toolbox" ? node.data.tools : []
    );
    const isActive =
      state?.activeScenarios.includes(id) ?? activeScenarioIds.has(id);

    const routingSummary =
      data.routing.mode === "ai_decides"
        ? `AI decides — ${truncate(data.routing.description, 80) || "describe when this scenario applies"}`
        : data.routing.rules.length === 0
          ? "Conditions — add at least one rule"
          : `Conditions — ${data.routing.rules
              .map(
                (rule) =>
                  `${rule.variable} ${OPERATOR_LABELS[rule.op] ?? rule.op} ${rule.value}`
              )
              .join(" & ")}`;

    return (
      <AgentNodeFrame
        id={id}
        label={data.label}
        selected={selected}
        icon={<Route className="size-3.5" />}
        accent="#d97706"
        active={isActive}
        summary={
          <div className="flex flex-col gap-1.5">
            <p className="text-[11px] leading-relaxed text-amber-700">
              {routingSummary}
            </p>
            <p className="text-xs leading-relaxed text-neutral-600">
              {data.prompt
                ? truncate(data.prompt, 110)
                : "Prompt chunk applied while this scenario is active."}
            </p>
            {data.exitCondition ? (
              <p className="text-[11px] text-neutral-400">
                exits when: {truncate(data.exitCondition, 70)}
              </p>
            ) : null}
            {data.toolIds.length > 0 ? (
              <p className="text-[11px] text-neutral-400">
                {data.toolIds.length} scoped tool
                {data.toolIds.length === 1 ? "" : "s"}
              </p>
            ) : null}
          </div>
        }
        editor={
          <div className="flex flex-col gap-2">
            <div className="flex flex-col gap-1">
              <FieldLabel>Routing</FieldLabel>
              <div className="flex rounded-md bg-neutral-100 p-0.5 text-[11px]">
                {(
                  [
                    ["ai_decides", "AI decides"],
                    ["conditions", "Conditions"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() =>
                      updateNodeData(id, {
                        routing:
                          mode === "ai_decides"
                            ? { mode: "ai_decides", description: "" }
                            : { mode: "conditions", rules: [] },
                      })
                    }
                    aria-pressed={data.routing.mode === mode}
                    className={`nodrag min-h-7 flex-1 rounded-md px-1.5 py-1 ${
                      data.routing.mode === mode
                        ? "bg-white font-medium text-neutral-900 shadow-sm"
                        : "text-neutral-600 hover:bg-neutral-100"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {data.routing.mode === "ai_decides" ? (
                <TextArea
                  rows={3}
                  value={data.routing.description}
                  placeholder="When does the conversation turn into this job? Judged by Jev each turn…"
                  onCommit={(description) =>
                    updateNodeData(id, {
                      routing: { mode: "ai_decides", description },
                    })
                  }
                />
              ) : (
                <ScenarioRulesEditor
                  data={data}
                  onChange={(routing) => updateNodeData(id, { routing })}
                />
              )}
            </div>
            <label className="flex flex-col gap-1">
              <FieldLabel>Scenario prompt</FieldLabel>
              <TextArea
                rows={5}
                value={data.prompt}
                placeholder="Instructions that extend the agent while this scenario is active…"
                onCommit={(prompt) => updateNodeData(id, { prompt })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel>Exit condition</FieldLabel>
              <TextArea
                rows={2}
                value={data.exitCondition}
                placeholder="Move forward once… (checked by Jev each turn)"
                onCommit={(exitCondition) =>
                  updateNodeData(id, { exitCondition })
                }
              />
            </label>
            <div className="flex flex-col gap-1">
              <FieldLabel>Scenario variables</FieldLabel>
              <VariablesEditor
                variables={data.variables}
                onChange={(variables) => updateNodeData(id, { variables })}
              />
            </div>
            {tools.length > 0 ? (
              <div className="flex flex-col gap-1">
                <FieldLabel>Scoped tools</FieldLabel>
                <p className="text-[10px] leading-relaxed text-neutral-400">
                  While active, these replace the agent&apos;s default toolset.
                </p>
                <div className="flex flex-col gap-0.5">
                  {tools.map((tool) => (
                    <ToggleRow
                      key={tool.id}
                      label={tool.name || "(unnamed tool)"}
                      checked={data.toolIds.includes(tool.id)}
                      onChange={(checked) =>
                        updateNodeData(id, {
                          toolIds: checked
                            ? [...data.toolIds, tool.id]
                            : data.toolIds.filter(
                                (entry) => entry !== tool.id
                              ),
                        })
                      }
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        }
      />
    );
  }
);

function ScenarioRulesEditor({
  data,
  onChange,
}: {
  data: ScenarioNode["data"];
  onChange: (routing: ScenarioNode["data"]["routing"]) => void;
}) {
  if (data.routing.mode !== "conditions") {
    return null;
  }

  const rules = data.routing.rules;

  return (
    <div className="flex flex-col gap-1">
      {rules.map((rule, index) => (
        <div key={index} className="flex items-center gap-1">
          <TextField
            aria-label="Variable"
            value={rule.variable}
            placeholder="variable"
            className="!w-24 shrink-0 font-mono"
            onCommit={(variable) =>
              onChange({
                mode: "conditions",
                rules: rules.map((entry, i) =>
                  i === index ? { ...entry, variable: slugify(variable) } : entry
                ),
              })
            }
          />
          <Select
            aria-label="Operator"
            value={rule.op}
            onChange={(event) =>
              onChange({
                mode: "conditions",
                rules: rules.map((entry, i) =>
                  i === index
                    ? {
                        ...entry,
                        op: event.target.value as "equals" | "not_equals" | "contains",
                      }
                    : entry
                ),
              })
            }
          >
            <option value="equals">=</option>
            <option value="not_equals">≠</option>
            <option value="contains">contains</option>
          </Select>
          <TextField
            aria-label="Value"
            value={rule.value}
            placeholder="value"
            onCommit={(value) =>
              onChange({
                mode: "conditions",
                rules: rules.map((entry, i) =>
                  i === index ? { ...entry, value } : entry
                ),
              })
            }
          />
          <button
            type="button"
            aria-label="Remove rule"
            onClick={() =>
              onChange({
                mode: "conditions",
                rules: rules.filter((_, i) => i !== index),
              })
            }
            className="nodrag icon-button shrink-0 hover:!text-red-600"
          >
            <Trash2 className="size-3" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() =>
          onChange({
            mode: "conditions",
            rules: [...rules, { variable: "", op: "equals", value: "" }],
          })
        }
        className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
      >
        <Plus className="size-3" /> Add rule
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                Toolbox node                                */
/* -------------------------------------------------------------------------- */

function KnowledgeEditor({
  source,
  onChange,
  onRemove,
}: {
  source: KnowledgeSourceDoc;
  onChange: (source: KnowledgeSourceDoc) => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-1.5">
      <div className="flex items-center gap-1">
        <TextField
          aria-label="Source name"
          value={source.name}
          placeholder="name"
          className="!w-28 shrink-0"
          onCommit={(name) => onChange({ ...source, name })}
        />
        <Select
          aria-label="Source type"
          value={source.type}
          onChange={(event) =>
            onChange({
              ...source,
              type: event.target.value as "text" | "url",
            })
          }
        >
          <option value="text">Text</option>
          <option value="url">URL</option>
        </Select>
        <button
          type="button"
          aria-label="Remove source"
          onClick={onRemove}
          className="nodrag icon-button ml-auto shrink-0 hover:!text-red-600"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <TextArea
        aria-label="Source"
        rows={3}
        value={source.source}
        placeholder={
          source.type === "url"
            ? "https://example.com/docs — fetched once per conversation"
            : "Raw knowledge text the agent can use…"
        }
        onCommit={(text) => onChange({ ...source, source: text })}
      />
      <ToggleRow
        label="Attached to the agent"
        checked={source.attached}
        onChange={(attached) => onChange({ ...source, attached })}
      />
    </div>
  );
}

function ToolEditor({
  tool,
  onChange,
  onRemove,
}: {
  tool: ToolDoc;
  onChange: (tool: ToolDoc) => void;
  onRemove: () => void;
}) {
  const params = useParams<{ agentId: string }>();
  const [expanded, setExpanded] = useState(false);
  const [testArgs, setTestArgs] = useState<Record<string, string>>({});
  const [isTesting, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  async function runTest() {
    if (!params?.agentId || !tool.id) {
      return;
    }

    setTesting(true);
    setTestResult(null);

    try {
      const response = await fetch(
        `/api/agents/${params.agentId}/tools/${tool.id}/test`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ args: testArgs }),
        }
      );
      const json = (await response.json()) as unknown;
      setTestResult(JSON.stringify(json, null, 2).slice(0, 800));
    } catch (error) {
      setTestResult(
        error instanceof Error ? error.message : "Test request failed"
      );
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-1.5">
      <div className="flex items-center gap-1">
        <Wrench className="size-3 shrink-0 text-neutral-500" aria-hidden />
        <TextField
          aria-label="Tool name"
          value={tool.name}
          placeholder="tool_name"
          className="!w-32 shrink-0 font-mono"
          onCommit={(name) =>
            onChange({ ...tool, name: slugify(name) })
          }
        />
        <span className="min-w-0 flex-1 truncate text-[10px] text-neutral-400">
          {tool.method} {truncate(tool.url, 30)}
        </span>
        <button
          type="button"
          aria-label="Remove tool"
          onClick={onRemove}
          className="nodrag icon-button shrink-0 hover:!text-red-600"
        >
          <Trash2 className="size-3" />
        </button>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
          className="nodrag icon-button shrink-0"
          aria-label={expanded ? "Collapse tool" : "Expand tool"}
        >
          <Pencil className="size-3" />
        </button>
      </div>

      {expanded ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>Description (when to use it)</FieldLabel>
            <TextArea
              rows={2}
              value={tool.description}
              placeholder="What this tool does and when the agent should call it…"
              onCommit={(description) => onChange({ ...tool, description })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Agent speech while it runs</FieldLabel>
            <TextField
              value={tool.agentSpeech}
              placeholder="One moment while I look that up…"
              onCommit={(agentSpeech) => onChange({ ...tool, agentSpeech })}
            />
          </label>
          <div className="flex items-center gap-1">
            <Select
              aria-label="HTTP method"
              value={tool.method}
              onChange={(event) =>
                onChange({
                  ...tool,
                  method: event.target.value as ToolDoc["method"],
                })
              }
              className="!w-20 shrink-0"
            >
              {(["GET", "POST", "PUT", "PATCH", "DELETE"] as const).map(
                (method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                )
              )}
            </Select>
            <TextField
              aria-label="URL"
              value={tool.url}
              placeholder="https://api.example.com/lookup/{{variable}}"
              onCommit={(url) => onChange({ ...tool, url })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Query parameters</FieldLabel>
            <KeyValueEditor
              rows={tool.query}
              keyPlaceholder="key"
              valuePlaceholder="{{variable}}"
              onChange={(query) => onChange({ ...tool, query })}
            />
          </div>
          {tool.method !== "GET" ? (
            <label className="flex flex-col gap-1">
              <FieldLabel>JSON body</FieldLabel>
              <TextArea
                rows={2}
                value={tool.body}
                placeholder='{"key": "{{variable}}"} — defaults to the call arguments'
                onCommit={(body) => onChange({ ...tool, body })}
              />
            </label>
          ) : null}
          <div className="flex flex-col gap-1">
            <FieldLabel>Inputs (agent-filled)</FieldLabel>
            {tool.inputs.map((input, index) => (
              <div
                key={index}
                className="flex flex-col gap-1 rounded border border-neutral-200 bg-white p-1.5"
              >
                <div className="flex items-center gap-1">
                  <TextField
                    aria-label="Input name"
                    value={input.name}
                    placeholder="name"
                    className="!w-24 shrink-0 font-mono"
                    onCommit={(name) =>
                      onChange({
                        ...tool,
                        inputs: tool.inputs.map((entry, i) =>
                          i === index ? { ...entry, name: slugify(name) } : entry
                        ),
                      })
                    }
                  />
                  <Select
                    aria-label="Input type"
                    value={input.type}
                    onChange={(event) =>
                      onChange({
                        ...tool,
                        inputs: tool.inputs.map((entry, i) =>
                          i === index
                            ? {
                                ...entry,
                                type: event.target.value as VariableType,
                              }
                            : entry
                        ),
                      })
                    }
                  >
                    {(["string", "number", "boolean"] as VariableType[]).map(
                      (type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      )
                    )}
                  </Select>
                  <button
                    type="button"
                    aria-label="Remove input"
                    onClick={() =>
                      onChange({
                        ...tool,
                        inputs: tool.inputs.filter((_, i) => i !== index),
                      })
                    }
                    className="nodrag icon-button ml-auto shrink-0 hover:!text-red-600"
                  >
                    <Trash2 className="size-3" />
                  </button>
                </div>
                <TextField
                  aria-label="Input instructions"
                  value={input.instructions}
                  placeholder="What should the agent extract for this?"
                  onCommit={(instructions) =>
                    onChange({
                      ...tool,
                      inputs: tool.inputs.map((entry, i) =>
                        i === index ? { ...entry, instructions } : entry
                      ),
                    })
                  }
                />
                <div className="flex gap-3">
                  <ToggleRow
                    label="required"
                    checked={input.required}
                    onChange={(required) =>
                      onChange({
                        ...tool,
                        inputs: tool.inputs.map((entry, i) =>
                          i === index ? { ...entry, required } : entry
                        ),
                      })
                    }
                  />
                  <ToggleRow
                    label="sensitive"
                    checked={input.sensitive}
                    onChange={(sensitive) =>
                      onChange({
                        ...tool,
                        inputs: tool.inputs.map((entry, i) =>
                          i === index ? { ...entry, sensitive } : entry
                        ),
                      })
                    }
                  />
                </div>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({ ...tool, inputs: [...tool.inputs, createToolInput()] })
              }
              className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
            >
              <Plus className="size-3" /> Add input
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Outputs (JSON path)</FieldLabel>
            {tool.outputs.map((output, index) => (
              <div key={index} className="flex items-center gap-1">
                <TextField
                  aria-label="Output name"
                  value={output.name}
                  placeholder="name"
                  className="!w-24 shrink-0 font-mono"
                  onCommit={(name) =>
                    onChange({
                      ...tool,
                      outputs: tool.outputs.map((entry, i) =>
                        i === index ? { ...entry, name: slugify(name) } : entry
                      ),
                    })
                  }
                />
                <TextField
                  aria-label="Response path"
                  value={output.path}
                  placeholder="$.data.value"
                  className="!w-28 shrink-0 font-mono"
                  onCommit={(path) =>
                    onChange({
                      ...tool,
                      outputs: tool.outputs.map((entry, i) =>
                        i === index ? { ...entry, path } : entry
                      ),
                    })
                  }
                />
                <button
                  type="button"
                  aria-label="Remove output"
                  onClick={() =>
                    onChange({
                      ...tool,
                      outputs: tool.outputs.filter((_, i) => i !== index),
                    })
                  }
                  className="nodrag icon-button shrink-0 hover:!text-red-600"
                >
                  <Trash2 className="size-3" />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                onChange({
                  ...tool,
                  outputs: [
                    ...tool.outputs,
                    { name: "", type: "string", path: "$.", sensitive: false },
                  ],
                })
              }
              className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
            >
              <Plus className="size-3" /> Add output
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              timeout(ms)
              <input
                type="number"
                min={1000}
                max={30000}
                step={1000}
                value={tool.timeoutMs}
                onChange={(event) =>
                  onChange({
                    ...tool,
                    timeoutMs: Number(event.target.value) || 30_000,
                  })
                }
                className="workflow-field nodrag nopan w-20 rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-[11px] text-neutral-600">
              cooldown(s)
              <input
                type="number"
                min={0}
                max={600}
                value={tool.cooldownS ?? ""}
                placeholder="none"
                onChange={(event) =>
                  onChange({
                    ...tool,
                    cooldownS:
                      event.target.value === ""
                        ? null
                        : Number(event.target.value),
                  })
                }
                className="workflow-field nodrag nopan w-16 rounded-md border border-neutral-200 bg-white px-1 py-0.5 text-xs"
              />
            </label>
            <ToggleRow
              label="cache"
              checked={tool.cache}
              onChange={(cache) => onChange({ ...tool, cache })}
            />
          </div>
          <div className="flex flex-col gap-1 rounded border border-dashed border-neutral-300 p-1.5">
            <FieldLabel>Test</FieldLabel>
            {tool.inputs.map((input, inputIndex) => (
              <TextField
                key={inputIndex}
                aria-label={`Test value for ${input.name}`}
                value={testArgs[input.name] ?? ""}
                placeholder={`Test value for {{${input.name || "input"}}}`}
                onCommit={(value) =>
                  setTestArgs({ ...testArgs, [input.name]: value })
                }
              />
            ))}
            <button
              type="button"
              onClick={() => void runTest()}
              disabled={isTesting || tool.name.trim() === ""}
              className="primary-button !min-h-7 !text-[11px]"
            >
              {isTesting ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <FlaskConical className="size-3.5" />
              )}
              {isTesting ? "Running…" : "Run test"}
            </button>
            {testResult ? (
              <pre className="max-h-32 overflow-auto whitespace-pre-wrap rounded bg-neutral-900 p-1.5 font-mono text-[10px] leading-4 text-neutral-100">
                {testResult}
              </pre>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {tool.description
            ? truncate(tool.description, 90)
            : "Describe when the agent should use this tool."}
        </p>
      )}
    </div>
  );
}

const ToolboxNodeView = memo(({ id, data, selected }: NodeProps<ToolboxNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<Wrench className="size-3.5" />}
      accent="#0d9488"
      summary={
        <div className="flex flex-col gap-1">
          <p className="text-xs text-neutral-600">
            {data.tools.length === 0
              ? "No custom tools yet."
              : `${data.tools.length} tool${data.tools.length === 1 ? "" : "s"}: ${data.tools
                  .map((tool) => tool.name || "(unnamed)")
                  .slice(0, 3)
                  .join(", ")}`}
          </p>
          <p className="text-[11px] text-neutral-400">
            {data.knowledge.filter((source) => source.attached).length}{" "}
            knowledge source
            {data.knowledge.filter((source) => source.attached).length === 1
              ? ""
              : "s"}{" "}
            attached
          </p>
        </div>
      }
      editor={
        <div className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <FieldLabel>Custom HTTP tools</FieldLabel>
            {data.tools.map((tool) => (
              <ToolEditor
                key={tool.id}
                tool={tool}
                onChange={(next) =>
                  updateNodeData(id, {
                    tools: data.tools.map((entry) =>
                      entry.id === tool.id ? next : entry
                    ),
                  })
                }
                onRemove={() =>
                  updateNodeData(id, {
                    tools: data.tools.filter((entry) => entry.id !== tool.id),
                  })
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                updateNodeData(id, { tools: [...data.tools, createTool()] })
              }
              className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
            >
              <Plus className="size-3" /> Add tool
            </button>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel>Knowledge sources</FieldLabel>
            {data.knowledge.map((source) => (
              <KnowledgeEditor
                key={source.id}
                source={source}
                onChange={(next) =>
                  updateNodeData(id, {
                    knowledge: data.knowledge.map((entry) =>
                      entry.id === source.id ? next : entry
                    ),
                  })
                }
                onRemove={() =>
                  updateNodeData(id, {
                    knowledge: data.knowledge.filter(
                      (entry) => entry.id !== source.id
                    ),
                  })
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                updateNodeData(id, {
                  knowledge: [...data.knowledge, createKnowledgeSource()],
                })
              }
              className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
            >
              <Plus className="size-3" /> Add source
            </button>
          </div>
        </div>
      }
    />
  );
});

/* -------------------------------------------------------------------------- */
/*                              Dispositions node                             */
/* -------------------------------------------------------------------------- */

function DispositionBadge({ answer }: { answer: Answer }) {
  switch (answer.type) {
    case "choice":
      return (
        <span>
          <b className="text-neutral-900">{answer.choice}</b> ·{" "}
          {Math.round((answer.probabilities[answer.choice] ?? 0) * 100)}%
        </span>
      );
    case "score":
      return (
        <span>
          score <b className="text-neutral-900">{answer.score.toFixed(2)}</b>
        </span>
      );
    case "noul":
      return (
        <span>
          <b className="text-neutral-900">
            {answer.noul >= answer.threshold ? "yes" : "no"}
          </b>{" "}
          · {Math.round(answer.noul * 100)}%
        </span>
      );
  }
}

function DispositionQuestionEditor({
  question,
  onChange,
  onRemove,
}: {
  question: QuestionDef;
  onChange: (question: QuestionDef) => void;
  onRemove: () => void;
}) {
  const type: "choice" | "noul" =
    question.type === "choice" ? "choice" : "noul";

  return (
    <div className="flex flex-col gap-1.5 rounded-lg border border-neutral-200/70 bg-neutral-50/80 p-2">
      <div className="flex items-center gap-1">
        <TextField
          aria-label="Question id"
          value={question.id}
          placeholder="question_id"
          className="!w-28 shrink-0 font-mono"
          onCommit={(id) => onChange({ ...question, id: slugify(id) || question.id })}
        />
        <Select
          aria-label="Question type"
          value={type}
          onChange={(event) => {
            const next = createQuestion(event.target.value as "choice" | "noul", 0);
            onChange({ ...next, id: question.id, instructions: question.instructions });
          }}
        >
          {(["choice", "noul"] as const).map((entry) => (
            <option key={entry} value={entry}>
              {DISPOSITION_TYPE_LABELS[entry]}
            </option>
          ))}
        </Select>
        <button
          type="button"
          aria-label="Remove question"
          onClick={onRemove}
          className="nodrag icon-button ml-auto shrink-0 hover:!text-red-600"
        >
          <Trash2 className="size-3" />
        </button>
      </div>
      <TextArea
        aria-label="Instructions"
        rows={2}
        value={question.instructions}
        placeholder="What to judge from the transcript when the call ends…"
        onCommit={(instructions) => onChange({ ...question, instructions })}
      />
      {question.type === "choice" ? (
        <div className="flex flex-col gap-1">
          {question.options.map((option, index) => (
            <div key={index} className="flex items-center gap-1">
              <TextField
                aria-label="Option key"
                value={option.key}
                placeholder="option"
                className="!w-24 shrink-0 font-mono"
                onCommit={(key) =>
                  onChange({
                    ...question,
                    options: question.options.map((entry, i) =>
                      i === index ? { ...entry, key: slugify(key) } : entry
                    ),
                  })
                }
              />
              <TextField
                aria-label="Option description"
                value={option.description}
                placeholder="Description (optional)"
                onCommit={(description) =>
                  onChange({
                    ...question,
                    options: question.options.map((entry, i) =>
                      i === index ? { ...entry, description } : entry
                    ),
                  })
                }
              />
              <button
                type="button"
                aria-label="Remove option"
                disabled={question.options.length <= 2}
                onClick={() =>
                  onChange({
                    ...question,
                    options: question.options.filter((_, i) => i !== index),
                  })
                }
                className="nodrag icon-button shrink-0 hover:!text-red-600 disabled:opacity-30"
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() =>
              onChange({
                ...question,
                options: [
                  ...question.options,
                  { key: `option_${question.options.length + 1}`, description: "" },
                ],
              })
            }
            className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
          >
            <Plus className="size-3" /> Add option
          </button>
        </div>
      ) : null}
      {question.type === "noul" ? (
        <label className="flex items-center gap-2 text-xs text-neutral-600">
          <span className="shrink-0">
            yes if ≥ <b className="font-mono">{question.threshold.toFixed(2)}</b>
          </span>
          <input
            type="range"
            min={0.05}
            max={0.95}
            step={0.05}
            value={question.threshold}
            onChange={(event) =>
              onChange({ ...question, threshold: Number(event.target.value) })
            }
            className="nodrag nopan w-full accent-violet-600"
          />
        </label>
      ) : null}
    </div>
  );
}

const DispositionsNodeView = memo(
  ({ id, data, selected }: NodeProps<DispositionsNode>) => {
    const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
    const { events } = useConversation();
    const disposition = [...events]
      .reverse()
      .find(
        (event) =>
          event.kind === "disposition" &&
          (event.nodeId === id || event.nodeId === undefined)
      );

    return (
      <AgentNodeFrame
        id={id}
        label={data.label}
        selected={selected}
        icon={<Flag className="size-3.5" />}
        accent="#059669"
        summary={
          <div className="flex flex-col gap-1">
            {data.questions.length === 0 ? (
              <p className="text-xs text-neutral-400">
                Post-call outcome questions. Click Edit to add one.
              </p>
            ) : (
              <ul className="flex flex-col gap-1">
                {data.questions.map((question) => {
                  const answer =
                    disposition?.kind === "disposition"
                      ? disposition.answers[question.id]
                      : undefined;

                  return (
                    <li
                      key={question.id}
                      className="flex items-baseline justify-between gap-2 text-xs"
                    >
                      <span className="truncate font-mono text-neutral-700">
                        {question.id}
                      </span>
                      {answer ? (
                        <span className="shrink-0 text-neutral-500">
                          <DispositionBadge answer={answer} />
                        </span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        }
        editor={
          <div className="flex flex-col gap-2">
            <FieldLabel>Post-call questions (Jev)</FieldLabel>
            {data.questions.map((question, index) => (
              <DispositionQuestionEditor
                key={index}
                question={question}
                onChange={(next) =>
                  updateNodeData(id, {
                    questions: data.questions.map((entry, i) =>
                      i === index ? next : entry
                    ),
                  })
                }
                onRemove={() =>
                  updateNodeData(id, {
                    questions: data.questions.filter((_, i) => i !== index),
                  })
                }
              />
            ))}
            <button
              type="button"
              onClick={() =>
                updateNodeData(id, {
                  questions: [
                    ...data.questions,
                    createQuestion("choice", data.questions.length + 1),
                  ],
                })
              }
              className="nodrag inline-flex min-h-7 items-center gap-1 self-start rounded-md px-1.5 text-xs text-violet-700 hover:bg-violet-50"
            >
              <Plus className="size-3" /> Add question
            </button>
            <p className="text-[11px] leading-relaxed text-neutral-400">
              Judged from the transcript when the conversation ends; answers
              land on the conversation record.
            </p>
          </div>
        }
      />
    );
  }
);

/* -------------------------------------------------------------------------- */
/*                              Workflow step nodes                            */
/* -------------------------------------------------------------------------- */

function useLatestJevAnswers(nodeId: string): Record<string, Answer> | null {
  const { events } = useConversation();
  const latest = [...events].reverse().find((event) => event.kind === "jev" && event.nodeId === nodeId);
  return latest?.kind === "jev" ? latest.answers : null;
}

const AgentJevStepView = memo(({ id, data, selected }: NodeProps<AgentJevNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
  const answers = useLatestJevAnswers(id);
  const node: AgentJevNode = { id, type: "jev", position: { x: 0, y: 0 }, data };

  const handles: HandleDef[] = [
    ...data.questions.flatMap(getQuestionHandles),
    { id: "any", label: "always", title: "Fires every time this node runs" },
  ];

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<Sparkles className="size-3.5" />}
      accent="#7c3aed"
      handles={handles}
      summary={
        data.questions.length === 0 ? (
          <p className="text-xs text-neutral-400">
            No questions yet. Click Edit to add one.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {data.questions.map((question) => {
              const answer = answers?.[question.id];
              return (
                <li
                  key={question.id}
                  className="flex items-baseline justify-between gap-2 text-xs"
                >
                  <span className="truncate font-mono text-neutral-700">
                    {question.id}
                  </span>
                  {answer ? (
                    <span className="shrink-0 text-neutral-500">
                      <DispositionBadge answer={answer} />
                    </span>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )
      }
      editor={
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-neutral-400">
            Wire an answer handle into a Scenario to route it explicitly (runs
            every turn). Unwired Jev nodes judge the transcript when the
            conversation ends, and their answers gate downstream steps.
          </p>
          {data.questions.map((question, index) => (
            <DispositionQuestionEditor
              key={index}
              question={question}
              onChange={(next) =>
                updateNodeData(id, {
                  questions: data.questions.map((entry, i) =>
                    i === index ? next : entry
                  ),
                })
              }
              onRemove={() =>
                updateNodeData(id, {
                  questions: data.questions.filter((_, i) => i !== index),
                })
              }
            />
          ))}
          <div className="flex flex-wrap gap-1">
            {(["choice", "noul"] as const).map((type) => (
              <button
                key={type}
                type="button"
                onClick={() =>
                  updateNodeData(id, {
                    questions: [
                      ...data.questions,
                      createQuestion(type, data.questions.length + 1),
                    ],
                  })
                }
                className="nodrag inline-flex min-h-7 items-center gap-1 rounded-lg border border-dashed border-neutral-300 px-2 py-1 text-xs text-neutral-600 hover:border-violet-400 hover:text-violet-700"
              >
                <Plus className="size-3" /> {DISPOSITION_TYPE_LABELS[type]}
              </button>
            ))}
          </div>
          <RunsWhenControl id={id} activation={getActivation(data)} />
        </div>
      }
    />
  );
});

const AgentLlmStepView = memo(({ id, data, selected }: NodeProps<AgentLlmNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();
  const { events } = useConversation();
  const step = [...events]
    .reverse()
    .find((event) => event.kind === "step" && event.nodeId === id);

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<Bot className="size-3.5" />}
      accent="#0ea5e9"
      summary={
        <div className="flex flex-col gap-1.5">
          <p className="text-xs text-neutral-500">
            <span className="font-medium text-neutral-700">
              {LLM_MODELS.find((model) => model.id === data.model)?.label ?? data.model}
            </span>
          </p>
          {step?.kind === "step" && step.output !== undefined ? (
            <p className="max-h-24 overflow-hidden whitespace-pre-wrap rounded bg-neutral-50 px-2 py-1 text-xs leading-relaxed text-neutral-700">
              {truncate(step.output, 220)}
            </p>
          ) : (
            <p className="text-xs leading-relaxed text-neutral-500">
              {truncate(data.prompt || "Empty prompt (step is skipped).", 130)}
            </p>
          )}
        </div>
      }
      editor={
        <div className="flex flex-col gap-2">
          <p className="text-[11px] leading-relaxed text-neutral-400">
            Runs when the conversation ends. Input is the transcript (plus any
            wired parent step output).
          </p>
          <label className="flex flex-col gap-1">
            <FieldLabel>Model</FieldLabel>
            <Select
              value={data.model}
              onChange={(event) => updateNodeData(id, { model: event.target.value })}
            >
              {!LLM_MODELS.some((model) => model.id === data.model) ? (
                <option value={data.model}>{data.model}</option>
              ) : null}
              {LLM_MODEL_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.label}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>System</FieldLabel>
            <TextArea
              rows={2}
              value={data.system}
              placeholder="You write CRM notes…"
              onCommit={(system) => updateNodeData(id, { system })}
            />
          </label>
          <label className="flex flex-col gap-1">
            <FieldLabel>Prompt</FieldLabel>
            <TextArea
              rows={5}
              value={data.prompt}
              placeholder="{{input}}"
              onCommit={(prompt) => updateNodeData(id, { prompt })}
            />
          </label>
          <p className="text-[11px] leading-relaxed text-neutral-400">
            Use <code>{"{{input}}"}</code> (transcript) and{" "}
            <code>{"{{answers.<id>}}"}</code> (Jev answers, with{" "}
            <code>.probability</code> / <code>.confidence</code>).
          </p>
          <RunsWhenControl id={id} activation={getActivation(data)} />
        </div>
      }
    />
  );
});

const AgentWebSearchStepView = memo(
  ({ id, data, selected }: NodeProps<AgentWebSearchNode>) => {
    const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();

    return (
      <AgentNodeFrame
        id={id}
        label={data.label}
        selected={selected}
        icon={<Search className="size-3.5" />}
        accent="#d97706"
        summary={
          <p className="text-xs leading-relaxed text-neutral-500">
            {truncate(data.query || "Empty query (step is skipped).", 120)}
          </p>
        }
        editor={
          <div className="flex flex-col gap-2">
            <label className="flex flex-col gap-1">
              <FieldLabel>Query</FieldLabel>
              <TextArea
                rows={2}
                value={data.query}
                placeholder="{{input}}"
                onCommit={(query) => updateNodeData(id, { query })}
              />
            </label>
            <label className="flex flex-col gap-1">
              <FieldLabel>Results</FieldLabel>
              <Select
                value={data.maxResults}
                onChange={(event) =>
                  updateNodeData(id, { maxResults: Number(event.target.value) })
                }
              >
                {WEB_SEARCH_RESULT_COUNTS.map((count) => (
                  <option key={count} value={count}>
                    {count}
                  </option>
                ))}
              </Select>
            </label>
            <RunsWhenControl id={id} activation={getActivation(data)} />
          </div>
        }
      />
    );
  }
);

const AgentFetchStepView = memo(({ id, data, selected }: NodeProps<AgentFetchNode>) => {
  const { updateNodeData } = useReactFlow<AgentGraphNode, AgentEdge>();

  return (
    <AgentNodeFrame
      id={id}
      label={data.label}
      selected={selected}
      icon={<Globe className="size-3.5" />}
      accent="#0d9488"
      summary={
        <p className="text-xs leading-relaxed text-neutral-500">
          {truncate(data.urls || "No URLs (step is skipped).", 120)}
        </p>
      }
      editor={
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <FieldLabel>URLs</FieldLabel>
            <TextArea
              rows={3}
              value={data.urls}
              placeholder="{{input}} — fetches the http(s) URLs found in the text"
              onCommit={(urls) => updateNodeData(id, { urls })}
            />
          </label>
          <RunsWhenControl id={id} activation={getActivation(data)} />
        </div>
      }
    />
  );
});

/* -------------------------------------------------------------------------- */
/*                                   Registry                                 */
/* -------------------------------------------------------------------------- */

export const agentNodeTypes: NodeTypes = {
  start: StartNodeView,
  agent: AgentNodeView,
  scenario: ScenarioNodeView,
  toolbox: ToolboxNodeView,
  dispositions: DispositionsNodeView,
  jev: AgentJevStepView,
  llm: AgentLlmStepView,
  "web-search": AgentWebSearchStepView,
  fetch: AgentFetchStepView,
};

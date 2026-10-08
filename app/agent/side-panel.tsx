"use client";

import { useDeleteFeed, useFeeds, useOthers } from "@liveblocks/react";
import { useNodesData } from "@xyflow/react";
import {
  AlertCircle,
  Bot,
  Check,
  ChevronLeft,
  ChevronRight,
  Copy,
  Database,
  Flag,
  Globe,
  Loader2,
  MessageSquarePlus,
  Mic,
  PhoneCall,
  Route,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Terminal,
  Trash2,
  Wrench,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Answer } from "../workflow/runs";
import type { RunStatus } from "../workflow/runs";
import { truncate } from "../workflow/shared";
import { useConversation } from "./conversation-context";
import type { ConversationEvent } from "./conversation";
import type { AgentSummary } from "./server/storage";
import { START_NODE_ID, type StartNode } from "./shared";

const MAX_CONVERSATIONS = 25;

type Tab = "chat" | "api";

/* -------------------------------------------------------------------------- */
/*                                   Helpers                                  */
/* -------------------------------------------------------------------------- */

function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function StatusIcon({ status }: { status: RunStatus }) {
  switch (status) {
    case "running":
      return <Loader2 className="size-3.5 animate-spin text-violet-600" />;
    case "complete":
      return <Check className="size-3.5 text-emerald-600" />;
    case "error":
      return <AlertCircle className="size-3.5 text-red-600" />;
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-3 last:mb-0">
      <h3 className="mb-1.5 text-[11px] font-medium text-neutral-600">
        {title}
      </h3>
      {children}
    </section>
  );
}

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

/* -------------------------------------------------------------------------- */
/*                                 Transcript                                 */
/* -------------------------------------------------------------------------- */

function JsonPreview({ value }: { value: unknown }) {
  return (
    <pre className="max-h-28 overflow-auto whitespace-pre-wrap rounded bg-neutral-50 px-1.5 py-1 font-mono text-[10px] leading-4 text-neutral-600">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function TranscriptRow({ event }: { event: ConversationEvent }) {
  switch (event.kind) {
    case "user":
      return (
        <div className="flex justify-end">
          <p className="max-w-[85%] whitespace-pre-wrap rounded-lg bg-neutral-200/70 px-2.5 py-1.5 text-xs leading-relaxed text-neutral-800">
            {event.text}
          </p>
        </div>
      );
    case "agent":
      return (
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1.5">
            <Bot className="size-3 shrink-0 text-violet-600" aria-hidden />
            <span className="text-[10px] font-medium text-neutral-500">
              Agent
            </span>
            {event.mock ? (
              <span className="rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700">
                mock
              </span>
            ) : null}
          </div>
          <p className="whitespace-pre-wrap rounded-lg bg-violet-50 px-2.5 py-1.5 text-xs leading-relaxed text-neutral-800">
            {event.text === "" ? (
              <span className="inline-flex gap-0.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 [animation-delay:150ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-violet-400 [animation-delay:300ms]" />
              </span>
            ) : (
              event.text
            )}
          </p>
        </div>
      );
    case "tool":
      return (
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            <Wrench className="size-3 shrink-0 text-amber-600" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-mono text-[11px] font-medium text-amber-800">
              {event.toolName}
            </span>
            {event.status === "running" ? (
              <Loader2 className="size-3 animate-spin text-amber-600" />
            ) : event.status === "complete" ? (
              <Check className="size-3 text-emerald-600" />
            ) : (
              <X className="size-3 text-red-600" />
            )}
            {event.durationMs !== undefined ? (
              <span className="text-[10px] tabular-nums text-neutral-400">
                {event.durationMs < 1000
                  ? `${event.durationMs} ms`
                  : `${(event.durationMs / 1000).toFixed(1)} s`}
              </span>
            ) : null}
          </div>
          {event.speech ? (
            <p className="mt-0.5 text-[11px] italic leading-relaxed text-neutral-500">
              “{event.speech}”
            </p>
          ) : null}
          {event.args && Object.keys(event.args).length > 0 ? (
            <div className="mt-1">
              <JsonPreview value={event.args} />
            </div>
          ) : null}
          {event.outputs && Object.keys(event.outputs).length > 0 ? (
            <div className="mt-1">
              <JsonPreview value={event.outputs} />
            </div>
          ) : null}
          {event.error ? (
            <p className="mt-1 text-[11px] text-red-700">{event.error}</p>
          ) : null}
        </div>
      );
    case "routing":
      return (
        <div className="flex items-start gap-1.5 px-0.5">
          <Route className="mt-0.5 size-3 shrink-0 text-amber-600" aria-hidden />
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {event.detail
              .map((detail) =>
                detail.answer === "exit"
                  ? `exited ${detail.scenarioLabel} (${Math.round(detail.probability * 100)}%)`
                  : `entered ${detail.scenarioLabel} (${Math.round(detail.probability * 100)}%)`
              )
              .join(" · ")}
          </p>
        </div>
      );
    case "extraction":
      return (
        <div className="flex items-start gap-1.5 px-0.5">
          <Database className="mt-0.5 size-3 shrink-0 text-teal-600" aria-hidden />
          <p className="text-[11px] leading-relaxed text-neutral-500">
            {event.changed.map((name) => (
              <span key={name} className="mr-2">
                <span className="font-mono text-neutral-700">{name}</span> ={" "}
                {truncate(event.variables[name] ?? "", 24)}
              </span>
            ))}
            {event.mock ? (
              <span className="rounded bg-amber-50 px-1 text-[9px] text-amber-700">
                mock
              </span>
            ) : null}
          </p>
        </div>
      );
    case "guardrail":
      return (
        <div className="flex flex-col gap-0.5 px-0.5">
          {event.checks.map((check) => (
            <p
              key={check.id}
              className="flex items-start gap-1.5 text-[11px] leading-relaxed text-neutral-500"
            >
              {check.pass ? (
                <ShieldCheck className="mt-0.5 size-3 shrink-0 text-emerald-600" />
              ) : (
                <AlertCircle className="mt-0.5 size-3 shrink-0 text-amber-500" />
              )}
              <span className="font-mono text-neutral-600">{check.id}</span>{" "}
              {check.detail}
            </p>
          ))}
        </div>
      );
    case "disposition":
      return (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 px-2 py-1.5">
          <div className="mb-1 flex items-center gap-1.5">
            <Flag className="size-3 shrink-0 text-emerald-600" aria-hidden />
            <span className="text-[10px] font-medium uppercase tracking-wide text-emerald-700">
              Dispositions
            </span>
          </div>
          <ul className="flex flex-col gap-0.5">
            {Object.entries(event.answers).map(([id, answer]) => (
              <li
                key={id}
                className="flex items-baseline justify-between gap-2 text-[11px]"
              >
                <span className="font-mono text-neutral-600">{id}</span>
                <span className="text-neutral-500">
                  <DispositionBadge answer={answer} />
                </span>
              </li>
            ))}
          </ul>
        </div>
      );
    case "jev":
      return (
        <div className="flex flex-col gap-0.5 px-0.5">
          <div className="flex items-center gap-1.5">
            <Sparkles className="size-3 shrink-0 text-violet-600" aria-hidden />
            <span className="text-[10px] font-medium text-neutral-500">
              Jev · {event.phase === "turn" ? "this turn" : "end of call"}
            </span>
            {event.mock ? (
              <span className="rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700">
                mock
              </span>
            ) : null}
          </div>
          {Object.entries(event.answers).map(([id, answer]) => (
            <p
              key={id}
              className="flex items-baseline justify-between gap-2 text-[11px] leading-relaxed"
            >
              <span className="font-mono text-neutral-600">{id}</span>
              <span className="text-neutral-500">
                <DispositionBadge answer={answer} />
              </span>
            </p>
          ))}
        </div>
      );
    case "step":
      return (
        <div className="rounded-lg border border-sky-200 bg-sky-50/60 px-2 py-1.5">
          <div className="flex items-center gap-1.5">
            {event.nodeType === "llm" ? (
              <Bot className="size-3 shrink-0 text-sky-600" aria-hidden />
            ) : event.nodeType === "web-search" ? (
              <Search className="size-3 shrink-0 text-sky-600" aria-hidden />
            ) : (
              <Globe className="size-3 shrink-0 text-sky-600" aria-hidden />
            )}
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-sky-800">
              {event.label}
            </span>
            {event.status === "running" ? (
              <Loader2 className="size-3 animate-spin text-sky-600" />
            ) : event.status === "complete" ? (
              <Check className="size-3 text-emerald-600" />
            ) : event.status === "error" ? (
              <X className="size-3 text-red-600" />
            ) : null}
            {event.durationMs !== undefined ? (
              <span className="text-[10px] tabular-nums text-neutral-400">
                {event.durationMs < 1000
                  ? `${event.durationMs} ms`
                  : `${(event.durationMs / 1000).toFixed(1)} s`}
              </span>
            ) : null}
            {event.mock ? (
              <span className="rounded bg-amber-50 px-1 text-[9px] font-medium text-amber-700">
                mock
              </span>
            ) : null}
          </div>
          {event.output !== undefined ? (
            <p className="mt-1 max-h-32 overflow-hidden whitespace-pre-wrap text-[11px] leading-relaxed text-neutral-600">
              {truncate(event.output, 400)}
            </p>
          ) : null}
          {event.error ? (
            <p className="mt-1 text-[11px] text-red-700">{event.error}</p>
          ) : null}
          {event.status === "skipped" ? (
            <p className="mt-0.5 text-[10px] text-neutral-400">
              Skipped: nothing to run.
            </p>
          ) : null}
        </div>
      );
    case "error":
      return (
        <p className="rounded-lg bg-red-50 px-2 py-1.5 text-[11px] text-red-700">
          {event.message}
        </p>
      );
    case "state":
      return null;
  }
}

function Transcript() {
  const { events, isLoading, selectedConversationId } = useConversation();
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [events]);

  if (!selectedConversationId) {
    return (
      <div className="panel-empty-state">
        <PhoneCall className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
        <p>Start a conversation to test this agent.</p>
      </div>
    );
  }

  if (isLoading && events.length === 0) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-neutral-400">
        <Loader2 className="size-3.5 animate-spin" /> Loading conversation…
      </p>
    );
  }

  const visible = events.filter((event) => event.kind !== "state");

  if (visible.length === 0) {
    return (
      <p className="px-1 text-xs text-neutral-400">
        Waiting for the first message…
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {visible.map((event) => (
        <TranscriptRow key={event.id} event={event} />
      ))}
      <div ref={bottomRef} />
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                             Conversation list                              */
/* -------------------------------------------------------------------------- */

function Viewers({ conversationId }: { conversationId: string }) {
  const viewers = useOthers((others) =>
    others
      .filter((other) => other.presence.selectedRunId === conversationId)
      .map((other) => other.info)
  );

  if (viewers.length === 0) {
    return null;
  }

  return (
    <span
      className="flex -space-x-1"
      title={viewers.map((viewer) => viewer.name).join(", ")}
    >
      {viewers.slice(0, 3).map((viewer, index) => (
        <span
          key={index}
          className="size-2.5 rounded-full ring-1 ring-white"
          style={{ background: viewer.color }}
        />
      ))}
    </span>
  );
}

function ConversationList() {
  const { feeds, isLoading } = useFeeds();
  const deleteFeed = useDeleteFeed();
  const { selectedConversationId, selectConversation } = useConversation();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const conversations = useMemo(
    () =>
      [...(feeds ?? [])]
        .sort(
          (a, b) =>
            Number(b.metadata.startedAt) - Number(a.metadata.startedAt)
        )
        .slice(0, MAX_CONVERSATIONS),
    [feeds]
  );

  const didAutoSelect = useRef(false);

  useEffect(() => {
    if (!didAutoSelect.current && conversations.length > 0) {
      didAutoSelect.current = true;
      if (selectedConversationId === null) {
        selectConversation(conversations[0].feedId);
      }
    }
  }, [conversations, selectedConversationId, selectConversation]);

  async function deleteConversation(feedId: string) {
    if (deletingId !== null) return;

    setDeletingId(feedId);
    setDeleteError(null);
    if (selectedConversationId === feedId) {
      selectConversation(null);
    }

    try {
      await deleteFeed(feedId);
    } catch {
      setDeleteError("Couldn't delete this conversation. Try again.");
    } finally {
      setDeletingId(null);
    }
  }

  if (isLoading) {
    return (
      <p className="flex items-center gap-2 px-1 text-xs text-neutral-400">
        <Loader2 className="size-3.5 animate-spin" /> Loading conversations…
      </p>
    );
  }

  return (
    <>
      {conversations.length === 0 && (
        <div className="panel-empty-state">
          <PhoneCall className="size-3.5 shrink-0 text-neutral-400" aria-hidden />
          <p>No conversations yet.</p>
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {conversations.map((conversation) => {
          const selected = conversation.feedId === selectedConversationId;
          const deleting = conversation.feedId === deletingId;

          return (
            <li
              key={conversation.feedId}
              className={`run-list-item flex items-center rounded-md border ${
                selected
                  ? "border-violet-200 bg-violet-50/70"
                  : "border-transparent hover:border-neutral-200 hover:bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() =>
                  selectConversation(selected ? null : conversation.feedId)
                }
                title={selected ? "Exit conversation" : "Open conversation"}
                aria-pressed={selected}
                disabled={deleting}
                className="flex min-w-0 flex-1 items-center gap-2.5 rounded-md px-2 py-1 text-left"
              >
                <StatusIcon status={conversation.metadata.status} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11px] font-medium text-neutral-800">
                    {conversation.metadata.input || "(new conversation)"}
                  </span>
                  <span className="mt-px block text-[10px] tabular-nums text-neutral-500">
                    {formatTime(Number(conversation.metadata.startedAt))}
                    {conversation.metadata.completedAt
                      ? ` · ended ${formatTime(
                          Number(conversation.metadata.completedAt)
                        )}`
                      : " · live"}
                  </span>
                </span>
                <Viewers conversationId={conversation.feedId} />
              </button>
              <button
                type="button"
                className="icon-button run-delete-button mr-1 shrink-0"
                onClick={() => void deleteConversation(conversation.feedId)}
                disabled={deletingId !== null}
                data-deleting={deleting || undefined}
                aria-label="Delete conversation"
                title="Delete conversation"
              >
                {deleting ? (
                  <Loader2 className="size-3 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-3" aria-hidden />
                )}
              </button>
            </li>
          );
        })}
      </ul>
      {deleteError && (
        <p role="alert" className="mt-2 px-1 text-[11px] text-red-600">
          {deleteError}
        </p>
      )}
    </>
  );
}

/* -------------------------------------------------------------------------- */
/*                                  Chat tab                                  */
/* -------------------------------------------------------------------------- */

function ChatTab({ agent }: { agent: AgentSummary }) {
  const startNode = useNodesData<StartNode>(START_NODE_ID);
  const {
    selectConversation,
    selectedConversationId,
    events,
    state,
  } = useConversation();
  const [opening, setOpening] = useState<string | null>(null);
  const [isStarting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [isSending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sample = startNode?.type === "start" ? startNode.data.sample : "";
  const openingValue = opening ?? sample;
  const ended = state?.ended ?? false;
  const isTyping = useMemo(
    () =>
      events.some((event) => event.kind === "agent" && event.text === "") ||
      isSending,
    [events, isSending]
  );

  async function start() {
    setStarting(true);
    setError(null);

    try {
      const response = await fetch(`/api/agents/${agent.agentId}/conversations`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          opening: openingValue.trim() === "" ? undefined : openingValue,
        }),
      });
      const json = (await response.json()) as {
        conversationId?: string;
        error?: string;
      };

      if (!response.ok || !json.conversationId) {
        throw new Error(json.error ?? `Request failed (${response.status})`);
      }

      selectConversation(json.conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start");
    } finally {
      setStarting(false);
    }
  }

  async function send(text: string, end = false) {
    if (!selectedConversationId) {
      return;
    }

    setSending(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/agents/${agent.agentId}/conversations/${selectedConversationId}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(end ? { end: true } : { text }),
        }
      );
      const json = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(json.error ?? `Request failed (${response.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send");
    } finally {
      setSending(false);
    }
  }

  const variableEntries = Object.entries(state?.variables ?? {}).filter(
    ([, value]) => value !== ""
  );

  return (
    <div className="runs-tab flex min-h-0 flex-1 flex-col">
      <div className="run-composer border-b border-neutral-200/70 p-2.5">
        <div className="mb-2.5 flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-50 text-violet-600">
            <PhoneCall className="size-3.5" aria-hidden />
          </span>
          <div>
            <h2 className="text-[13px] font-semibold text-neutral-900">
              Test your agent
            </h2>
            <p className="mt-0.5 text-[11px] text-neutral-500">
              Chat as the caller; scenario routing, tools and variables run on
              every turn.
            </p>
          </div>
        </div>
        <label
          htmlFor="conversation-opening"
          className="mb-1.5 block text-[11px] font-medium text-neutral-600"
        >
          First caller message (empty = agent speaks first)
        </label>
        <textarea
          id="conversation-opening"
          value={openingValue}
          rows={2}
          placeholder="What the caller says to open…"
          onChange={(event) => setOpening(event.target.value)}
          className="workflow-field block w-full resize-y rounded-md border border-neutral-200 bg-neutral-50/70 px-2 py-1.5 text-[11px] leading-5 text-neutral-700 placeholder:text-neutral-400 focus:border-violet-400 focus:bg-white focus:outline-none"
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => void start()}
            disabled={isStarting}
            className="primary-button !min-h-7 !text-[11px]"
          >
            {isStarting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <MessageSquarePlus className="size-3.5" />
            )}
            {isStarting ? "Starting…" : "New conversation"}
          </button>
          {opening !== null && opening !== sample ? (
            <button
              type="button"
              onClick={() => setOpening(null)}
              className="min-h-7 rounded-md px-2 text-[11px] text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900"
            >
              Reset to sample
            </button>
          ) : null}
          {error ? (
            <p
              role="alert"
              className="w-full rounded-lg bg-red-50 px-3 py-2 text-xs leading-relaxed text-red-700"
            >
              {error}
            </p>
          ) : null}
        </div>
      </div>

      <div className="run-history min-h-0 flex-1 overflow-y-auto p-2.5">
        <Section title="Conversations">
          <ConversationList />
        </Section>
        <Section title="Transcript">
          {variableEntries.length > 0 || (state?.activeScenarios.length ?? 0) > 0 ? (
            <div className="mb-2 flex flex-wrap gap-1">
              {state?.activeScenarios.map((scenarioId) => (
                <span
                  key={scenarioId}
                  className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
                  title="Active scenario"
                >
                  <Route className="mr-0.5 inline size-2.5" aria-hidden />
                  {scenarioId}
                </span>
              ))}
              {variableEntries.map(([name, value]) => (
                <span
                  key={name}
                  className="rounded bg-teal-50 px-1.5 py-0.5 font-mono text-[10px] text-teal-700"
                >
                  {name}={truncate(value, 16)}
                </span>
              ))}
            </div>
          ) : null}
          <Transcript />
        </Section>
      </div>

      {selectedConversationId ? (
        <div className="conversation-composer flex items-end gap-1.5 border-t border-neutral-200/70 p-2">
          <textarea
            aria-label="Caller message"
            value={message}
            rows={2}
            placeholder={
              ended ? "Conversation ended — start a new one." : "Type as the caller…"
            }
            disabled={ended || isSending}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (message.trim() !== "" && !ended) {
                  void send(message);
                  setMessage("");
                }
              }
            }}
            className="workflow-field block min-h-0 flex-1 resize-none rounded-md border border-neutral-200 bg-neutral-50/70 px-2 py-1.5 text-xs leading-5 text-neutral-700 placeholder:text-neutral-400 focus:border-violet-400 focus:bg-white focus:outline-none disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => {
              if (message.trim() !== "" && !ended) {
                void send(message);
                setMessage("");
              }
            }}
            disabled={ended || isSending || message.trim() === ""}
            title="Send as the caller"
            aria-label="Send as the caller"
            className="primary-button !min-h-8 !px-2.5"
          >
            {isTyping ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Send className="size-3.5" />
            )}
          </button>
          <button
            type="button"
            onClick={() => void send("", true)}
            disabled={ended || isSending}
            title="End the conversation (runs dispositions)"
            className="icon-button !min-h-8 shrink-0 hover:!text-red-600"
          >
            <PhoneCall className="size-3.5" />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                   API tab                                  */
/* -------------------------------------------------------------------------- */

function ApiTab({ agent }: { agent: AgentSummary }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [origin, setOrigin] = useState("http://localhost:3000");

  useEffect(() => {
    setOrigin(window.location.origin);
  }, []);

  const startSnippet = [
    `curl -X POST "${origin}/api/agents/${agent.agentId}/conversations" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"opening": "Hi, who is this?"}'`,
  ].join("\n");

  const messageSnippet = [
    `curl -X POST "${origin}/api/agents/${agent.agentId}/conversations/<conversationId>/messages" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"text": "We run about twelve trucks out of Elizabeth."}'`,
  ].join("\n");

  async function copy(key: string, snippet: string) {
    await navigator.clipboard.writeText(snippet);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs text-neutral-600">
      <div className="flex shrink-0 items-center gap-2">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-neutral-100 text-neutral-700">
          <Terminal className="size-3.5" aria-hidden />
        </span>
        <div>
          <h2 className="text-[13px] font-semibold text-neutral-900">
            API access
          </h2>
          <p className="mt-0.5 text-[11px] text-neutral-500">
            Drive this agent&apos;s conversations over HTTP.
          </p>
        </div>
      </div>
      {(
        [
          ["start", "Start a conversation", startSnippet],
          ["message", "Send a caller turn", messageSnippet],
        ] as const
      ).map(([key, title, snippet]) => (
        <div
          key={key}
          className="shrink-0 overflow-hidden rounded-lg bg-[#20212a] shadow-sm"
        >
          <div className="flex items-center gap-0.5 border-b border-white/10 px-1.5 py-1">
            <span className="px-2 py-1 text-[11px] font-medium text-neutral-300">
              {title}
            </span>
            <button
              type="button"
              onClick={() => void copy(key, snippet)}
              className="ml-auto inline-flex min-h-7 items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-neutral-300 hover:bg-neutral-700 hover:text-white"
            >
              {copied === key ? (
                <Check className="size-3" />
              ) : (
                <Copy className="size-3" />
              )}
              {copied === key ? "Copied" : "Copy"}
            </button>
          </div>
          <pre className="overflow-x-auto p-3 font-mono text-[11px] leading-5 text-neutral-100">
            {snippet}
          </pre>
        </div>
      ))}
      <p className="shrink-0 leading-relaxed">
        Each turn runs the full loop — Jev scenario routing, knowledge,
        tool-calling, variable extraction and guardrails — and streams into the
        conversation feed for everyone in the room. End a conversation with{" "}
        <code className="rounded bg-neutral-100 px-1">{`{"end": true}`}</code>{" "}
        to trigger dispositions. Without API keys the LLM replies are mocked;
        Jev routing and HTTP tools still run.
      </p>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*                                 Side panel                                 */
/* -------------------------------------------------------------------------- */

export function AgentSidePanel({ agent }: { agent: AgentSummary }) {
  const [tab, setTab] = useState<Tab>("chat");
  const [collapsed, setCollapsed] = useState(false);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => setCollapsed(false)}
        aria-label="Show side panel"
        className="panel-collapsed flex w-7 shrink-0 items-center justify-center border-l border-neutral-200 bg-white text-neutral-500 hover:bg-neutral-50"
      >
        <ChevronLeft className="size-4" />
      </button>
    );
  }

  return (
    <aside
      className="workflow-side-panel"
      aria-label="Agent testing and API"
    >
      <div className="flex h-9 shrink-0 items-center gap-1 border-b border-neutral-200/70 px-1.5">
        {(
          [
            ["chat", "Chat", <Mic key="chat" className="size-3" />],
            ["api", "API", <Terminal key="api" className="size-3.5" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-pressed={tab === id}
            className={`inline-flex h-6 items-center gap-1.5 rounded-md px-2 text-[11px] font-medium ${
              tab === id
                ? "bg-violet-50 text-violet-700"
                : "text-neutral-500 hover:text-neutral-900"
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setCollapsed(true)}
          aria-label="Hide side panel"
          className="icon-button ml-auto"
        >
          <ChevronRight className="size-4" />
        </button>
      </div>
      {tab === "chat" ? <ChatTab agent={agent} /> : <ApiTab agent={agent} />}
    </aside>
  );
}

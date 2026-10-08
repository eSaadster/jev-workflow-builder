"use client";

import { useFeedMessages, useUpdateMyPresence } from "@liveblocks/react";
import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  isConversationEvent,
  type ConversationEvent,
  type ConversationStateEvent,
} from "./conversation";

export type ConversationContextValue = {
  selectedConversationId: string | null;
  selectConversation: (conversationId: string | null) => void;
  // All events of the selected conversation, oldest first.
  events: readonly ConversationEvent[];
  // The latest state event (variables, active scenarios, ended).
  state: ConversationStateEvent | null;
  // Scenario node ids active in the latest routing decision.
  activeScenarioIds: ReadonlySet<string>;
  isLoading: boolean;
};

const ConversationContext = createContext<ConversationContextValue | null>(
  null
);

/**
 * Holds the conversation selected in the side panel and its feed events, so
 * the transcript and the canvas (active scenario highlight) read from one
 * place. Mirrors the workflow RunProvider.
 */
export function ConversationProvider({ children }: { children: ReactNode }) {
  const [selectedConversationId, setSelectedConversationId] = useState<
    string | null
  >(null);
  const [events, setEvents] = useState<readonly ConversationEvent[]>([]);
  const [isLoading, setLoading] = useState(false);
  const updateMyPresence = useUpdateMyPresence();

  useEffect(() => {
    updateMyPresence({ selectedRunId: selectedConversationId });
  }, [selectedConversationId, updateMyPresence]);

  const state = useMemo(() => {
    return (
      [...events]
        .reverse()
        .find(
          (event): event is ConversationStateEvent => event.kind === "state"
        ) ?? null
    );
  }, [events]);

  const activeScenarioIds = useMemo(() => {
    const routing = [...events]
      .reverse()
      .find((event) => event.kind === "routing");

    if (routing?.kind === "routing") {
      return new Set<string>(routing.active);
    }

    return new Set<string>();
  }, [events]);

  const value = useMemo<ConversationContextValue>(
    () => ({
      selectedConversationId,
      selectConversation: setSelectedConversationId,
      events,
      state,
      activeScenarioIds,
      isLoading,
    }),
    [selectedConversationId, events, state, activeScenarioIds, isLoading]
  );

  return (
    <ConversationContext.Provider value={value}>
      {selectedConversationId ? (
        <ConversationLoader
          key={selectedConversationId}
          conversationId={selectedConversationId}
          onChange={setEvents}
          onLoading={setLoading}
        />
      ) : (
        <ClearEvents onChange={setEvents} />
      )}
      {children}
    </ConversationContext.Provider>
  );
}

function ClearEvents({
  onChange,
}: {
  onChange: (events: readonly ConversationEvent[]) => void;
}) {
  useEffect(() => {
    onChange([]);
  }, [onChange]);

  return null;
}

function ConversationLoader({
  conversationId,
  onChange,
  onLoading,
}: {
  conversationId: string;
  onChange: (events: readonly ConversationEvent[]) => void;
  onLoading: (isLoading: boolean) => void;
}) {
  const result = useFeedMessages(conversationId);

  useEffect(() => {
    onLoading(result.isLoading);
  }, [result.isLoading, onLoading]);

  useEffect(() => {
    if (result.messages) {
      onChange(
        [...result.messages]
          .map((message) => message.data as unknown)
          .filter(isConversationEvent)
          .sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
      );
    }
  }, [result.messages, onChange]);

  return null;
}

export function useConversation(): ConversationContextValue {
  const context = useContext(ConversationContext);

  if (!context) {
    throw new Error(
      "useConversation must be used within a ConversationProvider"
    );
  }

  return context;
}

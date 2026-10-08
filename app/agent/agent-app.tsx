"use client";

import {
  ClientSideSuspense,
  LiveblocksProvider,
  RoomProvider,
} from "@liveblocks/react/suspense";
import { ReactFlowProvider } from "@xyflow/react";
import { useSearchParams } from "next/navigation";
import { useCallback } from "react";
import Loading from "../loading";
import { getUserForPreview } from "../database";
import { AgentEditor } from "./editor";
import { AgentHeader } from "./header";
import { ConversationProvider } from "./conversation-context";
import type { AgentSummary } from "./server/storage";
import { AgentSidePanel } from "./side-panel";

export function AgentApp({
  roomId,
  agent,
  exampleId,
}: {
  roomId: string;
  agent: AgentSummary;
  exampleId: string | null;
}) {
  const searchParams = useSearchParams();
  // Used when deploying an example on liveblocks.io: each preview pane gets a
  // distinct demo user. Ignore locally (a random user is picked instead).
  const examplePreview = searchParams.get("examplePreview");

  const authEndpoint = useCallback(
    async (room?: string) => {
      const user = getUserForPreview(
        examplePreview ? Number(examplePreview) : null
      );
      const response = await fetch("/api/liveblocks-auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ room, userId: user.id }),
      });

      return (await response.json()) as { token: string };
    },
    [examplePreview]
  );

  return (
    <LiveblocksProvider
      throttle={16}
      authEndpoint={authEndpoint}
      baseUrl={process.env.NEXT_PUBLIC_LIVEBLOCKS_BASE_URL}
      resolveUsers={async ({ userIds }) => {
        const params = new URLSearchParams(
          userIds.map((userId) => ["userIds", userId])
        );
        const response = await fetch(`/api/users?${params}`);

        if (!response.ok) {
          throw new Error("Problem resolving users");
        }

        return (await response.json()) as Liveblocks["UserMeta"]["info"][];
      }}
      resolveMentionSuggestions={async ({ text }) => {
        const response = await fetch(
          `/api/users/search?text=${encodeURIComponent(text)}`
        );

        if (!response.ok) {
          throw new Error("Problem resolving mention suggestions");
        }

        return (await response.json()) as string[];
      }}
    >
      <RoomProvider id={roomId} initialPresence={{ selectedRunId: null }}>
        <ClientSideSuspense fallback={<Loading />}>
          <ReactFlowProvider>
            <ConversationProvider>
              <div className="flex h-dvh flex-col overflow-hidden text-neutral-900">
                <AgentHeader agent={agent} exampleId={exampleId} />
                <div className="workspace-body flex min-h-0 flex-1">
                  <AgentEditor className="min-w-0 flex-1" />
                  <AgentSidePanel agent={agent} />
                </div>
              </div>
            </ConversationProvider>
          </ReactFlowProvider>
        </ClientSideSuspense>
      </RoomProvider>
    </LiveblocksProvider>
  );
}

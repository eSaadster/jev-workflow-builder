"use client";

import { AvatarStack } from "@liveblocks/react-ui";
import { Bot, ChevronRight, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { HelpButton } from "../../components/help-button";
import { createAgentAction, renameAgentAction } from "./agent-actions";
import type { AgentSummary } from "./server/storage";

export function AgentHeader({
  agent,
  exampleId,
}: {
  agent: AgentSummary;
  exampleId: string | null;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [name, setName] = useState(agent.name);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    setName(agent.name);
  }, [agent.name]);

  const search = searchParams.toString();
  const suffix = search ? `?${search}` : "";

  function commitName() {
    const next = name.trim() || "Untitled agent";
    setName(next);

    if (next === agent.name) {
      return;
    }

    startTransition(async () => {
      await renameAgentAction(agent.agentId, exampleId, next);
      router.refresh();
    });
  }

  return (
    <header className="workspace-header">
      <Link href={`/${suffix}`} className="brand-mark shrink-0" aria-label="Home">
        <Bot className="size-4" aria-hidden />
      </Link>
      <Link
        href={`/${suffix}`}
        className="hidden text-[13px] text-neutral-500 transition-colors hover:text-neutral-900 lg:block"
      >
        Agents
      </Link>
      <ChevronRight
        className="hidden size-3.5 shrink-0 text-neutral-300 lg:block"
        aria-hidden
      />

      <div className="workflow-title-field">
        <span className="workflow-title-measure" aria-hidden>
          {name || " "}
        </span>
        <input
          aria-label="Agent name"
          size={1}
          value={name}
          disabled={isPending}
          onChange={(event) => setName(event.target.value)}
          onBlur={commitName}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.currentTarget.blur();
            } else if (event.key === "Escape") {
              setName(agent.name);
              event.currentTarget.blur();
            }
          }}
          className="workflow-title"
        />
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-1 sm:gap-2">
        <div className="hidden border-r border-neutral-200 pr-3 sm:block">
          <AvatarStack size={24} gap={3} max={3} />
        </div>
        <button
          type="button"
          title="New agent"
          aria-label="New agent"
          disabled={isPending}
          onClick={() => startTransition(() => createAgentAction(exampleId))}
          className="icon-button"
        >
          <Plus className="size-4" />
        </button>
        <HelpButton />
      </div>
    </header>
  );
}

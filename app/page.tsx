import { WorkflowList } from "./workflow/workflow-list";
import {
  ensureSummitWorkflow,
  listWorkflows,
} from "./workflow/server/liveblocks";
import { ensureDemoAgent, listAgents } from "./agent/server/storage";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function getParam(params: SearchParams, key: string): string | null {
  const value = params[key];
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

/**
 * Lists workflows and call agents (one Liveblocks room each). Both are
 * created explicitly; a demo of each is seeded on first load.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  // Used when deploying an example on liveblocks.io. Ignore locally.
  const exampleId = getParam(params, "exampleId");

  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return (
      <main className="flex h-dvh items-center justify-center p-8 text-sm text-neutral-600">
        Set{" "}
        <code className="mx-1 rounded bg-neutral-100 px-1">
          LIVEBLOCKS_SECRET_KEY
        </code>{" "}
        in
        <code className="mx-1 rounded bg-neutral-100 px-1">.env.local</code> to
        get started.
      </main>
    );
  }

  await ensureSummitWorkflow(exampleId);
  const workflows = await listWorkflows(exampleId);
  await ensureDemoAgent(exampleId);
  const agents = await listAgents(exampleId);

  return (
    <WorkflowList workflows={workflows} agents={agents} exampleId={exampleId} />
  );
}

# Blueprint: Conversation / Call-Agent Builder on top of jev-workflow-builder

**Branch:** `call-workflow-builder` · **Date:** 2026-10-08
**Source of requirements:** live read of the Bland.ai v2 dashboard — agent "Norma" (`c7ddd31a-3290-4477-a92e-c810f9c47f25`), full **Build** section (Agent, Knowledge, Tools, Pathways) plus Guardrails, Environments, and the test/simulation panels.

---

## 1. Goal

Turn this repo from a **batch workflow builder** (one input → DAG of Jev/LLM/search nodes → one output) into a **conversation-agent builder** in the Bland sense: an agent with a global persona, a per-conversation job prompt, knowledge sources, tools it can call mid-conversation, and **pathways** (scenario sub-behaviors with their own entry/exit conditions) — executed as a **turn-by-turn conversation loop** instead of a single-pass DAG, testable in a built-in chat/call simulator, and optionally deployed to live phone calls via the Bland API.

Everything below is designed to **reuse the existing substrate**: Liveblocks rooms as storage, Liveblocks feeds as run/conversation traces, the provider-module pattern (`llm.ts`, `typesafe.ts`, `tinyfish.ts`) with keyless mock fallbacks, the React Flow canvas, and the side-panel test UX.

---

## 2. What Bland's Build setup actually is (inventory from the live session)

### 2.1 The platform around the agent

| Area | What it contains |
|---|---|
| **Build** | Agent (canvas + inspector), Knowledge, Tools, Pathways |
| **Monitor** | Conversations, Issues, Alerts, Analytics ("Norm" assistant builds dashboards) |
| **Configure** | Environments (Development / Staging / Production, branches, **Publish**, version history with diffs), Dispositions (enterprise) |
| **Validate** | Evaluations — test cases (simulated callers with scripts) + judges (pass/fail/inconclusive criteria), suites that can block promotion |
| **Dispatch** | Channels (voice, SMS, RCS, iMessage, web chat), Triggers (automations), Batches |
| Misc | TTS Studio, contact card, phone numbers / IVR / transfer, TCPA guardrails |

Versioning model: everything saves as a draft on a **branch** (`Development / Main`), with **Publish** promoting to the environment, **Sync changes from other sessions** (multiplayer), and per-resource **version history + compare**.

### 2.2 The Agent page (canvas + inspector)

Canvas (right side): a small React-Flow-like graph — `Start` node ("Add startup step"), the **agent node** ("Norma") with its attached **Tools** group and **Pathways** below it, channel toggles (**Calls** / **Web chat**), a **Test** button, and a **Manual / Simulation** testing drawer (test channel: Voice / Phone call / Chat, agent-version selector, starting-pathway selector, saved configurations, per-test request data).

Inspector (left side), tabs **Prompt | Settings**, plus a separate **Guardrails** page section:

- **Prompt tab**
  - **Node prompt** ("the job it is doing in this conversation") — rich-text markdown; `@resource` mentions attach tools/knowledge inline; `{{variable}}` templating.
  - **System prompt** (global) — "personality, tone, and communication style to be used across all pathways."
  - **Variables to extract** — ordered list of `{ name, type, extraction prompt }`; "extraction adds latency to each turn"; per-variable options.
  - **Pathways** list — attached scenarios (name + entry-condition summary), drag to reorder.
  - **Tool references** / **Knowledge references** — attached resources, or `@tag` them in the prompt.
- **Settings tab** — Agent ID, name + color, **voice**, **languages** (number-level override wins), **channels** (Calls active / Web chat), **memory** ("retain conversation context for each contact across sessions and channels"), **metadata** (defaults returned in webhooks/call details), **request data** (facts the agent should know, exposed as `{{variables}}`), advanced: exclude responses from history, disable recording/logging (PCI), images (text channels only), delete.
- **Guardrails** — TCPA pack (AI disclosure, recording disclosure, self-introduction — each "within the window below"; opt-out) + **custom guardrails** (plain-language rules checked on every agent turn; enterprise).

### 2.3 Knowledge

Sources the agent can retrieve from on every call: PDF, TXT, CSV, JSON, DOCX, XLSX, URLs, text snippets, integrations. Attach/detach per agent. Supporting tabs: **Questions** (curated Q&A), **Query logs**, **Knowledge map**, **Source testing**. Sources have status (Active / Stale / Failed / Processing) and coverage scoring.

### 2.4 Tools

Two kinds: **Bland built-ins** (e.g. End Call, transfer, send text, contact card) and **custom API/webhook tools**. A custom tool's full schema:

- **Details**: name, *description* (what the agent reads to decide when to use it, ≤5000 chars), **agent speech** (what it says *while the tool runs*, e.g. "Oh, I've got a couple of good ones for that.").
- **Request**: method + URL (with `{{var}}` templating), query/header tables, auth. "Type `{{` to use request data, a system value or an earlier tool's response; wrap a new name in double braces for the agent to fill."
- **Inputs**: `{ variable, instructions ("what should the agent extract"), type, required, audio-extraction, sensitive }`.
- **Response**: output fields `{ name, type, JSON path, sensitive }` — "values to pull out of the response for the agent and later steps. With none, the tool doesn't wait for a reply." Sensitive values read `[REDACTED]` everywhere except live tool/webhook calls.
- **Settings**: timeout (default 30s), cooldown, cache-responses.
- **Owner**: agent-owned vs organization-shared. **Test** runner with stored secrets. Form/JSON views.

### 2.5 Pathways (scenarios)

"A scenario is a chunk of prompt with its own entry condition, its own tools, and a loop condition that says when it's finished. The agent picks up the scenario's instructions only when a conversation turns into that kind of job, and drops back to the main prompt when it is done."

Schema per pathway: **title**; **routing condition** — either `Conditions` (variables match set values) or `AI decides` (the agent decides from a prompt); **prompt** (markdown chunk); **"move forward once [x] condition is achieved"** (exit condition); own **variables to extract**, **tool references**, **knowledge references**. Pathways have their own version history, are tested in isolation (starting-pathway selector), and inherit agent advanced settings. Legacy pathway import/export exists.

### 2.6 The reference agent we read (Norma)

1 global system prompt (persona + platform reference) · 1 agent node prompt (the conversation job) · 4 extracted variables (`caller_name`, `caller_type`, `industry`, `use_case`) · 2 tools (built-in `End Call` invoked inline as `@End Call`; custom `Find examples` — GET httpbin with `{{industry}}`/`{{use_case}}` inputs, one output field) · 1 pathway (`Party tricks` — AI-decides routing, explicit exit condition). This is the shape our MVP must be able to express.

---

## 3. Concept mapping: Bland → this repo

| Bland concept | Equivalent here | Notes |
|---|---|---|
| Agent | **One Liveblocks room**, new `"agent"` room kind | Reuse room-per-document + multiplayer presence |
| System prompt (global) | Field on `AgentDoc` in room Storage | |
| Node prompt (job) | Field on `AgentDoc` | |
| Pathway / scenario | `ScenarioDoc` list in Storage + **canvas scenario nodes** | Routing implemented with Jev questions (see §5.2) |
| Variables to extract | `ExtractedVariable[]`, evaluated by Jev per turn | Jev noul/choice fits 1:1 |
| Custom tool | `ToolDoc` registry in Storage | Executor = templated HTTP, like `fetch` node generalized |
| Bland built-in tools | Small set of local built-ins (`end_conversation`, `handoff`, …) | Same interface as custom tools |
| Knowledge sources | `KnowledgeSourceDoc` + ingestion via TinyFish fetch + retrieval | Web URLs work keyless today |
| Conversation | **One Liveblocks feed** (messages = turns/tool calls/extractions) | Mirrors run-per-feed today |
| Test panel (chat/voice, manual/simulation) | Side-panel **Chat test** + **Simulated caller** | Simulation = scripted turns through same engine |
| Dispositions / judges | Post-call Jev questions over the transcript | Already our core competency |
| Environments / Publish / branches | Deferred (phase 6) | Storage is live-edited today anyway |

**The one structural difference to respect:** this repo's engine is a bounded single-pass DAG (`MAX_NODE_EXECUTIONS = 25`, `RUN_TIMEOUT_MS = 180s`, request-scoped via `after()`). A conversation is an unbounded, externally-driven **loop**. So we add a second runtime (turn engine) next to the DAG executor rather than bending the DAG executor into a loop.

---

## 4. Target architecture

```
┌─────────────────────────── One Liveblocks room = one agent ───────────────────────────┐
│ Storage:                                                                                │
│   flow        → authoring graph (input → agent → scenarios → dispositions/output)       │
│   agent       → AgentDoc      (persona, job prompt, voice, variables, guardrails, …)    │
│   scenarios   → ScenarioDoc[] (routing, prompt chunk, exit condition, refs)             │
│   tools       → ToolDoc[]     (custom HTTP tools + built-ins)                           │
│   knowledge   → KnowledgeSourceDoc[]                                                   │
│ Feeds:                                                                                  │
│   conv-<id>   → one conversation: turn messages, tool calls, extractions, disposition   │
└────────────────────────────────────────────────────────────────────────────────────────┘
        ▲ storage/feeds                       ▲ feeds (streaming transcript/trace)
        │                                     │
┌───────┴────────┐                    ┌───────┴────────┐
│  Builder UI    │                    │  Conversations │
│  (React Flow + │                    │  view + chat   │
│   inspector)   │                    │  test panel    │
└───────┬────────┘                    └───────┬────────┘
        │ read graph/docs                     │ POST /api/agents/[id]/conversations[/messages]
        ▼                                     ▼
┌─────────────────────────────  app/agent/server/turn-engine.ts  ───────────────────────┐
│ per user turn:                                                                         │
│  1. scenario routing   ── Jev choice question over scenarios, or variable conditions   │
│  2. compose context    ── global prompt + active scenario chunks + variables + memory  │
│  3. respond + tools    ── LLM (ai SDK) with function-calling over ToolDocs             │
│  4. extract variables  ── Jev questions per ExtractedVariable                           │
│  5. exit checks        ── scenario exit condition / end_conversation tool              │
│  6. guardrails         ── per-turn Jev checks (disclosures within window, opt-out)     │
│  everything streamed to the conversation feed; state in Storage (mock-friendly)        │
└───────┬──────────────────────────────────────┬────────────────────────────────────────┘
        │ reuses                               │ optional
        ▼                                      ▼
  llm.ts / typesafe.ts / tinyfish.ts      bland.ts (Bland provider: export agent,
  (existing provider modules)              send calls, receive webhooks) — same
                                           env-key-or-mock pattern as the others
```

Chat/web-chat conversations run the turn engine directly in Next.js route handlers (short, per-turn requests — fits the existing request-scoped model fine, since each turn is small). Live phone calls are delegated to the Bland provider (phase 4): export the authored agent to Bland, send `POST /v1/calls`, and map their webhooks back onto our conversation feeds.

---

## 5. Component design

### 5.1 Schema — `app/agent/shared.ts` (new; mirrors `app/workflow/shared.ts`)

```ts
export type ExtractedVariable = {
  id: string;
  name: string;                 // caller_name
  type: "string" | "number" | "boolean";
  prompt: string;               // how to extract this value
};

export type RoutingCondition =
  | { mode: "conditions"; rules: { variable: string; op: "equals" | "not_equals" | "contains"; value: string }[] }
  | { mode: "ai_decides"; description: string };   // becomes a Jev choice question

export type ScenarioDoc = {
  id: string;
  title: string;
  routing: RoutingCondition;
  prompt: string;               // markdown chunk, {{variable}} templated
  exitCondition: string;        // "move forward once … "
  variables: ExtractedVariable[];
  toolIds: string[];
  knowledgeIds: string[];
  order: number;                // Bland renders these in a draggable list
};

export type ToolDoc = {
  id: string;
  kind: "custom_http" | "end_conversation" | "handoff";   // built-ins share the shape
  name: string;
  description: string;          // the agent reads this to decide when to call it
  agentSpeech: string;          // spoken/typed while it runs
  request: { method: "GET" | "POST" | ...; url: string;
             query: { key: string; value: string }[]; headers: { key: string; value: string }[] };
  inputs:  { name: string; instructions: string; type: string;
             required: boolean; sensitive: boolean }[];
  outputs: { name: string; type: string; path: string; sensitive: boolean }[];
  settings: { timeoutMs: number; cooldownS?: number; cache: boolean };
};

export type KnowledgeSourceDoc = {
  id: string; name: string;
  type: "url" | "text";         // file types later
  source: string;               // URL or raw text
  status: "active" | "processing" | "failed" | "stale";
};

export type GuardrailDoc = {
  aiDisclosure:      { enabled: boolean; withinTurns: number };
  recordingDisclosure: { enabled: boolean; withinTurns: number };
  selfIntroduction:  { enabled: boolean; withinTurns: number };
  optOut: boolean;
  custom: { id: string; rule: string }[];   // checked every turn
};

export type AgentDoc = {
  id: string; name: string;
  model: string;                       // from existing LLM_MODELS
  systemPrompt: string;                // global persona
  taskPrompt: string;                  // the job for this conversation
  voiceId?: string; languages: string[];
  memory: boolean;
  variables: ExtractedVariable[];      // agent-level extraction
  metadata: Record<string, string>;
  requestData: Record<string, string>; // facts the agent knows, {{templated}}
  guardrails: GuardrailDoc;
  advanced: { excludeResponsesFromHistory: boolean;
              disableRecording: boolean; disableLogging: boolean };
};
```

Canvas node types (added to a **separate agent node registry**, not the workflow union, so the two builders don't bleed into each other):

- `input` (reused semantics) — call/contact context + request data; where outbound batch data would attach.
- **`agent`** node — singleton like today's `input`/`output`; renders persona summary, tools group, attached pathways (visually = Bland's agent card).
- **`scenario`** node — one per `ScenarioDoc`; shows title, routing mode badge, exit-condition line.
- **`jev`** nodes — optional explicit routing wiring for power users (Jev option → edge → scenario), reusable for dispositions.
- `output` (reused semantics) — **dispositions**: post-call Jev questions whose answers become the conversation outcome (Bland's dispositions, but deterministic).

### 5.2 Turn engine — `app/agent/server/turn-engine.ts` (new)

State per conversation (Storage-backed, keyed by feed id so it survives across per-turn requests):

```ts
type ConversationState = {
  agentId: string;
  channel: "chat" | "voice";
  variables: Record<string, string>;        // extracted so far (sensitive redacted in UI)
  activeScenarioIds: string[];
  turn: number;
  startedAt: number;
  contact?: { phone?: string; name?: string };
  toolCache: Record<string, { at: number; response: unknown }>;
};
```

Per inbound user turn:

1. **Route scenarios.** For each attached scenario evaluate entry:
   - `conditions` mode → pure variable match (no LLM, deterministic).
   - `ai_decides` mode → one batched **Jev choice question**: "Which of these jobs does this turn belong to: <scenario descriptions>" with one option per scenario (+ `none`). This is the deliberate design choice: *Bland's "AI decides" is implemented by our deterministic judgment brain*, which is the entire point of this repo. If an explicit `jev` node is wired to a scenario in the canvas, its fired edge takes precedence.
2. **Compose context.** `systemPrompt` + active scenario prompt chunks + "extracted variables so far" + memory summary (if enabled) + conversation history (respecting `excludeResponsesFromHistory`).
3. **Respond with tools.** `runLlm` extended with the ai SDK's `tools` parameter: each `ToolDoc` becomes a function schema (`inputs` → parameters, `description` → when-to-use). On invocation: emit the `agentSpeech` as an interim feed message, execute the tool (§5.3), feed mapped outputs back as a tool result, let the model continue (bounded loop, e.g. max 3 tool hops/turn).
4. **Extract variables.** Agent-level + newly-active-scenario variables run as **Jev noul/choice questions** over the latest turn (batched in one `askJev` call; skippable per turn for latency, catch-up on later turns — Bland warns "extraction adds latency to each turn" for the same reason).
5. **Exit checks.** Active scenario exit conditions → Jev noul question ("has <exitCondition> been achieved?") → deactivate scenario. `end_conversation` tool or explicit goodbye → finalize: run **dispositions** (output-node Jev questions over the transcript), write a disposition feed message, set feed metadata `status: "complete"`.
6. **Guardrails.** Per-turn Jev checks: disclosures "said within N turns" (search transcript + window), opt-out detection (immediate end/handoff). Custom rules likewise. All deterministic, all logged to the feed with pass/fail.

Every step writes feed messages (`{ kind: "turn" | "tool_call" | "extraction" | "routing" | "guardrail" | "disposition", … }`) — the conversation *is* its trace, exactly like workflow runs today.

### 5.3 Tools — `app/agent/server/tools.ts` (new)

- Render `url`/query/header values with the **existing `renderTemplate`**, extended with `{{conversation.<variable>}}`, `{{tools.<name>.<output>}}`, and tool-input slots (`{{industry}}` bound from the model's function-call arguments — required inputs validated, missing → model retry with the validation error).
- Execute via `fetch` with `settings.timeoutMs`; honor `cooldownS` and response `cache` (keyed on rendered request).
- Map `outputs` via JSON path (`$.data.…`); sensitive outputs stored redacted, un-redacted only inside the live tool context (matches Bland semantics).
- Built-ins (`end_conversation`, `handoff`) are local functions with the same interface.
- **Test runner**: same code path as Bland's tool "Run test" — a small API route + inspector button.

### 5.4 Knowledge — `app/agent/server/knowledge.ts` (new, phase 3)

- Ingestion: `url` sources via existing TinyFish `fetchPages` (markdown, truncated/chunked); `text` sources verbatim. Store chunks in the room (or a Liveblocks storage node).
- Retrieval: per turn, a Jev/LLM decision "does this turn need knowledge?" → top-k chunk selection (start lexical — the repo has no vector store; keep it pluggable).
- Query logs = feed messages, mirroring Bland's Query logs tab.

### 5.5 UI plan (phased)

- **Agent room page** `/a/[agentId]` (new route family, reusing `workflow-app.tsx` wiring): canvas with agent/scenario nodes + inspector (Prompt tab: task prompt, system prompt, variables, pathways, tool refs, knowledge refs — a direct homage to Bland's inspector; Settings tab; Guardrails tab).
- **Side panel** gains a **Chat test** mode (Manual): transcript view over the conversation feed + input box → `POST …/messages`. **Simulation** mode: pick a simulated-caller script (test case), auto-drive turns.
- **Conversations view**: list feeds for the room (status, channel, duration, dispositions) + open one to read the full transcript/trace.
- Home page lists agents next to workflows (different room-kind badge).

### 5.6 API routes (new)

```
POST /api/agents/[agentId]/conversations            → start conversation (returns convId)
POST /api/agents/[agentId]/conversations/[id]/messages  → one user turn; streams/returns agent reply
GET  /api/agents/[agentId]/conversations            → list (feed metadata)
POST /api/agents/[agentId]/tools/[toolId]/test      → tool test runner
POST /api/webhooks/bland                            → phase 4: call status/transcript events → feeds
POST /api/agents/[agentId]/calls                    → phase 4: send a live call via Bland
```

Per-turn requests keep the existing request-scoped execution style (`after()`, `maxDuration`); no long-lived server process is needed for chat. This is the same shape the drayage scripts already consume (`?wait=true` pattern carries over).

### 5.7 Bland provider — `app/agent/server/bland.ts` (phase 4)

Follows the established provider pattern (`BLAND_API_KEY` → real, else mock):

- **Export**: map `AgentDoc` + scenarios + tools → Bland's agent config (`POST /v1/agents`, docs.bland.ai/api-v1/post/agents) and keep a `blandAgentId` link in Storage.
- **Outbound**: `POST /v1/calls` (docs.bland.ai/quickstart) with metadata/request data.
- **Inbound events**: webhook route maps call transcripts/status onto conversation feeds so Bland-carried calls and simulator calls render identically in the Conversations view.
- Exact payload fields must be verified against docs at implementation time (v1 agents vs v2 branches endpoints both exist).

---

## 6. Implementation plan

| Phase | Deliverable | Files (new ● / changed ○) |
|---|---|---|
| **1. Agent model + chat engine (MVP)** | Author an agent (persona + job prompt + variables), converse in the built-in chat test, transcript as feed | ● `app/agent/shared.ts`, ● `app/agent/server/{storage,turn-engine,tools}.ts`, ● `app/api/agents/[agentId]/conversations{,/[/id]/messages}/route.ts`, ○ `app/workflow/server/liveblocks.ts` (generic doc read/write), ○ `app/workflow/server/llm.ts` (function-calling passthrough), ● `/a/[agentId]` page + chat panel components |
| **2. Pathways** | Scenario docs: routing (conditions + Jev-based "AI decides"), prompt chunks, exit conditions, per-scenario variables/tools; scenario nodes on canvas | ○ `turn-engine.ts` (routing/exit steps), ● scenario node view, ○ inspector Pathways section |
| **3. Tools & knowledge UI** | Tool registry editor (details/request/inputs/outputs/settings + test), built-ins, knowledge sources with URL ingestion + retrieval + query logs | ○ `tools.ts`, ● `knowledge.ts`, ● tool & knowledge inspector editors |
| **4. Bland integration** | Export agent, send live calls, webhook-ingest real call transcripts into conversations | ● `bland.ts`, ● `api/webhooks/bland/route.ts`, ○ conversations view |
| **5. Validate & monitor** | Dispositions (post-call Jev), test cases (scripted simulated callers), judges, conversations/issues list | ● evaluations module, ○ side panel Simulation tab |
| **6. Versioning (optional)** | Draft/publish, version history per resource, environments | Storage snapshots + UI (defer; biggest effort, least blocking) |

Phase 1 alone already reproduces the core Bland loop (prompt → variables → tools → conversation) and is demoable keyless via existing mocks. The drayage use case maps cleanly at phase 2: the qualifier Jev questions become routing/disposition questions on a live call.

---

## 7. Key design decisions & trade-offs

1. **New turn engine instead of extending the DAG executor.** The executor is a bounded single-pass Kahn loop; conversations are unbounded event loops with per-turn state. A per-turn DAG run ("run the workflow once per turn") was considered and rejected: it breaks tool-calling latency, scenario statefulness, and guardrail windows, and pays graph overhead on every turn. Providers, feeds, storage, and templating are all reused regardless.
2. **"AI decides" routing runs on Jev.** Bland's AI-decides entry conditions become Jev choice questions — deterministic, probabilistic, inspectable, and consistent with the repo's identity. Condition-mode routing stays pure variable matching (zero LLM cost).
3. **Scenario authoring is inspector-first (Bland-idiomatic), with optional canvas wiring (repo-idiomatic).** Scenario docs carry their own routing (simple, matches Bland UX); explicit `jev → scenario` edges remain available for power users and take precedence.
4. **Tools are function-calling inside the turn engine, not canvas nodes.** Mid-conversation tool choice is inherently model-driven; the canvas stays declarative (what exists), the engine handles when. Tool docs still get a full editor + test runner like Bland's.
5. **Live telephony via Bland first, not Twilio/STT/TTS plumbing.** Fastest path to real calls; the provider interface stays swappable for a self-hosted stack later. Chat simulator works without any telephony.
6. **State lives in Liveblocks (Storage + feeds), no new database.** Consistent with the repo; feeds already proved themselves as streaming traces. Memory-across-conversations (Bland's per-contact memory) will eventually need a contact dimension — flag for phase 6 if it matters.
7. **Mock-first everywhere** (existing pattern): simulator, tools (httpbin-style echoes), Bland export (dry-run) all run keyless.

---

## 8. Open questions (blocking-ish, in order)

1. **Execution substrate for v1**: built-in chat simulator only (recommended start), or is live voice via Bland required in the first milestone?
2. **Inbound vs outbound first** — outbound batch (drayage-style list qualification over calls) is the natural extension of the existing `.pi` scripts; inbound (number → agent) changes the integration shape (webhooks from call start).
3. Should **scenarios be graph nodes or inspector list items** as the primary authoring surface? (Blueprint assumes inspector-first + canvas mirroring, like Bland.)
4. Do we need **multi-agent org-level shared tools** (Bland's owner concept) in v1, or agent-scoped only?
5. Is **versioning/publish** actually needed given Liveblocks multiplayer editing, or can draft-live be acceptable longer-term?

---

## Appendix: source links

- Bland API — create agent: https://docs.bland.ai/api-v1/post/agents
- Bland quickstart (send a call): https://docs.bland.ai/quickstart
- Bland custom API tools tutorial: https://docs.bland.ai/tutorials/tools/custom-api
- Bland tools overview: https://docs.bland.ai/tutorials/tools/overview

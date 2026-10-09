/**
 * End-to-end smoke test for the AgentPhone wiring (mock mode — no
 * AGENTPHONE_API_KEY): connect → outbound call → webhook voice turns →
 * call_ended, then reads the conversation feed back from Liveblocks.
 *
 * Usage: node .pi/scripts/test-agentphone-flow.mjs [baseUrl]
 */
import { readFileSync } from "node:fs";
import { Liveblocks } from "@liveblocks/node";

const BASE = process.argv[2] ?? "http://localhost:3001";

const env = Object.fromEntries(
  readFileSync(new URL("../../.env", import.meta.url), "utf8")
    .split("\n")
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => {
      const i = line.indexOf("=");
      return [line.slice(0, i).trim(), line.slice(i + 1).trim()];
    })
);

const liveblocks = new Liveblocks({ secret: env.LIVEBLOCKS_SECRET_KEY });
const PREFIX = "liveblocks:examples:jev-call-agent-builder";

async function json(method, path, body, headers = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: response.status, body: parsed };
}

function check(label, result, expect) {
  const ok =
    expect.status === result.status &&
    Object.entries(expect.body ?? {}).every(
      ([key, value]) => result.body?.[key] === value
    );
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`, JSON.stringify(result.body));
  if (!ok) {
    process.exitCode = 1;
  }
  return result.body;
}

/* 1. Find the demo agent room */
const { data: rooms } = await liveblocks.getRooms({
  query: { metadata: { app: "jev-call-agent-builder" } },
  limit: 50,
});
const agent = rooms.find((room) => room.metadata?.name === "Drayage qualification agent") ?? rooms[0];

if (!agent?.metadata?.agentId) {
  console.error("FAIL  no agent rooms found — open the app once to seed the demo agent");
  process.exit(1);
}

const agentId = agent.metadata.agentId;
const roomId = `${PREFIX}:${agentId}`;
console.log(`using agent ${agent.metadata.name} (${agentId})`);

/* 2. Reset any leftover connection, then check disconnected state */
await json("POST", `/api/agents/${agentId}/phone`, { action: "disconnect" });
check("GET phone (disconnected)", await json("GET", `/api/agents/${agentId}/phone`), {
  status: 200,
  body: { connected: false },
});

/* 3. Connect (mock) */
const connected = check(
  "POST phone connect",
  await json("POST", `/api/agents/${agentId}/phone`, {
    action: "connect",
    webhookBaseUrl: BASE,
    transferNumber: "+15551234567",
  }),
  { status: 200, body: { connected: true } }
);
if (!connected.connection?.number?.startsWith("+1555")) {
  console.error("FAIL  expected mock +1555… number");
  process.exitCode = 1;
}

/* 4. Outbound call */
const call = check(
  "POST calls",
  await json("POST", `/api/agents/${agentId}/calls`, { toNumber: "+15559876543" }),
  { status: 200 }
);
console.log(`  callId=${call.callId} conversation=${call.conversationId} mock=${call.mock}`);
if (!call.conversationId?.startsWith("conv-call-")) {
  console.error("FAIL  conversation id should be derived from the call id");
  process.exitCode = 1;
}
if (!call.greeting || call.greeting.trim() === "") {
  console.error("FAIL  greeting should not be empty");
  process.exitCode = 1;
}

const webhook = `/api/agents/${agentId}/webhooks/agentphone`;

/* 5. First webhook voice turn (callee speaks; no agentId = the route trusts
      the per-agent webhook URL, which is where the real check happens) */
const turn1 = check(
  "webhook turn 1",
  await json("POST", webhook, {
    event: "agent.message",
    channel: "voice",
    data: {
      callId: call.callId,
      transcript: "Hi Dana, this is Marco — you caught me at a bad time, can I call you back?",
      from: "+15559876543",
      to: connected.connection.number,
      direction: "outbound",
    },
  }),
  { status: 200 }
);
if (typeof turn1.text !== "string" || turn1.text === "") {
  console.error("FAIL  webhook should reply with spoken text");
  process.exitCode = 1;
}

/* 6. A redelivered webhook id is ignored */
check(
  "webhook duplicate delivery",
  await json(
    "POST",
    webhook,
    {
      event: "agent.message",
      channel: "voice",
      data: { callId: call.callId, transcript: "same turn twice" },
    },
    { "X-Webhook-ID": "delivery-test-1" }
  ),
  { status: 200 }
);
check(
  "webhook duplicate delivery (repeat)",
  await json(
    "POST",
    webhook,
    {
      event: "agent.message",
      channel: "voice",
      data: { callId: call.callId, transcript: "same turn twice" },
    },
    { "X-Webhook-ID": "delivery-test-1" }
  ),
  { status: 200, body: { ignored: "duplicate delivery" } }
);

/* 7. Inbound call: first speech creates the conversation lazily */
const inboundCallId = "call_inbound_test_1";
const inbound = check(
  "webhook inbound first turn",
  await json("POST", webhook, {
    event: "agent.message",
    channel: "voice",
    data: {
      callId: inboundCallId,
      transcript: "Hello? Someone called me about a drayage load?",
      from: "+15551112222",
      to: connected.connection.number,
      direction: "inbound",
    },
  }),
  { status: 200 }
);
if (typeof inbound.text !== "string" || inbound.text === "") {
  console.error("FAIL  inbound first turn should create and reply");
  process.exitCode = 1;
}

/* 8. Unsupported channel is acked */
check(
  "webhook sms ignored",
  await json("POST", webhook, {
    event: "agent.message",
    channel: "sms",
    data: { message: "hi" },
  }),
  { status: 200, body: { ignored: "unsupported event" } }
);

/* 9. Bad signature is rejected only when verification applies (mock skips) —
      instead verify an unknown agent id mismatch */
check(
  "webhook agent mismatch",
  await json("POST", webhook, {
    event: "agent.message",
    channel: "voice",
    agentId: "agt_someone_else",
    data: { callId: "call_x", transcript: "hi" },
  }),
  { status: 200, body: { ignored: "agent id mismatch" } }
);

/* 10. Call ended: caller hung up on the outbound call */
check(
  "webhook call_ended",
  await json("POST", webhook, {
    event: "agent.call_ended",
    channel: "voice",
    data: {
      callId: call.callId,
      direction: "outbound",
      status: "completed",
      durationSeconds: 42,
      disconnectionReason: "customer_hangup",
      summary: "Caller asked for a callback.",
    },
  }),
  { status: 200, body: { acked: true } }
);

/* Give the after() finalize (dispositions + end-of-call steps) a moment */
await new Promise((resolve) => setTimeout(resolve, 4000));

/* 11. Read both feeds back */
for (const [label, feedId] of [
  ["outbound", call.conversationId],
  ["inbound", "conv-call-" + inboundCallId],
]) {
  try {
    const { data } = await liveblocks.getFeedMessages({ roomId, feedId });
    const events = data.map((m) => m.data).sort((a, b) => a.at - b.at);
    const kinds = events.map((e) => e.kind);
    const state = [...events].reverse().find((e) => e.kind === "state");
    const feed = await liveblocks.getFeed({ roomId, feedId });
    console.log(`\n${label} feed ${feedId}`);
    console.log(`  metadata: ${JSON.stringify(feed.metadata)}`);
    console.log(`  events:   ${kinds.join(", ")}`);
    console.log(`  ended:    ${state?.ended}`);

    const has = (kind) => kinds.includes(kind);
    const problems = [];
    if (!has("call")) problems.push("missing call event");
    if (!has("user") || !has("agent")) problems.push("missing transcript turns");
    if (label === "outbound" && !state?.ended) problems.push("should be ended after call_ended");
    if (label === "outbound" && feed.metadata.status !== "complete") problems.push("feed not complete");
    if (label === "outbound" && feed.metadata.trigger !== "call") problems.push("trigger should stay 'call'");
    if (label === "inbound" && feed.metadata.trigger !== "call") problems.push("inbound trigger should be 'call'");
    if (label === "inbound" && !feed.metadata.input?.includes("+15551112222")) problems.push("inbound input should show caller number");
    if (problems.length > 0) {
      console.error(`FAIL  ${label} feed: ${problems.join("; ")}`);
      process.exitCode = 1;
    } else {
      console.log("PASS  feed contents");
    }
  } catch (error) {
    console.error(`FAIL  ${label} feed ${feedId} unreadable:`, error?.status ?? error);
    process.exitCode = 1;
  }
}

/* 12. Disconnect */
check(
  "POST phone disconnect",
  await json("POST", `/api/agents/${agentId}/phone`, { action: "disconnect" }),
  { status: 200, body: { connected: false } }
);

console.log(process.exitCode ? "\nSMOKE TEST FAILED" : "\nSMOKE TEST PASSED");

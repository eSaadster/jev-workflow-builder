import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import { nanoid } from "nanoid";

// AgentPhone is the telephony provider (blueprint phase 4): it owns the phone
// number, STT/TTS and the call, while this app's turn engine stays the brain.
// Every call turn arrives as an `agent.message` webhook (channel "voice") with
// the caller's transcript; our reply JSON is spoken back. Without an API key
// everything here is mocked, like the other provider modules.
// https://docs.agentphone.ai

const DEFAULT_BASE_URL = "https://api.agentphone.ai/v1";
const MAX_ERROR_CHARS = 300;

// Voice webhooks allow 5–120s; one turn is a Jev batch + an LLM reply with
// tools, so take the ceiling to stay above TURN_TIMEOUT_MS (90s).
const WEBHOOK_TIMEOUT_SECONDS = 120;

/** One agent room ↔ one AgentPhone agent with an attached number. */
export type AgentPhoneConnection = {
  // AgentPhone agent id (agt_…).
  agentId: string;
  numberId: string;
  // E.164 number attached to the agent; inbound calls to it run this agent.
  number: string;
  // E.164 destination for the `handoff` tool (AgentPhone cold transfer).
  transferNumber?: string;
  webhookId?: string;
  // Per-webhook HMAC secret used to verify deliveries.
  webhookSecret: string;
  mock?: boolean;
};

export function isAgentPhoneConfigured(): boolean {
  return Boolean(process.env.AGENTPHONE_API_KEY);
}

function getBaseUrl(): string {
  return (process.env.AGENTPHONE_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

async function api<T>(path: string, init: RequestInit): Promise<T> {
  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${process.env.AGENTPHONE_API_KEY}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.text()).slice(0, MAX_ERROR_CHARS);
    throw new Error(
      `AgentPhone ${response.status}: ${body || response.statusText}`
    );
  }

  return (await response.json()) as T;
}

function firstString(record: unknown, keys: string[]): string | undefined {
  if (typeof record !== "object" || record === null) {
    return undefined;
  }

  for (const key of keys) {
    const value = (record as Record<string, unknown>)[key];

    if (typeof value === "string" && value !== "") {
      return value;
    }
  }

  return undefined;
}

/* -------------------------------------------------------------------------- */
/*                            Connection lifecycle                             */
/* -------------------------------------------------------------------------- */

/**
 * Provisions everything one agent room needs on AgentPhone: an agent in
 * webhook mode, a phone number attached to it, and a per-agent webhook whose
 * URL embeds this app's agentId (so deliveries need no lookup registry).
 */
export async function createAgentPhoneConnection(args: {
  name: string;
  webhookUrl: string;
  transferNumber?: string;
}): Promise<AgentPhoneConnection> {
  if (!isAgentPhoneConfigured()) {
    const digits = String(Math.floor(10_000_000 + Math.random() * 89_999_999));
    return {
      agentId: `agt-mock-${nanoid(8)}`,
      numberId: `num-mock-${nanoid(8)}`,
      number: `+1555${digits}`,
      ...(args.transferNumber ? { transferNumber: args.transferNumber } : {}),
      webhookSecret: "mock-secret",
      mock: true,
    };
  }

  const created = await api<{ id?: string }>("/agents", {
    method: "POST",
    body: JSON.stringify({ name: args.name }),
  });

  const agentId = firstString(created, ["id", "agentId"]);

  if (!agentId) {
    throw new Error("AgentPhone returned no agent id.");
  }

  if (args.transferNumber) {
    await api(`/agents/${agentId}`, {
      method: "PATCH",
      body: JSON.stringify({ transferNumber: args.transferNumber }),
    });
  }

  const number = await api<unknown>("/numbers", {
    method: "POST",
    body: JSON.stringify({}),
  });

  const numberId = firstString(number, ["id", "numberId"]);

  if (!numberId) {
    throw new Error("AgentPhone returned no number id.");
  }

  await api(`/agents/${agentId}/numbers`, {
    method: "POST",
    body: JSON.stringify({ numberId }),
  });

  const webhook = await api<unknown>(`/agents/${agentId}/webhook`, {
    method: "POST",
    body: JSON.stringify({
      url: args.webhookUrl,
      timeout: WEBHOOK_TIMEOUT_SECONDS,
    }),
  });

  const secret = firstString(webhook, ["secret", "signingSecret"]);

  if (!secret) {
    throw new Error("AgentPhone returned no webhook secret.");
  }

  return {
    agentId,
    numberId,
    number: firstString(number, ["number", "phoneNumber", "e164"]) ?? "(unknown)",
    ...(args.transferNumber ? { transferNumber: args.transferNumber } : {}),
    webhookId: firstString(webhook, ["id", "webhookId"]),
    webhookSecret: secret,
  };
}

/** Best effort: stop deliveries for a disconnected agent. */
export async function deleteAgentPhoneWebhook(
  connection: AgentPhoneConnection
): Promise<void> {
  if (connection.mock || !isAgentPhoneConfigured()) {
    return;
  }

  try {
    await api(`/agents/${connection.agentId}/webhook`, { method: "DELETE" });
  } catch (error) {
    console.error("AgentPhone webhook delete failed", error);
  }
}

/* -------------------------------------------------------------------------- */
/*                                  Outbound                                  */
/* -------------------------------------------------------------------------- */

export async function placeOutboundCall(args: {
  agentId: string;
  toNumber: string;
  // Spoken by AgentPhone's TTS when the call connects (the turn engine's
  // opening line, generated from the agent's persona).
  initialGreeting?: string;
}): Promise<{ callId: string; mock: boolean }> {
  if (!isAgentPhoneConfigured()) {
    return { callId: `call-mock-${nanoid(8)}`, mock: true };
  }

  const created = await api<unknown>("/calls", {
    method: "POST",
    body: JSON.stringify({
      agentId: args.agentId,
      toNumber: args.toNumber,
      ...(args.initialGreeting ? { initialGreeting: args.initialGreeting } : {}),
    }),
  });

  const callId = firstString(created, ["callId", "id"]);

  if (!callId) {
    throw new Error("AgentPhone returned no call id.");
  }

  return { callId, mock: false };
}

/* -------------------------------------------------------------------------- */
/*                              Webhook ingestion                              */
/* -------------------------------------------------------------------------- */

/** Deterministic mapping callId → conversation feed, no registry needed. */
export function callConversationId(callId: string): string {
  return `conv-call-${callId.replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/**
 * Verifies an AgentPhone delivery: HMAC-SHA256 over `${timestamp}.${rawBody}`
 * with the webhook secret, `sha256=<hex>` in X-Webhook-Signature.
 */
export function verifyAgentPhoneSignature(args: {
  secret: string;
  timestamp: string;
  rawBody: string;
  signature: string;
}): boolean {
  const digest = createHmac("sha256", args.secret)
    .update(`${args.timestamp}.${args.rawBody}`)
    .digest("hex");
  const expected = Buffer.from(`sha256=${digest}`, "utf8");
  const received = Buffer.from(args.signature, "utf8");

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}

/** Reject deliveries older than this window (replay protection). */
export const WEBHOOK_SKEW_MS = 5 * 60 * 1000;

export type AgentPhoneWebhookPayload = {
  event?: string;
  channel?: string;
  timestamp?: string;
  agentId?: string;
  data?: Record<string, unknown>;
};

export function payloadString(
  payload: AgentPhoneWebhookPayload,
  key: string
): string | undefined {
  return firstString(payload.data, [key]);
}

export function payloadNumber(
  payload: AgentPhoneWebhookPayload,
  key: string
): number | undefined {
  const value = payload.data?.[key];
  return typeof value === "number" ? value : undefined;
}

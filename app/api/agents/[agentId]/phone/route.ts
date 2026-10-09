import { NextRequest, NextResponse } from "next/server";
import {
  createAgentPhoneConnection,
  deleteAgentPhoneWebhook,
  isAgentPhoneConfigured,
  type AgentPhoneConnection,
} from "../../../../agent/server/agentphone";
import {
  getAgent,
  getAgentPhoneConnection,
  setAgentPhoneConnection,
} from "../../../../agent/server/storage";

/**
 * Manages this agent's phone number (AgentPhone).
 *
 *   GET  /api/agents/<agentId>/phone
 *   POST /api/agents/<agentId>/phone
 *        { "action": "connect", "webhookBaseUrl": "https://…", "transferNumber": "+1…" }
 *        { "action": "disconnect" }
 *
 * `connect` provisions an AgentPhone agent in webhook mode with its own
 * number, and registers a per-agent webhook whose URL embeds this agentId —
 * every call turn then runs the turn engine here. Without AGENTPHONE_API_KEY
 * the connection is mocked and calls don't place real audio.
 */

function connectionView(connection: AgentPhoneConnection) {
  return {
    number: connection.number,
    ...(connection.transferNumber
      ? { transferNumber: connection.transferNumber }
      : {}),
    mock: connection.mock ?? false,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing LIVEBLOCKS_SECRET_KEY" },
      { status: 403 }
    );
  }

  const { agentId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");
  const connection = await getAgentPhoneConnection(agentId, exampleId);

  return NextResponse.json({
    connected: connection !== null,
    ...(connection ? { connection: connectionView(connection) } : {}),
    configured: isAgentPhoneConfigured(),
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ agentId: string }> }
) {
  if (!process.env.LIVEBLOCKS_SECRET_KEY) {
    return NextResponse.json(
      { error: "Missing LIVEBLOCKS_SECRET_KEY" },
      { status: 403 }
    );
  }

  const { agentId } = await params;
  const exampleId = request.nextUrl.searchParams.get("exampleId");

  let body: {
    action?: unknown;
    webhookBaseUrl?: unknown;
    transferNumber?: unknown;
  } = {};

  try {
    body = (await request.json()) as typeof body;
  } catch {
    // Handled below: an empty body has no action.
  }

  const agent = await getAgent(agentId, exampleId);

  if (!agent) {
    return NextResponse.json({ error: "Agent not found" }, { status: 404 });
  }

  if (body.action === "disconnect") {
    const existing = await getAgentPhoneConnection(agentId, exampleId);

    if (existing) {
      await deleteAgentPhoneWebhook(existing);
      await setAgentPhoneConnection(agentId, exampleId, null);
    }

    return NextResponse.json({ connected: false });
  }

  if (body.action !== "connect") {
    return NextResponse.json(
      { error: '`action` must be "connect" or "disconnect"' },
      { status: 400 }
    );
  }

  // The registered webhook must be publicly reachable; in development that
  // means a tunnel (next.config.js allows ngrok/loca.lt origins). The env var
  // wins so deployments can pin the canonical host.
  const base =
    process.env.AGENTPHONE_WEBHOOK_BASE_URL ||
    (typeof body.webhookBaseUrl === "string" ? body.webhookBaseUrl : "") ||
    request.nextUrl.origin;

  if (!/^https?:\/\//.test(base)) {
    return NextResponse.json(
      { error: "`webhookBaseUrl` must be an http(s) URL" },
      { status: 400 }
    );
  }

  const webhookUrl = `${base.replace(/\/+$/, "")}/api/agents/${agentId}/webhooks/agentphone${
    exampleId ? `?exampleId=${encodeURIComponent(exampleId)}` : ""
  }`;

  const transferNumber =
    typeof body.transferNumber === "string" &&
    /^\+[1-9]\d{7,14}$/.test(body.transferNumber.trim())
      ? body.transferNumber.trim()
      : undefined;

  try {
    // Reconnecting replaces the previous connection (its webhook deliveries
    // stop when the new per-agent webhook is registered).
    const connection = await createAgentPhoneConnection({
      name: agent.name,
      webhookUrl,
      transferNumber,
    });

    await setAgentPhoneConnection(agentId, exampleId, connection);

    return NextResponse.json({
      connected: true,
      connection: connectionView(connection),
      webhookUrl,
      configured: isAgentPhoneConfigured(),
    });
  } catch (error) {
    console.error("AgentPhone connect failed", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to connect phone number",
      },
      { status: 502 }
    );
  }
}

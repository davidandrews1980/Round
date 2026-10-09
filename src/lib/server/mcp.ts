const PROTOCOL = "2024-11-05";

export type McpTool = { name: string; description: string };

export function assertMcpUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That is not a URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("MCP URL must be http or https");
  }
  const host = url.hostname.toLowerCase();
  if (host === "169.254.169.254" || host === "metadata.google.internal") {
    throw new Error("That address is blocked");
  }
  return url.toString();
}

type RpcResult = { body: unknown; session: string | null };

async function rpc(
  url: string,
  message: Record<string, unknown>,
  session?: string | null,
  notify = false,
): Promise<RpcResult> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (session) headers["Mcp-Session-Id"] = session;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(message),
    signal: AbortSignal.timeout(15_000),
    redirect: "error",
  });
  const nextSession = res.headers.get("mcp-session-id") ?? session ?? null;
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`MCP ${res.status}: ${text.slice(0, 180)}`);
  }
  if (notify || !text.trim()) return { body: null, session: nextSession };
  const json = parseRpcBody(text);
  if (json && typeof json === "object" && "error" in json && json.error) {
    const err = json.error as { message?: string };
    throw new Error(err.message || "MCP error");
  }
  return { body: json, session: nextSession };
}

function parseRpcBody(text: string): { result?: unknown; error?: unknown } | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as { result?: unknown; error?: unknown };
  for (const line of trimmed.split("\n")) {
    const data = line.startsWith("data:") ? line.slice(5).trim() : "";
    if (data.startsWith("{")) return JSON.parse(data) as { result?: unknown; error?: unknown };
  }
  return null;
}

export async function mcpListTools(rawUrl: string): Promise<McpTool[]> {
  const url = assertMcpUrl(rawUrl);
  const init = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "roundtable", version: "1" },
    },
  });
  await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session, true);
  const listed = await rpc(
    url,
    { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} },
    init.session,
  );
  const result = (listed.body as { result?: { tools?: { name?: string; description?: string }[] } } | null)
    ?.result;
  return (result?.tools ?? [])
    .filter((t) => t.name)
    .slice(0, 40)
    .map((t) => ({
      name: String(t.name),
      description: String(t.description ?? "").slice(0, 180),
    }));
}

export async function mcpCallTool(
  rawUrl: string,
  tool: string,
  argsText: string,
): Promise<string> {
  const url = assertMcpUrl(rawUrl);
  let args: Record<string, unknown> = {};
  if (argsText.trim()) {
    try {
      const parsed = JSON.parse(argsText) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        args = parsed as Record<string, unknown>;
      } else {
        args = { input: parsed };
      }
    } catch {
      args = { input: argsText };
    }
  }
  const init = await rpc(url, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "roundtable", version: "1" },
    },
  });
  await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, init.session, true);
  const called = await rpc(
    url,
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: { name: tool, arguments: args },
    },
    init.session,
  );
  const result = (called.body as { result?: unknown } | null)?.result;
  const text = JSON.stringify(result ?? {}).slice(0, 1500);
  return text;
}

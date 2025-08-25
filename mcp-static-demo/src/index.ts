export interface Env {
  MCP_TOKEN: string; // set via `wrangler secret put MCP_TOKEN`
}

type Tool = {
  name: string;
  description: string;
  input_schema: any;
};

const TOOLS: Tool[] = [
  {
    name: "search",
    description: "Search private corpus. Returns id, title, url, and a snippet.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string" },
        top_k: { type: "integer", minimum: 1, maximum: 10, default: 5 }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    name: "fetch",
    description: "Fetch a document by id and return its content.",
    input_schema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false
    }
  }
];

// --- Static, private domain knowledge (not on the public internet) ---
const CORPUS = [
  {
    id: "doc-42",
    title: "ACME Ops Playbook – Jellyfish Failover (v3.2)",
    url: "https://intranet.acme.local/runbooks/jellyfish-failover",
    content:
      "Jellyfish Failover – exact sequence:\n" +
      "1) Freeze new workload intake\n" +
      "2) Drain tasks from queue 'reef'\n" +
      "3) Promote standby 'polyp-2' to primary\n" +
      "4) Run post-switch check 'reef:health'\n" +
      "5) Notify on-call via #ops-jellyfish\n" +
      "Passphrase for controller unlock: purple-anvil\n"
  },
  {
    id: "doc-77",
    title: "ACME Codename Glossary",
    url: "https://intranet.acme.local/glossary/codenames",
    content:
      "Project HAWK → 'Share Insights' analytics; owner: Data Platform.\n" +
      "Project QUILL → Doc AI summarizer; owner: App Eng.\n"
  },
  {
    id: "doc-99",
    title: "ACME Blackout Dates 2025 (internal)",
    url: "https://intranet.acme.local/policies/blackouts-2025",
    content:
      "Change freeze windows: 2025-11-24..2025-12-02 and 2025-12-20..2026-01-05.\n"
  }
];



function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" }
  });
}

function unauthorized(): Response {
  return json({ error: "unauthorized" }, 401);
}

async function requireAuth(request: Request, env: Env) {
  const token = request.headers.get("authorization");
  console.log(token);
  console.log(env.MCP_TOKEN);
  if (!token || token !== `Bearer ${env.MCP_TOKEN}`) throw unauthorized();
}

export interface Env { MCP_TOKEN: string }

type JsonRpcReq =
  | { jsonrpc: "2.0"; id: number | string; method: "initialize"; params?: any }
  | { jsonrpc: "2.0"; id: number | string; method: "tools/list"; params?: { cursor?: string } }
  | { jsonrpc: "2.0"; id: number | string; method: "tools/call"; params: { name: string; arguments?: any } };

function ok(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });
}
function rpcResult(id: any, result: any) { return ok({ jsonrpc: "2.0", id, result }); }
function rpcError(id: any, code: number, message: string) { return ok({ jsonrpc: "2.0", id, error: { code, message } }, 400); }

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // Optional: keep a simple GET for sanity checks
    if (request.method === "GET" && url.pathname === "/tools/list") {
      return ok({ tools: TOOLS }); // handy for local smoke tests only
    }

    // === Single MCP endpoint (Streamable HTTP, JSON-RPC) ===
    if (url.pathname === "/mcp" && request.method === "POST") {
      try { await requireAuth(request, env); } catch (e: any) { return e as Response; }

      let body: JsonRpcReq;
      try { body = await request.json(); } catch { return rpcError(null, -32700, "Parse error"); }
      if (!body || body.jsonrpc !== "2.0" || !("method" in body)) return rpcError(null, -32600, "Invalid Request");

      const id = (body as any).id ?? null;

      // 1) initialize
      if (body.method === "initialize") {
        return rpcResult(id, {
          protocolVersion: "2025-06-18",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mcp-static-demo", version: "1.0.0" }
        });
      }

      // 2) tools/list
      if (body.method === "tools/list") {
        return rpcResult(id, { tools: TOOLS, nextCursor: null });
      }

      // 3) tools/call
      if (body.method === "tools/call") {
        const { name, arguments: args = {} } = body.params || {};
        if (name === "search") {
          const q = (args.query || "").toString().toLowerCase();
          if (!q) return rpcError(id, -32602, "Missing query");
          const topK = Math.min(10, Math.max(1, Number(args.top_k ?? 5)));
          const hits = CORPUS.filter(d => d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q))
                             .slice(0, topK)
                             .map(d => ({ id: d.id, title: d.title, url: d.url, snippet: d.content.slice(0, 200) }));
          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify({ results: hits, total: hits.length }) }],
            isError: false
          });
        }
        if (name === "fetch") {
          const idArg = args.id?.toString();
          const doc = CORPUS.find(d => d.id === idArg);
          if (!doc) return rpcResult(id, { content: [{ type: "text", text: "not_found" }], isError: true });
          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(doc) }],
            isError: false
          });
        }
        return rpcError(id, -32601, `Unknown tool: ${name}`);
      }

      return rpcError(id, -32601, `Unknown method: ${(body as any).method}`);
    }

    // Fallback
    return ok({ ok: true, message: "MCP static demo. Use POST /mcp with JSON-RPC." });
  }
};

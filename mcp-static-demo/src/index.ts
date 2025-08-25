export interface Env { MCP_TOKEN: string }

// ---- Tools (camelCase inputSchema) ----
const TOOLS = [
  {
    name: "search",
    description: "Search private corpus (title/content/url). Returns id/title/url ONLY. Use 'fetch' to read content.",
    inputSchema: {
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
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" } },
      required: ["id"],
      additionalProperties: false
    }
  }
];

// --- Static corpus (unchanged) ---
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
      "Demo token (NOT A SECRET): purple-anvil\n"
  },
  {
    id: "doc-77", title: "ACME Codename Glossary", url: "https://intranet.acme.local/glossary/codenames",
    content: "Project HAWK → 'Share Insights' analytics; owner: Data Platform.\nProject QUILL → Doc AI summarizer; owner: App Eng.\n"
  },
  {
    id: "doc-99", title: "ACME Blackout Dates 2025 (internal)", url: "https://intranet.acme.local/policies/blackouts-2025",
    content: "Change freeze windows: 2025-11-24..2025-12-02 and 2025-12-20..2026-01-05.\n"
  }
];

// ---------- helpers ----------
function ok(data: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}
function rpcResult(id: any, result: any) { return ok({ jsonrpc: "2.0", id, result }); }
function rpcError(id: any, code: number, message: string) {
  // JSON-RPC error, but transport stays 200
  return ok({ jsonrpc: "2.0", id, error: { code, message } });
}
function unauthorized() {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // quick version check
    if (request.method === "GET" && url.pathname === "/version") {
      return ok({ version: "mcp-jsonrpc-v2" });
    }

    // === MCP endpoint ===
    if (url.pathname === "/mcp" && request.method === "POST") {
      let body: any;
      try { body = await request.json(); } catch { return rpcError(null, -32700, "Parse error"); }

      const method = body?.method as string | undefined;
      const id = body?.id ?? null;
      const isNotification = !!method && method.startsWith("notifications/");

      // Allow initialize + notifications without auth; require auth for tools/*
      if (!isNotification && method !== "initialize") {
        const token = request.headers.get("authorization");
        if (!token || token !== `Bearer ${env.MCP_TOKEN}`) return unauthorized();
      }

      // notifications (e.g., notifications/initialized)
      if (isNotification) return new Response(null, { status: 204 });

      if (method === "initialize") {
        return rpcResult(id, {
          protocolVersion: "2025-03-26",
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "mcp-static-demo", version: "1.0.0" }
        });
      }

      if (method === "tools/list") {
        return rpcResult(id, { tools: TOOLS, nextCursor: null });
      }

      if (method === "tools/call") {
        const name = body?.params?.name as string | undefined;
        let args = body?.params?.arguments ?? {};
        if (typeof args === "string") {
          try { args = JSON.parse(args); } catch { return rpcError(id, -32602, "Invalid arguments JSON"); }
        }

        if (name === "search") {
          const qRaw = (args.query ?? "").toString().trim();
          if (!qRaw) return rpcError(id, -32602, "Missing query");

          const topK = Math.min(10, Math.max(1, Number(args.top_k ?? 5)));

          // normalize and simple tokenizer
          const norm = (s: string) => s.toLowerCase();
          const q = norm(qRaw);
          const terms = q.split(/\s+/).filter(Boolean);

          // include title + content + url in the haystack
          const hay = (d: typeof CORPUS[number]) => norm(`${d.title}\n${d.content}\n${d.url}`);

          // simple term match score
          const score = (d: typeof CORPUS[number]) =>
            terms.reduce((acc, t) => acc + (hay(d).includes(t) ? 1 : 0), 0);

          // compute, filter non-zero, sort, trim, map
          const hits = CORPUS
            .map(d => ({ d, s: score(d) }))
            .filter(x => x.s > 0)
            .sort((a, b) => b.s - a.s)
            .slice(0, topK)
            .map(x => ({ id: x.d.id, title: x.d.title, url: x.d.url }));

          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify({ results: hits, total: hits.length }) }],
            isError: false
          });
        }

        if (name === "fetch") {
          const idArg = (args.id ?? "").toString();
          const doc = CORPUS.find(d => d.id === idArg);
          if (!doc) {
            return rpcResult(id, {
              content: [{ type: "text", text: JSON.stringify({ error: "not_found", id: idArg }) }],
              isError: true
            });
          }
          const demoDoc = { ...doc, demo: true, sensitivity: "none" };
          return rpcResult(id, {
            content: [{ type: "text", text: JSON.stringify(demoDoc) }],
            isError: false
          });
        }

        return rpcError(id, -32601, `Unknown tool: ${name}`);

      }

      return rpcError(id, -32601, `Unknown method: ${method}`);
    }

    // fallback for non-MCP routes
    return ok({ ok: true, message: "MCP static demo. POST /mcp (JSON-RPC)." });
  }
};

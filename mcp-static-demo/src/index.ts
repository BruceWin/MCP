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
  if (!token || token !== `Bearer ${env.MCP_TOKEN}`) throw unauthorized();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // 1) Tool discovery (MCP expects /tools/list)
    if (request.method === "GET" && url.pathname === "/tools/list") {
      return json({ tools: TOOLS });
    }

    // All tool calls require auth
    if (url.pathname.startsWith("/tools/")) {
      try { await requireAuth(request, env); } catch (e: any) { return e as Response; }
    }

    // 2) search
    if (request.method === "POST" && url.pathname === "/tools/search") {
      const { query, top_k = 5 } = await request.json().catch(() => ({}));
      if (!query || typeof query !== "string") return json({ error: "query required" }, 400);

      const q = query.toLowerCase();
      const hits = CORPUS.filter(d =>
        d.title.toLowerCase().includes(q) || d.content.toLowerCase().includes(q)
      ).slice(0, Math.min(10, Math.max(1, top_k)));

      return json({
        results: hits.map(d => ({
          id: d.id,
          title: d.title,
          url: d.url,
          snippet: d.content.slice(0, 200)
        })),
        total: hits.length
      });
    }

    // 3) fetch
    if (request.method === "POST" && url.pathname === "/tools/fetch") {
      const { id } = await request.json().catch(() => ({}));
      const doc = CORPUS.find(d => d.id === id);
      if (!doc) return json({ error: "not_found" }, 404);
      return json({ id: doc.id, title: doc.title, url: doc.url, content: doc.content });
    }

    return json({ ok: true, message: "MCP static demo. Use /tools/list, /tools/search, /tools/fetch." });
  }
};

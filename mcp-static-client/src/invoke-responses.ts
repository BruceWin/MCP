import 'dotenv/config';

// Minimal CLI parsing (yargs)
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { writeFileSync } from 'node:fs';

type McpToolConfig = {
  type: 'mcp';
  server_label: string;
  server_url: string;    // MUST end with /mcp
  allowed_tools?: string[];
  require_approval?: 'never' | 'always' | 'auto';
  headers?: Record<string, string>;
};

type ResponsesMessagePart =
  | { type: 'output_text'; text: string }
  | { type: 'input_text'; text: string }
  | { type: 'tool_call'; name: string; arguments?: any }
  | { type: 'tool_result'; name: string; is_error?: boolean; content?: any }
  | { type: 'mcp_list_tools'; server_label: string; tools: any[] }
  | { type: 'mcp_call'; name: string; server_label: string; arguments?: any; output?: any; error?: any }
  | { type: 'reasoning'; summary?: any }
  | { type: string; [k: string]: any };

type ResponsesAPIResponse = {
  id: string;
  object: 'response';
  model: string;
  status: 'completed' | string;
  output?: Array<{
    id: string;
    type: string;
    content?: ResponsesMessagePart[];
    // mcp_* items are not in content; they’re top-level elements in output[]
    server_label?: string;
    tools?: any[];
    name?: string;
    arguments?: any;
    output?: any;
    error?: any;
  }>;
  output_text?: string;
  usage?: { input_tokens?: number; output_tokens?: number; total_tokens?: number };
};

const argv = yargs(hideBin(process.argv))
  .option('model', {
    type: 'string',
    default: 'gpt-5-mini-2025-08-07', // or 'gpt-5-mini'
    describe: 'OpenAI model'
  })
  .option('workerUrl', {
    type: 'string',
    default: '$env:Worker_URL',
    describe: 'Your MCP server URL (must include /mcp)'
  })
  .option('serverLabel', {
    type: 'string',
    default: 'acme-internal',
    describe: 'Label shown in mcp_* events'
  })
  .option('withTool', {
    type: 'boolean',
    default: true,
    describe: 'Include the MCP tool block'
  })
  .option('dumpJson', {
    type: 'boolean',
    default: false,
    describe: 'Write last-response.json for debugging'
  })
  .option('prompt', {
    type: 'string',
    default:
`DEMO (non-sensitive). Use the MCP tool to:
1) Search for the ACME Jellyfish failover runbook.
2) Then fetch the document by id.
3) Extract the exact five failover steps and the DEMO token string (not a secret).
Include a citation to the source URL. Do not guess; use the tool.`,
    describe: 'Input prompt'
  })
  .help()
  .strict()
  .parseSync();

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
const MCP_TOKEN = process.env.MCP_TOKEN || '';

if (!OPENAI_API_KEY) {
  console.error('OPENAI_API_KEY is not set (env or .env).');
  process.exit(1);
}
if (argv.withTool) {
  if (!argv.workerUrl.endsWith('/mcp')) {
    console.error('workerUrl must end with /mcp.');
    process.exit(1);
  }
  if (!MCP_TOKEN) {
    console.error('MCP_TOKEN is not set (env or .env).');
    process.exit(1);
  }
}

function buildRequestBody() {
  const base: any = {
    model: argv.model,
    input: argv.prompt,
  };

  if (argv.withTool) {
    const tool: McpToolConfig = {
      type: 'mcp',
      server_label: argv.serverLabel,
      server_url: argv.workerUrl,
      allowed_tools: ['search', 'fetch'], // keep both visible
      require_approval: 'never',
      headers: { Authorization: `Bearer ${MCP_TOKEN}` }
    };
    base.tools = [tool];
    // For GPT-5 models, tool_choice must remain 'auto' or omitted.
    base.tool_choice = 'auto';
  }

  return base;
}

async function callResponses(): Promise<ResponsesAPIResponse> {
  const body = buildRequestBody();
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    console.error(`HTTP ${res.status} from Responses API`);
    if (errText) console.error(errText);
    process.exit(2);
  }

  const data = (await res.json()) as ResponsesAPIResponse;
  return data;
}

function printResponse(r: ResponsesAPIResponse) {
  const items = r.output ?? [];
  if (!items.length) {
    console.warn('(No output array found; dumping full JSON…)');
    console.log(JSON.stringify(r, null, 2));
    return;
  }

  console.log('--- Items ---');
  for (const it of items) {
    console.log(`  type=${it.type} id=${it.id}`);
  }
  console.log('-------------\n');

  let hadToolEvents = false;

  for (const it of items) {
    const type = it.type;

    if (type === 'mcp_list_tools') {
      hadToolEvents = true;
      console.log(`[mcp_list_tools] ${it.server_label}`);
      for (const t of (it.tools ?? [])) {
        const name = t?.name ?? '(unknown)';
        const desc = t?.description ?? '';
        console.log(`  - ${name}: ${desc}`);
      }
      console.log('');
      continue;
    }

    if (type === 'mcp_call') {
      hadToolEvents = true;
      const name = it.name ?? '(unknown)';
      const label = it.server_label ?? '(unknown)';
      console.log(`[mcp_call] name=${name} label=${label}`);
      if (it.arguments) console.log(`args: ${typeof it.arguments === 'string' ? it.arguments : JSON.stringify(it.arguments)}`);

      if (it.error) {
        const e = it.error as any;
        console.log(`ERROR: ${e.type ?? ''} ${e.code ?? ''} ${e.message ?? ''}`);
      } else if (it.output) {
        // If present, try to show json or text content parts
        const parts = (it.output as any).content ?? [];
        const jsonPart = parts.find((p: any) => p.type === 'json')?.json;
        const textPart = parts.find((p: any) => p.type === 'text')?.text;
        if (jsonPart) console.log(JSON.stringify(jsonPart, null, 2));
        else if (textPart) console.log(textPart);
        else console.log('(no content parts)');
      } else {
        console.log('(no output and no error)');
      }
      console.log('');
      continue;
    }

    if (type === 'message') {
      const parts = it.content ?? [];
      const ot = parts.find((p: any) => p.type === 'output_text')?.text;
      if (ot) {
        console.log('--- Assistant ---');
        console.log(ot);
        console.log('');
      }
    }
  }

  if (!hadToolEvents) {
    console.log('(No MCP tool events were emitted.)');
  }

  if (r.usage) {
    const u = r.usage;
    console.log('--- Meta ---');
    console.log(`model: ${r.model}`);
    console.log(`usage: in=${u.input_tokens ?? 0} out=${u.output_tokens ?? 0} total=${u.total_tokens ?? 0}`);
  }
}

async function main() {
  try {
    const resp = await callResponses();
    if (argv.dumpJson) {
      writeFileSync('last-response.json', JSON.stringify(resp, null, 2), { encoding: 'utf8' });
      console.log('(Wrote last-response.json)');
    }
    printResponse(resp);
  } catch (err: any) {
    console.error(err?.message || String(err));
    process.exit(1);
  }
}

main();

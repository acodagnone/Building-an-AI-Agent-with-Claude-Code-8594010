import { experimental_createMCPClient } from '@ai-sdk/mcp';
import type { experimental_MCPClient as MCPClient } from '@ai-sdk/mcp';

const AIRTABLE_MCP_URL = 'https://mcp.airtable.com/mcp/';

// Exact-name pins per §12.3 / §13.4(c) — no fuzzy regex lookup. A fuzzy match
// (e.g. /create.records?/i) would match `create_record_comment` ahead of
// `create_records_for_table` and route writes to the wrong tool.
const REQUIRED_TOOL_NAMES = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
] as const;

// Mirrors ProspectSchema (§7.1) in src/agent/research.ts, which does not exist
// yet at this build stage. Structural typing keeps the two shapes compatible
// once research.ts lands, without airtable.ts importing a module that isn't
// there yet — see §12.3.
export type Prospect = {
  companyName: string;
  domain: string;
  overview: string;
  signals: Array<{
    name: string;
    description: string;
    strength: 'strong' | 'moderate' | 'weak';
  }>;
  leadScore: number;
  scoreReasoning: string;
  suggestedAngle: string;
  lastResearched: string;
};

type McpToolMap = Record<string, { execute?: (input: unknown, options: unknown) => unknown }>;

type McpCallResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};

type ResolvedTable = {
  tableId: string;
  fieldIds: Record<string, string>;
};

type AirtableSchema = {
  tools: McpToolMap;
  prospects: ResolvedTable;
};

const schemaCache = new WeakMap<MCPClient, AirtableSchema>();

function requireEnv(name: 'AIRTABLE_API_KEY' | 'AIRTABLE_BASE_ID'): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Add it to your .env file or GitHub Codespaces secrets.`);
  }
  return value;
}

export async function getAirtableMcp(): Promise<MCPClient> {
  const apiKey = requireEnv('AIRTABLE_API_KEY');
  requireEnv('AIRTABLE_BASE_ID'); // validated eagerly so setup fails fast, per §16.1

  return experimental_createMCPClient({
    transport: {
      type: 'http',
      url: AIRTABLE_MCP_URL,
      headers: { Authorization: `Bearer ${apiKey}` },
    },
  });
}

// §12.3 envelope unwrap: isError:true throws with content[0].text; on success,
// structuredContent wins, falling back to JSON-parsing content[0].text.
function unwrapResult(result: McpCallResult): any {
  if (result.isError) {
    throw new Error(result.content?.[0]?.text ?? 'Airtable MCP call failed.');
  }
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

async function callAirtableTool(
  tools: McpToolMap,
  name: (typeof REQUIRED_TOOL_NAMES)[number],
  args: Record<string, unknown>,
): Promise<any> {
  const tool = tools[name];
  if (!tool?.execute) {
    throw new Error(
      `Airtable write fails: the MCP server is missing the required "${name}" tool ` +
        `(expected one of: ${REQUIRED_TOOL_NAMES.join(', ')}).`,
    );
  }
  const result = (await tool.execute(args, {
    toolCallId: `airtable-${name}`,
    messages: [],
  })) as McpCallResult;
  return unwrapResult(result);
}

// Resolved once per client (tool handles, table ID, field-ID map), then reused
// by every wrapper call — per §12.3's "checked once when the client opens."
async function resolveSchema(client: MCPClient): Promise<AirtableSchema> {
  const cached = schemaCache.get(client);
  if (cached) return cached;

  const tools = (await client.tools()) as unknown as McpToolMap;
  for (const name of REQUIRED_TOOL_NAMES) {
    if (!tools[name]?.execute) {
      throw new Error(
        `Airtable write fails: the MCP server is missing the required "${name}" tool ` +
          `(expected one of: ${REQUIRED_TOOL_NAMES.join(', ')}).`,
      );
    }
  }

  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tables } = await callAirtableTool(tools, 'list_tables_for_base', { baseId });

  const prospectsTable = (tables as Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>).find(
    (t) => t.name === 'Prospects',
  );
  if (!prospectsTable) {
    throw new Error('Airtable write fails: no table named "Prospects" found in the base.');
  }

  const fieldIds: Record<string, string> = {};
  for (const field of prospectsTable.fields) {
    fieldIds[field.name] = field.id;
  }

  const schema: AirtableSchema = {
    tools,
    prospects: { tableId: prospectsTable.id, fieldIds },
  };
  schemaCache.set(client, schema);
  return schema;
}

function requireFieldId(fieldIds: Record<string, string>, name: string): string {
  const fieldId = fieldIds[name];
  if (!fieldId) {
    throw new Error(`Airtable write fails: Prospects table has no "${name}" field.`);
  }
  return fieldId;
}

export async function getProspectIdByDomain(client: MCPClient, domain: string): Promise<string | null> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tools, prospects } = await resolveSchema(client);
  const domainFieldId = requireFieldId(prospects.fieldIds, 'domain');

  const { records } = await callAirtableTool(tools, 'list_records_for_table', {
    baseId,
    tableId: prospects.tableId,
    filters: { operands: [{ operator: '=', operands: [domainFieldId, domain] }] },
  });

  return records?.[0]?.id ?? null;
}

export async function upsertProspect(client: MCPClient, prospect: Prospect): Promise<string> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tools, prospects } = await resolveSchema(client);
  const { tableId, fieldIds } = prospects;
  const domainFieldId = requireFieldId(fieldIds, 'domain');

  const { records } = await callAirtableTool(tools, 'list_records_for_table', {
    baseId,
    tableId,
    filters: { operands: [{ operator: '=', operands: [domainFieldId, prospect.domain] }] },
  });

  if (records && records.length > 1) {
    throw new Error(
      `Airtable write fails: found ${records.length} Prospects rows for domain "${prospect.domain}", ` +
        'expected at most one. The structured filter may have been dropped, or duplicate-domain rows ' +
        'exist (forbidden by §13.2) — see §12.3.',
    );
  }

  // signals (§7.1) is written as a markdown bullet list — signals is Long
  // text with rich text ON per §13.2.
  const signalsMarkdown = prospect.signals
    .map((s) => `- **${s.name}** (${s.strength}): ${s.description}`)
    .join('\n');

  const fieldValues: Record<string, unknown> = {
    companyName: prospect.companyName,
    domain: prospect.domain,
    overview: prospect.overview,
    signals: signalsMarkdown,
    leadScore: prospect.leadScore,
    scoreReasoning: prospect.scoreReasoning,
    suggestedAngle: prospect.suggestedAngle,
    lastResearched: prospect.lastResearched,
  };

  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fieldValues)) {
    fields[requireFieldId(fieldIds, name)] = value;
  }

  const existing = records?.[0];
  if (existing) {
    await callAirtableTool(tools, 'update_records_for_table', {
      baseId,
      tableId,
      records: [{ id: existing.id, fields }],
    });
    return existing.id;
  }

  // status defaults to "researched" on insert only (§13.2) — an update must
  // not reset a status the sales rep already advanced (contacted/replied/dead).
  fields[requireFieldId(fieldIds, 'status')] = 'researched';

  const created = await callAirtableTool(tools, 'create_records_for_table', {
    baseId,
    tableId,
    records: [{ fields }],
  });
  return created.records[0].id;
}

export async function deleteProspectByDomain(client: MCPClient, domain: string): Promise<number> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const recordId = await getProspectIdByDomain(client, domain);
  if (!recordId) return 0;

  const { tools, prospects } = await resolveSchema(client);
  await callAirtableTool(tools, 'delete_records_for_table', {
    baseId,
    tableId: prospects.tableId,
    recordIds: [recordId],
  });
  return 1;
}

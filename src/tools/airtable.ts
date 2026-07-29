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
  outreach: ResolvedTable;
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

  const allTables = tables as Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>;

  const prospectsTable = allTables.find((t) => t.name === 'Prospects');
  if (!prospectsTable) {
    throw new Error('Airtable write fails: no table named "Prospects" found in the base.');
  }
  const outreachTable = allTables.find((t) => t.name === 'Outreach');
  if (!outreachTable) {
    throw new Error('Airtable write fails: no table named "Outreach" found in the base.');
  }

  const prospectsFieldIds: Record<string, string> = {};
  for (const field of prospectsTable.fields) {
    prospectsFieldIds[field.name] = field.id;
  }
  const outreachFieldIds: Record<string, string> = {};
  for (const field of outreachTable.fields) {
    outreachFieldIds[field.name] = field.id;
  }

  const schema: AirtableSchema = {
    tools,
    prospects: { tableId: prospectsTable.id, fieldIds: prospectsFieldIds },
    outreach: { tableId: outreachTable.id, fieldIds: outreachFieldIds },
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

// Read primitive for outreach drafting (§12.3) — returns the record id plus
// every Prospects field, decoded from r.cellValuesByFieldId[fldXXX]. Drafting
// needs both the id (for the linked write to Outreach) and the field values
// (for LLM context), and a single round trip beats two reads. Distinct from
// getProspectIdByDomain, which stays id-only for callers that don't need the
// full record.
export async function getProspectByDomain(
  client: MCPClient,
  domain: string,
): Promise<({ id: string } & Record<string, unknown>) | null> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tools, prospects } = await resolveSchema(client);
  const domainFieldId = requireFieldId(prospects.fieldIds, 'domain');

  const { records } = await callAirtableTool(tools, 'list_records_for_table', {
    baseId,
    tableId: prospects.tableId,
    filters: { operands: [{ operator: '=', operands: [domainFieldId, domain] }] },
  });

  const record = records?.[0] as
    | { id: string; cellValuesByFieldId?: Record<string, unknown> }
    | undefined;
  if (!record) return null;

  const fields: Record<string, unknown> = {};
  for (const [name, fieldId] of Object.entries(prospects.fieldIds)) {
    fields[name] = record.cellValuesByFieldId?.[fieldId];
  }

  return { id: record.id, ...fields };
}

// §11.3 / §12.3 — the persistence path draftOutreach calls; never used by
// research paths. typecast: true is load-bearing for the linked `prospect`
// write (§13.4) — without it the linked cell silently null-coerces even
// though isError stays false.
export async function createOutreach(
  client: MCPClient,
  prospectId: string,
  outreach: { subjectLine: string; emailBody: string; angleReasoning: string },
): Promise<string> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tools, outreach: outreachTable } = await resolveSchema(client);
  const { tableId, fieldIds } = outreachTable;

  const fieldValues: Record<string, unknown> = {
    subjectLine: outreach.subjectLine,
    prospect: [prospectId],
    emailBody: outreach.emailBody,
    angleReasoning: outreach.angleReasoning,
  };

  const fields: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(fieldValues)) {
    fields[requireFieldId(fieldIds, name)] = value;
  }

  const created = await callAirtableTool(tools, 'create_records_for_table', {
    baseId,
    tableId,
    records: [{ fields }],
    typecast: true,
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

// Read primitive — verification (§12.3) uses this, never a delete helper's
// return count. Linked-record cells come back as `[{id, name}, ...]` objects
// on this MCP surface, not bare `rec…` strings; check both shapes so a future
// MCP-side shape change doesn't silently drop matches.
export async function listOutreachByProspectId(client: MCPClient, prospectId: string): Promise<string[]> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const { tools, outreach } = await resolveSchema(client);
  const prospectFieldId = requireFieldId(outreach.fieldIds, 'prospect');

  const { records } = await callAirtableTool(tools, 'list_records_for_table', {
    baseId,
    tableId: outreach.tableId,
  });

  const linkMatches = (entry: unknown): boolean =>
    typeof entry === 'string' ? entry === prospectId : (entry as { id?: string })?.id === prospectId;

  const matches = ((records ?? []) as Array<{ id: string; cellValuesByFieldId?: Record<string, unknown> }>).filter(
    (r) => {
      const value = r.cellValuesByFieldId?.[prospectFieldId];
      return Array.isArray(value) && value.some(linkMatches);
    },
  );

  return matches.map((r) => r.id);
}

export async function deleteOutreachByProspect(client: MCPClient, domain: string): Promise<number> {
  const baseId = requireEnv('AIRTABLE_BASE_ID');
  const prospectId = await getProspectIdByDomain(client, domain);
  if (!prospectId) return 0;

  const outreachIds = await listOutreachByProspectId(client, prospectId);
  if (outreachIds.length === 0) return 0;

  const { tools, outreach } = await resolveSchema(client);
  await callAirtableTool(tools, 'delete_records_for_table', {
    baseId,
    tableId: outreach.tableId,
    recordIds: outreachIds,
  });
  return outreachIds.length;
}

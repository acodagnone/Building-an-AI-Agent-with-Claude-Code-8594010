import { describe, it, expect, vi, afterEach } from 'vitest';
import { getAirtableMcp } from '../../src/tools/airtable.ts';

// Exact-name canary per §12.3 / §13.4(c) — asserting these literal names (not
// "any write/delete tool") catches MCP-side renames before they corrupt data.
// A fuzzy lookup would match e.g. `create_record_comment` ahead of
// `create_records_for_table` and route writes to the wrong tool.
const REQUIRED_TOOL_NAMES = [
  'list_tables_for_base',
  'list_records_for_table',
  'create_records_for_table',
  'update_records_for_table',
  'delete_records_for_table',
];

describe('Airtable MCP connector — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when AIRTABLE_API_KEY is missing', async () => {
    vi.stubEnv('AIRTABLE_API_KEY', '');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_API_KEY/);
  });

  it('throws a clear, actionable error when AIRTABLE_BASE_ID is missing', async () => {
    vi.stubEnv('AIRTABLE_BASE_ID', '');
    await expect(getAirtableMcp()).rejects.toThrow(/AIRTABLE_BASE_ID/);
  });
});

if (!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID) {
  console.warn(
    '[skip] AIRTABLE_API_KEY / AIRTABLE_BASE_ID unset — Airtable MCP connector real-API suite skipped',
  );
}

describe.skipIf(!process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID)(
  'Airtable MCP connector — real API',
  () => {
    it('connects to the Airtable MCP server using AIRTABLE_API_KEY', async () => {
      const client = await getAirtableMcp();
      expect(client).toBeTruthy();
      await client.close();
    });

    it('discovers the exact pinned MCP tool primitives by name', async () => {
      const client = await getAirtableMcp();
      try {
        const tools = await client.tools();
        const discoveredNames = Object.keys(tools);
        for (const name of REQUIRED_TOOL_NAMES) {
          expect(discoveredNames).toContain(name);
        }
      } finally {
        await client.close();
      }
    });

    it('closes the connection cleanly via close()', async () => {
      const client = await getAirtableMcp();
      await expect(client.close()).resolves.not.toThrow();
    });
  },
);

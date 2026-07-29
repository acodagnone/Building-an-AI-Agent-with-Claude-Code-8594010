import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { describe, it, expect, vi, afterEach, beforeEach, beforeAll, afterAll } from 'vitest';
import { researchCompany, structureProspect, ProspectSchema } from '../../src/agent/research.ts';
import { getAirtableMcp, deleteProspectByDomain } from '../../src/tools/airtable.ts';

const PREFERENCES_PATH = 'src/memory/preferences.md';

describe('researchCompany — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when ANTHROPIC_API_KEY is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(researchCompany('Stripe')).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (seed) real-API suite skipped',
  );
}

// (researchCompany seed) only — this is the plain generateText smoke test.
// Tools, system prompt, and structured output are later-stage bullets
// ((search wiring) and (structurer + persistence)) and are out of scope here.
// Rewired per §12.3: researchCompany's return shape narrowed from the raw
// generateText result (`.text`) to `{ prospect, steps }` at the
// (structurer + persistence) stage — this test keeps passing against that
// shape instead of being dropped.
describe.skipIf(!process.env.ANTHROPIC_API_KEY)('researchCompany — seed (real API)', () => {
  it('is callable and returns a non-empty response when given a company name', async () => {
    const result = await researchCompany('Stripe');
    expect(typeof result.prospect).toBe('object');
    expect(result.prospect).not.toBeNull();
    expect(typeof result.prospect.overview).toBe('string');
    expect(result.prospect.overview.length).toBeGreaterThan(0);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (search wiring + preferences wiring) real-API suite skipped',
  );
}
if (!process.env.TAVILY_API_KEY) {
  console.warn(
    '[skip] TAVILY_API_KEY unset — researchCompany (search wiring + preferences wiring) real-API suite skipped',
  );
}

// (search wiring) + (preferences wiring) — asserts searchWeb is reachable and
// gets invoked during a researchCompany run, and that the preference tools
// are wired into the same loop: every run starts with a listPreferences call,
// and stateful user feedback triggers addPreference. Structured output
// ((structurer + persistence)) is a later-stage bullet and out of scope here.
// `result.steps` is unaffected by the (structurer + persistence) shape
// narrowing — it stays top-level on the new `{ prospect, steps }` return.
describe.skipIf(!process.env.ANTHROPIC_API_KEY || !process.env.TAVILY_API_KEY)(
  'researchCompany — search wiring (real API)',
  () => {
    it('invokes searchWeb at least once during a research run', async () => {
      const result = await researchCompany('Stripe');
      expect(result.steps.length).toBeGreaterThan(1);

      const toolCallNames = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      );
      expect(toolCallNames).toContain('searchWeb');
    });

    // (preferences wiring) — the acceptance test for this stage. Without it,
    // the wiring can silently regress when someone edits the tools map.
    it('begins with a listPreferences tool call', async () => {
      const result = await researchCompany('Stripe');

      const toolCallNames = result.steps.flatMap((step) =>
        step.toolCalls.map((call) => call.toolName),
      );
      expect(toolCallNames[0]).toBe('listPreferences');
    });

    // (preferences wiring) — stateful feedback in the user's message triggers
    // addPreference within the same run, and the new preference is observable
    // in preferences.md afterward. Restores the real file per §16.
    describe('stateful preference feedback', () => {
      let backup: string | null;

      beforeEach(() => {
        backup = existsSync(PREFERENCES_PATH) ? readFileSync(PREFERENCES_PATH, 'utf8') : null;
      });

      afterEach(() => {
        try {
          if (backup === null) {
            if (existsSync(PREFERENCES_PATH)) rmSync(PREFERENCES_PATH);
          } else {
            writeFileSync(PREFERENCES_PATH, backup);
          }
        } catch (err) {
          console.warn('[cleanup] failed to restore preferences.md', err);
        }
      });

      it('triggers an addPreference tool call and the preference is observable in preferences.md', async () => {
        const token = 'Cantonese and Bahasa Indonesia';
        const message = `For shipping and logistics companies, always lead with 24/7 multilingual deflection covering ${token}.`;

        const result = await researchCompany(message);

        const toolCallNames = result.steps.flatMap((step) =>
          step.toolCalls.map((call) => call.toolName),
        );
        expect(toolCallNames).toContain('addPreference');

        const preferences = readFileSync(PREFERENCES_PATH, 'utf8');
        expect(preferences).toContain(token);
      });
    });
  },
);

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn(
    '[skip] ANTHROPIC_API_KEY unset — researchCompany (structurer + persistence) real-API suite skipped',
  );
}
if (!process.env.TAVILY_API_KEY) {
  console.warn(
    '[skip] TAVILY_API_KEY unset — researchCompany (structurer + persistence) real-API suite skipped',
  );
}
if (!process.env.AIRTABLE_API_KEY) {
  console.warn(
    '[skip] AIRTABLE_API_KEY unset — researchCompany (structurer + persistence) real-API suite skipped',
  );
}
if (!process.env.AIRTABLE_BASE_ID) {
  console.warn(
    '[skip] AIRTABLE_BASE_ID unset — researchCompany (structurer + persistence) real-API suite skipped',
  );
}

// Minimal envelope unwrap for the verification-only MCP calls this suite
// makes directly (list_tables_for_base / list_records_for_table with the
// structured filters param) — per §12.3's envelope-unwrap rule. This is
// verification, not tool-name discovery: at this build stage there is no
// exported helper that returns full Prospects field values (that lands with
// `getProspectByDomain` at the (outreach drafting) stage per §12.3), so the
// §16.1 persistence bullet reads back via the raw MCP primitives directly.
// Cleanup, in contrast, goes through `deleteProspectByDomain` below — never
// through an ad-hoc `delete_records_for_table` call.
type McpCallResult = {
  content: Array<{ type: string; text?: string }>;
  isError?: boolean;
  structuredContent?: unknown;
};
type McpTool = { execute?: (input: unknown, options: unknown) => unknown };

function unwrapEnvelope(result: McpCallResult): any {
  if (result.isError) {
    throw new Error(result.content?.[0]?.text ?? 'Airtable MCP call failed.');
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.[0]?.text;
  return text ? JSON.parse(text) : undefined;
}

describe.skipIf(
  !process.env.ANTHROPIC_API_KEY ||
    !process.env.TAVILY_API_KEY ||
    !process.env.AIRTABLE_API_KEY ||
    !process.env.AIRTABLE_BASE_ID,
)('researchCompany — structurer + persistence (real API)', () => {
  const TEST_COMPANY = 'Stripe';
  const TEST_DOMAIN = 'stripe';

  let result: Awaited<ReturnType<typeof researchCompany>>;
  let client: Awaited<ReturnType<typeof getAirtableMcp>>;

  beforeAll(async () => {
    result = await researchCompany(TEST_COMPANY);
    client = await getAirtableMcp();
  }, 120_000);

  afterAll(async () => {
    try {
      await deleteProspectByDomain(client, TEST_DOMAIN);
    } catch (err) {
      console.warn('[cleanup] failed to delete test prospect by domain', err);
    }
    try {
      await client.close();
    } catch (err) {
      console.warn('[cleanup] failed to close Airtable MCP client', err);
    }
  }, 60_000);

  it('returns an object matching ProspectSchema (§7.1)', () => {
    const parsed = ProspectSchema.safeParse(result.prospect);
    expect(parsed.success).toBe(true);
  });

  it('leadScore is an integer in [1, 100]', () => {
    expect(Number.isInteger(result.prospect.leadScore)).toBe(true);
    expect(result.prospect.leadScore).toBeGreaterThanOrEqual(1);
    expect(result.prospect.leadScore).toBeLessThanOrEqual(100);
  });

  it('signals is non-empty and every strength is a valid enum value', () => {
    expect(result.prospect.signals.length).toBeGreaterThan(0);
    for (const signal of result.prospect.signals) {
      expect(['strong', 'moderate', 'weak']).toContain(signal.strength);
    }
  });

  it('the returned shape is compatible with the Prospects Airtable schema (§13.2)', () => {
    const { prospect } = result;
    expect(typeof prospect.companyName).toBe('string');
    expect(typeof prospect.domain).toBe('string');
    expect(typeof prospect.overview).toBe('string');
    expect(Array.isArray(prospect.signals)).toBe(true);
    expect(Number.isInteger(prospect.leadScore)).toBe(true);
    expect(typeof prospect.scoreReasoning).toBe('string');
    expect(typeof prospect.suggestedAngle).toBe('string');
    expect(typeof prospect.lastResearched).toBe('string');
    expect(Number.isNaN(new Date(prospect.lastResearched).getTime())).toBe(false);
  });

  it('domain is a non-empty string in canonical form (lowercase, no protocol, no TLD)', () => {
    expect(result.prospect.domain).toBe(TEST_DOMAIN);
    expect(result.prospect.domain.length).toBeGreaterThan(0);
    expect(result.prospect.domain).toMatch(/^[a-z0-9]+$/);
  });

  // §7.4 negative test — pins structureProspect to the `.omit()` contract so
  // a future "helpful" fallback cannot silently re-introduce domain or
  // lastResearched as model-invented values.
  it('structureProspect omits domain and lastResearched from its returned object', async () => {
    const partial = await structureProspect(
      'Stripe is a payments infrastructure company showing strong hiring activity, with 47 open engineering roles posted in the last quarter.',
      'Stripe',
    );

    expect('domain' in (partial as object)).toBe(false);
    expect('lastResearched' in (partial as object)).toBe(false);
  });

  it('persists exactly one Prospects row matching the returned prospect, verified via list_records_for_table', async () => {
    const baseId = process.env.AIRTABLE_BASE_ID as string;
    const tools = (await client.tools()) as unknown as Record<string, McpTool>;

    const tablesResult = (await tools.list_tables_for_base.execute!(
      { baseId },
      { toolCallId: 'test-list-tables', messages: [] },
    )) as McpCallResult;
    const { tables } = unwrapEnvelope(tablesResult) as {
      tables: Array<{ id: string; name: string; fields: Array<{ id: string; name: string }> }>;
    };

    const prospectsTable = tables.find((t) => t.name === 'Prospects');
    expect(prospectsTable).toBeTruthy();

    const fieldIds: Record<string, string> = {};
    for (const field of prospectsTable!.fields) {
      fieldIds[field.name] = field.id;
    }

    const recordsResult = (await tools.list_records_for_table.execute!(
      {
        baseId,
        tableId: prospectsTable!.id,
        filters: { operands: [{ operator: '=', operands: [fieldIds.domain, TEST_DOMAIN] }] },
      },
      { toolCallId: 'test-list-records', messages: [] },
    )) as McpCallResult;
    const { records } = unwrapEnvelope(recordsResult) as {
      records: Array<{ id: string; cellValuesByFieldId: Record<string, unknown> }>;
    };

    expect(records.length).toBe(1);

    const row = records[0];
    expect(row.cellValuesByFieldId[fieldIds.companyName]).toBe(result.prospect.companyName);
    expect(row.cellValuesByFieldId[fieldIds.leadScore]).toBe(result.prospect.leadScore);
    expect(new Date(row.cellValuesByFieldId[fieldIds.lastResearched] as string).getTime()).toBe(
      new Date(result.prospect.lastResearched).getTime(),
    );
  });
});

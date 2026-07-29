import { describe, it, expect, vi, afterEach, beforeAll, afterAll } from 'vitest';
import { draftOutreach, OutreachSchema } from '../../src/agent/outreach.ts';
import {
  getAirtableMcp,
  upsertProspect,
  getProspectIdByDomain,
  listOutreachByProspectId,
  deleteOutreachByProspect,
  deleteProspectByDomain,
} from '../../src/tools/airtable.ts';
import type { Prospect } from '../../src/agent/research.ts';

const TEST_DOMAIN = 'outreachtestco';
const UNKNOWN_DOMAIN = 'outreachunknownco';

// §16.1 (outreach drafting) — paraphrase-resistant tokens (specific numerals
// and proper nouns), placed only inside signals[].description. suggestedAngle
// / scoreReasoning / overview / companyName describe the same dynamic in
// non-matching wording so those fields can't satisfy the assertion on their
// own — the model has to have read `signals` specifically.
const SIGNAL_TOKENS = {
  hiring: ['47', 'Singapore'],
  launch: ['Japanese'],
};

function seedProspect(): Prospect {
  return {
    companyName: 'Outreach Test Co',
    domain: TEST_DOMAIN,
    overview:
      'A retailer expanding into new Asian markets, scaling regional headcount to support the rollout.',
    signals: [
      {
        name: 'APAC support hiring',
        description: '47 open Support Engineer roles based in Singapore posted in the last 30 days.',
        strength: 'strong',
      },
      {
        name: 'New-market storefront launch',
        description: 'Launched a Japanese-language storefront last month ahead of a broader regional push.',
        strength: 'strong',
      },
    ],
    leadScore: 84,
    scoreReasoning: 'Concrete hiring and expansion signals into new Asian markets support a high score.',
    suggestedAngle: 'Lead with regional support coverage as the company scales into new markets.',
    lastResearched: new Date().toISOString(),
  };
}

describe('Outreach — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error mentioning ANTHROPIC_API_KEY when it is missing', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', '');
    await expect(draftOutreach(TEST_DOMAIN)).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

if (!process.env.ANTHROPIC_API_KEY) {
  console.warn('[skip] ANTHROPIC_API_KEY unset — draftOutreach (outreach drafting) real-API suite skipped');
}
if (!process.env.AIRTABLE_API_KEY) {
  console.warn('[skip] AIRTABLE_API_KEY unset — draftOutreach (outreach drafting) real-API suite skipped');
}
if (!process.env.AIRTABLE_BASE_ID) {
  console.warn('[skip] AIRTABLE_BASE_ID unset — draftOutreach (outreach drafting) real-API suite skipped');
}

// (outreach drafting) — no TAVILY_API_KEY gate here: §11.2 forbids web search
// during drafting, so Tavily is never reachable and never required.
describe.skipIf(
  !process.env.ANTHROPIC_API_KEY || !process.env.AIRTABLE_API_KEY || !process.env.AIRTABLE_BASE_ID,
)('draftOutreach — outreach drafting (real API)', () => {
  let client: Awaited<ReturnType<typeof getAirtableMcp>>;
  let result: Awaited<ReturnType<typeof draftOutreach>>;

  // One real draftOutreach call for the seeded prospect, shared by every
  // assertion block below. The unknown-company error test makes its own,
  // separate call — see its `it` below.
  beforeAll(async () => {
    client = await getAirtableMcp();
    await upsertProspect(client, seedProspect());
    result = await draftOutreach(TEST_DOMAIN);
  }, 120_000);

  afterAll(async () => {
    // §12.3 / §16 cleanup order — Outreach rows before the Prospects row, or
    // the linked-field lookup orphans them. Each step wrapped independently
    // so one failing cleanup doesn't mask the others or the test result.
    try {
      await deleteOutreachByProspect(client, TEST_DOMAIN);
    } catch (err) {
      console.warn('[cleanup] failed to delete test outreach rows', err);
    }
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

  it('returns an object matching OutreachSchema (§11.1)', () => {
    const parsed = OutreachSchema.safeParse(result);
    expect(parsed.success).toBe(true);
  });

  it('subjectLine is 80 characters or fewer', () => {
    expect(result.subjectLine.length).toBeLessThanOrEqual(80);
  });

  it('emailBody references at least two specific signals via paraphrase-resistant tokens', () => {
    const referencesHiringSignal = SIGNAL_TOKENS.hiring.some((token) => result.emailBody.includes(token));
    const referencesLaunchSignal = SIGNAL_TOKENS.launch.some((token) => result.emailBody.includes(token));
    expect(referencesHiringSignal).toBe(true);
    expect(referencesLaunchSignal).toBe(true);
  });

  it('persists an Outreach row linked to the seeded prospect record id', async () => {
    // Verification via the read primitives (§12.3) — never via
    // deleteOutreachByProspect's return count, which would let a buggy delete
    // helper (dropped link filter, fuzzy match) satisfy its own verification.
    const prospectId = await getProspectIdByDomain(client, TEST_DOMAIN);
    expect(prospectId).toBeTruthy();

    const outreachIds = await listOutreachByProspectId(client, prospectId as string);
    expect(outreachIds.length).toBeGreaterThan(0);
  });

  it('errors with "Research <Company> first." when no prior prospect record exists', async () => {
    await expect(draftOutreach(UNKNOWN_DOMAIN)).rejects.toThrow(
      new RegExp(`Research ${UNKNOWN_DOMAIN} first`, 'i'),
    );
  });
});

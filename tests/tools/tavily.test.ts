import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ToolCallOptions } from '@ai-sdk/provider-utils';
import { searchWeb } from '../../src/tools/tavily.ts';

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

const TOOL_CALL_OPTS = { toolCallId: 'test', messages: [] } satisfies ToolCallOptions;

// SEO-spam finance listicles per PRD §16.1 — surface for any company-name query, zero support-fit signal.
const BLOCKLIST = ['tipranks.com', 'seekingalpha.com', 'fool.com', 'benzinga.com'];

function isBlocklisted(url: string): boolean {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return BLOCKLIST.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

describe('Tavily — missing env (always runs)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('throws a clear, actionable error when TAVILY_API_KEY is missing', async () => {
    vi.stubEnv('TAVILY_API_KEY', '');
    await expect(
      searchWeb.execute!({ query: 'Datadog' }, TOOL_CALL_OPTS),
    ).rejects.toThrow(/TAVILY_API_KEY/);
  });
});

if (!process.env.TAVILY_API_KEY) {
  console.warn('[skip] TAVILY_API_KEY unset — Tavily real-API suite skipped');
}

describe.skipIf(!process.env.TAVILY_API_KEY)('Tavily — real API', () => {
  it('returns a non-empty result list for a normal query', async () => {
    const results = (await searchWeb.execute!(
      { query: 'Datadog' },
      TOOL_CALL_OPTS,
    )) as SearchResult[];

    expect(results.length).toBeGreaterThan(0);
  });

  it('defaults recencyDays to 90 when the caller does not specify it', async () => {
    const results = (await searchWeb.execute!(
      { query: 'Datadog' },
      TOOL_CALL_OPTS,
    )) as SearchResult[];
    const cutoff = Date.now() - 90 * 24 * 60 * 60 * 1000;

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(new Date(result.publishedDate).getTime()).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('each result has exactly the fields {title, url, snippet, publishedDate}', async () => {
    const results = (await searchWeb.execute!(
      { query: 'Datadog' },
      TOOL_CALL_OPTS,
    )) as SearchResult[];

    expect(results.length).toBeGreaterThan(0);
    for (const result of results) {
      expect(Object.keys(result).sort()).toEqual(['publishedDate', 'snippet', 'title', 'url']);
    }
  });

  it('only returns results with a parseable publishedDate within the requested recencyDays window', async () => {
    const recencyDays = 30;
    const results = (await searchWeb.execute!(
      { query: 'Datadog', recencyDays },
      TOOL_CALL_OPTS,
    )) as SearchResult[];
    const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

    for (const result of results) {
      const parsed = new Date(result.publishedDate).getTime();
      expect(Number.isNaN(parsed)).toBe(false);
      expect(parsed).toBeGreaterThanOrEqual(cutoff);
    }
  });

  it('excludes results from blocklisted domains', async () => {
    const results = (await searchWeb.execute!(
      { query: 'Tesla stock forecast', recencyDays: 90 },
      TOOL_CALL_OPTS,
    )) as SearchResult[];

    for (const result of results) {
      expect(isBlocklisted(result.url)).toBe(false);
    }
  });
});

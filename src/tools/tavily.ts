import { tool } from 'ai';
import { z } from 'zod';

type SearchResult = { title: string; url: string; snippet: string; publishedDate: string };

const MAX_RESULTS = 5;

// SEO-spam finance listicles that surface for any company-name query — zero support-fit signal.
const BLOCKED_DOMAINS = [
  'tipranks.com',
  'seekingalpha.com',
  'fool.com',
  'benzinga.com',
  'marketbeat.com',
];

function isBlocked(url: string): boolean {
  const hostname = new URL(url).hostname.replace(/^www\./, '');
  return BLOCKED_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
}

export const searchWeb = tool({
  description:
    'Search the web for recent news about a company — press releases, funding announcements, hiring news. Returns up to 5 results from the last recencyDays days (default 90), excluding known SEO-spam finance listicles.',
  inputSchema: z.object({
    query: z.string(),
    recencyDays: z.number().int().positive().optional(),
  }),
  execute: async ({ query, recencyDays = 90 }): Promise<SearchResult[]> => {
    const apiKey = process.env.TAVILY_API_KEY;
    if (!apiKey) {
      throw new Error(
        'TAVILY_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
      );
    }

    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        topic: 'news',
        max_results: MAX_RESULTS,
      }),
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as {
      results?: Array<{
        title: string;
        url: string;
        content: string;
        published_date?: string | null;
      }>;
    };

    const cutoff = Date.now() - recencyDays * 24 * 60 * 60 * 1000;

    return (data.results ?? [])
      .filter((result) => {
        if (!result.published_date) return false;
        const parsed = new Date(result.published_date).getTime();
        return !Number.isNaN(parsed) && parsed >= cutoff;
      })
      .filter((result) => !isBlocked(result.url))
      .map((result) => ({
        title: result.title,
        url: result.url,
        snippet: result.content,
        publishedDate: result.published_date as string,
      }));
  },
});

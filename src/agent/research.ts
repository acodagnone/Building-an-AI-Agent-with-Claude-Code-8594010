import { readFileSync } from 'node:fs';
import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

const BRAIN_PROMPT = readFileSync('src/agent/prompts/brain.md', 'utf8');

export async function researchCompany(companyName: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
    );
  }

  const result = await generateText({
    model: anthropic('claude-haiku-4-5'),
    system: BRAIN_PROMPT,
    prompt: `Research the company "${companyName}" as a potential sales prospect.`,
  });
  return result.text;
}

import { generateText } from 'ai';
import { anthropic } from '@ai-sdk/anthropic';

export async function researchCompany(companyName: string): Promise<string> {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'ANTHROPIC_API_KEY is not set. Add it to your .env file or GitHub Codespaces secrets.',
    );
  }

  const result = await generateText({
    model: anthropic('claude-haiku-4-5'),
    prompt: `Research the company "${companyName}" as a potential sales prospect. Summarize what you know about it.`,
  });
  return result.text;
}

/**
 * LLM Integration Utilities
 *
 * Handles calls to external LLM APIs (Claude and OpenAI).
 * Includes retry logic, rate limiting, and error handling.
 */

import { logger } from './logger.js';

// Claude/Anthropic integration
async function callClaude(prompt: string, model: string = 'claude-sonnet-4'): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;

  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY environment variable not set');
  }

  // TODO: Implement actual Claude API call
  // For now, return a mock response
  logger.warn('Claude API call not implemented yet, returning mock response');

  return `Mock Claude response for model ${model}. Prompt length: ${prompt.length} characters.

This is a placeholder response. In the real implementation, this would call the Anthropic Claude API with the provided prompt and return the generated text.`;
}

// OpenAI integration
async function callOpenAI(prompt: string, model: string = 'gpt-4'): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set');
  }

  // TODO: Implement actual OpenAI API call
  // For now, return a mock response
  logger.warn('OpenAI API call not implemented yet, returning mock response');

  return `Mock OpenAI response for model ${model}. Prompt length: ${prompt.length} characters.

This is a placeholder response. In the real implementation, this would call the OpenAI API with the provided prompt and return the generated text.`;
}

/**
 * Generate embeddings using OpenAI
 */
export async function generateEmbeddings(texts: string[], model: string = 'text-embedding-3-small'): Promise<number[][]> {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set');
  }

  // TODO: Implement actual OpenAI embeddings API call
  logger.warn('OpenAI embeddings not implemented yet, returning mock embeddings');

  // Return mock embeddings (1536 dimensions for text-embedding-3-small)
  return texts.map(() => Array.from({ length: 1536 }, () => Math.random() - 0.5));
}

/**
 * Main LLM calling function with retry logic
 */
export async function callLLM(
  prompt: string,
  model: string = 'claude-sonnet-4',
  options: {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
  } = {}
): Promise<string> {
  const { maxRetries = 3, retryDelay = 1000, timeout = 30000 } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${maxRetries} for model ${model}`);

      let response: string;

      if (model.startsWith('claude-')) {
        response = await callClaude(prompt, model);
      } else if (model.startsWith('gpt-') || model.includes('embedding')) {
        response = await callOpenAI(prompt, model);
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }

      logger.debug(`LLM call successful, response length: ${response.length}`);
      return response;

    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(`LLM call attempt ${attempt} failed`, lastError);

      if (attempt < maxRetries) {
        // Exponential backoff
        const delay = retryDelay * Math.pow(2, attempt - 1);
        logger.debug(`Retrying in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  // All retries failed
  logger.error('All LLM call attempts failed', lastError);
  throw new Error(`LLM call failed after ${maxRetries} attempts: ${lastError?.message}`);
}

/**
 * Estimate token count for a text (rough approximation)
 */
export function estimateTokens(text: string): number {
  // Rough approximation: 1 token ≈ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Validate LLM API keys on startup
 */
export async function validateLLMKeys(): Promise<void> {
  logger.info('Validating LLM API keys...');

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!anthropicKey) {
    logger.warn('ANTHROPIC_API_KEY not set - Claude integration will not work');
  } else {
    logger.info('✓ Anthropic API key found');
  }

  if (!openaiKey) {
    logger.warn('OPENAI_API_KEY not set - OpenAI integration will not work');
  } else {
    logger.info('✓ OpenAI API key found');
  }

  if (!anthropicKey && !openaiKey) {
    throw new Error('At least one LLM API key must be configured (ANTHROPIC_API_KEY or OPENAI_API_KEY)');
  }
}
/**
 * LLM Integration Utilities
 *
 * Handles calls to external LLM APIs via OpenRouter (for Claude) and OpenAI (for embeddings).
 * Includes retry logic, rate limiting, and error handling.
 */

import OpenAI from 'openai';
import { logger } from './logger.js';

// Initialize OpenRouter client (for LLM completions - Claude models)
function getOpenRouterClient(): OpenAI {
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    throw new Error('OPENROUTER_API_KEY environment variable not set');
  }

  return new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1',
    defaultHeaders: {
      'HTTP-Referer': 'https://github.com/tribal-knowledge',
      'X-Title': 'Tribal Knowledge Deep Agent',
    },
  });
}

// Initialize OpenAI client (for embeddings)
function getOpenAIClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    throw new Error('OPENAI_API_KEY environment variable not set');
  }

  return new OpenAI({ apiKey });
}

// Map internal model names to OpenRouter model identifiers
function getOpenRouterModel(model: string): string {
  const modelMap: Record<string, string> = {
    'claude-sonnet-4.5': 'anthropic/claude-sonnet-4.5',
    'claude-haiku-4.5': 'anthropic/claude-haiku-4.5',
    'claude-sonnet-4': 'anthropic/claude-sonnet-4',
    'claude-3-5-sonnet': 'anthropic/claude-3.5-sonnet',
    'claude-3-opus': 'anthropic/claude-3-opus',
    'claude-3-sonnet': 'anthropic/claude-3-sonnet',
    'claude-3-haiku': 'anthropic/claude-3-haiku',
  };

  return modelMap[model] || model;
}

/**
 * Call Claude via OpenRouter
 */
async function callClaude(
  prompt: string,
  model: string = 'claude-sonnet-4',
  maxTokens: number = 4096
): Promise<string> {
  const client = getOpenRouterClient();
  const openRouterModel = getOpenRouterModel(model);

  logger.debug(`Calling OpenRouter with model: ${openRouterModel}`);

  const response = await client.chat.completions.create({
    model: openRouterModel,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from OpenRouter');
  }

  return content;
}

/**
 * Call OpenAI directly (for non-Claude models if needed)
 */
async function callOpenAI(
  prompt: string,
  model: string = 'gpt-4',
  maxTokens: number = 4096
): Promise<string> {
  const client = getOpenAIClient();

  logger.debug(`Calling OpenAI with model: ${model}`);

  const response = await client.chat.completions.create({
    model,
    max_tokens: maxTokens,
    messages: [
      {
        role: 'user',
        content: prompt,
      },
    ],
  });

  const content = response.choices[0]?.message?.content;

  if (!content) {
    throw new Error('Empty response from OpenAI');
  }

  return content;
}

/**
 * Generate embeddings using OpenAI
 */
export async function generateEmbeddings(
  texts: string[],
  model: string = 'text-embedding-3-small'
): Promise<number[][]> {
  const client = getOpenAIClient();

  logger.debug(`Generating embeddings for ${texts.length} texts using ${model}`);

  // Process in batches to avoid API limits
  const batchSize = 50;
  const allEmbeddings: number[][] = [];

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);

    const response = await client.embeddings.create({
      model,
      input: batch,
    });

    const batchEmbeddings = response.data.map((item) => item.embedding);
    allEmbeddings.push(...batchEmbeddings);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < texts.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  logger.debug(`Generated ${allEmbeddings.length} embeddings`);
  return allEmbeddings;
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
    maxTokens?: number;
  } = {}
): Promise<string> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    timeout: _timeout = 30000,
    maxTokens = 4096,
  } = options;

  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${maxRetries} for model ${model}`);

      let response: string;

      if (model.startsWith('claude-') || model.startsWith('anthropic/')) {
        // Use OpenRouter for Claude models
        response = await callClaude(prompt, model, maxTokens);
      } else if (model.startsWith('gpt-')) {
        // Use OpenAI directly for GPT models
        response = await callOpenAI(prompt, model, maxTokens);
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }

      logger.debug(`LLM call successful, response length: ${response.length}`);
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.warn(`LLM call attempt ${attempt} failed: ${lastError.message}`);

      // Check if it's a rate limit error
      const isRateLimit =
        lastError.message.includes('rate') ||
        lastError.message.includes('429') ||
        lastError.message.includes('quota');

      if (attempt < maxRetries) {
        // Exponential backoff (longer for rate limits)
        const delay = isRateLimit
          ? retryDelay * Math.pow(2, attempt)
          : retryDelay * Math.pow(2, attempt - 1);

        logger.debug(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
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
  // Rough approximation: 1 token ~ 4 characters for English text
  return Math.ceil(text.length / 4);
}

/**
 * Validate LLM API keys on startup
 */
export async function validateLLMKeys(): Promise<void> {
  logger.info('Validating LLM API keys...');

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;

  if (!openRouterKey) {
    logger.warn('OPENROUTER_API_KEY not set - Claude integration will not work');
  } else {
    logger.info('OpenRouter API key found (for Claude models)');
  }

  if (!openaiKey) {
    logger.warn('OPENAI_API_KEY not set - Embeddings will not work');
  } else {
    logger.info('OpenAI API key found (for embeddings)');
  }

  if (!openRouterKey && !openaiKey) {
    throw new Error(
      'At least one LLM API key must be configured (OPENROUTER_API_KEY or OPENAI_API_KEY)'
    );
  }
}

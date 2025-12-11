/**
 * LLM Integration Utilities
 *
 * Handles calls to external LLM APIs via OpenRouter (for Claude) and OpenAI (for embeddings).
 * Includes retry logic, rate limiting, and error handling.
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import type { AgentError } from '../agents/documenter/types.js';
import { createAgentError, ErrorCodes } from '../agents/documenter/errors.js';

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
 * Create an LLM-specific AgentError
 * 
 * @param code Error code (DOC_LLM_TIMEOUT, DOC_LLM_FAILED, DOC_LLM_PARSE_FAILED)
 * @param message Human-readable error message
 * @param recoverable Whether the operation can be retried
 * @param context Additional context for debugging
 * @returns AgentError object with severity 'warning'
 */
function createLLMError(
  code: string,
  message: string,
  recoverable: boolean,
  context?: Record<string, unknown>
): AgentError {
  return createAgentError(code, message, 'warning', recoverable, context);
}

/**
 * Classify an LLM error to determine error type and retry behavior
 * 
 * @param error The error to classify
 * @param model The model being used (for context)
 * @param attempt The attempt number (for context)
 * @returns AgentError with appropriate code and recoverable flag
 */
function classifyLLMError(
  error: Error | unknown,
  model: string,
  attempt: number
): AgentError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const errorObj = error instanceof Error ? error : new Error(String(error));

  // Check for OpenAI SDK error types
  if (errorObj instanceof OpenAI.APIError) {
    const status = errorObj.status;
    const headers = errorObj.headers;
    
    // Timeout errors (408 Request Timeout, 504 Gateway Timeout)
    if (status === 408 || status === 504) {
      return createLLMError(
        ErrorCodes.DOC_LLM_TIMEOUT,
        `LLM API call timed out: ${errorMessage}`,
        true,
        { model, attempt, status, originalError: errorMessage }
      );
    }

    // Rate limit errors (429 Too Many Requests)
    if (status === 429) {
      // Check for Retry-After header
      const retryAfter = headers?.['retry-after'] || headers?.['Retry-After'];
      const retryAfterSeconds = retryAfter ? parseInt(String(retryAfter), 10) : undefined;

      return createLLMError(
        ErrorCodes.DOC_LLM_FAILED,
        `LLM API rate limit exceeded: ${errorMessage}`,
        true,
        {
          model,
          attempt,
          status,
          originalError: errorMessage,
          retryAfter: retryAfterSeconds,
          retryAfterHeader: retryAfter,
        }
      );
    }

    // Service unavailable (503 Service Unavailable) - recoverable
    if (status === 503) {
      return createLLMError(
        ErrorCodes.DOC_LLM_FAILED,
        `LLM API service unavailable: ${errorMessage}`,
        true,
        { model, attempt, status, originalError: errorMessage }
      );
    }

    // Client errors (400 Bad Request, 401 Unauthorized, 403 Forbidden) - not recoverable
    if (status === 400 || status === 401 || status === 403) {
      return createLLMError(
        ErrorCodes.DOC_LLM_FAILED,
        `LLM API client error: ${errorMessage}`,
        false,
        { model, attempt, status, originalError: errorMessage }
      );
    }

    // Other API errors - treat as recoverable by default
    return createLLMError(
      ErrorCodes.DOC_LLM_FAILED,
      `LLM API error: ${errorMessage}`,
      true,
      { model, attempt, status, originalError: errorMessage }
    );
  }

  // Check for timeout in error message
  if (
    errorMessage.includes('timeout') ||
    errorMessage.includes('ETIMEDOUT') ||
    errorMessage.includes('TIMEOUT')
  ) {
    return createLLMError(
      ErrorCodes.DOC_LLM_TIMEOUT,
      `LLM call timed out: ${errorMessage}`,
      true,
      { model, attempt, originalError: errorMessage }
    );
  }

  // Check for rate limit in error message
  if (
    errorMessage.includes('rate') ||
    errorMessage.includes('429') ||
    errorMessage.includes('quota') ||
    errorMessage.includes('limit')
  ) {
    return createLLMError(
      ErrorCodes.DOC_LLM_FAILED,
      `LLM rate limit error: ${errorMessage}`,
      true,
      { model, attempt, originalError: errorMessage }
    );
  }

  // Default to generic LLM failure (recoverable)
  return createLLMError(
    ErrorCodes.DOC_LLM_FAILED,
    `LLM call failed: ${errorMessage}`,
    true,
    { model, attempt, originalError: errorMessage }
  );
}

/**
 * Validate LLM response to detect parse failures
 * 
 * @param response The response string to validate
 * @throws AgentError with DOC_LLM_PARSE_FAILED if response is invalid
 */
function validateLLMResponse(response: string | null | undefined): void {
  // Check for null or undefined
  if (response === null || response === undefined) {
    throw createLLMError(
      ErrorCodes.DOC_LLM_PARSE_FAILED,
      'LLM returned null or undefined response',
      false,
      { responseType: typeof response }
    );
  }

  // Check for empty string
  if (typeof response !== 'string') {
    throw createLLMError(
      ErrorCodes.DOC_LLM_PARSE_FAILED,
      `LLM returned non-string response: ${typeof response}`,
      false,
      { responseType: typeof response }
    );
  }

  // Check for empty or whitespace-only response
  if (response.trim().length === 0) {
    throw createLLMError(
      ErrorCodes.DOC_LLM_PARSE_FAILED,
      'LLM returned empty or whitespace-only response',
      false,
      { responseLength: response.length }
    );
  }

  // Check for suspiciously short responses (may indicate truncation)
  // Minimum reasonable response is 10 characters
  if (response.trim().length < 10) {
    logger.warn(`LLM response is very short (${response.length} chars), may be truncated`);
  }
}

/**
 * Token usage information from LLM response
 */
export interface TokenUsage {
  prompt: number;
  completion: number;
  total: number;
}

/**
 * LLM response with content and token usage
 */
export interface LLMResponse {
  content: string;
  tokens: TokenUsage;
}

/**
 * Call Claude via OpenRouter
 */
async function callClaude(
  prompt: string,
  model: string = 'claude-sonnet-4',
  maxTokens: number = 4096
): Promise<LLMResponse> {
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

  // Validate response before returning
  validateLLMResponse(content);

  // Extract token usage
  const usage = response.usage;
  const tokens: TokenUsage = {
    prompt: usage?.prompt_tokens ?? 0,
    completion: usage?.completion_tokens ?? 0,
    total: usage?.total_tokens ?? 0,
  };

  // Log token usage at debug level
  logger.debug(
    `LLM call used ${tokens.total} tokens (prompt: ${tokens.prompt}, completion: ${tokens.completion})`
  );

  // Warn if token usage is very high (threshold: 100k tokens)
  if (tokens.total > 100000) {
    logger.warn(
      `High token usage detected: ${tokens.total} tokens (prompt: ${tokens.prompt}, completion: ${tokens.completion})`
    );
  }

  return {
    content: content!,
    tokens,
  };
}

/**
 * Call OpenAI directly (for non-Claude models if needed)
 */
async function callOpenAI(
  prompt: string,
  model: string = 'gpt-4',
  maxTokens: number = 4096
): Promise<LLMResponse> {
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

  // Validate response before returning
  validateLLMResponse(content);

  // Extract token usage
  const usage = response.usage;
  const tokens: TokenUsage = {
    prompt: usage?.prompt_tokens ?? 0,
    completion: usage?.completion_tokens ?? 0,
    total: usage?.total_tokens ?? 0,
  };

  // Log token usage at debug level
  logger.debug(
    `LLM call used ${tokens.total} tokens (prompt: ${tokens.prompt}, completion: ${tokens.completion})`
  );

  // Warn if token usage is very high (threshold: 100k tokens)
  if (tokens.total > 100000) {
    logger.warn(
      `High token usage detected: ${tokens.total} tokens (prompt: ${tokens.prompt}, completion: ${tokens.completion})`
    );
  }

  return {
    content: content!,
    tokens,
  };
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
): Promise<LLMResponse> {
  const {
    maxRetries = 3,
    retryDelay = 1000,
    timeout: _timeout = 30000,
    maxTokens = 4096,
  } = options;

  let lastError: AgentError | null = null;
  const retryHistory: Array<{ attempt: number; error: AgentError; delay?: number }> = [];

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${maxRetries} for model ${model}`);

      let response: LLMResponse;

      if (model.startsWith('claude-') || model.startsWith('anthropic/')) {
        // Use OpenRouter for Claude models
        response = await callClaude(prompt, model, maxTokens);
      } else if (model.startsWith('gpt-')) {
        // Use OpenAI directly for GPT models
        response = await callOpenAI(prompt, model, maxTokens);
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }

      logger.debug(`LLM call successful, response length: ${response.content.length}`);
      return response;
    } catch (error) {
      // Classify the error
      const classifiedError = classifyLLMError(error, model, attempt);
      lastError = classifiedError;

      logger.warn(`LLM call attempt ${attempt} failed: ${classifiedError.message}`, {
        code: classifiedError.code,
        recoverable: classifiedError.recoverable,
        context: classifiedError.context,
      });

      // Check if we should retry
      const shouldRetry =
        attempt < maxRetries &&
        classifiedError.recoverable &&
        classifiedError.code !== ErrorCodes.DOC_LLM_PARSE_FAILED;

      if (shouldRetry) {
        // Calculate delay - use Retry-After header if available for rate limits
        let delay: number;
        if (
          classifiedError.code === ErrorCodes.DOC_LLM_FAILED &&
          classifiedError.context?.retryAfter
        ) {
          // Use Retry-After header value (convert seconds to milliseconds)
          delay = (classifiedError.context.retryAfter as number) * 1000;
          // Cap at 30 seconds
          delay = Math.min(delay, 30000);
          logger.debug(`Using Retry-After header: ${delay}ms`);
        } else {
          // Exponential backoff: delay = min(1000 * 2^(attempt-1), 30000)
          delay = Math.min(retryDelay * Math.pow(2, attempt - 1), 30000);
        }

        retryHistory.push({
          attempt,
          error: classifiedError,
          delay,
        });

        logger.debug(`Retrying in ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      } else {
        // Don't retry - either max attempts reached, not recoverable, or parse failure
        retryHistory.push({
          attempt,
          error: classifiedError,
        });

        // For parse failures, throw immediately (no retry)
        if (classifiedError.code === ErrorCodes.DOC_LLM_PARSE_FAILED) {
          throw classifiedError;
        }

        // For other non-recoverable errors, throw immediately
        if (!classifiedError.recoverable) {
          throw classifiedError;
        }
      }
    }
  }

  // All retries failed - create final error with retry history
  const finalError = createLLMError(
    lastError?.code ?? ErrorCodes.DOC_LLM_FAILED,
    `LLM call failed after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`,
    false,
    {
      model,
      attempts: maxRetries,
      retryHistory,
      finalError: lastError?.context,
    }
  );

  logger.error('All LLM call attempts failed', finalError);
  throw finalError;
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


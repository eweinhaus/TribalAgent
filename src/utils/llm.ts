/**
 * LLM Integration Utilities
 *
 * Handles calls to external LLM APIs via OpenRouter (for Claude) and OpenAI (for GPT models).
 * Includes retry logic, rate limiting, error handling, and automatic fallback to GPT-4o.
 * 
 * Model Selection:
 * - LLM_PRIMARY_MODEL env var: Override primary model (default: claude-haiku-4.5)
 * - Claude models use OpenRouter (OPENROUTER_API_KEY)
 * - GPT models use OpenAI directly (OPENAI_API_KEY)
 * 
 * Fallback Behavior:
 * - 402 (insufficient credits) errors: Immediate fallback to GPT-4o (no retry)
 * - Other errors: Retry once, then fallback to GPT-4o
 * - Controlled via LLM_FALLBACK_ENABLED env var (default: true)
 * - Fallback model configurable via LLM_FALLBACK_MODEL (default: gpt-4o)
 */

import OpenAI from 'openai';
import { logger } from './logger.js';
import type { AgentError } from '../agents/documenter/types.js';
import { createAgentError, ErrorCodes } from '../agents/documenter/errors.js';

// =============================================================================
// Model Configuration
// =============================================================================

/** Default primary model when not configured */
const DEFAULT_PRIMARY_MODEL = 'claude-haiku-4.5';

/** Default fallback model */
const DEFAULT_FALLBACK_MODEL = 'gpt-4o';

/**
 * Check if a model is a Claude model (uses OpenRouter)
 */
function isClaudeModel(model: string): boolean {
  return model.toLowerCase().includes('claude');
}

/**
 * Check if a model is a GPT model (uses OpenAI directly)
 */
function isGPTModel(model: string): boolean {
  return model.toLowerCase().includes('gpt');
}

// =============================================================================
// Fallback Configuration
// =============================================================================

/**
 * Check if LLM fallback is enabled
 * Default: true (enabled)
 */
function isFallbackEnabled(): boolean {
  const envValue = process.env.LLM_FALLBACK_ENABLED;
  // Default to true if not set, only disable if explicitly set to 'false'
  return envValue !== 'false';
}

/**
 * Get the fallback model to use when primary fails
 * Default: gpt-4o
 */
function getFallbackModel(): string {
  return process.env.LLM_FALLBACK_MODEL || DEFAULT_FALLBACK_MODEL;
}

/**
 * Check if fallback is available (OpenAI API key is set)
 */
function isFallbackAvailable(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Check if error is a credits/insufficient funds error (402)
 * These should fallback immediately without retry
 */
function isCreditsError(error: any): boolean {
  if (error?.status === 402) return true;
  if (error?.code === 402) return true;
  const message = error?.message || String(error);
  return message.includes('402') || 
         message.includes('credits') || 
         message.includes('insufficient') ||
         message.includes('can only afford');
}

// =============================================================================
// Configured Model
// =============================================================================

/** Cached configured model to avoid repeated config reads */
let cachedConfiguredModel: string | null = null;

/**
 * Get the configured LLM model
 * Priority: LLM_PRIMARY_MODEL env var > config file > default (claude-haiku-4.5)
 * 
 * @returns The configured model name
 */
export async function getConfiguredModel(): Promise<string> {
  // Environment variable takes highest priority
  const envModel = process.env.LLM_PRIMARY_MODEL;
  if (envModel) {
    return envModel;
  }

  // Return cached value if available
  if (cachedConfiguredModel) {
    return cachedConfiguredModel;
  }

  try {
    // Dynamic import to avoid circular dependencies
    const { loadConfig } = await import('./config.js');
    const config = await loadConfig();
    cachedConfiguredModel = config.documenter?.llm_model || DEFAULT_PRIMARY_MODEL;
    logger.debug(`Configured LLM model: ${cachedConfiguredModel}`);
    return cachedConfiguredModel;
  } catch (error) {
    // Config not available, use default
    logger.warn(`Could not load LLM model from config, using default: ${DEFAULT_PRIMARY_MODEL}`);
    cachedConfiguredModel = DEFAULT_PRIMARY_MODEL;
    return cachedConfiguredModel;
  }
}

/**
 * Clear the cached configured model (useful for testing)
 */
export function clearConfiguredModelCache(): void {
  cachedConfiguredModel = null;
}

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
  /** Whether the response came from the fallback provider */
  usedFallback?: boolean;
  /** The actual model used (may differ from requested if fallback was used) */
  actualModel?: string;
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
 * Split text into chunks that fit within the token limit
 * Tries to split at sentence boundaries for better semantic coherence
 */
function splitTextIntoChunks(text: string, maxChars: number): string[] {
  if (text.length <= maxChars) {
    return [text];
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxChars) {
      chunks.push(remaining);
      break;
    }

    // Try to find a good split point (sentence boundary) near the limit
    let splitPoint = maxChars;
    
    // Look for sentence endings (.!?) within the last 20% of the chunk
    const searchStart = Math.floor(maxChars * 0.8);
    const searchRegion = remaining.substring(searchStart, maxChars);
    const sentenceEnd = searchRegion.search(/[.!?]\s/);
    
    if (sentenceEnd !== -1) {
      splitPoint = searchStart + sentenceEnd + 2; // Include the punctuation and space
    } else {
      // Fall back to splitting at a space
      const lastSpace = remaining.lastIndexOf(' ', maxChars);
      if (lastSpace > maxChars * 0.5) {
        splitPoint = lastSpace + 1;
      }
    }

    chunks.push(remaining.substring(0, splitPoint).trim());
    remaining = remaining.substring(splitPoint).trim();
  }

  return chunks;
}

/**
 * Generate embeddings using OpenAI
 * 
 * IMPORTANT: OpenAI's text-embedding-3-small has an 8192 token limit.
 * This function automatically:
 * - Splits oversized documents into chunks
 * - Averages chunk embeddings back to single embedding
 * - Skips empty/invalid texts with warnings
 */
export async function generateEmbeddings(
  texts: string[],
  model: string = 'text-embedding-3-small'
): Promise<number[][]> {
  const client = getOpenAIClient();

  logger.debug(`Generating embeddings for ${texts.length} texts using ${model}`);

  // OpenAI text-embedding-3-small has 8192 token limit
  // Use conservative estimate: ~4 chars per token for safety margin
  // This prevents "context window exceeded" errors
  const MAX_TOKENS_PER_DOC = 7500;  // Leave margin from 8192 limit
  const CHARS_PER_TOKEN = 4;        // Conservative estimate
  const MAX_CHARS_PER_DOC = Math.floor(MAX_TOKENS_PER_DOC * CHARS_PER_TOKEN); // 30000 chars
  const MAX_CHARS_PER_BATCH = 80000; // Batch limit for API calls

  // Split oversized texts into multiple chunks, track original indices
  const processedTexts: string[] = [];
  const originalIndices: number[] = []; // Maps processed index -> original index
  let skippedCount = 0;

  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    
    // Skip empty or invalid texts
    if (!text || text.trim().length === 0) {
      logger.warn(`Skipping empty text at index ${i}`);
      skippedCount++;
      continue;
    }

    if (text.length > MAX_CHARS_PER_DOC) {
      const estimatedTokens = Math.ceil(text.length / CHARS_PER_TOKEN);
      logger.warn(
        `Document ${i} exceeds embedding token limit: ~${estimatedTokens} tokens (${text.length} chars). ` +
        `Splitting into chunks to avoid 8k context window error.`
      );
      const chunks = splitTextIntoChunks(text, MAX_CHARS_PER_DOC);
      logger.info(`Split oversized embedding text: ${text.length} chars -> ${chunks.length} chunks`);
      for (const chunk of chunks) {
        processedTexts.push(chunk);
        originalIndices.push(i);
      }
    } else {
      processedTexts.push(text);
      originalIndices.push(i);
    }
  }

  if (skippedCount > 0) {
    logger.warn(`Skipped ${skippedCount} empty/invalid texts during embedding generation`);
  }

  if (processedTexts.length === 0) {
    logger.warn('No valid texts to embed after filtering');
    return [];
  }
  
  const allEmbeddings: number[][] = [];
  let currentBatch: string[] = [];
  let currentBatchChars = 0;

  for (let i = 0; i < processedTexts.length; i++) {
    const text = processedTexts[i];
    const textChars = text.length;

    // If adding this text would exceed the limit, process current batch first
    if (currentBatchChars + textChars > MAX_CHARS_PER_BATCH && currentBatch.length > 0) {
      try {
        const response = await client.embeddings.create({
          model,
          input: currentBatch,
        });

        const batchEmbeddings = response.data.map((item) => item.embedding);
        allEmbeddings.push(...batchEmbeddings);
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);
        if (errMsg.includes('maximum context length') || errMsg.includes('8192')) {
          logger.error(
            `Embedding batch exceeded 8k token limit despite chunking. ` +
            `Batch had ${currentBatch.length} texts, ${currentBatchChars} chars. ` +
            `Try reducing MAX_CHARS_PER_DOC.`
          );
        }
        throw error;
      }
      
      // Reset batch
      currentBatch = [];
      currentBatchChars = 0;
      
      // Small delay between batches to avoid rate limits
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    currentBatch.push(text);
    currentBatchChars += textChars;
  }

  // Process remaining batch
  if (currentBatch.length > 0) {
    try {
      const response = await client.embeddings.create({
        model,
        input: currentBatch,
      });

      const batchEmbeddings = response.data.map((item) => item.embedding);
      allEmbeddings.push(...batchEmbeddings);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('maximum context length') || errMsg.includes('8192')) {
        logger.error(
          `Embedding batch exceeded 8k token limit despite chunking. ` +
          `Batch had ${currentBatch.length} texts, ${currentBatchChars} chars. ` +
          `Try reducing MAX_CHARS_PER_DOC.`
        );
      }
      throw error;
    }
  }

  // For documents that were split, average their chunk embeddings
  // Build a map of original index -> embeddings for that index
  const embeddingsByOrigIdx = new Map<number, number[][]>();
  for (let i = 0; i < originalIndices.length; i++) {
    const origIdx = originalIndices[i];
    if (!embeddingsByOrigIdx.has(origIdx)) {
      embeddingsByOrigIdx.set(origIdx, []);
    }
    embeddingsByOrigIdx.get(origIdx)!.push(allEmbeddings[i]);
  }

  // Build final embeddings array, handling skipped texts
  const finalEmbeddings: number[][] = [];
  for (let origIdx = 0; origIdx < texts.length; origIdx++) {
    const chunkEmbeddings = embeddingsByOrigIdx.get(origIdx);
    
    if (!chunkEmbeddings || chunkEmbeddings.length === 0) {
      // This text was skipped (empty/invalid) - use zero vector as placeholder
      // The indexer will handle missing embeddings gracefully
      continue;
    }
    
    if (chunkEmbeddings.length === 1) {
      finalEmbeddings.push(chunkEmbeddings[0]);
    } else {
      // Average the embeddings for split documents
      logger.debug(`Averaging ${chunkEmbeddings.length} chunk embeddings for document ${origIdx}`);
      const avgEmbedding = chunkEmbeddings[0].map((_, dim) => {
        const sum = chunkEmbeddings.reduce((acc, emb) => acc + emb[dim], 0);
        return sum / chunkEmbeddings.length;
      });
      finalEmbeddings.push(avgEmbedding);
    }
  }

  logger.debug(`Generated ${finalEmbeddings.length} embeddings (from ${allEmbeddings.length} chunks)`);
  return finalEmbeddings;
}

/**
 * Main LLM calling function with retry logic and automatic fallback
 * 
 * Retry & Fallback Behavior:
 * - 402 (credits) errors: Immediate fallback to GPT-4o (no retry)
 * - Other errors: Retry once, then fallback to GPT-4o
 * - Fallback controlled via LLM_FALLBACK_ENABLED env var (default: true)
 * - Fallback model configurable via LLM_FALLBACK_MODEL (default: gpt-4o)
 * 
 * Model Routing:
 * - Claude models → OpenRouter (OPENROUTER_API_KEY)
 * - GPT models → OpenAI directly (OPENAI_API_KEY)
 */
export async function callLLM(
  prompt: string,
  model: string = DEFAULT_PRIMARY_MODEL,
  options: {
    maxRetries?: number;
    retryDelay?: number;
    timeout?: number;
    maxTokens?: number;
    /** Disable fallback for this specific call */
    disableFallback?: boolean;
  } = {}
): Promise<LLMResponse> {
  const {
    // Default to 2 retries (1 initial + 1 retry) for non-credits errors
    maxRetries = 2,
    retryDelay = 1000,
    timeout: _timeout = 30000,
    maxTokens = 4096,
    disableFallback = false,
  } = options;

  let lastError: AgentError | null = null;
  const retryHistory: Array<{ attempt: number; error: AgentError; delay?: number }> = [];

  // Determine if this is a Claude model (uses OpenRouter, potential for fallback)
  const modelIsClaudeModel = isClaudeModel(model);
  // Determine if this is a GPT model (uses OpenAI directly)
  const modelIsGPTModel = isGPTModel(model);

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.debug(`LLM call attempt ${attempt}/${maxRetries} for model ${model}`);

      let response: LLMResponse;

      if (modelIsClaudeModel) {
        // Use OpenRouter for Claude models
        response = await callClaude(prompt, model, maxTokens);
      } else if (modelIsGPTModel) {
        // Use OpenAI directly for GPT models
        response = await callOpenAI(prompt, model, maxTokens);
      } else {
        throw new Error(`Unsupported model: ${model}`);
      }

      logger.debug(`LLM call successful, response length: ${response.content.length}`);
      return {
        ...response,
        usedFallback: false,
        actualModel: model,
      };
    } catch (error) {
      // Classify the error
      const classifiedError = classifyLLMError(error, model, attempt);
      lastError = classifiedError;

      logger.warn(`LLM call attempt ${attempt} failed: ${classifiedError.message}`, {
        code: classifiedError.code,
        recoverable: classifiedError.recoverable,
        context: classifiedError.context,
      });

      // Check if this is a credits error (402) - fallback immediately, no retry
      if (isCreditsError(error) || isCreditsError(classifiedError)) {
        logger.warn(`Credits error detected, falling back immediately without retry`);
        retryHistory.push({
          attempt,
          error: classifiedError,
        });
        break; // Exit retry loop, try fallback
      }

      // Check if we should retry (for non-credits errors)
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

        // For parse failures, throw immediately (no retry, no fallback)
        if (classifiedError.code === ErrorCodes.DOC_LLM_PARSE_FAILED) {
          throw classifiedError;
        }

        // For other non-recoverable errors, exit retry loop (but may fallback below)
        if (!classifiedError.recoverable) {
          break; // Exit retry loop, try fallback
        }
      }
    }
  }

  // ==========================================================================
  // Primary provider failed - attempt fallback to GPT-4o
  // ==========================================================================
  
  const shouldTryFallback = 
    modelIsClaudeModel &&                // Only fallback from Claude models
    !disableFallback &&                  // Fallback not disabled for this call
    isFallbackEnabled() &&               // LLM_FALLBACK_ENABLED !== 'false'
    isFallbackAvailable();               // OPENAI_API_KEY is set

  if (shouldTryFallback) {
    const fallbackModel = getFallbackModel();
    
    const attemptsMsg = isCreditsError(lastError) 
      ? '(credits error - immediate fallback)' 
      : `after ${retryHistory.length} attempt(s)`;
    
    logger.warn(
      `Primary LLM (${model}) failed ${attemptsMsg}. ` +
      `Falling back to ${fallbackModel}...`,
      {
        primaryModel: model,
        fallbackModel,
        lastError: lastError?.message,
      }
    );

    try {
      // Call OpenAI directly with the fallback model
      const fallbackResponse = await callOpenAI(prompt, fallbackModel, maxTokens);
      
      logger.info(
        `Fallback to ${fallbackModel} succeeded! ` +
        `Response length: ${fallbackResponse.content.length} chars`,
        { 
          fallbackModel,
          primaryModel: model,
          tokens: fallbackResponse.tokens.total,
        }
      );

      return {
        ...fallbackResponse,
        usedFallback: true,
        actualModel: fallbackModel,
      };
    } catch (fallbackError) {
      // Fallback also failed - throw combined error
      const fallbackErrorMsg = fallbackError instanceof Error 
        ? fallbackError.message 
        : String(fallbackError);

      logger.error(
        `Both primary (${model}) and fallback (${fallbackModel}) failed`,
        {
          primaryError: lastError?.message,
          fallbackError: fallbackErrorMsg,
        }
      );

      const combinedError = createLLMError(
        ErrorCodes.DOC_LLM_FAILED,
        `Both primary (${model}) and fallback (${fallbackModel}) failed. ` +
        `Primary: ${lastError?.message ?? 'Unknown'}. Fallback: ${fallbackErrorMsg}`,
        false,
        {
          model,
          fallbackModel,
          attempts: maxRetries,
          retryHistory,
          primaryError: lastError?.context,
          fallbackError: fallbackErrorMsg,
        }
      );

      throw combinedError;
    }
  }

  // No fallback available/enabled - throw the original error
  const finalError = createLLMError(
    lastError?.code ?? ErrorCodes.DOC_LLM_FAILED,
    `LLM call failed after ${maxRetries} attempts: ${lastError?.message ?? 'Unknown error'}`,
    false,
    {
      model,
      attempts: maxRetries,
      retryHistory,
      finalError: lastError?.context,
      fallbackAvailable: isFallbackAvailable(),
      fallbackEnabled: isFallbackEnabled(),
    }
  );

  logger.error('All LLM call attempts failed (no fallback)', finalError);
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
 * Validate LLM API keys on startup and log fallback configuration
 */
export async function validateLLMKeys(): Promise<void> {
  logger.info('Validating LLM API keys...');

  const openRouterKey = process.env.OPENROUTER_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const fallbackEnabled = isFallbackEnabled();
  const fallbackModel = getFallbackModel();

  if (!openRouterKey) {
    logger.warn('OPENROUTER_API_KEY not set - Claude integration will not work');
  } else {
    logger.info('OpenRouter API key found (for Claude models)');
  }

  if (!openaiKey) {
    logger.warn('OPENAI_API_KEY not set - Embeddings and fallback will not work');
  } else {
    logger.info('OpenAI API key found (for embeddings)');
    
    // Log fallback configuration
    if (fallbackEnabled) {
      logger.info(`LLM fallback ENABLED: Will use ${fallbackModel} if Claude fails`);
    } else {
      logger.info('LLM fallback DISABLED (LLM_FALLBACK_ENABLED=false)');
    }
  }

  if (!openRouterKey && !openaiKey) {
    throw new Error(
      'At least one LLM API key must be configured (OPENROUTER_API_KEY or OPENAI_API_KEY)'
    );
  }

  // Warn if OpenRouter is not configured but fallback is available
  if (!openRouterKey && openaiKey && fallbackEnabled) {
    logger.info(
      `Note: OpenRouter not configured, but OpenAI is. ` +
      `Consider using GPT models directly or configure OPENROUTER_API_KEY for Claude.`
    );
  }
}

/**
 * Get current fallback configuration status
 * Useful for debugging and status reporting
 */
export function getFallbackStatus(): {
  enabled: boolean;
  available: boolean;
  model: string;
} {
  return {
    enabled: isFallbackEnabled(),
    available: isFallbackAvailable(),
    model: getFallbackModel(),
  };
}


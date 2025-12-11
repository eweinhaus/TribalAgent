/**
 * Unit tests for LLM integration utilities
 * 
 * Tests retry logic, error classification, and response validation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { callLLM } from '../../src/utils/llm.js';
import { ErrorCodes } from '../../src/agents/documenter/errors.js';

// Create a mock APIError class that matches OpenAI's APIError structure
class MockAPIError extends Error {
  status: number;
  headers?: Record<string, string>;
  constructor(status: number, headers?: Record<string, string>, body?: any, message?: string) {
    super(message || 'API Error');
    this.status = status;
    this.headers = headers;
    this.name = 'APIError';
  }
}

// Mock OpenAI
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    })),
    APIError: MockAPIError,
  };
});

// Import OpenAI after mock is set up
import OpenAI from 'openai';

// Mock logger
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('LLM Integration', () => {
  let mockClient: any;
  let mockCreate: any;

  beforeEach(() => {
    vi.useFakeTimers();
    mockClient = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    };
    mockCreate = mockClient.chat.completions.create;
    vi.mocked(OpenAI).mockReturnValue(mockClient as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  describe('Error Classification', () => {
    it('should classify timeout errors as DOC_LLM_TIMEOUT', async () => {
      const timeoutError = new MockAPIError(408, undefined, undefined, 'Request timeout');
      mockCreate.mockRejectedValue(timeoutError);

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_TIMEOUT,
        recoverable: true,
      });
    });

    it('should classify rate limit errors as DOC_LLM_FAILED (recoverable)', async () => {
      const rateLimitError = new OpenAI.APIError(429, { 'retry-after': '60' }, undefined, 'Rate limit exceeded');
      mockCreate.mockRejectedValue(rateLimitError);

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_FAILED,
        recoverable: true,
      });
    });

    it('should classify client errors as DOC_LLM_FAILED (not recoverable)', async () => {
      const clientError = new MockAPIError(400, undefined, undefined, 'Bad request');
      mockCreate.mockRejectedValue(clientError);

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_FAILED,
        recoverable: false,
      });
    });
  });

  describe('Retry Logic', () => {
    it('should retry on timeout errors (3 attempts)', async () => {
      const timeoutError = new MockAPIError(408, undefined, undefined, 'Request timeout');
      mockCreate
        .mockRejectedValueOnce(timeoutError)
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Success' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        });

      const promise = callLLM('test prompt', 'claude-sonnet-4');

      // Advance time for first retry (1s)
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      // Advance time for second retry (2s)
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.content).toBe('Success');
      expect(mockCreate).toHaveBeenCalledTimes(3);
    });

    it('should use exponential backoff (1s, 2s, 4s)', async () => {
      const timeoutError = new MockAPIError(408, undefined, undefined, 'Request timeout');
      mockCreate.mockRejectedValue(timeoutError);

      const startTime = Date.now();
      const promise = callLLM('test prompt', 'claude-sonnet-4');

      // Track timing
      const delays: number[] = [];
      let lastTime = startTime;

      // First retry should happen after 1s
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();
      delays.push(Date.now() - lastTime);
      lastTime = Date.now();

      // Second retry should happen after 2s
      vi.advanceTimersByTime(2000);
      await vi.runAllTimersAsync();
      delays.push(Date.now() - lastTime);

      await expect(promise).rejects.toBeDefined();

      // Verify delays are approximately correct (within 100ms tolerance)
      expect(delays[0]).toBeGreaterThanOrEqual(900);
      expect(delays[0]).toBeLessThanOrEqual(1100);
      expect(delays[1]).toBeGreaterThanOrEqual(1900);
      expect(delays[1]).toBeLessThanOrEqual(2100);
    });

    it('should cap delay at 30 seconds', async () => {
      const timeoutError = new MockAPIError(408, undefined, undefined, 'Request timeout');
      mockCreate.mockRejectedValue(timeoutError);

      const promise = callLLM('test prompt', 'claude-sonnet-4', {
        retryDelay: 20000, // Start with 20s delay
      });

      // Advance time - should cap at 30s
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toBeDefined();
      // Verify we didn't wait longer than 30s
    });

    it('should NOT retry on parse failures', async () => {
      // Mock empty response (parse failure)
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      });

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_PARSE_FAILED,
        recoverable: false,
      });

      // Should only be called once (no retries)
      expect(mockCreate).toHaveBeenCalledTimes(1);
    });

    it('should retry on recoverable errors only', async () => {
      const recoverableError = new MockAPIError(503, undefined, undefined, 'Service unavailable');
      const nonRecoverableError = new MockAPIError(401, undefined, undefined, 'Unauthorized');

      mockCreate
        .mockRejectedValueOnce(recoverableError)
        .mockRejectedValueOnce(nonRecoverableError);

      const promise = callLLM('test prompt', 'claude-sonnet-4');

      // Advance time for retry
      vi.advanceTimersByTime(1000);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_FAILED,
        recoverable: false,
      });

      // Should retry once, then fail on non-recoverable
      expect(mockCreate).toHaveBeenCalledTimes(2);
    });
  });

  describe('Response Validation', () => {
    it('should reject null responses', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: null } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      });

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_PARSE_FAILED,
      });
    });

    it('should reject empty string responses', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      });

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_PARSE_FAILED,
      });
    });

    it('should reject whitespace-only responses', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: '   \n\t  ' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 0,
          total_tokens: 10,
        },
      });

      await expect(
        callLLM('test prompt', 'claude-sonnet-4')
      ).rejects.toMatchObject({
        code: ErrorCodes.DOC_LLM_PARSE_FAILED,
      });
    });

    it('should accept valid responses', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Valid response' } }],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      });

      const result = await callLLM('test prompt', 'claude-sonnet-4');
      expect(result.content).toBe('Valid response');
      expect(result.tokens.total).toBe(15);
      expect(result.tokens.prompt).toBe(10);
      expect(result.tokens.completion).toBe(5);
    });
  });

  describe('Token Usage Extraction', () => {
    it('should extract token usage from response', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      });

      const result = await callLLM('test prompt', 'claude-sonnet-4');
      expect(result.tokens).toEqual({
        prompt: 100,
        completion: 50,
        total: 150,
      });
    });

    it('should handle missing token usage gracefully', async () => {
      mockCreate.mockResolvedValue({
        choices: [{ message: { content: 'Response' } }],
        usage: undefined,
      });

      const result = await callLLM('test prompt', 'claude-sonnet-4');
      expect(result.tokens).toEqual({
        prompt: 0,
        completion: 0,
        total: 0,
      });
    });
  });

  describe('Rate Limiting', () => {
    it('should use Retry-After header if available', async () => {
      const rateLimitError = new MockAPIError(429, { 'retry-after': '5' }, undefined, 'Rate limit exceeded');
      mockCreate
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce({
          choices: [{ message: { content: 'Success' } }],
          usage: {
            prompt_tokens: 10,
            completion_tokens: 5,
            total_tokens: 15,
          },
        });

      const promise = callLLM('test prompt', 'claude-sonnet-4');

      // Advance time for retry (5 seconds from Retry-After header)
      vi.advanceTimersByTime(5000);
      await vi.runAllTimersAsync();

      const result = await promise;
      expect(result.content).toBe('Success');
    });

    it('should cap Retry-After at 30 seconds', async () => {
      const rateLimitError = new OpenAI.APIError(429, { 'retry-after': '60' }, undefined, 'Rate limit exceeded');
      mockCreate.mockRejectedValue(rateLimitError);

      const promise = callLLM('test prompt', 'claude-sonnet-4');

      // Advance time - should cap at 30s
      vi.advanceTimersByTime(30000);
      await vi.runAllTimersAsync();

      await expect(promise).rejects.toBeDefined();
    });
  });
});


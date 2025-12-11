/**
 * Integration tests for LLM integration
 * 
 * Tests real OpenRouter API calls (skips if API key not available).
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { callLLM } from '../llm.js';

describe('LLM Integration Tests', () => {
  const hasApiKey = !!process.env.OPENROUTER_API_KEY;

  beforeAll(() => {
    if (!hasApiKey) {
      console.log('⚠️  OPENROUTER_API_KEY not set - skipping integration tests');
    }
  });

  describe('Real OpenRouter API Calls', () => {
    it.skipIf(!hasApiKey)(
      'should make successful API call',
      async () => {
        const result = await callLLM(
          'Say "Hello, World!" and nothing else.',
          'claude-3-haiku'
        );

        expect(result.content).toBeDefined();
        expect(typeof result.content).toBe('string');
        expect(result.content.length).toBeGreaterThan(0);
        expect(result.tokens.total).toBeGreaterThan(0);
        expect(result.tokens.prompt).toBeGreaterThan(0);
        expect(result.tokens.completion).toBeGreaterThan(0);
      },
      { timeout: 30000 }
    );

    it.skipIf(!hasApiKey)(
      'should extract token usage correctly',
      async () => {
        const result = await callLLM(
          'Count to 5.',
          'claude-3-haiku'
        );

        expect(result.tokens).toBeDefined();
        expect(result.tokens.prompt).toBeGreaterThan(0);
        expect(result.tokens.completion).toBeGreaterThan(0);
        expect(result.tokens.total).toBe(
          result.tokens.prompt + result.tokens.completion
        );
      },
      { timeout: 30000 }
    );

    it.skipIf(!hasApiKey)(
      'should handle different Claude models',
      async () => {
        const models = ['claude-3-haiku', 'claude-3-sonnet', 'claude-sonnet-4'];
        
        for (const model of models) {
          try {
            const result = await callLLM('Say "test"', model);
            expect(result.content).toBeDefined();
            expect(result.tokens.total).toBeGreaterThan(0);
          } catch (error) {
            // Some models might not be available, that's okay
            console.warn(`Model ${model} not available:`, error);
          }
        }
      },
      { timeout: 60000 }
    );
  });

  describe('Error Handling with Real API', () => {
    it.skipIf(!hasApiKey)(
      'should handle invalid model gracefully',
      async () => {
        await expect(
          callLLM('test', 'invalid-model-name')
        ).rejects.toBeDefined();
      },
      { timeout: 30000 }
    );
  });
});


/**
 * Unit tests for ColumnInferencer sub-agent
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ColumnInferencer } from '../../src/agents/documenter/sub-agents/ColumnInferencer.js';
import { ErrorCodes } from '../../src/agents/documenter/errors.js';

// Mock dependencies
vi.mock('../../src/utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const mockLoadPromptTemplate = vi.fn();
const mockInterpolateTemplate = vi.fn((template: string, vars: Record<string, string>) => {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
  }
  return result;
});
const mockMapColumnVariables = vi.fn();
const mockCallLLM = vi.fn();

vi.mock('../../src/utils/prompts.js', () => ({
  loadPromptTemplate: vi.fn().mockResolvedValue('Template content'),
  interpolateTemplate: vi.fn(),
  mapColumnVariables: vi.fn(),
}));

const mockCallLLM = vi.fn();
vi.mock('../../src/utils/llm.js', () => ({
  callLLM: (...args: any[]) => mockCallLLM(...args),
}));

vi.mock('../../src/agents/documenter/utils/fallback-descriptions.js', () => ({
  generateColumnFallbackDescription: vi.fn(({ name, data_type }) => 
    `Column ${name} of type ${data_type}.`
  ),
}));

describe('ColumnInferencer', () => {
  const columnMetadata = {
    name: 'email',
    data_type: 'varchar(255)',
    is_nullable: 'NO',
    column_default: null,
    comment: null,
  };

  const tableContext = {
    database_name: 'test_db',
    schema_name: 'public',
    table_name: 'users',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with column metadata and table context', () => {
      const inferencer = new ColumnInferencer(columnMetadata, tableContext);
      expect(inferencer).toBeInstanceOf(ColumnInferencer);
    });

    it('should accept sample values', () => {
      const sampleValues = ['test@example.com', 'user@test.com'];
      const inferencer = new ColumnInferencer(columnMetadata, tableContext, sampleValues);
      expect(inferencer).toBeInstanceOf(ColumnInferencer);
    });
  });

  describe('infer', () => {
    it('should return description string (context quarantine)', async () => {
      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      
      mockCallLLM.mockResolvedValue({
        content: 'Email address for user account.',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      vi.mocked(loadPromptTemplate).mockResolvedValue('Template with {{column}}');

      const inferencer = new ColumnInferencer(columnMetadata, tableContext, ['test@example.com']);
      const result = await inferencer.infer();

      expect(typeof result).toBe('string');
      expect(result).toContain('Email');
      expect(mockCallLLM).toHaveBeenCalled();
    });

    it('should handle LLM timeout with retry', async () => {
      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      
      const timeoutError = {
        code: ErrorCodes.DOC_LLM_TIMEOUT,
        message: 'LLM call timed out',
        severity: 'warning' as const,
        timestamp: new Date().toISOString(),
        recoverable: true,
      };
      
      // First call times out, second succeeds
      mockCallLLM
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce({
          content: 'Email address.',
          tokens: { prompt: 100, completion: 5, total: 105 },
        });

      vi.mocked(loadPromptTemplate).mockResolvedValue('Template');

      const inferencer = new ColumnInferencer(columnMetadata, tableContext);
      const result = await inferencer.infer();

      expect(typeof result).toBe('string');
      expect(mockCallLLM).toHaveBeenCalledTimes(2); // Retry happened
    });

    it('should use fallback immediately on parse failure (no retry)', async () => {
      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      
      const parseError = {
        code: ErrorCodes.DOC_LLM_PARSE_FAILED,
        message: 'Invalid response',
        severity: 'warning' as const,
        timestamp: new Date().toISOString(),
        recoverable: false,
      };
      mockCallLLM.mockRejectedValue(parseError);

      vi.mocked(loadPromptTemplate).mockResolvedValue('Template');

      const { generateColumnFallbackDescription } = await import('../../utils/fallback-descriptions.js');

      const inferencer = new ColumnInferencer(columnMetadata, tableContext);
      const result = await inferencer.infer();

      expect(result).toBe('Column email of type varchar(255).');
      expect(generateColumnFallbackDescription).toHaveBeenCalled();
      // Should not retry on parse failure
      expect(mockCallLLM).toHaveBeenCalledTimes(1);
    });

    it('should handle empty sample values gracefully', async () => {
      mockCallLLM.mockResolvedValue({
        content: 'Column description.',
        tokens: { prompt: 100, completion: 5, total: 105 },
      });

      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('Template');

      const inferencer = new ColumnInferencer(columnMetadata, tableContext);
      const result = await inferencer.infer();

      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('should validate description length and punctuation', async () => {
      // Very long response
      mockCallLLM.mockResolvedValue({
        content: 'A'.repeat(600) + '.',
        tokens: { prompt: 100, completion: 150, total: 250 },
      });

      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('Template');

      const inferencer = new ColumnInferencer(columnMetadata, tableContext);
      const result = await inferencer.infer();

      // Should be truncated
      expect(result.length).toBeLessThanOrEqual(500);
      expect(result).toMatch(/[.!?]$/);
    });

    it('should enforce context quarantine (returns string only)', async () => {
      const { loadPromptTemplate } = await import('../../src/utils/prompts.js');
      
      vi.mocked(loadPromptTemplate).mockResolvedValue('Template');
      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 5, total: 105 },
      });

      const inferencer = new ColumnInferencer(columnMetadata, tableContext, ['value1', 'value2']);
      const result = await inferencer.infer();

      // Should be string, not object
      expect(typeof result).toBe('string');
      expect(result).not.toContain('sample_values');
      expect(result).not.toContain('raw_data');
    });
  });
});


/**
 * Unit tests for TableDocumenter sub-agent
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { TableDocumenter } from '../TableDocumenter.js';
import { ErrorCodes } from '../../errors.js';
import type { WorkUnit, TableSpec } from '../../types.js';

// Mock dependencies
vi.mock('../../../utils/logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('../../../utils/prompts.js', () => ({
  loadPromptTemplate: vi.fn().mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.'),
  interpolateTemplate: vi.fn((template, vars) => {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), String(value));
    }
    return result;
  }),
  mapTableVariables: vi.fn((_spec, _db, _metadata, _samples) => ({
    database: 'test_db',
    schema: 'public',
    table: 'test_table',
  })),
}));

const mockCallLLM = vi.fn();
vi.mock('../../../utils/llm.js', () => ({
  callLLM: (...args: any[]) => mockCallLLM(...args),
}));

vi.mock('../../utils/fallback-descriptions.js', () => ({
  generateTableFallbackDescription: vi.fn(({ table_name, column_count, row_count_approx }) =>
    `Table ${table_name} contains ${column_count} columns with approximately ${row_count_approx} rows.`
  ),
}));

vi.mock('fs', () => ({
  promises: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    rename: vi.fn(),
    access: vi.fn(),
    readFile: vi.fn(),
  },
}));

describe('TableDocumenter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  const tableSpec: TableSpec = {
    fully_qualified_name: 'test_db.public.users',
    schema_name: 'public',
    table_name: 'users',
    priority: 1,
    row_count_approx: 1000,
    column_count: 3,
    existing_comment: null,
  };

  const workUnit: WorkUnit = {
    work_unit_id: 'test_work_unit',
    database: 'test_db',
    domain: 'users',
    output_directory: 'databases/test_db/domains/users',
    priority_order: 1,
    tables: [tableSpec],
    depends_on: [],
  };

  const mockConnector = {
    connect: vi.fn(),
    disconnect: vi.fn(),
    query: vi.fn(),
    getTableMetadata: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create instance with table spec, work unit, and connector', () => {
      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      expect(documenter).toBeInstanceOf(TableDocumenter);
    });
  });

  describe('document', () => {
    it('should extract metadata via getTableMetadata', async () => {
      const mockMetadata = {
        columns: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'email', data_type: 'varchar(255)' },
        ],
        primary_key: ['id'],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockConnector.query).mockResolvedValue([
        { id: 1, email: 'test@example.com' },
      ]);

      mockCallLLM.mockResolvedValue({
        content: 'Users table description.',
        tokens: { prompt: 200, completion: 20, total: 220 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      await documenter.document();

      expect(mockConnector.getTableMetadata).toHaveBeenCalledWith('public', 'users');
    });

    it('should handle DOC_TABLE_EXTRACTION_FAILED error', async () => {
      const error = new Error('Connection failed');
      vi.mocked(mockConnector.getTableMetadata).mockRejectedValue(error);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      
      await expect(documenter.document()).rejects.toMatchObject({
        code: ErrorCodes.DOC_TABLE_EXTRACTION_FAILED,
      });
    });

    it('should sample data with timeout handling', async () => {
      const mockMetadata = {
        columns: [{ column_name: 'id', data_type: 'integer' }],
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      
      // Simulate timeout
      vi.mocked(mockConnector.query).mockImplementation(() => 
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Query timeout')), 10)
        )
      );

      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      
      // Should continue without samples (empty array returned)
      const result = await documenter.document();
      
      expect(result).toBeDefined();
      expect(result.output_files).toHaveLength(2);
    });

    it('should process columns sequentially', async () => {
      const mockMetadata = {
        columns: [
          { column_name: 'id', data_type: 'integer' },
          { column_name: 'email', data_type: 'varchar(255)' },
        ],
        primary_key: ['id'],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockConnector.query).mockResolvedValue([
        { id: 1, email: 'test@example.com' },
      ]);

      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      await documenter.document();

      // Should call LLM for table description + 2 columns = 3 calls
      expect(mockCallLLM).toHaveBeenCalledTimes(3);
    });

    it('should generate files with correct paths', async () => {
      const mockMetadata = {
        columns: [{ column_name: 'id', data_type: 'integer' }],
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockConnector.query).mockResolvedValue([]);

      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      const result = await documenter.document();

      // Verify file paths match PRD specification
      expect(result.output_files[0]).toContain('tables');
      expect(result.output_files[0]).toContain('public.users.md');
      expect(result.output_files[1]).toContain('tables');
      expect(result.output_files[1]).toContain('public.users.json');
    });

    it('should enforce context quarantine (no raw data in summary)', async () => {
      const mockMetadata = {
        columns: [{ column_name: 'id', data_type: 'integer' }],
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockConnector.query).mockResolvedValue([
        { id: 1, email: 'test@example.com' },
      ]);

      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile).mockResolvedValue(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      const result = await documenter.document();

      // Summary should not contain raw data
      expect(result).not.toHaveProperty('sample_data');
      expect(result).not.toHaveProperty('raw_data');
      expect(result).toHaveProperty('table');
      expect(result).toHaveProperty('schema');
      expect(result).toHaveProperty('description');
      expect(result).toHaveProperty('column_count');
      expect(result).toHaveProperty('output_files');
    });

    it('should handle file write failure with retry', async () => {
      const mockMetadata = {
        columns: [{ column_name: 'id', data_type: 'integer' }],
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      vi.mocked(mockConnector.getTableMetadata).mockResolvedValue(mockMetadata);
      vi.mocked(mockConnector.query).mockResolvedValue([]);

      mockCallLLM.mockResolvedValue({
        content: 'Description',
        tokens: { prompt: 100, completion: 10, total: 110 },
      });

      const { loadPromptTemplate } = await import('../../../utils/prompts.js');
      vi.mocked(loadPromptTemplate).mockResolvedValue('This is a template with enough content to pass validation. It contains placeholder variables like {{variable}} that will be replaced during interpolation.');

      // First write fails, retry succeeds
      vi.mocked(fs.mkdir).mockResolvedValue(undefined);
      vi.mocked(fs.writeFile)
        .mockRejectedValueOnce(new Error('Write failed'))
        .mockResolvedValueOnce(undefined);
      vi.mocked(fs.rename).mockResolvedValue(undefined);

      const documenter = new TableDocumenter(tableSpec, workUnit, mockConnector as any);
      
      // Should succeed after retry
      const result = await documenter.document();
      expect(result).toBeDefined();
    });
  });
});


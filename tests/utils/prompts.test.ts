/**
 * Unit tests for prompt template system
 * 
 * Tests template loading, variable extraction, and interpolation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import {
  loadPromptTemplate,
  interpolateTemplate,
  validateVariables,
  mapTableVariables,
  mapColumnVariables,
  clearTemplateCache,
} from '../prompts.js';

// Mock fs
vi.mock('fs', async () => {
  const actual = await vi.importActual('fs');
  return {
    ...actual,
    promises: {
      ...(actual as any).promises,
      readFile: vi.fn(),
      access: vi.fn(),
    },
  };
});

// Mock logger
vi.mock('../logger.js', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe('Prompt Template System', () => {
  beforeEach(() => {
    clearTemplateCache();
    vi.clearAllMocks();
  });

  describe('Template Loading', () => {
    it('should load template from file', async () => {
      const templateContent = 'This is a test template with {{variable}}';
      vi.mocked(fs.readFile).mockResolvedValue(templateContent);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      const result = await loadPromptTemplate('test-template');
      expect(result).toBe(templateContent);
      expect(fs.readFile).toHaveBeenCalledWith(
        path.join(process.cwd(), 'prompts', 'test-template.md'),
        'utf-8'
      );
    });

    it('should cache loaded templates', async () => {
      const templateContent = 'Template content';
      vi.mocked(fs.readFile).mockResolvedValue(templateContent);
      vi.mocked(fs.access).mockResolvedValue(undefined);

      await loadPromptTemplate('test-template');
      await loadPromptTemplate('test-template');

      // Should only read file once (second call uses cache)
      expect(fs.readFile).toHaveBeenCalledTimes(1);
    });

    it('should throw error if template file not found', async () => {
      const error = new Error('File not found') as NodeJS.ErrnoException;
      error.code = 'ENOENT';
      vi.mocked(fs.access).mockRejectedValue(error);

      await expect(loadPromptTemplate('missing-template')).rejects.toThrow();
    });
  });

  describe('Variable Extraction', () => {
    it('should extract variables from template via validateVariables', () => {
      const template = 'Hello {{name}}, you have {{count}} items.';
      const variables = {
        name: 'Alice',
        count: '5',
      };
      // validateVariables internally extracts variables
      expect(() => validateVariables(template, variables)).not.toThrow();
    });

    it('should handle variables with spaces', () => {
      const template = 'Hello {{ name }}, you have {{ count }} items.';
      const variables = {
        name: 'Alice',
        count: '5',
      };
      expect(() => validateVariables(template, variables)).not.toThrow();
    });

    it('should handle variables with underscores', () => {
      const template = 'Table {{table_name}} has {{row_count}} rows.';
      const variables = {
        table_name: 'customers',
        row_count: '1000',
      };
      expect(() => validateVariables(template, variables)).not.toThrow();
    });
  });

  describe('Template Interpolation', () => {
    it('should interpolate all variables', () => {
      const template = 'Hello {{name}}, you have {{count}} items.';
      const variables = {
        name: 'Alice',
        count: '5',
      };
      const result = interpolateTemplate(template, variables);
      expect(result).toBe('Hello Alice, you have 5 items.');
    });

    it('should handle missing variables', () => {
      const template = 'Hello {{name}}, you have {{count}} items.';
      const variables = {
        name: 'Alice',
        // count is missing
      };
      const result = interpolateTemplate(template, variables);
      expect(result).toBe('Hello Alice, you have {{count}} items.');
    });

    it('should handle multiple occurrences of same variable', () => {
      const template = '{{name}} and {{name}} again.';
      const variables = { name: 'Alice' };
      const result = interpolateTemplate(template, variables);
      expect(result).toBe('Alice and Alice again.');
    });
  });

  describe('Variable Validation', () => {
    it('should validate all variables are provided', () => {
      const template = 'Hello {{name}}, you have {{count}} items.';
      const variables = {
        name: 'Alice',
        count: '5',
      };
      expect(() => validateVariables(template, variables)).not.toThrow();
    });

    it('should throw error for missing variables', () => {
      const template = 'Hello {{name}}, you have {{count}} items.';
      const variables = {
        name: 'Alice',
        // count is missing
      };
      expect(() => validateVariables(template, variables)).toThrow(
        'Missing required variables'
      );
    });
  });

  describe('Table Variable Mapping', () => {
    it('should map all table variables correctly', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
        row_count_approx: 1000000,
        column_count: 15,
        existing_comment: 'Customer master table',
      };
      const workUnit = {
        database: 'production',
      };
      const metadata = {
        columns: [
          { name: 'id' },
          { name: 'name' },
          { name: 'email' },
        ],
        primary_key: ['id'],
        foreign_keys: [
          {
            from_column: 'customer_id',
            to_table: 'orders',
            to_column: 'id',
          },
        ],
        referenced_by: [
          { from_table: 'orders', from_column: 'customer_id' },
        ],
      };
      const samples: any[] = [{ id: 123, name: 'John', email: 'john@example.com' }];

      const variables = mapTableVariables(tableSpec, workUnit, metadata, samples);

      expect(variables.database).toBe('production');
      expect(variables.schema).toBe('public');
      expect(variables.table).toBe('customers');
      expect(variables.row_count).toBe('1000000');
      expect(variables.column_count).toBe('15');
      expect(variables.column_list).toBe('id, name, email');
      expect(variables.primary_key).toBe('id');
      expect(variables.foreign_keys).toBe('customer_id → orders.id');
      expect(variables.referenced_by).toBe('orders.customer_id');
      expect(variables.existing_comment).toBe('Customer master table');
      expect(variables.sample_row).toContain('"id"');
    });

    it('should handle missing metadata gracefully', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = { database: 'production' };
      const metadata = {};
      const samples: any[] = [];

      const variables = mapTableVariables(tableSpec, workUnit, metadata, samples);

      expect(variables.primary_key).toBe('None');
      expect(variables.foreign_keys).toBe('None');
      expect(variables.referenced_by).toBe('None');
      expect(variables.sample_row).toBe('No sample data available');
      expect(variables.row_count).toBe('0');
      expect(variables.column_count).toBe('0');
    });
  });

  describe('Column Variable Mapping', () => {
    it('should map all column variables correctly', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
        is_nullable: 'NO',
        column_default: null,
        comment: 'Customer email address',
      };
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = {
        database: 'production',
      };
      const sampleValues = [
        'john@example.com',
        'jane@test.org',
        'bob@company.com',
      ];

      const variables = mapColumnVariables(
        column,
        tableSpec,
        workUnit,
        sampleValues
      );

      expect(variables.database).toBe('production');
      expect(variables.schema).toBe('public');
      expect(variables.table).toBe('customers');
      expect(variables.column).toBe('email');
      expect(variables.data_type).toBe('varchar(255)');
      expect(variables.nullable).toBe('NO');
      expect(variables.default).toBe('NULL');
      expect(variables.existing_comment).toBe('Customer email address');
      expect(variables.sample_values).toContain('john@example.com');
    });

    it('should handle missing values gracefully', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
      };
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = { database: 'production' };
      const sampleValues: any[] = [];

      const variables = mapColumnVariables(
        column,
        tableSpec,
        workUnit,
        sampleValues
      );

      expect(variables.nullable).toBe('NO');
      expect(variables.default).toBe('NULL');
      expect(variables.existing_comment).toBe('');
      expect(variables.sample_values).toBe('Sample values not available');
    });

    it('should truncate long sample values', () => {
      const column = {
        name: 'description',
        data_type: 'text',
      };
      const tableSpec = {
        schema_name: 'public',
        table_name: 'products',
      };
      const workUnit = { database: 'production' };
      const sampleValues = [
        'A'.repeat(200), // Very long value
        'Short',
      ];

      const variables = mapColumnVariables(
        column,
        tableSpec,
        workUnit,
        sampleValues
      );

      expect(variables.sample_values).toContain('...');
      expect(variables.sample_values.length).toBeLessThan(200);
    });
  });
});


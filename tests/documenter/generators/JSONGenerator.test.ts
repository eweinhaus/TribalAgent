/**
 * Unit tests for JSONGenerator
 */

import { describe, it, expect } from 'vitest';
import { JSONGenerator } from '../../src/agents/documenter/generators/JSONGenerator.js';
import type { TableDocumentationData } from '../../src/agents/documenter/generators/types.js';

describe('JSONGenerator', () => {
  const createTestData = (overrides?: Partial<TableDocumentationData>): TableDocumentationData => ({
    database: 'test_db',
    schema: 'public',
    table: 'test_table',
    description: 'Test table description',
    metadata: {
      row_count_approx: 1000,
      column_count: 3,
      primary_key: ['id'],
      foreign_keys: [],
      indexes: [],
      referenced_by: [],
    },
    columns: [
      {
        name: 'id',
        data_type: 'integer',
        is_nullable: 'NO',
        description: 'Primary key identifier',
        sample_values: ['1', '2', '3'],
      },
      {
        name: 'name',
        data_type: 'varchar(255)',
        is_nullable: 'NO',
        description: 'Name of the record',
        sample_values: ['Alice', 'Bob'],
      },
      {
        name: 'email',
        data_type: 'varchar(255)',
        is_nullable: 'YES',
        description: 'Email address',
      },
    ],
    sampleData: [
      { id: 1, name: 'Alice', email: 'alice@example.com' },
      { id: 2, name: 'Bob', email: 'bob@example.com' },
    ],
    ...overrides,
  });

  describe('generate', () => {
    it('should generate valid JSON', () => {
      const data = createTestData();
      const json = JSONGenerator.generate(data);

      // Should be valid JSON
      expect(() => JSON.parse(json)).not.toThrow();
    });

    it('should include all required fields', () => {
      const data = createTestData();
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.schema_version).toBe('1.0');
      expect(parsed.database).toBe('test_db');
      expect(parsed.schema).toBe('public');
      expect(parsed.table).toBe('test_table');
      expect(parsed.description).toBe('Test table description');
      expect(parsed.metadata).toBeDefined();
      expect(parsed.columns).toBeDefined();
      expect(parsed.sample_data).toBeDefined();
    });

    it('should format metadata correctly', () => {
      const data = createTestData();
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.metadata.row_count_approx).toBe(1000);
      expect(parsed.metadata.column_count).toBe(3);
      expect(parsed.metadata.primary_key).toEqual(['id']);
      expect(parsed.metadata.foreign_keys).toEqual([]);
      expect(parsed.metadata.indexes).toEqual([]);
    });

    it('should format columns correctly', () => {
      const data = createTestData();
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.columns).toHaveLength(3);
      expect(parsed.columns[0].name).toBe('id');
      expect(parsed.columns[0].data_type).toBe('integer');
      expect(parsed.columns[0].is_nullable).toBe('NO');
      expect(parsed.columns[0].description).toBe('Primary key identifier');
      expect((parsed.columns[0] as any).sample_values).toEqual(['1', '2', '3']);
    });

    it('should limit sample_data to 5 rows', () => {
      const data = createTestData({
        sampleData: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
          { id: 3, name: 'Charlie' },
          { id: 4, name: 'David' },
          { id: 5, name: 'Eve' },
          { id: 6, name: 'Frank' }, // Should be excluded
        ],
      });
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.sample_data).toHaveLength(5);
      expect(parsed.sample_data[4].id).toBe(5);
    });

    it('should handle empty table (no rows)', () => {
      const data = createTestData({
        sampleData: [],
      });
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.sample_data).toEqual([]);
    });

    it('should handle missing optional fields', () => {
      const data = createTestData({
        metadata: {
          column_count: 3,
          primary_key: ['id'],
          foreign_keys: [],
          indexes: [],
        },
      });
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      // Should still generate valid JSON
      expect(parsed.schema_version).toBe('1.0');
      expect(parsed.metadata.row_count_approx).toBeUndefined();
    });

    it('should handle null values in sample data', () => {
      const data = createTestData({
        sampleData: [
          { id: 1, name: null, email: 'test@example.com' },
        ],
      });
      const json = JSONGenerator.generate(data);
      const parsed = JSON.parse(json);

      expect(parsed.sample_data[0].name).toBeNull();
    });
  });

  describe('formatColumn', () => {
    it('should format column with all fields', () => {
      const column = {
        name: 'test_column',
        data_type: 'varchar(255)',
        is_nullable: 'YES',
        description: 'Test description',
        sample_values: ['value1', 'value2'],
        column_default: 'default_value',
      };

      const result = JSONGenerator.formatColumn(column);

      expect(result).toEqual({
        name: 'test_column',
        data_type: 'varchar(255)',
        is_nullable: 'YES',
        description: 'Test description',
        sample_values: ['value1', 'value2'],
        column_default: 'default_value',
      });
    });

    it('should handle column without sample values', () => {
      const column = {
        name: 'test_column',
        data_type: 'integer',
        is_nullable: 'NO',
        description: 'Test description',
      };

      const result = JSONGenerator.formatColumn(column);

      expect((result as any).sample_values).toBeUndefined();
    });

    it('should limit sample values to 10', () => {
      const column = {
        name: 'test_column',
        data_type: 'varchar(255)',
        is_nullable: 'NO',
        description: 'Test description',
        sample_values: Array.from({ length: 15 }, (_, i) => `value${i}`),
      };

      const result = JSONGenerator.formatColumn(column);

      expect(result.sample_values).toHaveLength(10);
    });
  });

  describe('formatMetadata', () => {
    it('should format metadata with all fields', () => {
      const metadata = {
        row_count_approx: 1000,
        column_count: 3,
        primary_key: ['id'],
        foreign_keys: [
          {
            column_name: 'user_id',
            referenced_table: 'users',
            referenced_column: 'id',
          },
        ],
        indexes: [
          { index_name: 'idx_name', index_definition: 'CREATE INDEX...' },
        ],
        referenced_by: [
          {
            referencing_table: 'orders',
            referencing_column: 'customer_id',
          },
        ],
      };

      const result = JSONGenerator.formatMetadata(metadata);

      expect((result as any).row_count_approx).toBe(1000);
      expect((result as any).column_count).toBe(3);
      expect((result as any).primary_key).toEqual(['id']);
      expect((result as any).foreign_keys).toHaveLength(1);
      expect((result as any).indexes).toHaveLength(1);
      expect((result as any).referenced_by).toHaveLength(1);
    });

    it('should handle missing optional fields', () => {
      const metadata = {
        column_count: 3,
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      const result = JSONGenerator.formatMetadata(metadata);

      expect((result as any).row_count_approx).toBeUndefined();
      expect((result as any).referenced_by).toBeUndefined();
    });
  });

  describe('formatSampleData', () => {
    it('should limit to 5 rows by default', () => {
      const sampleRows = Array.from({ length: 10 }, (_, i) => ({ id: i, name: `Name${i}` }));
      const result = JSONGenerator.formatSampleData(sampleRows);

      expect(result).toHaveLength(5);
    });

    it('should truncate string values > 100 characters', () => {
      const longString = 'a'.repeat(150);
      const sampleRows = [
        { id: 1, description: longString },
      ];

      const result = JSONGenerator.formatSampleData(sampleRows);

      expect(result[0].description).toBe('a'.repeat(97) + '...');
      expect(result[0].description.length).toBe(100);
    });

    it('should preserve data types', () => {
      const sampleRows = [
        { id: 1, name: 'Alice', active: true, count: 42 },
      ];

      const result = JSONGenerator.formatSampleData(sampleRows);

      expect(typeof result[0].id).toBe('number');
      expect(typeof result[0].name).toBe('string');
      expect(typeof result[0].active).toBe('boolean');
      expect(typeof result[0].count).toBe('number');
    });

    it('should handle null values', () => {
      const sampleRows = [
        { id: 1, name: null, email: 'test@example.com' },
      ];

      const result = JSONGenerator.formatSampleData(sampleRows);

      expect(result[0].name).toBeNull();
      expect(result[0].email).toBe('test@example.com');
    });

    it('should handle empty array', () => {
      const result = JSONGenerator.formatSampleData([]);

      expect(result).toEqual([]);
    });
  });
});

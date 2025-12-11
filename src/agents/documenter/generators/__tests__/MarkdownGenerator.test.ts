/**
 * Unit tests for MarkdownGenerator
 */

import { describe, it, expect } from 'vitest';
import { MarkdownGenerator } from '../MarkdownGenerator.js';
import type { TableDocumentationData } from '../types.js';

describe('MarkdownGenerator', () => {
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
    it('should generate Markdown with all sections', () => {
      const data = createTestData();
      const markdown = MarkdownGenerator.generate(data);

      // Check header
      expect(markdown).toContain('# public.test_table');
      expect(markdown).toContain('Test table description');

      // Check Schema Information
      expect(markdown).toContain('## Schema Information');
      expect(markdown).toContain('- **Database**: test_db');
      expect(markdown).toContain('- **Schema**: public');
      expect(markdown).toContain('- **Table**: test_table');
      expect(markdown).toContain('- **Row Count**: ~1,000');
      expect(markdown).toContain('- **Columns**: 3');

      // Check Columns section
      expect(markdown).toContain('## Columns');
      expect(markdown).toContain('### id');
      expect(markdown).toContain('### name');
      expect(markdown).toContain('### email');

      // Check Relationships section
      expect(markdown).toContain('## Relationships');

      // Check Sample Data section
      expect(markdown).toContain('## Sample Data');
    });

    it('should handle empty table (no rows)', () => {
      const data = createTestData({
        sampleData: [],
      });
      const markdown = MarkdownGenerator.generate(data);

      // Should not have Sample Data section
      expect(markdown).not.toContain('## Sample Data');
    });

    it('should handle no relationships', () => {
      const data = createTestData({
        metadata: {
          column_count: 3,
          primary_key: [],
          foreign_keys: [],
          indexes: [],
          referenced_by: [],
        },
      });
      const markdown = MarkdownGenerator.generate(data);

      expect(markdown).toContain('## Relationships');
      expect(markdown).toContain('- **Primary Key**: None');
      expect(markdown).toContain('- **Foreign Keys**: None');
      expect(markdown).toContain('- **Referenced By**: None');
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
      const markdown = MarkdownGenerator.generate(data);

      // Should still generate valid Markdown
      expect(markdown).toContain('# public.test_table');
    });

    it('should format relationships correctly', () => {
      const data = createTestData({
        metadata: {
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
          indexes: [],
          referenced_by: [
            {
              referencing_table: 'orders',
              referencing_column: 'customer_id',
            },
          ],
        },
      });
      const markdown = MarkdownGenerator.generate(data);

      expect(markdown).toContain('- **Primary Key**: id');
      expect(markdown).toContain('user_id → users.id');
      expect(markdown).toContain('orders.customer_id');
    });
  });

  describe('formatColumnSection', () => {
    it('should format column with all fields', () => {
      const column = {
        name: 'test_column',
        data_type: 'varchar(255)',
        is_nullable: 'NO',
        description: 'Test description',
        sample_values: ['value1', 'value2'],
      };

      const result = MarkdownGenerator.formatColumnSection(column);

      expect(result).toContain('### test_column');
      expect(result).toContain('- **Type**: varchar(255)');
      expect(result).toContain('- **Nullable**: NO');
      expect(result).toContain('- **Description**: Test description');
      expect(result).toContain('- **Sample Values**: value1, value2');
    });

    it('should handle column without sample values', () => {
      const column = {
        name: 'test_column',
        data_type: 'integer',
        is_nullable: 'YES',
        description: 'Test description',
      };

      const result = MarkdownGenerator.formatColumnSection(column);

      expect(result).toContain('- **Sample Values**: No sample values available');
    });
  });

  describe('formatSampleData', () => {
    it('should format up to 5 rows', () => {
      const sampleRows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
        { id: 3, name: 'Charlie' },
        { id: 4, name: 'David' },
        { id: 5, name: 'Eve' },
        { id: 6, name: 'Frank' }, // Should be excluded
      ];

      const result = MarkdownGenerator.formatSampleData(sampleRows, 5);

      expect(result).toContain('```');
      expect(result).toContain('"id": 1');
      expect(result).toContain('"id": 5');
      expect(result).not.toContain('"id": 6');
    });

    it('should truncate string values > 100 characters', () => {
      const longString = 'a'.repeat(150);
      const sampleRows = [
        { id: 1, description: longString },
      ];

      const result = MarkdownGenerator.formatSampleData(sampleRows);

      expect(result).toContain('a'.repeat(97) + '...');
      expect(result).not.toContain(longString);
    });

    it('should handle null values', () => {
      const sampleRows = [
        { id: 1, name: null, email: 'test@example.com' },
      ];

      const result = MarkdownGenerator.formatSampleData(sampleRows);

      expect(result).toContain('null');
    });

    it('should handle empty array', () => {
      const result = MarkdownGenerator.formatSampleData([]);

      expect(result).toContain('No sample data available');
    });
  });

  describe('formatRelationships', () => {
    it('should format primary key', () => {
      const metadata = {
        column_count: 3,
        primary_key: ['id'],
        foreign_keys: [],
        indexes: [],
      };

      const result = MarkdownGenerator.formatRelationships(metadata);

      expect(result).toContain('- **Primary Key**: id');
    });

    it('should format "None" when no primary key', () => {
      const metadata = {
        column_count: 3,
        primary_key: [],
        foreign_keys: [],
        indexes: [],
      };

      const result = MarkdownGenerator.formatRelationships(metadata);

      expect(result).toContain('- **Primary Key**: None');
    });

    it('should format foreign keys', () => {
      const metadata = {
        column_count: 3,
        primary_key: ['id'],
        foreign_keys: [
          {
            column_name: 'user_id',
            referenced_table: 'users',
            referenced_column: 'id',
          },
        ],
        indexes: [],
      };

      const result = MarkdownGenerator.formatRelationships(metadata);

      expect(result).toContain('user_id → users.id');
    });

    it('should format referenced by', () => {
      const metadata = {
        column_count: 3,
        primary_key: ['id'],
        foreign_keys: [],
        indexes: [],
        referenced_by: [
          {
            referencing_table: 'orders',
            referencing_column: 'customer_id',
          },
        ],
      };

      const result = MarkdownGenerator.formatRelationships(metadata);

      expect(result).toContain('orders.customer_id');
    });
  });
});

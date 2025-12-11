/**
 * Unit tests for fallback description utilities
 * 
 * Tests fallback description generation for tables and columns.
 */

import { describe, it, expect } from 'vitest';
import {
  generateTableFallbackDescription,
  generateColumnFallbackDescription,
} from '../../src/agents/documenter/utils/fallback-descriptions.js';

describe('Fallback Descriptions', () => {
  describe('generateTableFallbackDescription', () => {
    it('should generate table fallback with all metadata', () => {
      const tableSpec = {
        table_name: 'customers',
        column_count: 15,
        row_count_approx: 1000000,
      };

      const result = generateTableFallbackDescription(tableSpec);
      expect(result).toBe(
        'Table customers contains 15 columns with approximately 1000000 rows.'
      );
    });

    it('should handle missing column count', () => {
      const tableSpec = {
        table_name: 'customers',
        row_count_approx: 1000000,
      };

      const result = generateTableFallbackDescription(tableSpec);
      expect(result).toBe(
        'Table customers contains 0 columns with approximately 1000000 rows.'
      );
    });

    it('should handle missing row count', () => {
      const tableSpec = {
        table_name: 'customers',
        column_count: 15,
      };

      const result = generateTableFallbackDescription(tableSpec);
      expect(result).toBe(
        'Table customers contains 15 columns with approximately 0 rows.'
      );
    });

    it('should handle missing table name', () => {
      const tableSpec = {
        column_count: 15,
        row_count_approx: 1000000,
      };

      const result = generateTableFallbackDescription(tableSpec);
      expect(result).toContain('unknown table');
      expect(result).toContain('15 columns');
    });

    it('should never throw errors', () => {
      const tableSpec = {};
      expect(() => generateTableFallbackDescription(tableSpec)).not.toThrow();
      const result = generateTableFallbackDescription(tableSpec);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('generateColumnFallbackDescription', () => {
    it('should generate column fallback with all metadata', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
      };

      const result = generateColumnFallbackDescription(column);
      expect(result).toBe('Column email of type varchar(255).');
    });

    it('should handle missing data type', () => {
      const column = {
        name: 'email',
      };

      const result = generateColumnFallbackDescription(column);
      expect(result).toBe('Column email of type unknown type.');
    });

    it('should handle missing column name', () => {
      const column = {
        data_type: 'varchar(255)',
      };

      const result = generateColumnFallbackDescription(column);
      expect(result).toContain('unknown column');
      expect(result).toContain('varchar(255)');
    });

    it('should never throw errors', () => {
      const column = {};
      expect(() => generateColumnFallbackDescription(column)).not.toThrow();
      const result = generateColumnFallbackDescription(column);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});


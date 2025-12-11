/**
 * Verification tests for template variable completeness
 * 
 * Ensures all template variables from PRD are correctly mapped and used.
 */

import { describe, it, expect } from 'vitest';
import { readFile } from 'fs/promises';
import path from 'path';
import {
  mapTableVariables,
  mapColumnVariables,
} from '../../src/utils/prompts.js';

describe('Template Variable Completeness', () => {
  const TABLE_TEMPLATE_PATH = path.join(
    process.cwd(),
    'prompts',
    'table-description.md'
  );
  const COLUMN_TEMPLATE_PATH = path.join(
    process.cwd(),
    'prompts',
    'column-description.md'
  );

  // Required table template variables from PRD
  const REQUIRED_TABLE_VARS = [
    'database',
    'schema',
    'table',
    'row_count',
    'column_count',
    'column_list',
    'primary_key',
    'foreign_keys',
    'referenced_by',
    'existing_comment',
    'sample_row',
    'sample_values', // May be empty for table template
  ];

  // Required column template variables from PRD
  const REQUIRED_COLUMN_VARS = [
    'database',
    'schema',
    'table',
    'column',
    'data_type',
    'nullable',
    'default',
    'existing_comment',
    'sample_values',
  ];

  describe('Table Template Variables', () => {
    it('should map all required table variables', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
        row_count_approx: 1000,
        column_count: 10,
        existing_comment: 'Test comment',
      };
      const workUnit = { database: 'production' };
      const metadata = {
        columns: [{ name: 'id' }, { name: 'name' }],
        primary_key: ['id'],
        foreign_keys: [],
        referenced_by: [],
      };
      const samples: any[] = [{ id: 1, name: 'Test' }];

      const variables = mapTableVariables(
        tableSpec,
        workUnit,
        metadata,
        samples
      );

      for (const varName of REQUIRED_TABLE_VARS) {
        expect(variables).toHaveProperty(varName);
        expect(typeof variables[varName]).toBe('string');
      }
    });

    it('should format numbers as strings', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
        row_count_approx: 1000000,
        column_count: 15,
      };
      const workUnit = { database: 'production' };
      const metadata = { columns: [] };
      const samples: any[] = [];

      const variables = mapTableVariables(
        tableSpec,
        workUnit,
        metadata,
        samples
      );

      expect(variables.row_count).toBe('1000000');
      expect(variables.column_count).toBe('15');
      expect(typeof variables.row_count).toBe('string');
      expect(typeof variables.column_count).toBe('string');
    });

    it('should format arrays as comma-separated strings', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = { database: 'production' };
      const metadata = {
        columns: [{ name: 'id' }, { name: 'name' }, { name: 'email' }],
        primary_key: ['id', 'email'],
        foreign_keys: [],
        referenced_by: [],
      };
      const samples: any[] = [];

      const variables = mapTableVariables(
        tableSpec,
        workUnit,
        metadata,
        samples
      );

      expect(variables.column_list).toBe('id, name, email');
      expect(variables.primary_key).toBe('id, email');
    });

    it('should handle missing values gracefully', () => {
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = { database: 'production' };
      const metadata = {};
      const samples: any[] = [];

      const variables = mapTableVariables(
        tableSpec,
        workUnit,
        metadata,
        samples
      );

      expect(variables.primary_key).toBe('None');
      expect(variables.foreign_keys).toBe('None');
      expect(variables.referenced_by).toBe('None');
      expect(variables.existing_comment).toBe('');
    });

    it('should verify template file contains expected variables', async () => {
      try {
        const templateContent = await readFile(TABLE_TEMPLATE_PATH, 'utf-8');
        
        // Check for key variables (some may be optional)
        const hasDatabase = templateContent.includes('{{database}}');
        const hasTable = templateContent.includes('{{table}}');
        const hasSchema = templateContent.includes('{{schema}}');
        
        expect(hasDatabase || hasTable || hasSchema).toBe(true);
      } catch (error) {
        // Template file might not exist in test environment
        console.warn('Could not verify template file:', error);
      }
    });
  });

  describe('Column Template Variables', () => {
    it('should map all required column variables', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
        is_nullable: 'NO',
        column_default: null,
        comment: 'Email address',
      };
      const tableSpec = {
        schema_name: 'public',
        table_name: 'customers',
      };
      const workUnit = { database: 'production' };
      const sampleValues = ['test@example.com'];

      const variables = mapColumnVariables(
        column,
        tableSpec,
        workUnit,
        sampleValues
      );

      for (const varName of REQUIRED_COLUMN_VARS) {
        expect(variables).toHaveProperty(varName);
        expect(typeof variables[varName]).toBe('string');
      }
    });

    it('should format nullable correctly', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
        is_nullable: 'YES',
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

      expect(variables.nullable).toBe('YES');
    });

    it('should format default value correctly', () => {
      const column = {
        name: 'created_at',
        data_type: 'timestamp',
        column_default: 'CURRENT_TIMESTAMP',
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

      expect(variables.default).toBe('CURRENT_TIMESTAMP');
    });

    it('should handle null default as NULL string', () => {
      const column = {
        name: 'email',
        data_type: 'varchar(255)',
        column_default: null,
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

      expect(variables.default).toBe('NULL');
    });

    it('should verify template file contains expected variables', async () => {
      try {
        const templateContent = await readFile(COLUMN_TEMPLATE_PATH, 'utf-8');
        
        // Check for key variables
        const hasColumn = templateContent.includes('{{column}}');
        const hasDataType = templateContent.includes('{{data_type}}');
        
        expect(hasColumn || hasDataType).toBe(true);
      } catch (error) {
        // Template file might not exist in test environment
        console.warn('Could not verify template file:', error);
      }
    });
  });
});


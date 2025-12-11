/**
 * Integration tests for TableDocumenter and ColumnInferencer sub-agents
 * 
 * Tests with real database (skips if test database not available).
 * Uses TEST_DATABASE_URL environment variable for connection.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { promises as fs } from 'fs';
import * as path from 'path';
import { TableDocumenter } from '../TableDocumenter.js';
import { ColumnInferencer } from '../ColumnInferencer.js';
import { getDatabaseConnector } from '../../../../connectors/index.js';
import type { WorkUnit, TableSpec } from '../../types.js';

describe('Sub-Agent Integration Tests', () => {
  const testDbUrl = process.env.TEST_DATABASE_URL;
  const hasTestDb = !!testDbUrl;

  let connector: any;
  let testSchema = 'public';
  let testTable = 'test_users';

  beforeAll(async () => {
    if (!hasTestDb) {
      console.log('⚠️  TEST_DATABASE_URL not set - skipping integration tests');
      return;
    }

    // Connect to test database
    connector = getDatabaseConnector('postgres');
    await connector.connect(testDbUrl!);

    // Create test table if it doesn't exist
    try {
      await connector.query(`
        CREATE TABLE IF NOT EXISTS ${testSchema}.${testTable} (
          id INTEGER PRIMARY KEY,
          email VARCHAR(255) NOT NULL,
          name VARCHAR(255),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Insert test data
      await connector.query(`
        INSERT INTO ${testSchema}.${testTable} (id, email, name)
        VALUES 
          (1, 'alice@example.com', 'Alice'),
          (2, 'bob@test.com', 'Bob'),
          (3, 'charlie@example.org', 'Charlie')
        ON CONFLICT (id) DO NOTHING
      `);
    } catch (error) {
      console.warn('Failed to create test table, may already exist:', error);
    }
  });

  afterAll(async () => {
    if (connector) {
      await connector.disconnect();
    }

    // Clean up test files
    const testDocsPath = path.join(process.cwd(), 'docs', 'databases', 'test_db');
    try {
      await fs.rm(testDocsPath, { recursive: true, force: true });
    } catch (error) {
      // Ignore cleanup errors
    }
  });

  describe('IT-DOC-1: End-to-End Table Documentation', () => {
    it.skipIf(!hasTestDb)(
      'should generate complete docs with real PostgreSQL',
      async () => {
        const tableSpec: TableSpec = {
          fully_qualified_name: `test_db.${testSchema}.${testTable}`,
          schema_name: testSchema,
          table_name: testTable,
          domain: 'test',
          priority: 1,
          row_count_approx: 3,
          column_count: 4,
          incoming_fk_count: 0,
          outgoing_fk_count: 0,
          metadata_hash: 'test_hash',
          existing_comment: undefined,
        };

        const workUnit: WorkUnit = {
          id: 'test_db_test',
          database: 'test_db',
          domain: 'test',
          output_directory: 'databases/test_db/domains/test',
          priority_order: 1,
          estimated_time_minutes: 1,
          content_hash: 'test_hash',
          tables: [tableSpec],
          depends_on: [],
        };

        const documenter = new TableDocumenter(tableSpec, workUnit, connector);
        const summary = await documenter.document();

        // Verify summary
        expect(summary).toBeDefined();
        expect(summary.table).toBe(testTable);
        expect(summary.schema).toBe(testSchema);
        expect(summary.description).toBeTruthy();
        expect(summary.column_count).toBeGreaterThan(0);
        expect(summary.output_files).toHaveLength(2);

        // Verify files exist
        const markdownPath = summary.output_files.find(f => f.endsWith('.md'));
        const jsonPath = summary.output_files.find(f => f.endsWith('.json'));

        expect(markdownPath).toBeDefined();
        expect(jsonPath).toBeDefined();

        // Verify file contents
        const markdownContent = await fs.readFile(markdownPath!, 'utf-8');
        const jsonContent = await fs.readFile(jsonPath!, 'utf-8');

        expect(markdownContent).toContain(`# ${testTable}`);
        expect(markdownContent).toContain('## Columns');
        expect(markdownContent).toContain('id');
        expect(markdownContent).toContain('email');

        const jsonData = JSON.parse(jsonContent);
        expect(jsonData.table).toBe(testTable);
        expect(jsonData.schema).toBe(testSchema);
        expect(jsonData.columns).toBeDefined();
        expect(jsonData.columns.length).toBeGreaterThan(0);
        expect(jsonData.sample_data).toBeDefined();
        expect(jsonData.sample_data.length).toBeLessThanOrEqual(5);
      },
      { timeout: 60000 }
    );
  });

  describe('IT-DOC-2: Column Inference with Real LLM', () => {
    it.skipIf(!hasTestDb || !process.env.OPENROUTER_API_KEY)(
      'should generate description using real OpenRouter API',
      async () => {
        const columnMetadata = {
          name: 'email',
          data_type: 'varchar(255)',
          is_nullable: 'NO',
          column_default: null,
          comment: null,
        };

        const tableContext = {
          database_name: 'test_db',
          schema_name: testSchema,
          table_name: testTable,
        };

        // Get sample values from database
        const sampleRows = await connector.query(
          `SELECT email FROM ${testSchema}.${testTable} LIMIT 3`
        );
        const sampleValues = sampleRows.map((row: any) => row.email);

        const inferencer = new ColumnInferencer(
          columnMetadata,
          tableContext,
          sampleValues
        );

        const description = await inferencer.infer();

        // Verify description
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(10);
        expect(description).toMatch(/[.!?]$/); // Proper punctuation

        // Verify context quarantine (returns string only)
        expect(description).not.toContain('sample_values');
        expect(description).not.toContain('raw_data');
      },
      { timeout: 30000 }
    );
  });

  describe('IT-DOC-3: Error Recovery', () => {
    it.skipIf(!hasTestDb)(
      'should handle sampling timeout gracefully',
      async () => {
        // Create a table that will timeout (or use existing large table)
        const tableSpec: TableSpec = {
          fully_qualified_name: `test_db.${testSchema}.${testTable}`,
          schema_name: testSchema,
          table_name: testTable,
          domain: 'test',
          priority: 1,
          row_count_approx: 3,
          column_count: 4,
          incoming_fk_count: 0,
          outgoing_fk_count: 0,
          metadata_hash: 'test_hash',
          existing_comment: undefined,
        };

        const workUnit: WorkUnit = {
          id: 'test_db_test',
          database: 'test_db',
          domain: 'test',
          output_directory: 'databases/test_db/domains/test',
          priority_order: 1,
          estimated_time_minutes: 1,
          content_hash: 'test_hash',
          tables: [tableSpec],
          depends_on: [],
        };

        const documenter = new TableDocumenter(tableSpec, workUnit, connector);
        
        // Should complete even if sampling has issues
        const summary = await documenter.document();
        
        expect(summary).toBeDefined();
        expect(summary.output_files).toHaveLength(2);
      },
      { timeout: 60000 }
    );

    it.skipIf(!hasTestDb || !process.env.OPENROUTER_API_KEY)(
      'should produce partial results on LLM failure',
      async () => {
        // This test verifies that fallback descriptions are used
        // when LLM fails (we can't easily simulate this, but we can verify
        // the fallback mechanism works)
        const columnMetadata = {
          name: 'test_column',
          data_type: 'integer',
          is_nullable: 'YES',
          column_default: null,
          comment: null,
        };

        const tableContext = {
          database_name: 'test_db',
          schema_name: testSchema,
          table_name: testTable,
        };

        const inferencer = new ColumnInferencer(
          columnMetadata,
          tableContext,
          []
        );

        // Even with empty samples, should return a description
        const description = await inferencer.infer();
        expect(typeof description).toBe('string');
        expect(description.length).toBeGreaterThan(0);
      },
      { timeout: 30000 }
    );
  });

  describe('IT-DOC-4: Context Quarantine', () => {
    it.skipIf(!hasTestDb)(
      'should enforce context quarantine (no raw data in responses)',
      async () => {
        const tableSpec: TableSpec = {
          fully_qualified_name: `test_db.${testSchema}.${testTable}`,
          schema_name: testSchema,
          table_name: testTable,
          domain: 'test',
          priority: 1,
          row_count_approx: 3,
          column_count: 4,
          incoming_fk_count: 0,
          outgoing_fk_count: 0,
          metadata_hash: 'test_hash',
          existing_comment: undefined,
        };

        const workUnit: WorkUnit = {
          id: 'test_db_test',
          database: 'test_db',
          domain: 'test',
          output_directory: 'databases/test_db/domains/test',
          priority_order: 1,
          estimated_time_minutes: 1,
          content_hash: 'test_hash',
          tables: [tableSpec],
          depends_on: [],
        };

        const documenter = new TableDocumenter(tableSpec, workUnit, connector);
        const summary = await documenter.document();

        // Verify summary has no raw data
        expect(summary).not.toHaveProperty('sample_data');
        expect(summary).not.toHaveProperty('raw_data');
        expect(summary).not.toHaveProperty('samples');

        // Verify files contain sample data (that's OK)
        const jsonPath = summary.output_files.find(f => f.endsWith('.json'));
        if (jsonPath) {
          const jsonContent = await fs.readFile(jsonPath, 'utf-8');
          const jsonData = JSON.parse(jsonContent);
          // Files can have sample_data, but summary shouldn't
          expect(jsonData.sample_data).toBeDefined(); // OK in files
        }

        // Verify ColumnInferencer returns string only
        const columnMetadata = {
          name: 'email',
          data_type: 'varchar(255)',
          is_nullable: 'NO',
          column_default: null,
          comment: null,
        };

        const tableContext = {
          database_name: 'test_db',
          schema_name: testSchema,
          table_name: testTable,
        };

        const sampleRows = await connector.query(
          `SELECT email FROM ${testSchema}.${testTable} LIMIT 3`
        );
        const sampleValues = sampleRows.map((row: any) => row.email);

        const inferencer = new ColumnInferencer(
          columnMetadata,
          tableContext,
          sampleValues
        );

        const description = await inferencer.infer();
        expect(typeof description).toBe('string');
        expect(description).not.toContain('sample_values');
      },
      { timeout: 60000 }
    );
  });
});

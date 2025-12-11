/**
 * End-to-End Test: Complete Pipeline
 * 
 * Tests the complete documentation pipeline:
 * - Plan generation (or loading)
 * - Documenter execution
 * - File generation
 * - Manifest generation
 * 
 * Test Scenario: IT-DOC-5 (from Phase 5 PRD)
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as path from 'path';
import { promises as fs } from 'fs';
import {
  setupTestEnvironment,
  generateTestPlan,
  writeTestPlan,
  changeToTestDirectory,
  restoreOriginalDirectory,
  type TestEnvironment,
} from './setup.js';
import {
  verifyDocumentationFiles,
  verifyMarkdownStructure,
  verifyJSONStructure,
  loadAndValidateManifest,
  countFiles,
} from './helpers.js';
import { teardownTestEnvironment, cleanupTestTables } from './teardown.js';
import { runDocumenter } from '../../index.js';

describe('E2E: Complete Pipeline Test', () => {
  let env: TestEnvironment | undefined;
  let originalCwd: string;

  beforeAll(async () => {
    originalCwd = process.cwd();
    
    // Clean up any existing test artifacts first
    const testOutputDir = path.join(process.cwd(), 'test-output');
    const testProgressDir = path.join(process.cwd(), 'test-progress');
    try {
      await fs.rm(testOutputDir, { recursive: true, force: true });
      await fs.rm(testProgressDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
    
    // Setup test environment
    env = await setupTestEnvironment({
      testDatabaseUrl: process.env.TEST_DATABASE_URL,
    });

    if (!env.hasTestDb) {
      console.log('⚠️  TEST_DATABASE_URL not set - skipping E2E tests');
      return;
    }

    // Change to test directory for progress file resolution
    changeToTestDirectory(env.progressDir);
  });

  afterAll(async () => {
    // Restore original working directory
    if (originalCwd) {
      restoreOriginalDirectory(originalCwd);
    }

    // Cleanup
    if (env?.hasTestDb) {
      await cleanupTestTables(env);
    }
    if (env) {
      await teardownTestEnvironment(env);
    }
  });

  it.skipIf(!env?.hasTestDb)(
    'should complete full pipeline: plan → document → manifest',
    async () => {
      if (!env) throw new Error('Test environment not initialized');
      
      // Step 1: Generate test plan
      const plan = await generateTestPlan(env);
      await writeTestPlan(plan, env.progressDir);

      // Verify plan was written
      const planPath = path.join(env.progressDir, 'progress', 'documentation-plan.json');
      const planExists = await fs.access(planPath).then(() => true).catch(() => false);
      expect(planExists).toBe(true);

      // Step 2: Run documenter
      // Set docs path BEFORE running documenter
      const originalDocsPath = process.env.TRIBAL_DOCS_PATH;
      process.env.TRIBAL_DOCS_PATH = env.docsDir;
      
      // Verify it's set
      if (process.env.TRIBAL_DOCS_PATH !== env.docsDir) {
        throw new Error(`Failed to set TRIBAL_DOCS_PATH. Expected: ${env.docsDir}, Got: ${process.env.TRIBAL_DOCS_PATH}`);
      }

      try {
        await runDocumenter();
      } finally {
        // Restore original docs path
        if (originalDocsPath) {
          process.env.TRIBAL_DOCS_PATH = originalDocsPath;
        } else {
          delete process.env.TRIBAL_DOCS_PATH;
        }
      }

      // Step 3: Verify documentation files were generated
      const missingFiles = await verifyDocumentationFiles(env.docsDir, plan);
      expect(missingFiles).toHaveLength(0);

      // Step 4: Verify file structure
      for (const workUnit of plan.work_units) {
        for (const tableSpec of workUnit.tables) {
          const baseName = `${tableSpec.schema_name}.${tableSpec.table_name}`;
          const markdownPath = path.join(
            env.docsDir,
            workUnit.output_directory,
            'tables',
            `${baseName}.md`
          );
          const jsonPath = path.join(
            env.docsDir,
            workUnit.output_directory,
            'tables',
            `${baseName}.json`
          );

          // Verify markdown structure
          const markdownValidation = await verifyMarkdownStructure(
            markdownPath,
            tableSpec.table_name
          );
          expect(markdownValidation.valid).toBe(true);
          expect(markdownValidation.errors).toHaveLength(0);

          // Verify JSON structure
          const jsonValidation = await verifyJSONStructure(
            jsonPath,
            tableSpec.table_name
          );
          expect(jsonValidation.valid).toBe(true);
          expect(jsonValidation.errors).toHaveLength(0);
        }
      }

      // Step 5: Verify manifest was generated
      const manifestResult = await loadAndValidateManifest(env.docsDir);
      expect(manifestResult.valid).toBe(true);
      expect(manifestResult.errors).toHaveLength(0);
      expect(manifestResult.manifest).toBeDefined();

      if (manifestResult.manifest) {
        // Verify manifest structure
        expect(manifestResult.manifest.schema_version).toBe('1.0');
        expect(manifestResult.manifest.status).toMatch(/^(complete|partial)$/);
        expect(manifestResult.manifest.total_files).toBeGreaterThan(0);
        expect(manifestResult.manifest.indexable_files.length).toBeGreaterThan(0);

        // Verify file count matches
        const actualFileCount = await countFiles(env.docsDir, ['.md', '.json']);
        expect(manifestResult.manifest.total_files).toBe(actualFileCount);
      }
    },
    { timeout: 120000 } // 2 minutes timeout for E2E test
  );

  it('should generate files with correct content structure', async () => {
      if (!env?.hasTestDb) {
        console.log('Skipping test - database not available');
        return;
      }
      
      if (!env) {
        throw new Error('Test environment not initialized');
      }
      
      // Clean up any existing progress files and work unit directories
      const progressSubDir = path.join(env.progressDir, 'progress');
      try {
        // Remove entire progress subdirectory to ensure clean state
        await fs.rm(progressSubDir, { recursive: true, force: true });
        await fs.mkdir(progressSubDir, { recursive: true });
      } catch {
        // Ignore if directory doesn't exist
      }
      
      // Generate and run pipeline
      const plan = await generateTestPlan(env);
      await writeTestPlan(plan, env.progressDir);

      const originalDocsPath = process.env.TRIBAL_DOCS_PATH;
      process.env.TRIBAL_DOCS_PATH = env.docsDir;
      
      // Verify it's set
      if (process.env.TRIBAL_DOCS_PATH !== env.docsDir) {
        throw new Error(`Failed to set TRIBAL_DOCS_PATH. Expected: ${env.docsDir}, Got: ${process.env.TRIBAL_DOCS_PATH}`);
      }

      try {
        await runDocumenter();
      } finally {
        if (originalDocsPath) {
          process.env.TRIBAL_DOCS_PATH = originalDocsPath;
        } else {
          delete process.env.TRIBAL_DOCS_PATH;
        }
      }

      // Verify content quality
      for (const workUnit of plan.work_units) {
        for (const tableSpec of workUnit.tables) {
          const baseName = `${tableSpec.schema_name}.${tableSpec.table_name}`;
          const markdownPath = path.join(
            env.docsDir,
            workUnit.output_directory,
            'tables',
            `${baseName}.md`
          );

          const markdownContent = await fs.readFile(markdownPath, 'utf-8');

          // Verify markdown contains expected sections
          expect(markdownContent).toContain('**Database:**');
          expect(markdownContent).toContain('**Schema:**');
          expect(markdownContent).toContain('## Columns');
          expect(markdownContent).toContain(tableSpec.table_name);

          // Verify JSON contains expected data
          const jsonPath = path.join(
            env.docsDir,
            workUnit.output_directory,
            'tables',
            `${baseName}.json`
          );

          const jsonContent = await fs.readFile(jsonPath, 'utf-8');
          const jsonData = JSON.parse(jsonContent);

          // Verify JSON structure (TableDocumenter format)
          expect(jsonData.table).toBe(tableSpec.table_name);
          expect(jsonData.schema).toBe(tableSpec.schema_name);
          expect(jsonData.database).toBe(workUnit.database);
          expect(jsonData.description).toBeDefined();
          expect(Array.isArray(jsonData.columns)).toBe(true);
          expect(jsonData.columns.length).toBeGreaterThan(0);
          expect(jsonData.generated_at).toBeDefined();
        }
      }
    },
    { timeout: 120000 }
  );
});

/**
 * End-to-End Test Helper Utilities
 * 
 * Provides helper functions for test assertions and validations.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  DocumentationPlan,
  DocumentationManifest,
  DocumenterProgress,
} from '../../src/agents/documenter/types.js';

/**
 * Verify documentation files exist
 * 
 * @param docsDir Documentation directory
 * @param plan Documentation plan
 * @returns Array of missing files
 */
export async function verifyDocumentationFiles(
  docsDir: string,
  plan: DocumentationPlan
): Promise<string[]> {
  const missingFiles: string[] = [];

  for (const workUnit of plan.work_units) {
    for (const tableSpec of workUnit.tables) {
      const baseName = `${tableSpec.schema_name}.${tableSpec.table_name}`;
      const markdownPath = path.join(
        docsDir,
        workUnit.output_directory,
        'tables',
        `${baseName}.md`
      );
      const jsonPath = path.join(
        docsDir,
        workUnit.output_directory,
        'tables',
        `${baseName}.json`
      );

      try {
        await fs.access(markdownPath);
      } catch {
        missingFiles.push(markdownPath);
      }

      try {
        await fs.access(jsonPath);
      } catch {
        missingFiles.push(jsonPath);
      }
    }
  }

  return missingFiles;
}

/**
 * Verify markdown file structure
 * 
 * @param filePath Path to markdown file
 * @param expectedTable Expected table name
 * @returns Validation result
 */
export async function verifyMarkdownStructure(
  filePath: string,
  expectedTable: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];
  const content = await fs.readFile(filePath, 'utf-8');

  // Check for header (TableDocumenter uses # table format)
  if (!content.includes(`# ${expectedTable}`) && !content.includes(`# `)) {
    errors.push('Missing table header');
  }

  // Check for database/schema info (TableDocumenter uses **Database:** format)
  if (!content.includes('**Database:**') && !content.includes('**Schema:**')) {
    errors.push('Missing database/schema information');
  }

  // Check for columns section
  if (!content.includes('## Columns')) {
    errors.push('Missing Columns section');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Verify JSON file structure
 * 
 * @param filePath Path to JSON file
 * @param expectedTable Expected table name
 * @returns Validation result
 */
export async function verifyJSONStructure(
  filePath: string,
  expectedTable: string
): Promise<{ valid: boolean; errors: string[] }> {
  const errors: string[] = [];

  try {
    const content = await fs.readFile(filePath, 'utf-8');
    const data = JSON.parse(content);

    // Check required fields (TableDocumenter JSON format)
    // Note: TableDocumenter doesn't include schema_version, uses different structure
    if (data.table !== expectedTable) {
      errors.push(`Table name mismatch: expected ${expectedTable}, got ${data.table}`);
    }

    if (!data.description) {
      errors.push('Missing description');
    }

    if (!Array.isArray(data.columns)) {
      errors.push('Missing or invalid columns array');
    }

    // TableDocumenter includes: table, schema, database, description, columns, primary_key, foreign_keys, indexes, sample_data, generated_at
    if (!data.schema) {
      errors.push('Missing schema');
    }

    if (!data.database) {
      errors.push('Missing database');
    }
  } catch (error) {
    errors.push(`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Load and validate manifest
 * 
 * @param docsDir Documentation directory
 * @returns Manifest and validation result
 */
export async function loadAndValidateManifest(
  docsDir: string
): Promise<{
  manifest: DocumentationManifest | null;
  valid: boolean;
  errors: string[];
}> {
  const manifestPath = path.join(docsDir, 'documentation-manifest.json');
  const errors: string[] = [];

  try {
    const content = await fs.readFile(manifestPath, 'utf-8');
    const manifest: DocumentationManifest = JSON.parse(content);

    // Validate structure
    if (manifest.schema_version !== '1.0') {
      errors.push('Invalid schema_version');
    }

    if (!manifest.completed_at) {
      errors.push('Missing completed_at');
    }

    if (!manifest.plan_hash) {
      errors.push('Missing plan_hash');
    }

    if (manifest.status !== 'complete' && manifest.status !== 'partial') {
      errors.push('Invalid status');
    }

    // Validate file existence
    for (const file of manifest.indexable_files) {
      const filePath = path.join(docsDir, file.path);
      try {
        await fs.access(filePath);
      } catch {
        errors.push(`File listed in manifest does not exist: ${file.path}`);
      }
    }

    // Validate file count
    if (manifest.total_files !== manifest.indexable_files.length) {
      errors.push(
        `File count mismatch: total_files=${manifest.total_files}, ` +
        `indexable_files.length=${manifest.indexable_files.length}`
      );
    }

    return {
      manifest,
      valid: errors.length === 0,
      errors,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      errors.push('Manifest file not found');
    } else {
      errors.push(`Failed to load manifest: ${error instanceof Error ? error.message : String(error)}`);
    }

    return {
      manifest: null,
      valid: false,
      errors,
    };
  }
}

/**
 * Load progress file
 * 
 * @param progressDir Progress directory (root, not progress subdirectory)
 * @returns Progress or null
 */
export async function loadProgress(
  progressDir: string
): Promise<DocumenterProgress | null> {
  const progressPath = path.join(progressDir, 'progress', 'documenter-progress.json');

  try {
    const content = await fs.readFile(progressPath, 'utf-8');
    return JSON.parse(content) as DocumenterProgress;
  } catch {
    return null;
  }
}

/**
 * Verify progress file structure
 * 
 * @param progress Progress object
 * @returns Validation result
 */
export function verifyProgressStructure(
  progress: DocumenterProgress
): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (progress.schema_version !== '1.0') {
    errors.push('Invalid schema_version');
  }

  if (!progress.started_at) {
    errors.push('Missing started_at');
  }

  if (!progress.status) {
    errors.push('Missing status');
  }

  if (!progress.plan_hash) {
    errors.push('Missing plan_hash');
  }

  if (!progress.stats) {
    errors.push('Missing stats');
  }

  if (!progress.work_units || typeof progress.work_units !== 'object') {
    errors.push('Missing or invalid work_units');
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Count files in directory recursively
 * 
 * @param dirPath Directory path
 * @param extensions File extensions to count (e.g., ['.md', '.json'])
 * @returns File count
 */
export async function countFiles(
  dirPath: string,
  extensions: string[] = ['.md', '.json']
): Promise<number> {
  let count = 0;

  async function countRecursive(dir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await countRecursive(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            count++;
          }
        }
      }
    } catch {
      // Ignore errors (directory might not exist)
    }
  }

  await countRecursive(dirPath);
  return count;
}

/**
 * Get all file paths in directory recursively
 * 
 * @param dirPath Directory path
 * @param extensions File extensions to include
 * @returns Array of file paths (relative to dirPath)
 */
export async function getAllFilePaths(
  dirPath: string,
  extensions: string[] = ['.md', '.json']
): Promise<string[]> {
  const files: string[] = [];

  async function collectRecursive(dir: string, baseDir: string): Promise<void> {
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
          await collectRecursive(fullPath, baseDir);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (extensions.includes(ext)) {
            const relativePath = path.relative(baseDir, fullPath);
            files.push(relativePath);
          }
        }
      }
    } catch {
      // Ignore errors
    }
  }

  await collectRecursive(dirPath, dirPath);
  return files;
}

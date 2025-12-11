/**
 * End-to-End Test Teardown Utilities
 * 
 * Provides utilities for cleaning up test environment:
 * - Remove test directories
 * - Drop test tables
 * - Disconnect from database
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type { TestEnvironment } from './setup.js';

/**
 * Clean up test environment
 * 
 * @param env Test environment
 */
export async function teardownTestEnvironment(
  env: TestEnvironment
): Promise<void> {
  // Disconnect from database
  if (env.connector) {
    try {
      await env.connector.disconnect();
    } catch (error) {
      console.warn('Failed to disconnect from test database:', error);
    }
  }

  // Remove test directories
  const dirsToRemove = [
    env.outputDir,
    env.progressDir,
  ];

  for (const dir of dirsToRemove) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch (error) {
      console.warn(`Failed to remove directory ${dir}:`, error);
    }
  }
}

/**
 * Clean up test tables from database
 * 
 * @param env Test environment
 */
export async function cleanupTestTables(
  env: TestEnvironment
): Promise<void> {
  if (!env.connector || !env.hasTestDb) {
    return;
  }

  for (const table of env.testTables) {
    try {
      await env.connector.query(
        `DROP TABLE IF EXISTS ${env.testSchema}.${table} CASCADE`
      );
    } catch (error) {
      console.warn(`Failed to drop table ${table}:`, error);
    }
  }
}

/**
 * Remove specific test files
 * 
 * @param filePaths Array of file paths to remove
 */
export async function removeTestFiles(
  filePaths: string[]
): Promise<void> {
  for (const filePath of filePaths) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      // Ignore errors (file might not exist)
    }
  }
}

/**
 * Remove test progress files
 * 
 * @param progressDir Progress directory
 */
export async function cleanupProgressFiles(
  progressDir: string
): Promise<void> {
  const filesToRemove = [
    'documentation-plan.json',
    'documenter-progress.json',
  ];

  for (const file of filesToRemove) {
    const filePath = path.join(progressDir, file);
    try {
      await fs.unlink(filePath);
    } catch {
      // Ignore errors
    }
  }

  // Remove work unit progress directories
  const workUnitsDir = path.join(progressDir, 'work_units');
  try {
    await fs.rm(workUnitsDir, { recursive: true, force: true });
  } catch {
    // Ignore errors
  }
}

/**
 * Remove test documentation files
 * 
 * @param docsDir Documentation directory
 */
export async function cleanupDocumentationFiles(
  docsDir: string
): Promise<void> {
  try {
    await fs.rm(docsDir, { recursive: true, force: true });
  } catch (error) {
    console.warn(`Failed to remove docs directory ${docsDir}:`, error);
  }
}

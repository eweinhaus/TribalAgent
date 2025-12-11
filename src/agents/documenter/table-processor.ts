/**
 * Table Processing
 * 
 * Processes individual tables using TableDocumenter sub-agent.
 * Phase 3 implementation with full documentation generation.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import type {
  WorkUnit,
  TableSpec,
  TableResult,
} from './types.js';
import type { DatabaseConnector } from '../../connectors/index.js';
import { computeTableStatus } from './status.js';
import { createAgentError, ErrorCodes } from './errors.js';
import { TableDocumenter } from './sub-agents/TableDocumenter.js';
import { logger } from '../../utils/logger.js';

/**
 * Process a single table using TableDocumenter sub-agent
 * 
 * @param workUnit Work unit containing the table
 * @param tableSpec Table specification
 * @param connector Database connector (reused from work unit)
 * @returns Table processing result
 */
export async function processTable(
  workUnit: WorkUnit,
  tableSpec: TableSpec,
  connector: DatabaseConnector
): Promise<TableResult> {
  const fullyQualifiedName = tableSpec.fully_qualified_name;

  try {
    logger.debug(`Processing table: ${fullyQualifiedName}`);

    // Create TableDocumenter instance
    const documenter = new TableDocumenter(tableSpec, workUnit, connector);

    // Generate documentation
    const summary = await documenter.document();

    logger.debug(`Successfully processed table: ${fullyQualifiedName}`, {
      output_files: summary.output_files,
    });

    return computeTableStatus(fullyQualifiedName, true);

  } catch (error) {
    const agentError = error as any;
    const errorCode = agentError.code || ErrorCodes.DOC_TABLE_EXTRACTION_FAILED;
    const errorMessage = agentError.message || String(error);

    logger.error(`Failed to process table ${fullyQualifiedName}`, {
      code: errorCode,
      message: errorMessage,
      context: agentError.context,
    });

    return {
      table: fullyQualifiedName,
      succeeded: false,
      error: createAgentError(
        errorCode,
        errorMessage,
        agentError.severity || 'error',
        agentError.recoverable !== false,
        agentError.context
      ),
    };
  }
}

/**
 * Check if table should be skipped (files already exist)
 * 
 * @param workUnit Work unit containing the table
 * @param tableSpec Table specification
 * @returns True if table should be skipped
 */
async function shouldSkipTable(
  workUnit: WorkUnit,
  tableSpec: TableSpec
): Promise<boolean> {
  // Use TRIBAL_DOCS_PATH if set, otherwise default to docs/ in cwd
  const docsPath = process.env.TRIBAL_DOCS_PATH || path.join(process.cwd(), 'docs');
  const sanitizedSchema = sanitizeFileName(tableSpec.schema_name);
  const sanitizedTable = sanitizeFileName(tableSpec.table_name);
  
  const basePath = path.join(
    docsPath,
    workUnit.output_directory,
    'tables'
  );
  
  const mdPath = path.join(basePath, `${sanitizedSchema}.${sanitizedTable}.md`);
  const jsonPath = path.join(basePath, `${sanitizedSchema}.${sanitizedTable}.json`);

  try {
    // Check if both files exist
    await fs.access(mdPath);
    await fs.access(jsonPath);
    return true; // Both files exist, skip
  } catch {
    return false; // Files missing, process
  }
}

/**
 * Sanitize file name by replacing invalid filesystem characters
 * (Matches TableDocumenter's sanitizeFileName method)
 */
function sanitizeFileName(name: string): string {
  // Don't lowercase - preserve case for schema/table names
  // Only replace invalid filesystem characters
  return name.replace(/[\/\\:*?"<>|]/g, '_');
}

/**
 * Process all tables in a work unit with parallel batching
 * 
 * @param workUnit Work unit to process
 * @param connector Database connector
 * @returns Array of table results
 */
export async function processTablesInWorkUnit(
  workUnit: WorkUnit,
  connector: DatabaseConnector
): Promise<TableResult[]> {
  // Sort tables by priority (1 = highest, 3 = lowest)
  const sortedTables = [...workUnit.tables].sort(
    (a, b) => a.priority - b.priority
  );

  const results: TableResult[] = [];
  
  // Batch size for parallel processing
  // Balance between speed and database/LLM load
  const BATCH_SIZE = 3;

  // Process tables in parallel batches
  for (let i = 0; i < sortedTables.length; i += BATCH_SIZE) {
    const batch = sortedTables.slice(i, i + BATCH_SIZE);
    
    const batchPromises = batch.map(async (tableSpec) => {
      // Check if table should be skipped (files already exist)
      const skip = await shouldSkipTable(workUnit, tableSpec);
      
      if (skip) {
        logger.debug(`Skipping table ${tableSpec.fully_qualified_name} (files already exist)`);
        // Mark as succeeded (skipped tables are considered completed)
        return computeTableStatus(tableSpec.fully_qualified_name, true);
      }

      try {
        return await processTable(workUnit, tableSpec, connector);
      } catch (error) {
        // Table processing failed
        return {
          table: tableSpec.fully_qualified_name,
          succeeded: false,
          error: {
            code: 'DOC_TABLE_PROCESSING_FAILED',
            message: error instanceof Error ? error.message : String(error),
            severity: 'error' as const,
            timestamp: new Date().toISOString(),
            recoverable: true,
          },
        };
      }
    });

    // Wait for batch to complete
    const batchResults = await Promise.all(batchPromises);
    results.push(...batchResults);
    
    logger.debug(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batchResults.length} tables`);
  }

  return results;
}

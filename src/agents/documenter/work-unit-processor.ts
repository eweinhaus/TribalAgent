/**
 * Work Unit Processing
 * 
 * Handles sequential processing of work units by priority order.
 */

import { logger } from '../../utils/logger.js';
import { getDatabaseConnector } from '../../connectors/index.js';
import { saveWorkUnitProgress, saveDocumenterProgress } from './progress.js';
import { computeWorkUnitStatus, computeOverallStatus } from './status.js';
import { createAgentError, ErrorCodes } from './errors.js';
import { processTablesInWorkUnit } from './table-processor.js';
import type {
  DocumentationPlan,
  DocumenterProgress,
  WorkUnit,
  WorkUnitProgress,
} from './types.js';

/**
 * Process all work units in the plan
 * 
 * @param plan Documentation plan
 * @param progress Documenter progress (will be updated)
 * @param startIndex Index to start from (for checkpoint recovery)
 * @param shouldShutdown Optional callback to check if shutdown was requested
 */
export async function processWorkUnits(
  plan: DocumentationPlan,
  progress: DocumenterProgress,
  startIndex: number = 0,
  shouldShutdown?: () => boolean
): Promise<void> {
  // Sort work units by priority_order (lower number = higher priority)
  const sortedWorkUnits = [...plan.work_units].sort(
    (a, b) => a.priority_order - b.priority_order
  );

  // Filter out unreachable work units
  const reachableWorkUnits = sortedWorkUnits.filter(wu => 
    !isWorkUnitUnreachable(wu, plan)
  );

  logger.info('Processing work units', {
    total: reachableWorkUnits.length,
    startIndex,
    skipped: sortedWorkUnits.length - reachableWorkUnits.length,
  });

  // Process each work unit starting from startIndex
  for (let i = startIndex; i < reachableWorkUnits.length; i++) {
    // Check if shutdown was requested
    if (shouldShutdown && shouldShutdown()) {
      logger.info('Shutdown requested, stopping work unit processing');
      break;
    }

    const workUnit = reachableWorkUnits[i];
    
    try {
      await processWorkUnit(workUnit, plan, progress, shouldShutdown);
    } catch (error) {
      // Work unit failed - mark as failed and continue
      logger.error(`Work unit ${workUnit.id} failed`, error);
      
      const workUnitProgress = progress.work_units[workUnit.id];
      if (workUnitProgress) {
        workUnitProgress.status = 'failed';
        workUnitProgress.completed_at = new Date().toISOString();
        workUnitProgress.errors.push(
          createAgentError(
            ErrorCodes.DOC_WORK_UNIT_FAILED,
            `Work unit failed: ${error instanceof Error ? error.message : String(error)}`,
            'error',
            false,
            { workUnitId: workUnit.id, error: String(error) }
          )
        );
        await saveWorkUnitProgress(workUnit.id, workUnitProgress);
      }
      
      // Continue to next work unit (don't stop documenter)
    }

    // Update overall status after each work unit
    progress.status = computeOverallStatus(
      Object.values(progress.work_units),
      false
    );
    await saveDocumenterProgress(progress);
  }
}

/**
 * Process a single work unit
 * 
 * @param workUnit Work unit to process
 * @param plan Documentation plan
 * @param progress Overall progress (will be updated)
 * @param shouldShutdown Optional callback to check if shutdown was requested
 */
async function processWorkUnit(
  workUnit: WorkUnit,
  plan: DocumentationPlan,
  progress: DocumenterProgress,
  shouldShutdown?: () => boolean
): Promise<void> {
  logger.info(`Processing work unit: ${workUnit.id}`, {
    database: workUnit.database,
    domain: workUnit.domain,
    tables: workUnit.tables.length,
  });

  // Initialize work unit progress
  const workUnitProgress: WorkUnitProgress = {
    work_unit_id: workUnit.id,
    status: 'running',
    started_at: new Date().toISOString(),
    tables_total: workUnit.tables.length,
    tables_completed: 0,
    tables_failed: 0,
    tables_skipped: 0,
    errors: [],
    output_files: [],
  };

  // Add to overall progress
  progress.work_units[workUnit.id] = workUnitProgress;
  await saveWorkUnitProgress(workUnit.id, workUnitProgress);
  await saveDocumenterProgress(progress);

  // Get database type from plan
  const dbAnalysis = plan.databases.find(db => db.name === workUnit.database);
  
  if (!dbAnalysis) {
    throw new Error(`Database not found in plan: ${workUnit.database}`);
  }

  if (dbAnalysis.status === 'unreachable') {
    throw new Error(`Database is unreachable: ${workUnit.database}`);
  }

  const connector = getDatabaseConnector(dbAnalysis.type);
  let connectionEstablished = false;

  try {
    // Get connection string
    // For test databases, use TEST_DATABASE_URL if available
    let connectionString: string;
    
    if (process.env.TEST_DATABASE_URL && workUnit.database === 'test_db') {
      // Use test database connection for test_db
      connectionString = process.env.TEST_DATABASE_URL;
    } else {
      // For production, get connection from config
      // This requires loading config, which we'll do here
      const { loadConfig, resolveDatabaseConfigs } = await import('../../utils/config.js');
      const config = await loadConfig();
      const dbConfigs = resolveDatabaseConfigs(config);
      const dbConfig = dbConfigs.find(db => db.name === workUnit.database);
      
      if (!dbConfig) {
        throw new Error(`Database configuration not found: ${workUnit.database}`);
      }
      
      connectionString = dbConfig.connectionString;
    }
    
    // Connect to database
    await connector.connect(connectionString);
    connectionEstablished = true;
    connectionEstablished = true;

    // Process tables
    const tableResults = await processTablesInWorkUnit(workUnit, connector);

    // Update work unit progress with results
    for (const result of tableResults) {
      if (result.succeeded) {
        workUnitProgress.tables_completed++;
      } else {
        workUnitProgress.tables_failed++;
        if (result.error) {
          workUnitProgress.errors.push(result.error);
        }
      }
      
      // Update current table
      workUnitProgress.current_table = result.table;
      
      // Save progress after each table
      await saveWorkUnitProgress(workUnit.id, workUnitProgress);
      
      // Checkpoint every 10 tables
      if (workUnitProgress.tables_completed % 10 === 0 && workUnitProgress.tables_completed > 0) {
        progress.last_checkpoint = new Date().toISOString();
        await saveDocumenterProgress(progress);
        logger.debug(`Checkpoint saved at table ${workUnitProgress.tables_completed}`, {
          workUnitId: workUnit.id,
        });
      }

      // Check if shutdown was requested
      if (shouldShutdown && shouldShutdown()) {
        logger.info('Shutdown requested, stopping table processing');
        break;
      }
    }

    // Compute final status
    workUnitProgress.status = computeWorkUnitStatus(tableResults, false);
    workUnitProgress.completed_at = new Date().toISOString();
    workUnitProgress.current_table = undefined;

    // Update overall stats
    progress.stats.completed_tables += workUnitProgress.tables_completed;
    progress.stats.failed_tables += workUnitProgress.tables_failed;

  } catch (error) {
    // Connection or processing error
    const connectionLost = connectionEstablished && 
      (error instanceof Error && error.message.includes('connection'));
    
    if (connectionLost) {
      logger.warn(`Database connection lost for work unit ${workUnit.id}`, error);
      workUnitProgress.errors.push(
        createAgentError(
          'DOC_DB_CONNECTION_LOST',
          `Database connection lost: ${error instanceof Error ? error.message : String(error)}`,
          'error',
          true,
          { workUnitId: workUnit.id }
        )
      );
    }

    // Compute status (connection lost = partial if some work done)
    // Use existing table results if available, otherwise empty array
    const tableResults: Array<{ table: string; succeeded: boolean; error?: any }> = [];
    workUnitProgress.status = computeWorkUnitStatus(tableResults, connectionLost);
    workUnitProgress.completed_at = new Date().toISOString();
    
    throw error; // Re-throw to be caught by caller
  } finally {
    // Save final work unit progress
    await saveWorkUnitProgress(workUnit.id, workUnitProgress);
    
    // Update overall progress
    progress.work_units[workUnit.id] = workUnitProgress;
    await saveDocumenterProgress(progress);
  }
}

/**
 * Check if a work unit is unreachable
 * 
 * @param workUnit Work unit to check
 * @param plan Documentation plan
 * @returns True if work unit is unreachable
 */
function isWorkUnitUnreachable(
  workUnit: WorkUnit,
  plan: DocumentationPlan
): boolean {
  // Check if database is unreachable in plan
  const dbAnalysis = plan.databases.find(db => db.name === workUnit.database);
  
  if (dbAnalysis && dbAnalysis.status === 'unreachable') {
    return true;
  }

  return false;
}

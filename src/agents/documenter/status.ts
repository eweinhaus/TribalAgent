/**
 * Multi-Level Status Algorithm
 * 
 * Implements hierarchical status determination:
 * - Table level: binary (succeeded or failed)
 * - Work unit level: aggregates table results
 * - Overall level: aggregates work unit results
 */

import type {
  AgentStatus,
  AgentError,
  WorkUnitProgress,
  TableResult,
} from './types.js';

/**
 * Compute table status (binary: succeeded or failed)
 * 
 * @param table Fully qualified table name
 * @param succeeded Whether table processing succeeded
 * @param error Optional error if failed
 * @returns Table result
 */
export function computeTableStatus(
  table: string,
  succeeded: boolean,
  error?: AgentError
): TableResult {
  return {
    table,
    succeeded,
    error,
  };
}

/**
 * Compute work unit status from table results
 * 
 * Algorithm:
 * - All tables succeeded → 'completed'
 * - Any table succeeded → 'partial'
 * - All tables failed OR connection lost → 'failed'
 * - Empty work unit → 'completed'
 * - All tables skipped → 'completed'
 * 
 * @param tables Array of table processing results
 * @param connectionLost Whether database connection was lost
 * @returns Work unit status
 */
export function computeWorkUnitStatus(
  tables: TableResult[],
  connectionLost: boolean = false
): AgentStatus {
  // Connection lost mid-processing
  if (connectionLost) {
    // If any tables succeeded before connection loss, it's partial
    const anySucceeded = tables.some(t => t.succeeded);
    return anySucceeded ? 'partial' : 'failed';
  }

  // Empty work unit (no connection loss)
  if (tables.length === 0) {
    return 'completed';
  }

  // Count successes and failures
  const succeededCount = tables.filter(t => t.succeeded).length;
  const failedCount = tables.filter(t => !t.succeeded).length;
  const skippedCount = tables.length - succeededCount - failedCount;

  // All tables skipped
  if (skippedCount === tables.length) {
    return 'completed';
  }

  // All tables succeeded
  if (succeededCount === tables.length) {
    return 'completed';
  }

  // All tables failed
  if (failedCount === tables.length) {
    return 'failed';
  }

  // Mixed results: some succeeded, some failed
  if (succeededCount > 0 && failedCount > 0) {
    return 'partial';
  }

  // Should not reach here, but default to partial for safety
  return 'partial';
}

/**
 * Compute overall documenter status from work unit progress
 * 
 * Algorithm:
 * - All work units 'completed' → 'completed'
 * - Any work unit 'partial' OR 'failed' → 'partial'
 * - All work units 'failed' → 'failed'
 * - Fatal error occurred → 'failed'
 * 
 * @param workUnits Array of work unit progress objects
 * @param fatalError Whether a fatal error occurred
 * @returns Overall status
 */
export function computeOverallStatus(
  workUnits: WorkUnitProgress[],
  fatalError: boolean = false
): AgentStatus {
  // Fatal error occurred
  if (fatalError) {
    return 'failed';
  }

  // No work units
  if (workUnits.length === 0) {
    return 'completed';
  }

  // Count statuses
  const completedCount = workUnits.filter(wu => wu.status === 'completed').length;
  const partialCount = workUnits.filter(wu => wu.status === 'partial').length;
  const failedCount = workUnits.filter(wu => wu.status === 'failed').length;
  const pendingCount = workUnits.filter(wu => wu.status === 'pending' || wu.status === 'running').length;

  // All work units completed
  if (completedCount === workUnits.length) {
    return 'completed';
  }

  // All work units failed
  if (failedCount === workUnits.length) {
    return 'failed';
  }

  // Any work unit is partial or failed (and not all completed)
  if (partialCount > 0 || failedCount > 0) {
    return 'partial';
  }

  // Some work units still pending/running (incomplete execution)
  if (pendingCount > 0) {
    return 'partial';
  }

  // Should not reach here, but default to partial for safety
  return 'partial';
}

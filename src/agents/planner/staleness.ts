/**
 * Staleness Detection Module
 *
 * Detects whether an existing documentation plan is still valid or needs
 * to be regenerated due to configuration or schema changes.
 *
 * @module agents/planner/staleness
 */

import { logger } from '../../utils/logger.js';
import { computeSchemaHash } from '../../utils/hash.js';
import { getDatabaseConnector } from '../../connectors/index.js';
import type {
  DocumentationPlan,
  ContentHash,
  DatabaseConfig,
} from '../../contracts/types.js';

/**
 * Staleness status categories
 */
export type StalenessStatus = 'fresh' | 'config_changed' | 'schema_changed' | 'partial_stale';

/**
 * Result of staleness check
 */
export interface StalenessResult {
  status: StalenessStatus;
  /** Databases that have changed (for schema_changed status) */
  changedDatabases?: string[];
  /** Work units that are stale (for partial_stale status) */
  staleWorkUnits?: string[];
}

/**
 * Database catalog for staleness checking
 */
interface DatabaseCatalog {
  databases: DatabaseConfig[];
}

/**
 * Check if existing plan is still valid by comparing:
 * 1. config_hash - has databases.yaml changed?
 * 2. schema_hash per database - has the schema structure changed?
 * 3. metadata_hash per table - have individual tables changed?
 */
export async function checkPlanStaleness(
  existingPlan: DocumentationPlan,
  currentConfigHash: ContentHash,
  config: DatabaseCatalog
): Promise<StalenessResult> {
  // Level 1: Config-level staleness (fast check)
  if (existingPlan.config_hash !== currentConfigHash) {
    logger.debug('Config hash mismatch - plan is stale', {
      existing: existingPlan.config_hash.substring(0, 16),
      current: currentConfigHash.substring(0, 16),
    });
    return { status: 'config_changed' };
  }

  // Level 2: Schema-level staleness (requires DB connection)
  const changedDatabases: string[] = [];

  for (const dbAnalysis of existingPlan.databases) {
    // Skip unreachable databases
    if (dbAnalysis.status === 'unreachable') continue;

    // Find matching config by name
    const dbConfig = config.databases.find((d) => d.name === dbAnalysis.name);
    if (!dbConfig) {
      // DB removed from config
      changedDatabases.push(dbAnalysis.name);
      logger.debug(`Database ${dbAnalysis.name} removed from config`);
      continue;
    }

    try {
      // Quick schema hash check - just query table/column structure
      const currentSchemaHash = await computeCurrentSchemaHash(dbConfig);
      if (currentSchemaHash !== dbAnalysis.schema_hash) {
        changedDatabases.push(dbAnalysis.name);
        logger.debug(`Database ${dbAnalysis.name} schema changed`, {
          existing: dbAnalysis.schema_hash.substring(0, 16),
          current: currentSchemaHash.substring(0, 16),
        });
      }
    } catch (error) {
      // Can't connect - mark as changed to trigger replan
      changedDatabases.push(dbAnalysis.name);
      logger.debug(`Database ${dbAnalysis.name} unreachable during staleness check`, { error });
    }
  }

  // Check for new databases in config
  for (const dbConfig of config.databases) {
    const existsInPlan = existingPlan.databases.some((d) => d.name === dbConfig.name);
    if (!existsInPlan) {
      changedDatabases.push(dbConfig.name);
      logger.debug(`New database ${dbConfig.name} added to config`);
    }
  }

  if (changedDatabases.length > 0) {
    return { status: 'schema_changed', changedDatabases };
  }

  // Level 3: Table-level staleness (for incremental updates - post-MVP)
  // Would compare metadata_hash per table to detect column changes
  // For now, if we get here, the plan is fresh

  return { status: 'fresh' };
}

/**
 * Compute schema hash for a database without full analysis.
 * Only queries table names + column definitions, not row counts.
 */
async function computeCurrentSchemaHash(dbConfig: DatabaseConfig): Promise<ContentHash> {
  const connector = getDatabaseConnector(dbConfig.type);

  // Resolve connection string
  const connectionString = resolveConnectionString(dbConfig);

  await connector.connect(connectionString);

  try {
    // Get lightweight table structure
    const schemas = dbConfig.schemas_include || dbConfig.schemas;
    const excludeTables = dbConfig.tables_exclude || dbConfig.exclude_tables;
    const includeSystemTables = dbConfig.include_system_tables ?? false;
    const tables = await connector.getAllTableMetadata(schemas, excludeTables, includeSystemTables);

    return computeSchemaHash(tables);
  } finally {
    await connector.disconnect();
  }
}

/**
 * Resolve connection string from database config.
 */
function resolveConnectionString(dbConfig: DatabaseConfig): string {
  // Check for direct connection string
  if (dbConfig.connection_string) {
    return dbConfig.connection_string;
  }

  // Check for environment variable reference
  const envVar = dbConfig.connection_string_env || dbConfig.connection_env;
  if (envVar) {
    const value = process.env[envVar];
    if (!value) {
      throw new Error(`Environment variable ${envVar} not set`);
    }
    return value;
  }

  // Check for connection config (legacy)
  if (dbConfig.connection_config) {
    return dbConfig.connection_config;
  }

  throw new Error(`No connection configuration found for database ${dbConfig.name}`);
}

/**
 * Check if specific work units are stale.
 * Used for incremental re-documentation (post-MVP).
 */
export function checkWorkUnitStaleness(
  existingPlan: DocumentationPlan,
  tableHashes: Map<string, ContentHash>
): string[] {
  const staleWorkUnits: string[] = [];

  for (const workUnit of existingPlan.work_units) {
    let hasChanges = false;

    for (const table of workUnit.tables) {
      const currentHash = tableHashes.get(table.fully_qualified_name);
      if (currentHash && currentHash !== table.metadata_hash) {
        hasChanges = true;
        break;
      }
    }

    if (hasChanges) {
      staleWorkUnits.push(workUnit.id);
    }
  }

  return staleWorkUnits;
}

/**
 * Database Analysis Module
 *
 * Handles connection to databases and extraction of metadata for planning.
 *
 * @module agents/planner/analyze-database
 */

import { getDatabaseConnector } from '../../connectors/index.js';
import { logger } from '../../utils/logger.js';
import { computeSchemaHash, computeTableMetadataHash } from '../../utils/hash.js';
import { createPlannerError } from '../../contracts/errors.js';
import { inferDomains, type DomainInferenceResult } from './domain-inference.js';
import type {
  DatabaseAnalysis,
  DatabaseConfig,
  TableMetadata,
  Relationship,
  PlannerConfig,
  AgentError,
} from '../../contracts/types.js';

/**
 * Result of database analysis
 */
export interface AnalysisResult {
  success: true;
  analysis: DatabaseAnalysis;
  tableMetadata: TableMetadata[];
  relationships: Relationship[];
  domainInferenceResult: DomainInferenceResult;
}

export interface AnalysisFailure {
  success: false;
  error: AgentError;
  /** Partial analysis for unreachable databases */
  partialAnalysis: DatabaseAnalysis;
}

export type DatabaseAnalysisResult = AnalysisResult | AnalysisFailure;

/**
 * Analyze a single database and extract all metadata needed for planning.
 */
export async function analyzeDatabase(
  dbName: string,
  dbConfig: DatabaseConfig,
  plannerConfig: PlannerConfig
): Promise<DatabaseAnalysisResult> {
  logger.info(`Analyzing database: ${dbName}`);

  try {
    // Get the appropriate connector
    const connector = getDatabaseConnector(dbConfig.type);

    // Resolve connection string
    const connectionString = resolveConnectionString(dbConfig);

    // Connect to database
    logger.debug(`Connecting to ${dbName}...`);
    await connector.connect(connectionString);

    try {
      // Get table metadata
      logger.debug(`Extracting table metadata from ${dbName}...`);
      const schemas = dbConfig.schemas_include || dbConfig.schemas;
      const excludeTables = dbConfig.tables_exclude || dbConfig.exclude_tables;
      const includeSystemTables = dbConfig.include_system_tables ?? false;
      const tableMetadata = await connector.getAllTableMetadata(schemas, excludeTables, includeSystemTables);

      // Apply max_tables_per_database limit
      const maxTables = plannerConfig.max_tables_per_database || 1000;
      if (tableMetadata.length > maxTables) {
        logger.warn(`Database ${dbName} has ${tableMetadata.length} tables, limiting to ${maxTables}`);
        tableMetadata.length = maxTables;
      }

      // Get relationships
      logger.debug(`Extracting relationships from ${dbName}...`);
      let relationships: Relationship[] = [];
      try {
        relationships = await connector.getRelationships(tableMetadata);
      } catch (error) {
        logger.warn(`Failed to get relationships for ${dbName}, continuing without`, { error });
      }

      // Normalize table metadata
      const normalizedTables = normalizeTableMetadata(dbName, tableMetadata, relationships);

      // Infer domains
      logger.debug(`Inferring domains for ${dbName}...`);
      const domainResult = await inferDomains(
        dbName,
        normalizedTables,
        relationships,
        plannerConfig
      );

      // Compute schema hash
      const schemaHash = computeSchemaHash(normalizedTables);

      // Count unique schemas
      const schemaCount = countSchemas(normalizedTables);

      // Build analysis result
      const analysis: DatabaseAnalysis = {
        name: dbName,
        type: dbConfig.type,
        status: 'reachable',
        table_count: normalizedTables.length,
        schema_count: schemaCount,
        estimated_time_minutes: estimateTime(normalizedTables.length),
        domains: domainResult.domains,
        schema_hash: schemaHash,
      };

      await connector.disconnect();

      return {
        success: true,
        analysis,
        tableMetadata: normalizedTables,
        relationships,
        domainInferenceResult: domainResult,
      };
    } finally {
      // Ensure disconnect even if analysis fails
      try {
        await connector.disconnect();
      } catch {
        // Ignore disconnect errors
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to analyze database ${dbName}: ${errorMessage}`);

    const agentError = createPlannerError('dbUnreachable', `Connection failed: ${errorMessage}`, {
      database: dbName,
      type: dbConfig.type,
    });

    return {
      success: false,
      error: agentError,
      partialAnalysis: {
        name: dbName,
        type: dbConfig.type,
        status: 'unreachable',
        connection_error: agentError,
        table_count: 0,
        schema_count: 0,
        estimated_time_minutes: 0,
        domains: {},
        schema_hash: '',
      },
    };
  }
}

/**
 * Resolve the connection string from database config.
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

  // Check for Snowflake-specific config
  if (dbConfig.snowflake) {
    return buildSnowflakeConnectionString(dbConfig.snowflake);
  }

  throw new Error(`No connection configuration found for database ${dbConfig.name}`);
}

/**
 * Build Snowflake connection string from config.
 */
function buildSnowflakeConnectionString(snowflake: DatabaseConfig['snowflake']): string {
  if (!snowflake) throw new Error('Snowflake config is undefined');

  const account = process.env[snowflake.account_env];
  const username = process.env[snowflake.username_env];
  const password = process.env[snowflake.password_env];

  if (!account) throw new Error(`Environment variable ${snowflake.account_env} not set`);
  if (!username) throw new Error(`Environment variable ${snowflake.username_env} not set`);
  if (!password) throw new Error(`Environment variable ${snowflake.password_env} not set`);

  // Return as JSON config for Snowflake SDK
  return JSON.stringify({
    account,
    username,
    password,
    warehouse: snowflake.warehouse,
    database: snowflake.database,
    role: snowflake.role,
  });
}

/**
 * Normalize table metadata and add computed fields.
 */
function normalizeTableMetadata(
  dbName: string,
  tables: TableMetadata[],
  relationships: Relationship[]
): TableMetadata[] {
  // Build FK count maps
  const incomingFkCount = new Map<string, number>();
  const outgoingFkCount = new Map<string, number>();

  for (const rel of relationships) {
    // Target table has incoming FK
    const currentIncoming = incomingFkCount.get(rel.target_table) || 0;
    incomingFkCount.set(rel.target_table, currentIncoming + 1);

    // Source table has outgoing FK
    const currentOutgoing = outgoingFkCount.get(rel.source_table) || 0;
    outgoingFkCount.set(rel.source_table, currentOutgoing + 1);
  }

  return tables.map((table) => {
    const fullName = `${table.table_schema}.${table.table_name}`;
    const fqn = `${dbName}.${fullName}`;

    return {
      ...table,
      name: fullName,
      row_count: table.row_count || 0,
      columns: table.columns || [],
      primary_key: table.primary_key || [],
      foreign_keys: table.foreign_keys || [],
      indexes: table.indexes || [],
      // Add computed fields for easier access
      _fully_qualified_name: fqn,
      _incoming_fk_count: incomingFkCount.get(fullName) || 0,
      _outgoing_fk_count: outgoingFkCount.get(fullName) || 0,
      _metadata_hash: computeTableMetadataHash(table),
    } as TableMetadata & {
      _fully_qualified_name: string;
      _incoming_fk_count: number;
      _outgoing_fk_count: number;
      _metadata_hash: string;
    };
  });
}

/**
 * Count unique schemas in table metadata.
 */
function countSchemas(tables: TableMetadata[]): number {
  const schemas = new Set(tables.map((t) => t.table_schema));
  return schemas.size;
}

/**
 * Estimate documentation time based on table count.
 * ~30 seconds per table for LLM calls + processing, plus fixed overhead.
 */
function estimateTime(tableCount: number): number {
  const overheadMinutes = 5;
  const perTableMinutes = 0.5;
  return Math.ceil(overheadMinutes + tableCount * perTableMinutes);
}

/**
 * Get FK counts for a specific table.
 */
export function getFkCounts(
  tableName: string,
  relationships: Relationship[]
): { incoming: number; outgoing: number } {
  let incoming = 0;
  let outgoing = 0;

  for (const rel of relationships) {
    if (rel.target_table === tableName) incoming++;
    if (rel.source_table === tableName) outgoing++;
  }

  return { incoming, outgoing };
}

/**
 * Configuration Zod Schemas
 *
 * Zod validation schemas for configuration files (databases.yaml, agent-config.yaml).
 * Per plan §5.1 - centralized config validation.
 *
 * @module config/schema
 */

import { z } from 'zod';

// =============================================================================
// DATABASE CONFIGURATION SCHEMAS
// =============================================================================

/**
 * Snowflake-specific connection configuration
 */
export const SnowflakeConfigSchema = z.object({
  account_env: z.string().min(1),
  username_env: z.string().min(1),
  password_env: z.string().min(1),
  warehouse: z.string().min(1),
  database: z.string().min(1),
  role: z.string().optional(),
});

/**
 * Single database configuration
 */
export const DatabaseConfigSchema = z.object({
  name: z.string().min(1),
  type: z.enum(['postgres', 'snowflake']),

  // Postgres connection options (one required for postgres)
  connection_string_env: z.string().optional(),
  connection_string: z.string().optional(),
  connection_config: z.string().optional(),
  connection_env: z.string().optional(), // Legacy alias for connection_string_env

  // Snowflake connection options
  snowflake: SnowflakeConfigSchema.optional(),

  // Schema filtering
  schemas_include: z.array(z.string()).optional(),
  schemas: z.array(z.string()).optional(), // Legacy alias for schemas_include
  schemas_exclude: z.array(z.string()).optional(),

  // Table filtering
  tables_exclude: z.array(z.string()).optional(),
  exclude_tables: z.array(z.string()).optional(), // Legacy alias for tables_exclude

  // Overrides
  query_timeout_ms: z.number().int().positive().optional(),
  sample_size: z.number().int().positive().optional(),

  // Documentation
  description: z.string().optional(),
}).refine(
  (data) => {
    if (data.type === 'postgres') {
      return !!(data.connection_string_env || data.connection_string || data.connection_config || data.connection_env);
    }
    if (data.type === 'snowflake') {
      return !!data.snowflake;
    }
    return true;
  },
  {
    message: 'Postgres requires connection_string_env/connection_string, Snowflake requires snowflake config',
  }
);

/**
 * Database catalog (databases.yaml root)
 */
export const DatabaseCatalogSchema = z.object({
  version: z.literal('1.0').optional(),
  defaults: z.object({
    query_timeout_ms: z.number().int().positive().optional(),
    sample_size: z.number().int().positive().optional(),
  }).optional(),
  databases: z.array(DatabaseConfigSchema).min(1),
});

/**
 * Legacy format support: array of databases without wrapper object
 */
export const DatabaseCatalogLegacySchema = z.array(DatabaseConfigSchema).min(1);

// =============================================================================
// AGENT CONFIGURATION SCHEMAS
// =============================================================================

/**
 * Planner agent configuration
 */
export const PlannerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  domain_inference: z.boolean().default(true),
  max_tables_per_database: z.number().int().positive().default(500),
  domain_inference_batch_size: z.number().int().positive().default(100),
  llm_model: z.string().optional(),
});

/**
 * Documenter agent configuration
 */
export const DocumenterConfigSchema = z.object({
  concurrency: z.number().int().positive().default(4),
  sample_timeout_ms: z.number().int().positive().default(5000),
  llm_model: z.string().default('anthropic/claude-3-haiku'),
  checkpoint_interval: z.number().int().positive().default(10),
  use_sub_agents: z.boolean().default(true),
});

/**
 * Indexer agent configuration
 */
export const IndexerConfigSchema = z.object({
  batch_size: z.number().int().positive().default(100),
  embedding_model: z.string().default('text-embedding-3-small'),
  checkpoint_interval: z.number().int().positive().default(50),
});

/**
 * Retrieval configuration
 */
export const RetrievalConfigSchema = z.object({
  default_limit: z.number().int().positive().default(10),
  max_limit: z.number().int().positive().default(50),
  context_budgets: z.record(z.number().int().positive()).default({
    table: 2000,
    column: 500,
    domain: 1500,
  }),
  rrf_k: z.number().int().positive().default(60),
  use_query_understanding: z.boolean().default(true),
});

/**
 * Full agent configuration (agent-config.yaml root)
 */
export const AgentConfigSchema = z.object({
  planner: PlannerConfigSchema.default({}),
  documenter: DocumenterConfigSchema.optional(),
  indexer: IndexerConfigSchema.optional(),
  retrieval: RetrievalConfigSchema.optional(),
});

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type DatabaseConfigInput = z.input<typeof DatabaseConfigSchema>;
export type DatabaseConfig = z.output<typeof DatabaseConfigSchema>;
export type DatabaseCatalog = z.output<typeof DatabaseCatalogSchema>;
export type PlannerConfig = z.output<typeof PlannerConfigSchema>;
export type DocumenterConfig = z.output<typeof DocumenterConfigSchema>;
export type IndexerConfig = z.output<typeof IndexerConfigSchema>;
export type RetrievalConfig = z.output<typeof RetrievalConfigSchema>;
export type AgentConfig = z.output<typeof AgentConfigSchema>;

// =============================================================================
// VALIDATION HELPERS
// =============================================================================

/**
 * Parse and validate databases.yaml content.
 * Supports both new format (object with databases array) and legacy format (plain array).
 */
export function parseDatabaseCatalog(content: unknown): DatabaseCatalog {
  // Try new format first
  const newFormatResult = DatabaseCatalogSchema.safeParse(content);
  if (newFormatResult.success) {
    return newFormatResult.data;
  }

  // Try legacy format (plain array)
  const legacyResult = DatabaseCatalogLegacySchema.safeParse(content);
  if (legacyResult.success) {
    return {
      databases: legacyResult.data,
    };
  }

  // Neither worked, throw the new format error (more descriptive)
  throw new Error(`Invalid databases.yaml: ${newFormatResult.error.message}`);
}

/**
 * Parse and validate agent-config.yaml content.
 */
export function parseAgentConfig(content: unknown): AgentConfig {
  const result = AgentConfigSchema.safeParse(content);
  if (!result.success) {
    throw new Error(`Invalid agent-config.yaml: ${result.error.message}`);
  }
  return result.data;
}

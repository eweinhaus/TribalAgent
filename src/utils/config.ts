/**
 * Configuration Management
 *
 * Loads and validates configuration files for databases, agents, and prompts.
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { z } from 'zod';
import * as yaml from 'js-yaml';
import { logger } from './logger';

// Database configuration schema
const DatabaseConfigSchema = z.object({
  databases: z.array(z.object({
    name: z.string(),
    type: z.enum(['postgres', 'snowflake']),
    connection_env: z.string().optional(),
    connection_string: z.string().optional(),
    connection_config: z.string().optional(),
    schemas: z.array(z.string()).optional(),
    exclude_tables: z.array(z.string()).optional(),
  })),
});

// Agent configuration schema
const AgentConfigSchema = z.object({
  planner: z.object({
    enabled: z.boolean().default(true),
    domain_inference: z.boolean().default(true),
  }).default({}),
  documenter: z.object({
    concurrency: z.number().min(1).max(10).default(5),
    sample_timeout_ms: z.number().positive().default(5000),
    llm_model: z.string().default('claude-sonnet-4'),
    checkpoint_interval: z.number().positive().default(10),
    use_sub_agents: z.boolean().default(true),
  }).default({}),
  indexer: z.object({
    batch_size: z.number().positive().default(50),
    embedding_model: z.string().default('text-embedding-3-small'),
    checkpoint_interval: z.number().positive().default(100),
  }).default({}),
  retrieval: z.object({
    default_limit: z.number().positive().default(5),
    max_limit: z.number().positive().default(20),
    context_budgets: z.record(z.number()).default({
      simple: 750,
      moderate: 1500,
      complex: 3000,
    }),
    rrf_k: z.number().positive().default(60),
    use_query_understanding: z.boolean().default(false),
  }).default({}),
});

// Documentation plan schema (for loading existing plans)
const DocumentationPlanSchema = z.object({
  generated_at: z.string(),
  databases: z.array(z.object({
    name: z.string(),
    type: z.enum(['postgres', 'snowflake']),
    table_count: z.number(),
    estimated_time_minutes: z.number(),
    domains: z.record(z.array(z.string())),
    tables: z.array(z.object({
      name: z.string(),
      domain: z.string(),
      priority: z.number(),
      column_count: z.number(),
      has_relationships: z.boolean(),
      metadata: z.any(),
    })),
  })),
  total_tables: z.number(),
  total_estimated_time_minutes: z.number(),
  complexity: z.enum(['simple', 'moderate', 'complex']),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export interface ResolvedDatabaseConfig {
  name: string;
  type: 'postgres' | 'snowflake';
  connectionString: string;
  schemas?: string[];
  excludeTables?: string[];
}
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type DocumentationPlan = z.infer<typeof DocumentationPlanSchema>;

/**
 * Load database configuration from databases.yaml
 */
export async function loadConfig(): Promise<DatabaseConfig & AgentConfig> {
  try {
    // Load database config
    const dbConfigPath = path.join(process.cwd(), 'config', 'databases.yaml');
    const dbConfigContent = await fs.readFile(dbConfigPath, 'utf-8');
    const dbConfig = DatabaseConfigSchema.parse(await parseYaml(dbConfigContent));

    // Load agent config
    const agentConfigPath = path.join(process.cwd(), 'config', 'agent-config.yaml');
    let agentConfig: AgentConfig = AgentConfigSchema.parse({});

    try {
      const agentConfigContent = await fs.readFile(agentConfigPath, 'utf-8');
      agentConfig = AgentConfigSchema.parse(await parseYaml(agentConfigContent));
    } catch (error) {
      logger.warn('Agent config file not found, using defaults', error);
    }

    return {
      ...dbConfig,
      ...agentConfig,
    };

  } catch (error) {
    logger.error('Failed to load configuration', error);
    throw error;
  }
}

/**
 * Resolve database configurations to connection strings
 */
export function resolveDatabaseConfigs(config: DatabaseConfig): ResolvedDatabaseConfig[] {
  return config.databases.map(db => {
    let connectionString: string;

    if (db.connection_env) {
      // Get connection string from environment variable
      const envValue = process.env[db.connection_env];
      if (!envValue) {
        throw new Error(`Environment variable ${db.connection_env} not found for database ${db.name}`);
      }
      connectionString = envValue;
    } else if (db.connection_string) {
      // Use direct connection string
      connectionString = db.connection_string;
    } else if (db.connection_config) {
      // Use connection config (for Snowflake)
      connectionString = db.connection_config;
    } else {
      throw new Error(`No connection configuration found for database ${db.name}`);
    }

    return {
      name: db.name,
      type: db.type,
      connectionString,
      schemas: db.schemas,
      excludeTables: db.exclude_tables,
    };
  });
}

/**
 * Load documentation plan from progress directory
 */
export async function loadDocumentationPlan(): Promise<DocumentationPlan> {
  try {
    const planPath = path.join(process.cwd(), 'progress', 'documentation-plan.json');
    const planContent = await fs.readFile(planPath, 'utf-8');
    const plan = JSON.parse(planContent);

    return DocumentationPlanSchema.parse(plan);

  } catch (error) {
    logger.error('Failed to load documentation plan', error);
    throw new Error('Documentation plan not found. Run planning phase first.');
  }
}

/**
 * Substitute environment variables in a string.
 * Supports ${VAR_NAME} syntax.
 */
function substituteEnvVars(content: string): string {
  return content.replace(/\$\{([^}]+)\}/g, (match, varName) => {
    const value = process.env[varName];
    if (value === undefined) {
      logger.warn(`Environment variable ${varName} is not set`);
      return match; // Keep original if not set
    }
    return value;
  });
}

/**
 * Parse YAML content with environment variable substitution
 */
async function parseYaml(content: string): Promise<any> {
  try {
    // Substitute environment variables before parsing
    const substituted = substituteEnvVars(content);
    return yaml.load(substituted);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Failed to parse YAML: ${message}`);
  }
}

/**
 * Validate configuration files on startup
 */
export async function validateConfigs(): Promise<void> {
  try {
    logger.info('Validating configuration files...');

    // Check database config exists
    const dbConfigPath = path.join(process.cwd(), 'config', 'databases.yaml');
    await fs.access(dbConfigPath);
    logger.info('✓ Database configuration found');

    // Check agent config exists (optional)
    const agentConfigPath = path.join(process.cwd(), 'config', 'agent-config.yaml');
    try {
      await fs.access(agentConfigPath);
      logger.info('✓ Agent configuration found');
    } catch {
      logger.info('⚠ Agent configuration not found, will use defaults');
    }

    // Validate database config format
    await loadConfig();
    logger.info('✓ Configuration validation passed');

  } catch (error) {
    logger.error('Configuration validation failed', error);
    throw error;
  }
}
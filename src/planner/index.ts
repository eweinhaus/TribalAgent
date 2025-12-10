/**
 * Planner: Schema Analyzer
 *
 * Analyzes database structure and creates documentation plan before
 * the documentation phase begins. This enables users to review scope
 * and priorities before committing to the time-consuming documentation process.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { loadConfig } from '../utils/config.js';
import { getDatabaseConnector } from '../connectors/index.js';

// Configuration schema for planner
const PlannerConfigSchema = z.object({
  databases: z.record(z.object({
    type: z.enum(['postgres', 'snowflake']),
    connection_env: z.string(),
    schemas: z.array(z.string()).optional(),
    exclude_tables: z.array(z.string()).optional(),
  })),
});

// Documentation plan schema
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
      metadata: z.any(), // Complete table metadata
    })),
  })),
  total_tables: z.number(),
  total_estimated_time_minutes: z.number(),
  complexity: z.enum(['simple', 'moderate', 'complex']),
});

type PlannerConfig = z.infer<typeof PlannerConfigSchema>;
type DocumentationPlan = z.infer<typeof DocumentationPlanSchema>;

export async function runPlanner(): Promise<void> {
  try {
    logger.info('Starting schema analysis and planning phase');

    // Load configuration
    const config = await loadConfig();
    const plannerConfig = PlannerConfigSchema.parse(config.databases);

    // Analyze each database
    const databases: DocumentationPlan['databases'] = [];
    let totalTables = 0;

    for (const [dbName, dbConfig] of Object.entries(plannerConfig.databases)) {
      logger.info(`Analyzing database: ${dbName}`);

      const connector = getDatabaseConnector(dbConfig.type);

      try {
        // Connect to database
        await connector.connect(dbConfig.connection_env);

        // Get table metadata for all tables
        const tableMetadata = await connector.getAllTableMetadata(dbConfig.schemas, dbConfig.exclude_tables);
        const tableCount = tableMetadata.length;

        // Analyze relationships and detect domains
        const relationships = await connector.getRelationships(tableMetadata);
        const domains = await detectDomains(tableMetadata, relationships);

        // Create prioritized table list
        const tables = prioritizeTables(tableMetadata, domains);

        // Calculate estimated time
        const estimatedTimeMinutes = estimateDocumentationTime(tableCount);

        databases.push({
          name: dbName,
          type: dbConfig.type,
          table_count: tableCount,
          estimated_time_minutes: estimatedTimeMinutes,
          domains,
          tables,
        });

        totalTables += tableCount;

        await connector.disconnect();

      } catch (error) {
        logger.error(`Failed to analyze database ${dbName}`, error);
        throw error;
      }
    }

    // Create documentation plan
    const plan: DocumentationPlan = {
      generated_at: new Date().toISOString(),
      databases,
      total_tables: totalTables,
      total_estimated_time_minutes: estimateDocumentationTime(totalTables),
      complexity: determineComplexity(totalTables),
    };

    // Validate plan
    DocumentationPlanSchema.parse(plan);

    // Write plan to file
    const planPath = path.join(process.cwd(), 'progress', 'documentation-plan.json');
    await fs.mkdir(path.dirname(planPath), { recursive: true });
    await fs.writeFile(planPath, JSON.stringify(plan, null, 2));

    logger.info(`Documentation plan created with ${totalTables} tables across ${databases.length} databases`);
    logger.info(`Estimated completion time: ${plan.total_estimated_time_minutes} minutes`);
    logger.info(`Plan saved to: ${planPath}`);

  } catch (error) {
    logger.error('Planning phase failed', error);
    throw error;
  }
}

/**
 * Detect business domains from table names and relationships
 */
async function detectDomains(
  tableMetadata: any[],
  relationships: any[]
): Promise<Record<string, string[]>> {
  // TODO: Implement domain inference using LLM
  // For now, return a simple grouping by table prefix
  const domains: Record<string, string[]> = {};

  for (const table of tableMetadata) {
    const tableName = table.name;
    const prefix = tableName.split('_')[0] || 'other';

    if (!domains[prefix]) {
      domains[prefix] = [];
    }
    domains[prefix].push(tableName);
  }

  return domains;
}

/**
 * Prioritize tables for documentation order
 */
function prioritizeTables(
  tableMetadata: any[],
  domains: Record<string, string[]>
): DocumentationPlan['databases'][0]['tables'] {
  // Sort tables by priority: core domain tables first, then alphabetical
  const coreDomains = ['customers', 'orders', 'products', 'users'];

  return tableMetadata
    .map(table => {
      const domain = Object.keys(domains).find(d => domains[d].includes(table.name)) || 'other';
      const priority = coreDomains.includes(domain) ? 1 : domain === 'system' ? 3 : 2;

      return {
        name: table.name,
        domain,
        priority,
        column_count: table.columns?.length || 0,
        has_relationships: table.foreign_keys?.length > 0,
        metadata: table,
      };
    })
    .sort((a, b) => {
      // Sort by priority first, then by name
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.name.localeCompare(b.name);
    });
}

/**
 * Estimate documentation time based on table count
 */
function estimateDocumentationTime(tableCount: number): number {
  // Rough estimate: ~30 seconds per table for LLM calls + processing
  // Plus fixed overhead
  const overhead = 5; // minutes
  const perTable = 0.5; // minutes
  return Math.ceil(overhead + (tableCount * perTable));
}

/**
 * Determine complexity level
 */
function determineComplexity(totalTables: number): 'simple' | 'moderate' | 'complex' {
  if (totalTables <= 50) return 'simple';
  if (totalTables <= 200) return 'moderate';
  return 'complex';
}
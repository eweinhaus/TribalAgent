/**
 * Planner: Schema Analyzer (Module 1)
 *
 * The Planner is the first module in the Tribal Knowledge Deep Agent pipeline.
 * It connects to configured databases, analyzes their structure, detects business
 * domains using LLM, and creates a documentation plan with WorkUnits that enable
 * parallel processing by downstream agents.
 *
 * Output: progress/documentation-plan.json
 *
 * @module agents/planner
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import * as yaml from 'js-yaml';
import { logger } from '../../utils/logger.js';
import { computeConfigHash } from '../../utils/hash.js';
import { loadAgentConfig } from '../../utils/agent-config.js';
import { savePlan, tryLoadPlan } from '../../utils/plan-io.js';
import { validatePlan } from '../../contracts/validators.js';
import { createPlannerError, ERROR_CODES } from '../../contracts/errors.js';
import { analyzeDatabase } from './analyze-database.js';
import { generateWorkUnits, renumberPriorityOrder, calculateRecommendedParallelism } from './generate-work-units.js';
import { checkPlanStaleness } from './staleness.js';
import { createMetricsCollector, emitPlannerMetrics } from './metrics.js';
import type {
  DocumentationPlan,
  DatabaseAnalysis,
  DatabaseConfig,
  PlanSummary,
  AgentError,
  TableMetadata,
  Relationship,
  DomainName,
} from '../../contracts/types.js';

/**
 * Planner options
 */
export interface PlannerOptions {
  /** Force re-planning even if config unchanged */
  force?: boolean;
  /** Dry run - don't write plan to disk */
  dryRun?: boolean;
  /** Custom config path */
  configPath?: string;
}

/**
 * Database catalog configuration (from databases.yaml)
 */
interface DatabaseCatalog {
  version?: string;
  defaults?: {
    query_timeout_ms?: number;
    sample_size?: number;
  };
  databases: DatabaseConfig[];
}

/**
 * Main entry point for the Planner.
 * Analyzes databases and creates a documentation plan with WorkUnits.
 */
export async function runPlanner(options: PlannerOptions = {}): Promise<DocumentationPlan> {
  const correlationId = generateCorrelationId();
  const metrics = createMetricsCollector();
  metrics.startTimer('total');

  logger.info('Starting schema analysis and planning phase', { correlationId });

  try {
    // Step 0: Load agent config and check if planner is enabled
    const agentConfig = await loadAgentConfig();
    if (!agentConfig.planner.enabled) {
      logger.info('Planner is disabled in agent-config.yaml, skipping');
      throw createPlannerError(
        'configInvalid',
        'Planner is disabled in agent-config.yaml. Set planner.enabled=true to run.'
      );
    }

    // Step 1: Load and validate configuration
    metrics.startTimer('config');
    const configPath = options.configPath || path.join(process.cwd(), 'config', 'databases.yaml');
    const config = await loadDatabaseConfig(configPath);

    if (!config.databases || config.databases.length === 0) {
      throw createPlannerError('configInvalid', 'No databases configured in databases.yaml');
    }

    const configHash = await computeConfigHash(configPath);
    metrics.stopTimer('config');
    logger.info(`Loaded configuration with ${config.databases.length} databases`, { configHash });

    // Step 2: Check for existing plan (resume logic with staleness detection)
    if (!options.force) {
      const existingPlan = await tryLoadPlan();
      if (existingPlan) {
        const staleness = await checkPlanStaleness(existingPlan, configHash, config);

        switch (staleness.status) {
          case 'fresh':
            logger.info('Using existing plan (config and schema unchanged)');
            return existingPlan;
          case 'config_changed':
            logger.info('Config changed, replanning required');
            break;
          case 'schema_changed':
            logger.info('Schema drift detected, replanning', {
              changedDatabases: staleness.changedDatabases,
            });
            break;
          case 'partial_stale':
            logger.info('Partial staleness, updating affected work units', {
              staleWorkUnits: staleness.staleWorkUnits,
            });
            // Note: Partial replanning is post-MVP, full replan for now
            break;
        }
      }
    }

    // Step 3: Analyze each database
    metrics.startTimer('analysis');
    const plannerConfig = agentConfig.planner;
    const databases: DatabaseAnalysis[] = [];
    const errors: AgentError[] = [];
    const tableMetadataMap = new Map<string, TableMetadata[]>();
    const relationshipsMap = new Map<string, Relationship[]>();

    for (const dbConfig of config.databases) {
      metrics.startTimer('connection');
      const result = await analyzeDatabase(dbConfig.name, dbConfig, plannerConfig);
      metrics.stopTimer('connection');

      if (result.success) {
        databases.push(result.analysis);
        tableMetadataMap.set(dbConfig.name, result.tableMetadata);
        relationshipsMap.set(dbConfig.name, result.relationships);

        // Track metrics
        metrics.increment('databases');
        metrics.increment('tables', result.tableMetadata.length);
        metrics.increment('domains', Object.keys(result.analysis.domains).length);

        if (result.domainInferenceResult.tokensUsed) {
          metrics.increment('llm_tokens', result.domainInferenceResult.tokensUsed);
          metrics.increment('llm_calls');
        }
      } else {
        // IMPORTANT: Include unreachable databases with status='unreachable'
        databases.push(result.partialAnalysis);
        errors.push(result.error);
        metrics.increment('databases_unreachable');
      }
    }
    metrics.stopTimer('analysis');

    // Step 4: Generate work units from domains
    logger.info('Generating work units...');
    const workUnits = generateWorkUnits(databases, tableMetadataMap, relationshipsMap);
    renumberPriorityOrder(workUnits);

    // Step 5: Create plan summary
    const summary = computePlanSummary(databases, workUnits);

    // Step 6: Assemble and validate plan
    const plan: DocumentationPlan = {
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      config_hash: configHash,
      complexity: determineComplexity(summary.total_tables),
      databases,
      work_units: workUnits,
      summary,
      errors,
    };

    // Validate the plan
    const validationResult = validatePlan(plan);
    if (!validationResult.success) {
      logger.error('Plan validation failed', { errors: validationResult.errors });
      throw createPlannerError(
        'configInvalid',
        `Plan validation failed: ${validationResult.errors?.map((e) => e.message).join(', ')}`
      );
    }

    // Step 7: Write plan to file (unless dry run)
    if (!options.dryRun) {
      metrics.startTimer('write');
      await savePlan(plan);
      metrics.stopTimer('write');
      logger.info('Documentation plan saved to progress/documentation-plan.json');
    }

    // Emit metrics
    metrics.stopTimer('total');
    const reachableCount = databases.filter((d) => d.status === 'reachable').length;
    const unreachableCount = databases.filter((d) => d.status === 'unreachable').length;

    emitPlannerMetrics(
      {
        ...metrics.getMetrics(),
        databases_analyzed: reachableCount,
        databases_unreachable: unreachableCount,
        tables_discovered: summary.total_tables,
        domains_detected: summary.domain_count,
        tables_per_domain_avg: summary.domain_count > 0 ? summary.total_tables / summary.domain_count : 0,
        unassigned_tables: countUnassignedTables(databases),
        domain_validation_warnings: errors.filter((e) => e.code === ERROR_CODES.PLAN_DOMAIN_INFERENCE_FAILED).length,
      },
      logger,
      correlationId
    );

    logger.info(
      `Planning complete: ${summary.total_tables} tables in ${summary.total_work_units} work units`,
      {
        databases: summary.total_databases,
        reachable: summary.reachable_databases,
        domains: summary.domain_count,
        estimatedMinutes: summary.total_estimated_minutes,
        parallelism: summary.recommended_parallelism,
      }
    );

    return plan;
  } catch (error) {
    metrics.stopTimer('total');
    logger.error('Planning phase failed', { error, correlationId });
    throw error;
  }
}

/**
 * Load database configuration from databases.yaml.
 */
async function loadDatabaseConfig(configPath: string): Promise<DatabaseCatalog> {
  try {
    await fs.access(configPath);
  } catch {
    throw createPlannerError('configNotFound', `Config file not found: ${configPath}`, {
      path: configPath,
    });
  }

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = yaml.load(content) as DatabaseCatalog;

    // Handle legacy format where databases is an object instead of array
    if (parsed.databases && !Array.isArray(parsed.databases)) {
      // Convert object format to array format
      const dbObj = parsed.databases as unknown as Record<string, Omit<DatabaseConfig, 'name'>>;
      parsed.databases = Object.entries(dbObj).map(([name, config]) => ({
        name,
        ...config,
      }));
    }

    return parsed;
  } catch (error) {
    throw createPlannerError(
      'configInvalid',
      `Failed to parse databases.yaml: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Compute plan summary statistics.
 */
function computePlanSummary(
  databases: DatabaseAnalysis[],
  workUnits: { tables: unknown[] }[]
): PlanSummary {
  const totalTables = workUnits.reduce((sum, wu) => sum + wu.tables.length, 0);
  const domains = new Set<DomainName>();

  for (const db of databases) {
    for (const domain of Object.keys(db.domains)) {
      domains.add(domain);
    }
  }

  const totalEstimatedMinutes = databases.reduce(
    (sum, db) => sum + db.estimated_time_minutes,
    0
  );

  return {
    total_databases: databases.length,
    reachable_databases: databases.filter((db) => db.status === 'reachable').length,
    total_tables: totalTables,
    total_work_units: workUnits.length,
    domain_count: domains.size,
    total_estimated_minutes: totalEstimatedMinutes,
    recommended_parallelism: calculateRecommendedParallelism(workUnits.length),
  };
}

/**
 * Determine complexity based on table count.
 * Per PRD2 §4.3:
 * - simple: < 50 tables
 * - moderate: 50-200 tables
 * - complex: > 200 tables
 */
function determineComplexity(totalTables: number): 'simple' | 'moderate' | 'complex' {
  if (totalTables < 50) return 'simple';
  if (totalTables <= 200) return 'moderate';
  return 'complex';
}

/**
 * Count tables in 'uncategorized' domain.
 */
function countUnassignedTables(databases: DatabaseAnalysis[]): number {
  let count = 0;
  for (const db of databases) {
    const uncategorized = db.domains['uncategorized'];
    if (uncategorized) {
      count += uncategorized.length;
    }
  }
  return count;
}

/**
 * Generate a correlation ID for tracing.
 */
function generateCorrelationId(): string {
  const timestamp = new Date().toISOString().replace(/[:-]/g, '').slice(0, 15);
  const random = Math.random().toString(36).substring(2, 8);
  return `plan-${timestamp}-${random}`;
}

// Export for testing
export { loadDatabaseConfig, computePlanSummary, determineComplexity };

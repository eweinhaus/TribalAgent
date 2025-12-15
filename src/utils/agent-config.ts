/**
 * Agent Configuration Loader
 *
 * Loads and validates agent-config.yaml with the proper schema matching
 * the existing config file structure per PRD2 §8.3.
 *
 * @module utils/agent-config
 */

import { z } from 'zod';
import * as yaml from 'js-yaml';
import { promises as fs } from 'fs';
import * as path from 'path';
import { createPlannerError } from '../contracts/errors.js';
import type { PlannerConfig, DocumenterConfig, AgentConfig } from '../contracts/types.js';

/**
 * Planner config schema - matches existing agent-config.yaml structure
 * Per PRD2 §8.3, planner.enabled controls whether planning phase runs
 */
const PlannerConfigSchema = z.object({
  enabled: z.boolean().default(true),
  domain_inference: z.boolean().default(true),
  max_tables_per_database: z.number().default(1000),
  domain_inference_batch_size: z.number().default(100),
  llm_model: z.string().optional(),
});

/**
 * Documenter config schema - for reference (used by Documenter agent)
 */
const DocumenterConfigSchema = z.object({
  concurrency: z.number().default(5),
  sample_timeout_ms: z.number().default(5000),
  llm_model: z.string().default('claude-haiku-4.5'),
  checkpoint_interval: z.number().default(10),
  use_sub_agents: z.boolean().default(true),
});

/**
 * Indexer config schema
 */
const IndexerConfigSchema = z.object({
  batch_size: z.number().default(50),
  embedding_model: z.string().default('text-embedding-3-small'),
  checkpoint_interval: z.number().default(100),
});

/**
 * Retrieval config schema
 */
const RetrievalConfigSchema = z.object({
  default_limit: z.number().default(5),
  max_limit: z.number().default(20),
  context_budgets: z.record(z.number()).default({
    simple: 750,
    moderate: 1500,
    complex: 3000,
  }),
  rrf_k: z.number().default(60),
  use_query_understanding: z.boolean().default(false),
});

/**
 * Full agent config schema
 */
const AgentConfigSchema = z
  .object({
    planner: PlannerConfigSchema.default({}),
    documenter: DocumenterConfigSchema.optional(),
    indexer: IndexerConfigSchema.optional(),
    retrieval: RetrievalConfigSchema.optional(),
  })
  .passthrough(); // Allow extra fields we don't validate yet

/**
 * Default planner config when no file exists
 */
const DEFAULT_PLANNER_CONFIG: PlannerConfig = {
  enabled: true,
  domain_inference: true,
  max_tables_per_database: 1000,
  domain_inference_batch_size: 100,
};

/**
 * Load agent configuration from agent-config.yaml.
 * Returns defaults if file doesn't exist.
 */
export async function loadAgentConfig(): Promise<AgentConfig> {
  const configPath = path.join(process.cwd(), 'config', 'agent-config.yaml');

  // Use defaults if config doesn't exist
  try {
    await fs.access(configPath);
  } catch {
    return {
      planner: DEFAULT_PLANNER_CONFIG,
    };
  }

  try {
    const content = await fs.readFile(configPath, 'utf-8');
    const parsed = yaml.load(content);
    const result = AgentConfigSchema.safeParse(parsed);

    if (!result.success) {
      throw createPlannerError(
        'configInvalid',
        `agent-config.yaml validation failed: ${result.error.message}`,
        { issues: result.error.issues }
      );
    }

    return result.data as AgentConfig;
  } catch (error) {
    if ((error as { code?: string }).code === 'PLAN_CONFIG_INVALID') {
      throw error;
    }
    throw createPlannerError(
      'configInvalid',
      `Failed to load agent-config.yaml: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Get planner-specific configuration.
 */
export async function getPlannerConfig(): Promise<PlannerConfig> {
  const config = await loadAgentConfig();
  return config.planner;
}

/**
 * Get documenter-specific configuration.
 */
export async function getDocumenterConfig(): Promise<DocumenterConfig | undefined> {
  const config = await loadAgentConfig();
  return config.documenter;
}

/**
 * Check if planner is enabled in config.
 */
export async function isPlannerEnabled(): Promise<boolean> {
  const config = await getPlannerConfig();
  return config.enabled;
}

// Export schemas for external use
export {
  PlannerConfigSchema,
  DocumenterConfigSchema,
  IndexerConfigSchema,
  RetrievalConfigSchema,
  AgentConfigSchema,
};

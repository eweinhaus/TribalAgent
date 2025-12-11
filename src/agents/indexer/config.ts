/**
 * Configuration Loading Module
 *
 * Loads and validates indexer configuration from agent-config.yaml
 * Provides defaults when config file is not available
 */

import { promises as fs } from 'fs';
import path from 'path';
import yaml from 'js-yaml';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Configuration Schema
// =============================================================================

const IndexerConfigSchema = z.object({
  batch_size: z.number().min(1).max(500).default(50),
  embedding_model: z.string().default('text-embedding-3-small'),
  checkpoint_interval: z.number().min(1).default(100),
  parse_timeout_ms: z.number().min(100).default(5000),
  embedding_timeout_ms: z.number().min(1000).default(30000),
  max_retries: z.number().min(0).max(10).default(3),
  retry_delay_ms: z.number().min(100).default(1000),
});

const AgentConfigSchema = z.object({
  indexer: IndexerConfigSchema.optional(),
});

export type IndexerConfig = z.infer<typeof IndexerConfigSchema>;

// =============================================================================
// Default Configuration
// =============================================================================

const DEFAULT_CONFIG: IndexerConfig = {
  batch_size: 50,
  embedding_model: 'text-embedding-3-small',
  checkpoint_interval: 100,
  parse_timeout_ms: 5000,
  embedding_timeout_ms: 30000,
  max_retries: 3,
  retry_delay_ms: 1000,
};

// =============================================================================
// Configuration Loading
// =============================================================================

let cachedConfig: IndexerConfig | null = null;

/**
 * Load indexer configuration from agent-config.yaml
 * Returns defaults if config file doesn't exist or is invalid
 */
export async function loadConfig(configPath?: string): Promise<IndexerConfig> {
  // Return cached config if available
  if (cachedConfig) {
    return cachedConfig;
  }

  const finalPath = configPath || path.join(process.cwd(), 'config', 'agent-config.yaml');

  try {
    const content = await fs.readFile(finalPath, 'utf-8');
    const rawConfig = yaml.load(content) as Record<string, unknown>;

    // Validate the full config structure
    const parsed = AgentConfigSchema.safeParse(rawConfig);

    if (!parsed.success) {
      logger.warn('Invalid agent config format, using defaults', {
        errors: parsed.error.errors,
      });
      cachedConfig = DEFAULT_CONFIG;
      return cachedConfig;
    }

    // Extract indexer config with defaults
    const indexerConfig = parsed.data.indexer || {};
    cachedConfig = {
      ...DEFAULT_CONFIG,
      ...indexerConfig,
    };

    logger.debug('Loaded indexer config', cachedConfig);
    return cachedConfig;

  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.debug('No config file found, using defaults');
    } else {
      logger.warn('Failed to load config file, using defaults', error);
    }

    cachedConfig = DEFAULT_CONFIG;
    return cachedConfig;
  }
}

/**
 * Get a specific config value with type safety
 */
export async function getConfigValue<K extends keyof IndexerConfig>(
  key: K
): Promise<IndexerConfig[K]> {
  const config = await loadConfig();
  return config[key];
}

/**
 * Reset cached config (useful for testing)
 */
export function resetConfigCache(): void {
  cachedConfig = null;
}

/**
 * Get default config values
 */
export function getDefaultConfig(): IndexerConfig {
  return { ...DEFAULT_CONFIG };
}

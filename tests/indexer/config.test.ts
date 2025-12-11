/**
 * Unit Tests for Config Loading Module
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import path from 'path';
import {
  loadConfig,
  getConfigValue,
  resetConfigCache,
  getDefaultConfig,
} from '../../src/agents/indexer/config.js';

describe('Config Module', () => {
  const testConfigPath = path.join(process.cwd(), 'tests', 'indexer', 'test-config.yaml');

  beforeEach(() => {
    resetConfigCache();
  });

  afterEach(async () => {
    // Clean up test config file if created
    try {
      await fs.unlink(testConfigPath);
    } catch {
      // File might not exist, that's fine
    }
    resetConfigCache();
  });

  describe('getDefaultConfig', () => {
    it('returns default configuration values', () => {
      const defaults = getDefaultConfig();

      expect(defaults.batch_size).toBe(50);
      expect(defaults.embedding_model).toBe('text-embedding-3-small');
      expect(defaults.checkpoint_interval).toBe(100);
      expect(defaults.parse_timeout_ms).toBe(5000);
      expect(defaults.max_retries).toBe(3);
    });

    it('returns a copy, not the original', () => {
      const defaults1 = getDefaultConfig();
      const defaults2 = getDefaultConfig();

      defaults1.batch_size = 999;
      expect(defaults2.batch_size).toBe(50);
    });
  });

  describe('loadConfig', () => {
    it('returns defaults when config file does not exist', async () => {
      const config = await loadConfig('/nonexistent/path/config.yaml');

      expect(config.batch_size).toBe(50);
      expect(config.checkpoint_interval).toBe(100);
    });

    it('caches config after first load', async () => {
      const config1 = await loadConfig('/nonexistent/path/config.yaml');
      const config2 = await loadConfig('/different/path/config.yaml');

      // Should return same cached config
      expect(config1).toBe(config2);
    });

    it('loads config from valid YAML file', async () => {
      const configContent = `
indexer:
  batch_size: 100
  checkpoint_interval: 50
`;
      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, configContent);

      const config = await loadConfig(testConfigPath);

      expect(config.batch_size).toBe(100);
      expect(config.checkpoint_interval).toBe(50);
      // Defaults should still apply for unspecified values
      expect(config.embedding_model).toBe('text-embedding-3-small');
    });

    it('falls back to defaults for invalid YAML', async () => {
      const configContent = `
this is: [not valid yaml
`;
      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, configContent);

      // Reset cache to force reload
      resetConfigCache();
      const config = await loadConfig(testConfigPath);

      expect(config.batch_size).toBe(50);
    });
  });

  describe('getConfigValue', () => {
    it('returns specific config values', async () => {
      const batchSize = await getConfigValue('batch_size');
      expect(batchSize).toBe(50);

      const embeddingModel = await getConfigValue('embedding_model');
      expect(embeddingModel).toBe('text-embedding-3-small');
    });
  });

  describe('resetConfigCache', () => {
    it('clears the config cache', async () => {
      // Load config to populate cache
      await loadConfig();

      // Reset
      resetConfigCache();

      // Create a custom config file (use value within valid range 1-500)
      const configContent = `
indexer:
  batch_size: 200
`;
      await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
      await fs.writeFile(testConfigPath, configContent);

      // Load again - should read from file
      const config = await loadConfig(testConfigPath);
      expect(config.batch_size).toBe(200);
    });
  });
});

/**
 * Planner Unit Tests
 *
 * Unit tests for the Planner Schema Analyzer module.
 * Per plan §7.2 - unit tests for core planner functionality.
 *
 * @module tests/planner/index
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { computeHash, computeConfigHash, computeSchemaHash } from '../../src/utils/hash.js';
import { validatePlan, validateWorkUnit, validateNoCycles } from '../../src/contracts/validators.js';
import { createPlannerError, ERROR_CODES } from '../../src/contracts/errors.js';
import type { DocumentationPlan, WorkUnit, TableSpec } from '../../src/contracts/types.js';

// =============================================================================
// HASH UTILITY TESTS
// =============================================================================

describe('Hash Utilities', () => {
  describe('computeHash', () => {
    it('should produce consistent SHA-256 hashes', () => {
      const input = 'test content';
      const hash1 = computeHash(input);
      const hash2 = computeHash(input);

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64); // SHA-256 produces 64 hex chars
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = computeHash('input1');
      const hash2 = computeHash('input2');

      expect(hash1).not.toBe(hash2);
    });

    it('should handle empty string', () => {
      const hash = computeHash('');
      expect(hash).toHaveLength(64);
    });

    it('should handle unicode content', () => {
      const hash = computeHash('日本語テスト');
      expect(hash).toHaveLength(64);
    });
  });

  describe('computeConfigHash', () => {
    it('should hash config object consistently', () => {
      const config = {
        databases: [
          { name: 'db1', type: 'postgres' },
          { name: 'db2', type: 'snowflake' },
        ],
      };

      const hash1 = computeConfigHash(config);
      const hash2 = computeConfigHash(config);

      expect(hash1).toBe(hash2);
    });

    it('should detect config changes', () => {
      const config1 = { databases: [{ name: 'db1' }] };
      const config2 = { databases: [{ name: 'db2' }] };

      expect(computeConfigHash(config1)).not.toBe(computeConfigHash(config2));
    });
  });

  describe('computeSchemaHash', () => {
    it('should hash table metadata array', () => {
      const tables = [
        { table_name: 'users', columns: ['id', 'name'] },
        { table_name: 'orders', columns: ['id', 'user_id'] },
      ];

      const hash = computeSchemaHash(tables);
      expect(hash).toHaveLength(64);
    });
  });
});

// =============================================================================
// VALIDATION TESTS
// =============================================================================

describe('Validators', () => {
  describe('validateWorkUnit', () => {
    const validTableSpec: TableSpec = {
      fully_qualified_name: 'db.public.users',
      schema_name: 'public',
      table_name: 'users',
      domain: 'identity',
      priority: 1,
      column_count: 5,
      row_count_approx: 1000,
      incoming_fk_count: 2,
      outgoing_fk_count: 0,
      metadata_hash: 'a'.repeat(64),
    };

    const validWorkUnit: WorkUnit = {
      id: 'testdb_identity',
      database: 'testdb',
      domain: 'identity',
      tables: [validTableSpec],
      estimated_time_minutes: 5,
      output_directory: 'docs/testdb/identity',
      priority_order: 1,
      depends_on: [],
      content_hash: 'b'.repeat(64),
    };

    it('should accept valid work unit', () => {
      const result = validateWorkUnit(validWorkUnit);
      expect(result.success).toBe(true);
    });

    it('should reject work unit with missing tables', () => {
      const invalid = { ...validWorkUnit, tables: [] };
      const result = validateWorkUnit(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject work unit with invalid hash length', () => {
      const invalid = { ...validWorkUnit, content_hash: 'tooshort' };
      const result = validateWorkUnit(invalid);
      expect(result.success).toBe(false);
    });

    it('should reject table spec with missing required fields', () => {
      const invalidTable = { ...validTableSpec, fully_qualified_name: '' };
      const invalid = { ...validWorkUnit, tables: [invalidTable] };
      const result = validateWorkUnit(invalid);
      expect(result.success).toBe(false);
    });
  });

  describe('validateNoCycles', () => {
    it('should accept DAG with no cycles', () => {
      const workUnits: WorkUnit[] = [
        {
          id: 'unit_a',
          database: 'db',
          domain: 'a',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/a',
          priority_order: 1,
          depends_on: [],
          content_hash: 'a'.repeat(64),
        },
        {
          id: 'unit_b',
          database: 'db',
          domain: 'b',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/b',
          priority_order: 2,
          depends_on: ['unit_a'],
          content_hash: 'b'.repeat(64),
        },
        {
          id: 'unit_c',
          database: 'db',
          domain: 'c',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/c',
          priority_order: 3,
          depends_on: ['unit_a', 'unit_b'],
          content_hash: 'c'.repeat(64),
        },
      ];

      const result = validateNoCycles(workUnits);
      expect(result.valid).toBe(true);
      expect(result.cycle).toBeUndefined();
    });

    it('should detect simple cycle', () => {
      const workUnits: WorkUnit[] = [
        {
          id: 'unit_a',
          database: 'db',
          domain: 'a',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/a',
          priority_order: 1,
          depends_on: ['unit_b'],
          content_hash: 'a'.repeat(64),
        },
        {
          id: 'unit_b',
          database: 'db',
          domain: 'b',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/b',
          priority_order: 2,
          depends_on: ['unit_a'],
          content_hash: 'b'.repeat(64),
        },
      ];

      const result = validateNoCycles(workUnits);
      expect(result.valid).toBe(false);
      expect(result.cycle).toBeDefined();
    });

    it('should detect self-reference cycle', () => {
      const workUnits: WorkUnit[] = [
        {
          id: 'unit_a',
          database: 'db',
          domain: 'a',
          tables: [],
          estimated_time_minutes: 1,
          output_directory: 'docs/a',
          priority_order: 1,
          depends_on: ['unit_a'],
          content_hash: 'a'.repeat(64),
        },
      ];

      const result = validateNoCycles(workUnits);
      expect(result.valid).toBe(false);
    });

    it('should accept empty work units', () => {
      const result = validateNoCycles([]);
      expect(result.valid).toBe(true);
    });
  });

  describe('validatePlan', () => {
    const createValidPlan = (): DocumentationPlan => ({
      schema_version: '1.0',
      generated_at: new Date().toISOString(),
      config_hash: 'c'.repeat(64),
      complexity: 'simple',
      databases: [
        {
          name: 'testdb',
          type: 'postgres',
          status: 'reachable',
          table_count: 10,
          schema_count: 1,
          estimated_time_minutes: 30,
          domains: { identity: ['users', 'roles'] },
          schema_hash: 'd'.repeat(64),
        },
      ],
      work_units: [
        {
          id: 'testdb_identity',
          database: 'testdb',
          domain: 'identity',
          tables: [
            {
              fully_qualified_name: 'testdb.public.users',
              schema_name: 'public',
              table_name: 'users',
              domain: 'identity',
              priority: 1,
              column_count: 5,
              row_count_approx: 1000,
              incoming_fk_count: 2,
              outgoing_fk_count: 0,
              metadata_hash: 'e'.repeat(64),
            },
          ],
          estimated_time_minutes: 15,
          output_directory: 'docs/testdb/identity',
          priority_order: 1,
          depends_on: [],
          content_hash: 'f'.repeat(64),
        },
      ],
      summary: {
        total_databases: 1,
        reachable_databases: 1,
        total_tables: 10,
        total_work_units: 1,
        domain_count: 1,
        total_estimated_minutes: 30,
        recommended_parallelism: 1,
      },
      errors: [],
    });

    it('should accept valid plan', () => {
      const result = validatePlan(createValidPlan());
      expect(result.success).toBe(true);
    });

    it('should reject plan with invalid schema version', () => {
      const plan = createValidPlan();
      (plan as any).schema_version = '2.0';
      const result = validatePlan(plan);
      expect(result.success).toBe(false);
    });

    it('should reject plan with empty databases', () => {
      const plan = createValidPlan();
      plan.databases = [];
      const result = validatePlan(plan);
      expect(result.success).toBe(false);
    });
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  describe('createPlannerError', () => {
    it('should create error with correct structure', () => {
      const error = createPlannerError(
        ERROR_CODES.PLAN_DB_UNREACHABLE,
        'Connection refused',
        { database: 'testdb', host: 'localhost' }
      );

      expect(error.code).toBe('PLAN_DB_UNREACHABLE');
      expect(error.message).toBe('Connection refused');
      expect(error.severity).toBe('error');
      expect(error.recoverable).toBe(true);
      expect(error.context).toEqual({ database: 'testdb', host: 'localhost' });
      expect(error.timestamp).toBeDefined();
    });

    it('should use default message if not provided', () => {
      const error = createPlannerError(ERROR_CODES.PLAN_CONFIG_NOT_FOUND);
      expect(error.message).toBe('Configuration file not found');
    });

    it('should handle fatal errors correctly', () => {
      const error = createPlannerError(ERROR_CODES.PLAN_CONFIG_NOT_FOUND);
      expect(error.severity).toBe('fatal');
      expect(error.recoverable).toBe(false);
    });
  });
});

// =============================================================================
// DOMAIN INFERENCE TESTS (Mocked)
// =============================================================================

describe('Domain Inference', () => {
  describe('prefix-based fallback', () => {
    it('should group tables by prefix', async () => {
      // Import the function
      const { inferDomainsByPrefix } = await import('../../src/agents/planner/domain-inference.js');

      const tableNames = [
        'user_profiles',
        'user_settings',
        'user_sessions',
        'order_items',
        'order_history',
        'product_catalog',
        'product_reviews',
        'audit_logs',
      ];

      const result = inferDomainsByPrefix(tableNames);

      expect(result.user).toContain('user_profiles');
      expect(result.user).toContain('user_settings');
      expect(result.user).toContain('user_sessions');
      expect(result.order).toContain('order_items');
      expect(result.order).toContain('order_history');
      expect(result.product).toContain('product_catalog');
      expect(result.product).toContain('product_reviews');
    });

    it('should handle tables without underscores', async () => {
      const { inferDomainsByPrefix } = await import('../../src/agents/planner/domain-inference.js');

      const tableNames = ['users', 'orders', 'products'];
      const result = inferDomainsByPrefix(tableNames);

      // Tables without prefix go to 'general' domain
      expect(result.general).toContain('users');
      expect(result.general).toContain('orders');
      expect(result.general).toContain('products');
    });

    it('should handle empty input', async () => {
      const { inferDomainsByPrefix } = await import('../../src/agents/planner/domain-inference.js');

      const result = inferDomainsByPrefix([]);
      expect(Object.keys(result)).toHaveLength(0);
    });
  });
});

// =============================================================================
// PLAN I/O TESTS
// =============================================================================

describe('Plan I/O', () => {
  // These tests would need file system mocking
  // For now, test the validation aspect

  describe('plan file validation', () => {
    it('should validate plan structure on load', async () => {
      const { validatePlanFile } = await import('../../src/utils/plan-io.js');

      const validPlanJson = JSON.stringify({
        schema_version: '1.0',
        generated_at: new Date().toISOString(),
        config_hash: 'x'.repeat(64),
        complexity: 'simple',
        databases: [{
          name: 'db',
          type: 'postgres',
          status: 'reachable',
          table_count: 1,
          schema_count: 1,
          estimated_time_minutes: 1,
          domains: {},
          schema_hash: 'y'.repeat(64),
        }],
        work_units: [],
        summary: {
          total_databases: 1,
          reachable_databases: 1,
          total_tables: 1,
          total_work_units: 0,
          domain_count: 0,
          total_estimated_minutes: 1,
          recommended_parallelism: 1,
        },
        errors: [],
      });

      const result = validatePlanFile(validPlanJson);
      expect(result.success).toBe(true);
    });

    it('should reject invalid JSON', async () => {
      const { validatePlanFile } = await import('../../src/utils/plan-io.js');

      const result = validatePlanFile('not valid json');
      expect(result.success).toBe(false);
    });
  });
});

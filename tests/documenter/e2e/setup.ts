/**
 * End-to-End Test Setup Utilities
 * 
 * Provides utilities for setting up test environment:
 * - Test database setup/teardown
 * - Test plan generation
 * - Test directory management
 * - Test data creation
 */

import { promises as fs } from 'fs';
import * as path from 'path';
import { getDatabaseConnector } from '../../../src/connectors/index.js';
import type { DatabaseConnector } from '../../../src/connectors/index.js';
import type { DocumentationPlan, WorkUnit, TableSpec } from '../../../src/agents/documenter/types.js';
import * as crypto from 'crypto';

/**
 * Test configuration
 */
export interface TestConfig {
  /** Test database connection string (optional) */
  testDatabaseUrl?: string;
  /** Test output directory (default: test-output) */
  testOutputDir?: string;
  /** Test progress directory (default: test-progress) */
  testProgressDir?: string;
  /** Whether to use real LLM API (default: false, uses mocks) */
  useRealLLM?: boolean;
}

/**
 * Test environment state
 */
export interface TestEnvironment {
  /** Database connector (if test DB available) */
  connector?: DatabaseConnector;
  /** Test database name */
  testDatabaseName: string;
  /** Test schema name */
  testSchema: string;
  /** Test tables created */
  testTables: string[];
  /** Test output directory */
  outputDir: string;
  /** Test progress directory */
  progressDir: string;
  /** Test docs directory */
  docsDir: string;
  /** Whether test database is available */
  hasTestDb: boolean;
}

/**
 * Default test configuration
 */
const DEFAULT_CONFIG: Required<Omit<TestConfig, 'testDatabaseUrl'>> = {
  testOutputDir: 'test-output',
  testProgressDir: 'test-progress',
  useRealLLM: false,
};

/**
 * Setup test environment
 * 
 * @param config Test configuration
 * @returns Test environment
 */
export async function setupTestEnvironment(
  config: TestConfig = {}
): Promise<TestEnvironment> {
  const fullConfig = { ...DEFAULT_CONFIG, ...config };
  // Check both config parameter and environment variable
  const testDbUrl = config.testDatabaseUrl || process.env.TEST_DATABASE_URL;
  const hasTestDb = !!testDbUrl;
  
  // Debug logging
  if (!hasTestDb) {
    console.log('⚠️  TEST_DATABASE_URL not found. Checked:', {
      configParam: !!config.testDatabaseUrl,
      envVar: !!process.env.TEST_DATABASE_URL,
    });
  }

  // Create test directories
  const outputDir = path.join(process.cwd(), fullConfig.testOutputDir);
  const progressDir = path.join(process.cwd(), fullConfig.testProgressDir);
  const docsDir = path.join(outputDir, 'docs');

  await fs.mkdir(outputDir, { recursive: true });
  await fs.mkdir(progressDir, { recursive: true });
  await fs.mkdir(docsDir, { recursive: true });

  const testDatabaseName = 'test_db';
  const testSchema = 'public';
  const testTables: string[] = [];

  let connector: DatabaseConnector | undefined;

  if (hasTestDb && testDbUrl) {
    try {
      console.log('🔌 Connecting to test database...');
      connector = getDatabaseConnector('postgres');
      await connector.connect(testDbUrl);
      console.log('✅ Connected to test database');

      // Create test tables
      console.log('📋 Creating test tables...');
      const tables = await createTestTables(connector, testSchema);
      testTables.push(...tables);
      console.log(`✅ Created ${tables.length} test tables`);
    } catch (error) {
      console.error('❌ Failed to setup test database:', error);
      console.error('Error details:', error instanceof Error ? error.message : String(error));
      // Continue without test DB
      hasTestDb = false;
    }
  } else {
    console.log('⚠️  Test database not configured:', {
      hasTestDb,
      hasUrl: !!testDbUrl,
    });
  }

  return {
    connector,
    testDatabaseName,
    testSchema,
    testTables,
    outputDir,
    progressDir,
    docsDir,
    hasTestDb: !!connector,
  };
}

/**
 * Create test tables in database
 * 
 * @param connector Database connector
 * @param schema Schema name
 * @returns Array of created table names
 */
async function createTestTables(
  connector: DatabaseConnector,
  schema: string
): Promise<string[]> {
  const tables: string[] = [];

  // Test table 1: users
  const usersTable = 'e2e_test_users';
  try {
    await connector.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.${usersTable} (
        id INTEGER PRIMARY KEY,
        email VARCHAR(255) NOT NULL UNIQUE,
        name VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Insert test data
    await connector.query(`
      INSERT INTO ${schema}.${usersTable} (id, email, name)
      VALUES 
        (1, 'alice@example.com', 'Alice'),
        (2, 'bob@test.com', 'Bob'),
        (3, 'charlie@example.org', 'Charlie'),
        (4, 'diana@test.net', 'Diana'),
        (5, 'eve@example.io', 'Eve')
      ON CONFLICT (id) DO NOTHING
    `);

    tables.push(usersTable);
  } catch (error) {
    console.warn(`Failed to create table ${usersTable}:`, error);
  }

  // Test table 2: orders
  const ordersTable = 'e2e_test_orders';
  try {
    await connector.query(`
      CREATE TABLE IF NOT EXISTS ${schema}.${ordersTable} (
        id INTEGER PRIMARY KEY,
        user_id INTEGER NOT NULL,
        order_date DATE NOT NULL,
        total_amount DECIMAL(10, 2),
        status VARCHAR(50) DEFAULT 'pending',
        FOREIGN KEY (user_id) REFERENCES ${schema}.${usersTable}(id)
      )
    `);

    // Insert test data
    await connector.query(`
      INSERT INTO ${schema}.${ordersTable} (id, user_id, order_date, total_amount, status)
      VALUES 
        (1, 1, '2024-01-15', 99.99, 'completed'),
        (2, 1, '2024-01-20', 149.50, 'pending'),
        (3, 2, '2024-01-18', 79.99, 'completed')
      ON CONFLICT (id) DO NOTHING
    `);

    tables.push(ordersTable);
  } catch (error) {
    console.warn(`Failed to create table ${ordersTable}:`, error);
  }

  return tables;
}

/**
 * Generate test documentation plan
 * 
 * @param env Test environment
 * @returns Test documentation plan
 */
export async function generateTestPlan(
  env: TestEnvironment
): Promise<DocumentationPlan> {
  const now = new Date().toISOString();
  const planHash = crypto.createHash('sha256').update('test-config').digest('hex');

  // Create table specs from test tables
  const tableSpecs: TableSpec[] = env.testTables.map((table, index) => ({
    fully_qualified_name: `${env.testDatabaseName}.${env.testSchema}.${table}`,
    schema_name: env.testSchema,
    table_name: table,
    domain: 'test',
    priority: 1 as const,
    row_count_approx: 5,
    column_count: index === 0 ? 5 : 5,
    incoming_fk_count: index === 0 ? 0 : 1,
    outgoing_fk_count: index === 0 ? 1 : 0,
    metadata_hash: crypto.createHash('sha256').update(table).digest('hex'),
    existing_comment: undefined,
  }));

  // Create work unit
  const workUnit: WorkUnit = {
    id: `${env.testDatabaseName}_test`,
    database: env.testDatabaseName,
    domain: 'test',
    output_directory: `databases/${env.testDatabaseName}/domains/test`,
    priority_order: 1,
    estimated_time_minutes: 1,
    content_hash: planHash,
    tables: tableSpecs,
    depends_on: [],
  };

  // Create plan with test database connection info
  // For tests, we need to include connection info in the database analysis
  const plan: DocumentationPlan = {
    schema_version: '1.0',
    generated_at: now,
    config_hash: planHash,
    complexity: env.testTables.length <= 2 ? 'simple' : 'moderate',
    databases: [
      {
        name: env.testDatabaseName,
        type: 'postgres',
        table_count: env.testTables.length,
        estimated_time_minutes: 1,
        domains: {
          test: env.testTables,
        },
        status: 'reachable',
        // Store test connection string in a way the work unit processor can access it
        // We'll need to modify the work unit processor to use TEST_DATABASE_URL for test databases
      },
    ],
    work_units: [workUnit],
    summary: {
      total_tables: env.testTables.length,
      total_work_units: 1,
      total_estimated_time_minutes: 1,
      domains: ['test'],
    },
    errors: [],
  };

  return plan;
}

/**
 * Write test plan to file
 * 
 * @param plan Documentation plan
 * @param progressDir Progress directory
 */
export async function writeTestPlan(
  plan: DocumentationPlan,
  progressDir: string
): Promise<void> {
  // Create progress subdirectory to match plan-loader expectations
  const progressSubDir = path.join(progressDir, 'progress');
  await fs.mkdir(progressSubDir, { recursive: true });
  
  const planPath = path.join(progressSubDir, 'documentation-plan.json');
  await fs.writeFile(planPath, JSON.stringify(plan, null, 2), 'utf-8');
}

/**
 * Override process directories for testing
 * 
 * @param env Test environment
 */
export function setupTestDirectories(env: TestEnvironment): void {
  // Set environment variables to override default paths
  process.env.TRIBAL_DOCS_PATH = env.docsDir;
  // Note: Progress path is handled via plan-loader using process.cwd()
  // Tests should change working directory before running documenter
}

/**
 * Get the original working directory
 */
export function getOriginalCwd(): string {
  return process.cwd();
}

/**
 * Change to test progress directory
 * Note: process.chdir() is not supported in Vitest workers, so we use environment variable instead
 * 
 * @param progressDir Progress directory
 */
export function changeToTestDirectory(progressDir: string): void {
  // Store original cwd in environment variable for restoration
  if (!process.env.ORIGINAL_CWD) {
    process.env.ORIGINAL_CWD = process.cwd();
  }
  // Set test progress dir in environment for plan-loader to use
  process.env.TEST_PROGRESS_DIR = progressDir;
}

/**
 * Restore original working directory
 * Note: process.chdir() is not supported in Vitest workers
 * 
 * @param originalCwd Original working directory (unused, kept for compatibility)
 */
export function restoreOriginalDirectory(originalCwd: string): void {
  // Clean up environment variable
  delete process.env.TEST_PROGRESS_DIR;
}

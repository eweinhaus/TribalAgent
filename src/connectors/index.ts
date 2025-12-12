/**
 * Database Connectors
 *
 * Provides unified interface for connecting to different database types.
 * Currently supports PostgreSQL and Snowflake.
 */

// Database connector interface
export interface DatabaseConnector {
  connect(connectionString: string): Promise<void>;
  disconnect(): Promise<void>;
  getAllTableMetadata(schemas?: string[], excludeTables?: string[], includeSystemTables?: boolean): Promise<any[]>;
  getRelationships(tableMetadata: any[]): Promise<any[]>;
  query(sql: string): Promise<any[]>;
  getTableMetadata(schema: string, table: string): Promise<any>;
}

// Connector implementations
import { PostgresConnector } from './postgres.js';
import { SnowflakeConnector } from './snowflake.js';

/**
 * Get database connector for the specified type
 */
export function getDatabaseConnector(type: 'postgres' | 'snowflake'): DatabaseConnector {
  switch (type) {
    case 'postgres':
      return new PostgresConnector();
    case 'snowflake':
      return new SnowflakeConnector();
    default:
      throw new Error(`Unsupported database type: ${type}`);
  }
}
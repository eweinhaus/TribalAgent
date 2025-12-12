/**
 * PostgreSQL Database Connector
 *
 * Handles connections and metadata extraction from PostgreSQL databases.
 */

import { Client } from 'pg';
import { logger } from '../utils/logger.js';
import { DatabaseConnector } from './index.js';

export class PostgresConnector implements DatabaseConnector {
  private client: Client | null = null;

  async connect(connectionString: string): Promise<void> {
    try {
      this.client = new Client({ connectionString });
      // Attach error handler to prevent unhandled error crashes on connection termination
      this.client.on('error', (err) => {
        // Suppress expected client-initiated shutdown messages
        if (err?.message?.includes('client_termination') || err?.message?.includes('shutdown')) {
          logger.debug('PostgreSQL connection closed');
          return;
        }
        logger.warn('PostgreSQL client error (connection may have been terminated)', { error: err?.message });
      });
      await this.client.connect();
      logger.debug('Connected to PostgreSQL database');
    } catch (error) {
      logger.error('Failed to connect to PostgreSQL', error);
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (this.client) {
      await this.client.end();
      this.client = null;
      logger.debug('Disconnected from PostgreSQL database');
    }
  }

  async getAllTableMetadata(schemas?: string[], excludeTables?: string[], includeSystemTables?: boolean): Promise<any[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    try {
      // Build schema filter
      let schemaFilter: string;
      if (schemas && schemas.length > 0) {
        schemaFilter = `AND t.table_schema IN (${schemas.map(s => `'${s}'`).join(', ')})`;
      } else if (includeSystemTables) {
        // Include all schemas including system schemas
        schemaFilter = '';
      } else {
        // Default: exclude system schemas and Supabase infrastructure schemas
        schemaFilter = `AND t.table_schema NOT IN ('pg_catalog', 'information_schema', 'auth', 'storage', 'extensions', 'graphql', 'graphql_public', 'pgsodium', 'pgsodium_masks', 'vault')`;
      }

      // Build exclude filter
      const excludeFilter = excludeTables && excludeTables.length > 0
        ? `AND t.table_name NOT IN (${excludeTables.map(t => `'${t}'`).join(', ')})`
        : '';

      // Query for tables and basic metadata
      const tablesQuery = `
        SELECT
          t.table_schema,
          t.table_name,
          t.table_type,
          obj_description((t.table_schema || '.' || t.table_name)::regclass::oid, 'pg_class') as comment,
          pg_class.reltuples::bigint as row_count
        FROM information_schema.tables t
        JOIN pg_class ON pg_class.relname = t.table_name
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
          AND pg_namespace.nspname = t.table_schema
        WHERE t.table_type = 'BASE TABLE'
          ${schemaFilter}
          ${excludeFilter}
        ORDER BY t.table_schema, t.table_name
      `;

      const tablesResult = await this.client.query(tablesQuery);
      const tables = tablesResult.rows;

      // Get detailed metadata for each table
      const tablesWithMetadata = [];

      for (const table of tables) {
        try {
          const metadata = await this.getTableMetadata(table.table_schema, table.table_name);
          tablesWithMetadata.push({
            ...table,
            ...metadata,
          });
        } catch (error) {
          logger.warn(`Failed to get metadata for table ${table.table_schema}.${table.table_name}`, error);
          tablesWithMetadata.push(table); // Include basic info even if detailed metadata fails
        }
      }

      return tablesWithMetadata;

    } catch (error) {
      logger.error('Failed to get table metadata', error);
      throw error;
    }
  }

  async getRelationships(_tableMetadata: any[]): Promise<any[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    try {
      const relationships: any[] = [];

      // Get foreign key relationships
      const fkQuery = `
        SELECT
          tc.table_schema,
          tc.table_name,
          kcu.column_name,
          ccu.table_schema AS foreign_table_schema,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name,
          tc.constraint_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY tc.table_schema, tc.table_name, kcu.ordinal_position
      `;

      const fkResult = await this.client.query(fkQuery);

      for (const fk of fkResult.rows) {
        relationships.push({
          source_table: `${fk.table_schema}.${fk.table_name}`,
          source_column: fk.column_name,
          target_table: `${fk.foreign_table_schema}.${fk.foreign_table_name}`,
          target_column: fk.foreign_column_name,
          relationship_type: 'foreign_key',
          constraint_name: fk.constraint_name,
        });
      }

      return relationships;

    } catch (error) {
      logger.error('Failed to get relationships', error);
      throw error;
    }
  }

  async query(sql: string): Promise<any[]> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    try {
      const result = await this.client.query(sql);
      return result.rows;
    } catch (error) {
      logger.error('Query failed', error);
      throw error;
    }
  }

  /**
   * Get detailed metadata for a specific table
   */
  public async getTableMetadata(schema: string, table: string): Promise<any> {
    if (!this.client) {
      throw new Error('Not connected to database');
    }

    // Get columns
    const columnsQuery = `
      SELECT
        c.column_name,
        c.data_type,
        c.is_nullable,
        c.column_default,
        c.ordinal_position,
        c.character_maximum_length,
        c.numeric_precision,
        c.numeric_scale,
        col_description((c.table_schema || '.' || c.table_name)::regclass::oid, c.ordinal_position) as comment
      FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2
      ORDER BY c.ordinal_position
    `;

    const columnsResult = await this.client.query(columnsQuery, [schema, table]);
    const columns = columnsResult.rows;

    // Get primary key
    const pkQuery = `
      SELECT kcu.column_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position
    `;

    const pkResult = await this.client.query(pkQuery, [schema, table]);
    const primaryKey = pkResult.rows.map(row => row.column_name);

    // Get foreign keys (already done in getRelationships, but include here for completeness)
    const fkQuery = `
      SELECT
        kcu.column_name,
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name,
        tc.constraint_name
      FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu
        ON tc.constraint_name = kcu.constraint_name
        AND tc.table_schema = kcu.table_schema
      JOIN information_schema.constraint_column_usage ccu
        ON ccu.constraint_name = tc.constraint_name
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = $1
        AND tc.table_name = $2
      ORDER BY kcu.ordinal_position
    `;

    const fkResult = await this.client.query(fkQuery, [schema, table]);
    const foreignKeys = fkResult.rows.map(fk => ({
      constraint_name: fk.constraint_name,
      column_name: fk.column_name,
      referenced_table: `${fk.foreign_table_schema}.${fk.foreign_table_name}`,
      referenced_column: fk.foreign_column_name,
    }));

    // Get indexes
    const indexQuery = `
      SELECT
        schemaname,
        tablename,
        indexname,
        indexdef
      FROM pg_indexes
      WHERE schemaname = $1 AND tablename = $2
      ORDER BY indexname
    `;

    const indexResult = await this.client.query(indexQuery, [schema, table]);
    const indexes = indexResult.rows.map(idx => ({
      index_name: idx.indexname,
      index_definition: idx.indexdef,
      // Parse indexdef to extract columns and uniqueness
      columns: this.parseIndexDefinition(idx.indexdef),
      is_unique: idx.indexdef.includes('CREATE UNIQUE INDEX'),
    }));

    return {
      columns,
      primary_key: primaryKey,
      foreign_keys: foreignKeys,
      indexes,
    };
  }

  /**
   * Parse PostgreSQL index definition to extract column names
   */
  private parseIndexDefinition(indexdef: string): string[] {
    // Extract column names from CREATE INDEX statement
    // Example: CREATE INDEX idx_name ON schema.table (column1, column2)
    const match = indexdef.match(/\(([^)]+)\)/);
    if (!match) return [];

    return match[1].split(',').map(col => col.trim().replace(/"/g, ''));
  }
}

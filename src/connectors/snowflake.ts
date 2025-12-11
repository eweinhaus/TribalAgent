/**
 * Snowflake Database Connector
 *
 * Handles connections and metadata extraction from Snowflake databases.
 */

import { logger } from '../utils/logger.js';
import { DatabaseConnector } from './index.js';
import snowflake from 'snowflake-sdk';

// Configure Snowflake SDK to reduce verbosity (suppress INFO logs)
// Valid levels: ERROR, WARN, INFO, DEBUG, TRACE
snowflake.configure({ logLevel: 'WARN' });

export class SnowflakeConnector implements DatabaseConnector {
  private connection: snowflake.Connection | null = null;

  async connect(connectionConfig: string): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        // Parse connection config (assuming environment variable contains JSON)
        const config = JSON.parse(connectionConfig);

        this.connection = snowflake.createConnection(config);

        this.connection.connect((err, _conn) => {
          if (err) {
            logger.error('Failed to connect to Snowflake', err);
            reject(err);
          } else {
            logger.debug('Connected to Snowflake database');
            resolve();
          }
        });

      } catch (error) {
        logger.error('Failed to create Snowflake connection', error);
        reject(error);
      }
    });
  }

  async disconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.connection) {
        this.connection.destroy((err) => {
          if (err) {
            logger.warn('Error disconnecting from Snowflake', err);
          } else {
            logger.debug('Disconnected from Snowflake database');
          }
          this.connection = null;
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async getAllTableMetadata(schemas?: string[], excludeTables?: string[]): Promise<any[]> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    try {
      // Build schema filter
      const schemaFilter = schemas && schemas.length > 0
        ? `AND TABLE_SCHEMA IN (${schemas.map(s => `'${s}'`).join(', ')})`
        : '';

      // Build exclude filter
      const excludeFilter = excludeTables && excludeTables.length > 0
        ? `AND TABLE_NAME NOT IN (${excludeTables.map(t => `'${t}'`).join(', ')})`
        : '';

      // Query for tables
      const tablesQuery = `
        SELECT
          TABLE_CATALOG,
          TABLE_SCHEMA,
          TABLE_NAME,
          TABLE_TYPE,
          ROW_COUNT,
          COMMENT,
          CREATED,
          LAST_ALTERED
        FROM INFORMATION_SCHEMA.TABLES
        WHERE TABLE_TYPE = 'BASE TABLE'
          ${schemaFilter}
          ${excludeFilter}
        ORDER BY TABLE_SCHEMA, TABLE_NAME
      `;

      const tables = await this.executeQuery(tablesQuery);

      // Get detailed metadata for each table
      const tablesWithMetadata = [];

      for (const table of tables) {
        try {
          const metadata = await this.getTableMetadata(table.TABLE_SCHEMA, table.TABLE_NAME);
          tablesWithMetadata.push({
            table_schema: table.TABLE_SCHEMA,
            table_name: table.TABLE_NAME,
            table_type: table.TABLE_TYPE,
            comment: table.COMMENT,
            row_count: table.ROW_COUNT,
            ...metadata,
          });
        } catch (error) {
          logger.warn(`Failed to get metadata for table ${table.TABLE_SCHEMA}.${table.TABLE_NAME}`, error);
          tablesWithMetadata.push({
            table_schema: table.TABLE_SCHEMA,
            table_name: table.TABLE_NAME,
            table_type: table.TABLE_TYPE,
            comment: table.COMMENT,
            row_count: table.ROW_COUNT,
          });
        }
      }

      return tablesWithMetadata;

    } catch (error) {
      logger.error('Failed to get table metadata', error);
      throw error;
    }
  }

  async getRelationships(_tableMetadata: any[]): Promise<any[]> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    try {
      const relationships: any[] = [];
      const seenConstraints = new Set<string>();

      // Get outgoing foreign key relationships using SHOW IMPORTED KEYS
      // (tables that THIS database references)
      try {
        const importedKeysResult = await this.executeQuery('SHOW IMPORTED KEYS');
        for (const fk of importedKeysResult) {
          const constraintKey = `${fk.fk_name}:${fk.fk_table_name}:${fk.pk_table_name}`;
          if (!seenConstraints.has(constraintKey)) {
            seenConstraints.add(constraintKey);
            relationships.push({
              source_table: `${fk.fk_database_name}.${fk.fk_schema_name}.${fk.fk_table_name}`,
              source_column: fk.fk_column_name,
              target_table: `${fk.pk_database_name}.${fk.pk_schema_name}.${fk.pk_table_name}`,
              target_column: fk.pk_column_name,
              relationship_type: 'foreign_key',
              constraint_name: fk.fk_name,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to get imported keys (outgoing FKs)', error);
      }

      // Get incoming foreign key relationships using SHOW EXPORTED KEYS
      // (tables that REFERENCE this database's tables)
      try {
        const exportedKeysResult = await this.executeQuery('SHOW EXPORTED KEYS');
        for (const fk of exportedKeysResult) {
          const constraintKey = `${fk.fk_name}:${fk.fk_table_name}:${fk.pk_table_name}`;
          if (!seenConstraints.has(constraintKey)) {
            seenConstraints.add(constraintKey);
            relationships.push({
              source_table: `${fk.fk_database_name}.${fk.fk_schema_name}.${fk.fk_table_name}`,
              source_column: fk.fk_column_name,
              target_table: `${fk.pk_database_name}.${fk.pk_schema_name}.${fk.pk_table_name}`,
              target_column: fk.pk_column_name,
              relationship_type: 'foreign_key',
              constraint_name: fk.fk_name,
            });
          }
        }
      } catch (error) {
        logger.warn('Failed to get exported keys (incoming FKs)', error);
      }

      return relationships;

    } catch (error) {
      logger.error('Failed to get relationships', error);
      throw error;
    }
  }

  async query(sql: string): Promise<any[]> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    try {
      return await this.executeQuery(sql);
    } catch (error) {
      logger.error('Query failed', error);
      throw error;
    }
  }

  /**
   * Execute SQL query and return results
   */
  private async executeQuery(sql: string): Promise<any[]> {
    return new Promise((resolve, reject) => {
      if (!this.connection) {
        reject(new Error('Not connected to database'));
        return;
      }

      this.connection.execute({
        sqlText: sql,
        complete: (err, _stmt, rows) => {
          if (err) {
            reject(err);
          } else {
            resolve(rows || []);
          }
        }
      });
    });
  }

  /**
   * Get detailed metadata for a specific table
   */
  public async getTableMetadata(schema: string, table: string): Promise<any> {
    if (!this.connection) {
      throw new Error('Not connected to database');
    }

    // Get columns
    const columnsQuery = `
      SELECT
        COLUMN_NAME,
        ORDINAL_POSITION,
        DATA_TYPE,
        IS_NULLABLE,
        COLUMN_DEFAULT,
        CHARACTER_MAXIMUM_LENGTH,
        NUMERIC_PRECISION,
        NUMERIC_SCALE,
        COMMENT
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = '${schema}' AND TABLE_NAME = '${table}'
      ORDER BY ORDINAL_POSITION
    `;

    const rawColumns = await this.executeQuery(columnsQuery);
    
    // Normalize Snowflake's UPPERCASE column names to lowercase for consistency with PostgreSQL
    const columns = rawColumns.map(col => ({
      column_name: col.COLUMN_NAME,
      ordinal_position: col.ORDINAL_POSITION,
      data_type: col.DATA_TYPE,
      is_nullable: col.IS_NULLABLE,
      column_default: col.COLUMN_DEFAULT,
      character_maximum_length: col.CHARACTER_MAXIMUM_LENGTH,
      numeric_precision: col.NUMERIC_PRECISION,
      numeric_scale: col.NUMERIC_SCALE,
      comment: col.COMMENT,
    }));

    // Get primary keys using SHOW PRIMARY KEYS
    let primaryKey: string[] = [];
    try {
      const pkCommand = `SHOW PRIMARY KEYS IN TABLE ${schema}.${table}`;
      const pkResult = await this.executeQuery(pkCommand);
      primaryKey = pkResult.map(row => row.column_name || row.COLUMN_NAME);
    } catch (error) {
      logger.warn(`Failed to get primary key for ${schema}.${table}`, error);
    }

    // Foreign keys already handled in getRelationships()

    // Snowflake doesn't expose traditional indexes in INFORMATION_SCHEMA
    // Clustering information might be available via SHOW TABLES
    const indexes: any[] = [];

    return {
      columns,
      primary_key: primaryKey,
      foreign_keys: [], // Will be populated by getRelationships
      indexes,
    };
  }
}
/**
 * Agent 3: Index Retrieval
 *
 * Handles search queries and performs hybrid search combining FTS5 and vector similarity.
 * Provides functions for external MCP tools to call for context retrieval.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { HybridSearch } from './search/hybrid-search.js';

// Function signatures for external MCP tool consumption
export interface SearchTablesParams {
  query: string;
  database?: string;
  domain?: string;
  limit?: number;
}

export interface GetTableSchemaParams {
  table: string;
  include_samples?: boolean;
}

export interface GetJoinPathParams {
  source_table: string;
  target_table: string;
  max_hops?: number;
}

export interface GetDomainOverviewParams {
  domain: string;
  database?: string;
}

export interface ListDomainsParams {
  database?: string;
}

export interface GetCommonRelationshipsParams {
  database?: string;
  domain?: string;
  limit?: number;
}

// Response schemas
const SearchTablesResponseSchema = z.object({
  tables: z.array(z.object({
    name: z.string(),
    database: z.string(),
    domain: z.string(),
    summary: z.string(),
    key_columns: z.array(z.string()),
    relevance_score: z.number(),
  })),
  tokens_used: z.number(),
  total_matches: z.number(),
});

const GetTableSchemaResponseSchema = z.object({
  name: z.string(),
  database: z.string(),
  schema: z.string(),
  description: z.string(),
  row_count: z.number(),
  columns: z.array(z.object({
    name: z.string(),
    type: z.string(),
    nullable: z.boolean(),
    description: z.string(),
    samples: z.array(z.string()).optional(),
  })),
  primary_key: z.array(z.string()),
  foreign_keys: z.array(z.any()),
  indexes: z.array(z.any()),
  related_tables: z.array(z.string()),
  tokens_used: z.number(),
});

const GetJoinPathResponseSchema = z.object({
  source: z.string(),
  target: z.string(),
  found: z.boolean(),
  hop_count: z.number(),
  path: z.array(z.any()),
  sql_snippet: z.string(),
  tokens_used: z.number(),
});

const GetDomainOverviewResponseSchema = z.object({
  domain: z.string(),
  description: z.string(),
  databases: z.array(z.string()),
  tables: z.array(z.object({
    name: z.string(),
    description: z.string(),
    row_count: z.number(),
  })),
  er_diagram: z.string(),
  common_joins: z.array(z.any()),
  tokens_used: z.number(),
});

const ListDomainsResponseSchema = z.object({
  domains: z.array(z.object({
    name: z.string(),
    description: z.string(),
    table_count: z.number(),
    databases: z.array(z.string()),
  })),
  tokens_used: z.number(),
});

const GetCommonRelationshipsResponseSchema = z.object({
  relationships: z.array(z.object({
    source_table: z.string(),
    target_table: z.string(),
    join_sql: z.string(),
    description: z.string(),
  })),
  tokens_used: z.number(),
});

// Retrieval Function Implementations

/**
 * Search for tables using natural language query
 */
export async function searchTables(params: SearchTablesParams): Promise<z.infer<typeof SearchTablesResponseSchema>> {
  const db = await getDatabaseConnection();
  const search = new HybridSearch(db);

  try {
    // Query understanding (optional)
    const queryAnalysis = await analyzeQuery(params.query);

    // Perform hybrid search
    const results = await search.searchTables({
      query: params.query,
      queryAnalysis,
      database: params.database,
      domain: params.domain,
      limit: params.limit || 5,
    });

    // Compress results to fit context budget
    const compressed = await compressResults(results, 1500); // 1500 tokens budget

    return SearchTablesResponseSchema.parse({
      tables: compressed.results,
      tokens_used: compressed.tokensUsed,
      total_matches: results.length,
    });

  } finally {
    db.close();
  }
}

/**
 * Get full schema details for a specific table
 */
export async function getTableSchema(params: GetTableSchemaParams): Promise<z.infer<typeof GetTableSchemaResponseSchema>> {
  const db = await getDatabaseConnection();

  try {
    const tableId = parseTableIdentifier(params.table);
    const schema = await loadTableSchema(db, tableId, params.include_samples);

    return GetTableSchemaResponseSchema.parse({
      ...schema,
      tokens_used: estimateTokens(schema),
    });

  } finally {
    db.close();
  }
}

/**
 * Find join path between two tables
 */
export async function getJoinPath(params: GetJoinPathParams): Promise<z.infer<typeof GetJoinPathResponseSchema>> {
  const db = await getDatabaseConnection();

  try {
    const sourceId = parseTableIdentifier(params.source_table);
    const targetId = parseTableIdentifier(params.target_table);

    const path = await findJoinPath(db, sourceId, targetId, params.max_hops || 3);

    return GetJoinPathResponseSchema.parse({
      source: params.source_table,
      target: params.target_table,
      found: path.found,
      hop_count: path.hopCount,
      path: path.path,
      sql_snippet: path.sqlSnippet,
      tokens_used: estimateTokens(path),
    });

  } finally {
    db.close();
  }
}

/**
 * Get overview of all tables in a business domain
 */
export async function getDomainOverview(params: GetDomainOverviewParams): Promise<z.infer<typeof GetDomainOverviewResponseSchema>> {
  const db = await getDatabaseConnection();

  try {
    const overview = await loadDomainOverview(db, params.domain, params.database);

    return GetDomainOverviewResponseSchema.parse({
      ...overview,
      tokens_used: estimateTokens(overview),
    });

  } finally {
    db.close();
  }
}

/**
 * List all available business domains
 */
export async function listDomains(params: ListDomainsParams = {}): Promise<z.infer<typeof ListDomainsResponseSchema>> {
  const db = await getDatabaseConnection();

  try {
    const domains = await loadDomainsList(db, params.database);

    return ListDomainsResponseSchema.parse({
      domains,
      tokens_used: estimateTokens(domains),
    });

  } finally {
    db.close();
  }
}

/**
 * Get commonly used join patterns
 */
export async function getCommonRelationships(params: GetCommonRelationshipsParams = {}): Promise<z.infer<typeof GetCommonRelationshipsResponseSchema>> {
  const db = await getDatabaseConnection();

  try {
    const relationships = await loadCommonRelationships(db, params.database, params.domain, params.limit || 10);

    return GetCommonRelationshipsResponseSchema.parse({
      relationships,
      tokens_used: estimateTokens(relationships),
    });

  } finally {
    db.close();
  }
}

// Helper functions

async function getDatabaseConnection(): Promise<DatabaseType> {
  const dbPath = path.join(process.cwd(), 'data', 'tribal-knowledge.db');
  const exists = await fs.access(dbPath).then(() => true).catch(() => false);

  if (!exists) {
    throw new Error('Database not found. Run indexing phase first.');
  }

  return new Database(dbPath, { readonly: true });
}

async function analyzeQuery(query: string): Promise<any> {
  // TODO: Implement query understanding using LLM
  // For now, return basic analysis
  return {
    concepts: [query],
    domain_hint: null,
    relationship_query: false,
    expanded_terms: [query],
  };
}

function parseTableIdentifier(tableId: string): any {
  // Parse "database.schema.table" format
  const parts = tableId.split('.');
  if (parts.length !== 3) {
    throw new Error('Table identifier must be in format: database.schema.table');
  }

  return {
    database: parts[0],
    schema: parts[1],
    table: parts[2],
  };
}

async function loadTableSchema(_db: DatabaseType, tableId: any, _includeSamples?: boolean): Promise<any> {
  // TODO: Implement table schema loading from database
  // For now, return mock data
  return {
    name: tableId.table,
    database: tableId.database,
    schema: tableId.schema,
    description: 'Mock table description',
    row_count: 1000,
    columns: [],
    primary_key: [],
    foreign_keys: [],
    indexes: [],
    related_tables: [],
  };
}

async function findJoinPath(_db: DatabaseType, _sourceId: any, _targetId: any, _maxHops: number): Promise<any> {
  // TODO: Implement join path finding using relationship graph
  // For now, return mock data
  return {
    found: true,
    hopCount: 1,
    path: [],
    sqlSnippet: 'SELECT * FROM source JOIN target ON source.id = target.source_id',
  };
}

async function loadDomainOverview(_db: DatabaseType, domain: string, _database?: string): Promise<any> {
  // TODO: Implement domain overview loading
  // For now, return mock data
  return {
    domain,
    description: `Tables related to ${domain}`,
    databases: [_database || 'default'],
    tables: [],
    er_diagram: '',
    common_joins: [],
  };
}

async function loadDomainsList(_db: DatabaseType, _database?: string): Promise<any[]> {
  // TODO: Implement domains list loading
  // For now, return mock data
  return [
    {
      name: 'customers',
      description: 'Customer-related tables',
      table_count: 5,
      databases: ['production'],
    },
  ];
}

async function loadCommonRelationships(_db: DatabaseType, _database?: string, _domain?: string, _limit?: number): Promise<any[]> {
  // TODO: Implement common relationships loading
  // For now, return mock data
  return [];
}

async function compressResults(results: any[], _tokenBudget: number): Promise<{ results: any[], tokensUsed: number }> {
  // TODO: Implement result compression to fit token budget
  // For now, return all results
  return {
    results,
    tokensUsed: 100, // Mock token count
  };
}

function estimateTokens(data: any): number {
  // Rough token estimation
  const jsonString = JSON.stringify(data);
  return Math.ceil(jsonString.length / 4); // ~4 chars per token
}
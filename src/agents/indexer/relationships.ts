/**
 * Relationships Module
 *
 * Builds the relationships index from foreign keys and computes
 * multi-hop join paths using BFS.
 */

import { Database as DatabaseType } from 'better-sqlite3';
import { DirectRelationship, PathHop, JoinPath } from './types.js';
import { parseRelationshipFromContent } from './parsers/documents.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Main Relationship Index Builder
// =============================================================================

/**
 * Build relationships index from parsed table documents
 * Extracts FK relationships and computes multi-hop paths
 */
export async function buildRelationshipsIndex(db: DatabaseType): Promise<void> {
  logger.info('Building relationships index');

  // 1. Extract foreign keys from parsed table documents
  await indexForeignKeysFromTables(db);

  // 2. Index explicit relationship documentation files
  await indexExplicitRelationshipDocs(db);

  // 3. Compute multi-hop join paths using BFS
  await computeMultiHopPaths(db);

  const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };
  logger.info(`Relationships index built: ${relCount.count} relationships`);
}

// =============================================================================
// Foreign Key Extraction from Tables
// =============================================================================

/**
 * Extract and index foreign keys from table document content
 */
async function indexForeignKeysFromTables(db: DatabaseType): Promise<void> {
  // Query all table documents
  const tableQuery = db.prepare(`
    SELECT database_name, schema_name, table_name, content
    FROM documents
    WHERE doc_type = 'table'
  `);

  const insertRel = db.prepare(`
    INSERT OR IGNORE INTO relationships (
      database_name, source_schema, source_table, source_column,
      target_schema, target_table, target_column,
      relationship_type, hop_count, join_sql, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const tables = tableQuery.all() as {
    database_name: string;
    schema_name: string;
    table_name: string;
    content: string;
  }[];

  let count = 0;

  db.transaction(() => {
    for (const table of tables) {
      const foreignKeys = extractForeignKeysFromContent(table.content);

      for (const fk of foreignKeys) {
        const joinSql = generateJoinSQL(
          table.schema_name || 'public',
          table.table_name,
          fk.sourceColumn,
          fk.targetSchema,
          fk.targetTable,
          fk.targetColumn
        );

        insertRel.run(
          table.database_name,
          table.schema_name || 'public',
          table.table_name,
          fk.sourceColumn,
          fk.targetSchema,
          fk.targetTable,
          fk.targetColumn,
          'foreign_key',
          1,  // Direct relationship = 1 hop
          joinSql,
          1.0  // High confidence for explicit FK
        );

        count++;
      }
    }
  })();

  logger.debug(`Indexed ${count} foreign key relationships from tables`);
}

/**
 * Extract foreign key references from document content
 */
function extractForeignKeysFromContent(content: string): Array<{
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
}> {
  const foreignKeys: Array<{
    sourceColumn: string;
    targetSchema: string;
    targetTable: string;
    targetColumn: string;
  }> = [];

  // Look for patterns like:
  // - `customer_id` → `customers.id` (Markdown format from TableDocumenter)
  // - customer_id -> customers.id
  // - customer_id references customers(id)
  // - FK: customer_id -> schema.table.column
  // - **Foreign Key**: References table.column
  const patterns = [
    // Markdown format: `col` → `table.col` or `col` → `schema.table.col` (Unicode arrow)
    /`(\w+)`\s*→\s*`(?:(\w+)\.)?(\w+)\.(\w+)`/g,
    // ASCII arrow variants
    /`(\w+)`\s*->\s*`(?:(\w+)\.)?(\w+)\.(\w+)`/g,
    /(\w+)\s*→\s*(?:(\w+)\.)?(\w+)\.(\w+)/g,  // col → [schema.]table.col
    /(\w+)\s*->\s*(?:(\w+)\.)?(\w+)\.(\w+)/g,  // col -> [schema.]table.col
    /(\w+)\s+references?\s+(?:(\w+)\.)?(\w+)\((\w+)\)/gi,  // col references [schema.]table(col)
    /FK:\s*(\w+)\s*->\s*(?:(\w+)\.)?(\w+)\.(\w+)/gi,  // FK: col -> [schema.]table.col
    /\*\*Foreign Key\*\*:\s*References?\s+(?:(\w+)\.)?(\w+)\.(\w+)/gi,  // Markdown FK
    /foreign key[^}]*?(\w+)[^}]*?references?\s+(?:(\w+)\.)?(\w+)\s*\((\w+)\)/gi,  // SQL-style
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      // Handle different capture group arrangements
      if (match[1] && match[3]) {
        foreignKeys.push({
          sourceColumn: match[1],
          targetSchema: match[2] || 'public',
          targetTable: match[3],
          targetColumn: match[4] || 'id',
        });
      }
    }
    // Reset regex lastIndex for reuse
    pattern.lastIndex = 0;
  }

  return foreignKeys;
}

// =============================================================================
// Explicit Relationship Documents
// =============================================================================

/**
 * Index explicit relationship documentation files
 * These are standalone markdown files in the relationships/ folder
 */
async function indexExplicitRelationshipDocs(db: DatabaseType): Promise<void> {
  // Query relationship type documents from the documents table
  const relDocsQuery = db.prepare(`
    SELECT id, database_name, content
    FROM documents
    WHERE doc_type = 'relationship'
  `);

  const insertRel = db.prepare(`
    INSERT OR IGNORE INTO relationships (
      database_name, source_schema, source_table, source_column,
      target_schema, target_table, target_column,
      relationship_type, hop_count, join_sql, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const relDocs = relDocsQuery.all() as {
    id: number;
    database_name: string;
    content: string;
  }[];

  let count = 0;

  db.transaction(() => {
    for (const relDoc of relDocs) {
      // Re-parse the content to extract relationship details
      const parsed = parseRelationshipFromContent(relDoc.content);

      if (parsed.sourceTable && parsed.targetTable) {
        const joinSql = generateJoinSQL(
          parsed.sourceSchema || 'public',
          parsed.sourceTable,
          parsed.sourceColumn || '',
          parsed.targetSchema || 'public',
          parsed.targetTable,
          parsed.targetColumn || ''
        );

        insertRel.run(
          relDoc.database_name,
          parsed.sourceSchema || 'public',
          parsed.sourceTable,
          parsed.sourceColumn || '',
          parsed.targetSchema || 'public',
          parsed.targetTable,
          parsed.targetColumn || '',
          parsed.relationshipType || 'documented',
          1,  // Direct relationship
          joinSql,
          0.9  // Slightly lower confidence for documented (vs FK constraint)
        );

        count++;
        logger.debug(`Indexed explicit relationship: ${parsed.sourceTable} -> ${parsed.targetTable}`);
      }
    }
  })();

  logger.debug(`Indexed ${count} explicit relationship documents`);
}

// =============================================================================
// Multi-Hop Path Computation
// =============================================================================

/**
 * Compute multi-hop join paths using BFS
 */
export async function computeMultiHopPaths(db: DatabaseType, maxHops: number = 3): Promise<void> {
  // Build adjacency list from direct relationships
  const directRels = db.prepare(`
    SELECT database_name, source_schema, source_table, source_column,
           target_schema, target_table, target_column, join_sql
    FROM relationships
    WHERE hop_count = 1
  `).all() as DirectRelationship[];

  if (directRels.length === 0) {
    logger.debug('No direct relationships found, skipping multi-hop computation');
    return;
  }

  const graph = buildAdjacencyGraph(directRels);

  // Get all unique tables
  const allTables = new Set<string>();
  directRels.forEach(r => {
    allTables.add(`${r.source_schema}.${r.source_table}`);
    allTables.add(`${r.target_schema}.${r.target_table}`);
  });

  // Get database name (assume single database for now)
  const databaseName = directRels[0]?.database_name || 'unknown';

  const insertPath = db.prepare(`
    INSERT OR IGNORE INTO relationships (
      database_name, source_schema, source_table, source_column,
      target_schema, target_table, target_column,
      relationship_type, hop_count, join_sql, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'computed', ?, ?, ?)
  `);

  let pathCount = 0;

  db.transaction(() => {
    for (const source of allTables) {
      for (const target of allTables) {
        if (source === target) continue;

        const path = bfsShortestPath(graph, source, target, maxHops);
        if (path && path.hops.length > 1) {  // Multi-hop path found
          const joinSql = generateMultiHopJoinSQL(path);
          const confidence = computePathConfidence(path);

          const [sourceSchema, sourceTable] = source.split('.');
          const [targetSchema, targetTable] = target.split('.');

          insertPath.run(
            databaseName,
            sourceSchema,
            sourceTable,
            path.hops[0].sourceColumn,        // First hop's source column
            targetSchema,
            targetTable,
            path.hops[path.hops.length - 1].targetColumn,  // Last hop's target column
            path.hops.length,                 // hop_count
            joinSql,
            confidence
          );

          pathCount++;
        }
      }
    }
  })();

  logger.debug(`Computed ${pathCount} multi-hop paths`);
}

// =============================================================================
// Graph Building
// =============================================================================

/**
 * Build an adjacency graph from direct relationships
 */
function buildAdjacencyGraph(relationships: DirectRelationship[]): Map<string, PathHop[]> {
  const graph = new Map<string, PathHop[]>();

  for (const rel of relationships) {
    const sourceKey = `${rel.source_schema}.${rel.source_table}`;

    if (!graph.has(sourceKey)) {
      graph.set(sourceKey, []);
    }

    graph.get(sourceKey)!.push({
      sourceSchema: rel.source_schema,
      sourceTable: rel.source_table,
      sourceColumn: rel.source_column,
      targetSchema: rel.target_schema,
      targetTable: rel.target_table,
      targetColumn: rel.target_column,
      joinSql: rel.join_sql,
    });

    // Also add reverse edge for bidirectional navigation
    const targetKey = `${rel.target_schema}.${rel.target_table}`;
    if (!graph.has(targetKey)) {
      graph.set(targetKey, []);
    }

    graph.get(targetKey)!.push({
      sourceSchema: rel.target_schema,
      sourceTable: rel.target_table,
      sourceColumn: rel.target_column,
      targetSchema: rel.source_schema,
      targetTable: rel.source_table,
      targetColumn: rel.source_column,
      joinSql: generateJoinSQL(
        rel.target_schema,
        rel.target_table,
        rel.target_column,
        rel.source_schema,
        rel.source_table,
        rel.source_column
      ),
    });
  }

  return graph;
}

// =============================================================================
// BFS Path Finding
// =============================================================================

/**
 * BFS to find shortest path between two tables
 */
function bfsShortestPath(
  graph: Map<string, PathHop[]>,
  source: string,
  target: string,
  maxHops: number
): JoinPath | null {
  const queue: { table: string; path: PathHop[] }[] = [{ table: source, path: [] }];
  const visited = new Set<string>([source]);

  while (queue.length > 0) {
    const { table, path } = queue.shift()!;

    if (path.length >= maxHops) continue;

    const edges = graph.get(table) || [];

    for (const edge of edges) {
      const nextTable = `${edge.targetSchema}.${edge.targetTable}`;

      if (nextTable === target) {
        // Found path to target
        return {
          hops: [...path, edge],
          tables: [source, ...path.map(h => `${h.targetSchema}.${h.targetTable}`), target],
        };
      }

      if (!visited.has(nextTable)) {
        visited.add(nextTable);
        queue.push({
          table: nextTable,
          path: [...path, edge],
        });
      }
    }
  }

  return null;  // No path found within maxHops
}

// =============================================================================
// SQL Generation
// =============================================================================

/**
 * Generate JOIN SQL for a single hop
 */
function generateJoinSQL(
  sourceSchema: string,
  sourceTable: string,
  sourceColumn: string,
  targetSchema: string,
  targetTable: string,
  targetColumn: string
): string {
  if (!sourceColumn || !targetColumn) {
    return `${sourceSchema}.${sourceTable} JOIN ${targetSchema}.${targetTable}`;
  }

  return `${sourceSchema}.${sourceTable}.${sourceColumn} = ${targetSchema}.${targetTable}.${targetColumn}`;
}

/**
 * Generate complete JOIN SQL for multi-hop path
 */
function generateMultiHopJoinSQL(path: JoinPath): string {
  if (path.hops.length === 0) return '';

  const joins: string[] = [];

  for (let i = 0; i < path.hops.length; i++) {
    const hop = path.hops[i];
    const joinType = 'LEFT JOIN';  // Default to LEFT JOIN for flexibility

    if (i === 0) {
      // First table in path
      joins.push(`FROM ${hop.sourceSchema}.${hop.sourceTable}`);
    }

    joins.push(
      `${joinType} ${hop.targetSchema}.${hop.targetTable} ON ` +
      `${hop.sourceSchema}.${hop.sourceTable}.${hop.sourceColumn} = ` +
      `${hop.targetSchema}.${hop.targetTable}.${hop.targetColumn}`
    );
  }

  return joins.join('\n');
}

/**
 * Compute confidence score for a join path
 * - Direct FK relationships: 1.0
 * - Each additional hop reduces confidence
 * - Implied relationships have lower base confidence
 */
function computePathConfidence(path: JoinPath): number {
  const baseConfidence = 1.0;
  const hopPenalty = 0.15;  // Each hop reduces confidence by 15%

  return Math.max(0.1, baseConfidence - (path.hops.length - 1) * hopPenalty);
}

// =============================================================================
// Relationship Info Extraction (for cascade deletion)
// =============================================================================

/**
 * Extract relationship source/target info from a relationship document
 * Used by cascade deletion to remove the corresponding relationships record
 */
export function extractRelationshipInfoFromDoc(
  db: DatabaseType,
  docId: number
): { sourceTable: string; targetTable: string; sourceSchema?: string; targetSchema?: string } | null {
  // Query the document content from the database
  const contentQuery = db.prepare('SELECT content FROM documents WHERE id = ?');
  const row = contentQuery.get(docId) as { content: string } | undefined;

  if (!row?.content) return null;

  // Use the same parser that indexes relationship docs
  const parsed = parseRelationshipFromContent(row.content);

  if (parsed.sourceTable && parsed.targetTable) {
    return {
      sourceTable: parsed.sourceTable,
      targetTable: parsed.targetTable,
      sourceSchema: parsed.sourceSchema,
      targetSchema: parsed.targetSchema,
    };
  }

  return null;
}

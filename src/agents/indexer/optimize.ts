/**
 * Database Optimization Module
 *
 * Handles database optimization, metadata persistence, and index health checks.
 */

import { Database as DatabaseType } from 'better-sqlite3';
import { DocumentationManifest } from './types.js';
import { computeStableManifestHash } from './manifest.js';
import { getEmbeddingModel, getEmbeddingDimensions } from './embeddings.js';
import { setMetadata, getMetadata } from './database/init.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Database Optimization
// =============================================================================

/**
 * Optimize database after indexing
 * - Optimize FTS5 index
 * - Run ANALYZE for query optimization
 * - VACUUM for space optimization
 * - Update index metadata
 */
export async function optimizeDatabase(
  db: DatabaseType,
  manifest: DocumentationManifest
): Promise<void> {
  logger.info('Optimizing database...');

  // 1. Optimize FTS5 index
  try {
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES('optimize')");
    logger.debug('FTS5 index optimized');
  } catch (error) {
    logger.warn('FTS5 optimization failed', error);
  }

  // 2. Update statistics for query planner
  db.exec('ANALYZE');
  logger.debug('Query statistics updated');

  // 3. Reclaim space
  db.exec('VACUUM');
  logger.debug('Database vacuumed');

  // 4. Update index metadata
  await updateIndexMetadata(db, manifest);

  logger.info('Database optimization complete');
}

// =============================================================================
// Index Metadata
// =============================================================================

/**
 * Update index metadata after indexing
 */
export async function updateIndexMetadata(
  db: DatabaseType,
  manifest: DocumentationManifest
): Promise<void> {
  // Gather counts by doc type
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
  const embCount = db.prepare('SELECT COUNT(*) as count FROM documents_vec').get() as { count: number };
  const tableCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'table'").get() as { count: number };
  const columnCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'column'").get() as { count: number };
  const domainCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'domain'").get() as { count: number };
  const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };
  const overviewCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'overview'").get() as { count: number };
  const relDocCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'relationship'").get() as { count: number };

  db.transaction(() => {
    // Timestamps
    setMetadata(db, 'last_full_index', new Date().toISOString());
    setMetadata(db, 'index_version', '1.0');

    // Provenance hashes (CRITICAL for staleness detection)
    setMetadata(db, 'manifest_hash', computeStableManifestHash(manifest));
    setMetadata(db, 'plan_hash', manifest.plan_hash);

    // Counts
    setMetadata(db, 'document_count', String(docCount.count));
    setMetadata(db, 'embedding_count', String(embCount.count));
    setMetadata(db, 'table_count', String(tableCount.count));
    setMetadata(db, 'column_count', String(columnCount.count));
    setMetadata(db, 'domain_count', String(domainCount.count));
    setMetadata(db, 'overview_count', String(overviewCount.count));
    setMetadata(db, 'relationship_doc_count', String(relDocCount.count));
    setMetadata(db, 'relationship_count', String(relCount.count));

    // Embedding config
    setMetadata(db, 'embedding_model', getEmbeddingModel());
    setMetadata(db, 'embedding_dimensions', String(getEmbeddingDimensions()));
  })();

  logger.info(`Index metadata updated: ${docCount.count} docs, ${embCount.count} embeddings, ${relCount.count} relationships`);
}

// =============================================================================
// Index Health Checks
// =============================================================================

/**
 * Check if the index is stale (manifest changed since last index)
 */
export function isIndexStale(db: DatabaseType, manifest: DocumentationManifest): boolean {
  const storedHash = getMetadata(db, 'manifest_hash');
  if (!storedHash) {
    return true;  // No stored hash means index never populated
  }

  const currentHash = computeStableManifestHash(manifest);
  return storedHash !== currentHash;
}

/**
 * Get index statistics
 */
export function getIndexStats(db: DatabaseType): {
  documentCount: number;
  embeddingCount: number;
  tableDocs: number;
  columnDocs: number;
  domainDocs: number;
  overviewDocs: number;
  relationshipDocs: number;
  relationships: number;
  lastIndexed: string | null;
  manifestHash: string | null;
  embeddingModel: string | null;
} {
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
  const embCount = db.prepare('SELECT COUNT(*) as count FROM documents_vec').get() as { count: number };
  const tableCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'table'").get() as { count: number };
  const columnCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'column'").get() as { count: number };
  const domainCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'domain'").get() as { count: number };
  const overviewCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'overview'").get() as { count: number };
  const relDocCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'relationship'").get() as { count: number };
  const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };

  return {
    documentCount: docCount.count,
    embeddingCount: embCount.count,
    tableDocs: tableCount.count,
    columnDocs: columnCount.count,
    domainDocs: domainCount.count,
    overviewDocs: overviewCount.count,
    relationshipDocs: relDocCount.count,
    relationships: relCount.count,
    lastIndexed: getMetadata(db, 'last_full_index'),
    manifestHash: getMetadata(db, 'manifest_hash'),
    embeddingModel: getMetadata(db, 'embedding_model'),
  };
}

/**
 * Verify index integrity
 * Returns list of issues found
 */
export function verifyIndexIntegrity(db: DatabaseType): string[] {
  const issues: string[] = [];

  // Check for orphaned vectors
  const orphanedVecs = db.prepare(`
    SELECT COUNT(*) as count FROM documents_vec
    WHERE id NOT IN (SELECT id FROM documents)
  `).get() as { count: number };

  if (orphanedVecs.count > 0) {
    issues.push(`${orphanedVecs.count} orphaned vector embeddings`);
  }

  // Check for orphaned column documents
  const orphanedCols = db.prepare(`
    SELECT COUNT(*) as count FROM documents
    WHERE doc_type = 'column'
    AND parent_doc_id IS NOT NULL
    AND parent_doc_id NOT IN (SELECT id FROM documents WHERE doc_type = 'table')
  `).get() as { count: number };

  if (orphanedCols.count > 0) {
    issues.push(`${orphanedCols.count} orphaned column documents`);
  }

  // Check for documents without embeddings
  const docsWithoutEmb = db.prepare(`
    SELECT COUNT(*) as count FROM documents
    WHERE id NOT IN (SELECT id FROM documents_vec)
  `).get() as { count: number };

  if (docsWithoutEmb.count > 0) {
    issues.push(`${docsWithoutEmb.count} documents without embeddings`);
  }

  // Check FTS sync
  const ftsMismatch = db.prepare(`
    SELECT COUNT(*) as count FROM documents d
    LEFT JOIN documents_fts f ON d.id = f.rowid
    WHERE f.rowid IS NULL
  `).get() as { count: number };

  if (ftsMismatch.count > 0) {
    issues.push(`${ftsMismatch.count} documents not in FTS index`);
  }

  // Check for stale relationships
  const staleRels = db.prepare(`
    SELECT COUNT(*) as count FROM relationships r
    WHERE NOT EXISTS (
      SELECT 1 FROM documents d
      WHERE d.doc_type = 'table'
      AND d.database_name = r.database_name
      AND d.schema_name = r.source_schema
      AND d.table_name = r.source_table
    )
  `).get() as { count: number };

  if (staleRels.count > 0) {
    issues.push(`${staleRels.count} relationships with missing source tables`);
  }

  return issues;
}

/**
 * Rebuild FTS index from scratch
 * Use this if FTS gets out of sync
 */
export function rebuildFTSIndex(db: DatabaseType): void {
  logger.info('Rebuilding FTS index...');

  db.transaction(() => {
    // Delete all FTS entries
    db.exec("DELETE FROM documents_fts");

    // Repopulate from documents table
    db.exec(`
      INSERT INTO documents_fts(rowid, content, summary, keywords)
      SELECT id, content, summary, keywords FROM documents
    `);

    // Optimize
    db.exec("INSERT INTO documents_fts(documents_fts) VALUES('optimize')");
  })();

  logger.info('FTS index rebuilt');
}

/**
 * Format index stats for display
 */
export function formatIndexStats(stats: ReturnType<typeof getIndexStats>): string {
  const lines = [
    '=== Index Statistics ===',
    `Total Documents: ${stats.documentCount}`,
    `  - Tables: ${stats.tableDocs}`,
    `  - Columns: ${stats.columnDocs}`,
    `  - Domains: ${stats.domainDocs}`,
    `  - Overviews: ${stats.overviewDocs}`,
    `  - Relationship Docs: ${stats.relationshipDocs}`,
    `Embeddings: ${stats.embeddingCount}`,
    `Relationships: ${stats.relationships}`,
    `Last Indexed: ${stats.lastIndexed || 'Never'}`,
    `Embedding Model: ${stats.embeddingModel || 'None'}`,
  ];

  return lines.join('\n');
}

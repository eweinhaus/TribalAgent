/**
 * Incremental Indexing Module
 *
 * Supports incremental updates through content hash comparison.
 * Handles change detection, selective re-indexing, and cascade deletion.
 */

import { Database as DatabaseType } from 'better-sqlite3';
import {
  DocumentationManifest,
  IncrementalIndexResult,
  IndexableFile,
} from './types.js';
import { extractRelationshipInfoFromDoc } from './relationships.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Change Detection
// =============================================================================

/**
 * Detect changes between manifest and current index
 */
export async function detectChanges(
  manifest: DocumentationManifest,
  db: DatabaseType
): Promise<IncrementalIndexResult> {
  const result: IncrementalIndexResult = {
    newFiles: [],
    changedFiles: [],
    unchangedFiles: [],
    deletedFiles: [],
  };

  // Get existing indexed files (only non-column docs - columns are derived)
  const existingFiles = new Map<string, string>();
  const rows = db.prepare(`
    SELECT file_path, content_hash
    FROM documents
    WHERE doc_type != 'column' AND file_path NOT LIKE '%#%'
  `).all() as { file_path: string; content_hash: string }[];

  rows.forEach(row => existingFiles.set(row.file_path, row.content_hash));

  // Compare with manifest
  const manifestFiles = new Set<string>();

  for (const file of manifest.indexable_files) {
    manifestFiles.add(file.path);

    const existingHash = existingFiles.get(file.path);

    if (!existingHash) {
      result.newFiles.push(file.path);
    } else if (existingHash !== file.content_hash) {
      result.changedFiles.push(file.path);
    } else {
      result.unchangedFiles.push(file.path);
    }
  }

  // Find deleted files (in DB but not in manifest)
  for (const [filePath] of existingFiles) {
    // Skip virtual paths (column docs)
    if (filePath.includes('#') || filePath.startsWith('virtual/')) continue;

    if (!manifestFiles.has(filePath)) {
      result.deletedFiles.push(filePath);
    }
  }

  return result;
}

/**
 * Get files that need processing (new + changed)
 */
export function getFilesToProcess(
  manifest: DocumentationManifest,
  changes: IncrementalIndexResult
): IndexableFile[] {
  const filePathsToProcess = [...changes.newFiles, ...changes.changedFiles];

  return manifest.indexable_files.filter(
    f => filePathsToProcess.includes(f.path)
  );
}

// =============================================================================
// Cascade Deletion
// =============================================================================

/**
 * Delete documents and cascade to related tables
 * Ensures no stale vectors or relationships remain after file deletion
 *
 * This is a PURE deletion helper - does not call indexFiles/optimizeDatabase
 * Those calls are made by the caller where the required args are in scope
 */
export async function deleteDocumentsWithCascade(
  db: DatabaseType,
  filePaths: string[]
): Promise<void> {
  if (filePaths.length === 0) return;

  logger.info(`Deleting ${filePaths.length} documents with cascade`);

  // Prepare statements
  const getIdStmt = db.prepare(`
    SELECT id, doc_type, database_name, schema_name, table_name
    FROM documents
    WHERE file_path = ?
  `);

  const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');
  const deleteVecStmt = db.prepare('DELETE FROM documents_vec WHERE id = ?');
  const deleteChildDocsStmt = db.prepare('DELETE FROM documents WHERE parent_doc_id = ?');

  const getChildIdsStmt = db.prepare('SELECT id FROM documents WHERE parent_doc_id = ?');

  const deleteRelBySourceStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND source_schema = ? AND source_table = ?
  `);

  const deleteRelByTargetStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND target_schema = ? AND target_table = ?
  `);

  // For explicit relationship doc files
  const deleteRelDocStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND source_table = ? AND target_table = ?
  `);

  let deletedCount = 0;
  let childCount = 0;
  let relCount = 0;

  db.transaction(() => {
    for (const filePath of filePaths) {
      const doc = getIdStmt.get(filePath) as {
        id: number;
        doc_type: string;
        database_name: string;
        schema_name: string;
        table_name: string;
      } | undefined;

      if (!doc) {
        logger.debug(`Document not found for deletion: ${filePath}`);
        continue;
      }

      // 1. Delete vector embedding
      deleteVecStmt.run(doc.id);

      // 2. If table doc, delete child column docs and their vectors
      if (doc.doc_type === 'table') {
        // Get child doc IDs first to delete their vectors
        const childDocs = getChildIdsStmt.all(doc.id) as { id: number }[];
        for (const child of childDocs) {
          deleteVecStmt.run(child.id);
          childCount++;
        }
        deleteChildDocsStmt.run(doc.id);

        // 3. Delete relationships involving this table (as source or target)
        const srcResult = deleteRelBySourceStmt.run(doc.database_name, doc.schema_name, doc.table_name);
        const tgtResult = deleteRelByTargetStmt.run(doc.database_name, doc.schema_name, doc.table_name);
        relCount += srcResult.changes + tgtResult.changes;
      }

      // Handle explicit relationship doc type
      if (doc.doc_type === 'relationship') {
        // Extract source/target tables by re-parsing the document content
        const relInfo = extractRelationshipInfoFromDoc(db, doc.id);
        if (relInfo) {
          // Delete from relationships table using parsed source/target
          const result = deleteRelDocStmt.run(doc.database_name, relInfo.sourceTable, relInfo.targetTable);
          relCount += result.changes;
        }
      }

      // 4. Delete the document itself
      deleteDocStmt.run(doc.id);
      deletedCount++;

      logger.debug(`Deleted document: ${filePath}`);
    }
  })();

  logger.info(`Cascade delete complete: ${deletedCount} docs, ${childCount} children, ${relCount} relationships`);
}

// =============================================================================
// Stale Document Cleanup
// =============================================================================

/**
 * Clean up orphaned documents (documents without valid parent)
 */
export function cleanupOrphanedDocuments(db: DatabaseType): number {
  // Find column documents with invalid parent_doc_id
  const result = db.prepare(`
    DELETE FROM documents
    WHERE doc_type = 'column'
    AND parent_doc_id IS NOT NULL
    AND parent_doc_id NOT IN (SELECT id FROM documents WHERE doc_type = 'table')
  `).run();

  if (result.changes > 0) {
    logger.info(`Cleaned up ${result.changes} orphaned column documents`);
  }

  return result.changes;
}

/**
 * Clean up orphaned vectors (vectors without valid document)
 */
export function cleanupOrphanedVectors(db: DatabaseType): number {
  const result = db.prepare(`
    DELETE FROM documents_vec
    WHERE id NOT IN (SELECT id FROM documents)
  `).run();

  if (result.changes > 0) {
    logger.info(`Cleaned up ${result.changes} orphaned vectors`);
  }

  return result.changes;
}

/**
 * Clean up stale relationships (relationships for non-existent tables)
 */
export function cleanupStaleRelationships(db: DatabaseType): number {
  // Get all existing tables
  const existingTables = new Set<string>();
  const tables = db.prepare(`
    SELECT DISTINCT database_name, schema_name, table_name
    FROM documents
    WHERE doc_type = 'table'
  `).all() as { database_name: string; schema_name: string; table_name: string }[];

  for (const t of tables) {
    existingTables.add(`${t.database_name}.${t.schema_name}.${t.table_name}`);
  }

  // Find and delete relationships for non-existent tables
  const rels = db.prepare(`
    SELECT id, database_name, source_schema, source_table, target_schema, target_table
    FROM relationships
  `).all() as {
    id: number;
    database_name: string;
    source_schema: string;
    source_table: string;
    target_schema: string;
    target_table: string;
  }[];

  const deleteStmt = db.prepare('DELETE FROM relationships WHERE id = ?');
  let deletedCount = 0;

  db.transaction(() => {
    for (const rel of rels) {
      const sourceKey = `${rel.database_name}.${rel.source_schema}.${rel.source_table}`;
      const targetKey = `${rel.database_name}.${rel.target_schema}.${rel.target_table}`;

      if (!existingTables.has(sourceKey) || !existingTables.has(targetKey)) {
        deleteStmt.run(rel.id);
        deletedCount++;
      }
    }
  })();

  if (deletedCount > 0) {
    logger.info(`Cleaned up ${deletedCount} stale relationships`);
  }

  return deletedCount;
}

/**
 * Run all cleanup tasks
 */
export function runCleanup(db: DatabaseType): {
  orphanedDocs: number;
  orphanedVectors: number;
  staleRelationships: number;
} {
  return {
    orphanedDocs: cleanupOrphanedDocuments(db),
    orphanedVectors: cleanupOrphanedVectors(db),
    staleRelationships: cleanupStaleRelationships(db),
  };
}

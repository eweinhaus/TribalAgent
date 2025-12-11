/**
 * Index Population Module
 *
 * Handles inserting/updating documents in the SQLite database.
 * Includes document sorting for parent-child linkage and file path resolution.
 */

import { Database as DatabaseType } from 'better-sqlite3';
import type {
  ParsedDocument,
  ParsedTableDoc,
  ParsedColumnDoc,
  ParsedDomainDoc,
  ParsedOverviewDoc,
  ParsedRelationshipDoc,
  ProcessedDocument,
  IndexableFile,
  IndexStats,
} from './types.js';
import { float32ArrayToBlob } from './database/init.js';
import { computeSHA256 } from './manifest.js';
import { generateSummary } from './embeddings.js';
import { logger } from '../../utils/logger.js';

// =============================================================================
// Document Sorting
// =============================================================================

/**
 * Sort documents so table docs are indexed before their columns
 * This ensures parent_doc_id can be resolved correctly
 *
 * Order: tables -> domains -> overviews -> relationships -> columns
 */
export function sortDocumentsForIndexing(documents: ParsedDocument[]): ParsedDocument[] {
  const typeOrder: Record<string, number> = {
    table: 0,
    domain: 1,
    overview: 2,
    relationship: 3,
    column: 4,
  };

  return [...documents].sort((a, b) => {
    const orderA = typeOrder[a.docType] ?? 99;
    const orderB = typeOrder[b.docType] ?? 99;
    return orderA - orderB;
  });
}

// =============================================================================
// File Path Resolution
// =============================================================================

/**
 * Get file path for any document type with deterministic matching
 * CRITICAL: Must use exact matching on all identifying fields to ensure:
 * - Correct content_hash for change detection
 * - Correct parent_doc_id linkage for columns
 * - Correct cascade deletion
 */
export function getFilePathForDoc(doc: ParsedDocument, files: IndexableFile[]): string {
  if (doc.docType === 'column') {
    // Column docs don't have their own file - generate a virtual path
    const colDoc = doc as ParsedColumnDoc;
    return `${colDoc.parentTablePath}#${colDoc.column}`;
  }

  const file = files.find(f => {
    if (f.type !== doc.docType) return false;
    if (f.database !== doc.database) return false;

    switch (doc.docType) {
      case 'table': {
        const tableDoc = doc as ParsedTableDoc;
        // Parse schema.table from filename
        const fileName = f.path.split('/').pop()?.replace('.md', '') || '';
        const [fileSchema, ...tableNameParts] = fileName.split('.');
        const fileTable = tableNameParts.join('.');
        return fileSchema === tableDoc.schema && fileTable === tableDoc.table;
      }

      case 'domain': {
        const domainDoc = doc as ParsedDomainDoc;
        // Domain files: databases/{db}/domains/{domain}.md
        const fileName = f.path.split('/').pop()?.replace('.md', '') || '';
        return fileName === domainDoc.domain;
      }

      case 'relationship': {
        const relDoc = doc as ParsedRelationshipDoc;
        // Relationship files may use various naming conventions
        // Match on source + target tables in the path
        const fileName = f.path.split('/').pop()?.replace('.md', '') || '';
        // Try common patterns: source_to_target, source-target, etc.
        const normalizedName = fileName.toLowerCase().replace(/[-_]/g, '');
        const expectedPattern = `${relDoc.sourceTable}${relDoc.targetTable}`.toLowerCase();
        const reversePattern = `${relDoc.targetTable}${relDoc.sourceTable}`.toLowerCase();
        return normalizedName.includes(expectedPattern) || normalizedName.includes(reversePattern);
      }

      case 'overview': {
        // Overview files: databases/{db}/overview.md or similar
        // Usually one per database, so database match is sufficient
        return f.path.includes('/overview') || f.path.endsWith('overview.md');
      }

      default:
        return false;
    }
  });

  if (!file) {
    logger.warn(`No file found for ${doc.docType} in ${doc.database}`);
    // Return a deterministic path based on document identity (not timestamp)
    const identity = getDocumentIdentity(doc);
    return `virtual/${doc.docType}/${identity}.md`;
  }

  return file.path;
}

/**
 * Generate a deterministic identity string for a document
 * Used as fallback when no file match is found
 */
export function getDocumentIdentity(doc: ParsedDocument): string {
  switch (doc.docType) {
    case 'table': {
      const tableDoc = doc as ParsedTableDoc;
      return `${tableDoc.database}.${tableDoc.schema}.${tableDoc.table}`;
    }
    case 'column': {
      const colDoc = doc as ParsedColumnDoc;
      return `${colDoc.database}.${colDoc.schema}.${colDoc.table}.${colDoc.column}`;
    }
    case 'domain': {
      const domainDoc = doc as ParsedDomainDoc;
      return `${domainDoc.database}.${domainDoc.domain}`;
    }
    case 'relationship': {
      const relDoc = doc as ParsedRelationshipDoc;
      return `${relDoc.database}.${relDoc.sourceTable}_to_${relDoc.targetTable}`;
    }
    case 'overview': {
      const overDoc = doc as ParsedOverviewDoc;
      return `${overDoc.database}.overview`;
    }
    default:
      return 'unknown';
  }
}

/**
 * Build document identity from ProcessedDocument
 * Must match the format used in embeddings.ts getDocumentId()
 */
function buildDocumentIdentity(doc: ProcessedDocument): string {
  switch (doc.docType) {
    case 'table':
      return `${doc.database}.${doc.schema}.${doc.table}`;
    case 'column':
      return `${doc.database}.${doc.schema}.${doc.table}.${doc.column}`;
    case 'domain':
      return `${doc.database}.${doc.domain}`;
    case 'relationship':
      // For relationships, we need source_to_target format
      // But ProcessedDocument only has table (source), we'll try a pattern match
      return `${doc.database}.${doc.table}_to_`;  // Partial match
    case 'overview':
      return `${doc.database}.overview`;
    default:
      return 'unknown';
  }
}

/**
 * Find modified_at for a document with exact matching
 */
export function findModifiedAt(doc: ParsedDocument, files: IndexableFile[]): string {
  if (doc.docType === 'column') {
    // Use parent table's modified time
    const colDoc = doc as ParsedColumnDoc;
    const parentFile = files.find(f => f.path === colDoc.parentTablePath);
    return parentFile?.modified_at || new Date().toISOString();
  }

  // Use the same matching logic as getFilePathForDoc
  const filePath = getFilePathForDoc(doc, files);
  const file = files.find(f => f.path === filePath);
  return file?.modified_at || new Date().toISOString();
}

// =============================================================================
// Document Processing
// =============================================================================

/**
 * Convert parsed documents to processed documents ready for indexing
 */
export function processDocuments(
  documents: ParsedDocument[],
  files: IndexableFile[]
): ProcessedDocument[] {
  return documents.map(doc => {
    const filePath = getFilePathForDoc(doc, files);

    return {
      docType: doc.docType,
      database: doc.database,
      schema: getSchema(doc),
      table: getTable(doc),
      column: doc.docType === 'column' ? (doc as ParsedColumnDoc).column : undefined,
      domain: getDomain(doc),
      content: doc.rawContent,
      summary: generateSummary(doc),
      keywords: doc.keywords,
      filePath,
      contentHash: computeSHA256(doc.rawContent),
      modifiedAt: findModifiedAt(doc, files),
      parentTablePath: doc.docType === 'column' ? (doc as ParsedColumnDoc).parentTablePath : undefined,
    };
  });
}

function getSchema(doc: ParsedDocument): string | undefined {
  if (doc.docType === 'table') return (doc as ParsedTableDoc).schema;
  if (doc.docType === 'column') return (doc as ParsedColumnDoc).schema;
  if (doc.docType === 'relationship') return (doc as ParsedRelationshipDoc).sourceSchema;
  return undefined;
}

function getTable(doc: ParsedDocument): string | undefined {
  if (doc.docType === 'table') return (doc as ParsedTableDoc).table;
  if (doc.docType === 'column') return (doc as ParsedColumnDoc).table;
  if (doc.docType === 'relationship') return (doc as ParsedRelationshipDoc).sourceTable;
  return undefined;
}

function getDomain(doc: ParsedDocument): string | undefined {
  if (doc.docType === 'table') return (doc as ParsedTableDoc).domain;
  if (doc.docType === 'domain') return (doc as ParsedDomainDoc).domain;
  return undefined;
}

// =============================================================================
// Index Population
// =============================================================================

/**
 * Populate the index with processed documents
 * Uses UPSERT to handle both inserts and updates
 */
export function populateIndex(
  db: DatabaseType,
  documents: ProcessedDocument[],
  embeddings: Map<string, number[]>,
  parentDocIds: Map<string, number>
): IndexStats {
  const stats: IndexStats = { inserted: 0, updated: 0, failed: 0 };

  // Prepare statements
  const insertDoc = db.prepare(`
    INSERT INTO documents (
      doc_type, database_name, schema_name, table_name, column_name,
      domain, content, summary, keywords, file_path, content_hash,
      source_modified_at, parent_doc_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      doc_type = excluded.doc_type,
      database_name = excluded.database_name,
      schema_name = excluded.schema_name,
      table_name = excluded.table_name,
      column_name = excluded.column_name,
      domain = excluded.domain,
      content = excluded.content,
      summary = excluded.summary,
      keywords = excluded.keywords,
      content_hash = excluded.content_hash,
      source_modified_at = excluded.source_modified_at,
      parent_doc_id = excluded.parent_doc_id,
      indexed_at = CURRENT_TIMESTAMP
    RETURNING id, (changes() = 0) as was_update
  `);

  // Note: documents_vec uses document_id column (not id) to match expected schema
  const insertVec = db.prepare(`
    INSERT OR REPLACE INTO documents_vec (document_id, embedding) VALUES (?, ?)
  `);

  const deleteVec = db.prepare(`
    DELETE FROM documents_vec WHERE document_id = ?
  `);

  // Use transaction for atomicity
  const transaction = db.transaction(() => {
    for (const doc of documents) {
      try {
        // Resolve parent_doc_id for column documents
        let parentDocId: number | null = null;
        if (doc.docType === 'column' && doc.parentTablePath) {
          parentDocId = parentDocIds.get(doc.parentTablePath) || null;
          if (!parentDocId) {
            logger.warn(`Parent table doc not found for column ${doc.filePath}`);
          }
        }

        // Insert/update document
        const result = insertDoc.get(
          doc.docType,
          doc.database,
          doc.schema || null,
          doc.table || null,
          doc.column || null,
          doc.domain || null,
          doc.content,
          doc.summary,
          JSON.stringify(doc.keywords),
          doc.filePath,
          doc.contentHash,
          doc.modifiedAt,
          parentDocId
        ) as { id: number; was_update: number } | undefined;

        if (!result) {
          logger.error(`Failed to insert document: ${doc.filePath}`);
          stats.failed++;
          continue;
        }

        const docId = result.id;
        const wasUpdate = result.was_update === 1;

        // Track table doc IDs for later column linking
        if (doc.docType === 'table') {
          parentDocIds.set(doc.filePath, docId);
        }

        // Handle embedding - try both filePath and document identity as keys
        // The identity key format matches what embeddings.ts uses
        const docIdentity = buildDocumentIdentity(doc);
        
        let embedding = embeddings.get(doc.filePath);
        if (!embedding) {
          // Fallback: try document identity key (used by embeddings.ts)
          embedding = embeddings.get(docIdentity);
        }
        
        // For relationships, try partial match on keys (since we may not have full info)
        if (!embedding && doc.docType === 'relationship') {
          const prefix = `${doc.database}.${doc.table}_to_`;
          for (const [key, emb] of embeddings) {
            if (key.startsWith(prefix)) {
              embedding = emb;
              break;
            }
          }
        }
        
        if (embedding) {
          const embeddingBlob = float32ArrayToBlob(embedding);
          insertVec.run(docId, embeddingBlob);
        } else {
          // Remove any stale embedding
          deleteVec.run(docId);
        }

        if (wasUpdate) {
          stats.updated++;
        } else {
          stats.inserted++;
        }

      } catch (error) {
        logger.error(`Failed to index ${doc.filePath}`, error);
        stats.failed++;
      }
    }
  });

  transaction();

  return stats;
}

// =============================================================================
// Fallback Indexing (when embeddings fail)
// =============================================================================

/**
 * Index documents with fallback when embeddings fail
 * Ensures FTS search still works even without vector search
 */
export function indexWithFallbacks(
  db: DatabaseType,
  documents: ProcessedDocument[],
  embeddingsPromise: Promise<Map<string, number[]>> | null,
  parentDocIds: Map<string, number>
): Promise<IndexStats> {
  return new Promise(async (resolve) => {
    // Sort documents so tables come before columns
    const sortedDocs = documents.sort((a, b) => {
      const order: Record<string, number> = { table: 0, domain: 1, overview: 2, relationship: 3, column: 4 };
      return (order[a.docType] ?? 99) - (order[b.docType] ?? 99);
    });

    let embeddings: Map<string, number[]> = new Map();

    // Try to get embeddings
    if (embeddingsPromise) {
      try {
        embeddings = await embeddingsPromise;
      } catch (error) {
        logger.warn('Embedding generation failed, continuing with FTS only', error);
      }
    }

    // Index documents (with or without embeddings)
    const stats = populateIndex(db, sortedDocs, embeddings, parentDocIds);

    if (embeddings.size === 0) {
      logger.warn('Search quality degraded: vector search unavailable');
    }

    resolve(stats);
  });
}

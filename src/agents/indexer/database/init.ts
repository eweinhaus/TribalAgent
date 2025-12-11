/**
 * Database Initialization Module
 *
 * Creates and initializes the SQLite database schema for the Tribal Knowledge index.
 * Includes tables for documents, FTS5 search, vector embeddings, and relationships.
 */

import { promises as fs } from 'fs';
import path from 'path';
import Database, { Database as DatabaseType } from 'better-sqlite3';
import { logger } from '../../../utils/logger.js';

// =============================================================================
// Database Connection
// =============================================================================

let dbInstance: DatabaseType | null = null;

/**
 * Open or create the database
 */
export async function openDatabase(dbPath?: string): Promise<DatabaseType> {
  const finalPath = dbPath || path.join(process.cwd(), 'data', 'tribal-knowledge.db');

  // Ensure directory exists
  await fs.mkdir(path.dirname(finalPath), { recursive: true });

  const db = new Database(finalPath);

  // Enable foreign keys
  db.pragma('foreign_keys = ON');

  // Enable WAL mode for better concurrent access
  db.pragma('journal_mode = WAL');

  // Initialize schema
  await initializeSchema(db);

  dbInstance = db;
  logger.debug(`Database opened at ${finalPath}`);

  return db;
}

/**
 * Close the database connection
 */
export function closeDatabase(db: DatabaseType): void {
  if (db) {
    db.close();
    if (dbInstance === db) {
      dbInstance = null;
    }
    logger.debug('Database closed');
  }
}

/**
 * Get the current database instance
 */
export function getDatabase(): DatabaseType | null {
  return dbInstance;
}

// =============================================================================
// Schema Initialization
// =============================================================================

/**
 * Initialize all database tables and indexes
 */
export async function initializeSchema(db: DatabaseType): Promise<void> {
  logger.debug('Initializing database schema...');

  // Documents table - main storage for all document types
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,           -- 'table', 'column', 'domain', 'relationship', 'overview'
      database_name TEXT NOT NULL,
      schema_name TEXT,
      table_name TEXT,
      column_name TEXT,
      domain TEXT,
      content TEXT NOT NULL,            -- Full markdown content
      summary TEXT,                     -- Compressed summary for retrieval
      keywords TEXT,                    -- JSON array of extracted keywords
      file_path TEXT NOT NULL,          -- Source file path (unique)
      content_hash TEXT NOT NULL,       -- For incremental indexing
      indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      source_modified_at DATETIME,
      parent_doc_id INTEGER,            -- For column docs, references parent table doc

      -- Constraints
      UNIQUE(file_path),
      FOREIGN KEY (parent_doc_id) REFERENCES documents(id) ON DELETE CASCADE
    );

    -- Indexes for common query patterns
    CREATE INDEX IF NOT EXISTS idx_documents_database ON documents(database_name);
    CREATE INDEX IF NOT EXISTS idx_documents_table ON documents(database_name, schema_name, table_name);
    CREATE INDEX IF NOT EXISTS idx_documents_column ON documents(database_name, schema_name, table_name, column_name);
    CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents(domain);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
    CREATE INDEX IF NOT EXISTS idx_documents_hash ON documents(content_hash);
    CREATE INDEX IF NOT EXISTS idx_documents_parent ON documents(parent_doc_id);
  `);

  // FTS5 Full-Text Search Index with Porter stemming
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      content,
      summary,
      keywords,
      content=documents,
      content_rowid=id,
      tokenize='porter unicode61'
    );
  `);

  // FTS5 Triggers to keep FTS in sync with documents table
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
      INSERT INTO documents_fts(rowid, content, summary, keywords)
      VALUES (new.id, new.content, new.summary, new.keywords);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, content, summary, keywords)
      VALUES('delete', old.id, old.content, old.summary, old.keywords);
    END;

    CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
      INSERT INTO documents_fts(documents_fts, rowid, content, summary, keywords)
      VALUES('delete', old.id, old.content, old.summary, old.keywords);
      INSERT INTO documents_fts(rowid, content, summary, keywords)
      VALUES (new.id, new.content, new.summary, new.keywords);
    END;
  `);

  // Vector embeddings table (fallback blob storage)
  // Using blob storage for compatibility - sqlite-vec can be used if available
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents_vec (
      id INTEGER PRIMARY KEY,
      embedding BLOB NOT NULL,          -- 1536 * 4 bytes = 6144 bytes per embedding
      FOREIGN KEY (id) REFERENCES documents(id) ON DELETE CASCADE
    );
  `);

  // Relationships table - stores FK relationships and computed multi-hop paths
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_name TEXT NOT NULL,
      source_schema TEXT NOT NULL,
      source_table TEXT NOT NULL,
      source_column TEXT NOT NULL,
      target_schema TEXT NOT NULL,
      target_table TEXT NOT NULL,
      target_column TEXT NOT NULL,
      relationship_type TEXT NOT NULL,  -- 'foreign_key', 'implied', 'semantic', 'documented', 'computed'
      hop_count INTEGER DEFAULT 1,
      join_sql TEXT,                    -- Pre-generated JOIN clause
      confidence REAL DEFAULT 1.0,

      UNIQUE(database_name, source_schema, source_table, source_column,
             target_schema, target_table, target_column)
    );

    CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(database_name, source_schema, source_table);
    CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(database_name, target_schema, target_table);
    CREATE INDEX IF NOT EXISTS idx_rel_hop ON relationships(hop_count);
  `);

  // Index weights table - per-document-type weights for hybrid search scoring
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_weights (
      doc_type TEXT PRIMARY KEY,
      fts_weight REAL DEFAULT 1.0,      -- Weight for FTS5 score
      vec_weight REAL DEFAULT 1.0,      -- Weight for vector similarity
      boost REAL DEFAULT 1.0            -- Overall boost multiplier
    );

    -- Default weights (table docs get highest priority)
    INSERT OR IGNORE INTO index_weights (doc_type, fts_weight, vec_weight, boost) VALUES
      ('table', 1.0, 1.0, 1.5),
      ('column', 0.8, 0.8, 1.0),
      ('relationship', 1.0, 1.0, 1.2),
      ('domain', 1.0, 1.0, 1.0),
      ('overview', 0.6, 0.6, 0.8);
  `);

  // Index metadata table - stores provenance hashes and counts
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_metadata (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Keywords cache table - for fast keyword lookup
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL UNIQUE,
      source_type TEXT,                 -- 'table_name', 'column_name', 'abbreviation', etc.
      frequency INTEGER DEFAULT 1
    );

    CREATE INDEX IF NOT EXISTS idx_keywords_term ON keywords(term);
  `);

  logger.debug('Database schema initialized');
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Convert a float32 array to a blob for storage
 */
export function float32ArrayToBlob(arr: number[]): Buffer {
  const buffer = Buffer.alloc(arr.length * 4);
  for (let i = 0; i < arr.length; i++) {
    buffer.writeFloatLE(arr[i], i * 4);
  }
  return buffer;
}

/**
 * Convert a blob back to a float32 array
 */
export function blobToFloat32Array(blob: Buffer): number[] {
  const arr: number[] = [];
  for (let i = 0; i < blob.length; i += 4) {
    arr.push(blob.readFloatLE(i));
  }
  return arr;
}

/**
 * Check if the database has been initialized
 */
export function isDatabaseInitialized(db: DatabaseType): boolean {
  const tables = db.prepare(`
    SELECT name FROM sqlite_master
    WHERE type='table' AND name='documents'
  `).get();

  return !!tables;
}

/**
 * Get document count by type
 */
export function getDocumentCounts(db: DatabaseType): Record<string, number> {
  const counts = db.prepare(`
    SELECT doc_type, COUNT(*) as count
    FROM documents
    GROUP BY doc_type
  `).all() as { doc_type: string; count: number }[];

  const result: Record<string, number> = {};
  for (const row of counts) {
    result[row.doc_type] = row.count;
  }
  return result;
}

/**
 * Get metadata value
 */
export function getMetadata(db: DatabaseType, key: string): string | null {
  const row = db.prepare('SELECT value FROM index_metadata WHERE key = ?').get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

/**
 * Set metadata value
 */
export function setMetadata(db: DatabaseType, key: string, value: string): void {
  db.prepare('INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)').run(key, value);
}

/**
 * Clear all documents and related data (for full re-index)
 */
export function clearAllData(db: DatabaseType): void {
  logger.warn('Clearing all indexed data...');

  db.transaction(() => {
    db.exec('DELETE FROM documents_vec');
    db.exec('DELETE FROM relationships');
    db.exec('DELETE FROM documents');
    db.exec('DELETE FROM keywords');
    db.exec('DELETE FROM index_metadata');
  })();

  logger.info('All indexed data cleared');
}

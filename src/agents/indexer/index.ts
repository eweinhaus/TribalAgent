/**
 * Agent 2: Document Indexer
 *
 * Parses generated documentation files, extracts keywords, generates embeddings,
 * and builds search index in SQLite database with FTS5 and vector indices.
 */

import { promises as fs } from 'fs';
import path from 'path';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import { Database } from 'better-sqlite3';

// Progress tracking schema
const IndexerProgressSchema = z.object({
  started_at: z.string(),
  completed_at: z.string().nullable(),
  status: z.enum(['running', 'completed', 'failed']),
  documents_total: z.number(),
  documents_indexed: z.number(),
  current_file: z.string().nullable(),
  embeddings_generated: z.number(),
  error: z.string().nullable(),
});

type IndexerProgress = z.infer<typeof IndexerProgressSchema>;

export async function runIndexer(): Promise<void> {
  try {
    logger.info('Starting document indexing phase');

    // Initialize progress tracking
    const progress: IndexerProgress = {
      started_at: new Date().toISOString(),
      completed_at: null,
      status: 'running',
      documents_total: 0,
      documents_indexed: 0,
      current_file: null,
      embeddings_generated: 0,
      error: null,
    };

    await saveProgress(progress);

    // Get all documentation files
    const docsDir = path.join(process.cwd(), 'docs');
    const docFiles = await getAllDocFiles(docsDir);

    progress.documents_total = docFiles.length;
    await saveProgress(progress);

    logger.info(`Found ${docFiles.length} documentation files to index`);

    // Initialize database
    const dbPath = path.join(process.cwd(), 'data', 'tribal-knowledge.db');
    await fs.mkdir(path.dirname(dbPath), { recursive: true });

    const db = new Database(dbPath);
    await initializeDatabase(db);

    // Process each documentation file
    for (const filePath of docFiles) {
      try {
        progress.current_file = path.relative(process.cwd(), filePath);
        await saveProgress(progress);

        logger.debug(`Indexing file: ${progress.current_file}`);

        // Parse document content
        const content = await fs.readFile(filePath, 'utf-8');
        const docData = parseDocument(content, filePath);

        // Extract keywords
        const keywords = extractKeywords(docData);

        // Generate embedding
        const embedding = await generateEmbedding(docData.content);

        // Insert into database
        await insertDocument(db, {
          ...docData,
          keywords: JSON.stringify(keywords),
          embedding,
        });

        progress.documents_indexed++;
        progress.embeddings_generated++;

      } catch (error) {
        logger.warn(`Failed to index file ${filePath}`, error);
        // Continue with other files
      }
    }

    // Build additional indices and optimize
    await buildRelationshipsIndex(db);
    await optimizeDatabase(db);

    db.close();

    // Mark progress as completed
    progress.status = 'completed';
    progress.completed_at = new Date().toISOString();
    progress.current_file = null;

    await saveProgress(progress);

    logger.info(`Indexing completed: ${progress.documents_indexed} documents indexed`);

  } catch (error) {
    logger.error('Indexing phase failed', error);
    throw error;
  }
}

/**
 * Get all documentation files recursively
 */
async function getAllDocFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  async function scanDir(currentDir: string): Promise<void> {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (entry.isFile() && (entry.name.endsWith('.md') || entry.name.endsWith('.json'))) {
        files.push(fullPath);
      }
    }
  }

  await scanDir(dir);
  return files;
}

/**
 * Parse document content and extract metadata
 */
function parseDocument(content: string, filePath: string): any {
  // TODO: Implement document parsing for different formats
  // For now, return basic structure
  return {
    doc_type: filePath.endsWith('.md') ? 'table' : 'schema',
    content: content,
    file_path: path.relative(path.join(process.cwd(), 'docs'), filePath),
    // Extract metadata from file path and content
    database_name: extractFromPath(filePath, 'database'),
    schema_name: extractFromPath(filePath, 'schema'),
    table_name: extractFromPath(filePath, 'table'),
    column_name: extractFromPath(filePath, 'column'),
    domain: extractFromPath(filePath, 'domain'),
  };
}

/**
 * Extract metadata from file path
 */
function extractFromPath(filePath: string, type: string): string | null {
  // TODO: Implement path parsing logic
  // For now, return null
  return null;
}

/**
 * Extract keywords from document content
 */
function extractKeywords(docData: any): string[] {
  // TODO: Implement keyword extraction
  // For now, return empty array
  return [];
}

/**
 * Generate embedding for document content
 */
async function generateEmbedding(content: string): Promise<Buffer> {
  // TODO: Implement OpenAI embedding generation
  // For now, return empty buffer
  return Buffer.alloc(1536 * 4); // 1536 dimensions * 4 bytes per float
}

/**
 * Initialize SQLite database schema
 */
async function initializeDatabase(db: Database): Promise<void> {
  // Documents table
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      doc_type TEXT NOT NULL,
      database_name TEXT,
      schema_name TEXT,
      table_name TEXT,
      column_name TEXT,
      domain TEXT,
      content TEXT NOT NULL,
      summary TEXT,
      keywords TEXT,
      file_path TEXT,
      content_hash TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_documents_database ON documents(database_name);
    CREATE INDEX IF NOT EXISTS idx_documents_table ON documents(database_name, schema_name, table_name);
    CREATE INDEX IF NOT EXISTS idx_documents_domain ON documents(domain);
    CREATE INDEX IF NOT EXISTS idx_documents_type ON documents(doc_type);
  `);

  // FTS5 virtual table for full-text search
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      content, summary, keywords,
      content=documents,
      content_rowid=rowid
    );
  `);

  // Vector table for embeddings
  db.exec(`
    CREATE TABLE IF NOT EXISTS documents_vec (
      id INTEGER PRIMARY KEY,
      embedding BLOB
    );
  `);

  // Relationships table
  db.exec(`
    CREATE TABLE IF NOT EXISTS relationships (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_name TEXT NOT NULL,
      source_table TEXT NOT NULL,
      target_table TEXT NOT NULL,
      join_path TEXT NOT NULL,
      hop_count INTEGER NOT NULL,
      sql_snippet TEXT,
      confidence REAL,
      UNIQUE(database_name, source_table, target_table)
    );

    CREATE INDEX IF NOT EXISTS idx_relationships_source ON relationships(database_name, source_table);
    CREATE INDEX IF NOT EXISTS idx_relationships_target ON relationships(database_name, target_table);
  `);

  // Keywords cache table
  db.exec(`
    CREATE TABLE IF NOT EXISTS keywords (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      term TEXT NOT NULL UNIQUE,
      source_type TEXT,
      frequency INTEGER DEFAULT 1
    );
  `);

  // Index weights table
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_weights (
      doc_type TEXT PRIMARY KEY,
      fts_weight REAL DEFAULT 1.0,
      vec_weight REAL DEFAULT 1.0,
      boost REAL DEFAULT 1.0
    );

    INSERT OR IGNORE INTO index_weights (doc_type, fts_weight, vec_weight, boost) VALUES
      ('table', 1.0, 1.0, 1.5),
      ('column', 0.8, 0.8, 1.0),
      ('relationship', 1.0, 1.0, 1.2),
      ('domain', 1.0, 1.0, 1.0);
  `);
}

/**
 * Insert document into database
 */
async function insertDocument(db: Database, docData: any): Promise<void> {
  const insertDoc = db.prepare(`
    INSERT INTO documents (
      doc_type, database_name, schema_name, table_name, column_name,
      domain, content, summary, keywords, file_path, content_hash
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertVec = db.prepare(`
    INSERT INTO documents_vec (id, embedding) VALUES (?, ?)
  `);

  // Insert document
  const result = insertDoc.run(
    docData.doc_type,
    docData.database_name,
    docData.schema_name,
    docData.table_name,
    docData.column_name,
    docData.domain,
    docData.content,
    docData.summary,
    docData.keywords,
    docData.file_path,
    docData.content_hash
  );

  // Insert embedding
  insertVec.run(result.lastInsertRowid, docData.embedding);

  // Update FTS index
  db.exec('INSERT INTO documents_fts(rowid, content, summary, keywords) VALUES (?, ?, ?, ?)',
    result.lastInsertRowid, docData.content, docData.summary, docData.keywords);
}

/**
 * Build relationships index from existing documents
 */
async function buildRelationshipsIndex(db: Database): Promise<void> {
  // TODO: Implement relationship extraction and indexing
  logger.debug('Building relationships index (not yet implemented)');
}

/**
 * Optimize database after indexing
 */
async function optimizeDatabase(db: Database): Promise<void> {
  logger.debug('Optimizing database...');

  // Optimize FTS5
  db.exec('INSERT INTO documents_fts(documents_fts) VALUES (\'optimize\')');

  // Run ANALYZE for query optimization
  db.exec('ANALYZE');

  // Vacuum for space optimization
  db.exec('VACUUM');
}

/**
 * Save progress to file for checkpoint recovery
 */
async function saveProgress(progress: IndexerProgress): Promise<void> {
  const progressPath = path.join(process.cwd(), 'progress', 'indexer-progress.json');
  await fs.mkdir(path.dirname(progressPath), { recursive: true });
  await fs.writeFile(progressPath, JSON.stringify(progress, null, 2));
}
# Tribal Knowledge Deep Agent
## Indexer Agent (Module 3) - Implementation Plan

**Version**: 1.2
**Date**: December 10, 2025
**Status**: Planning
**Changelog**: v1.2 - Fixed incremental indexing flow, parent_doc_id insertion, relationship doc parsing, cascade cleanup, rawContent requirement, stable hash for resume
**Changelog**: v1.1 - Added column/relationship embeddings, domain parsing, cascade deletes, complete multi-hop logic, resume support, index_weights integration
**Companion Documents**:
- `agent-contracts-interfaces.md` - TypeScript interfaces
- `agent-contracts-execution.md` - Execution model
- `agent-contracts-summary.md` - Human-readable overview

---

## 1. Executive Summary

The Indexer Agent is the third module in the Tribal Knowledge pipeline, responsible for transforming generated documentation into a searchable knowledge base. It reads the `documentation-manifest.json` from the Documenter, processes all indexed files, extracts keywords, generates vector embeddings, and populates a SQLite database with hybrid search capabilities (FTS5 + vector).

### 1.1 Position in Pipeline

```
Planner → Documenter → [INDEXER] → Retriever
                            │
                            ▼
                    ┌─────────────────┐
                    │ SQLite Database │
                    │  - documents    │
                    │  - documents_fts│
                    │  - documents_vec│
                    │  - relationships│
                    └─────────────────┘
```

### 1.2 Key Responsibilities

| Responsibility | Description |
|----------------|-------------|
| **Manifest Validation** | Verify documentation is complete and files exist |
| **Document Parsing** | Parse markdown and extract structured metadata |
| **Keyword Extraction** | Extract semantic keywords from content |
| **Embedding Generation** | Generate OpenAI embeddings for vector search |
| **Index Population** | Populate FTS5 and vector indices |
| **Relationship Building** | Build join path graph from foreign keys |
| **Change Detection** | Support incremental re-indexing via content hashes |
| **Progress Tracking** | Checkpoint for crash recovery |

---

## 2. Input Contract

### 2.1 Primary Input: documentation-manifest.json

**Location**: `docs/documentation-manifest.json`
**Producer**: Documenter Agent
**Required Status**: `complete` or `partial`

```typescript
interface DocumentationManifest {
  schema_version: '1.0';
  completed_at: ISOTimestamp;
  plan_hash: ContentHash;
  status: 'complete' | 'partial';
  databases: DatabaseManifest[];
  work_units: WorkUnitManifest[];
  total_files: number;
  indexable_files: IndexableFile[];
}

interface IndexableFile {
  path: string;                    // Relative path from /docs
  type: 'table' | 'domain' | 'overview' | 'relationship';
  database: string;
  schema?: string;
  table?: string;
  domain?: DomainName;
  content_hash: ContentHash;       // SHA-256 for change detection
  size_bytes: number;
  modified_at: ISOTimestamp;
}
```

### 2.2 Manifest Validation Rules

Before indexing begins, validate:

1. **File exists**: `docs/documentation-manifest.json` must exist
2. **Schema version**: Must be `1.0`
3. **Status is terminal**: Must be `complete` or `partial`
4. **Files exist**: All `indexable_files[].path` must exist on disk
5. **Hashes match**: Content hash of each file matches manifest hash
6. **Non-empty**: At least one indexable file present

```typescript
async function validateManifest(manifest: DocumentationManifest): Promise<ValidationResult> {
  const errors: ValidationError[] = [];

  // Check schema version
  if (manifest.schema_version !== '1.0') {
    errors.push({ code: 'IDX_MANIFEST_INVALID', message: 'Invalid schema version' });
  }

  // Check status
  if (!['complete', 'partial'].includes(manifest.status)) {
    errors.push({ code: 'IDX_MANIFEST_INVALID', message: 'Documentation not yet complete' });
  }

  // Verify all files exist and hashes match
  for (const file of manifest.indexable_files) {
    const fullPath = path.join('docs', file.path);

    if (!await fs.pathExists(fullPath)) {
      errors.push({
        code: 'IDX_FILE_NOT_FOUND',
        message: `Missing: ${file.path}`,
        recoverable: true  // Can skip this file
      });
      continue;
    }

    const content = await fs.readFile(fullPath);
    const actualHash = computeSHA256(content);

    if (actualHash !== file.content_hash) {
      errors.push({
        code: 'IDX_FILE_HASH_MISMATCH',
        message: `${file.path} modified since manifest created`,
        recoverable: true  // Can re-hash and continue
      });
    }
  }

  return { valid: errors.length === 0, errors };
}
```

---

## 3. Output Contract

### 3.1 Primary Output: SQLite Database

**Location**: `data/tribal-knowledge.db`
**Consumer**: Retriever Agent (MCP Server)

#### 3.1.1 Documents Table

```sql
CREATE TABLE documents (
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
  file_path TEXT NOT NULL,          -- Source file path
  content_hash TEXT NOT NULL,       -- For incremental indexing
  indexed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  source_modified_at DATETIME,
  parent_doc_id INTEGER,            -- For column docs, references parent table doc

  -- Indexes
  UNIQUE(file_path),
  FOREIGN KEY (parent_doc_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX idx_documents_database ON documents(database_name);
CREATE INDEX idx_documents_table ON documents(database_name, schema_name, table_name);
CREATE INDEX idx_documents_column ON documents(database_name, schema_name, table_name, column_name);
CREATE INDEX idx_documents_domain ON documents(domain);
CREATE INDEX idx_documents_type ON documents(doc_type);
CREATE INDEX idx_documents_hash ON documents(content_hash);
CREATE INDEX idx_documents_parent ON documents(parent_doc_id);
```

#### 3.1.2 FTS5 Full-Text Search Index

```sql
CREATE VIRTUAL TABLE documents_fts USING fts5(
  content,
  summary,
  keywords,
  content=documents,
  content_rowid=id,
  tokenize='porter unicode61'      -- Porter stemming for better matching
);

-- Triggers to keep FTS in sync
CREATE TRIGGER documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, content, summary, keywords)
  VALUES (new.id, new.content, new.summary, new.keywords);
END;

CREATE TRIGGER documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, summary, keywords)
  VALUES('delete', old.id, old.content, old.summary, old.keywords);
END;

CREATE TRIGGER documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, content, summary, keywords)
  VALUES('delete', old.id, old.content, old.summary, old.keywords);
  INSERT INTO documents_fts(rowid, content, summary, keywords)
  VALUES (new.id, new.content, new.summary, new.keywords);
END;
```

#### 3.1.3 Vector Embeddings Table

```sql
-- Using sqlite-vec extension for vector storage and search
-- Requires: .load vec0

CREATE VIRTUAL TABLE documents_vec USING vec0(
  id INTEGER PRIMARY KEY,
  embedding FLOAT[1536]             -- OpenAI text-embedding-3-small dimensions
);

-- Alternative for non-vec0 installations (blob storage)
CREATE TABLE documents_vec_fallback (
  id INTEGER PRIMARY KEY,
  embedding BLOB NOT NULL,          -- 1536 * 4 bytes = 6144 bytes
  FOREIGN KEY (id) REFERENCES documents(id)
);
```

#### 3.1.4 Relationships Table

```sql
CREATE TABLE relationships (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  database_name TEXT NOT NULL,
  source_schema TEXT NOT NULL,
  source_table TEXT NOT NULL,
  source_column TEXT NOT NULL,
  target_schema TEXT NOT NULL,
  target_table TEXT NOT NULL,
  target_column TEXT NOT NULL,
  relationship_type TEXT NOT NULL,  -- 'foreign_key', 'implied', 'semantic'
  hop_count INTEGER DEFAULT 1,
  join_sql TEXT,                    -- Pre-generated JOIN clause
  confidence REAL DEFAULT 1.0,

  UNIQUE(database_name, source_schema, source_table, source_column,
         target_schema, target_table, target_column)
);

CREATE INDEX idx_rel_source ON relationships(database_name, source_schema, source_table);
CREATE INDEX idx_rel_target ON relationships(database_name, target_schema, target_table);
```

#### 3.1.5 Index Metadata Table

```sql
CREATE TABLE index_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Required keys (must be persisted):
-- 'last_full_index' - ISO timestamp of last complete index
-- 'manifest_hash' - Hash of manifest used for indexing (CRITICAL for staleness detection)
-- 'plan_hash' - Hash of documentation plan used
-- 'document_count' - Total documents indexed
-- 'embedding_count' - Documents with embeddings
-- 'embedding_model' - Model used (text-embedding-3-small)
-- 'embedding_dimensions' - 1536
-- 'index_version' - Schema version
-- 'table_count' - Number of table documents
-- 'column_count' - Number of column documents
-- 'domain_count' - Number of domain documents
-- 'relationship_count' - Number of relationship records
```

#### 3.1.6 Index Weights Table (for Hybrid Search Scoring)

```sql
-- Per-document-type weights for hybrid search (FR-2.10)
CREATE TABLE index_weights (
  doc_type TEXT PRIMARY KEY,
  fts_weight REAL DEFAULT 1.0,      -- Weight for FTS5 score
  vec_weight REAL DEFAULT 1.0,      -- Weight for vector similarity
  boost REAL DEFAULT 1.0            -- Overall boost multiplier
);

-- Default weights (table docs get highest priority)
INSERT INTO index_weights (doc_type, fts_weight, vec_weight, boost) VALUES
  ('table', 1.0, 1.0, 1.5),
  ('column', 0.8, 0.8, 1.0),
  ('relationship', 1.0, 1.0, 1.2),
  ('domain', 1.0, 1.0, 1.0),
  ('overview', 0.6, 0.6, 0.8);
```

### 3.2 Secondary Output: Progress File

**Location**: `progress/indexer-progress.json`

```typescript
interface IndexerProgress {
  schema_version: '1.0';
  started_at: ISOTimestamp;
  completed_at: ISOTimestamp | null;
  status: AgentStatus;              // 'pending' | 'running' | 'completed' | 'failed' | 'partial'

  manifest_file: string;
  manifest_hash: ContentHash;

  files_total: number;
  files_indexed: number;
  files_failed: number;
  files_skipped: number;            // Already indexed, hash unchanged

  current_file?: string;
  current_phase: 'validating' | 'parsing' | 'embedding' | 'indexing' | 'relationships' | 'optimizing';

  embeddings_generated: number;
  embeddings_failed: number;

  last_checkpoint: ISOTimestamp;

  // Resume support (Gap 7)
  indexed_files: string[];          // List of successfully indexed file paths
  failed_files: string[];           // List of failed file paths with reasons
  pending_files: string[];          // Files remaining to be processed

  errors: AgentError[];

  stats: {
    parse_time_ms: number;
    embedding_time_ms: number;
    index_time_ms: number;
    total_time_ms: number;
    table_docs: number;
    column_docs: number;
    domain_docs: number;
    relationship_docs: number;
  };
}
```

---

## 4. Processing Pipeline

### 4.1 High-Level Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         INDEXER PROCESSING PIPELINE                          │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐│
│   │ VALIDATE │──▶│  PARSE   │──▶│ EXTRACT  │──▶│  EMBED   │──▶│  INDEX   ││
│   │ Manifest │   │Documents │   │ Keywords │   │  Batch   │   │ Populate ││
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘│
│         │              │              │              │              │       │
│         ▼              ▼              ▼              ▼              ▼       │
│   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐│
│   │  Check   │   │Markdown  │   │ Column   │   │ OpenAI   │   │ SQLite   ││
│   │  Files   │   │  YAML    │   │ Names    │   │   API    │   │ FTS5     ││
│   │  Exist   │   │  JSON    │   │ Patterns │   │ Batched  │   │ Vec      ││
│   └──────────┘   └──────────┘   └──────────┘   └──────────┘   └──────────┘│
│                                                                             │
│                        ┌──────────┐   ┌──────────┐                         │
│                        │  BUILD   │──▶│ OPTIMIZE │                         │
│                        │Relations │   │ & Vacuum │                         │
│                        └──────────┘   └──────────┘                         │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Step 1: Validate Manifest

```typescript
async function validateAndLoadManifest(): Promise<DocumentationManifest> {
  const manifestPath = 'docs/documentation-manifest.json';

  // 1. Check manifest exists
  if (!await fs.pathExists(manifestPath)) {
    throw new IndexerError('IDX_MANIFEST_NOT_FOUND', 'Run documenter first');
  }

  // 2. Parse and validate schema
  const manifest = await readJSON(manifestPath);
  const validated = DocumentationManifestSchema.parse(manifest);

  // 3. Verify status is terminal
  if (!['complete', 'partial'].includes(validated.status)) {
    throw new IndexerError('IDX_MANIFEST_INVALID', 'Documentation incomplete');
  }

  // 4. Verify files exist (with tolerance for missing)
  const fileChecks = await Promise.all(
    validated.indexable_files.map(file => verifyFile(file))
  );

  const missingFiles = fileChecks.filter(r => !r.exists);
  if (missingFiles.length > 0) {
    logger.warn(`${missingFiles.length} files missing from manifest`);
    // Don't fail - filter them out and continue
  }

  return validated;
}
```

### 4.3 Step 2: Parse Documents

Each document type has specific parsing logic:

#### 4.3.1 Table Documentation Parser

```typescript
interface ParsedTableDoc {
  docType: 'table';
  database: string;
  schema: string;
  table: string;
  domain: string;
  description: string;
  columns: ParsedColumn[];
  primaryKey: string[];
  foreignKeys: ForeignKeyInfo[];
  indexes: IndexInfo[];
  rowCount: number;
  sampleData?: Record<string, any>[];
  keywords: string[];
  rawContent: string;
}

async function parseTableDocument(filePath: string, content: string): Promise<ParsedTableDoc> {
  // Extract YAML frontmatter if present
  const { frontmatter, body } = extractFrontmatter(content);

  // Parse markdown sections
  const sections = parseMarkdownSections(body);

  // Extract from file path: databases/{db}/tables/{schema}.{table}.md
  const pathParts = parseFilePath(filePath);

  // Extract columns from the "Columns" section table
  const columnsSection = sections.find(s => s.heading === 'Columns');
  const columns = columnsSection ? parseColumnsTable(columnsSection.content) : [];

  // Extract foreign keys from "Relationships" section
  const relSection = sections.find(s => s.heading === 'Relationships');
  const foreignKeys = relSection ? parseForeignKeys(relSection.content) : [];

  // Extract description from overview
  const overviewSection = sections.find(s => s.heading === 'Overview');
  const description = overviewSection?.content || '';

  return {
    docType: 'table',
    database: pathParts.database,
    schema: pathParts.schema,
    table: pathParts.table,
    domain: frontmatter?.domain || inferDomain(pathParts.table),
    description: extractDescription(description),
    columns,
    primaryKey: extractPrimaryKey(columns),
    foreignKeys,
    indexes: [],
    rowCount: frontmatter?.row_count || 0,
    keywords: [],  // Populated in extraction step
    rawContent: content
  };
}
```

#### 4.3.2 Domain Documentation Parser

```typescript
interface ParsedDomainDoc {
  docType: 'domain';
  database: string;
  domain: string;
  description: string;
  tables: string[];
  erDiagram?: string;
  keywords: string[];
  rawContent: string;
}

async function parseDomainDocument(filePath: string, content: string): Promise<ParsedDomainDoc> {
  // Extract YAML frontmatter
  const { frontmatter, body } = extractFrontmatter(content);

  // Parse markdown sections
  const sections = parseMarkdownSections(body);

  // Extract from file path: databases/{db}/domains/{domain}.md
  const pathParts = parseFilePath(filePath);

  // Extract description from overview section
  const overviewSection = sections.find(s => s.heading === 'Overview' || s.heading === 'Description');
  const description = overviewSection?.content || '';

  // Extract table list from "Tables in this Domain" section
  const tablesSection = sections.find(s => s.heading.includes('Tables'));
  const tables = tablesSection ? parseTableList(tablesSection.content) : [];

  // Extract ER diagram if present (Mermaid block)
  const erSection = sections.find(s => s.heading.includes('Diagram') || s.heading.includes('ER'));
  const erDiagram = erSection ? extractMermaidBlock(erSection.content) : undefined;

  return {
    docType: 'domain',
    database: pathParts.database,
    domain: frontmatter?.domain || pathParts.domain,
    description: extractDescription(description),
    tables,
    erDiagram,
    keywords: [],  // Populated in extraction step
    rawContent: content
  };
}
```

#### 4.3.3 Overview/Relationship Documentation Parser

```typescript
interface ParsedOverviewDoc {
  docType: 'overview';
  database: string;
  title: string;
  description: string;
  sections: { heading: string; content: string }[];
  keywords: string[];
  rawContent: string;
}

interface ParsedRelationshipDoc {
  docType: 'relationship';
  database: string;
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  relationshipType: string;
  description: string;
  joinCondition: string;
  keywords: string[];
  rawContent: string;
}

async function parseOverviewDocument(filePath: string, content: string): Promise<ParsedOverviewDoc> {
  const { frontmatter, body } = extractFrontmatter(content);
  const sections = parseMarkdownSections(body);
  const pathParts = parseFilePath(filePath);

  return {
    docType: 'overview',
    database: pathParts.database,
    title: frontmatter?.title || extractTitle(body),
    description: sections[0]?.content || '',
    sections,
    keywords: [],
    rawContent: content
  };
}

/**
 * v1.2 fix: Parse relationship documentation files (FR-2.6)
 * Extracts source/target table info, relationship type, and join conditions
 */
async function parseRelationshipDocument(filePath: string, content: string): Promise<ParsedRelationshipDoc> {
  const { frontmatter, body } = extractFrontmatter(content);
  const sections = parseMarkdownSections(body);
  const pathParts = parseFilePath(filePath);

  // Extract relationship details from frontmatter or content
  const sourceTable = frontmatter?.source_table || extractFromSection(sections, 'Source Table');
  const targetTable = frontmatter?.target_table || extractFromSection(sections, 'Target Table');
  const sourceColumn = frontmatter?.source_column || extractFromSection(sections, 'Source Column');
  const targetColumn = frontmatter?.target_column || extractFromSection(sections, 'Target Column');

  // Extract join condition from "Join Condition" or "SQL" section
  const joinSection = sections.find(s =>
    s.heading.includes('Join') || s.heading.includes('SQL') || s.heading.includes('Condition')
  );
  const joinCondition = joinSection?.content || frontmatter?.join_sql || '';

  // Extract description
  const descSection = sections.find(s =>
    s.heading.includes('Description') || s.heading.includes('Overview')
  );
  const description = descSection?.content || '';

  return {
    docType: 'relationship',
    database: pathParts.database,
    sourceSchema: frontmatter?.source_schema || pathParts.schema || 'public',
    sourceTable: sourceTable || '',
    sourceColumn: sourceColumn || '',
    targetSchema: frontmatter?.target_schema || pathParts.schema || 'public',
    targetTable: targetTable || '',
    targetColumn: targetColumn || '',
    relationshipType: frontmatter?.relationship_type || 'foreign_key',
    description,
    joinCondition,
    keywords: [],  // Populated in extraction step
    rawContent: content
  };
}

/**
 * v1.2 fix: Extract keywords from relationship document (FR-2.6)
 */
function extractKeywordsFromRelationship(doc: ParsedRelationshipDoc): string[] {
  const keywords = new Set<string>();

  // Source and target table names
  splitIdentifier(doc.sourceTable).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });
  splitIdentifier(doc.targetTable).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // Column names
  if (doc.sourceColumn) {
    splitIdentifier(doc.sourceColumn).forEach(part => keywords.add(part.toLowerCase()));
  }
  if (doc.targetColumn) {
    splitIdentifier(doc.targetColumn).forEach(part => keywords.add(part.toLowerCase()));
  }

  // Relationship type keywords
  keywords.add(doc.relationshipType.toLowerCase());
  if (doc.relationshipType === 'foreign_key') {
    keywords.add('fk');
    keywords.add('foreign key');
    keywords.add('reference');
  }
  if (doc.relationshipType === 'one_to_many') {
    keywords.add('one to many');
    keywords.add('1:n');
    keywords.add('parent child');
  }
  if (doc.relationshipType === 'many_to_many') {
    keywords.add('many to many');
    keywords.add('m:n');
    keywords.add('junction');
  }

  // Join-related keywords
  keywords.add('join');
  keywords.add('relationship');
  keywords.add('link');
  keywords.add('connection');

  // Description terms
  const descTerms = extractNounsFromDescription(doc.description);
  descTerms.forEach(t => keywords.add(t.toLowerCase()));

  return Array.from(keywords).filter(k => k.length > 2);
}
```

#### 4.3.4 Column Document Generation (FR-2.5)

For each table document, generate separate column documents for granular search:

```typescript
interface ParsedColumnDoc {
  docType: 'column';
  database: string;
  schema: string;
  table: string;
  column: string;
  dataType: string;
  nullable: boolean;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  foreignKeyTarget?: string;
  description: string;
  sampleValues?: string[];
  keywords: string[];
  parentTablePath: string;  // Reference to parent table doc
  rawContent: string;       // Required for embedding text generation (v1.2 fix)
}

function generateColumnDocuments(tableDoc: ParsedTableDoc, tableFilePath: string): ParsedColumnDoc[] {
  return tableDoc.columns.map(col => ({
    docType: 'column',
    database: tableDoc.database,
    schema: tableDoc.schema,
    table: tableDoc.table,
    column: col.name,
    dataType: col.dataType,
    nullable: col.nullable,
    isPrimaryKey: tableDoc.primaryKey.includes(col.name),
    isForeignKey: tableDoc.foreignKeys.some(fk => fk.sourceColumn === col.name),
    foreignKeyTarget: tableDoc.foreignKeys.find(fk => fk.sourceColumn === col.name)?.targetTable,
    description: col.description || '',
    sampleValues: col.sampleValues,
    keywords: extractKeywordsFromColumn(col, tableDoc),
    parentTablePath: tableFilePath,
    // v1.2 fix: Generate rawContent for embedding fallback
    rawContent: generateColumnRawContent(col, tableDoc)
  }));
}

/**
 * Generate raw content string for column document (v1.2 fix)
 * Used as fallback in createEmbeddingText when specific handler not found
 */
function generateColumnRawContent(col: ParsedColumn, tableDoc: ParsedTableDoc): string {
  const lines = [
    `# Column: ${tableDoc.schema}.${tableDoc.table}.${col.name}`,
    '',
    `**Data Type**: ${col.dataType}`,
    `**Nullable**: ${col.nullable ? 'Yes' : 'No'}`,
    tableDoc.primaryKey.includes(col.name) ? '**Primary Key**: Yes' : '',
    tableDoc.foreignKeys.some(fk => fk.sourceColumn === col.name)
      ? `**Foreign Key**: References ${tableDoc.foreignKeys.find(fk => fk.sourceColumn === col.name)?.targetTable}`
      : '',
    '',
    `## Description`,
    col.description || 'No description available.',
    '',
    col.sampleValues?.length ? `## Sample Values\n${col.sampleValues.join(', ')}` : ''
  ].filter(Boolean);

  return lines.join('\n');
}

function extractKeywordsFromColumn(col: ParsedColumn, tableDoc: ParsedTableDoc): string[] {
  const keywords = new Set<string>();

  // Column name parts
  splitIdentifier(col.name).forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // Data type keywords
  keywords.add(col.dataType.toLowerCase());
  if (col.dataType.includes('int')) keywords.add('integer', 'number');
  if (col.dataType.includes('varchar') || col.dataType.includes('text')) keywords.add('string', 'text');
  if (col.dataType.includes('timestamp') || col.dataType.includes('date')) keywords.add('date', 'time');
  if (col.dataType.includes('bool')) keywords.add('boolean', 'flag');
  if (col.dataType.includes('json')) keywords.add('json', 'object');

  // Constraint keywords
  if (tableDoc.primaryKey.includes(col.name)) keywords.add('primary key', 'pk', 'identifier');
  if (tableDoc.foreignKeys.some(fk => fk.sourceColumn === col.name)) keywords.add('foreign key', 'fk', 'reference');

  // Parent context
  keywords.add(tableDoc.domain.toLowerCase());

  return Array.from(keywords).filter(k => k.length > 2);
}
```

### 4.4 Step 3: Extract Keywords

```typescript
interface KeywordExtractor {
  extractFromTable(doc: ParsedTableDoc): string[];
  extractFromColumn(column: ParsedColumn): string[];
  expandAbbreviations(term: string): string[];
}

const ABBREVIATION_MAP: Record<string, string[]> = {
  'cust': ['customer', 'customers'],
  'usr': ['user', 'users'],
  'acct': ['account', 'accounts'],
  'txn': ['transaction', 'transactions'],
  'amt': ['amount'],
  'qty': ['quantity'],
  'dt': ['date'],
  'ts': ['timestamp'],
  'addr': ['address'],
  'desc': ['description'],
  'num': ['number'],
  'prd': ['product'],
  'ord': ['order'],
  'inv': ['invoice', 'inventory'],
  'msg': ['message'],
  'cfg': ['config', 'configuration'],
  'auth': ['authentication', 'authorization'],
  'pwd': ['password'],
  'ref': ['reference'],
  'stat': ['status', 'statistics'],
  'seq': ['sequence'],
  'idx': ['index'],
  'fk': ['foreign key'],
  'pk': ['primary key'],
};

function extractKeywordsFromTable(doc: ParsedTableDoc): string[] {
  const keywords = new Set<string>();

  // 1. Table name parts
  const tableNameParts = splitIdentifier(doc.table);
  tableNameParts.forEach(part => {
    keywords.add(part.toLowerCase());
    expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
  });

  // 2. Column names
  for (const column of doc.columns) {
    const colParts = splitIdentifier(column.name);
    colParts.forEach(part => {
      keywords.add(part.toLowerCase());
      expandAbbreviations(part).forEach(exp => keywords.add(exp.toLowerCase()));
    });
  }

  // 3. Domain
  keywords.add(doc.domain.toLowerCase());

  // 4. Data patterns from sample data
  if (doc.sampleData?.length > 0) {
    const patterns = detectDataPatterns(doc.sampleData);
    patterns.forEach(p => keywords.add(p));
  }

  // 5. Description terms (nouns and technical terms)
  const descTerms = extractNounsFromDescription(doc.description);
  descTerms.forEach(t => keywords.add(t.toLowerCase()));

  return Array.from(keywords).filter(k => k.length > 2);
}

function splitIdentifier(identifier: string): string[] {
  // Split on underscores and camelCase
  return identifier
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split('_')
    .filter(p => p.length > 0);
}

function expandAbbreviations(term: string): string[] {
  const lower = term.toLowerCase();
  return ABBREVIATION_MAP[lower] || [];
}
```

### 4.5 Step 4: Generate Embeddings

```typescript
interface EmbeddingService {
  generateBatch(texts: string[]): Promise<EmbeddingResult[]>;
  getModel(): string;
  getDimensions(): number;
}

interface EmbeddingResult {
  text: string;
  embedding: number[];
  tokenCount: number;
}

class OpenAIEmbeddingService implements EmbeddingService {
  private model = 'text-embedding-3-small';
  private dimensions = 1536;
  private batchSize = 50;
  private maxRetries = 3;

  async generateBatch(texts: string[]): Promise<EmbeddingResult[]> {
    const results: EmbeddingResult[] = [];

    // Process in batches
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      const response = await this.callWithRetry(batch);

      for (let j = 0; j < batch.length; j++) {
        results.push({
          text: batch[j],
          embedding: response.data[j].embedding,
          tokenCount: response.usage.prompt_tokens / batch.length
        });
      }

      // Rate limiting
      await sleep(100);
    }

    return results;
  }

  private async callWithRetry(texts: string[]): Promise<OpenAIEmbeddingResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        const response = await openai.embeddings.create({
          model: this.model,
          input: texts,
        });
        return response;
      } catch (error) {
        lastError = error as Error;

        if (isRateLimitError(error)) {
          const backoff = Math.pow(2, attempt) * 1000;
          logger.warn(`Rate limited, waiting ${backoff}ms`);
          await sleep(backoff);
        } else {
          throw error;
        }
      }
    }

    throw new IndexerError('IDX_EMBEDDING_FAILED', lastError?.message || 'Max retries exceeded');
  }

  getModel(): string { return this.model; }
  getDimensions(): number { return this.dimensions; }
}

// Create embedding text from document - handles all doc types (FR-2.5, FR-2.6)
function createEmbeddingText(doc: ParsedDocument): string {
  switch (doc.docType) {
    case 'table':
      return createTableEmbeddingText(doc as ParsedTableDoc);
    case 'column':
      return createColumnEmbeddingText(doc as ParsedColumnDoc);
    case 'domain':
      return createDomainEmbeddingText(doc as ParsedDomainDoc);
    case 'relationship':
      return createRelationshipEmbeddingText(doc as ParsedRelationshipDoc);
    case 'overview':
      return createOverviewEmbeddingText(doc as ParsedOverviewDoc);
    default:
      return doc.rawContent;
  }
}

function createTableEmbeddingText(doc: ParsedTableDoc): string {
  const parts = [
    `Table: ${doc.schema}.${doc.table}`,
    `Domain: ${doc.domain}`,
    `Description: ${doc.description}`,
    `Columns: ${doc.columns.map(c => `${c.name} (${c.description})`).join(', ')}`,
    `Keywords: ${doc.keywords.join(', ')}`
  ];
  return parts.join('\n');
}

function createColumnEmbeddingText(doc: ParsedColumnDoc): string {
  const parts = [
    `Column: ${doc.table}.${doc.column}`,
    `Type: ${doc.dataType}`,
    `Description: ${doc.description}`,
    doc.isPrimaryKey ? 'Primary Key' : '',
    doc.isForeignKey ? `Foreign Key to ${doc.foreignKeyTarget}` : '',
    `Keywords: ${doc.keywords.join(', ')}`
  ].filter(Boolean);
  return parts.join('\n');
}

function createDomainEmbeddingText(doc: ParsedDomainDoc): string {
  const parts = [
    `Domain: ${doc.domain}`,
    `Description: ${doc.description}`,
    `Tables: ${doc.tables.join(', ')}`,
    `Keywords: ${doc.keywords.join(', ')}`
  ];
  return parts.join('\n');
}

function createRelationshipEmbeddingText(doc: ParsedRelationshipDoc): string {
  const parts = [
    `Relationship: ${doc.sourceTable} -> ${doc.targetTable}`,
    `Type: ${doc.relationshipType}`,
    `Description: ${doc.description}`,
    `Join: ${doc.joinCondition}`,
    `Keywords: ${doc.keywords.join(', ')}`
  ];
  return parts.join('\n');
}

function createOverviewEmbeddingText(doc: ParsedOverviewDoc): string {
  const parts = [
    `Overview: ${doc.title}`,
    `Description: ${doc.description}`,
    `Keywords: ${doc.keywords.join(', ')}`
  ];
  return parts.join('\n');
}
```

### 4.6 Step 5: Populate Index

```typescript
async function populateIndex(
  db: Database,
  documents: ProcessedDocument[],
  embeddings: Map<string, number[]>,
  parentDocIds: Map<string, number>  // v1.2 fix: Map from parentTablePath to document ID
): Promise<IndexStats> {
  const stats = { inserted: 0, updated: 0, failed: 0 };

  // Use transaction for atomicity
  // v1.2 fix: Added parent_doc_id to INSERT for column-to-table linkage
  const insertDoc = db.prepare(`
    INSERT INTO documents (
      doc_type, database_name, schema_name, table_name, column_name,
      domain, content, summary, keywords, file_path, content_hash,
      source_modified_at, parent_doc_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(file_path) DO UPDATE SET
      content = excluded.content,
      summary = excluded.summary,
      keywords = excluded.keywords,
      content_hash = excluded.content_hash,
      parent_doc_id = excluded.parent_doc_id,
      indexed_at = CURRENT_TIMESTAMP
  `);

  const insertVec = db.prepare(`
    INSERT OR REPLACE INTO documents_vec (id, embedding) VALUES (?, ?)
  `);

  db.transaction(() => {
    for (const doc of documents) {
      try {
        // v1.2 fix: Resolve parent_doc_id for column documents
        let parentDocId: number | null = null;
        if (doc.docType === 'column' && doc.parentTablePath) {
          parentDocId = parentDocIds.get(doc.parentTablePath) || null;
          if (!parentDocId) {
            logger.warn(`Parent table doc not found for column ${doc.filePath}`);
          }
        }

        // Insert document (v1.2 fix: includes parent_doc_id)
        const result = insertDoc.run(
          doc.docType,
          doc.database,
          doc.schema,
          doc.table,
          doc.column,
          doc.domain,
          doc.content,
          doc.summary,
          JSON.stringify(doc.keywords),
          doc.filePath,
          doc.contentHash,
          doc.modifiedAt,
          parentDocId  // v1.2 fix: parent_doc_id for column→table linkage
        );

        // Track table doc IDs for later column linking
        if (doc.docType === 'table') {
          parentDocIds.set(doc.filePath, result.lastInsertRowid as number);
        }

        // Insert embedding
        const embedding = embeddings.get(doc.filePath);
        if (embedding) {
          const embeddingBlob = float32ArrayToBlob(embedding);
          insertVec.run(result.lastInsertRowid, embeddingBlob);
        }

        stats.inserted++;

      } catch (error) {
        logger.error(`Failed to index ${doc.filePath}`, error);
        stats.failed++;
      }
    }
  })();

  return stats;
}

/**
 * v1.2 fix: Ensure documents are sorted so table docs are indexed before their columns
 * This allows parent_doc_id to be resolved correctly
 */
function sortDocumentsForIndexing(documents: ProcessedDocument[]): ProcessedDocument[] {
  return [...documents].sort((a, b) => {
    // Tables first, then other types, columns last
    const order = { table: 0, domain: 1, overview: 2, relationship: 3, column: 4 };
    return (order[a.docType] ?? 99) - (order[b.docType] ?? 99);
  });
}
```

### 4.7 Step 6: Build Relationships Index

```typescript
async function buildRelationshipsIndex(db: Database): Promise<void> {
  logger.info('Building relationships index');

  // 1. Extract foreign keys from parsed table documents
  const fkQuery = db.prepare(`
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

  const tables = fkQuery.all() as TableRow[];

  db.transaction(() => {
    for (const table of tables) {
      const foreignKeys = extractForeignKeysFromContent(table.content);

      for (const fk of foreignKeys) {
        const joinSql = generateJoinSQL(table, fk);

        insertRel.run(
          table.database_name,
          table.schema_name,
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
      }
    }
  })();

  // v1.2 fix: Also index explicit relationship documents (FR-2.6)
  await indexExplicitRelationshipDocs(db);

  // 2. Compute multi-hop join paths using BFS
  await computeMultiHopPaths(db);
}

/**
 * v1.2 fix: Index explicit relationship documentation files
 * These are standalone markdown files in the relationships/ folder
 * that describe relationships not captured by FK constraints
 */
async function indexExplicitRelationshipDocs(db: Database): Promise<void> {
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

  const relDocs = relDocsQuery.all() as { id: number; database_name: string; content: string }[];

  db.transaction(() => {
    for (const relDoc of relDocs) {
      // Re-parse the content to extract relationship details
      // (Alternatively, store parsed data in a JSON column)
      const parsed = parseRelationshipFromContent(relDoc.content);

      if (parsed.sourceTable && parsed.targetTable) {
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
          parsed.joinCondition || '',
          0.9  // Slightly lower confidence for documented (vs FK constraint)
        );

        logger.debug(`Indexed explicit relationship: ${parsed.sourceTable} -> ${parsed.targetTable}`);
      }
    }
  })();
}

/**
 * v1.2 fix: Parse relationship details from document content
 * Extracts structured data from markdown relationship documentation
 */
function parseRelationshipFromContent(content: string): {
  sourceSchema?: string;
  sourceTable?: string;
  sourceColumn?: string;
  targetSchema?: string;
  targetTable?: string;
  targetColumn?: string;
  relationshipType?: string;
  joinCondition?: string;
} {
  const { frontmatter, body } = extractFrontmatter(content);

  // Try frontmatter first
  if (frontmatter) {
    return {
      sourceSchema: frontmatter.source_schema,
      sourceTable: frontmatter.source_table,
      sourceColumn: frontmatter.source_column,
      targetSchema: frontmatter.target_schema,
      targetTable: frontmatter.target_table,
      targetColumn: frontmatter.target_column,
      relationshipType: frontmatter.relationship_type,
      joinCondition: frontmatter.join_sql
    };
  }

  // Fall back to parsing markdown content
  const sections = parseMarkdownSections(body);

  return {
    sourceTable: extractFromSection(sections, 'Source Table') || extractFromSection(sections, 'From'),
    targetTable: extractFromSection(sections, 'Target Table') || extractFromSection(sections, 'To'),
    sourceColumn: extractFromSection(sections, 'Source Column'),
    targetColumn: extractFromSection(sections, 'Target Column'),
    relationshipType: extractFromSection(sections, 'Type') || extractFromSection(sections, 'Relationship Type'),
    joinCondition: extractFromSection(sections, 'Join') || extractFromSection(sections, 'SQL')
  };
}

async function computeMultiHopPaths(db: Database, maxHops: number = 3): Promise<void> {
  // Build adjacency list from direct relationships
  const directRels = db.prepare(`
    SELECT database_name, source_schema, source_table, source_column,
           target_schema, target_table, target_column, join_sql
    FROM relationships
    WHERE hop_count = 1
  `).all() as DirectRelationship[];

  const graph = buildAdjacencyGraph(directRels);

  // For each pair of tables, find shortest path up to maxHops
  const allTables = new Set<string>();
  directRels.forEach(r => {
    allTables.add(`${r.source_schema}.${r.source_table}`);
    allTables.add(`${r.target_schema}.${r.target_table}`);
  });

  const insertPath = db.prepare(`
    INSERT OR IGNORE INTO relationships (
      database_name, source_schema, source_table, source_column,
      target_schema, target_table, target_column,
      relationship_type, hop_count, join_sql, confidence
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'computed', ?, ?, ?)
  `);

  // Get database name (assume single database for now)
  const databaseName = directRels[0]?.database_name || 'unknown';

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
        }
      }
    }
  })();

  logger.info(`Computed ${allTables.size * (allTables.size - 1)} potential multi-hop paths`);
}

interface PathHop {
  sourceSchema: string;
  sourceTable: string;
  sourceColumn: string;
  targetSchema: string;
  targetTable: string;
  targetColumn: string;
  joinSql: string;
}

interface JoinPath {
  hops: PathHop[];
  tables: string[];
}

/**
 * BFS to find shortest path between two tables (FR-2.11)
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
          tables: [source, ...path.map(h => `${h.targetSchema}.${h.targetTable}`), target]
        };
      }

      if (!visited.has(nextTable)) {
        visited.add(nextTable);
        queue.push({
          table: nextTable,
          path: [...path, edge]
        });
      }
    }
  }

  return null;  // No path found within maxHops
}

/**
 * Generate complete JOIN SQL for multi-hop path (FR-2.11)
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
      joinSql: rel.join_sql
    });
  }

  return graph;
}
```

### 4.8 Step 7: Optimize Database

```typescript
async function optimizeDatabase(db: Database, manifest: DocumentationManifest): Promise<void> {
  logger.info('Optimizing database');

  // 1. Optimize FTS5 index
  db.exec("INSERT INTO documents_fts(documents_fts) VALUES('optimize')");

  // 2. Update statistics for query planner
  db.exec('ANALYZE');

  // 3. Reclaim space
  db.exec('VACUUM');

  // 4. Update index metadata (Gap 5 fix - include manifest_hash and plan_hash)
  const updateMeta = db.prepare(`
    INSERT OR REPLACE INTO index_metadata (key, value) VALUES (?, ?)
  `);

  // Gather counts by doc type
  const docCount = db.prepare('SELECT COUNT(*) as count FROM documents').get() as { count: number };
  const embCount = db.prepare('SELECT COUNT(*) as count FROM documents_vec').get() as { count: number };
  const tableCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'table'").get() as { count: number };
  const columnCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'column'").get() as { count: number };
  const domainCount = db.prepare("SELECT COUNT(*) as count FROM documents WHERE doc_type = 'domain'").get() as { count: number };
  const relCount = db.prepare('SELECT COUNT(*) as count FROM relationships').get() as { count: number };

  db.transaction(() => {
    // Timestamps
    updateMeta.run('last_full_index', new Date().toISOString());
    updateMeta.run('index_version', '1.0');

    // Provenance hashes (CRITICAL for staleness detection per Gap 5)
    updateMeta.run('manifest_hash', computeSHA256(JSON.stringify(manifest)));
    updateMeta.run('plan_hash', manifest.plan_hash);

    // Counts
    updateMeta.run('document_count', String(docCount.count));
    updateMeta.run('embedding_count', String(embCount.count));
    updateMeta.run('table_count', String(tableCount.count));
    updateMeta.run('column_count', String(columnCount.count));
    updateMeta.run('domain_count', String(domainCount.count));
    updateMeta.run('relationship_count', String(relCount.count));

    // Embedding config
    updateMeta.run('embedding_model', 'text-embedding-3-small');
    updateMeta.run('embedding_dimensions', '1536');
  })();

  logger.info(`Index metadata updated: ${docCount.count} docs, ${embCount.count} embeddings, ${relCount.count} relationships`);
}
```

---

## 5. Incremental Indexing

### 5.1 Change Detection Strategy

The Indexer supports incremental updates through content hash comparison:

```typescript
interface IncrementalIndexResult {
  newFiles: string[];
  changedFiles: string[];
  unchangedFiles: string[];
  deletedFiles: string[];
}

async function detectChanges(
  manifest: DocumentationManifest,
  db: Database
): Promise<IncrementalIndexResult> {
  const result: IncrementalIndexResult = {
    newFiles: [],
    changedFiles: [],
    unchangedFiles: [],
    deletedFiles: []
  };

  // Get existing indexed files
  const existingFiles = new Map<string, string>();
  const rows = db.prepare('SELECT file_path, content_hash FROM documents').all();
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

  // Find deleted files
  for (const [filePath] of existingFiles) {
    if (!manifestFiles.has(filePath)) {
      result.deletedFiles.push(filePath);
    }
  }

  return result;
}
```

### 5.2 Selective Re-indexing

```typescript
/**
 * v1.2 fix: Corrected incremental indexing flow
 * - indexFiles() and optimizeDatabase() are called in runIncrementalIndex where
 *   filesToProcess and manifest are in scope
 * - deleteDocumentsWithCascade() is a pure deletion helper, does not do indexing
 */
async function runIncrementalIndex(options: IncrementalOptions): Promise<void> {
  const manifest = await validateAndLoadManifest();
  const db = await openDatabase();

  const changes = await detectChanges(manifest, db);

  logger.info(`Incremental index: ${changes.newFiles.length} new, ${changes.changedFiles.length} changed, ${changes.deletedFiles.length} deleted`);

  // Skip if no changes
  if (changes.newFiles.length === 0 &&
      changes.changedFiles.length === 0 &&
      changes.deletedFiles.length === 0) {
    logger.info('No changes detected, skipping indexing');
    db.close();
    return;
  }

  // Process only changed/new files
  const filesToProcess = [...changes.newFiles, ...changes.changedFiles];

  // v1.2 fix: Delete removed files FIRST (cascade helper is now pure deletion)
  if (changes.deletedFiles.length > 0) {
    await deleteDocumentsWithCascade(db, changes.deletedFiles);
  }

  // v1.2 fix: Index new/changed files HERE (not in cascade helper)
  if (filesToProcess.length > 0) {
    await indexFiles(db, filesToProcess, manifest);
  }

  // v1.2 fix: Rebuild relationships if any table files changed
  const tableFilesChanged = filesToProcess.some(f => f.includes('/tables/')) ||
                            changes.deletedFiles.some(f => f.includes('/tables/'));
  if (tableFilesChanged) {
    await buildRelationshipsIndex(db);
  }

  // v1.2 fix: Optimize database HERE (not in cascade helper)
  await optimizeDatabase(db, manifest);

  db.close();
  logger.info(`Incremental indexing complete: ${filesToProcess.length} files processed, ${changes.deletedFiles.length} deleted`);
}

/**
 * Delete documents and cascade to related tables (Gap 3 fix)
 * Ensures no stale vectors or relationships remain after file deletion
 *
 * v1.2 fix: This is now a PURE deletion helper - does not call indexFiles/optimizeDatabase
 * Those calls are made by the caller (runIncrementalIndex) where the required args are in scope
 */
async function deleteDocumentsWithCascade(db: Database, filePaths: string[]): Promise<void> {
  // Get document IDs first
  const getIdStmt = db.prepare('SELECT id, doc_type, database_name, schema_name, table_name FROM documents WHERE file_path = ?');
  const deleteDocStmt = db.prepare('DELETE FROM documents WHERE id = ?');
  const deleteVecStmt = db.prepare('DELETE FROM documents_vec WHERE id = ?');
  const deleteChildDocsStmt = db.prepare('DELETE FROM documents WHERE parent_doc_id = ?');
  const deleteRelBySourceStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND source_schema = ? AND source_table = ?
  `);
  const deleteRelByTargetStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND target_schema = ? AND target_table = ?
  `);
  // v1.2 fix: Also handle explicit relationship doc files
  const deleteRelDocStmt = db.prepare(`
    DELETE FROM relationships
    WHERE database_name = ? AND source_table = ? AND target_table = ?
  `);

  db.transaction(() => {
    for (const filePath of filePaths) {
      const doc = getIdStmt.get(filePath) as { id: number; doc_type: string; database_name: string; schema_name: string; table_name: string } | undefined;

      if (!doc) continue;

      // 1. Delete vector embedding
      deleteVecStmt.run(doc.id);

      // 2. If table doc, delete child column docs and their vectors
      if (doc.doc_type === 'table') {
        const childDocs = db.prepare('SELECT id FROM documents WHERE parent_doc_id = ?').all(doc.id) as { id: number }[];
        for (const child of childDocs) {
          deleteVecStmt.run(child.id);
        }
        deleteChildDocsStmt.run(doc.id);

        // 3. Delete relationships involving this table (as source or target)
        deleteRelBySourceStmt.run(doc.database_name, doc.schema_name, doc.table_name);
        deleteRelByTargetStmt.run(doc.database_name, doc.schema_name, doc.table_name);
      }

      // v1.2 fix: Handle explicit relationship doc type
      if (doc.doc_type === 'relationship') {
        // Extract source/target tables from the relationship doc content or path
        const relInfo = extractRelationshipInfoFromDoc(doc);
        if (relInfo) {
          deleteRelDocStmt.run(doc.database_name, relInfo.sourceTable, relInfo.targetTable);
        }
      }

      // 4. Delete the document itself
      deleteDocStmt.run(doc.id);

      logger.debug(`Deleted document and cascaded: ${filePath}`);
    }
  })();
}

/**
 * v1.2 fix: Extract relationship source/target info from a relationship document
 * Used by cascade deletion to remove the corresponding relationships record
 */
function extractRelationshipInfoFromDoc(doc: { id: number; doc_type: string; database_name: string; schema_name: string; table_name: string }): { sourceTable: string; targetTable: string } | null {
  // The table_name field for relationship docs may encode "sourceTable_to_targetTable"
  // or we may need to query the document content
  // This is implementation-specific - adjust based on actual doc structure
  if (!doc.table_name) return null;

  const parts = doc.table_name.split('_to_');
  if (parts.length === 2) {
    return { sourceTable: parts[0], targetTable: parts[1] };
  }
  return null;
}
```

---

## 5.3 Resume Logic (Gap 7)

The Indexer supports resuming from checkpoints after crashes or interruptions.

### 5.3.1 Checkpoint Strategy

```typescript
interface CheckpointData {
  manifest_hash: string;
  indexed_files: string[];
  failed_files: { path: string; error: string }[];
  pending_files: string[];
  last_checkpoint_at: ISOTimestamp;
  phase: 'parsing' | 'embedding' | 'indexing' | 'relationships';
}

const CHECKPOINT_INTERVAL = 100;  // Save every 100 files

async function saveCheckpoint(progress: IndexerProgress): Promise<void> {
  const checkpointPath = 'progress/indexer-progress.json';
  progress.last_checkpoint = new Date().toISOString();
  await fs.writeFile(checkpointPath, JSON.stringify(progress, null, 2));
  logger.debug(`Checkpoint saved: ${progress.files_indexed}/${progress.files_total} files`);
}

/**
 * v1.2 fix: Initialize progress with stable manifest hash
 * Called when starting a fresh index run
 */
function initializeProgress(manifest: DocumentationManifest): IndexerProgress {
  return {
    schema_version: '1.0',
    started_at: new Date().toISOString(),
    completed_at: null,
    status: 'running',
    manifest_file: 'docs/documentation-manifest.json',
    manifest_hash: computeStableManifestHash(manifest),  // v1.2 fix: Use stable hash
    files_total: manifest.indexable_files.length,
    files_indexed: 0,
    files_failed: 0,
    files_skipped: 0,
    current_phase: 'validating',
    embeddings_generated: 0,
    embeddings_failed: 0,
    last_checkpoint: new Date().toISOString(),
    indexed_files: [],
    failed_files: [],
    pending_files: manifest.indexable_files.map(f => f.path),
    errors: [],
    stats: {
      parse_time_ms: 0,
      embedding_time_ms: 0,
      index_time_ms: 0,
      total_time_ms: 0,
      table_docs: 0,
      column_docs: 0,
      domain_docs: 0,
      relationship_docs: 0
    }
  };
}
```

### 5.3.2 Resume from Checkpoint

```typescript
/**
 * v1.2 fix: Compute stable hash for manifest comparison
 * JSON.stringify() does not guarantee key order, which can cause false restarts.
 * Use a stable serialization or the manifest's own manifest_hash field.
 */
function computeStableManifestHash(manifest: DocumentationManifest): string {
  // Option 1: Use the manifest's own hash if available (preferred)
  // The Documenter agent should provide this hash
  if (manifest.plan_hash) {
    // Combine plan_hash with indexable_files info for completeness
    const fileHashes = manifest.indexable_files
      .map(f => `${f.path}:${f.content_hash}`)
      .sort()
      .join('|');
    return computeSHA256(`${manifest.plan_hash}|${fileHashes}`);
  }

  // Option 2: Stable JSON serialization with sorted keys
  const stableJson = JSON.stringify(manifest, Object.keys(manifest).sort());
  return computeSHA256(stableJson);
}

async function runIndexerWithResume(options: IndexerOptions): Promise<void> {
  const progressPath = 'progress/indexer-progress.json';

  // Check for existing progress
  if (options.resume && await fs.pathExists(progressPath)) {
    const existingProgress = await readJSON(progressPath) as IndexerProgress;

    // Validate checkpoint is usable
    if (existingProgress.status === 'running' || existingProgress.status === 'failed') {
      const manifest = await validateAndLoadManifest();

      // v1.2 fix: Use stable hash comparison to avoid false restarts
      const currentManifestHash = computeStableManifestHash(manifest);
      if (existingProgress.manifest_hash === currentManifestHash) {
        logger.info(`Resuming from checkpoint: ${existingProgress.files_indexed}/${existingProgress.files_total} files already indexed`);
        return resumeFromCheckpoint(existingProgress, manifest);
      } else {
        logger.warn('Manifest changed since last run, starting fresh');
        logger.debug(`Old hash: ${existingProgress.manifest_hash}, New hash: ${currentManifestHash}`);
      }
    }
  }

  // Fresh start
  return runFreshIndex(options);
}

async function resumeFromCheckpoint(
  progress: IndexerProgress,
  manifest: DocumentationManifest
): Promise<void> {
  const db = await openDatabase();

  // Get files that still need processing
  const alreadyIndexed = new Set(progress.indexed_files);
  const alreadyFailed = new Set(progress.failed_files);

  const pendingFiles = manifest.indexable_files.filter(
    f => !alreadyIndexed.has(f.path) && !alreadyFailed.has(f.path)
  );

  logger.info(`Resuming: ${pendingFiles.length} files remaining`);

  // Update progress
  progress.status = 'running';
  progress.pending_files = pendingFiles.map(f => f.path);
  await saveCheckpoint(progress);

  // Continue processing
  await processFiles(db, pendingFiles, manifest, progress);

  // Complete
  progress.status = progress.files_failed > 0 ? 'partial' : 'completed';
  progress.completed_at = new Date().toISOString();
  await saveCheckpoint(progress);

  await optimizeDatabase(db, manifest);
}

async function processFiles(
  db: Database,
  files: IndexableFile[],
  manifest: DocumentationManifest,
  progress: IndexerProgress
): Promise<void> {
  for (let i = 0; i < files.length; i++) {
    const file = files[i];

    try {
      progress.current_file = file.path;

      // Parse, extract keywords, embed, index
      const doc = await parseDocument(file);
      const embedding = await generateEmbedding(doc);
      await insertDocument(db, doc, embedding);

      // Track success
      progress.indexed_files.push(file.path);
      progress.files_indexed++;
      progress.pending_files = progress.pending_files.filter(f => f !== file.path);

    } catch (error) {
      logger.error(`Failed to index ${file.path}`, error);
      progress.failed_files.push(file.path);
      progress.files_failed++;
      progress.errors.push({
        code: 'IDX_FILE_FAILED',
        message: error.message,
        context: { file: file.path }
      });
    }

    // Checkpoint periodically
    if ((i + 1) % CHECKPOINT_INTERVAL === 0) {
      await saveCheckpoint(progress);
    }
  }
}
```

### 5.3.3 CLI Resume Flag

```bash
# Resume from last checkpoint
npm run index -- --resume

# Force fresh start (ignore checkpoint)
npm run index -- --force

# Show checkpoint status
npm run index -- --status
```

---

## 6. Error Handling

### 6.1 Error Codes

| Code | Severity | Recoverable | Description |
|------|----------|-------------|-------------|
| `IDX_MANIFEST_NOT_FOUND` | fatal | No | documentation-manifest.json doesn't exist |
| `IDX_MANIFEST_INVALID` | fatal | No | Manifest fails schema validation |
| `IDX_FILE_NOT_FOUND` | error | Yes | File in manifest doesn't exist on disk |
| `IDX_FILE_HASH_MISMATCH` | warning | Yes | File changed since manifest created |
| `IDX_PARSE_FAILED` | error | Yes | Failed to parse markdown file |
| `IDX_EMBEDDING_FAILED` | warning | Yes | OpenAI API call failed |
| `IDX_EMBEDDING_RATE_LIMITED` | warning | Yes | Rate limited, will retry |
| `IDX_DB_WRITE_FAILED` | error | Yes | SQLite write failed |
| `IDX_FTS_FAILED` | error | Yes | FTS5 index operation failed |
| `IDX_VECTOR_FAILED` | warning | Yes | Vector index operation failed |

### 6.2 Graceful Degradation

```typescript
async function indexWithFallbacks(
  db: Database,
  documents: ProcessedDocument[]
): Promise<IndexStats> {
  let embeddings: Map<string, number[]> = new Map();

  // Try to generate embeddings
  try {
    const texts = documents.map(d => createEmbeddingText(d));
    const embeddingResults = await embeddingService.generateBatch(texts);

    embeddingResults.forEach((result, i) => {
      embeddings.set(documents[i].filePath, result.embedding);
    });

  } catch (error) {
    logger.warn('Embedding generation failed, continuing with FTS only', error);
    // Continue without embeddings - FTS will still work
  }

  // Index documents (with or without embeddings)
  const stats = await populateIndex(db, documents, embeddings);

  if (embeddings.size === 0) {
    logger.warn('Search quality degraded: vector search unavailable');
  }

  return stats;
}
```

---

## 7. Configuration

### 7.1 Agent Config Section

```yaml
# config/agent-config.yaml

indexer:
  # Embedding configuration
  embedding_model: text-embedding-3-small
  embedding_batch_size: 50
  embedding_max_retries: 3
  embedding_retry_backoff_ms: 1000

  # Processing configuration
  checkpoint_interval: 100        # Save progress every N files
  parse_timeout_ms: 5000          # Max time to parse single file

  # Database configuration
  db_path: data/tribal-knowledge.db

  # FTS configuration
  fts_tokenizer: porter unicode61

  # Incremental indexing
  enable_incremental: true
  force_full_reindex: false
```

### 7.2 Environment Variables

```bash
# Required
OPENAI_API_KEY=sk-...          # For embeddings

# Optional
TRIBAL_DB_PATH=./data/tribal-knowledge.db
TRIBAL_DOCS_PATH=./docs
TRIBAL_LOG_LEVEL=info
```

---

## 8. CLI Interface

```bash
# Full index (from manifest)
npm run index

# Incremental index (detect and index changes only)
npm run index -- --incremental

# Force full re-index (ignore change detection)
npm run index -- --force

# Index specific work unit's files only
npm run index -- --work-unit=production_customers

# Skip embedding generation (FTS only)
npm run index -- --skip-embeddings

# Resume from checkpoint
npm run index -- --resume

# Dry run (show what would be indexed)
npm run index -- --dry-run

# Verify index integrity
npm run index:verify

# Show index statistics
npm run index:stats
```

---

## 9. Implementation Checklist (Updated for v1.2)

### Phase 1: Foundation
- [ ] Create `src/agents/indexer/types.ts` with all interfaces (table, column, domain, overview, relationship)
- [ ] Implement manifest validation (`src/agents/indexer/manifest.ts`)
- [ ] Implement markdown parser (`src/agents/indexer/parsers/markdown.ts`)
- [ ] Create database initialization (`src/agents/indexer/database/init.ts`) with index_weights table
- [ ] Add basic progress tracking with resume support fields

### Phase 2: Document Parsers (Gap 1, Gap 2, v1.2)
- [ ] Implement table document parser
- [ ] Implement domain document parser (Gap 2)
- [ ] Implement overview document parser (Gap 2)
- [ ] Implement column document generator from table docs (Gap 1 - FR-2.5)
- [ ] **v1.2**: Add `rawContent` field to ParsedColumnDoc with `generateColumnRawContent()`
- [ ] **v1.2**: Implement `parseRelationshipDocument()` for explicit relationship files (FR-2.6)
- [ ] **v1.2**: Implement `extractKeywordsFromRelationship()` for relationship keyword extraction
- [ ] Unit tests for all parsers including relationship parser

### Phase 3: Keyword Extraction
- [ ] Implement identifier splitter
- [ ] Add abbreviation expansion
- [ ] Create data pattern detection
- [ ] Implement noun extraction from descriptions
- [ ] Add column-specific keyword extraction (Gap 1)
- [ ] **v1.2**: Add relationship-specific keyword extraction (join, reference, fk, etc.)
- [ ] Unit tests for keyword extraction

### Phase 4: Embedding Generation (Gap 1)
- [ ] Implement embedding text generation for all doc types (table, column, domain, relationship, overview)
- [ ] Use `generateEmbeddings` from `src/utils/llm.ts`
- [ ] Add fallback for API failures (FTS-only mode)
- [ ] Add token usage tracking
- [ ] **v1.2**: Ensure all ParsedDoc types have `rawContent` for fallback embedding

### Phase 5: Index Population (v1.2)
- [ ] Implement document insertion with UPSERT for all doc types
- [ ] Add FTS5 triggers
- [ ] Implement vector storage with sqlite-vec
- [ ] Add transaction handling
- [ ] **v1.2**: Implement `sortDocumentsForIndexing()` to ensure tables indexed before columns
- [ ] **v1.2**: Add `parent_doc_id` to INSERT/UPSERT statement
- [ ] **v1.2**: Pass `parentDocIds` map to `populateIndex()` for column→table linkage
- [ ] Populate index_weights table (Gap 6)

### Phase 6: Relationships (Gap 4, v1.2)
- [ ] Implement FK extraction from parsed docs
- [ ] Build adjacency graph
- [ ] Implement BFS for multi-hop paths with complete logic
- [ ] Generate complete JOIN SQL snippets
- [ ] Add confidence scoring
- [ ] **v1.2**: Implement `indexExplicitRelationshipDocs()` for relationship markdown files
- [ ] **v1.2**: Implement `parseRelationshipFromContent()` for extracting rel info from docs
- [ ] Unit tests for BFS and SQL generation

### Phase 7: Incremental Support (Gap 3, v1.2)
- [ ] Implement change detection
- [ ] **v1.2**: Fix `runIncrementalIndex()` to call `indexFiles()` and `optimizeDatabase()` correctly
- [ ] **v1.2**: Make `deleteDocumentsWithCascade()` a pure deletion helper (no indexing calls)
- [ ] Implement cascade delete (documents → vectors → child docs → relationships)
- [ ] **v1.2**: Handle explicit relationship doc type in cascade deletion
- [ ] **v1.2**: Implement `extractRelationshipInfoFromDoc()` for relationship cascade
- [ ] Add CLI flags for incremental mode

### Phase 8: Resume Support (Gap 7, v1.2)
- [ ] Implement checkpoint saving (every 100 files)
- [ ] Implement resume from checkpoint logic
- [ ] Add indexed_files/failed_files/pending_files tracking
- [ ] **v1.2**: Implement `computeStableManifestHash()` for stable hash comparison
- [ ] **v1.2**: Implement `initializeProgress()` that uses stable hash
- [ ] Add --resume and --status CLI flags
- [ ] Test resume after simulated crash

### Phase 9: Metadata & Provenance (Gap 5)
- [ ] Persist manifest_hash in index_metadata
- [ ] Persist plan_hash in index_metadata
- [ ] Add per-doc-type counts to metadata
- [ ] Implement staleness detection for Retriever

### Phase 10: Integration & Testing (Gap 8, v1.2)
- [ ] Integration test: manifest → SQLite (all doc types)
- [ ] Test cascade deletes (stale cleanup)
- [ ] Test vector fallback mode
- [ ] Test multi-hop join path correctness
- [ ] Test resume from checkpoint
- [ ] **v1.2**: Test incremental indexing with new/changed/deleted files
- [ ] **v1.2**: Test parent_doc_id linkage for column docs
- [ ] **v1.2**: Test relationship doc parsing and indexing
- [ ] **v1.2**: Test stable hash prevents false resume restarts
- [ ] Test with Retriever agent
- [ ] Performance testing
- [ ] Create test fixtures

---

## 10. Success Metrics

| Metric | Target |
|--------|--------|
| Indexing throughput | >100 documents/minute |
| Embedding success rate | >99% |
| FTS search latency (p95) | <100ms |
| Vector search latency (p95) | <200ms |
| Index size (per 100 tables) | <50MB |
| Incremental index time | <30 seconds for partial updates |
| Change detection accuracy | 100% |

---

## 11. Dependencies

### 11.1 NPM Packages

```json
{
  "dependencies": {
    "better-sqlite3": "^9.x",
    "openai": "^4.x",
    "gray-matter": "^4.x",
    "marked": "^11.x",
    "zod": "^3.x"
  },
  "optionalDependencies": {
    "sqlite-vec": "^0.x"
  }
}
```

### 11.2 External Services

- **OpenAI API**: For text-embedding-3-small embeddings
- No other external dependencies

---

## 12. Testing Strategy (Gap 8 - Expanded)

### 12.1 Unit Tests

| Test Area | Test Cases |
|-----------|------------|
| **Manifest Validation** | Valid manifest passes, missing fields rejected, invalid status rejected, file hash mismatch detected |
| **Markdown Parsing** | Table doc parsing, domain doc parsing, overview doc parsing, frontmatter extraction, section extraction |
| **Keyword Extraction** | Identifier splitting, abbreviation expansion, data type keywords, constraint keywords |
| **Hash Computation** | SHA-256 correctness, consistent hashing, empty content handling |
| **SQL Generation** | Single-hop JOIN, multi-hop JOIN, LEFT vs INNER JOIN |
| **Column Doc Generation** | Column extraction from table, FK detection, PK detection, keyword inheritance |

### 12.2 Integration Tests

| Test Scenario | Description | Verification |
|---------------|-------------|--------------|
| **Full Pipeline** | Index sample docs from manifest | All doc types indexed, FTS works, vector search works |
| **Incremental - New Files** | Add new file to manifest | Only new file indexed, existing unchanged |
| **Incremental - Changed Files** | Modify file content | File re-indexed, hash updated |
| **Incremental - Deleted Files** | Remove file from manifest | Document, vector, and relationships all deleted (Gap 3) |
| **Partial Manifest** | Manifest with status='partial' | Available files indexed, missing files skipped gracefully |
| **Resume from Checkpoint** | Kill indexer mid-run, resume | Continues from last checkpoint, no duplicates (Gap 7) |
| **Embedding Fallback** | Simulate OpenAI API failure | FTS index works, vector index empty, warning logged |
| **Multi-hop Paths** | Tables with 2-3 hop relationships | BFS finds paths, JOIN SQL correct, confidence scores calculated (Gap 4) |

### 12.3 Edge Case Tests (Gap 8 - New)

| Edge Case | Test Scenario | Expected Behavior |
|-----------|---------------|-------------------|
| **Stale Delete Cleanup** | Delete table with columns and relationships | All child docs deleted, vectors deleted, relationships deleted |
| **Vector Fallback** | sqlite-vec unavailable | Fall back to blob storage, search still works |
| **Circular FK** | Table A → B → C → A | BFS handles cycles, no infinite loop |
| **Empty Domain** | Domain doc with no tables | Indexed with empty tables array |
| **Large Content** | Table with 500+ columns | Column docs generated, embedding truncated if needed |
| **Unicode Content** | Table/column names with Unicode | Correctly parsed and indexed |
| **Duplicate File Paths** | Same file in manifest twice | UPSERT handles gracefully |
| **Manifest Hash Mismatch** | Tampered manifest | Validation fails, clear error message |

### 12.4 Contract Verification Tests

| Contract | Test | Verification |
|----------|------|--------------|
| **Documenter → Indexer** | Manifest schema validation | All required fields present, types correct |
| **Indexer → Retriever** | SQLite schema check | All tables exist, indexes present, FTS5 working |
| **Index Weights** | Hybrid search scoring | Doc type weights applied correctly (FR-2.10) |
| **Metadata Provenance** | manifest_hash persistence | Retriever can verify index freshness (Gap 5) |

### 12.5 Performance Tests

| Test | Target | Measurement |
|------|--------|-------------|
| **Throughput** | >100 docs/minute | Time to index 500 sample docs |
| **Embedding Latency** | <500ms/batch | Time per 50-doc embedding batch |
| **FTS Search** | <100ms p95 | Query latency on 1000-doc index |
| **Vector Search** | <200ms p95 | Query latency on 1000-doc index |
| **Index Size** | <50MB per 100 tables | Database file size |
| **Memory Usage** | <512MB peak | Memory during large index |
| **Resume Overhead** | <5s | Time to resume from checkpoint |

### 12.6 Test Data Fixtures

```
tests/fixtures/
├── manifests/
│   ├── valid-complete.json      # Full valid manifest
│   ├── valid-partial.json       # Partial status manifest
│   ├── invalid-missing-fields.json
│   └── invalid-status.json
├── docs/
│   ├── sample-table.md          # Sample table documentation
│   ├── sample-domain.md         # Sample domain documentation
│   ├── sample-overview.md       # Sample overview documentation
│   └── malformed.md             # Malformed markdown for error testing
└── expected/
    ├── parsed-table.json        # Expected parse output
    ├── keywords.json            # Expected extracted keywords
    └── relationships.json       # Expected relationship records
```

---

*End of Indexer Agent Plan*

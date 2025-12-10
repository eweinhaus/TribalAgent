# Tribal Knowledge Deep Agent
## Technical Specification (PRD2)

**Version**: 1.1  
**Date**: December 9, 2025  
**Author**: Myles  
**Status**: Draft  
**Change**: Added Deep Agent properties (Planning, Sub-agents, System Prompts)

---

## 1. System Architecture

### 1.1 Architecture Overview

The system follows a deep agent architecture with explicit planning, sub-agent delegation, filesystem-based persistent memory, and configurable system prompts. Each agent has a single responsibility and communicates through the filesystem and SQLite database.

**Architecture Style**: Deep Agent Pipeline with Planning

**Communication Pattern**: Filesystem-based (agents read/write files and database)

**Execution Model**: Plan → Execute → Index → Serve (manual triggers, no autonomous behavior)

### 1.2 Component Breakdown

**Planner: Schema Analyzer** *(NEW - Deep Agent)*
- Responsibility: Analyze database structure, detect domains, create documentation plan
- Input: Catalog configuration file, environment credentials
- Output: documentation-plan.json with prioritized table list
- State: Plan file serves as contract for documenter

**Agent 1: Database Documenter**
- Responsibility: Execute documentation plan using sub-agents
- Input: documentation-plan.json, prompt templates
- Output: Markdown, JSON Schema, and YAML files in /docs directory
- State: Progress tracked in documenter-progress.json
- Sub-agents: TableDocumenter, ColumnInferencer

**Agent 2: Document Indexer**
- Responsibility: Parse documentation, extract keywords, generate embeddings, build search index
- Input: Documentation files from /docs directory
- Output: Populated SQLite database with FTS5 and vector indices
- State: Progress tracked in indexer-progress.json

**Agent 3: Index Retrieval**
- Responsibility: Handle search queries, perform hybrid search, return context-aware results
- Input: Function calls from external MCP (MCP tools implemented in separate repo)
- Output: Structured JSON responses with search results
- State: Stateless (reads from database)

### 1.3 Sub-Agent Architecture *(NEW - Deep Agent)*

**TableDocumenter Sub-agent**
- Purpose: Handle complete documentation of a single table
- Spawned by: Agent 1 Documenter (one per table)
- Responsibilities:
  - Receive metadata from plan (extracted by Schema Analyzer)
  - Sample data from table
  - Spawn ColumnInferencer for each column
  - Generate complete markdown file (human-readable)
  - Generate JSON output file (for planner consumption)
  - Return summary to parent documenter
- Context Quarantine: Returns only summary, not raw data

**ColumnInferencer Sub-agent**
- Purpose: Generate semantic description for a single column
- Spawned by: TableDocumenter (one per column)
- Responsibilities:
  - Load column-description.md prompt template
  - Format prompt with column metadata and samples
  - Call LLM for semantic inference
  - Return description string to parent
- Context Quarantine: Returns only description string

### 1.4 Data Flow

Step 1: User triggers `npm run plan` (manual)
Step 2: Planner reads databases.yaml, connects to each database
Step 3: Planner counts tables, analyzes relationships, extracts metadata for each table
Step 4: Planner detects domains, prioritizes tables
Step 5: Planner writes documentation-plan.json with complete table metadata
Step 6: User reviews plan, optionally modifies
Step 7: User triggers `npm run document` (manual)
Step 8: Documenter reads plan (Planner has already iterated through all tables and extracted metadata)
Step 9: Documenter spawns TableDocumenter sub-agent for each table entry in plan
Step 10: TableDocumenter receives complete metadata from plan (no extraction needed), samples data, spawns ColumnInferencer per column
Step 11: Each ColumnInferencer loads prompt template, calls LLM, returns description
Step 12: TableDocumenter assembles markdown and JSON outputs, writes to /docs, returns summary
Step 13: Documenter updates progress, continues to next table
Step 13: User triggers `npm run index` (manual)
Step 14: Indexer reads /docs, extracts keywords, generates embeddings
Step 15: Indexer populates SQLite with documents, FTS5 index, vectors
Step 16: User triggers `npm run serve` (manual)
Step 17: MCP server starts, exposes tools
Step 18: External agents call tools, receive context-budgeted responses

### 1.5 Directory Structure

```
tribal-knowledge/
├── src/
│   ├── planner/                 # Schema Analyzer (NEW)
│   ├── agents/
│   │   ├── documenter/          # Agent 1 modules
│   │   │   ├── sub-agents/      # TableDocumenter, ColumnInferencer (NEW)
│   │   ├── indexer/             # Agent 2 modules
│   │   └── retrieval/           # Agent 3 modules
│   ├── connectors/              # Database connection modules
│   ├── search/                  # Hybrid search implementation
│   ├── mcp/                     # MCP server and tools
│   ├── utils/                   # Shared utilities
│   └── index.ts                 # Main entry point
├── config/
│   ├── databases.yaml           # Database catalog
│   └── agent-config.yaml        # Agent configuration
├── prompts/                     # Prompt templates (NEW)
│   ├── column-description.md
│   ├── table-description.md
│   ├── domain-inference.md
│   └── query-understanding.md
├── docs/                        # Generated documentation (output)
├── data/
│   └── tribal-knowledge.db      # SQLite database (output)
├── progress/                    # Checkpoint files
│   ├── documentation-plan.json  # Planner output (NEW)
│   ├── documenter-progress.json
│   └── indexer-progress.json
└── tests/                       # Test files
```

---

## 2. Tech Stack Details

### 2.1 Core Technologies

| Layer | Technology | Version | Purpose |
|-------|------------|---------|---------|
| Runtime | Node.js | 20 LTS | JavaScript execution |
| Language | TypeScript | 5.x | Type safety, maintainability |
| Database | SQLite | 3.x | Local persistent storage |
| Full-Text Search | FTS5 | (SQLite built-in) | Keyword search |
| Vector Search | sqlite-vec | 0.1.x | Embedding similarity |
| MCP SDK | @modelcontextprotocol/sdk | Latest | Tool server implementation |

### 2.2 External Services

| Service | Provider | Purpose | Fallback |
|---------|----------|---------|----------|
| Embeddings | OpenAI text-embedding-3-small | Document vectorization | None (required) |
| Semantic Inference | Claude Sonnet 4 | Column/table descriptions | Basic name parsing |
| Source Database | PostgreSQL | Data source | N/A |
| Source Database | Snowflake | Data source | N/A |

### 2.3 Key Libraries

| Library | Purpose |
|---------|---------|
| pg | PostgreSQL connection and queries |
| snowflake-sdk | Snowflake connection and queries |
| better-sqlite3 | SQLite database driver |
| openai | OpenAI API client for embeddings |
| @anthropic-ai/sdk | Claude API for semantic inference |
| js-yaml | YAML parsing and generation |
| zod | Runtime type validation |
| commander | CLI argument parsing |

### 2.4 Vector Store Abstraction

The system uses an abstraction layer for vector storage to enable future migration from sqlite-vec to Pinecone.

**VectorStore Interface Methods**:
- initialize(): Set up vector storage
- upsert(documents): Insert or update document embeddings
- search(embedding, topK, filters): Find similar documents
- delete(documentIds): Remove documents
- getStats(): Return index statistics

**Initial Implementation**: SqliteVecStore

**Future Implementation**: PineconeStore

---

## 3. Prompt Templates *(NEW - Deep Agent)*

### 3.1 Overview

Prompt templates are stored in the /prompts directory as Markdown files. They are loaded at runtime, allowing customization without code changes. Each template uses variable substitution for dynamic content.

### 3.2 Template: column-description.md

**Purpose**: Generate semantic description for a database column

**Variables**:
- {{database}}: Database name
- {{schema}}: Schema name
- {{table}}: Table name
- {{column}}: Column name
- {{data_type}}: SQL data type
- {{nullable}}: YES or NO
- {{default}}: Default value or NULL
- {{existing_comment}}: Comment from database if exists
- {{sample_values}}: Comma-separated sample values (up to 10)

**Template Content**:
The template instructs the LLM to act as a database documentation specialist. It provides the column metadata and sample values, then requests a concise semantic description. Key instructions:
- Focus on business meaning, not technical details
- Ground description in evidence from sample values
- Never speculate beyond what the data shows
- If column purpose is unclear, say "Purpose unclear from available data"
- Maximum 2 sentences
- Do not repeat the column name or type in the description

**Expected Output**: A single description string, e.g., "Customer's primary email address used for account login and communications."

### 3.3 Template: table-description.md

**Purpose**: Generate semantic description for a database table

**Variables**:
- {{database}}: Database name
- {{schema}}: Schema name
- {{table}}: Table name
- {{row_count}}: Approximate row count
- {{column_list}}: Comma-separated column names
- {{primary_key}}: Primary key column(s)
- {{foreign_keys}}: List of FK relationships
- {{existing_comment}}: Comment from database if exists
- {{sample_row}}: One sample row as key-value pairs

**Template Content**:
The template instructs the LLM to act as a database documentation specialist. It provides table metadata, column list, relationships, and a sample row. Key instructions:
- Describe the business entity this table represents
- Mention key relationships to other tables
- Infer the table's role in the data model
- Ground description in column names and sample data
- Never speculate beyond evidence
- Maximum 3 sentences

**Expected Output**: A description string, e.g., "Stores customer order transactions. Links customers to their purchases via customer_id. Contains order status, totals, and timestamps for order lifecycle tracking."

### 3.4 Template: domain-inference.md

**Purpose**: Group tables into logical business domains

**Variables**:
- {{database}}: Database name
- {{table_list}}: JSON array of table objects with name, columns, foreign_keys
- {{relationship_graph}}: Summary of FK relationships between tables

**Template Content**:
The template instructs the LLM to analyze the tables and group them into logical business domains. Key instructions:
- Identify 3-10 domains based on table naming patterns and relationships
- Tables that reference each other frequently belong together
- Common domain names: customers, orders, products, analytics, system
- Every table must be assigned to exactly one domain
- Output as JSON object: { "domain_name": ["table1", "table2"] }

**Expected Output**: JSON object mapping domain names to table arrays.

### 3.5 Template: query-understanding.md

**Purpose**: Interpret natural language search queries for better search

**Variables**:
- {{query}}: The user's natural language query
- {{available_domains}}: List of known domains in the system

**Template Content**:
The template instructs the LLM to analyze the search query and extract structured information. Key instructions:
- Identify the core concept being searched (e.g., "churn" → customer retention)
- Expand abbreviations and synonyms
- Detect if query implies specific domain
- Identify if query is asking about relationships/joins
- Output as JSON with fields: concepts, domain_hint, relationship_query, expanded_terms

**Expected Output**: JSON object with extracted query understanding.

### 3.6 Template Loading

**Initialization**:
- On startup, validate all templates in /prompts directory exist
- Parse templates to verify variable syntax is correct
- Cache parsed templates in memory

**Runtime**:
- Load template content from memory
- Replace {{variable}} placeholders with actual values
- Pass formatted prompt to LLM API
- Parse LLM response according to expected output format

**Error Handling**:
- Missing template: Fail startup with clear error message
- Invalid variable syntax: Log warning, use template as-is
- LLM parsing failure: Retry once, then use fallback description

---

## 4. Planner: Schema Analyzer *(NEW - Deep Agent)*

### 4.1 Purpose

The Schema Analyzer runs before documentation begins. It connects to all configured databases, analyzes their structure, detects potential domains, and creates a documentation plan. This allows users to review scope and priorities before the time-consuming documentation phase.

### 4.2 Inputs

- **Catalog file** (databases.yaml): Connection configurations
- **Database credentials**: Via environment variables
- **Domain inference prompt**: /prompts/domain-inference.md

### 4.3 Processing Logic

Step 1: Load databases.yaml and validate connections
Step 2: For each database, connect and query table counts
Step 3: For each database, query foreign key relationships
Step 4: Build relationship graph (which tables reference which)
Step 5: Extract table metadata for each table
  - Query columns from information_schema
  - Query primary key constraints
  - Query foreign key constraints with referenced tables
  - Query index definitions
  - Get approximate row count
Step 6: Load domain-inference.md prompt template
Step 7: Call LLM with table list and relationship graph
Step 8: Parse domain assignments from LLM response
Step 9: Estimate complexity (simple: <50 tables, moderate: 50-200, complex: >200)
Step 10: Generate prioritized table list (core domain tables first)
Step 11: Write documentation-plan.json with all metadata

### 4.4 Output: documentation-plan.json

**Structure**:
- generated_at: ISO timestamp
- databases: Array of database analysis objects
  - name: Database identifier
  - type: postgres or snowflake
  - table_count: Total tables found
  - estimated_time_minutes: Based on table count
  - domains: Object mapping domain names to table arrays
  - tables: Ordered array of tables to document
    - name: Fully qualified table name
    - domain: Assigned domain
    - priority: 1 (core), 2 (standard), 3 (system/audit)
    - column_count: Number of columns
    - has_relationships: Boolean
    - metadata: Complete table metadata object
      - columns: Array of column objects
        - name: Column name
        - data_type: SQL data type
        - is_nullable: YES or NO
        - column_default: Default value or null
        - ordinal_position: Column order
        - comment: Existing database comment or null
      - primary_key: Array of primary key column names
      - foreign_keys: Array of foreign key objects
        - constraint_name: FK constraint name
        - column_name: Source column
        - referenced_table: Fully qualified referenced table
        - referenced_column: Referenced column name
      - indexes: Array of index objects
        - index_name: Index name
        - columns: Array of column names in index
        - is_unique: Boolean
        - index_definition: Full CREATE INDEX statement
- total_tables: Sum across all databases
- total_estimated_time_minutes: Overall estimate
- complexity: simple, moderate, or complex

### 4.5 User Review

After plan generation, user can:
- Review the plan JSON to verify scope
- Modify domain assignments
- Adjust table priorities
- Exclude specific tables
- Proceed with documentation

---

## 5. Database Schema

### 5.1 SQLite Database: tribal-knowledge.db

**Table: documents**

Purpose: Store all indexed documentation with metadata

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| doc_type | TEXT | NOT NULL | One of: table, column, relationship, domain |
| database_name | TEXT | NOT NULL | Source database name |
| schema_name | TEXT | | Schema within database |
| table_name | TEXT | | Table name (if applicable) |
| column_name | TEXT | | Column name (if applicable) |
| domain | TEXT | | Business domain grouping |
| content | TEXT | NOT NULL | Full document content |
| summary | TEXT | | Compressed summary for responses |
| keywords | TEXT | | Extracted keywords (JSON array) |
| file_path | TEXT | | Source file path in /docs |
| content_hash | TEXT | | Hash for change detection |
| created_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Creation time |
| updated_at | DATETIME | DEFAULT CURRENT_TIMESTAMP | Last update time |

Indexes:
- idx_documents_database ON (database_name)
- idx_documents_table ON (database_name, schema_name, table_name)
- idx_documents_domain ON (domain)
- idx_documents_type ON (doc_type)

**Virtual Table: documents_fts**

Purpose: Full-text search index using FTS5

Configuration:
- Tokenizer: porter (for stemming)
- Content: documents table
- Indexed columns: content, summary, keywords

**Virtual Table: documents_vec**

Purpose: Vector similarity search using sqlite-vec

Configuration:
- Dimensions: 1536 (OpenAI text-embedding-3-small)
- Distance metric: Cosine similarity

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER | Foreign key to documents.id |
| embedding | BLOB | 1536-dimensional float vector |

**Table: relationships**

Purpose: Store pre-computed join paths between tables

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| database_name | TEXT | NOT NULL | Database containing tables |
| source_table | TEXT | NOT NULL | Fully qualified source table |
| target_table | TEXT | NOT NULL | Fully qualified target table |
| join_path | TEXT | NOT NULL | JSON array of join steps |
| hop_count | INTEGER | NOT NULL | Number of joins required |
| sql_snippet | TEXT | | Pre-generated SQL JOIN clause |
| confidence | REAL | | Confidence score (0-1) |

Indexes:
- idx_relationships_source ON (database_name, source_table)
- idx_relationships_target ON (database_name, target_table)
- UNIQUE(database_name, source_table, target_table)

**Table: keywords**

Purpose: Cache extracted keywords for quick lookup

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | INTEGER | PRIMARY KEY AUTOINCREMENT | Unique identifier |
| term | TEXT | NOT NULL UNIQUE | Normalized keyword |
| source_type | TEXT | | Origin: column_name, sample_data, inferred |
| frequency | INTEGER | DEFAULT 1 | Occurrence count |

**Table: index_weights**

Purpose: Configure search weight boosts by document type

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| doc_type | TEXT | PRIMARY KEY | Document type |
| fts_weight | REAL | DEFAULT 1.0 | FTS5 score multiplier |
| vec_weight | REAL | DEFAULT 1.0 | Vector score multiplier |
| boost | REAL | DEFAULT 1.0 | Final ranking boost |

Default values:
- table: fts_weight=1.0, vec_weight=1.0, boost=1.5
- relationship: fts_weight=1.0, vec_weight=1.0, boost=1.2
- column: fts_weight=0.8, vec_weight=0.8, boost=1.0
- domain: fts_weight=1.0, vec_weight=1.0, boost=1.0

### 5.2 Progress Tracking Files

**documentation-plan.json** *(NEW)*

Purpose: Output of Schema Analyzer, input to Documenter

Structure: See Section 4.4

**documenter-progress.json**

Purpose: Track documentation progress for checkpoint recovery

Structure:
- started_at: ISO timestamp
- completed_at: ISO timestamp or null
- status: running, completed, failed
- plan_file: Path to documentation-plan.json used
- current_database: Database being processed
- current_table: Table being processed
- databases: Array of database status objects
  - name: Database name
  - status: pending, in_progress, completed, failed
  - tables_total: Total table count
  - tables_completed: Completed table count
  - error: Error message if failed

**indexer-progress.json**

Purpose: Track indexing progress for checkpoint recovery

Structure:
- started_at: ISO timestamp
- completed_at: ISO timestamp or null
- status: running, completed, failed
- documents_total: Total documents to index
- documents_indexed: Documents completed
- current_file: File being processed
- embeddings_generated: Count of embeddings created
- error: Error message if failed

---

## 6. Retrieval Function Specifications (Called by External MCP)

### 6.1 Function: search_tables

Purpose: Find tables relevant to a natural language query (called by external MCP tools)

**Input Parameters**:
- query (string, required): Natural language search query
- database (string, optional): Filter to specific database
- domain (string, optional): Filter to specific domain
- limit (integer, optional): Maximum results, default 5, max 20

**Processing Logic**:
1. Load query-understanding.md prompt template
2. Call LLM to interpret query, extract concepts and domain hints
3. Generate embedding for expanded query terms
4. Execute FTS5 search with extracted concepts
5. Execute vector similarity search with embedding
6. Combine results using Reciprocal Rank Fusion (k=60)
7. Apply document type weight boosts
8. Filter by database/domain if specified
9. Truncate to limit
10. Compress results to fit context budget
11. Return structured response with tokens_used

**Output Structure**:
- tables: Array of matching tables with name, database, domain, summary, key_columns, relevance_score
- tokens_used: Approximate token count
- total_matches: Count before limit applied

### 6.2 Function: get_table_schema

Purpose: Retrieve full schema details for a specific table (called by external MCP tools)

**Input Parameters**:
- table (string, required): Fully qualified table name (database.schema.table)
- include_samples (boolean, optional): Include sample values, default false

**Processing Logic**:
1. Parse table identifier into components
2. Query documents table for table-level document
3. Query documents table for all column-level documents
4. Retrieve relationship information for this table
5. Assemble complete schema response
6. Optionally include sample values
7. Calculate token count
8. Return structured response

**Output Structure**:
- name, database, schema, description, row_count
- columns: Array with name, type, nullable, description, samples (optional)
- primary_key, foreign_keys, indexes, related_tables
- tokens_used

### 6.3 Function: get_join_path

Purpose: Find the join path between two tables (called by external MCP tools)

**Input Parameters**:
- source_table (string, required): Starting table (database.schema.table)
- target_table (string, required): Destination table
- max_hops (integer, optional): Maximum intermediate tables, default 3

**Processing Logic**:
1. Parse table identifiers
2. Check relationships table for direct path
3. If not found, perform breadth-first search through FK graph
4. Stop when target reached or max_hops exceeded
5. Generate SQL JOIN snippet for the path
6. Return structured response

**Output Structure**:
- source, target, found, hop_count
- path: Array of join steps with from_table, to_table, join_type, on_clause
- sql_snippet
- tokens_used

### 6.4 Function: get_domain_overview

Purpose: Get summary of all tables in a business domain (called by external MCP tools)

**Input Parameters**:
- domain (string, required): Domain name
- database (string, optional): Filter to specific database

**Processing Logic**:
1. Query documents for domain-level document
2. Query all tables belonging to domain
3. Retrieve domain ER diagram (Mermaid)
4. Identify common join patterns within domain
5. Compress to fit context budget
6. Return structured response

**Output Structure**:
- domain, description, databases
- tables: Array with name, description, row_count
- er_diagram, common_joins
- tokens_used

### 6.5 Function: list_domains

Purpose: List all available business domains (called by external MCP tools)

**Input Parameters**:
- database (string, optional): Filter to specific database

**Output Structure**:
- domains: Array with name, description, table_count, databases
- tokens_used

### 6.6 Function: get_common_relationships

Purpose: Retrieve frequently used join patterns (called by external MCP tools)

**Input Parameters**:
- database (string, optional): Filter to specific database
- domain (string, optional): Filter to specific domain
- limit (integer, optional): Maximum results, default 10

**Output Structure**:
- relationships: Array with source_table, target_table, join_sql, description
- tokens_used

---

## 7. Hybrid Search Algorithm

### 7.1 Search Flow

Step 1: Query Preprocessing
- Load query-understanding prompt if configured
- Call LLM to extract concepts (optional, can skip for performance)
- Tokenize query into individual terms
- Remove stop words
- Apply stemming (porter stemmer)
- Identify domain hints (filter keywords)

Step 2: Parallel Search Execution
- FTS5 Search: Execute BM25-ranked full-text search
- Vector Search: Generate query embedding, find nearest neighbors

Step 3: Reciprocal Rank Fusion
- For each result in FTS5 results: score += 1 / (k + fts_rank)
- For each result in vector results: score += 1 / (k + vec_rank)
- k = 60 (standard RRF constant)

Step 4: Weight Application
- Multiply RRF score by document type boost
- table documents: 1.5x
- relationship documents: 1.2x
- column documents: 1.0x

Step 5: Final Ranking
- Sort by weighted score descending
- Apply filters (database, domain)
- Truncate to requested limit

### 7.2 Context Budget Management

**Budget Tiers**:
- Simple queries (single table lookup): 750 tokens
- Moderate queries (multi-table): 1500 tokens
- Complex queries (cross-domain analysis): 3000 tokens

**Complexity Detection**:
- Simple: Query mentions single specific concept
- Moderate: Query mentions multiple concepts or relationships
- Complex: Query contains words like "compare", "across", "all", "analyze"

**Compression Strategy**:
1. Start with full results
2. If over budget, truncate column lists to top 5
3. If still over, remove sample values
4. If still over, truncate descriptions
5. Always include table names and key relationships

---

## 8. Environment Configuration

### 8.1 Required Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| OPENAI_API_KEY | OpenAI API key for embeddings | sk-... |
| ANTHROPIC_API_KEY | Anthropic API key for inference | sk-ant-... |

### 8.2 Optional Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| TRIBAL_DOCS_PATH | Documentation output directory | ./docs |
| TRIBAL_DB_PATH | SQLite database path | ./data/tribal-knowledge.db |
| TRIBAL_PROMPTS_PATH | Prompt templates directory | ./prompts |
| TRIBAL_LOG_LEVEL | Logging verbosity | info |

### 8.3 Configuration Files

**databases.yaml** (Catalog Configuration)

Purpose: Define all databases to document

Structure:
- databases: Array of database configurations
  - name: Unique identifier for this database
  - type: "postgres" or "snowflake"
  - connection_env: Environment variable name for connection
  - schemas: Array of schemas to include (optional, default all)
  - exclude_tables: Array of table patterns to skip

**agent-config.yaml** (Agent Behavior)

Purpose: Configure agent behavior and limits

Structure:
- planner:
  - enabled: Whether to run planning phase (default true)
  - domain_inference: Whether to call LLM for domain detection (default true)
- documenter:
  - concurrency: Parallel table processing (default 5)
  - sample_timeout_ms: Max time for sampling (default 5000)
  - llm_model: Model for inference (default claude-sonnet-4)
  - checkpoint_interval: Tables between checkpoints (default 10)
  - use_sub_agents: Whether to use TableDocumenter pattern (default true)
- indexer:
  - batch_size: Documents per embedding batch (default 50)
  - embedding_model: OpenAI model (default text-embedding-3-small)
  - checkpoint_interval: Documents between checkpoints (default 100)
- retrieval:
  - default_limit: Default search results (default 5)
  - max_limit: Maximum search results (default 20)
  - context_budgets: Token budgets by complexity tier
  - rrf_k: RRF constant (default 60)
  - use_query_understanding: Whether to call LLM for query analysis (default false)

---

## 9. Development Workflow

### 9.1 CLI Commands

| Command | Description |
|---------|-------------|
| npm run plan | Run Schema Analyzer, generate documentation-plan.json |
| npm run document | Execute documentation using plan |
| npm run index | Index documentation into SQLite |
| npm run serve | Start MCP server |
| npm run pipeline | Run plan → document → index in sequence |
| npm run status | Show current progress |
| npm run validate-prompts | Validate prompt template syntax |

### 9.2 Development Process

Step 1: Clone repository, install dependencies
Step 2: Copy example config files, set environment variables
Step 3: Create or customize prompt templates in /prompts
Step 4: Run npm run validate-prompts to verify templates
Step 5: Run npm run plan to analyze target databases
Step 6: Review documentation-plan.json
Step 7: Run npm run document to generate docs
Step 8: Run npm run index to build search index
Step 9: Run npm run serve to start MCP server
Step 10: Test with MCP client

---

## 10. Integration Points

### 10.1 PostgreSQL Integration

**Connection Method**: Connection string via pg library

**Connection String Format**: postgresql://user:password@host:port/database

**Required Permissions**:
- SELECT on information_schema.tables
- SELECT on information_schema.columns
- SELECT on information_schema.table_constraints
- SELECT on information_schema.key_column_usage
- SELECT on information_schema.constraint_column_usage
- SELECT on pg_catalog.pg_indexes
- SELECT on target tables (for sampling)

**Metadata Query: Tables and Columns**

Query information_schema.tables joined with information_schema.columns. Filter by table_schema NOT IN ('pg_catalog', 'information_schema'). Select these fields:
- t.table_schema: Schema name
- t.table_name: Table name
- c.column_name: Column name
- c.data_type: SQL data type
- c.is_nullable: YES or NO
- c.column_default: Default value expression
- c.ordinal_position: Column order

For column comments, use col_description() function with the table OID and ordinal position. Get table OID by casting schema.table to regclass.

**Metadata Query: Primary Keys**

Join information_schema.table_constraints with information_schema.key_column_usage. Filter where constraint_type = 'PRIMARY KEY'. Select:
- tc.table_schema, tc.table_name
- kcu.column_name
- kcu.ordinal_position (for composite keys)

**Metadata Query: Foreign Keys**

Join three tables:
- information_schema.table_constraints (tc)
- information_schema.key_column_usage (kcu) ON tc.constraint_name = kcu.constraint_name
- information_schema.constraint_column_usage (ccu) ON ccu.constraint_name = tc.constraint_name

Filter where tc.constraint_type = 'FOREIGN KEY'. Select:
- tc.table_schema, tc.table_name: Source table
- kcu.column_name: Source column
- ccu.table_schema AS foreign_table_schema
- ccu.table_name AS foreign_table_name
- ccu.column_name AS foreign_column_name

**Metadata Query: Indexes**

Query pg_indexes view. Filter where schemaname NOT IN ('pg_catalog', 'information_schema'). Select:
- schemaname, tablename, indexname
- indexdef: Full CREATE INDEX statement (parse for columns and uniqueness)

**Sampling Query**

For tables with fewer than 1000 rows, select all. For larger tables, use TABLESAMPLE or LIMIT with random ordering:
- Option 1: SELECT * FROM schema.table TABLESAMPLE SYSTEM (1) LIMIT 100
- Option 2: SELECT * FROM schema.table ORDER BY RANDOM() LIMIT 100

TABLESAMPLE is faster but less random. ORDER BY RANDOM() is truly random but slower on large tables.

**Row Count Query**

For approximate counts (fast): SELECT reltuples FROM pg_class WHERE relname = 'table_name'

For exact counts (slow): SELECT COUNT(*) FROM schema.table
Use approximate counts for planning, exact only if specifically needed.
### 10.2 Snowflake Integration

**Connection Method**: snowflake-sdk with connection parameters object

**Connection Parameters**:
- account: Snowflake account identifier (e.g., xy12345.us-east-1)
- username: Snowflake user
- password: Snowflake password
- warehouse: Default warehouse for queries
- database: Target database
- schema: Default schema (optional)

**Required Permissions**:
- USAGE on database
- USAGE on schemas to document
- SELECT on INFORMATION_SCHEMA views
- SELECT on target tables (for sampling)

**Metadata Query: Tables**

Query INFORMATION_SCHEMA.TABLES. Filter where TABLE_SCHEMA NOT IN ('INFORMATION_SCHEMA'). Select:
- TABLE_CATALOG AS database_name
- TABLE_SCHEMA AS schema_name
- TABLE_NAME AS table_name
- TABLE_TYPE: BASE TABLE or VIEW
- ROW_COUNT: Approximate row count (Snowflake maintains this)
- COMMENT: Table comment if exists
- CREATED, LAST_ALTERED: Timestamps

**Metadata Query: Columns**

Query INFORMATION_SCHEMA.COLUMNS. Filter by TABLE_SCHEMA. Select:
- TABLE_CATALOG, TABLE_SCHEMA, TABLE_NAME
- COLUMN_NAME
- ORDINAL_POSITION
- DATA_TYPE: SQL type
- IS_NULLABLE: YES or NO
- COLUMN_DEFAULT
- CHARACTER_MAXIMUM_LENGTH, NUMERIC_PRECISION, NUMERIC_SCALE
- COMMENT: Column comment if exists

**Metadata Query: Primary Keys**

Use SHOW command: SHOW PRIMARY KEYS IN DATABASE {database_name}

Returns result set with columns:
- database_name, schema_name, table_name
- column_name
- key_sequence: Position in composite key
- constraint_name

Execute as query, then fetch results.

**Metadata Query: Foreign Keys**

Use SHOW command: SHOW IMPORTED KEYS IN DATABASE {database_name}

Returns result set with columns:
- fk_database_name, fk_schema_name, fk_table_name, fk_column_name: Source (child)
- pk_database_name, pk_schema_name, pk_table_name, pk_column_name: Target (parent)
- key_sequence: Position in composite key
- fk_name: Constraint name

**Metadata Query: Indexes**

Snowflake does not expose traditional indexes via INFORMATION_SCHEMA. Snowflake automatically manages micro-partitions and clustering. For clustering key info:

SHOW TABLES LIKE '{table_name}' IN SCHEMA {schema_name}

Look at cluster_by column in results.

**Sampling Query**

Snowflake has native SAMPLE clause:
- SELECT * FROM schema.table SAMPLE (100 ROWS): Exactly 100 rows
- SELECT * FROM schema.table SAMPLE BERNOULLI (1): 1% of rows randomly
- SELECT * FROM schema.table SAMPLE SYSTEM (1): 1% block-based (faster)

Use SAMPLE (100 ROWS) for consistent sample size across tables.

**Row Count**

ROW_COUNT in INFORMATION_SCHEMA.TABLES is maintained by Snowflake and is accurate without running COUNT(*). Use this for planning - it's free and fast.
### 10.3 OpenAI Integration

**Endpoint**: Embeddings API

**Model**: text-embedding-3-small (1536 dimensions)

**Batch Size**: 50 documents per request

**Rate Limiting**: Exponential backoff on 429 errors

### 10.4 Claude Integration

**Purpose**: Semantic inference for descriptions

**Model**: claude-sonnet-4

**Use Cases**: Column descriptions, table descriptions, domain inference, query understanding

**Prompt Loading**: Templates loaded from /prompts directory at runtime

### 10.5 External MCP Integration

**Integration Type**: Function exports for external MCP to call

**Communication**: External MCP repo implements MCP tools that call this repo's retrieval functions

**Tool Registration**: MCP tools are implemented in separate repository (Noah's Company MCP)

---

## 11. Error Handling Strategy

### 11.1 Planning Errors

**Connection failure**: Skip database, include in plan as "unreachable"
**Domain inference failure**: Use fallback domain assignment (by table prefix)
**Invalid plan output**: Fail with clear error, require manual intervention

### 11.2 Documentation Errors

**Table extraction failure**: Log error, skip table, continue with others
**LLM API timeout**: Retry twice, then use fallback description
**Sub-agent failure**: Log error, use basic description, don't block parent

### 11.3 Indexing Errors

**Embedding API failure**: Retry with backoff, reduce batch size if persistent
**FTS5 insertion failure**: Log error, skip document, continue
**Vector insertion failure**: Log error, mark document for retry

### 11.4 Search Errors

**Empty results**: Return empty array with helpful message
**Query understanding failure**: Skip LLM analysis, use raw query terms
**Partial results**: Return what's available, indicate incompleteness

### 11.5 Prompt Template Errors

**Missing template**: Fail startup with clear error listing missing file
**Invalid syntax**: Log warning, use template without variable substitution
**LLM parse failure**: Retry once, then use fallback value

---

## 12. Monitoring and Logging

### 12.1 Logging Strategy

**Format**: Structured JSON logs

**Levels**: ERROR, WARN, INFO, DEBUG

**Key Events**:
- Plan generation start/complete
- Database connection success/failure
- Table documentation start/complete (with sub-agent info)
- Prompt template loading
- LLM API calls (with token counts)
- Embedding batch generation
- Search query execution with timing
- MCP tool invocation

### 12.2 Metrics to Track

**Planner Metrics**: Databases analyzed, tables discovered, domains detected, planning time

**Documenter Metrics**: Tables documented, sub-agents spawned, LLM tokens used, errors by type

**Indexer Metrics**: Documents indexed, embeddings generated, index size

**Retrieval Metrics**: Queries per hour, latency (p50, p95), token budget utilization

---

*End of PRD2 - Technical Specification*

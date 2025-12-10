# Tribal Knowledge Deep Agent
## Agent Contracts Summary

**Version**: 1.0  
**Date**: December 10, 2025  
**Purpose**: Human-readable overview of agent inputs, outputs, and handoffs

For detailed TypeScript interfaces, see `agent-contracts-interfaces.md`.  
For execution model and validation rules, see `agent-contracts-execution.md`.  
For shared utilities (error codes, config schemas, LLM wrapper, logging), see Appendices A-E in `agent-contracts-interfaces.md`.

---

## System Overview

The Tribal Knowledge system consists of four agents that work in sequence, each passing structured data to the next. The key innovation is **domain-based parallelization**: the Planner groups tables into business domains, and the Documenter processes each domain independently in parallel.

```
Planner -> Documenter -> Indexer -> Retriever
```

---

## Agent 1: Planner (Schema Analyzer)

### What It Does
Connects to configured databases, analyzes their structure, detects business domains, and creates a documentation plan that organizes tables into parallelizable work units.

### Inputs
- **Database configuration file** (`config/databases.yaml`)
  - Connection details for each database (Postgres, Snowflake)
  - Which schemas to include or exclude
  - Environment variable names for credentials

- **Domain inference prompt template** (`prompts/domain-inference.md`)
  - Instructions for the LLM to group tables into business domains

### Outputs
- **Documentation Plan** (`progress/documentation-plan.json`)
  - When the plan was generated
  - Hash of the configuration (for staleness detection)
  - Complexity assessment (simple, moderate, complex)
  - Per-database analysis including connection status, table counts, and discovered domains
  - **Work Units**: Self-contained packages of tables grouped by domain, each specifying:
    - Which database and domain it covers
    - List of tables to document with metadata (column counts, row counts, foreign key relationships)
    - Output directory for generated files
    - Estimated processing time
    - Content hash for change detection
  - Summary statistics (total tables, estimated time, recommended parallelism)
  - Any errors encountered during analysis

### Key Design Decisions
- Tables are grouped into work units by business domain (e.g., customers, orders, products)
- Each work unit is fully independent and can be processed in parallel
- Content hashes enable detection of schema changes without re-running the full analysis

---

## Agent 2: Documenter

### What It Does
Reads the documentation plan and generates comprehensive documentation for each table. Spawns parallel sub-agents to process work units concurrently. Uses LLM to infer semantic descriptions for tables and columns.

### Inputs
- **Documentation Plan** (`progress/documentation-plan.json`)
  - The plan produced by the Planner
  - Documenter validates the plan before starting

- **Prompt templates** (`prompts/`)
  - `column-description.md`: How to describe individual columns
  - `table-description.md`: How to describe tables

- **Database connections**
  - Live access to sample data for LLM context

### Outputs

#### Progress Tracking
- **Aggregated Progress** (`progress/documenter-progress.json`)
  - Overall status (pending, running, completed, failed, partial)
  - Statistics: total tables, completed, failed, skipped
  - LLM token usage and timing metrics
  - Reference to which plan is being executed

- **Per-Work-Unit Progress** (`progress/work_units/{id}/progress.json`)
  - Status of each parallel sub-agent
  - Tables completed vs remaining
  - Currently processing table
  - Errors specific to that work unit
  - List of output files generated

#### Generated Documentation
- **Markdown files** (`docs/databases/{db}/tables/{schema}.{table}.md`)
  - Human-readable documentation for each table
  - Semantic descriptions of table purpose
  - Column details with inferred meanings
  - Relationship information and sample data

- **Schema files** (`docs/databases/{db}/schemas/`)
  - JSON Schema and YAML semantic models for each table

- **Domain documentation** (`docs/databases/{db}/domains/{domain}.md`)
  - Overview of tables in each business domain
  - Mermaid ER diagrams showing relationships

- **Documentation Manifest** (`docs/documentation-manifest.json`)
  - **This is the handoff contract to the Indexer**
  - Completion status (complete or partial)
  - List of all databases and their documentation status
  - Per-work-unit completion status with error details if any failed
  - Complete list of indexable files with:
    - File path and type (table, domain, overview, relationship)
    - Which database/schema/table/domain it documents
    - Content hash for integrity verification
    - File size and modification time

### Key Design Decisions
- Work units are processed in parallel with configurable concurrency limits
- Each sub-agent writes its own progress file to avoid lock contention
- Failed work units don't block successful ones; the system produces a partial manifest
- Individual tables can fail without failing the entire work unit
- Content hashes in the manifest allow the Indexer to verify file integrity

---

## Agent 3: Indexer

### What It Does
Reads the documentation manifest, parses all generated documentation files, extracts keywords, generates vector embeddings, and populates a searchable SQLite database with full-text and vector search capabilities.

### Inputs
- **Documentation Manifest** (`docs/documentation-manifest.json`)
  - The handoff from the Documenter
  - Lists all files to be indexed with their content hashes
  - Indexer validates that all listed files exist and haven't been modified

### Outputs
- **Indexer Progress** (`progress/indexer-progress.json`)
  - Overall status
  - Files indexed vs total
  - Embeddings generated
  - Errors encountered

- **SQLite Database** (`data/tribal-knowledge.db`)
  - **Documents table**: All indexed documentation with metadata
    - Document type (table, column, domain, relationship)
    - Database, schema, table, column identifiers
    - Full content and compressed summary
    - Extracted keywords
    - Content hash for change detection
  - **Full-text search index** (FTS5): Keyword search with stemming
  - **Vector index** (sqlite-vec): Semantic similarity search using embeddings
  - **Relationships table**: Pre-computed join paths between tables
  - **Index metadata**: When last indexed, document counts, embedding model info

### Key Design Decisions
- Supports incremental re-indexing by comparing content hashes
- Can index partial documentation (if some work units failed)
- Gracefully degrades if embedding generation fails (falls back to text search only)
- Checkpoints progress for crash recovery

---

## Agent 4: Retriever (MCP Server)

### What It Does
Exposes the indexed documentation via MCP tools that external AI agents can query. Performs hybrid search combining keyword and semantic matching, manages context budgets, and returns structured responses.

### Inputs
- **SQLite Database** (`data/tribal-knowledge.db`)
  - The indexed documentation from the Indexer
  - Retriever checks database readiness before serving queries

- **Query understanding prompt** (`prompts/query-understanding.md`)
  - Optional: interprets natural language queries to improve search

- **MCP tool calls from external agents**
  - Natural language queries and filter parameters

### Outputs (MCP Tool Responses)

#### search_tables
- **Input**: Natural language query, optional database/domain filters, result limit
- **Output**: Matching tables with names, descriptions, key columns, relevance scores, token count

#### get_table_schema
- **Input**: Fully qualified table name, optional flags for samples and relationships
- **Output**: Complete table details including all columns, primary keys, foreign keys, indexes, related tables

#### get_join_path
- **Input**: Source table, target table, maximum hops allowed
- **Output**: Whether a path exists, the join steps with SQL snippets, hop count

#### get_domain_overview
- **Input**: Domain name, optional database filter
- **Output**: Domain description, list of tables with summaries, ER diagram, common join patterns

#### list_domains
- **Input**: Optional database filter
- **Output**: All available domains with descriptions and table counts

### Key Design Decisions
- All responses include token count for context budget management
- Hybrid search combines FTS5 keyword matching with vector similarity using Reciprocal Rank Fusion
- Results are compressed to fit configurable token budgets
- Query understanding is optional (can be disabled for performance)

---

## Agent Boundaries: What Gets Passed

| Boundary | Contract File | Key Contents |
|----------|---------------|--------------|
| **Planner -> Documenter** | `progress/documentation-plan.json` | Work units with table lists, domain assignments, estimated times, content hashes |
| **Documenter -> Indexer** | `docs/documentation-manifest.json` | Completion status, list of all generated files with paths and content hashes |
| **Indexer -> Retriever** | `data/tribal-knowledge.db` | SQLite database with documents, search indexes, relationship data |

---

## Error Handling Philosophy

Each agent follows consistent error handling principles:

1. **Isolate failures**: A failed table doesn't fail the work unit; a failed work unit doesn't fail the whole job
2. **Partial success is valid**: The system prefers documenting 90% of tables over documenting 0%
3. **Explicit status**: Every contract file has a clear status field (completed, partial, failed)
4. **Downstream continues**: The Indexer can index partial documentation; the Retriever can search partial indexes
5. **Recoverable errors retry**: Connection timeouts and API errors retry with backoff
6. **Hashes detect changes**: Content hashes throughout enable incremental re-processing

---

## Selective Re-processing

The contract design enables targeted re-runs:

- **Re-document one domain**: Pass the work unit ID to process only that domain's tables
- **Retry failed work units**: Query progress files to find and retry only failed units
- **Incremental indexing**: Compare content hashes to index only new or changed files
- **Force full re-run**: Override change detection to reprocess everything

This is possible because:
- Work units are independent and write to separate output directories
- Content hashes are stored at every level (plan, work unit, file)
- Progress files track status per work unit, not just overall
- The manifest lists files individually, not just directories

---

## File Locations Quick Reference

| Purpose | Location |
|---------|----------|
| Database config | `config/databases.yaml` |
| Agent behavior config | `config/agent-config.yaml` |
| Prompt templates | `prompts/*.md` |
| Documentation plan | `progress/documentation-plan.json` |
| Documenter progress | `progress/documenter-progress.json` |
| Work unit progress | `progress/work_units/{id}/progress.json` |
| Indexer progress | `progress/indexer-progress.json` |
| Generated docs | `docs/databases/{db}/` |
| Documentation manifest | `docs/documentation-manifest.json` |
| Search database | `data/tribal-knowledge.db` |

---

## Shared Utilities

All four agents share common infrastructure defined in the appendices of `agent-contracts-interfaces.md`:

- **Error Code Registry** (Appendix A): Canonical list of all error codes. Developers must not invent new codes without adding them here first. Codes are prefixed by agent (PLAN_, DOC_, IDX_, RET_).

- **Config File Schemas** (Appendix B): TypeScript interfaces and YAML examples for `databases.yaml` (database connections) and `agent-config.yaml` (agent behavior settings like parallelism, timeouts, LLM models).

- **LLM Wrapper Interface** (Appendix C): Shared interface for all LLM calls. Handles template loading, variable substitution, retries, and token tracking. All agents use this rather than calling APIs directly.

- **Logging Contract** (Appendix D): Structured JSON log format with correlation IDs for tracing requests across agents. Work unit IDs enable filtering parallel execution logs.

- **Example Contract Files** (Appendix E): Realistic examples of `documentation-plan.json` and `documentation-manifest.json` showing actual field values and structure.

---

*End of Summary*

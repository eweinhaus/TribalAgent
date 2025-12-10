# Tribal Knowledge Deep Agent
## Project Plan Document

**Version**: 1.1  
**Date**: December 9, 2025  
**Status**: Planning  
**Change**: Added Deep Agent properties (Planning, Sub-agents, System Prompts)

---

## Project Overview

Build a deep agent system that automatically documents database schemas, indexes documentation for efficient retrieval, and exposes it via MCP for AI agent consumption. The system implements deep agent patterns: explicit planning, sub-agent delegation, filesystem-based memory, and configurable system prompts.

---

## System Architecture

### High-Level System Flow

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         TRIBAL KNOWLEDGE DEEP AGENT                         │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │   PLANNER    │    │   AGENT 1    │    │   AGENT 2    │                  │
│  │   Schema     │───▶│  Database    │───▶│  Document    │                  │
│  │   Analyzer   │    │  Documenter  │    │   Indexer    │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│         │                   │                   │                          │
│         │            ┌──────┴──────┐            │                          │
│         │            │ SUB-AGENTS  │            │                          │
│         │            │ ┌─────────┐ │            │                          │
│         │            │ │  Table  │ │            │                          │
│         │            │ │  Doc    │ │            │                          │
│         │            │ └─────────┘ │            │                          │
│         │            │ ┌─────────┐ │            │                          │
│         │            │ │ Column  │ │            │                          │
│         │            │ │ Infer   │ │            │                          │
│         │            │ └─────────┘ │            │                          │
│         │            └─────────────┘            │                          │
│         ▼                   ▼                   ▼                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  Plan File   │    │  Filesystem  │    │   SQLite     │                  │
│  │  (JSON)      │    │  (MD/JSON/   │    │  + Vectors   │                  │
│  │              │    │   YAML)      │    │  (FTS5+Vec)  │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                             │
│                             ┌──────────────┐                               │
│                             │   AGENT 3    │                               │
│                             │   Index      │                               │
│                             │  Retrieval   │                               │
│                             └──────────────┘                               │
│                                    │                                       │
│                                    ▼                                       │
│                             ┌──────────────┐                               │
│                             │  MCP Server  │                               │
│                             │  (Tools for  │                               │
│                             │   Noah's MCP)│                               │
│                             └──────────────┘                               │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        PROMPT TEMPLATES                              │  │
│  │   /prompts/column-description.md   - Column semantic inference       │  │
│  │   /prompts/table-description.md    - Table semantic inference        │  │
│  │   /prompts/domain-inference.md     - Domain grouping logic           │  │
│  │   /prompts/query-understanding.md  - Search query interpretation     │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │     Noah's Company MCP        │
                    │  (External Agent Interface)   │
                    └───────────────────────────────┘
```

### Deep Agent Properties

| Property | Implementation |
|----------|----------------|
| **Planning Tool** | Schema Analyzer runs first, creates documentation-plan.json |
| **Sub-agents** | TableDocumenter and ColumnInferencer handle repeated tasks |
| **File System** | /docs for output, /progress for state, /prompts for templates |
| **System Prompts** | Configurable templates in /prompts directory |

### Agent Chain Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           AGENT CHAIN FLOW                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   TRIGGER (Manual CLI)                                                      │
│      │                                                                      │
│      ▼                                                                      │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                     PLANNER: SCHEMA ANALYZER                     │     │
│   │                                                                  │     │
│   │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │     │
│   │  │ Connect │───▶│ Count   │───▶│ Detect  │───▶│ Create  │      │     │
│   │  │ to DBs  │    │ Tables  │    │ Domains │    │  Plan   │      │     │
│   │  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│                         documentation-plan.json                             │
│                                      │                                      │
│                                      ▼                                      │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                     AGENT 1: DOCUMENTER                          │     │
│   │                                                                  │     │
│   │  ┌─────────────────────────────────────────────────────────┐    │     │
│   │  │  FOR EACH table IN plan.tables:                         │    │     │
│   │  │    ┌─────────────────────────────────────────────────┐  │    │     │
│   │  │    │  SUB-AGENT: TableDocumenter                     │  │    │     │
│   │  │    │  - Extract metadata                             │  │    │     │
│   │  │    │  - Sample data                                  │  │    │     │
│   │  │    │  - Spawn ColumnInferencer for each column       │  │    │     │
│   │  │    │  - Generate markdown                            │  │    │     │
│   │  │    │  - Return summary to parent                     │  │    │     │
│   │  │    └─────────────────────────────────────────────────┘  │    │     │
│   │  └─────────────────────────────────────────────────────────┘    │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│                              /docs/ filesystem                              │
│                                      │                                      │
│                                      ▼                                      │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                     AGENT 2: INDEXER                             │     │
│   │                                                                  │     │
│   │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │     │
│   │  │  Parse  │───▶│ Extract │───▶│Generate │───▶│  Build  │      │     │
│   │  │  Docs   │    │Keywords │    │Embedding│    │  Index  │      │     │
│   │  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                      │                                      │
│                                      ▼                                      │
│                            SQLite + FTS5 + Vec                              │
│                                      │                                      │
│                                      ▼                                      │
│   ┌──────────────────────────────────────────────────────────────────┐     │
│   │                     AGENT 3: RETRIEVAL                           │     │
│   │                                                                  │     │
│   │  ┌─────────┐    ┌─────────┐    ┌─────────┐    ┌─────────┐      │     │
│   │  │ Receive │───▶│ Hybrid  │───▶│ Rank &  │───▶│ Return  │      │     │
│   │  │  Query  │    │ Search  │    │Compress │    │ Context │      │     │
│   │  └─────────┘    └─────────┘    └─────────┘    └─────────┘      │     │
│   │       │                                                         │     │
│   │       ▼                                                         │     │
│   │  Uses: /prompts/query-understanding.md                          │     │
│   └──────────────────────────────────────────────────────────────────┘     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Data Storage Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STORAGE ARCHITECTURE                               │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│   FILESYSTEM (Human-Readable)              SQLITE (Machine-Searchable)     │
│   ─────────────────────────────           ───────────────────────────      │
│                                                                             │
│   /docs/                                   tribal-knowledge.db              │
│   ├── catalog-summary.md                   ┌────────────────────────┐      │
│   ├── databases/                           │     documents          │      │
│   │   ├── production_postgres/             │  (id, type, content)   │      │
│   │   │   ├── README.md                    └────────────────────────┘      │
│   │   │   ├── tables/                               │                      │
│   │   │   │   ├── public.customers.md               ▼                      │
│   │   │   │   └── ...                      ┌────────────────────────┐      │
│   │   │   ├── domains/                     │   documents_fts        │      │
│   │   │   │   ├── customers.md             │   (FTS5 full-text)     │      │
│   │   │   │   └── customers.mermaid        └────────────────────────┘      │
│   │   │   ├── er-diagrams/                          │                      │
│   │   │   │   └── full-schema.mermaid               ▼                      │
│   │   │   └── schemas/                     ┌────────────────────────┐      │
│   │   │       ├── public.customers.json    │   documents_vec        │      │
│   │   │       └── public.customers.yaml    │   (vector embeddings)  │      │
│   │   └── analytics_snowflake/             └────────────────────────┘      │
│   │       └── ...                                   │                      │
│   └── progress/                                     ▼                      │
│       ├── documentation-plan.json          ┌────────────────────────┐      │
│       ├── documenter-progress.json         │    relationships       │      │
│       └── indexer-progress.json            │   (join paths, FKs)    │      │
│                                            └────────────────────────┘      │
│   /prompts/                                                                │
│   ├── column-description.md                                                │
│   ├── table-description.md                                                 │
│   ├── domain-inference.md                                                  │
│   └── query-understanding.md                                               │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: Foundation (Week 1-2)

**Goal**: Basic end-to-end flow with single PostgreSQL database

- Set up TypeScript project structure and dependencies
- Implement PostgreSQL database connector
- Create basic metadata extraction (tables, columns, keys)
- Generate simple Markdown documentation per table
- Set up SQLite database with FTS5 full-text index
- Implement basic `search_tables` MCP tool
- Create progress tracking file structure
- **NEW**: Create initial prompt templates (column, table)

**Deliverable**: Can document a Postgres database and search tables by keyword

---

### Phase 2: Semantic Layer (Week 3-4)

**Goal**: Add AI-powered semantic understanding and vector search

- Integrate OpenAI embeddings API
- Set up sqlite-vec for vector storage
- Implement hybrid search with Reciprocal Rank Fusion
- Add LLM-based semantic inference for column/table descriptions
- **NEW**: Implement Schema Analyzer (Planner)
- **NEW**: Create documentation-plan.json output
- Implement automatic domain detection from table relationships
- Add keyword extraction from column names and sample data
- Complete remaining MCP tools (get_table_schema, get_join_path, etc.)
- **NEW**: Create domain-inference.md prompt template

**Deliverable**: Semantic search that understands natural language queries

---

### Phase 3: Snowflake & Scale (Week 5-6)

**Goal**: Multi-database support and visual documentation

- Implement Snowflake database connector
- Add cross-database documentation support
- Generate Mermaid ER diagrams (full schema overview)
- Create domain-grouped diagrams for large schemas
- Output JSON Schema files for programmatic consumption
- Output YAML semantic model files (Cortex Analyst compatible)
- **NEW**: Implement TableDocumenter sub-agent pattern
- **NEW**: Implement ColumnInferencer sub-agent pattern
- Add robust progress tracking and checkpoint recovery

**Deliverable**: Full documentation of Postgres + Snowflake with ER diagrams

---

### Phase 4: MCP Integration & Polish (Week 7-8)

**Goal**: Production-ready integration with Noah's Company MCP

- Install tools into Noah's Company MCP repository
- Implement adaptive context budgeting based on query complexity
- Add response compression to fit token limits
- **NEW**: Create query-understanding.md prompt template
- Create comprehensive documentation and usage examples
- Performance optimization and caching
- Error handling, retry logic, and graceful degradation
- End-to-end integration testing

**Deliverable**: Production-ready Tribal Knowledge Deep Agent

---

### Future Phases (Post-MVP)

**Phase 5**: Migrate from sqlite-vec to Pinecone for enterprise scale

**Phase 6**: Implement schema drift detection and automatic re-documentation

**Phase 7**: Extend to code documentation (dbt models, SQL files, Python)

**Phase 8**: Multi-server and multi-tenant organization support

---

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Storage** | Filesystem + SQLite | Human-readable docs + fast search |
| **Search** | FTS5 + Vector + RRF | Proven hybrid approach from PAM-CRS |
| **Embeddings** | OpenAI → Pinecone | Start simple, scale later |
| **ER Diagrams** | Domain-grouped Mermaid | Readable for large schemas |
| **MCP Integration** | Tools in Noah's MCP | Single integration point |
| **Context Budget** | Adaptive per query | Efficient token usage |
| **Planning** | Schema Analyzer first | Understand before documenting |
| **Sub-agents** | Table + Column workers | Isolate repeated tasks |
| **Prompts** | External /prompts/ dir | Editable without code changes |

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Documentation coverage | 100% of tables |
| Search relevance (top-3 hit) | >85% |
| Join path accuracy | >95% |
| Search latency (p95) | <500ms |
| Documentation time (100 tables) | <5 minutes |
| Semantic description quality | >90% sensible |

---

*End of Plan Document*

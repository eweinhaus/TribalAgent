# System Patterns: Tribal Knowledge Deep Agent

## System Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    User Commands                            │
│  npm run plan | document | index | pipeline                 │
└────────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│                    Planner (Schema Analyzer)                │
│  - Analyzes database structure                              │
│  - Detects domains                                          │
│  - Creates documentation-plan.json                           │
└────────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent 1: Database Documenter                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Sub-Agent: TableDocumenter                           │  │
│  │    - Documents one table                              │  │
│  │    - Spawns ColumnInferencer for each column          │  │
│  │    - Generates Markdown + JSON                        │  │
│  └──────────────────────────────────────────────────────┘  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Sub-Agent: ColumnInferencer                         │  │
│  │    - Generates semantic description for one column    │  │
│  │    - Uses prompt templates                            │  │
│  │    - Returns only description (context quarantine)    │  │
│  └──────────────────────────────────────────────────────┘  │
└────────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent 2: Document Indexer                      │
│  - Parses documentation files                                │
│  - Extracts keywords                                         │
│  - Generates embeddings (OpenAI)                             │
│  - Builds FTS5 + vector indices                              │
└────────────────────┬──────────────────────────────────────────┘
                   │
                   ▼
┌─────────────────────────────────────────────────────────────┐
│              Agent 3: Index Retrieval / MCP                  │
│  - Exposes search_tables, get_table_schema, etc.             │
│  - Performs hybrid search (FTS5 + vector)                   │
│  - Applies Reciprocal Rank Fusion                            │
│  - Returns context-budgeted responses                         │
└──────────────────────────────────────────────────────────────┘
```

## Key Technical Decisions

### 1. Deep Agent Architecture

**Decision**: Implement four pillars of deep agent architecture
- **Planning Tool**: Schema Analyzer runs before documentation
- **Sub-agents**: TableDocumenter and ColumnInferencer for repeated tasks
- **File System**: Filesystem + SQLite for persistent memory
- **System Prompts**: Configurable templates in `/prompts` directory

**Rationale**: Enables user review before execution, efficient parallelization, persistent state, and consistent LLM behavior.

### 2. Planner Handles Table Iteration

**Decision**: Planner extracts all metadata upfront, Documenter spawns sub-agents based on plan

**Rationale**: 
- Separation of concerns: Planner analyzes, Documenter executes
- User can review plan before committing to documentation
- Enables prioritization and domain grouping

**Implementation**: `planner/index.ts` extracts metadata, `documenter/index.ts` reads plan and spawns sub-agents

### 3. Sub-Agent Pattern with Context Quarantine

**Decision**: TableDocumenter spawns ColumnInferencer, both return only summaries

**Rationale**:
- Isolation: Each sub-agent has single responsibility
- Efficiency: Parallel column inference
- Context management: Sub-agents don't leak raw data to parent

**Implementation**: 
- `TableDocumenter.ts`: Returns summary after documenting table
- `ColumnInferencer.ts`: Returns only description string

### 4. Filesystem-Based Communication

**Decision**: Agents communicate via filesystem (JSON files, SQLite database)

**Rationale**:
- Simple: No complex message passing
- Persistent: State survives restarts
- Observable: Users can inspect intermediate files
- Resumable: Checkpoint files enable recovery

**Files**:
- `progress/documentation-plan.json`: Planner output
- `progress/documenter-progress.json`: Documenter state
- `progress/indexer-progress.json`: Indexer state
- `data/tribal-knowledge.db`: SQLite search index
- `docs/**/*.md`: Generated documentation

### 5. Hybrid Search with RRF

**Decision**: Combine FTS5 (keyword) and vector (semantic) search using Reciprocal Rank Fusion

**Rationale**:
- FTS5: Fast keyword matching, handles exact terms
- Vector: Semantic understanding, handles synonyms
- RRF: Combines both rankings without tuning weights

**Implementation**: `retrieval/search/hybrid-search.ts`

### 6. Prompt Template Externalization

**Decision**: Store prompt templates as Markdown files in `/prompts` directory

**Rationale**:
- Editable without code changes
- Version controllable
- Organization-specific customization
- Runtime loading (no recompile)

**Templates**:
- `column-description.md`: Column semantic inference
- `table-description.md`: Table semantic inference
- `domain-inference.md`: Domain detection
- `query-understanding.md`: Query interpretation

### 7. MCP in Separate Repository

**Decision**: MCP tools implemented in separate repository, this repo provides retrieval functions

**Rationale**:
- Separation of concerns: This repo = documentation/indexing, MCP repo = tool server
- Reusability: Retrieval functions can be used by other tools
- Clear boundaries: MCP protocol handled externally

## Design Patterns in Use

### 1. Strategy Pattern: Database Connectors

**Implementation**: `connectors/index.ts` provides unified interface, `postgres.ts` and `snowflake.ts` implement

```typescript
interface DatabaseConnector {
  connect(connectionString: string): Promise<void>;
  getAllTableMetadata(...): Promise<any[]>;
  getRelationships(...): Promise<any[]>;
}
```

**Benefit**: Easy to add new database types without changing core logic

### 2. Factory Pattern: Connector Creation

**Implementation**: `getDatabaseConnector(type)` returns appropriate connector

**Benefit**: Centralized connector creation, type-safe

### 3. Template Method: Sub-Agent Pattern

**Implementation**: TableDocumenter and ColumnInferencer follow similar structure:
1. Load prompt template
2. Prepare variables
3. Call LLM
4. Process response
5. Return result

**Benefit**: Consistent behavior, easy to add new sub-agents

### 4. Checkpoint Pattern: Progress Tracking

**Implementation**: Each agent writes progress JSON files

**Benefit**: Resumable after interruption, transparent state

### 5. Repository Pattern: SQLite Storage

**Implementation**: Indexer abstracts database operations

**Benefit**: Can swap storage backend without changing retrieval logic

## Component Relationships

### Planner → Documenter
- **Contract**: `documentation-plan.json`
- **Format**: JSON schema with table metadata, domains, priorities
- **Usage**: Documenter reads plan, spawns sub-agents per table

### Documenter → Indexer
- **Contract**: `documentation-manifest.json` + Markdown files in `/docs` directory
- **Format**: Structured Markdown with frontmatter, JSON schema files
- **Usage**: Indexer reads manifest, parses files, extracts content, generates embeddings
- **Status**: Phases 1-5 complete (infrastructure + output generation + manifest)
- **Manifest**: Complete manifest generation with file listing, content hashes, and metadata
- **Output Generators**: MarkdownGenerator and JSONGenerator modules available for PRD-compliant output

### Indexer → Retrieval
- **Contract**: SQLite database with FTS5 and vector indices
- **Format**: `documents` table, `documents_fts` virtual table, `documents_vec` table
- **Usage**: Retrieval queries database for search results

### Retrieval → MCP (External)
- **Contract**: MCP tool definitions
- **Format**: JSON-RPC over stdio/HTTP
- **Usage**: External MCP server calls retrieval functions

## Data Flow Patterns

### Planning Flow
```
databases.yaml → Planner → documentation-plan.json
```

### Documentation Flow
```
documentation-plan.json → Documenter → TableDocumenter → ColumnInferencer → /docs/*.md
```

### Indexing Flow
```
/docs/*.md → Indexer → SQLite (FTS5 + vectors)
```

### Retrieval Flow
```
Query → Retrieval → Hybrid Search → RRF → Context Budget → Response
```

## Error Handling Patterns

### 1. Graceful Degradation
- Table documentation fails → Skip table, continue with others
- LLM API timeout → Retry, then use fallback description
- Embedding generation fails → Retry with backoff

### 2. Checkpoint Recovery
- Progress files enable resumption
- Partial success tracked in progress JSON
- User can review and retry failed items

### 3. Fallback Descriptions
- LLM failure → Basic description from column name/type
- Domain inference failure → Group by table prefix
- Query understanding failure → Use raw query terms

## Configuration Patterns

### Environment Variables
- API keys: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`
- Database connections: `POSTGRES_CONNECTION_STRING`, etc.
- Paths: `TRIBAL_DOCS_PATH`, `TRIBAL_DB_PATH`

### YAML Configuration
- `config/databases.yaml`: Database catalog
- `config/agent-config.yaml`: Agent behavior settings

### Prompt Templates
- `prompts/*.md`: LLM instruction templates
- Runtime loading with variable substitution

## Testing Patterns

### Unit Testing
- Connector interfaces
- Prompt template parsing
- Keyword extraction
- RRF ranking

### Integration Testing
- End-to-end pipeline (plan → document → index)
- Multi-database scenarios
- MCP tool invocation
- Large schema handling

### Performance Testing
- Search latency under load
- Documentation speed for large schemas
- Embedding batch processing

## Future Architecture Considerations

### Orchestrator (Planned)
- Coordination layer for chaining commands
- Smart detection of what needs to run
- Interactive pause points for review

### Watch Mode (Future)
- Autonomous re-documentation on schema changes
- Scheduled runs
- Change detection

### Parallel Execution (Future)
- Multi-database parallel documentation
- Streaming indexing during documentation

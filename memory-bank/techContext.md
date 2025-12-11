# Tech Context: Tribal Knowledge Deep Agent

## Technologies Used

### Runtime & Language
- **Node.js**: 20 LTS (JavaScript execution)
- **TypeScript**: 5.x (Type safety, maintainability)
- **Module System**: ES Modules (`"type": "module"`)

### Database & Storage
- **SQLite**: 3.x (Local persistent storage)
- **better-sqlite3**: 11.0.0 (SQLite driver for Node.js)
- **FTS5**: SQLite built-in (Full-text search)
- **sqlite-vec**: 0.1.7-alpha.2 (Vector similarity search)

### External Services
- **OpenAI API**: Embeddings (text-embedding-3-small, 1536 dimensions)
- **Anthropic API**: Semantic inference (Claude Sonnet 4)
- **PostgreSQL**: Source database (via `pg` library)
- **Snowflake**: Source database (via `snowflake-sdk`)

### Key Libraries
| Library | Version | Purpose |
|---------|---------|---------|
| `@anthropic-ai/sdk` | ^0.24.0 | Claude API client |
| `better-sqlite3` | ^11.0.0 | SQLite database driver |
| `chalk` | ^5.6.2 | Terminal colors |
| `commander` | ^12.0.0 | CLI argument parsing |
| `gray-matter` | ^4.0.3 | Frontmatter parsing |
| `js-yaml` | ^4.1.0 | YAML parsing/generation |
| `openai` | ^4.52.0 | OpenAI API client |
| `pg` | ^8.11.0 | PostgreSQL client |
| `snowflake-sdk` | ^1.12.0 | Snowflake client |
| `sqlite-vec` | ^0.1.7-alpha.2 | Vector embeddings in SQLite |
| `zod` | ^3.22.0 | Runtime type validation |

### Development Tools
- **tsx**: ^4.7.0 (TypeScript execution)
- **TypeScript**: ^5.3.0 (Compilation)
- **vitest**: ^1.2.0 (Testing framework)

## Development Setup

### Prerequisites
- Node.js >= 20.0.0
- npm or yarn
- Access to PostgreSQL and/or Snowflake databases
- OpenAI API key
- Anthropic API key

### Installation
```bash
npm install
```

### Configuration
1. Copy example config files:
   ```bash
   cp config/databases.yaml.example config/databases.yaml
   cp config/agent-config.yaml.example config/agent-config.yaml
   ```

2. Set environment variables:
   ```bash
   export OPENAI_API_KEY="your-key"
   export ANTHROPIC_API_KEY="your-key"
   export POSTGRES_CONNECTION_STRING="postgresql://..."
   ```

3. Configure databases in `config/databases.yaml`

### Build & Run
```bash
# Build TypeScript
npm run build

# Development mode (watch)
npm run dev

# Run individual phases
npm run plan      # Schema analysis
npm run document  # Generate documentation
npm run index     # Build search index
npm run pipeline  # Run all phases

# Utilities
npm run status            # Show progress
npm run validate-prompts # Validate prompt templates
```

## Technical Constraints

### Performance Targets
- Planning: < 30 seconds for 100 tables
- Documentation: < 5 minutes for 100 tables
- Indexing: < 2 minutes for 100 tables
- Search latency (p50): < 200ms
- Search latency (p95): < 500ms

### Scalability Limits
- Maximum tables per database: 1,000+
- Maximum databases in catalog: 10+
- Maximum documents in search index: 50,000+
- Concurrent MCP queries: 10+

### Resource Constraints
- Local storage: Documentation and index stored locally (not cloud)
- API costs: OpenAI embeddings and LLM calls incur per-token costs
- Memory: < 1GB RAM during large schema processing
- Network: Requires connectivity to databases and APIs

### Database Constraints
- Read-only access required (SELECT on metadata and sample data)
- Tables with < 500 columns (assumed)
- Reasonable naming conventions (assumed)

## Dependencies

### External Dependencies
| Dependency | Purpose | Risk Level |
|------------|---------|------------|
| OpenAI API | Embeddings | Medium |
| Anthropic API | Semantic inference | Medium |
| PostgreSQL | Source database | Low |
| Snowflake | Source database | Low |
| Noah's Company MCP | Agent integration | Medium |

### Internal Dependencies
- PAM-CRS learnings (available)
- Supabase test database (available)
- Snowflake test database (TBD)

## Database Integration Details

### PostgreSQL
- **Connection**: Connection string via `pg` library
- **Format**: `postgresql://user:password@host:port/database`
- **Metadata Queries**: `information_schema` views
- **Sampling**: `TABLESAMPLE` or `ORDER BY RANDOM() LIMIT 100`
- **Row Count**: Approximate from `pg_class.reltuples`

### Snowflake
- **Connection**: Connection parameters object via `snowflake-sdk`
- **Parameters**: account, username, password, warehouse, database, schema
- **Metadata Queries**: `INFORMATION_SCHEMA` views
- **Sampling**: `SAMPLE (100 ROWS)` clause
- **Row Count**: From `INFORMATION_SCHEMA.TABLES.ROW_COUNT` (maintained by Snowflake)

## Vector Store Details

### Current Implementation: sqlite-vec
- **Dimensions**: 1536 (OpenAI text-embedding-3-small)
- **Distance Metric**: Cosine similarity
- **Storage**: BLOB in SQLite `documents_vec` table
- **Batch Size**: 50 documents per embedding request

### Future: Pinecone (Planned)
- Abstraction layer exists for migration
- VectorStore interface defined
- Can swap implementation without changing retrieval logic

## Search Implementation

### Hybrid Search Components
1. **FTS5**: Full-text search with BM25 ranking
   - Tokenizer: porter (stemming)
   - Indexed: content, summary, keywords
   
2. **Vector Search**: Semantic similarity
   - Model: text-embedding-3-small
   - Dimensions: 1536
   - Distance: Cosine similarity

3. **Reciprocal Rank Fusion (RRF)**
   - Constant k: 60
   - Combines FTS5 and vector rankings
   - No weight tuning required

### Document Type Weights
- **Table documents**: 1.5x boost
- **Relationship documents**: 1.2x boost
- **Column documents**: 1.0x boost
- **Domain documents**: 1.0x boost

## Prompt Template System

### Template Location
- Directory: `/prompts`
- Format: Markdown files with `{{variable}}` placeholders
- Loading: Runtime (no recompile needed)

### Template Files
- `column-description.md`: Column semantic inference
- `table-description.md`: Table semantic inference
- `domain-inference.md`: Domain detection
- `query-understanding.md`: Query interpretation

### Variable Substitution
- Pattern: `{{variable_name}}`
- Runtime interpolation
- Validation on startup

## Configuration System

### Configuration Files
1. **databases.yaml**: Database catalog
   - Database definitions
   - Connection settings
   - Schema filters
   - Table exclusions

2. **agent-config.yaml**: Agent behavior
   - Planner settings
   - Documenter concurrency
   - Indexer batch sizes
   - Retrieval limits

### Environment Variables
- `OPENAI_API_KEY`: Required for embeddings
- `ANTHROPIC_API_KEY`: Required for inference
- `TRIBAL_DOCS_PATH`: Optional (default: `./docs`)
- `TRIBAL_DB_PATH`: Optional (default: `./data/tribal-knowledge.db`)
- `TRIBAL_PROMPTS_PATH`: Optional (default: `./prompts`)
- `TRIBAL_LOG_LEVEL`: Optional (default: `info`)

## Logging & Monitoring

### Logging Strategy
- **Format**: Structured JSON logs
- **Levels**: ERROR, WARN, INFO, DEBUG
- **Library**: Custom logger utility

### Key Events Logged
- Plan generation start/complete
- Database connection success/failure
- Table documentation start/complete
- Prompt template loading
- LLM API calls (with token counts)
- Embedding batch generation
- Search query execution with timing
- MCP tool invocation

## Error Handling

### Retry Strategies
- **LLM API**: Exponential backoff (1s, 2s, 4s)
- **Embedding API**: Backoff with batch size reduction
- **Database Connection**: Retry with backoff

### Fallback Mechanisms
- **LLM failure**: Basic description from metadata
- **Domain inference failure**: Group by table prefix
- **Query understanding failure**: Use raw query terms
- **Partial failures**: Continue with available data

## Security Considerations

### Credential Management
- **Storage**: Environment variables only
- **Logging**: Credentials never in logs
- **Transmission**: Secure connections only

### Data Handling
- **Sample Data**: Stored locally, not transmitted
- **API Keys**: Secure environment variable storage
- **Database Access**: Read-only permissions required

## Testing Infrastructure

### Test Framework
- **Framework**: Vitest
- **Type**: Unit and integration tests
- **Coverage Targets**: 80-95% per module

### Test Categories
- Unit: Connectors, prompt parsing, keyword extraction
- Integration: End-to-end pipeline, multi-database
- Performance: Search latency, documentation speed
- Quality: Search relevance, join path accuracy

## Deployment Considerations

### Current: Local Development
- Single-user operation
- Manual triggers
- Local file storage
- No cloud deployment

### Future Considerations
- Multi-user concurrent access
- Cloud-hosted deployment
- Real-time schema change detection
- Scheduled runs

## Performance Optimization

### Batching
- Embedding generation: 50 documents per batch
- Table processing: Configurable concurrency (default 5)

### Caching
- Prompt templates: Cached in memory
- Embeddings: Stored in database (no regeneration)

### Database Optimization
- FTS5 optimization after indexing
- ANALYZE for query optimization
- VACUUM for space optimization

## Known Technical Limitations

1. **Single User**: Initial version designed for single-user operation
2. **Manual Triggers**: No autonomous execution
3. **Local Storage**: Documentation and index stored locally
4. **Tables Only**: Views and materialized views not supported in MVP
5. **No Real-time**: Schema changes require manual re-documentation

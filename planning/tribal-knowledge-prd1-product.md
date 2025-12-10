# Tribal Knowledge Deep Agent
## Product Requirements Document (PRD1)

**Version**: 1.1  
**Date**: December 9, 2025  
**Product Owner**: Myles  
**Status**: Draft  
**Change**: Added Deep Agent properties (Planning, Sub-agents, System Prompts)

---

## 1. Executive Summary

### 1.1 Problem Statement

Organizations accumulate critical data knowledge that exists only in the minds of experienced team members - "tribal knowledge." When data scientists need to answer business questions like "Who are my customers most likely to churn?", they face significant friction:

- **Discovery friction**: Which tables contain relevant data?
- **Schema confusion**: What do cryptic column names actually mean?
- **Join complexity**: How do tables relate to each other?
- **Documentation debt**: Outdated or non-existent data dictionaries

This tribal knowledge problem slows down analytics, increases onboarding time, and creates dependencies on specific individuals.

### 1.2 Solution Overview

The Tribal Knowledge Deep Agent is an AI-powered deep agent system that automatically:

1. **Plans** documentation strategy by analyzing database structure first
2. **Documents** database schemas with semantic understanding via specialized sub-agents
3. **Indexes** documentation for efficient natural language search
4. **Retrieves** relevant context via MCP for AI agent consumption

The system implements deep agent patterns: explicit planning before execution, sub-agent delegation for repeated tasks, filesystem-based persistent memory, and configurable system prompts for consistent LLM behavior.

### 1.3 Target Users

| User Type | Primary Need |
|-----------|--------------|
| **Data Scientists** | Find relevant tables and understand how to query them |
| **Data Engineers** | Maintain accurate, up-to-date documentation |
| **AI Agents** | Receive minimal, high-signal context for SQL generation |
| **New Team Members** | Quickly understand data landscape during onboarding |

### 1.4 Business Value

- **Reduced time-to-insight**: Data scientists find relevant data in seconds, not hours
- **Lower onboarding costs**: New analysts become productive faster
- **Eliminated dependencies**: Knowledge no longer locked in individual minds
- **AI enablement**: External agents can autonomously discover data context

---

## 2. User Stories

### 2.1 Data Scientist Stories

**US-1: Natural Language Table Search**
> As a data scientist, I want to search for tables using natural language so that I can find relevant data without knowing exact table names.

Acceptance Criteria:
- Can search with queries like "customer churn" or "monthly revenue"
- Results return within 2 seconds
- Top 3 results contain relevant tables >85% of the time
- Response includes table description and key columns

**US-2: Understand Table Purpose**
> As a data scientist, I want to see what a table contains and what it's used for so that I can determine if it's right for my analysis.

Acceptance Criteria:
- Can retrieve full schema for any documented table
- Includes human-readable column descriptions
- Shows sample values for context
- Indicates data freshness and row counts

**US-3: Discover Join Paths**
> As a data scientist, I want to know how to join two tables so that I can combine data without trial and error.

Acceptance Criteria:
- Given two tables, returns the join path (including intermediate tables)
- Provides copy-paste SQL snippet
- Handles multi-hop joins (up to 3 tables apart)
- Indicates join type (INNER, LEFT, etc.)

**US-4: Explore Business Domains**
> As a data scientist, I want to see all tables in a business domain so that I can understand the full data available for my analysis area.

Acceptance Criteria:
- Can list all available domains
- Can get overview of tables within a domain
- Includes ER diagram showing relationships
- Shows common query patterns for the domain

### 2.2 Data Engineer Stories

**US-5: Automatic Documentation Generation**
> As a data engineer, I want the system to automatically document our databases so that documentation stays current without manual effort.

Acceptance Criteria:
- Connects to PostgreSQL and Snowflake databases
- Extracts all metadata (tables, columns, keys, indexes)
- Infers semantic meaning from names and sample data
- Generates Markdown, JSON Schema, and YAML outputs

**US-6: Documentation Updates**
> As a data engineer, I want to re-run documentation when schemas change so that docs stay synchronized with actual data.

Acceptance Criteria:
- Can re-document a single database
- Detects which tables have changed
- Preserves manual overrides/annotations
- Updates search index automatically

**US-7: Multi-Database Support**
> As a data engineer, I want to document multiple databases from different platforms so that our entire data estate is searchable.

Acceptance Criteria:
- Supports PostgreSQL (including Supabase)
- Supports Snowflake
- Single catalog file configures all connections
- Cross-database search works seamlessly

**US-8: Review Documentation Plan** *(NEW - Deep Agent)*
> As a data engineer, I want to review the documentation plan before execution so that I can verify scope and adjust priorities.

Acceptance Criteria:
- System generates documentation-plan.json before documenting
- Plan shows detected domains and table groupings
- Plan includes estimated time and complexity
- Can modify plan before proceeding

### 2.3 AI Agent Stories

**US-9: Efficient Context Retrieval**
> As an AI agent, I want to receive minimal but sufficient context so that I can generate accurate SQL without exceeding token limits.

Acceptance Criteria:
- Responses fit within configurable token budget
- Most relevant information prioritized
- Unnecessary details omitted
- Token count included in response

**US-10: Structured Tool Responses**
> As an AI agent, I want tool responses in consistent, parseable formats so that I can reliably extract information.

Acceptance Criteria:
- All responses follow documented JSON schemas
- Error responses are structured and actionable
- Partial results returned when applicable
- Response includes metadata (tokens used, result count)

### 2.4 New Team Member Stories

**US-11: Data Landscape Overview**
> As a new team member, I want to see an overview of our data landscape so that I can quickly understand what data we have.

Acceptance Criteria:
- Catalog summary shows all databases and domains
- ER diagrams visualize key relationships
- Domain descriptions explain business context
- Can drill down from overview to specific tables

### 2.5 System Consistency Stories *(NEW - Deep Agent)*

**US-12: Consistent Semantic Descriptions**
> As a data engineer, I want column and table descriptions to follow a consistent style so that documentation is professional and predictable.

Acceptance Criteria:
- All descriptions generated using defined prompt templates
- Descriptions are factual and grounded in evidence (sample data)
- No speculation beyond what data shows
- Templates are editable without code changes

**US-13: Customizable Inference Behavior**
> As a data engineer, I want to customize how the system infers meaning so that it matches our organization's terminology.

Acceptance Criteria:
- Prompt templates stored in /prompts directory
- Can edit templates without redeploying
- Templates support organization-specific context
- Changes apply to next documentation run

---

## 3. Functional Requirements

### 3.1 Planning (NEW - Deep Agent)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-0.1 | Analyze database schema before documentation begins | Must Have |
| FR-0.2 | Detect potential business domains from table names and relationships | Must Have |
| FR-0.3 | Estimate documentation complexity (tables, columns, relationships) | Should Have |
| FR-0.4 | Generate documentation-plan.json with prioritized table list | Must Have |
| FR-0.5 | Allow user review and modification of plan before execution | Should Have |

### 3.2 Database Documentation (Agent 1)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-1.1 | Connect to PostgreSQL databases via connection string | Must Have |
| FR-1.2 | Connect to Snowflake databases via connection parameters | Must Have |
| FR-1.3 | Extract table metadata (name, schema, row count, comments) | Must Have |
| FR-1.4 | Extract column metadata (name, type, nullable, default, comments) | Must Have |
| FR-1.5 | Extract primary key and foreign key constraints | Must Have |
| FR-1.6 | Extract index information | Should Have |
| FR-1.7 | Sample up to 100 rows per table for pattern inference | Must Have |
| FR-1.8 | Infer semantic descriptions for columns using LLM and prompt template | Must Have |
| FR-1.9 | Infer semantic descriptions for tables using LLM and prompt template | Must Have |
| FR-1.10 | Automatically detect business domains from table relationships | Should Have |
| FR-1.11 | Generate Markdown documentation per table | Must Have |
| FR-1.12 | Generate JSON Schema files per table | Should Have |
| FR-1.13 | Generate YAML semantic model files per table | Should Have |
| FR-1.14 | Generate Mermaid ER diagrams per domain | Should Have |
| FR-1.15 | Generate full-schema ER diagram (simplified) | Should Have |
| FR-1.16 | Track progress and support resumption after interruption | Must Have |
| FR-1.17 | Delegate table documentation to TableDocumenter sub-agent | Should Have |
| FR-1.18 | Delegate column inference to ColumnInferencer sub-agent | Should Have |

### 3.3 Document Indexing (Agent 2)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-2.1 | Parse generated Markdown documentation files | Must Have |
| FR-2.2 | Extract semantic keywords from column names | Must Have |
| FR-2.3 | Extract semantic keywords from sample data patterns | Should Have |
| FR-2.4 | Generate embeddings for table-level documents | Must Have |
| FR-2.5 | Generate embeddings for column-level documents | Should Have |
| FR-2.6 | Generate embeddings for relationship descriptions | Should Have |
| FR-2.7 | Store documents in SQLite database | Must Have |
| FR-2.8 | Build FTS5 full-text search index | Must Have |
| FR-2.9 | Store vector embeddings in sqlite-vec | Must Have |
| FR-2.10 | Apply different weights to table vs column vs relationship docs | Should Have |
| FR-2.11 | Index relationship/join path information | Must Have |
| FR-2.12 | Support incremental re-indexing | Should Have |
| FR-2.13 | Track indexing progress | Must Have |

### 3.4 Index Retrieval / MCP (Agent 3)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-3.1 | Implement `search_tables` MCP tool | Must Have |
| FR-3.2 | Implement `get_table_schema` MCP tool | Must Have |
| FR-3.3 | Implement `get_join_path` MCP tool | Must Have |
| FR-3.4 | Implement `get_domain_overview` MCP tool | Should Have |
| FR-3.5 | Implement `list_domains` MCP tool | Should Have |
| FR-3.6 | Implement `get_common_relationships` MCP tool | Could Have |
| FR-3.7 | Perform hybrid search combining FTS5 and vector similarity | Must Have |
| FR-3.8 | Apply Reciprocal Rank Fusion for result ranking | Must Have |
| FR-3.9 | Apply document type weight boosts | Should Have |
| FR-3.10 | Calculate adaptive context budget based on query complexity | Should Have |
| FR-3.11 | Compress responses to fit within token budget | Must Have |
| FR-3.12 | Return token count in all responses | Must Have |
| FR-3.13 | Install as tools into Noah's Company MCP | Must Have |
| FR-3.14 | Use query-understanding prompt template for search interpretation | Should Have |

### 3.5 Prompt Templates (NEW - Deep Agent)

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-4.1 | Store prompt templates in /prompts directory | Must Have |
| FR-4.2 | Implement column-description.md prompt template | Must Have |
| FR-4.3 | Implement table-description.md prompt template | Must Have |
| FR-4.4 | Implement domain-inference.md prompt template | Should Have |
| FR-4.5 | Implement query-understanding.md prompt template | Should Have |
| FR-4.6 | Load templates at runtime (no recompile needed) | Must Have |
| FR-4.7 | Support variable substitution in templates | Must Have |
| FR-4.8 | Validate template format on startup | Should Have |

---

## 4. Non-Functional Requirements

### 4.1 Performance

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-P1 | Planning time for 100-table database | < 30 seconds |
| NFR-P2 | Documentation time for 100-table database | < 5 minutes |
| NFR-P3 | Indexing time for 100 tables | < 2 minutes |
| NFR-P4 | Search query latency (p50) | < 200ms |
| NFR-P5 | Search query latency (p95) | < 500ms |
| NFR-P6 | MCP tool response time (p95) | < 2 seconds |
| NFR-P7 | Embedding generation batch size | 50 documents |

### 4.2 Scalability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-S1 | Maximum tables per database | 1,000+ |
| NFR-S2 | Maximum databases in catalog | 10+ |
| NFR-S3 | Maximum documents in search index | 50,000+ |
| NFR-S4 | Concurrent MCP queries | 10+ |

### 4.3 Reliability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-R1 | Planning process produces valid JSON | 100% |
| NFR-R2 | Documentation process resumability | Support checkpoint recovery |
| NFR-R3 | Indexing process resumability | Support checkpoint recovery |
| NFR-R4 | Database connection timeout handling | Retry with backoff |
| NFR-R5 | LLM API error handling | Retry with fallback |
| NFR-R6 | Graceful degradation on partial failures | Continue with available data |

### 4.4 Security

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-SEC1 | Database credentials storage | Environment variables only |
| NFR-SEC2 | No credential logging | Credentials never in logs |
| NFR-SEC3 | Sample data handling | Stored locally, not transmitted |
| NFR-SEC4 | API key management | Secure environment variable storage |

### 4.5 Maintainability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-M1 | Code documentation | JSDoc for all public functions |
| NFR-M2 | Modular architecture | Separate modules per agent |
| NFR-M3 | Configuration externalization | YAML config files |
| NFR-M4 | Logging | Structured JSON logs |
| NFR-M5 | Database connector abstraction | Interface for new DB types |
| NFR-M6 | Prompt template externalization | Editable without code changes |

### 4.6 Usability

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-U1 | Generated Markdown readability | Human-readable without tooling |
| NFR-U2 | ER diagram clarity | Domain diagrams < 20 tables |
| NFR-U3 | Error messages | Clear, actionable messages |
| NFR-U4 | Progress visibility | Real-time progress for long operations |
| NFR-U5 | Plan reviewability | Human-readable plan JSON |

### 4.7 Consistency (NEW - Deep Agent)

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-C1 | Description style consistency | All descriptions follow template patterns |
| NFR-C2 | Factual grounding | Descriptions cite evidence from sample data |
| NFR-C3 | No hallucination | Never speculate beyond available data |
| NFR-C4 | Terminology consistency | Use organization terms from templates |

---

## 5. Testing Requirements

### 5.1 Unit Testing

| Test Area | Coverage Target | Key Test Cases |
|-----------|-----------------|----------------|
| Schema Analysis | 90% | Domain detection, table grouping, plan generation |
| Metadata Extraction | 90% | PostgreSQL queries, Snowflake queries, null handling |
| Semantic Inference | 80% | Column name parsing, abbreviation expansion, pattern detection |
| Keyword Extraction | 90% | Various column name formats, sample data patterns |
| Embedding Generation | 80% | Batch processing, error handling, dimension validation |
| FTS5 Indexing | 90% | Insert, update, delete, query syntax |
| Vector Search | 90% | Similarity calculation, top-k retrieval |
| RRF Ranking | 95% | Score combination, tie handling, weight application |
| Prompt Loading | 90% | Template parsing, variable substitution, validation |

### 5.2 Integration Testing

| Test Scenario | Description |
|---------------|-------------|
| IT-1: Planning Phase | Analyze database, verify plan output format |
| IT-2: End-to-end PostgreSQL | Plan → Document → Index → Search a real PostgreSQL database |
| IT-3: End-to-end Snowflake | Plan → Document → Index → Search a real Snowflake database |
| IT-4: Multi-database | Document and search across both database types |
| IT-5: MCP Integration | Tools correctly installed and callable from MCP client |
| IT-6: Large Schema | 500+ table database planning, documentation and search |
| IT-7: Incremental Update | Re-document with schema changes, verify index updates |
| IT-8: Prompt Customization | Modify template, verify description style changes |

### 5.3 Search Quality Testing

| Test Type | Method | Target |
|-----------|--------|--------|
| Relevance Testing | Manual evaluation of 50 queries | Top-3 hit rate > 85% |
| Join Path Accuracy | Verify SQL correctness on test schema | > 95% accuracy |
| Semantic Understanding | Natural language queries vs keyword queries | Semantic improves results |
| Domain Grouping | Validate auto-detected domains | > 80% sensible grouping |

### 5.4 Performance Testing

| Test Type | Method | Target |
|-----------|--------|--------|
| Planning Speed | Time analysis for 10/50/100/500 table databases | < 30s for 100 tables |
| Documentation Speed | Time 10/50/100/500 table databases | Linear scaling |
| Indexing Speed | Time document batch processing | < 1 sec per 10 docs |
| Search Latency | Load test with concurrent queries | p95 < 500ms |
| Memory Usage | Monitor during large schema processing | < 1GB RAM |

### 5.5 Error Handling Testing

| Test Scenario | Expected Behavior |
|---------------|-------------------|
| Database connection failure | Retry with backoff, clear error message |
| LLM API timeout | Retry, fallback to basic description |
| Malformed table data | Skip table, log warning, continue |
| Embedding API rate limit | Backoff and retry, batch size reduction |
| Disk full during documentation | Checkpoint state, clear error |
| Invalid search query | Return empty results with explanation |
| Missing prompt template | Clear error on startup |
| Invalid prompt template | Validation error with line number |

---

## 6. Success Criteria

### 6.1 MVP Success Criteria (Phase 4 Completion)

| Criterion | Metric | Target | Measurement Method |
|-----------|--------|--------|-------------------|
| **Planning Coverage** | Plan generated for all databases | 100% | Automated verification |
| **Documentation Coverage** | % of tables successfully documented | 100% | Automated verification |
| **Search Relevance** | Top-3 results contain relevant table | > 85% | Manual evaluation (50 queries) |
| **Join Path Accuracy** | Generated SQL is syntactically correct | > 95% | Automated SQL validation |
| **Response Efficiency** | Responses within token budget | 100% | Automated check |
| **MCP Integration** | All tools callable from Noah's MCP | Pass/Fail | Integration test |
| **Performance** | Search latency p95 | < 500ms | Load testing |
| **Prompt Consistency** | Descriptions follow template style | > 95% | Manual review sample |

### 6.2 Quality Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Semantic description accuracy | > 90% sensible | Manual review sample |
| Domain inference accuracy | > 80% logical groupings | Manual review |
| ER diagram usefulness | Diagrams under 25 tables readable | Visual inspection |
| Documentation completeness | All tables have description + columns | Automated check |
| Description factual grounding | No speculation beyond data | Manual review sample |

### 6.3 User Satisfaction Criteria

| User | Success Indicator |
|------|-------------------|
| Data Scientists | Can find relevant tables in < 30 seconds |
| Data Scientists | Generated join SQL works on first try |
| Data Engineers | Full documentation in single command |
| Data Engineers | Can review and adjust plan before execution |
| AI Agents | Receive sufficient context for SQL generation |

### 6.4 Business Success Criteria

| Metric | Target | Timeline |
|--------|--------|----------|
| Time to find relevant data | Reduce by 80% | Post-MVP measurement |
| New analyst onboarding time | Reduce data discovery portion by 50% | 3 months post-launch |
| Documentation maintenance effort | Reduce by 90% | Ongoing measurement |

---

## 7. Constraints and Assumptions

### 7.1 Constraints

- **Database Access**: Requires read access to metadata and sample data
- **API Costs**: OpenAI embeddings and LLM calls incur per-token costs
- **Local Storage**: Documentation and index stored locally (not cloud)
- **Single User**: Initial version designed for single-user operation
- **MCP Dependency**: Requires Noah's Company MCP for external agent access
- **Manual Triggers**: Users manually trigger pipeline (no autonomous execution)

### 7.2 Assumptions

- Users have valid database credentials
- Databases follow reasonable naming conventions
- Tables have fewer than 500 columns
- Network connectivity to databases and OpenAI API
- Sufficient disk space for documentation and index
- Prompt templates are valid Markdown with correct variables

### 7.3 Out of Scope (MVP)

- Real-time schema change detection
- Multi-user concurrent access
- Cloud-hosted deployment
- PII/sensitive data detection
- Custom domain configuration (auto-detect only)
- Views and materialized views (tables only for MVP)
- Stored procedures and functions
- Autonomous re-documentation

---

## 8. Dependencies

### 8.1 External Dependencies

| Dependency | Purpose | Risk Level |
|------------|---------|------------|
| OpenAI API | Embeddings and semantic inference | Medium |
| Anthropic API | Semantic descriptions via Claude | Medium |
| PostgreSQL | Source database | Low |
| Snowflake | Source database | Low |
| Noah's Company MCP | Agent integration | Medium |

### 8.2 Internal Dependencies

| Dependency | Owner | Status |
|------------|-------|--------|
| PAM-CRS learnings | Myles | Available |
| Supabase test database | Myles | Available |
| Snowflake test database | TBD | Needed |
| Prompt templates | To be created | Phase 1 |

---

## 9. Risks and Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| LLM hallucinations in descriptions | Medium | Medium | Prompt templates require evidence, allow manual overrides |
| Poor search relevance | High | Low | Hybrid search, iterative tuning |
| API cost overruns | Medium | Medium | Batch requests, cache results |
| Large schema performance | Medium | Medium | Chunked processing, sub-agent parallelism |
| MCP integration complexity | High | Medium | Early integration testing |
| Snowflake connector issues | Medium | Low | Reference existing implementations |
| Inconsistent descriptions | Medium | Medium | Strict prompt templates, validation |
| Template syntax errors | Low | Low | Startup validation, clear error messages |

---

## 10. Glossary

| Term | Definition |
|------|------------|
| **Deep Agent** | AI agent with planning, sub-agents, filesystem memory, and configurable prompts |
| **Domain** | A logical grouping of related tables (e.g., "customers", "orders") |
| **FTS5** | SQLite's full-text search extension |
| **Hybrid Search** | Combining keyword (FTS5) and semantic (vector) search |
| **MCP** | Model Context Protocol - standard for AI agent tool integration |
| **Planner** | Schema Analyzer that creates documentation plan before execution |
| **Prompt Template** | Configurable instruction file for LLM behavior |
| **RRF** | Reciprocal Rank Fusion - algorithm for combining search rankings |
| **Semantic Inference** | Using LLM to understand meaning from names and data |
| **sqlite-vec** | SQLite extension for vector similarity search |
| **Sub-agent** | Specialized worker agent for repeated tasks |
| **Tribal Knowledge** | Undocumented organizational knowledge held by individuals |

---

*End of PRD1*

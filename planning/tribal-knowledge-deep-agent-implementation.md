# Tribal Knowledge Deep Agent
## Technical Product Requirements Document (PRD)

**Version**: 1.1  
**Date**: December 9, 2025  
**Authors**: Myles & Claude  
**Status**: Draft - Pending Review  
**Change**: Added Deep Agent properties (Planning, Sub-agents, System Prompts)

---

## Executive Summary

The Tribal Knowledge Deep Agent is a deep agent system that automatically documents database schemas, indexes that documentation for efficient retrieval, and exposes it via MCP for consumption by external AI agents. The system addresses a critical enterprise pain point: companies falling behind on data documentation, leading to tribal knowledge silos and inefficient data discovery.

The system implements the four pillars of deep agent architecture:
1. **Planning Tool**: Schema Analyzer creates documentation plan before execution
2. **Sub-agents**: TableDocumenter and ColumnInferencer handle repeated tasks
3. **File System**: Filesystem + SQLite for persistent external memory
4. **System Prompts**: Configurable prompt templates for consistent LLM behavior

### Core Value Proposition
- **For Data Scientists**: Ask "Who are my customers most likely to churn?" and receive relevant table schemas, join paths, and column descriptions with minimal context overhead
- **For Data Teams**: Automatically generate and maintain comprehensive database documentation
- **For Organizations**: Convert undocumented tribal knowledge into searchable, indexed documentation

### Integration Target
Tools will be installed into Noah's Company MCP (`https://github.com/nstjuliana/company-mcp`), enabling external agents to query our indexed documentation.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [Deep Agent Properties](#2-deep-agent-properties)
3. [Planner: Schema Analyzer](#3-planner-schema-analyzer)
4. [Agent 1: Database Documenter](#4-agent-1-database-documenter)
5. [Sub-agent Specifications](#5-sub-agent-specifications)
6. [Prompt Templates](#6-prompt-templates)
7. [Agent 2: Document Indexer](#7-agent-2-document-indexer)
8. [Agent 3: Index Retrieval / MCP](#8-agent-3-index-retrieval--mcp)
9. [Data Models](#9-data-models)
10. [Configuration](#10-configuration)
11. [Technical Stack](#11-technical-stack)
12. [Implementation Phases](#12-implementation-phases)
13. [Success Criteria](#13-success-criteria)
14. [Open Questions & Future Work](#14-open-questions--future-work)

---

## 1. System Architecture

### 1.1 High-Level Architecture

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
│         │            │┌───────────┐│            │                          │
│         │            ││ TableDoc  ││            │                          │
│         │            │└───────────┘│            │                          │
│         │            │┌───────────┐│            │                          │
│         │            ││ColumnInf ││            │                          │
│         │            │└───────────┘│            │                          │
│         │            └─────────────┘            │                          │
│         ▼                   ▼                   ▼                          │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐                  │
│  │  Plan JSON   │    │  Filesystem  │    │   SQLite     │                  │
│  │              │    │  (MD/JSON/   │    │  + Vectors   │                  │
│  │              │    │   YAML)      │    │  (FTS5+Vec)  │                  │
│  └──────────────┘    └──────────────┘    └──────────────┘                  │
│                                                                             │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        PROMPT TEMPLATES (/prompts/)                  │  │
│  │   column-description.md  table-description.md  domain-inference.md   │  │
│  │   query-understanding.md                                             │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
│                             ┌──────────────┐                               │
│                             │   AGENT 3    │                               │
│                             │   Retrieval  │                               │
│                             │   / MCP      │                               │
│                             └──────────────┘                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │     Noah's Company MCP        │
                    │  (External Agent Interface)   │
                    └───────────────────────────────┘
```

### 1.2 Design Principles (Informed by Research)

Based on our research synthesis, we adopt these key principles:

| Principle | Source | Application |
|-----------|--------|-------------|
| **Context is finite** | Anthropic Context Engineering | Adaptive context budgets, minimal token returns |
| **Progressive disclosure** | mariozechner, Phil Schmid | Load docs/schemas only when needed |
| **Explicit planning** | Deep Agents 2.0 | Schema Analyzer creates plan before documenting |
| **External memory** | Phil Schmid, LangChain | Filesystem + SQLite, not in-context |
| **Good design is boring** | Sean Goedecke | Simple, proven components (FTS5, sqlite-vec) |
| **Hybrid search** | PAM-CRS learnings | FTS5 + vector + Reciprocal Rank Fusion |
| **Context quarantine** | Deep Agents 2.0 | Sub-agents return summaries, not raw data |
| **Configurable prompts** | Best practice | External templates for consistency |

### 1.3 Data Flow

```
┌─────────────────┐
│  Database(s)    │
│  - PostgreSQL   │
│  - Snowflake    │
└────────┬────────┘
         │ connection test + table count
         ▼
┌─────────────────┐
│ Planner:        │
│ Schema Analyzer │──────────────────────────────────────┐
└────────┬────────┘                                      │
         │                                               │
         ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│ documentation-  │                           │ Prompt:         │
│ plan.json       │                           │ domain-         │
│                 │                           │ inference.md    │
└────────┬────────┘                           └─────────────────┘
         │ plan input
         ▼
┌─────────────────┐
│ Agent 1:        │
│ Documenter      │──────────────────────────────────────┐
└────────┬────────┘                                      │
         │                                               │
         │ spawns sub-agents                             ▼
         ▼                                    ┌─────────────────┐
┌─────────────────┐                           │ Prompts:        │
│ Sub-agents:     │                           │ - column-       │
│ ┌─────────────┐ │                           │   description   │
│ │TableDoc     │ │                           │ - table-        │
│ │  ┌────────┐ │ │                           │   description   │
│ │  │ColInfer│ │ │                           └─────────────────┘
│ │  └────────┘ │ │
│ └─────────────┘ │
└────────┬────────┘
         │ returns summaries
         ▼
┌─────────────────┐                           ┌─────────────────┐
│ Filesystem      │                           │ Progress State  │
│ /docs/          │                           │ documenter-     │
│  ├── tables/    │                           │ progress.json   │
│  ├── domains/   │                           └─────────────────┘
│  └── schemas/   │
└────────┬────────┘
         │ file paths
         ▼
┌─────────────────┐
│ Agent 2:        │
│ Indexer         │──────────────────────────────────────┐
└────────┬────────┘                                      │
         │                                               │
         ▼                                               ▼
┌─────────────────┐                           ┌─────────────────┐
│ SQLite DB       │                           │ Progress State  │
│ - FTS5 index    │                           │ indexer-        │
│ - Vector store  │                           │ progress.json   │
│ - Metadata      │                           └─────────────────┘
└────────┬────────┘
         │ search interface
         ▼
┌─────────────────┐                           ┌─────────────────┐
│ Agent 3:        │◀──── uses ────────────────│ Prompt:         │
│ Retrieval/MCP   │◀──── queries from MCP     │ query-          │
└─────────────────┘                           │ understanding   │
                                              └─────────────────┘
```

---

## 2. Deep Agent Properties

### 2.1 Overview

This system implements the four pillars of deep agent architecture as defined in the "Agents 2.0" research:

| Property | Implementation | Purpose |
|----------|----------------|---------|
| **Planning Tool** | Schema Analyzer | Understand the problem before acting |
| **Sub-agents** | TableDocumenter, ColumnInferencer | Isolate repeated tasks |
| **File System** | /docs, /progress, SQLite | Persistent external memory |
| **System Prompts** | /prompts/*.md | Guardrails and consistency |

### 2.2 Why These Properties Matter

**Planning Tool (Schema Analyzer)**
- Without: Agent blindly iterates through tables, no sense of scope
- With: Agent understands database structure, detects domains, prioritizes work
- Benefit: User can review and adjust plan before expensive documentation phase

**Sub-agents (TableDocumenter, ColumnInferencer)**
- Without: Monolithic agent with complex state, hard to debug
- With: Clean separation of concerns, each sub-agent handles one thing
- Benefit: Context quarantine prevents information overload, easier testing

**File System (/docs, /progress, SQLite)**
- Without: All state in memory, lost on interruption
- With: Persistent state, checkpoint recovery, human-readable outputs
- Benefit: Resume after failures, inspect intermediate results

**System Prompts (/prompts/*.md)**
- Without: Prompts embedded in code, inconsistent outputs
- With: External templates, variable substitution, editable without deploy
- Benefit: Consistent descriptions, organization-specific customization

### 2.3 Manual Control Philosophy

The system uses manual triggers, not autonomous behavior:

| Action | Trigger | Rationale |
|--------|---------|-----------|
| Planning | `npm run plan` | User initiates analysis |
| Documentation | `npm run document` | User confirms plan first |
| Indexing | `npm run index` | User verifies docs first |
| Serving | `npm run serve` | User starts MCP server |

This ensures:
- No surprise execution or costs
- User can inspect outputs at each stage
- Predictable, debuggable behavior

---

## 3. Planner: Schema Analyzer

### 3.1 Purpose

The Schema Analyzer runs before documentation begins. It connects to all configured databases, analyzes their structure, detects potential business domains, and creates a documentation plan. This allows users to review scope and priorities before the time-consuming documentation phase.

### 3.2 Inputs

- **Catalog file** (databases.yaml): Connection configurations
- **Database credentials**: Via environment variables
- **Prompt template**: /prompts/domain-inference.md

### 3.3 Processing Steps

Step 1: Load and Validate Configuration
- Read databases.yaml
- Validate connection parameters exist
- Check environment variables are set

Step 2: Connect and Count
- For each database, establish connection
- Query table count per schema
- Note unreachable databases in plan

Step 3: Analyze Relationships
- Query foreign key relationships
- Build adjacency graph of table references
- Identify clusters of related tables

Step 4: Infer Domains
- Load domain-inference.md prompt template
- Format prompt with table list and relationship graph
- Call LLM to group tables into business domains
- Parse JSON response with domain assignments

Step 5: Estimate Complexity
- Simple: Less than 50 tables
- Moderate: 50-200 tables
- Complex: More than 200 tables
- Calculate estimated time based on table count

Step 6: Prioritize Tables
- Priority 1 (Core): Tables with many incoming FKs, central entities
- Priority 2 (Standard): Normal tables with some relationships
- Priority 3 (System): Audit logs, migrations, config tables

Step 7: Write Plan
- Output documentation-plan.json
- Include all analysis results
- Ready for user review

### 3.4 Output: documentation-plan.json

Structure:
- generated_at: ISO timestamp when plan was created
- databases: Array of database analysis objects
  - name: Database identifier from config
  - type: postgres or snowflake
  - status: reachable or unreachable
  - table_count: Total tables discovered
  - schema_count: Number of schemas
  - estimated_time_minutes: Based on table count (approx 3 sec/table)
  - domains: Object mapping domain names to table arrays
  - tables: Ordered array of tables to document
    - fully_qualified_name: database.schema.table
    - domain: Assigned business domain
    - priority: 1, 2, or 3
    - column_count: Number of columns
    - row_count_approx: Estimated rows
    - incoming_fks: Count of tables referencing this one
    - outgoing_fks: Count of tables this references
- summary:
  - total_tables: Sum across all databases
  - total_estimated_minutes: Overall time estimate
  - complexity: simple, moderate, or complex
  - domain_count: Number of unique domains

### 3.5 User Review

After plan generation, the user should:
1. Open documentation-plan.json
2. Review detected domains for accuracy
3. Check table priorities make sense
4. Optionally modify domain assignments
5. Optionally exclude tables by removing them
6. Proceed to documentation with `npm run document`

---

## 4. Agent 1: Database Documenter

### 4.1 Purpose

Executes the documentation plan using sub-agents. For each table in the plan, spawns a TableDocumenter sub-agent that handles metadata extraction, sampling, and markdown generation. The parent Documenter coordinates progress and collects summaries.

### 4.2 Inputs

- **Documentation plan**: documentation-plan.json from Planner
- **Prompt templates**: /prompts/column-description.md, /prompts/table-description.md
- **Database credentials**: Via environment variables

### 4.3 Outputs

```
/docs/
├── catalog-summary.md              # Overview of all databases
├── databases/
│   ├── {db_name}/
│   │   ├── README.md               # Database overview
│   │   ├── tables/
│   │   │   ├── {schema}.{table}.md # Per-table documentation
│   │   │   └── ...
│   │   ├── domains/
│   │   │   ├── {domain_name}.md    # Domain grouping docs
│   │   │   └── {domain_name}.mermaid
│   │   ├── er-diagrams/
│   │   │   ├── full-schema.mermaid # Simplified overview
│   │   │   └── {domain}.mermaid    # Per-domain detailed
│   │   └── schemas/
│   │       ├── {schema}.{table}.json    # JSON Schema
│   │       └── {schema}.{table}.yaml    # Semantic model
```

### 4.4 Processing Steps

Step 1: Load Plan
- Read documentation-plan.json
- Validate plan format
- Check for checkpoint to resume

Step 2: Initialize Progress
- Create or load documenter-progress.json
- Set status to "running"

Step 3: For Each Table in Plan
- Check if already documented (checkpoint)
- If not, spawn TableDocumenter sub-agent
- Receive summary from sub-agent
- Update progress checkpoint

Step 4: Generate Aggregate Outputs
- Create catalog-summary.md from all summaries
- Generate domain overview documents
- Generate Mermaid ER diagrams

Step 5: Complete
- Set status to "completed"
- Log final statistics

### 4.5 Per-Table Documentation Structure

Each `{schema}.{table}.md` file contains:

**Overview Section**:
- Database, schema, table name
- Approximate row count
- Assigned domain
- AI-generated semantic description

**Columns Section**:
- Table with column name, type, nullable, default
- AI-generated description for each column
- Sample values

**Keys & Constraints Section**:
- Primary key columns
- Foreign key relationships with referenced tables
- Index definitions

**Relationships Section**:
- Tables this table references (outgoing FKs)
- Tables that reference this table (incoming FKs)

**Join Paths Section**:
- Pre-generated SQL snippets for common joins

**Semantic Keywords**:
- Extracted terms for search optimization

**Data Patterns**:
- Inferred patterns from sample data

### 4.6 Progress Tracking

Following the checkpoint pattern from Anthropic's long-running agents research:

documenter-progress.json structure:
- started_at: ISO timestamp
- status: running, completed, or failed
- plan_file: Path to plan used
- current_database: Database being processed
- current_table: Table being processed
- databases: Object with per-database progress
  - status: pending, in_progress, completed, failed
  - tables_total: Count from plan
  - tables_completed: Count finished
  - tables_skipped: Count skipped (errors)
  - current_table: If in_progress
- last_checkpoint: ISO timestamp

---

## 5. Sub-agent Specifications

### 5.1 TableDocumenter Sub-agent

**Purpose**: Complete documentation of a single table

**Spawned By**: Agent 1 Documenter

**Lifecycle**: Created per table, destroyed after returning summary

**Inputs**:
- Table metadata from plan (name, domain, priority)
- Database connection (shared)
- Prompt templates (column-description.md, table-description.md)

**Processing Steps**:

Step 1: Extract Metadata
- Query columns from information_schema
- Query primary key constraints
- Query foreign key constraints
- Query index definitions
- Get approximate row count

Step 2: Sample Data
- Execute sampling query (100 rows max)
- Handle timeout gracefully
- Store samples for column inference

Step 3: For Each Column, Spawn ColumnInferencer
- Create ColumnInferencer sub-agent
- Pass column metadata and samples
- Receive description string
- Collect all descriptions

Step 4: Generate Table Description
- Load table-description.md template
- Format with table metadata and column list
- Call LLM for semantic description
- Parse response

Step 5: Assemble Documentation
- Combine all sections into markdown
- Generate JSON Schema file
- Generate YAML semantic model

Step 6: Write Files
- Write markdown to /docs/databases/{db}/tables/
- Write JSON to /docs/databases/{db}/schemas/
- Write YAML to /docs/databases/{db}/schemas/

Step 7: Return Summary
- Return brief summary to parent (table name, description, column count)
- Do NOT return full content (context quarantine)

**Error Handling**:
- Metadata extraction failure: Return error summary, parent skips table
- Sampling timeout: Continue without samples, note in output
- LLM failure: Use fallback description from table name

### 5.2 ColumnInferencer Sub-agent

**Purpose**: Generate semantic description for a single column

**Spawned By**: TableDocumenter sub-agent

**Lifecycle**: Created per column, destroyed after returning description

**Inputs**:
- Column metadata (name, type, nullable, default)
- Sample values for this column
- Existing database comment (if any)
- Prompt template (column-description.md)

**Processing Steps**:

Step 1: Load Prompt Template
- Read /prompts/column-description.md
- Validate template has required variables

Step 2: Format Prompt
- Substitute {{column}} with column name
- Substitute {{data_type}} with SQL type
- Substitute {{sample_values}} with comma-separated samples
- Substitute other variables

Step 3: Call LLM
- Send formatted prompt to Claude
- Request single description string
- Set max tokens to 100

Step 4: Parse Response
- Extract description text
- Validate not empty
- Trim whitespace

Step 5: Return Description
- Return description string to parent TableDocumenter
- Do NOT return raw LLM response (context quarantine)

**Error Handling**:
- Template not found: Fail with clear error
- LLM timeout: Retry once, then use fallback
- Empty response: Use fallback "Column stores {type} data"

### 5.3 Context Quarantine

Sub-agents practice context quarantine:
- They receive only what they need
- They return only summaries/strings
- Raw data never bubbles up to parent
- This prevents context window overflow

Example flow:
1. Documenter knows table has 50 columns
2. Documenter spawns TableDocumenter with table name only
3. TableDocumenter fetches column metadata (50 rows)
4. TableDocumenter spawns 50 ColumnInferencers
5. Each ColumnInferencer returns one description string
6. TableDocumenter assembles markdown, writes file
7. TableDocumenter returns summary: "customers: Customer records with 50 columns"
8. Documenter only holds summaries, never full content

---

## 6. Prompt Templates

### 6.1 Overview

Prompt templates are stored in /prompts as Markdown files. They provide:
- Consistent LLM behavior across all invocations
- Easy customization without code changes
- Organization-specific terminology
- Guardrails against hallucination

### 6.2 Template: column-description.md

**File**: /prompts/column-description.md

**Purpose**: Generate semantic description for a database column

**Variables** (substituted at runtime):
- {{database}}: Source database name
- {{schema}}: Schema name
- {{table}}: Table name
- {{column}}: Column name
- {{data_type}}: SQL data type (e.g., varchar(255), bigint)
- {{nullable}}: YES or NO
- {{default}}: Default value or "None"
- {{existing_comment}}: Comment from database or "None"
- {{sample_values}}: Up to 10 sample values, comma-separated

**Template Content**:

```
You are a database documentation specialist. Generate a concise semantic description for this database column.

## Column Information
- Database: {{database}}
- Table: {{schema}}.{{table}}
- Column: {{column}}
- Data Type: {{data_type}}
- Nullable: {{nullable}}
- Default: {{default}}
- Database Comment: {{existing_comment}}

## Sample Values
{{sample_values}}

## Instructions
1. Describe what this column represents in business terms
2. Focus on meaning, not technical details
3. Ground your description in the sample values shown
4. Never speculate beyond what the data shows
5. If purpose is unclear, say "Purpose unclear from available data"
6. Do not repeat the column name or type in your description
7. Maximum 2 sentences

## Output
Provide only the description, no other text.
```

**Expected Output**: A single description string

**Example**: "Customer's primary email address used for account login and marketing communications."

### 6.3 Template: table-description.md

**File**: /prompts/table-description.md

**Purpose**: Generate semantic description for a database table

**Variables**:
- {{database}}: Source database name
- {{schema}}: Schema name
- {{table}}: Table name
- {{row_count}}: Approximate row count
- {{column_list}}: Comma-separated column names
- {{column_count}}: Number of columns
- {{primary_key}}: Primary key column(s)
- {{foreign_keys}}: List of FK relationships (table.column references)
- {{referenced_by}}: Tables that reference this one
- {{existing_comment}}: Comment from database or "None"
- {{sample_row}}: One sample row as key-value pairs

**Template Content**:

```
You are a database documentation specialist. Generate a semantic description for this database table.

## Table Information
- Database: {{database}}
- Table: {{schema}}.{{table}}
- Row Count: {{row_count}}
- Column Count: {{column_count}}
- Primary Key: {{primary_key}}
- Database Comment: {{existing_comment}}

## Columns
{{column_list}}

## Relationships
Foreign Keys (this table references): {{foreign_keys}}
Referenced By (other tables reference this): {{referenced_by}}

## Sample Row
{{sample_row}}

## Instructions
1. Describe the business entity this table represents
2. Mention key relationships to other tables
3. Infer the table's role in the data model
4. Ground description in column names and sample data
5. Never speculate beyond available evidence
6. Maximum 3 sentences

## Output
Provide only the description, no other text.
```

**Expected Output**: A description string

**Example**: "Stores customer order transactions. Links customers to their purchases via customer_id. Contains order status, totals, and timestamps for order lifecycle tracking."

### 6.4 Template: domain-inference.md

**File**: /prompts/domain-inference.md

**Purpose**: Group tables into logical business domains

**Variables**:
- {{database}}: Source database name
- {{table_count}}: Total number of tables
- {{table_list}}: JSON array of table objects (name, column_count, foreign_keys)
- {{relationship_summary}}: Summary of FK relationships between tables

**Template Content**:

```
You are a database architect. Analyze these tables and group them into logical business domains.

## Database
{{database}} ({{table_count}} tables)

## Tables
{{table_list}}

## Relationships
{{relationship_summary}}

## Instructions
1. Identify 3-10 business domains based on table naming and relationships
2. Tables that reference each other frequently belong together
3. Common domains: customers, orders, products, inventory, analytics, users, payments, system
4. Every table must be assigned to exactly one domain
5. If a table doesn't fit, assign to "system" domain
6. Use lowercase domain names

## Output Format
Return a JSON object mapping domain names to table arrays:
{
  "domain_name": ["table1", "table2"],
  "other_domain": ["table3"]
}

Provide only the JSON, no other text.
```

**Expected Output**: JSON object with domain assignments

### 6.5 Template: query-understanding.md

**File**: /prompts/query-understanding.md

**Purpose**: Interpret natural language search queries

**Variables**:
- {{query}}: User's natural language search query
- {{available_domains}}: List of known domains in the system
- {{sample_tables}}: Few example table names for context

**Template Content**:

```
You are a search query analyst. Interpret this natural language query about a database.

## Query
"{{query}}"

## Available Domains
{{available_domains}}

## Sample Tables
{{sample_tables}}

## Instructions
1. Identify the core concepts being searched
2. Expand abbreviations and synonyms
3. Detect if query implies a specific domain
4. Identify if query is asking about relationships/joins
5. Extract key search terms

## Output Format
Return a JSON object:
{
  "original_query": "the input query",
  "concepts": ["concept1", "concept2"],
  "expanded_terms": ["term1", "synonym1", "term2"],
  "domain_hint": "domain_name or null",
  "is_relationship_query": true/false,
  "search_terms": ["final", "search", "terms"]
}

Provide only the JSON, no other text.
```

**Expected Output**: JSON object with query analysis

### 6.6 Template Loading and Validation

**Startup Validation**:
- Check all required templates exist in /prompts
- Parse each template to verify structure
- Validate variable syntax ({{variable}})
- Report missing or invalid templates with clear errors

**Runtime Loading**:
- Read template from disk (allows hot-reload)
- Cache parsed template in memory
- Substitute variables with actual values
- Return formatted prompt string

**Error Handling**:
- Missing template: Fail startup with file path
- Invalid syntax: Log warning, use template as-is
- Missing variable: Log warning, leave placeholder

---

## 7. Agent 2: Document Indexer

### 7.1 Purpose

Reads generated documentation, extracts semantic keywords, generates embeddings, and populates the hybrid search index (FTS5 + vector).

### 7.2 Inputs

- **Documentation directory**: /docs/ from Agent 1
- **Embedding model**: OpenAI text-embedding-3-small

### 7.3 Outputs

- **SQLite database**: tribal-knowledge.db
  - documents table with content
  - documents_fts for full-text search
  - documents_vec for vector similarity
  - relationships table for join paths
  - keywords table for term cache

### 7.4 Processing Steps

Step 1: Scan Documentation
- Find all .md files in /docs
- Build list of files to index
- Check for existing index (incremental update)

Step 2: For Each Document
- Parse markdown content
- Extract metadata (database, schema, table, domain)
- Extract keywords from column names
- Detect data patterns from samples
- Generate summary for retrieval

Step 3: Generate Embeddings
- Batch documents (50 per request)
- Call OpenAI embeddings API
- Handle rate limits with backoff

Step 4: Populate Index
- Insert document into documents table
- Update FTS5 index
- Insert vector into documents_vec
- Index relationships

Step 5: Update Progress
- Write indexer-progress.json checkpoint
- Continue with next batch

### 7.5 Keyword Extraction

Extract keywords from:
- Column names (split on underscore, expand abbreviations)
- Sample data patterns (email, URL, currency)
- Inferred semantics from LLM descriptions

Common abbreviation mappings:
- cust → customer
- usr → user
- acct → account
- txn → transaction
- amt → amount
- qty → quantity
- dt → date
- ts → timestamp

### 7.6 Hybrid Search Index

The indexer creates a hybrid search capability:

**FTS5 Index**: Keyword-based search with BM25 ranking
- Indexes: content, summary, keywords
- Tokenizer: porter (stemming)
- Allows phrase and boolean queries

**Vector Index**: Semantic similarity search
- Dimensions: 1536 (OpenAI embedding size)
- Distance: Cosine similarity
- Enables "find similar" queries

---

## 8. Agent 3: Index Retrieval / MCP

### 8.1 Purpose

Exposes the indexed documentation via MCP tools that get installed into Noah's Company MCP. External agents query these tools to get relevant database context for their SQL generation tasks.

### 8.2 MCP Tools

**search_tables**: Find tables relevant to a natural language query
- Input: query, optional database/domain filter, limit
- Process: Hybrid search with RRF ranking
- Output: Array of table summaries with relevance scores

**get_table_schema**: Get full schema details for a specific table
- Input: Fully qualified table name
- Process: Direct lookup in documents
- Output: Complete table documentation

**get_join_path**: Find how to join two tables
- Input: Source and target table names
- Process: BFS on relationship graph
- Output: Join steps with SQL snippet

**get_domain_overview**: Get summary of tables in a domain
- Input: Domain name
- Process: Query documents by domain
- Output: Domain description, table list, ER diagram

**list_domains**: Enumerate available domains
- Input: Optional database filter
- Process: Query distinct domains
- Output: Domain list with table counts

**get_common_relationships**: Get frequent join patterns
- Input: Optional filters
- Process: Query relationships table
- Output: Common join patterns with SQL

### 8.3 Hybrid Search Algorithm

Step 1: Query Preprocessing
- Optionally use query-understanding prompt
- Tokenize and stem query terms
- Identify domain hints

Step 2: Execute Searches
- FTS5 search with BM25 ranking
- Vector search with cosine similarity

Step 3: Reciprocal Rank Fusion
- RRF score = Σ (1 / (k + rank))
- k = 60 (standard constant)
- Combine FTS and vector scores

Step 4: Apply Weights
- table documents: 1.5x boost
- relationship documents: 1.2x boost
- column documents: 1.0x (no boost)

Step 5: Return Results
- Sort by final score
- Apply limit
- Compress to context budget

### 8.4 Context Budget Management

**Budget Tiers**:
- Simple (single concept): 750 tokens
- Moderate (multi-table): 1500 tokens
- Complex (cross-domain): 3000 tokens

**Compression Strategy**:
1. Start with full content
2. If over budget: truncate column lists
3. If still over: remove samples
4. If still over: truncate descriptions
5. Always keep: table names, key relationships

---

## 9. Data Models

### 9.1 SQLite Schema

**Table: documents**
- id: INTEGER PRIMARY KEY
- doc_type: TEXT (table, column, relationship, domain)
- database_name, schema_name, table_name, column_name: TEXT
- domain: TEXT
- content: TEXT (full markdown)
- summary: TEXT (compressed for retrieval)
- keywords: TEXT (JSON array)
- file_path: TEXT
- content_hash: TEXT (for change detection)
- created_at, updated_at: DATETIME

**Virtual Table: documents_fts** (FTS5)
- content, summary, keywords indexed
- porter tokenizer for stemming

**Virtual Table: documents_vec** (sqlite-vec)
- id: INTEGER
- embedding: FLOAT[1536]

**Table: relationships**
- source/target database, schema, table, column: TEXT
- relationship_type: TEXT (foreign_key, implied, semantic)
- join_sql: TEXT (pre-generated snippet)

**Table: index_weights**
- doc_type: TEXT PRIMARY KEY
- fts_weight, vec_weight, boost: REAL

### 9.2 Progress Files

**documentation-plan.json**: Output of Planner
**documenter-progress.json**: Checkpoint for Agent 1
**indexer-progress.json**: Checkpoint for Agent 2

---

## 10. Configuration

### 10.1 databases.yaml

Database catalog configuration:
- databases: Array of database configs
  - name, type (postgres/snowflake)
  - connection_env: Environment variable name
  - schemas: Array to include
  - exclude_tables: Patterns to skip

### 10.2 agent-config.yaml

Agent behavior configuration:
- planner:
  - enabled: boolean
  - domain_inference: boolean
- documenter:
  - concurrency, sample_timeout_ms
  - llm_model, checkpoint_interval
  - use_sub_agents: boolean
- indexer:
  - batch_size, embedding_model
  - checkpoint_interval
- retrieval:
  - default_limit, max_limit
  - context_budgets by tier
  - rrf_k, search_weights

### 10.3 Environment Variables

Required:
- OPENAI_API_KEY: For embeddings
- ANTHROPIC_API_KEY: For semantic inference
- Database connection credentials

Optional:
- TRIBAL_DOCS_PATH: Documentation output (default: ./docs)
- TRIBAL_DB_PATH: SQLite path (default: ./data/tribal-knowledge.db)
- TRIBAL_PROMPTS_PATH: Prompt templates (default: ./prompts)
- TRIBAL_LOG_LEVEL: Logging verbosity (default: info)

---

## 11. Technical Stack

### 11.1 Core Technologies

| Component | Technology | Purpose |
|-----------|------------|---------|
| Runtime | Node.js 20 LTS | JavaScript execution |
| Language | TypeScript 5.x | Type safety |
| Database | SQLite 3.x | Local storage |
| Search | FTS5 + sqlite-vec | Hybrid search |
| Embeddings | OpenAI API | text-embedding-3-small |
| LLM | Claude Sonnet 4 | Semantic inference |
| MCP | @modelcontextprotocol/sdk | Tool server |

### 11.2 Database Connectors

| Database | Library | Notes |
|----------|---------|-------|
| PostgreSQL | pg | Supabase compatible |
| Snowflake | snowflake-sdk | Official SDK |

---

## 12. Implementation Phases

### Phase 1: Foundation (Week 1-2)
- Project setup
- PostgreSQL connector
- Basic metadata extraction
- Simple markdown generation
- FTS5 index
- Basic search_tables tool
- Initial prompt templates (column, table)

### Phase 2: Semantic Layer (Week 3-4)
- OpenAI embeddings
- Hybrid search with RRF
- LLM semantic inference
- Schema Analyzer (Planner)
- Domain detection
- All MCP tools

### Phase 3: Sub-agents & Scale (Week 5-6)
- Snowflake connector
- TableDocumenter sub-agent
- ColumnInferencer sub-agent
- Cross-database docs
- ER diagrams
- Progress tracking

### Phase 4: MCP Integration (Week 7-8)
- Install in Noah's MCP
- Context budgeting
- Response compression
- Query understanding prompt
- Error handling
- Performance tuning

---

## 13. Success Criteria

| Metric | Target |
|--------|--------|
| Planning coverage | 100% of databases analyzed |
| Documentation coverage | 100% of tables |
| Search relevance (top-3) | >85% |
| Join path accuracy | >95% |
| Semantic description quality | >90% sensible |
| Search latency (p95) | <500ms |
| Documentation time (100 tables) | <5 minutes |
| Context budget compliance | 100% |

---

## 14. Open Questions & Future Work

### 14.1 Open Questions

1. Domain inference accuracy on messy schemas?
   - Mitigation: Allow manual overrides in plan

2. Embedding model choice sufficient?
   - Test alternatives, measure retrieval quality

3. Large schema handling (1000+ tables)?
   - Consider domain-scoped indices

4. Cross-database joins (Postgres ↔ Snowflake)?
   - Future: semantic similarity matching

### 14.2 Future Enhancements

- Schema drift detection
- Usage analytics
- Feedback loop for corrections
- Code documentation (dbt, SQL files)
- Views and materialized views
- Multi-tenant support

---

## Appendix A: Research Sources

1. Anthropic: Context Engineering for AI Agents
2. Anthropic: Effective Harnesses for Long-Running Agents
3. Phil Schmid: Agents 2.0 Deep Agents
4. LangChain: deepagents-quickstarts
5. mariozechner: What if you don't need MCP
6. Sean Goedecke: Good System Design
7. Tavily: Deep Research
8. PAM-CRS (Myles's prior work)

---

## Appendix B: Example Prompt Substitution

**Template** (column-description.md):
```
Column: {{column}}
Type: {{data_type}}
Samples: {{sample_values}}
```

**Variables**:
- column = "customer_email"
- data_type = "varchar(255)"
- sample_values = "john@example.com, jane@test.org"

**Result**:
```
Column: customer_email
Type: varchar(255)
Samples: john@example.com, jane@test.org
```

---

*End of PRD*

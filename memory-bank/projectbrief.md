# Project Brief: Tribal Knowledge Deep Agent

## Project Overview

The Tribal Knowledge Deep Agent is a deep agent system that automatically documents database schemas, indexes documentation for efficient retrieval, and exposes it via MCP (Model Context Protocol) for AI agent consumption. The system solves the "tribal knowledge" problem where critical data understanding exists only in the minds of experienced team members.

## Core Mission

Enable data scientists, data engineers, and AI agents to quickly discover and understand database schemas through natural language search, eliminating the friction of manual documentation and schema exploration.

## Key Goals

1. **Automatic Documentation**: Generate comprehensive, semantic documentation for database schemas without manual effort
2. **Intelligent Search**: Provide natural language search capabilities that understand business context
3. **AI Agent Integration**: Expose documentation via MCP for seamless integration with AI agents
4. **Deep Agent Architecture**: Implement planning, sub-agents, filesystem memory, and configurable prompts

## Target Users

- **Data Scientists**: Need to find relevant tables and understand how to query them
- **Data Engineers**: Need to maintain accurate, up-to-date documentation automatically
- **AI Agents**: Need minimal, high-signal context for SQL generation
- **New Team Members**: Need to quickly understand data landscape during onboarding

## Success Metrics

- Data scientists can find relevant tables in < 30 seconds
- Top-3 search results contain relevant tables >85% of the time
- Full documentation generated in single command
- Search query latency (p95) < 500ms
- Documentation maintenance effort reduced by 90%

## Project Scope

### In Scope (MVP)
- PostgreSQL and Snowflake database support
- Automatic schema documentation with LLM inference
- Hybrid search (FTS5 + vector embeddings)
- MCP tool integration
- Planning phase before documentation
- Sub-agent architecture for table/column documentation
- Configurable prompt templates

### Out of Scope (MVP)
- Real-time schema change detection
- Multi-user concurrent access
- Cloud-hosted deployment
- PII/sensitive data detection
- Custom domain configuration (auto-detect only)
- Views and materialized views (tables only)
- Stored procedures and functions
- Autonomous re-documentation

## Architecture Style

**Deep Agent Pipeline with Planning**

- **Communication Pattern**: Filesystem-based (agents read/write files and database)
- **Execution Model**: Plan → Execute → Index → Serve (manual triggers, no autonomous behavior)
- **Four Pillars**:
  1. Planning Tool: Schema Analyzer creates documentation plan before execution
  2. Sub-agents: TableDocumenter and ColumnInferencer handle repeated tasks
  3. File System: Filesystem + SQLite for persistent external memory
  4. System Prompts: Configurable prompt templates for consistent LLM behavior

## Key Design Principles

1. **User-triggered**: All phases are manually triggered (no autonomous execution)
2. **Planner handles table iteration**: Schema Analyzer extracts all metadata upfront
3. **MCP in separate repo**: MCP tools implemented in another repository
4. **Hybrid search**: FTS5 (keyword) + vector embeddings (semantic) with Reciprocal Rank Fusion
5. **Context quarantine**: Sub-agents return only summaries, not raw data
6. **Checkpoint recovery**: Progress tracking enables resumption after interruption

## Project Status

**Current Phase**: Implementation in progress
- Planner: ✅ Implemented (basic domain detection, needs LLM integration)
- Documenter Phase 1: ✅ COMPLETE (core infrastructure, December 10, 2025)
- Documenter Phase 2: ✅ COMPLETE (LLM integration, December 10, 2025)
- Documenter Phase 3: ✅ COMPLETE (sub-agents, December 11, 2025)
- Documenter Phase 4: ✅ COMPLETE (output generation, December 11, 2025)
- Documenter Phase 5: ✅ COMPLETE (manifest generation, January 27, 2025)
- Indexer: ⚠️ Partially implemented (database schema ready, needs embedding generation)
- Retrieval: ⚠️ Structure exists, needs MCP integration
- Orchestrator: 📋 Planned (not yet implemented)

## Dependencies

- **External**: OpenAI API (embeddings), Anthropic API (semantic inference), Noah's Company MCP
- **Internal**: PAM-CRS learnings, Supabase test database, Snowflake test database

## Timeline

- **MVP Target**: Core functionality working end-to-end
- **Current Focus**: Documenter MVP complete (all 5 phases). Next: Indexer implementation and end-to-end testing.

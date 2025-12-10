# Tribal Knowledge Deep Agent

A deep agent system that automatically documents database schemas, indexes documentation for efficient retrieval, and exposes it via MCP for AI agent consumption.

## Overview

The Tribal Knowledge Deep Agent implements the four pillars of deep agent architecture:

1. **Planning Tool**: Schema Analyzer creates documentation plan before execution
2. **Sub-agents**: TableDocumenter and ColumnInferencer handle repeated tasks
3. **File System**: Filesystem + SQLite for persistent external memory
4. **System Prompts**: Configurable prompt templates for consistent LLM behavior

## Architecture

```
Planner (Schema Analyzer) → Documenter → Indexer → Retrieval (via MCP)
```

- **Planner**: Analyzes database structure, extracts all metadata, detects domains, creates plan
- **Documenter**: Spawns sub-agents based on plan to generate documentation
- **Indexer**: Builds hybrid search index (FTS5 + vector embeddings)
- **Retrieval**: Exposes search via MCP tools (installed in separate MCP repo)

## Quick Start

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure databases**:
   - Copy `config/databases.yaml.example` to `config/databases.yaml`
   - Add your database connections
   - Set environment variables for credentials

3. **Set environment variables**:
   ```bash
   export OPENAI_API_KEY="your-key"
   export ANTHROPIC_API_KEY="your-key"
   export POSTGRES_CONNECTION_STRING="postgresql://..."
   ```

4. **Run the pipeline**:
   ```bash
   npm run plan      # Analyze schemas, create plan
   npm run document  # Generate documentation
   npm run index     # Build search index
   ```

## Project Structure

```
tribal-knowledge/
├── src/
│   ├── planner/              # Schema Analyzer
│   ├── agents/
│   │   ├── documenter/       # Agent 1: Documentation generator
│   │   │   └── sub-agents/   # TableDocumenter, ColumnInferencer
│   │   ├── indexer/          # Agent 2: Search index builder
│   │   └── retrieval/        # Agent 3: MCP tool implementations
│   ├── connectors/           # Database connectors (PostgreSQL, Snowflake)
│   ├── search/               # Hybrid search implementation
│   ├── utils/                # Shared utilities
│   └── index.ts              # Main entry point
├── config/
│   ├── databases.yaml        # Database catalog configuration
│   └── agent-config.yaml     # Agent behavior configuration
├── prompts/                  # Prompt templates
│   ├── column-description.md
│   ├── table-description.md
│   ├── domain-inference.md
│   └── query-understanding.md
├── docs/                     # Generated documentation (output)
├── data/                     # SQLite database (output)
└── progress/                 # Checkpoint files (output)
```

## Key Design Decisions

- **Planner handles table iteration**: The Schema Analyzer extracts all metadata for all tables upfront. The Documenter spawns sub-agents based on the plan, not by iterating tables itself.
- **MCP in separate repo**: MCP tools are implemented in another repository. This repo provides the retrieval logic that MCP calls.
- **Manual triggers**: All phases are user-triggered (no autonomous execution)
- **Hybrid search**: FTS5 (keyword) + vector embeddings (semantic) with Reciprocal Rank Fusion

## Development

```bash
# Build TypeScript
npm run build

# Run in development mode
npm run dev

# Validate prompt templates
npm run validate-prompts

# Check status
npm run status
```

## Configuration

See `config/databases.yaml.example` and `config/agent-config.yaml.example` for configuration templates.

## License

MIT


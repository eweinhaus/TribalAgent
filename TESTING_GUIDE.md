# Testing Guide: Planner → Documenter → Indexer Pipeline

This guide covers how to test the complete pipeline end-to-end, from planning through indexing.

## Prerequisites

### 1. Environment Setup

```bash
cd TribalAgent
npm install
```

### 2. Database Setup

You need a PostgreSQL database to test against. Options:

#### Option A: Use DABstep Test Database (Recommended)

```bash
# From project root
cd ../DABstep-postgres
docker-compose up -d
./setup_database.sh

# Get connection string
# Host: localhost
# Port: 5432
# Database: dabstep
# User: postgres
# Password: postgres
```

#### Option B: Use Your Own Database

Any PostgreSQL database with tables will work.

### 3. Environment Variables

**Option A: Use .env file (Recommended)**

The project uses a `.env` file for configuration. Create or update `.env` in the `TribalAgent/` directory:

```bash
# Required: Database connection
POSTGRES_CONNECTION_STRING=postgresql://postgres:postgres@localhost:5432/dabstep

# Required: LLM APIs
OPENROUTER_API_KEY=your-openrouter-key          # For Claude Sonnet 4.5 (Planner, Documenter)
OPENAI_API_KEY=your-openai-key                  # For embeddings (Indexer)

# Optional: Custom paths
TRIBAL_DOCS_PATH=./docs                         # Default: ./docs
TRIBAL_DB_PATH=./data/tribal-knowledge.db       # Default: ./data/tribal-knowledge.db
```

**Note:** The `.env` file should already exist. Verify it contains:
- `OPENROUTER_API_KEY` - Used for Planner (domain inference) and Documenter (semantic descriptions) with **Claude Sonnet 4.5**
- `OPENAI_API_KEY` - Used for Indexer (embeddings)
- `POSTGRES_CONNECTION_STRING` - Database connection

**Loading .env for CLI commands:**
- Tests automatically load `.env` via `vitest.config.ts`
- CLI commands (`npm run plan`, `npm run document`, `npm run index`) read from your shell environment
- To use `.env` with CLI commands, either:
  - Export variables: `export $(cat .env | xargs)` before running commands
  - Use `dotenv-cli`: `npx dotenv-cli npm run plan`
  - Or ensure your shell loads `.env` automatically

**Option B: Export environment variables**

If not using .env file, export variables:

```bash
export POSTGRES_CONNECTION_STRING="postgresql://postgres:postgres@localhost:5432/dabstep"
export OPENROUTER_API_KEY="your-openrouter-key"
export OPENAI_API_KEY="your-openai-key"
```

### 4. Configuration File

Create `config/databases.yaml`:

```bash
cp config/databases.yaml.example config/databases.yaml
```

Edit `config/databases.yaml`:

```yaml
databases:
  - name: test_dabstep
    type: postgres
    connection_env: POSTGRES_CONNECTION_STRING
    schemas:
      - public
    exclude_tables: []
```

## Manual Testing: Step-by-Step

**Important:** Ensure your `.env` file is configured with:
- `OPENROUTER_API_KEY` (for Planner and Documenter - Claude Sonnet 4.5)
- `OPENAI_API_KEY` (for Indexer embeddings)
- `POSTGRES_CONNECTION_STRING` (database connection)

**Note:** CLI commands (`npm run plan`, `npm run document`, `npm run index`) will read environment variables from your shell. If using `.env` file, use one of these methods:

**Method 1: Use dotenv-cli (Easiest)**
```bash
npx dotenv-cli npm run plan
```

**Method 2: Export variables separately**
```bash
# Export variables (filters out comments)
export $(cat .env | grep -v '^#' | xargs)
# Then run command
npm run plan
```

**Method 3: Source .env file**
```bash
set -a  # automatically export all variables
source .env
set +a
npm run plan
```

### Step 1: Run Planner

```bash
cd TribalAgent

# Option A: Use dotenv-cli (recommended - handles .env automatically)
npx dotenv-cli npm run plan

# Option B: Export variables first, then run
export $(cat .env | grep -v '^#' | xargs)
npm run plan

# Option C: If .env is already loaded in your shell
npm run plan
```

**What to verify:**
- ✅ Plan file created: `progress/documentation-plan.json`
- ✅ Plan contains work units with tables
- ✅ Plan includes domain assignments
- ✅ Check output for any errors

**Check plan:**
```bash
cat progress/documentation-plan.json | jq '.summary'
```

### Step 2: Run Documenter

```bash
# Option A: Use dotenv-cli (recommended)
npx dotenv-cli npm run document

# Option B: Export variables first, then run
export $(cat .env | grep -v '^#' | xargs)
npm run document
```

**What to verify:**
- ✅ Documentation files created in `docs/databases/{db}/`
- ✅ Markdown files: `docs/databases/{db}/domains/{domain}/tables/{schema}.{table}.md`
- ✅ JSON files: `docs/databases/{db}/domains/{domain}/tables/{schema}.{table}.json`
- ✅ Manifest created: `docs/documentation-manifest.json`
- ✅ Progress file: `progress/documenter-progress.json`

**Check documentation:**
```bash
# List generated files
find docs -name "*.md" | head -5
find docs -name "*.json" | head -5

# View a sample markdown file
cat docs/databases/*/domains/*/tables/*.md | head -50

# Check manifest
cat docs/documentation-manifest.json | jq '.status, .total_files'
```

### Step 3: Run Indexer

```bash
# Option A: Use dotenv-cli (recommended)
npx dotenv-cli npm run index

# Option B: Export variables first, then run
export $(cat .env | grep -v '^#' | xargs)
npm run index
```

**What to verify:**
- ✅ SQLite database created: `data/tribal-knowledge.db`
- ✅ Indexer progress: `progress/indexer-progress.json`
- ✅ Documents indexed (check progress file)
- ✅ Embeddings generated (if OpenAI key is set)

**Check index:**
```bash
# Check database exists
ls -lh data/tribal-knowledge.db

# Query database (requires sqlite3)
sqlite3 data/tribal-knowledge.db "SELECT COUNT(*) FROM documents;"
sqlite3 data/tribal-knowledge.db "SELECT doc_type, COUNT(*) FROM documents GROUP BY doc_type;"
```

### Step 4: Verify End-to-End

```bash
# Check status of all phases
npm run status
```

**Expected output:**
- Plan: ✅ Found
- Documentation: ✅ Complete
- Index: ✅ Complete

## Automated Testing: Using Test Suite

### Run Complete Pipeline Test

The test suite includes E2E tests that verify the full pipeline:

```bash
# Set test database URL (or use .env file)
export TEST_DATABASE_URL="postgresql://postgres:postgres@localhost:5432/dabstep"

# Ensure API keys are set (or in .env)
export OPENROUTER_API_KEY="your-key"  # For LLM tests
export OPENAI_API_KEY="your-key"      # For embedding tests

# Run E2E tests (includes Planner → Documenter → Indexer)
npm run test -- tests/documenter/e2e/complete-pipeline.test.ts
```

**Note:** Tests will automatically skip if `OPENROUTER_API_KEY` is not set (for LLM-dependent tests).

### Run All Tests

```bash
# Unit tests
npm run test

# Integration tests (requires Docker)
npm run test:integration
```

## Quick Pipeline Command

For convenience, there's a single command to run all three phases:

```bash
npm run pipeline
```

This runs:
1. `npm run plan`
2. `npm run document`
3. `npm run index`

**Note:** This will fail if any step fails. For debugging, run each step individually.

## Troubleshooting

### Planner Fails

**Issue:** Cannot connect to database
- ✅ Check `POSTGRES_CONNECTION_STRING` is set correctly
- ✅ Verify database is running and accessible
- ✅ Check `config/databases.yaml` has correct connection_env name

**Issue:** No tables found
- ✅ Check schema names in `databases.yaml` match your database
- ✅ Verify tables exist in those schemas
- ✅ Check exclude_tables patterns aren't too broad

### Documenter Fails

**Issue:** Plan not found
- ✅ Run planner first: `npm run plan`
- ✅ Check `progress/documentation-plan.json` exists

**Issue:** LLM API errors
- ✅ Verify `OPENROUTER_API_KEY` is set (for Planner/Documenter)
- ✅ Verify `OPENAI_API_KEY` is set (for Indexer embeddings)
- ✅ Check API keys are valid
- ✅ Check API rate limits
- ✅ Verify .env file is loaded (if using .env)

**Issue:** Files not generated
- ✅ Check `TRIBAL_DOCS_PATH` is writable
- ✅ Verify database connection still works
- ✅ Check documenter progress file for errors

### Indexer Fails

**Issue:** Manifest not found
- ✅ Run documenter first: `npm run document`
- ✅ Check `docs/documentation-manifest.json` exists

**Issue:** Embedding generation fails
- ✅ Verify `OPENAI_API_KEY` is set
- ✅ Check API key is valid
- ✅ Indexer will continue with FTS-only mode if embeddings fail

**Issue:** Database errors
- ✅ Check `TRIBAL_DB_PATH` directory exists and is writable
- ✅ Verify SQLite can be created
- ✅ Check disk space

## Verification Checklist

After running the complete pipeline, verify:

- [ ] Plan file exists and contains work units
- [ ] Documentation files generated (Markdown + JSON)
- [ ] Manifest file created with correct file listing
- [ ] SQLite database created
- [ ] Documents table populated
- [ ] FTS5 index working (can search)
- [ ] Vector embeddings generated (if OpenAI key set)
- [ ] Progress files show "completed" status

## Testing with Different Scenarios

### Small Database (1-10 tables)
- Quick test, good for development
- Should complete in < 1 minute

### Medium Database (10-50 tables)
- Realistic test scenario
- Should complete in 2-5 minutes

### Large Database (50+ tables)
- Stress test
- May take 10+ minutes
- Good for performance testing

## Next Steps

Once the pipeline works:
1. Test checkpoint recovery (interrupt documenter, resume)
2. Test incremental indexing (re-run indexer)
3. Test with multiple databases
4. Test error handling (invalid API keys, DB disconnection)

## Performance Benchmarks

Expected performance (approximate):
- **Planner**: ~1-2 seconds per 10 tables
- **Documenter**: ~5-10 seconds per table (with LLM calls)
- **Indexer**: ~1-2 seconds per document (with embeddings)

For 100 tables:
- Planning: ~10-20 seconds
- Documentation: ~8-15 minutes
- Indexing: ~2-3 minutes
- **Total**: ~10-20 minutes

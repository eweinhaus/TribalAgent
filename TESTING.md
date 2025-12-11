# Testing Guide: Documenter Agent

This guide explains how to test the Documenter Agent at different levels: unit tests, integration tests, and end-to-end testing.

## Quick Start

### Run All Tests
```bash
npm test
```

### Run Tests in Watch Mode
```bash
npm run test:watch
```

### Run Integration Tests Only
```bash
npm run test:integration
```

---

## Test Types

### 1. Unit Tests (No External Dependencies)

Unit tests don't require databases or API keys. They test isolated functionality.

**What's Tested:**
- Status computation algorithms
- Error handling and error codes
- Template variable mapping
- Fallback descriptions
- File writing utilities
- Markdown/JSON generators

**Run Unit Tests:**
```bash
npm test
```

**Test Files:**
- `src/agents/documenter/__tests__/status.test.ts` - Status computation
- `src/agents/documenter/__tests__/errors.test.ts` - Error handling
- `src/agents/documenter/__tests__/fallback-descriptions.test.ts` - Fallback logic
- `src/agents/documenter/__tests__/template-variable-verification.test.ts` - Template variables
- `src/agents/documenter/generators/__tests__/MarkdownGenerator.test.ts` - Markdown generation
- `src/agents/documenter/generators/__tests__/JSONGenerator.test.ts` - JSON generation
- `src/utils/__tests__/file-writer.test.ts` - File writing utilities

---

### 2. Integration Tests (Requires Database & API Keys)

Integration tests verify the documenter works with real databases and LLM APIs.

#### Prerequisites

1. **PostgreSQL Test Database**
   - Set `TEST_DATABASE_URL` environment variable
   - Format: `postgresql://user:password@host:port/database`
   - Example: `postgresql://postgres:password@localhost:5432/test_db`

2. **OpenRouter API Key** (for LLM tests)
   - Set `OPENROUTER_API_KEY` environment variable
   - Get key from: https://openrouter.ai/

#### Setup Test Database

```bash
# Create test database
createdb test_db

# Or use Docker
docker run -d \
  --name test-postgres \
  -e POSTGRES_PASSWORD=password \
  -e POSTGRES_DB=test_db \
  -p 5432:5432 \
  postgres:15

# Set environment variable
export TEST_DATABASE_URL="postgresql://postgres:password@localhost:5432/test_db"
export OPENROUTER_API_KEY="your-openrouter-api-key"
```

#### Run Integration Tests

```bash
# Run all integration tests
npm run test:integration

# Or run specific integration test file
npm test -- src/agents/documenter/sub-agents/__tests__/integration.test.ts
```

**Test Files:**
- `src/agents/documenter/sub-agents/__tests__/integration.test.ts` - Sub-agent integration
- `src/utils/__tests__/llm.integration.test.ts` - LLM API integration

**What's Tested:**
- End-to-end table documentation with real database
- Column inference with real LLM API
- Error recovery (sampling timeout, LLM failures)
- Context quarantine enforcement
- File generation and validation

**Note:** Integration tests automatically skip if `TEST_DATABASE_URL` or `OPENROUTER_API_KEY` are not set.

---

### 3. End-to-End Testing (Full Pipeline)

Test the complete documentation pipeline from planning to manifest generation.

#### Prerequisites

1. **Configuration Files**
   ```bash
   # Copy example configs
   cp config/databases.yaml.example config/databases.yaml
   cp config/agent-config.yaml.example config/agent-config.yaml
   ```

2. **Configure Database Connection**
   Edit `config/databases.yaml`:
   ```yaml
   databases:
     - name: test_database
       type: postgres
       connection_env: TEST_DATABASE_URL
       schemas:
         - public
   ```

3. **Environment Variables**
   ```bash
   export TEST_DATABASE_URL="postgresql://user:password@host:port/database"
   export OPENROUTER_API_KEY="your-openrouter-api-key"
   ```

#### Run End-to-End Test

```bash
# Step 1: Generate documentation plan
npm run plan

# Step 2: Review the plan (optional)
cat progress/documentation-plan.json

# Step 3: Run documenter
npm run document

# Step 4: Check progress
npm run status

# Step 5: Verify output files
ls -la docs/databases/*/domains/*/tables/

# Step 6: Verify manifest
cat docs/documentation-manifest.json
```

#### Verify Results

1. **Check Progress File**
   ```bash
   cat progress/documenter-progress.json
   ```
   - Should show `status: "completed"` or `status: "partial"`
   - Check `stats.completed_tables` count
   - Review any errors in `errors` array

2. **Check Generated Files**
   ```bash
   # List all generated files
   find docs -name "*.md" -o -name "*.json" | head -20
   
   # Check a specific table's documentation
   cat docs/databases/*/domains/*/tables/*.md | head -50
   ```

3. **Check Manifest**
   ```bash
   cat docs/documentation-manifest.json | jq '.status'
   cat docs/documentation-manifest.json | jq '.total_files'
   cat docs/documentation-manifest.json | jq '.work_units[0]'
   ```

---

## Manual Testing Scenarios

### Test 1: Single Table Documentation

Create a test table and document it:

```sql
-- In your test database
CREATE TABLE test_users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO test_users (email, name) VALUES
  ('alice@example.com', 'Alice'),
  ('bob@test.com', 'Bob'),
  ('charlie@example.org', 'Charlie');
```

Then run:
```bash
npm run plan
npm run document
```

### Test 2: Checkpoint Recovery

Test that the documenter can resume after interruption:

```bash
# Start documentation
npm run document

# In another terminal, interrupt it (Ctrl+C or kill)
# Then run again - it should resume
npm run document
```

Check `progress/documenter-progress.json` to see checkpoint recovery.

### Test 3: Error Handling

Test error scenarios:

1. **Invalid Plan**
   ```bash
   # Corrupt the plan file
   echo "invalid json" > progress/documentation-plan.json
   npm run document
   # Should fail with DOC_PLAN_INVALID
   ```

2. **Database Connection Failure**
   ```bash
   # Set invalid connection string
   export TEST_DATABASE_URL="postgresql://invalid:invalid@localhost:5432/invalid"
   npm run document
   # Should handle gracefully and continue
   ```

3. **LLM API Failure**
   ```bash
   # Set invalid API key
   export OPENROUTER_API_KEY="invalid-key"
   npm run document
   # Should use fallback descriptions
   ```

### Test 4: Manifest Generation

Verify manifest is generated correctly:

```bash
npm run document

# Check manifest exists
test -f docs/documentation-manifest.json && echo "Manifest exists"

# Validate manifest structure
cat docs/documentation-manifest.json | jq '.schema_version'
cat docs/documentation-manifest.json | jq '.status'
cat docs/documentation-manifest.json | jq '.total_files'

# Verify all files in manifest exist
cat docs/documentation-manifest.json | jq -r '.indexable_files[].path' | while read path; do
  test -f "docs/$path" || echo "Missing: $path"
done
```

---

## Test Coverage

### Current Coverage

- **Unit Tests**: ~50 tests covering core functionality
- **Integration Tests**: 4 scenarios (IT-DOC-1 through IT-DOC-4)
- **Generator Tests**: 50 tests (MarkdownGenerator, JSONGenerator, FileWriter)

### Running Coverage Report

```bash
# Install coverage tool (if not already installed)
npm install --save-dev @vitest/coverage-v8

# Run tests with coverage
npm test -- --coverage
```

---

## Troubleshooting

### Tests Fail with "Module not found"

```bash
# Rebuild TypeScript
npm run build

# Or run tests with tsx
npx vitest --run
```

### Integration Tests Skip Automatically

Check environment variables:
```bash
echo $TEST_DATABASE_URL
echo $OPENROUTER_API_KEY
```

If not set, tests will skip (this is expected behavior).

### Database Connection Issues

1. Verify database is running:
   ```bash
   psql $TEST_DATABASE_URL -c "SELECT 1"
   ```

2. Check connection string format:
   ```
   postgresql://user:password@host:port/database
   ```

3. Test with a simple query:
   ```bash
   psql $TEST_DATABASE_URL -c "SELECT version()"
   ```

### LLM API Issues

1. Verify API key is valid:
   ```bash
   curl https://openrouter.ai/api/v1/models \
     -H "Authorization: Bearer $OPENROUTER_API_KEY"
   ```

2. Check rate limits and quotas
3. Verify network connectivity

### File Permission Issues

```bash
# Ensure docs directory is writable
mkdir -p docs
chmod 755 docs

# Check disk space
df -h .
```

---

## Continuous Integration

For CI/CD pipelines, use environment variables:

```yaml
# Example GitHub Actions
env:
  TEST_DATABASE_URL: ${{ secrets.TEST_DATABASE_URL }}
  OPENROUTER_API_KEY: ${{ secrets.OPENROUTER_API_KEY }}

steps:
  - name: Run unit tests
    run: npm test -- --run

  - name: Run integration tests
    run: npm run test:integration
    continue-on-error: true  # Optional: don't fail CI if DB unavailable
```

---

## Next Steps

1. **Add More Test Cases**: Expand coverage for edge cases
2. **Performance Testing**: Test with large schemas (100+ tables)
3. **Load Testing**: Test concurrent documentation jobs
4. **End-to-End Pipeline**: Test plan → document → index → retrieval flow

---

## Questions?

- Check test files for examples
- Review PRD test requirements in `planning/documenter/PRDs/`
- See `src/agents/documenter/README.md` for architecture details

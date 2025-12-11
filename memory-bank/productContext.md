# Product Context: Tribal Knowledge Deep Agent

## Why This Project Exists

Organizations accumulate critical data knowledge that exists only in the minds of experienced team members - "tribal knowledge." When data scientists need to answer business questions like "Who are my customers most likely to churn?", they face significant friction:

- **Discovery friction**: Which tables contain relevant data?
- **Schema confusion**: What do cryptic column names actually mean?
- **Join complexity**: How do tables relate to each other?
- **Documentation debt**: Outdated or non-existent data dictionaries

This tribal knowledge problem slows down analytics, increases onboarding time, and creates dependencies on specific individuals.

## Problems It Solves

### 1. Discovery Friction
**Problem**: Data scientists spend hours searching for relevant tables
**Solution**: Natural language search that understands business context
**Impact**: Find relevant tables in seconds instead of hours

### 2. Schema Confusion
**Problem**: Cryptic column names like `usr_id`, `cust_acct_num` are unclear
**Solution**: LLM-generated semantic descriptions grounded in actual data
**Impact**: Understand column purpose without guessing

### 3. Join Complexity
**Problem**: Figuring out how to join tables requires trial and error
**Solution**: Pre-computed join paths with SQL snippets
**Impact**: Generate correct SQL on first try

### 4. Documentation Debt
**Problem**: Manual documentation is outdated and incomplete
**Solution**: Automatic documentation generation that stays current
**Impact**: Documentation maintenance effort reduced by 90%

### 5. AI Agent Enablement
**Problem**: AI agents need context but token budgets are limited
**Solution**: Efficient context retrieval with adaptive token budgets
**Impact**: AI agents can autonomously discover data context

## How It Should Work

### User Workflow

1. **Setup** (One-time)
   - Configure databases in `config/databases.yaml`
   - Set environment variables for API keys and connections
   - Customize prompt templates if needed

2. **Planning Phase**
   - Run `npm run plan`
   - System analyzes all databases, detects domains, creates plan
   - User reviews `progress/documentation-plan.json`
   - User can modify plan before proceeding

3. **Documentation Phase**
   - Run `npm run document`
   - System executes plan, spawns sub-agents for each table
   - Generates Markdown and JSON documentation files
   - Progress tracked for checkpoint recovery

4. **Indexing Phase**
   - Run `npm run index`
   - System parses documentation, generates embeddings
   - Builds hybrid search index (FTS5 + vectors)
   - Stores in SQLite database

5. **Retrieval Phase**
   - MCP server exposes tools for search
   - External agents call tools via MCP protocol
   - System returns context-budgeted responses

### Key Interactions

**Data Scientist Experience**:
```
Query: "customer churn"
→ System searches index
→ Returns: customers table, orders table, subscription_status table
→ Includes descriptions, key columns, relationships
→ Response time: < 500ms
```

**AI Agent Experience**:
```
Tool Call: search_tables("monthly revenue by customer")
→ System performs hybrid search
→ Returns compressed context within token budget
→ Agent uses context to generate SQL
```

**Data Engineer Experience**:
```
Command: npm run pipeline
→ System runs plan → document → index
→ All databases documented automatically
→ Documentation stays current with schema changes
```

## User Experience Goals

### Speed
- Search results in < 500ms (p95)
- Documentation for 100 tables in < 5 minutes
- Planning for 100 tables in < 30 seconds

### Accuracy
- Top-3 search results relevant >85% of the time
- Join path SQL correct >95% of the time
- Semantic descriptions sensible >90% of the time

### Usability
- Single command runs full pipeline
- Clear error messages with actionable guidance
- Progress visibility for long operations
- Checkpoint recovery after interruptions

### Consistency
- All descriptions follow template patterns
- Factual grounding (no speculation beyond data)
- Professional, predictable documentation style

## Business Value

### Time Savings
- **Data Discovery**: Reduce from hours to seconds (80% reduction)
- **Onboarding**: Reduce data discovery portion by 50%
- **Documentation**: Reduce maintenance effort by 90%

### Quality Improvements
- **SQL Accuracy**: Correct joins on first try
- **Context Quality**: High-signal, minimal noise for AI agents
- **Documentation Completeness**: 100% coverage vs. manual gaps

### Risk Reduction
- **Knowledge Dependency**: Eliminate single points of failure
- **Documentation Debt**: Automatic updates prevent staleness
- **Onboarding Risk**: New team members productive faster

## Success Indicators

### Quantitative
- Search latency p95 < 500ms
- Top-3 relevance >85%
- Documentation coverage 100%
- Join path accuracy >95%

### Qualitative
- Data scientists report finding tables "much faster"
- AI agents successfully generate SQL using context
- New team members understand data landscape in days, not weeks
- Documentation is "always current" without manual effort

## Competitive Advantages

1. **Deep Agent Architecture**: Planning before execution, sub-agents for efficiency
2. **Hybrid Search**: Combines keyword and semantic search for best results
3. **MCP Integration**: Native support for AI agent consumption
4. **Configurable Prompts**: Organization-specific terminology without code changes
5. **Multi-Database**: Unified interface for PostgreSQL and Snowflake

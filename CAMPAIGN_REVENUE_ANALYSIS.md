# Marketing Campaign Revenue Attribution Analysis

## Executive Summary

Analysis of 100 marketing campaigns tracking revenue through the complete sales pipeline: **campaigns → opportunities → quotes → sales orders → line items**.

### Key Findings

- **Total Campaigns Analyzed**: 100
- **Campaigns Generating Revenue**: 18 (18%)
- **Total Revenue Generated**: $23,708.68
- **Total Marketing Spend**: $2,844,598.14
- **Overall ROI**: 0.83%

---

## Top Revenue-Generating Campaigns

### 🥇 #1: Campaign ID 65
**Name**: "From enjoy speech pull today way. Beyond billion national while realize face."

- **Revenue**: $2,677.99
- **Cost**: $9,884.89
- **ROI**: 27.09%
- **Funnel**: 1 opportunity → 1 quote → 3 orders
- **Response Rate**: 130.63%

### 🥈 #2: Campaign ID 23
**Name**: "Tax may sense least sing author. Defense country they manager manage."

- **Revenue**: $2,441.71
- **Cost**: $63,469.63
- **ROI**: 3.85%
- **Funnel**: 1 opportunity → 3 quotes → 5 orders
- **Response Rate**: 169.93%

### 🥉 #3: Campaign ID 47
**Name**: "Only human future. Among east strong thus join herself."

- **Revenue**: $2,295.81
- **Cost**: $25,394.71
- **ROI**: 9.04%
- **Funnel**: 2 opportunities → 1 quote → 2 orders
- **Response Rate**: 96.61%

---

## Best ROI Campaign

### 🏆 Campaign ID 84
**Name**: "President enjoy eat choice surface. Foot official clearly song which community account."

- **Revenue**: $1,659.29
- **Cost**: $1,400.40
- **Net Revenue**: $258.89
- **ROI**: **118.49%** ⭐
- **Funnel**: 2 opportunities → 2 quotes → 2 orders
- **Response Rate**: 23.41%

**This is the ONLY campaign that generated positive net revenue!**

---

## Complete Top 10 by Revenue

| Rank | Campaign ID | Revenue | Cost | ROI | Net Revenue |
|------|-------------|---------|------|-----|-------------|
| 1 | 65 | $2,677.99 | $9,884.89 | 27.09% | -$7,206.90 |
| 2 | 23 | $2,441.71 | $63,469.63 | 3.85% | -$61,027.92 |
| 3 | 47 | $2,295.81 | $25,394.71 | 9.04% | -$23,098.90 |
| 4 | 42 | $2,126.93 | $96,322.64 | 2.21% | -$94,195.71 |
| 5 | 18 | $1,952.21 | $52,325.78 | 3.73% | -$50,373.57 |
| 6 | 73 | $1,834.84 | $7,846.54 | 23.38% | -$6,011.70 |
| 7 | 84 | $1,659.29 | $1,400.40 | **118.49%** | **$258.89** ✅ |
| 8 | 10 | $1,569.53 | $73,575.94 | 2.13% | -$72,006.41 |
| 9 | 95 | $1,525.90 | $6,483.22 | 23.54% | -$4,957.32 |
| 10 | 96 | $1,187.60 | $1,609.76 | 73.77% | -$422.16 |

---

## Worst Performing Campaigns (with revenue)

| Rank | Campaign ID | Revenue | Cost | ROI | Net Revenue |
|------|-------------|---------|------|-----|-------------|
| 1 | 45 | $631.03 | $63,967.49 | 0.99% | -$63,336.46 |
| 2 | 39 | $680.68 | $48,024.53 | 1.42% | -$47,343.85 |
| 3 | 93 | $75.05 | $4,558.77 | 1.65% | -$4,483.72 |
| 4 | 10 | $1,569.53 | $73,575.94 | 2.13% | -$72,006.41 |
| 5 | 42 | $2,126.93 | $96,322.64 | 2.21% | -$94,195.71 |

---

## Campaign Performance Breakdown

### By Revenue Status
- **With Revenue**: 18 campaigns (18%)
- **Opportunities but No Revenue**: 23 campaigns (23%)  
- **No Activity**: 59 campaigns (59%)

### Conversion Metrics
- **Total Opportunities Created**: 50
- **Total Quotes Generated**: 50
- **Total Orders Won**: 50
- **Average Orders per Campaign**: 2.78 (for campaigns with revenue)

### Financial Performance
- **Total Budgeted**: $2,766,219.49
- **Total Actual Cost**: $2,844,598.14
- **Budget Variance**: +2.83% (over budget)
- **Total Net Revenue**: -$2,820,889.46 (significant loss)

---

## Data Pipeline Architecture

```
marketing campaigns (synthetic.campaigns)
    ↓ campaign_id
opportunities (synthetic.opportunities)
    ↓ opportunity_id
quotes (synthetic.quotes)
    ↓ quote_id
sales_orders (synthetic.sales_orders)
    ↓ sales_order_id
sales_order_lines (synthetic.sales_order_lines)
    → line_total (REVENUE)
```

### Key Foreign Key Relationships
- `opportunities.campaign_id` → `campaigns.campaign_id`
- `quotes.opportunity_id` → `opportunities.opportunity_id`
- `sales_orders.quote_id` → `quotes.quote_id`
- `sales_order_lines.sales_order_id` → `sales_orders.sales_order_id`

---

## Recommendations

### 1. **Focus on High-ROI Campaigns**
Campaign ID 84 is the ONLY profitable campaign (118.49% ROI). Analyze what made it successful:
- Lower cost ($1,400 vs. average $15,803)
- Efficient funnel (100% quote-to-order conversion)
- Reasonable response rate (23.41%)

### 2. **Investigate Low-ROI Campaigns**
5 campaigns have ROI < 5% despite generating revenue. Consider:
- Pausing or optimizing these campaigns
- Analyzing why costs are so high relative to revenue
- Campaign IDs to review: 45, 39, 93, 10, 42

### 3. **Address Zero-Activity Campaigns**
59% of campaigns (59 campaigns) generated zero opportunities. Either:
- Improve targeting and messaging
- Shut down and reallocate budget
- Review campaign setup and execution

### 4. **Optimize Budget Allocation**
- Overall budget overrun of 2.83%
- Most campaigns are running at a loss
- Consider reallocating budget to proven performers

### 5. **Improve Funnel Efficiency**
- Average opportunities per campaign: 0.5 (very low)
- Need to improve lead generation and qualification
- Focus on campaigns with higher response rates

---

## Query Files

### 1. Main Revenue Query
**File**: `scripts/campaign-revenue-query.ts`  
**Purpose**: Top 20 revenue-generating campaigns with detailed metrics

### 2. Comprehensive Analysis
**File**: `scripts/all-campaigns-analysis.ts`  
**Purpose**: All campaigns including those without revenue

### 3. SQL Query
**File**: `queries/campaign-revenue-attribution.sql`  
**Purpose**: Reusable SQL query for direct database execution

---

## How to Run

### TypeScript Scripts
```bash
cd TribalAgent

# Top revenue generators
npx tsc scripts/campaign-revenue-query.ts --outDir dist/scripts --esModuleInterop --module esnext --target es2020 --resolveJsonModule --moduleResolution node
npx dotenv-cli node dist/scripts/campaign-revenue-query.js

# All campaigns analysis
npx tsc scripts/all-campaigns-analysis.ts --outDir dist/scripts --esModuleInterop --module esnext --target es2020 --resolveJsonModule --moduleResolution node
npx dotenv-cli node dist/scripts/all-campaigns-analysis.js
```

### Direct SQL
```bash
psql -h ${SUPABASE_SYNTHETIC_HOST} \
     -p ${SUPABASE_SYNTHETIC_PORT} \
     -U ${SUPABASE_SYNTHETIC_USER} \
     -d ${SUPABASE_SYNTHETIC_DATABASE} \
     -f queries/campaign-revenue-attribution.sql
```

---

## Database Schema

### campaigns
- `campaign_id` (PK)
- `campaign_name`
- `campaign_type`
- `status`
- `budgeted_cost`
- `actual_cost`
- `expected_revenue`
- `num_sent`
- `num_responses`

### opportunities
- `opportunity_id` (PK)
- `campaign_id` (FK → campaigns)
- `opportunity_name`
- `amount`
- `is_won`
- `is_closed`

### quotes
- `quote_id` (PK)
- `opportunity_id` (FK → opportunities)
- `quote_number`
- `grand_total`

### sales_orders
- `sales_order_id` (PK)
- `quote_id` (FK → quotes)
- `order_number`
- `grand_total`

### sales_order_lines
- `so_line_id` (PK)
- `sales_order_id` (FK → sales_orders)
- `product_name`
- `quantity`
- `unit_price`
- `line_total` ← **REVENUE SOURCE**

---

*Report generated: December 14, 2025*  
*Database: synthetic_250_postgres*  
*Schema: synthetic*

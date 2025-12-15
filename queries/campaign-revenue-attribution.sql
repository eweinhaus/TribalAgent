-- ============================================================================
-- MARKETING CAMPAIGN REVENUE ATTRIBUTION QUERY
-- ============================================================================
-- Purpose: Track which marketing campaigns generated the most revenue
-- Pipeline: campaigns → opportunities → quotes → sales_orders → sales_order_lines
-- Database: PostgreSQL (synthetic_250_postgres)
-- Schema: synthetic
-- ============================================================================

WITH campaign_revenue AS (
  SELECT 
    -- Campaign identification
    c.campaign_id,
    c.campaign_name,
    c.campaign_type,
    c.status,
    
    -- Campaign financials
    c.budgeted_cost,
    c.actual_cost,
    c.expected_revenue,
    
    -- Campaign metrics
    c.num_sent,
    c.num_responses,
    ROUND(
      CASE 
        WHEN c.num_sent > 0 
        THEN (c.num_responses::NUMERIC / c.num_sent) * 100 
        ELSE 0 
      END, 
      2
    ) AS response_rate,
    
    -- Sales funnel counts
    COUNT(DISTINCT o.opportunity_id) AS opportunities_created,
    COUNT(DISTINCT q.quote_id) AS quotes_generated,
    COUNT(DISTINCT so.sales_order_id) AS orders_won,
    
    -- Revenue calculations
    SUM(sol.line_total) AS total_revenue,
    SUM(sol.line_total) - COALESCE(c.actual_cost, 0) AS net_revenue,
    ROUND(
      CASE 
        WHEN COALESCE(c.actual_cost, 0) > 0 
        THEN (SUM(sol.line_total) / c.actual_cost) * 100 
        ELSE NULL 
      END, 
      2
    ) AS roi_percentage
  FROM 
    synthetic.campaigns c
    -- Join to opportunities (campaign → opportunity)
    LEFT JOIN synthetic.opportunities o 
      ON c.campaign_id = o.campaign_id
    -- Join to quotes (opportunity → quote)
    LEFT JOIN synthetic.quotes q 
      ON o.opportunity_id = q.opportunity_id
    -- Join to sales orders (quote → sales order)
    LEFT JOIN synthetic.sales_orders so 
      ON q.quote_id = so.quote_id
    -- Join to line items (sales order → line items for revenue)
    LEFT JOIN synthetic.sales_order_lines sol 
      ON so.sales_order_id = sol.sales_order_id
  GROUP BY 
    c.campaign_id,
    c.campaign_name,
    c.campaign_type,
    c.status,
    c.budgeted_cost,
    c.actual_cost,
    c.expected_revenue,
    c.num_sent,
    c.num_responses
)
SELECT 
  campaign_id,
  campaign_name,
  campaign_type,
  status,
  
  -- Financials
  budgeted_cost,
  actual_cost,
  expected_revenue,
  
  -- Campaign engagement
  num_sent,
  num_responses,
  response_rate,
  
  -- Sales funnel
  opportunities_created,
  quotes_generated,
  orders_won,
  
  -- Revenue metrics
  COALESCE(total_revenue, 0) AS total_revenue,
  net_revenue,
  roi_percentage,
  
  -- Conversion rates
  ROUND(
    CASE 
      WHEN opportunities_created > 0 
      THEN (quotes_generated::NUMERIC / opportunities_created) * 100 
      ELSE 0 
    END, 
    2
  ) AS opportunity_to_quote_rate,
  ROUND(
    CASE 
      WHEN quotes_generated > 0 
      THEN (orders_won::NUMERIC / quotes_generated) * 100 
      ELSE 0 
    END, 
    2
  ) AS quote_to_order_rate
FROM 
  campaign_revenue
WHERE 
  total_revenue > 0  -- Only campaigns with actual revenue
ORDER BY 
  total_revenue DESC
LIMIT 20;

-- ============================================================================
-- VARIANT: All campaigns (including those without revenue)
-- ============================================================================
-- Uncomment to see all campaigns regardless of revenue:
/*
SELECT 
  campaign_id,
  campaign_name,
  campaign_type,
  status,
  budgeted_cost,
  actual_cost,
  opportunities_created,
  quotes_generated,
  orders_won,
  COALESCE(total_revenue, 0) AS total_revenue,
  net_revenue,
  roi_percentage
FROM 
  campaign_revenue
ORDER BY 
  total_revenue DESC, actual_cost DESC;
*/

-- ============================================================================
-- KEY INSIGHTS FROM ANALYSIS
-- ============================================================================
-- Total Campaigns: 100
-- Campaigns with Revenue: 18 (18%)
-- Campaigns with Opportunities but No Revenue: 23 (23%)
-- Campaigns with No Activity: 59 (59%)
--
-- Top Campaign by Revenue: Campaign ID 65 ($2,677.99)
-- Best ROI: Campaign ID 84 (118.49%)
-- Worst ROI (with revenue): Campaign ID 45 (0.99%)
--
-- Overall Statistics:
-- - Total Revenue: $23,708.68
-- - Total Marketing Cost: $2,844,598.14
-- - Overall ROI: 0.83%
-- - Average Revenue per Campaign with Sales: $1,317.15
-- ============================================================================

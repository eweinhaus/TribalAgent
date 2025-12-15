#!/usr/bin/env node
/**
 * Campaign Revenue Attribution Query
 * Tracks marketing campaigns through: campaign → opportunity → quote → sales order → line items
 */

import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

async function runCampaignRevenueQuery() {
  const pool = new Pool({
    host: process.env.SUPABASE_SYNTHETIC_HOST,
    port: parseInt(process.env.SUPABASE_SYNTHETIC_PORT || '5432'),
    database: process.env.SUPABASE_SYNTHETIC_DATABASE,
    user: process.env.SUPABASE_SYNTHETIC_USER,
    password: process.env.SUPABASE_SYNTHETIC_PASSWORD,
  });

  try {
    console.log('🔍 Executing Campaign Revenue Attribution Query...\n');

    // First, let's check which campaign table exists and has the FK relationship
    const tableCheckQuery = `
      SELECT 
        tc.table_name,
        COUNT(*) as fk_count
      FROM information_schema.table_constraints tc
      JOIN information_schema.constraint_column_usage ccu 
        ON tc.constraint_name = ccu.constraint_name
      WHERE tc.table_schema = 'synthetic'
        AND tc.constraint_type = 'FOREIGN KEY'
        AND ccu.table_name IN ('campaigns', 'marketing_campaigns')
        AND tc.table_name = 'opportunities'
      GROUP BY tc.table_name;
    `;

    const tableCheck = await pool.query(tableCheckQuery);
    console.log('📊 Table relationship check:', tableCheck.rows);

    // Main query - using campaigns (based on FK relationship found in schema)
    const mainQuery = `
      WITH campaign_revenue AS (
        SELECT 
          c.campaign_id,
          c.campaign_name,
          c.campaign_type,
          c.status,
          c.budgeted_cost,
          c.actual_cost,
          c.expected_revenue,
          c.num_sent,
          c.num_responses,
          COUNT(DISTINCT o.opportunity_id) AS opportunities_created,
          COUNT(DISTINCT q.quote_id) AS quotes_generated,
          COUNT(DISTINCT so.sales_order_id) AS orders_won,
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
          LEFT JOIN synthetic.opportunities o 
            ON c.campaign_id = o.campaign_id
          LEFT JOIN synthetic.quotes q 
            ON o.opportunity_id = q.opportunity_id
          LEFT JOIN synthetic.sales_orders so 
            ON q.quote_id = so.quote_id
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
        budgeted_cost,
        actual_cost,
        expected_revenue,
        num_sent,
        num_responses,
        opportunities_created,
        quotes_generated,
        orders_won,
        COALESCE(total_revenue, 0) AS total_revenue,
        net_revenue,
        roi_percentage,
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
        total_revenue > 0
      ORDER BY 
        total_revenue DESC
      LIMIT 20;
    `;

    const result = await pool.query(mainQuery);

    if (result.rows.length === 0) {
      console.log('⚠️  No campaigns with revenue found.');
      
      // Let's check if there's any data in the tables
      console.log('\n📈 Checking data availability...\n');
      
      const dataCounts = await pool.query(`
        SELECT 
          'campaigns' as table_name, COUNT(*) as count FROM synthetic.campaigns
        UNION ALL
        SELECT 'opportunities', COUNT(*) FROM synthetic.opportunities
        UNION ALL
        SELECT 'quotes', COUNT(*) FROM synthetic.quotes
        UNION ALL
        SELECT 'sales_orders', COUNT(*) FROM synthetic.sales_orders
        UNION ALL
        SELECT 'sales_order_lines', COUNT(*) FROM synthetic.sales_order_lines;
      `);
      
      console.table(dataCounts.rows);
      
    } else {
      console.log(`✅ Found ${result.rows.length} campaigns with revenue\n`);
      
      // Format and display results
      console.log('📊 TOP REVENUE-GENERATING CAMPAIGNS:\n');
      console.log('='.repeat(120));
      
      result.rows.forEach((row, index) => {
        console.log(`\n${index + 1}. ${row.campaign_name} (ID: ${row.campaign_id})`);
        console.log('   ' + '-'.repeat(100));
        console.log(`   Type: ${row.campaign_type || 'N/A'} | Status: ${row.status || 'N/A'}`);
        console.log(`   Budgeted: $${parseFloat(row.budgeted_cost || 0).toLocaleString()} | Actual Cost: $${parseFloat(row.actual_cost || 0).toLocaleString()}`);
        console.log(`   Campaign Metrics: Sent: ${row.num_sent || 0} | Responses: ${row.num_responses || 0}`);
        console.log(`\n   📈 Funnel Metrics:`);
        console.log(`      Opportunities: ${row.opportunities_created}`);
        console.log(`      Quotes: ${row.quotes_generated} (${row.opportunity_to_quote_rate}% conversion)`);
        console.log(`      Orders: ${row.orders_won} (${row.quote_to_order_rate}% conversion)`);
        console.log(`\n   💰 Revenue:`);
        console.log(`      Expected Revenue: $${parseFloat(row.expected_revenue || 0).toLocaleString()}`);
        console.log(`      Actual Revenue: $${parseFloat(row.total_revenue || 0).toLocaleString()}`);
        console.log(`      Net Revenue: $${parseFloat(row.net_revenue || 0).toLocaleString()}`);
        console.log(`      ROI: ${row.roi_percentage ? row.roi_percentage + '%' : 'N/A'}`);
      });
      
      console.log('\n' + '='.repeat(120));
      
      // Summary statistics
      const totalRevenue = result.rows.reduce((sum, row) => sum + parseFloat(row.total_revenue || 0), 0);
      const totalSpend = result.rows.reduce((sum, row) => sum + parseFloat(row.actual_cost || 0), 0);
      const overallROI = totalSpend > 0 ? ((totalRevenue / totalSpend) * 100).toFixed(2) : 'N/A';
      
      console.log('\n📊 SUMMARY STATISTICS:');
      console.log(`   Total Campaigns Analyzed: ${result.rows.length}`);
      console.log(`   Total Revenue Generated: $${totalRevenue.toLocaleString()}`);
      console.log(`   Total Marketing Spend: $${totalSpend.toLocaleString()}`);
      console.log(`   Overall ROI: ${overallROI}%\n`);
    }

  } catch (error) {
    console.error('❌ Error executing query:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

// Run the query
runCampaignRevenueQuery()
  .then(() => {
    console.log('✅ Query completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Query failed:', error);
    process.exit(1);
  });

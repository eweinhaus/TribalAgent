import pkg from 'pg';
const { Pool } = pkg;
import dotenv from 'dotenv';

dotenv.config();

async function runAllCampaignsQuery() {
  const pool = new Pool({
    host: process.env.SUPABASE_SYNTHETIC_HOST,
    port: parseInt(process.env.SUPABASE_SYNTHETIC_PORT || '5432'),
    database: process.env.SUPABASE_SYNTHETIC_DATABASE,
    user: process.env.SUPABASE_SYNTHETIC_USER,
    password: process.env.SUPABASE_SYNTHETIC_PASSWORD,
  });

  try {
    console.log('🔍 Analyzing ALL Campaigns (including those without revenue)...\n');

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
          ) AS roi_percentage,
          ROUND(
            CASE 
              WHEN c.num_sent > 0 
              THEN (c.num_responses::NUMERIC / c.num_sent) * 100 
              ELSE 0 
            END, 
            2
          ) AS response_rate
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
        response_rate,
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
      ORDER BY 
        total_revenue DESC, actual_cost DESC;
    `;

    const result = await pool.query(mainQuery);

    console.log(`📊 Total Campaigns: ${result.rows.length}\n`);
    
    // Group campaigns by performance
    const withRevenue = result.rows.filter(r => parseFloat(r.total_revenue) > 0);
    const withOpportunities = result.rows.filter(r => r.opportunities_created > 0 && parseFloat(r.total_revenue) === 0);
    const noActivity = result.rows.filter(r => r.opportunities_created === 0);
    
    console.log(`✅ Campaigns with Revenue: ${withRevenue.length}`);
    console.log(`⏳ Campaigns with Opportunities (no revenue yet): ${withOpportunities.length}`);
    console.log(`❌ Campaigns with No Activity: ${noActivity.length}\n`);
    
    // Show top performers
    console.log('=' .repeat(120));
    console.log('\n🏆 TOP 10 REVENUE-GENERATING CAMPAIGNS:\n');
    
    withRevenue.slice(0, 10).forEach((row, index) => {
      console.log(`${index + 1}. ${row.campaign_name.substring(0, 80)}... (ID: ${row.campaign_id})`);
      console.log(`   💰 Revenue: $${parseFloat(row.total_revenue || 0).toLocaleString()} | ROI: ${row.roi_percentage || 'N/A'}%`);
      console.log(`   📊 Funnel: ${row.opportunities_created} opps → ${row.quotes_generated} quotes → ${row.orders_won} orders`);
      console.log(`   💵 Cost: $${parseFloat(row.actual_cost || 0).toLocaleString()} | Response Rate: ${row.response_rate}%\n`);
    });
    
    // Show campaigns with worst ROI
    console.log('=' .repeat(120));
    console.log('\n📉 CAMPAIGNS WITH LOWEST ROI (but with revenue):\n');
    
    const sortedByROI = [...withRevenue].sort((a, b) => 
      parseFloat(a.roi_percentage || 0) - parseFloat(b.roi_percentage || 0)
    );
    
    sortedByROI.slice(0, 5).forEach((row, index) => {
      console.log(`${index + 1}. ${row.campaign_name.substring(0, 80)}... (ID: ${row.campaign_id})`);
      console.log(`   💰 Revenue: $${parseFloat(row.total_revenue || 0).toLocaleString()} | ROI: ${row.roi_percentage || 'N/A'}%`);
      console.log(`   📊 Cost: $${parseFloat(row.actual_cost || 0).toLocaleString()} | Net: $${parseFloat(row.net_revenue || 0).toLocaleString()}\n`);
    });
    
    // Summary statistics
    console.log('=' .repeat(120));
    console.log('\n📊 OVERALL STATISTICS:\n');
    
    const totalRevenue = result.rows.reduce((sum, row) => sum + parseFloat(row.total_revenue || 0), 0);
    const totalCost = result.rows.reduce((sum, row) => sum + parseFloat(row.actual_cost || 0), 0);
    const totalBudgeted = result.rows.reduce((sum, row) => sum + parseFloat(row.budgeted_cost || 0), 0);
    const totalOpportunities = result.rows.reduce((sum, row) => sum + parseInt(row.opportunities_created || 0), 0);
    const totalQuotes = result.rows.reduce((sum, row) => sum + parseInt(row.quotes_generated || 0), 0);
    const totalOrders = result.rows.reduce((sum, row) => sum + parseInt(row.orders_won || 0), 0);
    const overallROI = totalCost > 0 ? ((totalRevenue / totalCost) * 100).toFixed(2) : 'N/A';
    
    console.log(`Total Campaigns: ${result.rows.length}`);
    console.log(`Total Budgeted: $${totalBudgeted.toLocaleString()}`);
    console.log(`Total Actual Cost: $${totalCost.toLocaleString()}`);
    console.log(`Budget Variance: ${totalBudgeted > 0 ? ((totalCost / totalBudgeted - 1) * 100).toFixed(2) : 'N/A'}%\n`);
    
    console.log(`Total Opportunities: ${totalOpportunities}`);
    console.log(`Total Quotes: ${totalQuotes}`);
    console.log(`Total Orders: ${totalOrders}\n`);
    
    console.log(`Total Revenue: $${totalRevenue.toLocaleString()}`);
    console.log(`Total Net Revenue: $${(totalRevenue - totalCost).toLocaleString()}`);
    console.log(`Overall ROI: ${overallROI}%\n`);
    
    console.log('=' .repeat(120));

  } catch (error) {
    console.error('❌ Error executing query:', error);
    throw error;
  } finally {
    await pool.end();
  }
}

runAllCampaignsQuery()
  .then(() => {
    console.log('\n✅ Analysis completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Analysis failed:', error);
    process.exit(1);
  });

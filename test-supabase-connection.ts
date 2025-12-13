/**
 * Test Supabase PostgreSQL Connection
 */

import pg from 'pg';
const { Client } = pg;

async function testSupabaseConnection() {
  const connectionString = `postgresql://${process.env.SUPABASE_SYNTHETIC_USER}:${process.env.SUPABASE_SYNTHETIC_PASSWORD}@${process.env.SUPABASE_SYNTHETIC_HOST}:${process.env.SUPABASE_SYNTHETIC_PORT}/${process.env.SUPABASE_SYNTHETIC_DATABASE}`;

  console.log('🔍 Testing synthetic_250_postgres connection...');
  console.log('   Host:', process.env.SUPABASE_SYNTHETIC_HOST);
  console.log('   Database:', process.env.SUPABASE_SYNTHETIC_DATABASE);
  console.log('');

  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✅ Connected successfully!');
    
    const result = await client.query(`
      SELECT COUNT(*) as count 
      FROM information_schema.tables 
      WHERE table_schema = 'synthetic' AND table_type = 'BASE TABLE'
    `);
    console.log('📊 Tables in synthetic schema:', result.rows[0].count);
    
    const tables = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'synthetic' AND table_type = 'BASE TABLE'
      ORDER BY table_name
      LIMIT 15
    `);
    
    if (tables.rows.length > 0) {
      console.log('');
      console.log('📋 Sample tables:');
      tables.rows.forEach((r: any) => console.log('   -', r.table_name));
    }
    
    await client.end();
    console.log('');
    console.log('🎉 Connection test complete!');
  } catch (err: any) {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  }
}

testSupabaseConnection();


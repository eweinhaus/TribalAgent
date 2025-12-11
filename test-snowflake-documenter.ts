/**
 * Test Snowflake Connection using Documenter's Connector
 */

import { getDatabaseConnector } from './src/connectors/index.js';
import { loadConfig, resolveDatabaseConfigs } from './src/utils/config.js';

async function testSnowflakeDocumenter() {
  console.log('🔍 Testing Snowflake Connection via Documenter Connector...\n');

  try {
    // Load configuration
    console.log('📋 Loading configuration...');
    const config = await loadConfig();
    const resolvedConfigs = resolveDatabaseConfigs(config);

    // Find Snowflake database
    const snowflakeConfig = resolvedConfigs.find(db => db.type === 'snowflake');
    
    if (!snowflakeConfig) {
      console.error('❌ No Snowflake database found in configuration');
      process.exit(1);
    }

    console.log(`✅ Found Snowflake database: ${snowflakeConfig.name}`);
    console.log(`   Connection config: ${snowflakeConfig.connectionString.substring(0, 50)}...\n`);

    // Create connector
    console.log('🔌 Creating Snowflake connector...');
    const connector = getDatabaseConnector('snowflake');

    // Connect
    console.log('🔗 Connecting to Snowflake...');
    await connector.connect(snowflakeConfig.connectionString);
    console.log('✅ Connected successfully!\n');

    // Test query
    console.log('🧪 Testing query capability...');
    const result = await connector.query('SELECT CURRENT_DATABASE() as db, CURRENT_SCHEMA() as schema, CURRENT_WAREHOUSE() as warehouse');
    console.log('📍 Current Context:');
    console.log(`   Database: ${result[0]?.db || result[0]?.DB || 'N/A'}`);
    console.log(`   Schema: ${result[0]?.schema || result[0]?.SCHEMA || 'N/A'}`);
    console.log(`   Warehouse: ${result[0]?.warehouse || result[0]?.WAREHOUSE || 'N/A'}\n`);

    // Test getTableMetadata
    console.log('📊 Testing metadata extraction...');
    try {
      const tables = await connector.getAllTableMetadata(snowflakeConfig.schemas);
      console.log(`✅ Found ${tables.length} tables`);
      
      if (tables.length > 0) {
        console.log('\n📋 Sample tables:');
        tables.slice(0, 5).forEach((table: any) => {
          console.log(`   - ${table.table_schema || table.TABLE_SCHEMA}.${table.table_name || table.TABLE_NAME}`);
        });
        
        // Test getTableMetadata for first table
        if (tables.length > 0) {
          const firstTable = tables[0];
          const schema = firstTable.table_schema || firstTable.TABLE_SCHEMA;
          const tableName = firstTable.table_name || firstTable.TABLE_NAME;
          
          console.log(`\n🔍 Testing getTableMetadata for ${schema}.${tableName}...`);
          const metadata = await connector.getTableMetadata(schema, tableName);
          console.log(`✅ Metadata extracted:`);
          console.log(`   Columns: ${metadata.columns?.length || 0}`);
          console.log(`   Primary Key: ${metadata.primary_key?.join(', ') || 'None'}`);
        }
      } else {
        console.log('⚠️  No tables found in specified schemas');
      }
    } catch (error) {
      console.error('❌ Metadata extraction failed:', error instanceof Error ? error.message : String(error));
    }

    // Disconnect
    console.log('\n🔌 Disconnecting...');
    await connector.disconnect();
    console.log('✅ Disconnected successfully!');

    console.log('\n✨ All tests passed!');
    process.exit(0);

  } catch (error) {
    console.error('\n❌ Test failed:', error instanceof Error ? error.message : String(error));
    if (error instanceof Error && error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  }
}

testSnowflakeDocumenter();

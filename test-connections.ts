#!/usr/bin/env tsx

/**
 * Test script to verify database connections
 */

import { loadConfig, resolveDatabaseConfigs } from './src/utils/config.js';
import { getDatabaseConnector } from './src/connectors/index.js';

async function testConnections() {
  try {
    console.log('Loading configuration...');
    const config = await loadConfig();
    const databases = resolveDatabaseConfigs(config);

    console.log(`Found ${databases.length} database configurations`);

    for (const db of databases) {
      console.log(`\nTesting connection to ${db.name} (${db.type})...`);

      try {
        const connector = getDatabaseConnector(db.type);
        await connector.connect(db.connectionString);

        console.log(`✓ Successfully connected to ${db.name}`);

        // Try a simple query to verify the connection works
        if (db.type === 'postgres') {
          const result = await connector.query('SELECT version()');
          console.log(`✓ Query successful: PostgreSQL version detected`);
        } else if (db.type === 'snowflake') {
          const result = await connector.query('SELECT CURRENT_VERSION() as version');
          console.log(`✓ Query successful: Snowflake version ${result[0]?.VERSION || 'detected'}`);
        }

        await connector.disconnect();
        console.log(`✓ Successfully disconnected from ${db.name}`);

      } catch (error) {
        console.error(`✗ Failed to connect to ${db.name}:`, error.message);
      }
    }

  } catch (error) {
    console.error('Configuration error:', error.message);
    process.exit(1);
  }
}

testConnections().catch(console.error);
/**
 * Test Snowflake Connection and Query Available Databases/Warehouses
 */

import snowflake from 'snowflake-sdk';

const account = 'nsfybxh-akc83312';
const username = process.env.SNOWFLAKE_TEST_USERNAME || 'stealthagent';
const password = process.env.SNOWFLAKE_TEST_PASSWORD || '9867g7ZugNa9qTr';

async function testSnowflakeConnection() {
  console.log('🔍 Testing Snowflake Connection...\n');
  console.log(`Account: ${account}`);
  console.log(`Username: ${username}`);
  console.log(`Password: ${password ? '***' : 'NOT SET'}\n`);

  // First, try to connect without warehouse/database to query available ones
  const config: any = {
    account,
    username,
    password,
    // Don't set warehouse/database initially - we'll query for them
  };

  return new Promise<void>((resolve, reject) => {
    const connection = snowflake.createConnection(config);

    connection.connect((err, conn) => {
      if (err) {
        console.error('❌ Connection failed:', err.message);
        reject(err);
        return;
      }

      console.log('✅ Connected to Snowflake!\n');

      // Query available databases
      console.log('📊 Querying available databases...');
      conn.execute({
        sqlText: 'SHOW DATABASES',
        complete: (err, stmt, rows) => {
          if (err) {
            console.error('❌ Failed to query databases:', err.message);
            connection.destroy();
            reject(err);
            return;
          }

          console.log('\n📁 Available Databases:');
          if (rows && rows.length > 0) {
            rows.forEach((row: any) => {
              const dbName = row.name || row.NAME;
              const isDefault = row.is_default === 'Y' || row.IS_DEFAULT === 'Y';
              console.log(`  ${isDefault ? '⭐' : '  '} ${dbName}${isDefault ? ' (default)' : ''}`);
            });
          } else {
            console.log('  (none found)');
          }

          // Query available warehouses
          console.log('\n🏭 Querying available warehouses...');
          conn.execute({
            sqlText: 'SHOW WAREHOUSES',
            complete: (err2, stmt2, rows2) => {
              if (err2) {
                console.error('❌ Failed to query warehouses:', err2.message);
                connection.destroy();
                reject(err2);
                return;
              }

              console.log('\n🏭 Available Warehouses:');
              if (rows2 && rows2.length > 0) {
                rows2.forEach((row: any) => {
                  const whName = row.name || row.NAME;
                  const state = row.state || row.STATE;
                  const size = row.size || row.SIZE;
                  console.log(`  ${state === 'RUNNING' ? '🟢' : '🔴'} ${whName} (${state}, ${size})`);
                });
              } else {
                console.log('  (none found)');
              }

              // Query current user's default warehouse and database
              console.log('\n👤 Querying current user settings...');
              conn.execute({
                sqlText: 'SHOW PARAMETERS LIKE \'%WAREHOUSE%\' IN USER',
                complete: (err3, stmt3, rows3) => {
                  if (!err3 && rows3 && rows3.length > 0) {
                    console.log('\n⚙️  User Parameters:');
                    rows3.forEach((row: any) => {
                      console.log(`  ${row.key || row.KEY}: ${row.value || row.VALUE}`);
                    });
                  }

                  // Try to get current database
                  conn.execute({
                    sqlText: 'SELECT CURRENT_DATABASE() as db, CURRENT_SCHEMA() as schema, CURRENT_WAREHOUSE() as warehouse',
                    complete: (err4, stmt4, rows4) => {
                      if (!err4 && rows4 && rows4.length > 0) {
                        const current = rows4[0];
                        console.log('\n📍 Current Context:');
                        console.log(`  Database: ${current.db || current.DB || 'N/A'}`);
                        console.log(`  Schema: ${current.schema || current.SCHEMA || 'N/A'}`);
                        console.log(`  Warehouse: ${current.warehouse || current.WAREHOUSE || 'N/A'}`);
                      }

                      // Check if dabstep_db exists
                      console.log('\n🔍 Checking for dabstep_db...');
                      conn.execute({
                        sqlText: "SHOW DATABASES LIKE 'DABSTEP_DB'",
                        complete: (err5, stmt5, rows5) => {
                          if (!err5 && rows5 && rows5.length > 0) {
                            console.log('✅ Found dabstep_db!');
                            const db = rows5[0];
                            console.log(`  Name: ${db.name || db.NAME}`);
                            console.log(`  Created: ${db.created_on || db.CREATED_ON}`);
                          } else {
                            console.log('⚠️  dabstep_db not found. Available databases listed above.');
                          }

                          // Test query on a database (try dabstep_db or first available)
                          console.log('\n🧪 Testing query capability...');
                          let testDb = 'DABSTEP_DB';
                          if (!rows5 || rows5.length === 0) {
                            // Use first available database
                            if (rows && rows.length > 0) {
                              testDb = rows[0].name || rows[0].NAME;
                              console.log(`  Using first available database: ${testDb}`);
                            } else {
                              console.log('  ⚠️  No databases available for testing');
                              connection.destroy();
                              resolve();
                              return;
                            }
                          }

                          conn.execute({
                            sqlText: `USE DATABASE ${testDb}`,
                            complete: (err6) => {
                              if (err6) {
                                console.log(`  ⚠️  Could not use database ${testDb}: ${err6.message}`);
                              } else {
                                console.log(`  ✅ Successfully switched to database: ${testDb}`);
                                
                                // Query schemas
                                conn.execute({
                                  sqlText: 'SHOW SCHEMAS',
                                  complete: (err7, stmt7, rows7) => {
                                    if (!err7 && rows7 && rows7.length > 0) {
                                      console.log(`\n📂 Schemas in ${testDb}:`);
                                      rows7.forEach((row: any) => {
                                        const schemaName = row.name || row.NAME;
                                        console.log(`  - ${schemaName}`);
                                      });
                                    }
                                    
                                    connection.destroy(() => {
                                      console.log('\n✅ Connection test completed!');
                                      resolve();
                                    });
                                  }
                                });
                              }
                            }
                          });
                        }
                      });
                    }
                  });
                }
              });
            }
          });
        }
      });
    });
  });
}

// Run the test
testSnowflakeConnection()
  .then(() => {
    console.log('\n✨ All done!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Test failed:', error);
    process.exit(1);
  });

/**
 * Supabase Connection Test Script
 * Run: node test-supabase.js
 */

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

async function testConnection() {
  console.log('🔍 Testing Supabase connection...\n');

  // Check environment variables
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    console.error('❌ Missing environment variables:');
    if (!supabaseUrl) console.error('   - SUPABASE_URL');
    if (!supabaseKey) console.error('   - SUPABASE_ANON_KEY');
    process.exit(1);
  }

  console.log('✓ Environment variables found');
  console.log(`  URL: ${supabaseUrl}`);
  console.log(`  Key: ${supabaseKey.substring(0, 20)}...`);

  // Create Supabase client
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Test basic connection by checking if we can reach the API
    console.log('\n📡 Attempting to query database...');
    const { data, error, status, statusText } = await supabase.from('kunder').select('*').limit(1);

    console.log(`   HTTP Status: ${status} ${statusText || ''}`);

    if (error) {
      console.log(`   Error code: ${error.code}`);
      console.log(`   Error message: ${error.message}`);
      console.log(`   Error details: ${JSON.stringify(error.details)}`);

      // If table doesn't exist, that's expected - connection still works
      if (error.code === '42P01' || error.message?.includes('does not exist') || error.code === 'PGRST116') {
        console.log('\n✓ Supabase connection successful!');
        console.log('ℹ️  Table "kunder" does not exist yet - needs to be created');
        return true;
      }
      // Permission error also means connection works
      if (error.code === '42501' || error.message?.includes('permission')) {
        console.log('\n✓ Supabase connection successful!');
        console.log('ℹ️  RLS policies may need configuration');
        return true;
      }

      // Check if it's an auth error
      if (status === 401 || error.message?.includes('Invalid API key') || error.message?.includes('JWT')) {
        console.error('\n❌ Authentication failed - check your API keys');
        return false;
      }

      throw error;
    }

    console.log('\n✓ Supabase connection successful!');
    console.log('✓ Table "kunder" exists');
    if (data) {
      console.log(`✓ Found ${data.length} record(s)`);
    }
    return true;

  } catch (err) {
    console.error('\n❌ Connection failed:', err.message || err);
    console.error('Full error:', JSON.stringify(err, null, 2));

    if (err.message?.includes('Invalid API key')) {
      console.error('\n💡 Tip: Check that SUPABASE_ANON_KEY is correct');
    } else if (err.message?.includes('Invalid URL')) {
      console.error('\n💡 Tip: Check that SUPABASE_URL is correct');
    } else if (err.message?.includes('fetch')) {
      console.error('\n💡 Tip: Check your internet connection');
    }

    return false;
  }
}

testConnection().then(success => {
  process.exit(success ? 0 : 1);
});

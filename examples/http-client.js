#!/usr/bin/env node

/**
 * Modern HTTP Client for Google Calendar MCP Server
 * 
 * This demonstrates how to connect to the Google Calendar MCP server
 * when it's running in StreamableHTTP transport mode. To test this
 * make sure you have the server running locally `npm run start:http`
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

async function main() {
  const serverUrl = process.argv[2] || 'http://localhost:3000';
  
  console.log(`🔗 Connecting to Google Calendar MCP Server at: ${serverUrl}`);
  
  try {
    // First test health endpoint to ensure server is running
    console.log('🏥 Testing server health...');
    const healthResponse = await fetch(`${serverUrl}/health`, {
      headers: {
        'Accept': 'application/json'
      }
    });
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.json();
      console.log('✅ Server is healthy:', healthData);
    } else {
      console.error('❌ Server health check failed');
      return;
    }

    // Create MCP client
    const client = new Client({
      name: "google-calendar-http-client",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Skip direct initialization test to avoid double-initialization error
    console.log('\n🔍 Skipping direct initialization test...');

    // Connect with SDK transport
    console.log('\n🚀 Connecting with MCP SDK transport...');
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    
    await client.connect(transport);
    console.log('✅ Connected to server');

    // List available tools
    console.log('\n📋 Listing available tools...');
    const tools = await client.listTools();
    console.log(`Found ${tools.tools.length} tools:`);
    
    tools.tools.forEach((tool, index) => {
      console.log(`  ${index + 1}. ${tool.name}`);
      console.log(`     Description: ${tool.description}`);
    });

    // Test some basic tools
    console.log('\n🛠️ Testing tools...');
    
    // Test list-calendars
    try {
      console.log('\n📅 Testing list-calendars...');
      const calendarsResult = await client.callTool({
        name: 'list-calendars',
        arguments: {}
      });
      console.log('✅ list-calendars successful');
      console.log('Result:', calendarsResult.content[0].text.substring(0, 300) + '...');
    } catch (error) {
      console.log('❌ list-calendars failed:', error.message);
    }

    // Test list-colors
    try {
      console.log('\n🎨 Testing list-colors...');
      const colorsResult = await client.callTool({
        name: 'list-colors',
        arguments: {}
      });
      console.log('✅ list-colors successful');
      console.log('Result:', colorsResult.content[0].text.substring(0, 300) + '...');
    } catch (error) {
      console.log('❌ list-colors failed:', error.message);
    }

    // Test list-events for primary calendar
    try {
      console.log('\n📆 Testing list-events...');
      
      // Create ISO strings using standard JavaScript toISOString()
      const now = new Date();
      const nextWeek = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      
      // Use standard RFC 3339 format with milliseconds (now properly supported)
      const timeMin = now.toISOString();
      const timeMax = nextWeek.toISOString();
      
      console.log(`📅 Fetching events from ${timeMin} to ${timeMax}`);
      
      const eventsResult = await client.callTool({
        name: 'list-events',
        arguments: {
          calendarId: 'primary',
          timeMin: timeMin,
          timeMax: timeMax
        }
      });
      console.log('✅ list-events successful');
      console.log('Result:', eventsResult.content[0].text.substring(0, 500) + '...');
    } catch (error) {
      console.log('❌ list-events failed:', error.message);
    }

    // Close the connection
    console.log('\n🔒 Closing connection...');
    await client.close();
    console.log('✅ Connection closed');
    
    console.log('\n🎉 Google Calendar MCP client test completed!');

  } catch (error) {
    console.error('❌ Error:', error);
    
    if (error.message.includes('Authentication required')) {
      console.log('\n💡 Authentication required:');
      console.log('   Run: npm run auth');
      console.log('   Then restart the server: npm run start:http');
    } else if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Server not running:');
      console.log('   Start server: npm run start:http');
    } else {
      console.log('\n💡 Check that:');
      console.log('   1. Server is running (npm run start:http)');
      console.log('   2. Authentication is complete (npm run auth)');
      console.log('   3. Server URL is correct');
    }
    
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down HTTP client...');
  process.exit(0);
});

main().catch(error => {
  console.error('❌ Unhandled error:', error);
  process.exit(1);
});
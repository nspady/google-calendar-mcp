/**
 * Multi-Tenant Client Example
 *
 * This example demonstrates how to use the Google Calendar MCP Server
 * in multi-tenant mode with multiple users accessing their own calendars.
 *
 * Prerequisites:
 * 1. Start the MCP server in HTTP mode: npm run start:http
 * 2. Have valid Google OAuth access tokens for your users
 *
 * Usage:
 * node examples/multi-tenant-client.js
 */

// Example user tokens (replace with real tokens from your OAuth flow)
const USER_TOKENS = {
  user1: {
    accessToken: process.env.USER1_ACCESS_TOKEN || 'YOUR_USER1_TOKEN_HERE',
    refreshToken: process.env.USER1_REFRESH_TOKEN || null,
    name: 'User 1'
  },
  user2: {
    accessToken: process.env.USER2_ACCESS_TOKEN || 'YOUR_USER2_TOKEN_HERE',
    refreshToken: process.env.USER2_REFRESH_TOKEN || null,
    name: 'User 2'
  }
};

const MCP_SERVER_URL = process.env.MCP_SERVER_URL || 'http://localhost:3000';

/**
 * Make an MCP request with a user's token
 */
async function callMcpTool(userToken, toolName, toolArgs) {
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${userToken.accessToken}`
  };

  // Include refresh token if available
  if (userToken.refreshToken) {
    headers['X-Refresh-Token'] = userToken.refreshToken;
  }

  const response = await fetch(MCP_SERVER_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Math.floor(Math.random() * 10000),
      method: 'tools/call',
      params: {
        name: toolName,
        arguments: toolArgs
      }
    })
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  if (data.error) {
    throw new Error(`MCP Error: ${data.error.message}`);
  }

  return data.result;
}

/**
 * Example 1: List calendars for multiple users concurrently
 */
async function example1_listCalendarsForMultipleUsers() {
  console.log('\n=== Example 1: List Calendars for Multiple Users ===\n');

  try {
    // Both users list their calendars concurrently
    const [user1Result, user2Result] = await Promise.all([
      callMcpTool(USER_TOKENS.user1, 'list-calendars', {}),
      callMcpTool(USER_TOKENS.user2, 'list-calendars', {})
    ]);

    console.log(`${USER_TOKENS.user1.name}'s calendars:`, user1Result);
    console.log(`\n${USER_TOKENS.user2.name}'s calendars:`, user2Result);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * Example 2: Create events for different users
 */
async function example2_createEventsForDifferentUsers() {
  console.log('\n=== Example 2: Create Events for Different Users ===\n');

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(10, 0, 0, 0);

  const endTime = new Date(tomorrow);
  endTime.setHours(11, 0, 0, 0);

  try {
    // User 1 creates a meeting
    const user1Event = await callMcpTool(USER_TOKENS.user1, 'create-event', {
      calendarId: 'primary',
      summary: 'Team Standup',
      start: tomorrow.toISOString().split('.')[0],
      end: endTime.toISOString().split('.')[0],
      location: 'Conference Room A'
    });

    console.log(`${USER_TOKENS.user1.name} created event:`, user1Event);

    // User 2 creates a different meeting (concurrent)
    const user2Event = await callMcpTool(USER_TOKENS.user2, 'create-event', {
      calendarId: 'primary',
      summary: 'Project Review',
      start: tomorrow.toISOString().split('.')[0],
      end: endTime.toISOString().split('.')[0],
      location: 'Conference Room B'
    });

    console.log(`\n${USER_TOKENS.user2.name} created event:`, user2Event);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * Example 3: List events for multiple users in parallel
 */
async function example3_listEventsInParallel() {
  console.log('\n=== Example 3: List Events for Multiple Users (Parallel) ===\n');

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const nextWeek = new Date(today);
  nextWeek.setDate(nextWeek.getDate() + 7);

  const timeMin = today.toISOString().split('.')[0];
  const timeMax = nextWeek.toISOString().split('.')[0];

  try {
    const startTime = Date.now();

    // Execute 10 concurrent requests (5 for each user)
    const requests = [];
    for (let i = 0; i < 5; i++) {
      requests.push(
        callMcpTool(USER_TOKENS.user1, 'list-events', {
          calendarId: 'primary',
          timeMin,
          timeMax
        })
      );
      requests.push(
        callMcpTool(USER_TOKENS.user2, 'list-events', {
          calendarId: 'primary',
          timeMin,
          timeMax
        })
      );
    }

    const results = await Promise.all(requests);
    const endTime = Date.now();

    console.log(`✓ Successfully executed ${requests.length} concurrent requests`);
    console.log(`✓ Time taken: ${endTime - startTime}ms`);
    console.log(`✓ Average per request: ${Math.round((endTime - startTime) / requests.length)}ms`);
    console.log(`\nSample result from ${USER_TOKENS.user1.name}:`, results[0]);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * Example 4: Check free/busy for multiple users
 */
async function example4_checkFreeBusy() {
  console.log('\n=== Example 4: Check Free/Busy for Multiple Users ===\n');

  const now = new Date();
  const later = new Date(now);
  later.setHours(later.getHours() + 8);

  const timeMin = now.toISOString().split('.')[0];
  const timeMax = later.toISOString().split('.')[0];

  try {
    const [user1FreeBusy, user2FreeBusy] = await Promise.all([
      callMcpTool(USER_TOKENS.user1, 'get-freebusy', {
        calendars: [{ id: 'primary' }],
        timeMin,
        timeMax
      }),
      callMcpTool(USER_TOKENS.user2, 'get-freebusy', {
        calendars: [{ id: 'primary' }],
        timeMin,
        timeMax
      })
    ]);

    console.log(`${USER_TOKENS.user1.name}'s availability:`, user1FreeBusy);
    console.log(`\n${USER_TOKENS.user2.name}'s availability:`, user2FreeBusy);
  } catch (error) {
    console.error('Error:', error.message);
  }
}

/**
 * Example 5: Error handling - Invalid token
 */
async function example5_errorHandling() {
  console.log('\n=== Example 5: Error Handling (Invalid Token) ===\n');

  const invalidToken = {
    accessToken: 'invalid_token_12345',
    name: 'Invalid User'
  };

  try {
    await callMcpTool(invalidToken, 'list-calendars', {});
  } catch (error) {
    console.log('✓ Expected error caught:', error.message);
  }
}

/**
 * Main function - Run all examples
 */
async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║   Google Calendar MCP - Multi-Tenant Client Demo      ║');
  console.log('╚════════════════════════════════════════════════════════╝');

  // Check if tokens are configured
  if (USER_TOKENS.user1.accessToken === 'YOUR_USER1_TOKEN_HERE') {
    console.error('\n⚠️  Error: Please configure user tokens!');
    console.error('\nSet environment variables:');
    console.error('  export USER1_ACCESS_TOKEN="your_token_here"');
    console.error('  export USER2_ACCESS_TOKEN="your_token_here"');
    console.error('\nOr edit this file and replace the placeholder tokens.\n');
    process.exit(1);
  }

  console.log(`\nMCP Server: ${MCP_SERVER_URL}`);
  console.log(`User 1: ${USER_TOKENS.user1.name}`);
  console.log(`User 2: ${USER_TOKENS.user2.name}`);

  try {
    // Run examples
    await example1_listCalendarsForMultipleUsers();
    await example2_createEventsForDifferentUsers();
    await example3_listEventsInParallel();
    await example4_checkFreeBusy();
    await example5_errorHandling();

    console.log('\n✓ All examples completed successfully!');
  } catch (error) {
    console.error('\n✗ Example failed:', error.message);
    process.exit(1);
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { callMcpTool, USER_TOKENS };

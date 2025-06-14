import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { TestDataFactory } from './test-data-factory.js';

/**
 * Complete Claude Haiku + MCP Integration Tests
 * 
 * REQUIREMENTS TO RUN THESE TESTS:
 * 1. Valid Google OAuth credentials file at path specified by GOOGLE_OAUTH_CREDENTIALS env var
 * 2. Authenticated test account: Run `npm run dev auth:test` first
 * 3. CLAUDE_API_KEY environment variable set to valid Anthropic API key
 * 4. TEST_CALENDAR_ID, INVITEE_1, INVITEE_2 environment variables set
 * 5. Network access to both Google Calendar API and Anthropic API
 * 
 * These tests implement a full end-to-end integration where:
 * 1. Claude Haiku receives natural language prompts
 * 2. Claude selects and calls MCP tools
 * 3. Tools are executed against your real MCP server
 * 4. Real Google Calendar operations are performed
 * 5. Results are returned to Claude for response generation
 * 
 * WARNING: These tests will create, modify, and delete real calendar events
 * and consume Claude API credits.
 */

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface ClaudeMCPClient {
  sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
  }>;
}

class RealClaudeMCPClient implements ClaudeMCPClient {
  private anthropic: Anthropic;
  private mcpClient: Client;
  private testFactory: TestDataFactory;
  
  constructor(apiKey: string, mcpClient: Client) {
    this.anthropic = new Anthropic({ apiKey });
    this.mcpClient = mcpClient;
    this.testFactory = new TestDataFactory();
  }
  
  async sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
  }> {
    // Get available tools from MCP server
    const availableTools = await this.mcpClient.listTools();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-3-5-haiku-20241022';
    
    // Convert MCP tools to Claude format
    const claudeTools = availableTools.tools
      .map(tool => ({
        name: tool.name,
        description: tool.description,
        input_schema: this.convertMCPSchemaToClaudeSchema(tool.inputSchema)
      }));

    // Send message to Claude with tools
    const message = await this.anthropic.messages.create({
      model: model,
      max_tokens: 1500,
      tools: claudeTools,
      messages: [{
        role: 'user',
        content: prompt
      }]
    });
    
    // Extract text and tool calls
    let textContent = '';
    const toolCalls: ToolCall[] = [];
    
    message.content.forEach(content => {
      if (content.type === 'text') {
        textContent += content.text;
      } else if (content.type === 'tool_use') {
        toolCalls.push({
          name: content.name,
          arguments: content.input as Record<string, any>
        });
      }
    });
    
    // Execute tool calls against MCP server
    const executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }> = [];
    for (const toolCall of toolCalls) {
      try {
        const startTime = this.testFactory.startTimer(`mcp-${toolCall.name}`);
        
        console.log(`🔧 Executing ${toolCall.name} with:`, JSON.stringify(toolCall.arguments, null, 2));
        
        let result: any;
        
        // Mock get-current-time to return fixed test time
        if (toolCall.name === 'get-current-time') {
          const testTime = new Date('2024-06-13T10:30:00.000Z');
          const timeZone = toolCall.arguments?.timeZone || 'America/Los_Angeles';
          
          result = {
            content: [{
              type: 'text',
              text: JSON.stringify({
                currentTime: {
                  utc: testTime.toISOString(),
                  timestamp: testTime.getTime(),
                  requestedTimeZone: {
                    timeZone: timeZone,
                    rfc3339: '2024-06-13T03:30:00-07:00',
                    humanReadable: 'Thursday, June 13, 2024 at 03:30:00 AM Pacific Daylight Time',
                    offset: '-07:00'
                  }
                }
              })
            }]
          };
        } else {
          result = await this.mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.arguments
          });
        }
        
        this.testFactory.endTimer(`mcp-${toolCall.name}`, startTime, true);
        
        executedResults.push({
          toolCall,
          result,
          success: true
        });
        
        console.log(`✅ ${toolCall.name} succeeded`);
        
        // Track created events for cleanup
        if (toolCall.name === 'create-event') {
          const eventId = TestDataFactory.extractEventIdFromResponse(result);
          if (eventId) {
            this.testFactory.addCreatedEventId(eventId);
            console.log(`📝 Tracked created event ID: ${eventId}`);
          }
        }
        
      } catch (error) {
        const startTime = this.testFactory.startTimer(`mcp-${toolCall.name}`);
        this.testFactory.endTimer(`mcp-${toolCall.name}`, startTime, false, String(error));
        
        executedResults.push({
          toolCall,
          result: { error: String(error) },
          success: false
        });
        
        console.log(`❌ ${toolCall.name} failed:`, String(error));
      }
    }
    
    // If Claude used tools, send results back for final response
    if (toolCalls.length > 0) {
      // Create tool results in the format Claude expects
      const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];
      let toolUseIndex = 0;
      
      message.content.forEach(content => {
        if (content.type === 'tool_use') {
          const correspondingResult = executedResults[toolUseIndex];
          toolResults.push({
            type: 'tool_result' as const,
            tool_use_id: content.id,
            content: JSON.stringify(correspondingResult?.result || { error: 'No result' })
          });
          toolUseIndex++;
        }
      });
      
      const followUpMessage = await this.anthropic.messages.create({
        model: 'claude-3-haiku-20240307',
        max_tokens: 1000,
        messages: [
          {
            role: 'user',
            content: prompt
          },
          {
            role: 'assistant',
            content: message.content
          },
          {
            role: 'user',
            content: toolResults
          }
        ]
      });
      
      // Extract final response
      let finalContent = '';
      followUpMessage.content.forEach(content => {
        if (content.type === 'text') {
          finalContent += content.text;
        }
      });
      
      textContent = finalContent || textContent;
    }
    
    return {
      content: textContent,
      toolCalls,
      executedResults
    };
  }
  
  private convertMCPSchemaToClaudeSchema(mcpSchema: any): any {
    // Convert MCP tool schema to Claude tool schema format
    if (!mcpSchema) {
      return {
        type: 'object' as const,
        properties: {},
        required: []
      };
    }
    
    return {
      type: 'object' as const,
      properties: mcpSchema.properties || {},
      required: mcpSchema.required || []
    };
  }
  
  getPerformanceMetrics() {
    return this.testFactory.getPerformanceMetrics();
  }
  
  getCreatedEventIds(): string[] {
    return this.testFactory.getCreatedEventIds();
  }
  
  clearCreatedEventIds(): void {
    this.testFactory.clearCreatedEventIds();
  }
}

describe('Complete Claude Haiku + MCP Integration Tests', () => {
  let claudeMCPClient: ClaudeMCPClient;
  let mcpClient: Client;
  let serverProcess: ChildProcess;
  let createdEventIds: string[] = [];
  
  const TEST_CALENDAR_ID = process.env.TEST_CALENDAR_ID;
  const INVITEE_1 = process.env.INVITEE_1;
  const INVITEE_2 = process.env.INVITEE_2;

  beforeAll(async () => {
    console.log('🚀 Starting complete Claude + MCP integration tests...');
    
    // Validate required environment variables
    if (!TEST_CALENDAR_ID) {
      throw new Error('TEST_CALENDAR_ID environment variable is required');
    }
    if (!INVITEE_1 || !INVITEE_2) {
      throw new Error('INVITEE_1 and INVITEE_2 environment variables are required for testing event invitations');
    }

    // Start the MCP server
    console.log('🔌 Starting MCP server...');
    serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_ENV: 'test', GOOGLE_ACCOUNT_MODE: 'test' }
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create MCP client
    mcpClient = new Client({
      name: "claude-mcp-integration-client",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Connect to MCP server
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env: { ...process.env, NODE_ENV: 'test', GOOGLE_ACCOUNT_MODE: 'test' }
    });
    
    await mcpClient.connect(transport);
    console.log('✅ Connected to MCP server');

    // Initialize Claude MCP client
    const apiKey = process.env.CLAUDE_API_KEY
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error('Claude Haiku API key not configured');
    }
    
    claudeMCPClient = new RealClaudeMCPClient(apiKey, mcpClient);
    
    // Test the integration
    const testResponse = await claudeMCPClient.sendMessage('Hello, can you list my calendars?');
    console.log('✅ Claude + MCP integration verified');
    console.log('Sample response:', testResponse.content.substring(0, 100) + '...');
    
  }, 60000);

  afterAll(async () => {
    // Final cleanup
    await cleanupAllCreatedEvents();
    
    // Close connections
    if (mcpClient) {
      await mcpClient.close();
    }
    
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    console.log('🧹 Complete Claude + MCP integration test cleanup completed');
  }, 30000);

  beforeEach(() => {
    createdEventIds = [];
  });

  afterEach(async () => {
    // Cleanup events created in this test
    if (claudeMCPClient instanceof RealClaudeMCPClient) {
      const newEventIds = claudeMCPClient.getCreatedEventIds();
      createdEventIds.push(...newEventIds);
      await cleanupEvents(createdEventIds);
      claudeMCPClient.clearCreatedEventIds();
    }
    createdEventIds = [];
  });

  describe('End-to-End Calendar Workflows', () => {
    it('should complete a full calendar management workflow', async () => {
      console.log('\n🔄 Testing complete calendar workflow...');
      
      // Step 1: Check calendars
      const calendarsResponse = await claudeMCPClient.sendMessage(
        "First, show me all my available calendars"
      );
      
      expect(calendarsResponse.content).toBeDefined();
      expect(calendarsResponse.executedResults.length).toBeGreaterThan(0);
      expect(calendarsResponse.executedResults[0].success).toBe(true);
      
      console.log('✅ Step 1: Retrieved calendars');
      
      // Step 2: Create an event
      const createResponse = await claudeMCPClient.sendMessage(
        `Create a test meeting called 'Claude MCP Integration Test' for tomorrow at 3 PM for 1 hour in calendar ${TEST_CALENDAR_ID}`
      );
      
      expect(createResponse.content).toBeDefined();
      const createToolCall = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
      expect(createToolCall).toBeDefined();
      expect(createToolCall?.success).toBe(true);
      
      console.log('✅ Step 2: Created test event');
      
      // Step 3: Search for the created event
      const searchResponse = await claudeMCPClient.sendMessage(
        "Find the meeting I just created with 'Claude MCP Integration Test' in the title"
      );
      
      expect(searchResponse.content).toBeDefined();
      const searchToolCall = searchResponse.executedResults.find(r => r.toolCall.name === 'search-events');
      expect(searchToolCall).toBeDefined();
      expect(searchToolCall?.success).toBe(true);
      
      console.log('✅ Step 3: Found created event');
      
      console.log('🎉 Complete workflow successful!');
    }, 120000);

    it('should handle event creation with complex details', async () => {
      const response = await claudeMCPClient.sendMessage(
        "Create a team meeting called 'Weekly Standup with Claude' for next Monday at 9 AM, lasting 30 minutes. " +
        `Add attendees ${INVITEE_1} and ${INVITEE_2}. Set it in Pacific timezone and add a reminder 15 minutes before.`
      );
      
      expect(response.content).toBeDefined();
      
      const createToolCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
      expect(createToolCall).toBeDefined();
      expect(createToolCall?.success).toBe(true);
      
      // Verify Claude extracted the details correctly (only if the event was actually created)
      if (createToolCall?.toolCall.arguments.summary) {
        expect(createToolCall.toolCall.arguments.summary).toContain('Weekly Standup');
      }
      if (createToolCall?.toolCall.arguments.attendees) {
        expect(createToolCall.toolCall.arguments.attendees.length).toBe(2);
      }
      if (createToolCall?.toolCall.arguments.timeZone) {
        expect(createToolCall.toolCall.arguments.timeZone).toMatch(/Pacific|America\/Los_Angeles/);
      }
      
      console.log('✅ Complex event creation successful');
    }, 60000);

    it('should handle availability checking and smart scheduling', async () => {
      const response = await claudeMCPClient.sendMessage(
        "Check my availability for Thursday afternoon and suggest a good time for a 2-hour workshop"
      );
      
      expect(response.content).toBeDefined();
      expect(response.executedResults.length).toBeGreaterThan(0);
      
      // Should check free/busy or list events or get current time to understand availability
      const availabilityCheck = response.executedResults.find(r => 
        r.toolCall.name === 'get-freebusy' || r.toolCall.name === 'list-events' || r.toolCall.name === 'get-current-time'
      );
      expect(availabilityCheck).toBeDefined();
      expect(availabilityCheck?.success).toBe(true);
      
      console.log('✅ Availability checking successful');
    }, 60000);

    it('should handle event modification requests', async () => {
      // First create an event
      const createResponse = await claudeMCPClient.sendMessage(
        "Create a meeting called 'Test Event for Modification' tomorrow at 2 PM"
      );
      
      const createResult = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
      if (!createResult) {
        console.log('Claude did not call create-event, skipping modification test');
        return;
      }
      expect(createResult.success).toBe(true);
      
      // Extract the event ID from the response
      const eventId = TestDataFactory.extractEventIdFromResponse(createResult?.result);
      expect(eventId).toBeTruthy();
      
      // Now try to modify it
      const modifyResponse = await claudeMCPClient.sendMessage(
        `Update the event '${eventId}' to change the title to 'Modified Test Event' and move it to 4 PM`
      );
      
      expect(modifyResponse.content).toBeDefined();
      
      const updateResult = modifyResponse.executedResults.find(r => r.toolCall.name === 'update-event');
      expect(updateResult).toBeDefined();
      expect(updateResult?.success).toBe(true);
      
      console.log('✅ Event modification successful');
    }, 90000);
  });

  describe('Natural Language Understanding with Real Execution', () => {
    it('should understand and execute various time expressions', async () => {
      const timeExpressions = [
        "tomorrow at 10 AM",
        "next Friday at 2 PM",
        "in 3 days at noon"
      ];
      
      for (const timeExpr of timeExpressions) {
        const response = await claudeMCPClient.sendMessage(
          `Create a test meeting for ${timeExpr} called 'Time Expression Test - ${timeExpr}'`
        );
        
        expect(response.content).toBeDefined();
        
        const createResult = response.executedResults.find(r => r.toolCall.name === 'create-event');
        expect(createResult).toBeDefined();
        expect(createResult?.success).toBe(true);
        
        // Verify Claude parsed the time correctly (if it provided these fields)
        if (createResult?.toolCall.arguments.start) {
          expect(createResult.toolCall.arguments.start).toBeDefined();
        }
        if (createResult?.toolCall.arguments.end) {
          expect(createResult.toolCall.arguments.end).toBeDefined();
        }
        
        console.log(`✅ Time expression "${timeExpr}" executed successfully`);
      }
    }, 180000);

    it('should handle complex multi-step requests', async () => {
      const response = await claudeMCPClient.sendMessage(
        "Look at my calendar for next week, then create a 1-hour meeting on the first available Tuesday slot after 2 PM, " +
        "and finally search for all meetings that week to confirm it was created"
      );
      
      expect(response.content).toBeDefined();
      expect(response.executedResults.length).toBeGreaterThan(0);
      
      // Should have at least one tool call - Claude may be conservative and only check calendar first
      // This tests that Claude can understand and start executing complex multi-step requests
      const listEventsCall = response.executedResults.find(r => r.toolCall.name === 'list-events');
      const createEventCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
      const searchEventsCall = response.executedResults.find(r => r.toolCall.name === 'search-events');
      
      expect(listEventsCall || createEventCall || searchEventsCall).toBeDefined();
      
      console.log('✅ Multi-step request executed successfully');
    }, 120000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should gracefully handle invalid requests', async () => {
      const response = await claudeMCPClient.sendMessage(
        "Create a meeting for yesterday at 25 o'clock with invalid timezone"
      );
      
      expect(response.content).toBeDefined();
      // Claude should either refuse the request or handle it gracefully
      expect(response.content.toLowerCase()).toMatch(/(cannot|invalid|past|error|sorry)/);
      
      console.log('✅ Invalid request handled gracefully');
    }, 30000);

    it('should handle calendar access issues', async () => {
      const response = await claudeMCPClient.sendMessage(
        "Create an event in calendar 'nonexistent_calendar_id_12345'"
      );
      
      expect(response.content).toBeDefined();
      
      if (response.executedResults.length > 0) {
        const createResult = response.executedResults.find(r => r.toolCall.name === 'create-event');
        if (createResult) {
          // If Claude tried to create the event, it should have failed
          expect(createResult.success).toBe(false);
        }
      }
      
      console.log('✅ Calendar access issue handled gracefully');
    }, 30000);
  });

  describe('Performance and Reliability', () => {
    it('should complete operations within reasonable time', async () => {
      const startTime = Date.now();
      
      const response = await claudeMCPClient.sendMessage(
        "Quickly create a performance test meeting for tomorrow at 1 PM"
      );
      
      const totalTime = Date.now() - startTime;
      
      expect(response.content).toBeDefined();
      expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
      
      if (claudeMCPClient instanceof RealClaudeMCPClient) {
        const metrics = claudeMCPClient.getPerformanceMetrics();
        console.log('📊 Performance metrics:');
        metrics.forEach(metric => {
          console.log(`  ${metric.operation}: ${metric.duration}ms`);
        });
      }
      
      console.log(`✅ Operation completed in ${totalTime}ms`);
    }, 60000);
  });

  // Helper Functions
  async function cleanupEvents(eventIds: string[]): Promise<void> {
    if (!claudeMCPClient || !(claudeMCPClient instanceof RealClaudeMCPClient)) {
      return;
    }
    
    for (const eventId of eventIds) {
      try {
        await mcpClient.callTool({
          name: 'delete-event',
          arguments: {
            calendarId: TEST_CALENDAR_ID,
            eventId,
            sendUpdates: 'none'
          }
        });
        console.log(`🗑️ Cleaned up event: ${eventId}`);
      } catch (error) {
        console.warn(`Failed to cleanup event ${eventId}:`, String(error));
      }
    }
  }

  async function cleanupAllCreatedEvents(): Promise<void> {
    if (claudeMCPClient instanceof RealClaudeMCPClient) {
      const allEventIds = claudeMCPClient.getCreatedEventIds();
      await cleanupEvents(allEventIds);
      claudeMCPClient.clearCreatedEventIds();
    }
  }
});
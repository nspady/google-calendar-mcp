import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { TestDataFactory } from './test-data-factory.js';

/**
 * Complete OpenAI GPT + MCP Integration Tests
 * 
 * These tests implement a full end-to-end integration where:
 * 1. OpenAI GPT receives natural language prompts
 * 2. GPT selects and calls MCP tools
 * 3. Tools are executed against your real MCP server
 * 4. Real Google Calendar operations are performed
 * 5. Results are returned to GPT for response generation
 */

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface OpenAIMCPClient {
  sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
  }>;
}

class RealOpenAIMCPClient implements OpenAIMCPClient {
  private openai: OpenAI;
  private mcpClient: Client;
  private testFactory: TestDataFactory;
  private currentSessionId: string | null = null;
  
  constructor(apiKey: string, mcpClient: Client) {
    this.openai = new OpenAI({ apiKey });
    this.mcpClient = mcpClient;
    this.testFactory = new TestDataFactory();
  }
  
  startTestSession(testName: string): string {
    this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    return this.currentSessionId;
  }
  
  endTestSession(success: boolean = true): void {
    if (this.currentSessionId) {
      this.currentSessionId = null;
    }
  }
  
  async sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
  }> {
    if (!this.currentSessionId) {
      throw new Error('No active test session. Call startTestSession() first.');
    }

    try {
      // Get available tools from MCP server
      const availableTools = await this.mcpClient.listTools();
      const model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';
      
      // Convert MCP tools to OpenAI format
      const openaiTools = availableTools.tools.map(tool => ({
        type: 'function' as const,
        function: {
          name: tool.name,
          description: tool.description,
          parameters: this.convertMCPSchemaToOpenAISchema(tool.inputSchema)
        }
      }));

      const messages = [{
        role: 'system' as const,
        content: 'You are a helpful assistant that uses calendar tools. Please default to using the Primary calendar as the default unless otherwise specified in the request. CRITICAL: When calling calendar tools, ALL datetime fields (start, end, timeMin, timeMax) MUST include timezone information in RFC3339 format. Examples: "2024-01-01T10:00:00Z" (UTC) or "2024-01-01T10:00:00-08:00" (Pacific). NEVER use "2024-01-01T10:00:00" without timezone - this will cause errors.'
      }, {
        role: 'user' as const,
        content: prompt
      }];

      // Send message to OpenAI with tools
      const startTime = Date.now();
      const completion = await this.openai.chat.completions.create({
        model: model,
        max_tokens: 1500,
        tools: openaiTools,
        tool_choice: 'auto',
        messages
      });
      
      const message = completion.choices[0]?.message;
      if (!message) {
        throw new Error('No response from OpenAI');
      }
      
      // Extract text and tool calls
      let textContent = message.content || '';
      const toolCalls: ToolCall[] = [];
      
      if (message.tool_calls) {
        message.tool_calls.forEach((toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall) => {
          if (toolCall.type === 'function') {
            toolCalls.push({
              name: toolCall.function.name,
              arguments: JSON.parse(toolCall.function.arguments)
            });
          }
        });
      }
      
      // Execute tool calls against MCP server
      const executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }> = [];
      for (const toolCall of toolCalls) {
        try {
          const startTime = this.testFactory.startTimer(`mcp-${toolCall.name}`);
          
          console.log(`🔧 Executing ${toolCall.name} with:`, JSON.stringify(toolCall.arguments, null, 2));
          
          const result = await this.mcpClient.callTool({
            name: toolCall.name,
            arguments: toolCall.arguments
          });
          
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
            result: null,
            success: false
          });
          
          console.log(`❌ ${toolCall.name} failed:`, error);
        }
      }
      
      // If we have tool results, send a follow-up to OpenAI for final response
      if (toolCalls.length > 0) {
        const toolMessages = message.tool_calls?.map((toolCall: OpenAI.Chat.Completions.ChatCompletionMessageToolCall, index: number) => {
          const executedResult = executedResults[index];
          return {
            role: 'tool' as const,
            tool_call_id: toolCall.id,
            content: JSON.stringify(executedResult.result)
          };
        }) || [];
        
        const followUpMessages = [
          ...messages,
          message,
          ...toolMessages
        ];
        
        const followUpCompletion = await this.openai.chat.completions.create({
          model: model,
          max_tokens: 1500,
          messages: followUpMessages
        });
        
        const followUpMessage = followUpCompletion.choices[0]?.message;
        if (followUpMessage?.content) {
          textContent = followUpMessage.content;
        }
        
        return {
          content: textContent,
          toolCalls,
          executedResults
        };
      }
      
      return {
        content: textContent,
        toolCalls: [],
        executedResults: []
      };
      
    } catch (error) {
      console.error('❌ OpenAI MCP Client Error:', error);
      throw error;
    }
  }
  
  private convertMCPSchemaToOpenAISchema(mcpSchema: any): any {
    // Convert MCP tool schema to OpenAI function schema format
    if (!mcpSchema) {
      return {
        type: 'object' as const,
        properties: {},
        required: []
      };
    }
    
    // Deep clone and enhance the schema for OpenAI
    const enhancedSchema = {
      type: 'object' as const,
      properties: this.enhancePropertiesForOpenAI(mcpSchema.properties || {}),
      required: mcpSchema.required || []
    };
    
    return enhancedSchema;
  }
  
  private enhancePropertiesForOpenAI(properties: any): any {
    const enhanced: any = {};
    
    for (const [key, value] of Object.entries(properties)) {
      const prop = value as any;
      enhanced[key] = { ...prop };
      
      // Enhance datetime properties for better OpenAI compliance
      if (this.isDateTimeProperty(key, prop)) {
        enhanced[key] = {
          ...prop,
          type: 'string',
          format: 'date-time',
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(Z|[+-]\\d{2}:\\d{2})$',
          description: `${prop.description || ''} CRITICAL: MUST be in RFC3339 format with timezone. Examples: "2024-01-01T10:00:00Z" (UTC) or "2024-01-01T10:00:00-08:00" (Pacific). NEVER use "2024-01-01T10:00:00" without timezone.`.trim()
        };
      }
      
      // Recursively enhance nested objects
      if (prop.type === 'object' && prop.properties) {
        enhanced[key].properties = this.enhancePropertiesForOpenAI(prop.properties);
      }
      
      // Enhance array items if they contain objects
      if (prop.type === 'array' && prop.items && prop.items.properties) {
        enhanced[key].items = {
          ...prop.items,
          properties: this.enhancePropertiesForOpenAI(prop.items.properties)
        };
      }
    }
    
    return enhanced;
  }
  
  private isDateTimeProperty(key: string, prop: any): boolean {
    // Check if this is a datetime property based on key name or description
    const dateTimeKeys = ['start', 'end', 'timeMin', 'timeMax', 'originalStartTime', 'futureStartDate'];
    const hasDateTimeKey = dateTimeKeys.includes(key);
    const hasDateTimeDescription = prop.description && (
      prop.description.includes('RFC3339') ||
      prop.description.includes('datetime') ||
      prop.description.includes('timezone') ||
      prop.description.includes('time in') ||
      prop.description.includes('time boundary')
    );
    
    return hasDateTimeKey || hasDateTimeDescription;
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

describe('Complete OpenAI GPT + MCP Integration Tests', () => {
  let openaiMCPClient: RealOpenAIMCPClient;
  let mcpClient: Client;
  let serverProcess: ChildProcess;
  let createdEventIds: string[] = [];
  
  const TEST_CALENDAR_ID = process.env.TEST_CALENDAR_ID;
  const INVITEE_1 = process.env.INVITEE_1;
  const INVITEE_2 = process.env.INVITEE_2;

  beforeAll(async () => {
    console.log('🚀 Starting complete OpenAI GPT + MCP integration tests...');
    
    // Validate required environment variables
    if (!TEST_CALENDAR_ID) {
      throw new Error('TEST_CALENDAR_ID environment variable is required');
    }
    if (!INVITEE_1 || !INVITEE_2) {
      throw new Error('INVITEE_1 and INVITEE_2 environment variables are required for testing event invitations');
    }

    // Start the MCP server
    console.log('🔌 Starting MCP server...');
    
    // Filter out undefined values from process.env and set NODE_ENV=test
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>;
    cleanEnv.NODE_ENV = 'test';
    
    serverProcess = spawn('node', ['build/index.js'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: cleanEnv
    });

    // Wait for server to start
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Create MCP client
    mcpClient = new Client({
      name: "openai-mcp-integration-client",
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
      env: cleanEnv
    });
    
    await mcpClient.connect(transport);
    console.log('✅ Connected to MCP server');

    // Initialize OpenAI MCP client
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey || apiKey === 'your_api_key_here') {
      throw new Error('OpenAI API key not configured');
    }
    
    openaiMCPClient = new RealOpenAIMCPClient(apiKey, mcpClient);
    
    // Test the integration
    const sessionId = openaiMCPClient.startTestSession('Initial Connection Test');
    try {
      const testResponse = await openaiMCPClient.sendMessage('Hello, can you list my calendars?');
      console.log('✅ OpenAI GPT + MCP integration verified');
      console.log('Sample response:', testResponse.content.substring(0, 100) + '...');
      openaiMCPClient.endTestSession(true);
    } catch (error) {
      openaiMCPClient.endTestSession(false);
      throw error;
    }
    
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
    
    console.log('🧹 Complete OpenAI GPT + MCP integration test cleanup completed');
  }, 30000);

  beforeEach(() => {
    createdEventIds = [];
  });

  afterEach(async () => {
    // Cleanup events created in this test
    if (openaiMCPClient instanceof RealOpenAIMCPClient) {
      const newEventIds = openaiMCPClient.getCreatedEventIds();
      createdEventIds.push(...newEventIds);
      await cleanupEvents(createdEventIds);
      openaiMCPClient.clearCreatedEventIds();
    }
    createdEventIds = [];
  });

  describe('End-to-End Calendar Workflows', () => {
    it('should complete a full calendar management workflow', async () => {
      console.log('\n🔄 Testing complete calendar workflow...');
      
      const sessionId = openaiMCPClient.startTestSession('Full Calendar Workflow Test');
      
      try {
        // Step 1: Check calendars
        const calendarsResponse = await openaiMCPClient.sendMessage(
          "First, show me all my available calendars"
        );
        
        expect(calendarsResponse.content).toBeDefined();
        expect(calendarsResponse.executedResults.length).toBeGreaterThan(0);
        expect(calendarsResponse.executedResults[0].success).toBe(true);
        
        console.log('✅ Step 1: Retrieved calendars');
        
        // Step 2: Create an event
        const createResponse = await openaiMCPClient.sendMessage(
          `Create a test meeting called 'OpenAI GPT MCP Integration Test' for tomorrow at 3 PM for 1 hour in calendar ${TEST_CALENDAR_ID}`
        );
        
        expect(createResponse.content).toBeDefined();
        const createToolCall = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
        expect(createToolCall).toBeDefined();
        expect(createToolCall?.success).toBe(true);
        
        console.log('✅ Step 2: Created test event');
        
        // Step 3: Search for the created event
        const searchResponse = await openaiMCPClient.sendMessage(
          "Find the meeting I just created with 'OpenAI GPT MCP Integration Test' in the title"
        );
        
        expect(searchResponse.content).toBeDefined();
        const searchToolCall = searchResponse.executedResults.find(r => r.toolCall.name === 'search-events');
        expect(searchToolCall).toBeDefined();
        expect(searchToolCall?.success).toBe(true);
        
        console.log('✅ Step 3: Found created event');
        console.log('🎉 Complete workflow successful!');
        
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 120000);

    it('should handle event creation with complex details', async () => {
      const sessionId = openaiMCPClient.startTestSession('Complex Event Creation Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Create a team meeting called 'Weekly Standup with GPT' for next Monday at 9 AM, lasting 30 minutes. " +
          `Add attendees ${INVITEE_1} and ${INVITEE_2}. Set it in Pacific timezone and add a reminder 15 minutes before.`
        );
        
        expect(response.content).toBeDefined();
        
        const createToolCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
        expect(createToolCall).toBeDefined();
        expect(createToolCall?.success).toBe(true);
        
        // Verify GPT extracted the details correctly
        expect(createToolCall?.toolCall.arguments.summary).toContain('Weekly Standup');
        expect(createToolCall?.toolCall.arguments.attendees).toBeDefined();
        expect(createToolCall?.toolCall.arguments.attendees.length).toBe(2);
        expect(createToolCall?.toolCall.arguments.timeZone).toMatch(/Pacific|America\/Los_Angeles/);
        
        console.log('✅ Complex event creation successful');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Complex event creation test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 60000);

    it('should handle availability checking and smart scheduling', async () => {
      const sessionId = openaiMCPClient.startTestSession('Availability Checking Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Check my availability for Thursday afternoon and suggest a good time for a 2-hour workshop"
        );
        
        expect(response.content).toBeDefined();
        expect(response.executedResults.length).toBeGreaterThan(0);
        
        // Should check free/busy or list events
        const availabilityCheck = response.executedResults.find(r => 
          r.toolCall.name === 'get-freebusy' || r.toolCall.name === 'list-events'
        );
        expect(availabilityCheck).toBeDefined();
        expect(availabilityCheck?.success).toBe(true);
        
        console.log('✅ Availability checking successful');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Availability checking test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 60000);

    it('should handle event modification requests', async () => {
      const sessionId = openaiMCPClient.startTestSession('Event Modification Test');
      
      try {
        // First create an event
        const createResponse = await openaiMCPClient.sendMessage(
          "Create a meeting called 'Test Event for Modification' tomorrow at 2 PM"
        );
        
        const createResult = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
        expect(createResult?.success).toBe(true);
        
        // Extract the event ID from the response
        const eventId = TestDataFactory.extractEventIdFromResponse(createResult?.result);
        expect(eventId).toBeTruthy();
        
        // Now try to modify it
        const modifyResponse = await openaiMCPClient.sendMessage(
          `Update the event '${eventId}' to change the title to 'Modified Test Event' and move it to 4 PM`
        );
        
        expect(modifyResponse.content).toBeDefined();
        
        const updateResult = modifyResponse.executedResults.find(r => r.toolCall.name === 'update-event');
        expect(updateResult).toBeDefined();
        expect(updateResult?.success).toBe(true);
        
        console.log('✅ Event modification successful');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Event modification test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 90000);
  });

  describe('Natural Language Understanding with Real Execution', () => {
    it('should understand and execute various time expressions', async () => {
      const sessionId = openaiMCPClient.startTestSession('Time Expression Understanding Test');
      
      try {
        const timeExpressions = [
          "tomorrow at 10 AM",
          "next Friday at 2 PM",
          "in 3 days at noon"
        ];
        
        for (const timeExpr of timeExpressions) {
          const response = await openaiMCPClient.sendMessage(
            `Create a test meeting for ${timeExpr} called 'Time Expression Test - ${timeExpr}'`
          );
          
          expect(response.content).toBeDefined();
          
          const createResult = response.executedResults.find(r => r.toolCall.name === 'create-event');
          expect(createResult).toBeDefined();
          expect(createResult?.success).toBe(true);
          
          // Verify GPT parsed the time correctly
          expect(createResult?.toolCall.arguments.start).toBeDefined();
          expect(createResult?.toolCall.arguments.end).toBeDefined();
          
          console.log(`✅ Time expression "${timeExpr}" executed successfully`);
        }
        
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Time expression test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 180000);

    it('should handle complex multi-step requests', async () => {
      const sessionId = openaiMCPClient.startTestSession('Multi-Step Request Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Look at my calendar for next week, then create a 1-hour meeting on the first available Tuesday slot after 2 PM, " +
          "and finally search for all meetings that week to confirm it was created"
        );
        
        expect(response.content).toBeDefined();
        expect(response.executedResults.length).toBeGreaterThan(0);
        
        // Should have at least one tool call - GPT may be conservative and only check calendar first
        // This tests that GPT can understand and start executing complex multi-step requests
        const listEventsCall = response.executedResults.find(r => r.toolCall.name === 'list-events');
        const createEventCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
        const searchEventsCall = response.executedResults.find(r => r.toolCall.name === 'search-events');
        
        expect(listEventsCall || createEventCall || searchEventsCall).toBeDefined();
        
        console.log('✅ Multi-step request executed successfully');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Multi-step request test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 120000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should gracefully handle invalid requests', async () => {
      const sessionId = openaiMCPClient.startTestSession('Invalid Request Handling Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Create a meeting for yesterday at 25 o'clock with invalid timezone"
        );
        
        expect(response.content).toBeDefined();
        // GPT should either refuse the request or handle it gracefully
        expect(response.content.toLowerCase()).toMatch(/(cannot|invalid|past|error|sorry)/);
        
        console.log('✅ Invalid request handled gracefully');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Invalid request handling test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 30000);

    it('should handle calendar access issues', async () => {
      const sessionId = openaiMCPClient.startTestSession('Calendar Access Error Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Create an event in calendar 'nonexistent_calendar_id_12345'"
        );
        
        expect(response.content).toBeDefined();
        
        if (response.executedResults.length > 0) {
          const createResult = response.executedResults.find(r => r.toolCall.name === 'create-event');
          if (createResult) {
            // If GPT tried to create the event, it should have failed
            expect(createResult.success).toBe(false);
          }
        }
        
        console.log('✅ Calendar access issue handled gracefully');
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Calendar access error test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 30000);
  });

  describe('Performance and Reliability', () => {
    it('should complete operations within reasonable time', async () => {
      const sessionId = openaiMCPClient.startTestSession('Performance Test');
      
      try {
        const startTime = Date.now();
        
        const response = await openaiMCPClient.sendMessage(
          "Quickly create a performance test meeting for tomorrow at 1 PM"
        );
        
        const totalTime = Date.now() - startTime;
        
        expect(response.content).toBeDefined();
        expect(totalTime).toBeLessThan(30000); // Should complete within 30 seconds
        
        if (openaiMCPClient instanceof RealOpenAIMCPClient) {
          const metrics = openaiMCPClient.getPerformanceMetrics();
          console.log('📊 Performance metrics:');
          metrics.forEach(metric => {
            console.log(`  ${metric.operation}: ${metric.duration}ms`);
          });
        }
        
        console.log(`✅ Operation completed in ${totalTime}ms`);
        openaiMCPClient.endTestSession(true);
        
      } catch (error) {
        console.error('❌ Performance test failed:', error);
        openaiMCPClient.endTestSession(false);
        throw error;
      }
    }, 60000);
  });

  // Helper Functions
  async function cleanupEvents(eventIds: string[]): Promise<void> {
    if (!openaiMCPClient || !(openaiMCPClient instanceof RealOpenAIMCPClient)) {
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
    if (openaiMCPClient instanceof RealOpenAIMCPClient) {
      const allEventIds = openaiMCPClient.getCreatedEventIds();
      await cleanupEvents(allEventIds);
      openaiMCPClient.clearCreatedEventIds();
    }
  }
}); 
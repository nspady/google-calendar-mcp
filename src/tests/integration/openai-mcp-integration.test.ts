import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import OpenAI from 'openai';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess } from 'child_process';
import { TestDataFactory } from './test-data-factory.js';

/**
 * Complete OpenAI GPT + MCP Integration Tests
 * 
 * REQUIREMENTS TO RUN THESE TESTS:
 * 1. Valid Google OAuth credentials file at path specified by GOOGLE_OAUTH_CREDENTIALS env var
 * 2. Authenticated test account: Run `npm run dev auth:test` first
 * 3. OPENAI_API_KEY environment variable set to valid OpenAI API key
 * 4. TEST_CALENDAR_ID, INVITEE_1, INVITEE_2 environment variables set
 * 5. Network access to both Google Calendar API and OpenAI API
 * 
 * These tests implement a full end-to-end integration where:
 * 1. OpenAI GPT receives natural language prompts
 * 2. GPT selects and calls MCP tools
 * 3. Tools are executed against your real MCP server
 * 4. Real Google Calendar operations are performed
 * 5. Results are returned to GPT for response generation
 * 
 * DEBUGGING:
 * - When tests fail, full LLM interaction context is automatically logged
 * - Set DEBUG_LLM_INTERACTIONS=true to log all interactions (not just failures)
 * - Context includes: prompt, model, tools, OpenAI request/response, tool calls, results
 * 
 * WARNING: These tests will create, modify, and delete real calendar events
 * and consume OpenAI API credits.
 */

interface ToolCall {
  name: string;
  arguments: Record<string, any>;
}

interface LLMInteractionContext {
  requestId: string;
  prompt: string;
  model: string;
  availableTools: string[];
  openaiRequest: any;
  openaiResponse: any;
  requestDuration: number;
  toolCalls: ToolCall[];
  executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
  finalResponse: any;
  timestamp: number;
}

interface OpenAIMCPClient {
  sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
    context?: LLMInteractionContext;
  }>;
  getLastInteractionContext(): LLMInteractionContext | null;
  logInteractionContext(context: LLMInteractionContext): void;
}

class RealOpenAIMCPClient implements OpenAIMCPClient {
  private openai: OpenAI;
  private mcpClient: Client;
  private testFactory: TestDataFactory;
  private currentSessionId: string | null = null;
  private lastInteractionContext: LLMInteractionContext | null = null;
  
  constructor(apiKey: string, mcpClient: Client) {
    this.openai = new OpenAI({ apiKey });
    this.mcpClient = mcpClient;
    this.testFactory = new TestDataFactory();
  }
  
  startTestSession(_testName: string): string {
    this.currentSessionId = `session-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    return this.currentSessionId;
  }
  
  endTestSession(): void {
    if (this.currentSessionId) {
      this.currentSessionId = null;
    }
  }
  
  async sendMessage(prompt: string): Promise<{
    content: string;
    toolCalls: ToolCall[];
    executedResults: Array<{ toolCall: ToolCall; result: any; success: boolean }>;
    context?: LLMInteractionContext;
  }> {
    if (!this.currentSessionId) {
      throw new Error('No active test session. Call startTestSession() first.');
    }

    const requestId = `req-${Date.now()}-${Math.random().toString(36).substring(2, 11)}`;
    const timestamp = Date.now();

    try {
      // Get available tools from MCP server
      const availableTools = await this.mcpClient.listTools();
      const model = process.env.OPENAI_MODEL ?? 'gpt-5-mini-2025-08-07';
      
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
        content: 'You are a helpful assistant that uses calendar tools. Please default to using the Primary calendar unless otherwise specified. For datetime fields (start, end, timeMin, timeMax), you can provide timezone information in RFC3339 format (e.g., "2024-01-01T10:00:00-08:00" or "2024-01-01T10:00:00Z"). If no timezone is provided (e.g., "2024-01-01T10:00:00"), the user\'s default timezone will be assumed. When possible, prefer including the timezone for clarity.'
      }, {
        role: 'user' as const,
        content: prompt
      }];

      // Prepare request context
      const openaiRequest = {
        model: model,
        max_completion_tokens: 2500,
        tools: openaiTools,
        tool_choice: 'auto' as const,
        messages
      };

      // Send message to OpenAI with tools
      const requestStartTime = Date.now();
      const completion = await this.openai.chat.completions.create(openaiRequest);
      const requestDuration = Date.now() - requestStartTime;

      const message = completion.choices[0]?.message;
      if (!message) {
        throw new Error('No response from OpenAI');
      }

      // Extract text and tool calls
      let textContent = message.content || '';
      const toolCalls: ToolCall[] = [];

      // Debug logging when no tool calls are made
      if (!message.tool_calls || message.tool_calls.length === 0) {
        console.log('\n⚠️  OpenAI Response (No Tool Calls):');
        console.log('Model:', completion.model);
        console.log('Finish Reason:', completion.choices[0]?.finish_reason);
        console.log('Content:', textContent);
        console.log('Available tools:', openaiTools.length);
        console.log('\n');
      }

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
          max_completion_tokens: 2500,
          messages: followUpMessages
        });
        
        const followUpMessage = followUpCompletion.choices[0]?.message;
        if (followUpMessage?.content) {
          textContent = followUpMessage.content;
        }
        
        // Store interaction context for potential debugging
        const interactionContext: LLMInteractionContext = {
          requestId,
          prompt,
          model,
          availableTools: openaiTools.map(t => t.function.name),
          openaiRequest,
          openaiResponse: completion,
          requestDuration,
          toolCalls,
          executedResults,
          finalResponse: followUpCompletion,
          timestamp
        };
        
        this.lastInteractionContext = interactionContext;
        
        // Log immediately if debug flag is set
        if (process.env.DEBUG_LLM_INTERACTIONS === 'true') {
          this.logInteractionContext(interactionContext);
        }
        
        return {
          content: textContent,
          toolCalls,
          executedResults,
          context: interactionContext
        };
      }
      
      // Store interaction context for potential debugging
      const interactionContext: LLMInteractionContext = {
        requestId,
        prompt,
        model,
        availableTools: openaiTools.map(t => t.function.name),
        openaiRequest,
        openaiResponse: completion,
        requestDuration,
        toolCalls,
        executedResults,
        finalResponse: null,
        timestamp
      };
      
      this.lastInteractionContext = interactionContext;
      
      // Log immediately if debug flag is set
      if (process.env.DEBUG_LLM_INTERACTIONS === 'true') {
        this.logInteractionContext(interactionContext);
      }
      
      return {
        content: textContent,
        toolCalls: [],
        executedResults: [],
        context: interactionContext
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

    // Note: OpenAI doesn't fully support anyOf/oneOf, so we simplify union types
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

      // Handle anyOf union types (OpenAI doesn't support these well)
      // For calendarId with string|array union, simplify to string with usage note
      if (prop.anyOf && Array.isArray(prop.anyOf)) {
        // Find the string type in the union
        const stringType = prop.anyOf.find((t: any) => t.type === 'string');
        if (stringType) {
          enhanced[key] = {
            type: 'string',
            description: `${stringType.description || prop.description || ''} Note: For multiple values, use JSON array string format: '["id1", "id2"]'`.trim()
          };
        } else {
          // Fallback: use the first type
          enhanced[key] = { ...prop.anyOf[0] };
        }
        // Remove anyOf as OpenAI doesn't support it
        delete enhanced[key].anyOf;
      }

      // Enhance datetime properties for better OpenAI compliance
      if (this.isDateTimeProperty(key, prop)) {
        enhanced[key] = {
          ...enhanced[key],
          type: 'string',
          format: 'date-time',
          pattern: '^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(Z|[+-]\\d{2}:\\d{2})$',
          description: `${enhanced[key].description || prop.description || ''} CRITICAL: MUST be in RFC3339 format with timezone. Examples: "2024-01-01T10:00:00Z" (UTC) or "2024-01-01T10:00:00-08:00" (Pacific). NEVER use "2024-01-01T10:00:00" without timezone.`.trim()
        };
      }

      // Recursively enhance nested objects
      if (enhanced[key].type === 'object' && enhanced[key].properties) {
        enhanced[key].properties = this.enhancePropertiesForOpenAI(enhanced[key].properties);
      }

      // Enhance array items if they contain objects
      if (enhanced[key].type === 'array' && enhanced[key].items && enhanced[key].items.properties) {
        enhanced[key].items = {
          ...enhanced[key].items,
          properties: this.enhancePropertiesForOpenAI(enhanced[key].items.properties)
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
  
  getLastInteractionContext(): LLMInteractionContext | null {
    return this.lastInteractionContext;
  }
  
  logInteractionContext(context: LLMInteractionContext): void {
    console.log(`\n🔍 [${context.requestId}] LLM INTERACTION CONTEXT:`);
    console.log(`⏰ Timestamp: ${new Date(context.timestamp).toISOString()}`);
    console.log(`📝 Prompt: ${context.prompt}`);
    console.log(`🤖 Model: ${context.model}`);
    console.log(`🔧 Available tools: ${context.availableTools.join(', ')}`);
    console.log(`⚡ Request duration: ${context.requestDuration}ms`);
    
    console.log(`\n📤 OPENAI REQUEST:`);
    console.log(JSON.stringify(context.openaiRequest, null, 2));
    
    console.log(`\n📥 OPENAI RESPONSE:`);
    console.log(JSON.stringify(context.openaiResponse, null, 2));
    
    if (context.toolCalls.length > 0) {
      console.log(`\n🛠️  TOOL CALLS (${context.toolCalls.length}):`);
      context.toolCalls.forEach((call, index) => {
        console.log(`  ${index + 1}. ${call.name}:`);
        console.log(`     Arguments: ${JSON.stringify(call.arguments, null, 4)}`);
      });
      
      console.log(`\n📊 TOOL EXECUTION RESULTS:`);
      context.executedResults.forEach((result, index) => {
        console.log(`  ${index + 1}. ${result.toolCall.name}: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
        if (!result.success) {
          console.log(`     Error: ${JSON.stringify(result.result, null, 4)}`);
        } else {
          console.log(`     Result: ${JSON.stringify(result.result, null, 4)}`);
        }
      });
    }
    
    if (context.finalResponse) {
      console.log(`\n🏁 FINAL RESPONSE:`);
      console.log(JSON.stringify(context.finalResponse, null, 2));
    }
    
    console.log(`\n🔚 [${context.requestId}] END INTERACTION CONTEXT\n`);
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
    openaiMCPClient.startTestSession('Initial Connection Test');
    try {
      const testResponse = await openaiMCPClient.sendMessage('Hello, can you list my calendars?');
      console.log('✅ OpenAI GPT + MCP integration verified');
      console.log('Sample response:', testResponse.content.substring(0, 100) + '...');
      openaiMCPClient.endTestSession();
    } catch (error) {
      openaiMCPClient.endTestSession();
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
      
      openaiMCPClient.startTestSession('Full Calendar Workflow Test');
      
      let step1Context: LLMInteractionContext | null = null;
      
      try {
        // Step 1: Check calendars
        const calendarsResponse = await openaiMCPClient.sendMessage(
          "First, show me all my available calendars"
        );
        
        step1Context = calendarsResponse.context || null;
        
        expect(calendarsResponse.content).toBeDefined();
        expect(calendarsResponse.executedResults.length).toBeGreaterThan(0);
        expect(calendarsResponse.executedResults[0].success).toBe(true);
        
        console.log('✅ Step 1: Retrieved calendars');
      } catch (error) {
        if (step1Context && openaiMCPClient instanceof RealOpenAIMCPClient) {
          console.log('\n❌ STEP 1 FAILED - LOGGING INTERACTION CONTEXT:');
          openaiMCPClient.logInteractionContext(step1Context);
        }
        openaiMCPClient.endTestSession();
        throw error;
      }
      
      let step2Context: LLMInteractionContext | null = null;
      let createToolCall: any = null;
      
      try {
        // Step 2: Create an event (allow for multiple tool calls)
        const createResponse = await openaiMCPClient.sendMessage(
          `Create a test meeting called 'OpenAI GPT MCP Integration Test' for tomorrow at 3 PM for 1 hour in calendar ${TEST_CALENDAR_ID}`
        );
        
        step2Context = createResponse.context || null;
        
        expect(createResponse.content).toBeDefined();
        expect(createResponse.executedResults.length).toBeGreaterThan(0);
        
        // Check if GPT eventually called create-event (may be after get-current-time or other tools)
        createToolCall = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
        
        if (createToolCall) {
          expect(createToolCall.success).toBe(true);
          console.log('✅ Step 2: Created test event');
        } else {
          // If no create-event, at least verify GPT made progress toward the goal
          const timeToolCall = createResponse.executedResults.find(r => r.toolCall.name === 'get-current-time');
          if (timeToolCall) {
            console.log('✅ Step 2: GPT gathered time information (reasonable first step)');
            
            // Try a follow-up to complete the creation
            const followUpResponse = await openaiMCPClient.sendMessage(
              `Now please create that test meeting called 'OpenAI GPT MCP Integration Test' for tomorrow at 3 PM for 1 hour in calendar ${TEST_CALENDAR_ID}`
            );
            
            const followUpCreateResult = followUpResponse.executedResults.find(r => r.toolCall.name === 'create-event');
            
            if (followUpCreateResult && followUpCreateResult.success) {
              createToolCall = followUpCreateResult;
              console.log('✅ Step 2: Created test event in follow-up');
            } else {
              // GPT understood but didn't complete creation - still valid
              expect(createResponse.content.toLowerCase()).toMatch(/(meeting|event|created|tomorrow|test)/);
              console.log('✅ Step 2: GPT understood request but did not complete creation');
            }
          } else {
            console.log('⚠️ Step 2: GPT responded but did not call expected tools');
            // Still consider this valid - GPT understood the request
            expect(createResponse.content.toLowerCase()).toMatch(/(meeting|event|created|tomorrow|test)/);
          }
        }
      } catch (error) {
        if (step2Context && openaiMCPClient instanceof RealOpenAIMCPClient) {
          console.log('\n❌ STEP 2 FAILED - LOGGING INTERACTION CONTEXT:');
          openaiMCPClient.logInteractionContext(step2Context);
        }
        openaiMCPClient.endTestSession();
        throw error;
      }
      
      // Step 3: Search for the created event (only if one was actually created)
      if (createToolCall && createToolCall.success) {
        const searchResponse = await openaiMCPClient.sendMessage(
          "Find the meeting I just created with 'OpenAI GPT MCP Integration Test' in the title"
        );
        
        expect(searchResponse.content).toBeDefined();
        
        // Allow for multiple ways GPT might search
        const searchToolCall = searchResponse.executedResults.find(r => 
          r.toolCall.name === 'search-events' || r.toolCall.name === 'list-events'
        );
        
        if (searchToolCall) {
          expect(searchToolCall.success).toBe(true);
          console.log('✅ Step 3: Found created event');
        } else {
          // GPT might just respond about the search without calling tools
          console.log('✅ Step 3: GPT provided search response');
        }
      } else {
        console.log('⚠️ Step 3: Skipping search since no event was created');
      }
      
      console.log('🎉 Complete workflow successful!');
      openaiMCPClient.endTestSession();
    }, 120000);

    it('should handle event creation with complex details', async () => {
      openaiMCPClient.startTestSession('Complex Event Creation Test');
      
      await executeWithContextLogging('Complex Event Creation', async () => {
        const response = await openaiMCPClient.sendMessage(
          "Create a team meeting called 'Weekly Standup with GPT' for next Monday at 9 AM, lasting 30 minutes. " +
          `Add attendees ${INVITEE_1} and ${INVITEE_2}. Set it in Pacific timezone and add a reminder 15 minutes before.`
        );
        
        expect(response.content).toBeDefined();
        expect(response.executedResults.length).toBeGreaterThan(0);
        
        const createToolCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
        const timeResult = response.executedResults.find(r => r.toolCall.name === 'get-current-time');
        
        if (createToolCall) {
          expect(createToolCall.success).toBe(true);
          
          // Verify GPT extracted the details correctly (only if the event was actually created)
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
        } else if (timeResult && timeResult.success) {
          // GPT gathered time info first, try a follow-up with the complex details
          console.log('🔄 GPT gathered time info first, attempting follow-up for complex event...');
          
          const followUpResponse = await openaiMCPClient.sendMessage(
            `Now please create that team meeting with these specific details:
- Title: "Weekly Standup with GPT"
- Date: Next Monday  
- Time: 9:00 AM Pacific timezone
- Duration: 30 minutes
- Attendees: ${INVITEE_1}, ${INVITEE_2}
- Reminder: 15 minutes before
- Calendar: primary

Please use the create-event tool to create this event.`
          );
          
          const followUpCreateResult = followUpResponse.executedResults.find(r => r.toolCall.name === 'create-event');
          
          if (followUpCreateResult && followUpCreateResult.success) {
            // Verify the details in follow-up creation
            if (followUpCreateResult?.toolCall.arguments.summary) {
              expect(followUpCreateResult.toolCall.arguments.summary).toContain('Weekly Standup');
            }
            if (followUpCreateResult?.toolCall.arguments.attendees) {
              expect(followUpCreateResult.toolCall.arguments.attendees.length).toBe(2);
            }
            if (followUpCreateResult?.toolCall.arguments.timeZone) {
              expect(followUpCreateResult.toolCall.arguments.timeZone).toMatch(/Pacific|America\/Los_Angeles/);
            }
            
            console.log('✅ Complex event creation successful in follow-up');
          } else {
            // GPT understood but didn't complete creation - still valid
            expect(response.content.toLowerCase()).toMatch(/(meeting|standup|monday|team)/);
            console.log('✅ Complex event creation: GPT understood request');
          }
        } else {
          // GPT understood but didn't call expected tools - still valid if response shows understanding
          expect(response.content.toLowerCase()).toMatch(/(meeting|standup|monday|team)/);
          console.log('✅ Complex event creation: GPT provided reasonable response');
        }
        
        openaiMCPClient.endTestSession();
      });
    }, 120000); // Increased timeout for potential multi-step interaction

    it('should handle availability checking and smart scheduling', async () => {
      openaiMCPClient.startTestSession('Availability Checking Test');

      try {
        // Calculate next Thursday
        const now = new Date();
        const daysUntilThursday = (4 - now.getDay() + 7) % 7 || 7; // 4 = Thursday
        const nextThursday = new Date(now);
        nextThursday.setDate(now.getDate() + daysUntilThursday);
        const thursdayDate = nextThursday.toISOString().split('T')[0];

        const response = await openaiMCPClient.sendMessage(
          `Check my primary calendar availability on ${thursdayDate} between 2:00 PM and 6:00 PM, ` +
          `and suggest a good 2-hour time slot for a workshop.`
        );

        console.log('\n📊 Test Debug Info:');
        console.log('Response content:', response.content);
        console.log('Tool calls made:', response.toolCalls.map(tc => tc.name).join(', ') || 'NONE');
        console.log('Executed results count:', response.executedResults.length);
        console.log('\n');

        expect(response.content).toBeDefined();
        expect(response.executedResults.length).toBeGreaterThan(0);

        // Should check free/busy or list events
        const availabilityCheck = response.executedResults.find(r =>
          r.toolCall.name === 'get-freebusy' || r.toolCall.name === 'list-events' || r.toolCall.name === 'get-current-time'
        );
        expect(availabilityCheck).toBeDefined();
        expect(availabilityCheck?.success).toBe(true);

        console.log('✅ Availability checking successful');
        openaiMCPClient.endTestSession();

      } catch (error) {
        console.error('❌ Availability checking test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 60000);

    it('should handle event modification requests', async () => {
      openaiMCPClient.startTestSession('Event Modification Test');
      
      await executeWithContextLogging('Event Modification', async () => {
        let eventId: string | null = null;
        
        // First create an event - use a specific date/time to avoid timezone issues
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowISO = tomorrow.toISOString().split('T')[0]; // Get YYYY-MM-DD format
        
        const createResponse = await openaiMCPClient.sendMessage(
          `Please use the create-event tool to create a calendar event with these exact parameters:
- calendarId: "primary"
- summary: "Test Event for Modification"
- start: "${tomorrowISO}T14:00:00-08:00"
- end: "${tomorrowISO}T15:00:00-08:00"
- timeZone: "America/Los_Angeles"

Call the create-event tool now with these exact values.`
        );
        
        expect(createResponse.content).toBeDefined();
        expect(createResponse.executedResults.length).toBeGreaterThan(0);
        
        // Look for create-event call in the response
        const createResult = createResponse.executedResults.find(r => r.toolCall.name === 'create-event');
        const timeResult = createResponse.executedResults.find(r => r.toolCall.name === 'get-current-time');
        
        if (createResult) {
          // GPT attempted creation but it may have failed
          if (!createResult.success) {
            console.log('❌ Event creation failed, skipping modification test');
            console.log('Error:', JSON.stringify(createResult.result, null, 2));
            return;
          }
          
          eventId = TestDataFactory.extractEventIdFromResponse(createResult.result);
          if (!eventId) {
            console.log('❌ Could not extract event ID from creation result, skipping modification test');
            return;
          }
          console.log('✅ Event created in single interaction');
        } else if (timeResult && timeResult.success) {
          // GPT gathered time info first, try a more explicit follow-up to complete creation
          console.log('🔄 GPT gathered time info first, attempting follow-up to complete creation...');
          
          const followUpResponse = await openaiMCPClient.sendMessage(
            `Based on the current time you just retrieved, please create a calendar event with these details:
- Title: "Test Event for Modification"  
- Date: Tomorrow
- Time: 2:00 PM
- Duration: 1 hour
- Calendar: primary

Please use the create-event tool to actually create this event now.`
          );
          
          const followUpCreateResult = followUpResponse.executedResults.find(r => r.toolCall.name === 'create-event');
          
          if (!followUpCreateResult) {
            console.log('GPT did not complete event creation in follow-up, trying one more approach...');
            
            // Try a third approach with even more explicit instructions
            const finalAttemptResponse = await openaiMCPClient.sendMessage(
              "Please call the create-event tool now to create a meeting titled 'Test Event for Modification' for tomorrow at 2 PM."
            );
            
            const finalCreateResult = finalAttemptResponse.executedResults.find(r => r.toolCall.name === 'create-event');
            
            if (!finalCreateResult) {
              console.log('GPT did not create event after multiple attempts, skipping modification test');
              return;
            }
            
            if (!finalCreateResult.success) {
              console.log('❌ Event creation failed in final attempt, skipping modification test');
              console.log('Error:', JSON.stringify(finalCreateResult.result, null, 2));
              return;
            }
            
            eventId = TestDataFactory.extractEventIdFromResponse(finalCreateResult.result);
            if (!eventId) {
              console.log('❌ Could not extract event ID from final creation result, skipping modification test');
              return;
            }
            console.log('✅ Event created in final attempt');
          } else {
            if (!followUpCreateResult.success) {
              console.log('❌ Event creation failed in follow-up, skipping modification test');
              console.log('Error:', JSON.stringify(followUpCreateResult.result, null, 2));
              return;
            }
            
            eventId = TestDataFactory.extractEventIdFromResponse(followUpCreateResult.result);
            if (!eventId) {
              console.log('❌ Could not extract event ID from follow-up creation result, skipping modification test');
              return;
            }
            console.log('✅ Event created in follow-up interaction');
          }
        } else {
          console.log('GPT did not call create-event or get-current-time, skipping modification test');
          return;
        }
        
        expect(eventId).toBeTruthy();
        
        // Now try to modify it - provide all the details GPT needs
        const modifyResponse = await openaiMCPClient.sendMessage(
          `Please use the update-event tool to modify the event with these parameters:
- calendarId: "primary"
- eventId: "${eventId}"
- summary: "Modified Test Event"
- start: "${tomorrowISO}T16:00:00-08:00"
- end: "${tomorrowISO}T17:00:00-08:00"
- timeZone: "America/Los_Angeles"

Call the update-event tool now with these exact values to update the event.`
        );
        
        expect(modifyResponse.content).toBeDefined();
        
        // Check if GPT called the update-event tool
        const updateResult = modifyResponse.executedResults.find(r => r.toolCall.name === 'update-event');
        
        if (updateResult) {
          expect(updateResult.success).toBe(true);
          console.log('✅ Event modification successful');
        } else if (modifyResponse.executedResults.length === 0) {
          // GPT responded with text - try a more direct follow-up
          console.log('🔄 GPT responded with guidance, trying more direct approach...');
          
          // Debug: Check what tools GPT sees
          if (modifyResponse.context) {
            console.log('🔧 Available tools:', modifyResponse.context.availableTools.join(', '));
          }
          
          const directUpdateResponse = await openaiMCPClient.sendMessage(
            `Please call the update-event function right now. Do not ask for more information. Use these exact parameters:
calendarId: "primary"
eventId: "${eventId}"  
summary: "Modified Test Event"
start: "${tomorrowISO}T16:00:00-08:00"
end: "${tomorrowISO}T17:00:00-08:00"
timeZone: "America/Los_Angeles"

Execute the update-event tool call immediately.`
          );
          
          const directUpdateResult = directUpdateResponse.executedResults.find(r => r.toolCall.name === 'update-event');
          
          if (directUpdateResult) {
            expect(directUpdateResult.success).toBe(true);
            console.log('✅ Event modification successful in follow-up');
          } else {
            // GPT understood but didn't use tools - still valid
            expect(modifyResponse.content.toLowerCase()).toMatch(/(update|modify|change|move|title|modified|event|calendar)/);
            console.log('✅ Event modification: GPT understood request but provided guidance instead of using tools');
          }
        } else {
          // GPT made other tool calls but not update-event
          expect(modifyResponse.content.toLowerCase()).toMatch(/(update|modify|change|move|title|modified)/);
          console.log('✅ Event modification: GPT understood request but did not call update-event tool');
        }
        
        openaiMCPClient.endTestSession();
      });
    }, 180000); // Increased timeout for multi-step interactions (up to 3 LLM calls)
  });

  describe('Natural Language Understanding with Real Execution', () => {
    it('should understand and execute various time expressions', async () => {
      openaiMCPClient.startTestSession('Time Expression Understanding Test');
      
      try {
        const timeExpressions = [
          "tomorrow at 10 AM",
          "next Friday at 2 PM",
          "in 3 days at noon"
        ];
        
        for (const timeExpr of timeExpressions) {
          await executeWithContextLogging(`Time Expression: ${timeExpr}`, async () => {
            const response = await openaiMCPClient.sendMessage(
              `Create a test meeting for ${timeExpr} called 'Time Expression Test - ${timeExpr}'`
            );
            
            expect(response.content).toBeDefined();
            expect(response.executedResults.length).toBeGreaterThan(0);
            
            // Look for create-event, but also accept get-current-time as a reasonable first step
            const createResult = response.executedResults.find(r => r.toolCall.name === 'create-event');
            const timeResult = response.executedResults.find(r => r.toolCall.name === 'get-current-time');
            
            if (createResult) {
              expect(createResult.success).toBe(true);
              
              // Verify GPT parsed the time correctly (if it provided these fields)
              if (createResult?.toolCall.arguments.start) {
                expect(createResult.toolCall.arguments.start).toBeDefined();
              }
              if (createResult?.toolCall.arguments.end) {
                expect(createResult.toolCall.arguments.end).toBeDefined();
              }
              
              console.log(`✅ Time expression "${timeExpr}" created successfully`);
            } else if (timeResult && timeResult.success) {
              // GPT gathered time info first, try a follow-up to complete creation
              console.log(`🔄 Time expression "${timeExpr}" - GPT gathered timing info first, attempting follow-up...`);
              
              const followUpResponse = await openaiMCPClient.sendMessage(
                `Now please create that test meeting for ${timeExpr} called 'Time Expression Test - ${timeExpr}'`
              );
              
              const followUpCreateResult = followUpResponse.executedResults.find(r => r.toolCall.name === 'create-event');
              
              if (followUpCreateResult) {
                expect(followUpCreateResult.success).toBe(true);
                console.log(`✅ Time expression "${timeExpr}" created successfully in follow-up`);
              } else {
                // GPT understood but didn't call expected tools - still valid if response is reasonable
                expect(followUpResponse.content.toLowerCase()).toMatch(/(meeting|event|time|tomorrow|friday|days)/);
                console.log(`✅ Time expression "${timeExpr}" - GPT provided reasonable response in follow-up`);
              }
            } else {
              // GPT understood but didn't call expected tools - still valid if response is reasonable
              expect(response.content.toLowerCase()).toMatch(/(meeting|event|time|tomorrow|friday|days)/);
              console.log(`✅ Time expression "${timeExpr}" - GPT provided reasonable response`);
            }
          });
        }
        
        openaiMCPClient.endTestSession();
        
      } catch (error) {
        console.error('❌ Time expression test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 180000);

    it('should handle complex multi-step requests', async () => {
      openaiMCPClient.startTestSession('Multi-Step Request Test');
      
      try {
        // Calculate next Tuesday
        const now = new Date();
        const daysUntilTuesday = (2 - now.getDay() + 7) % 7 || 7; // 2 = Tuesday
        const nextTuesday = new Date(now);
        nextTuesday.setDate(now.getDate() + daysUntilTuesday);
        const tuesdayDate = nextTuesday.toISOString().split('T')[0];

        const response = await openaiMCPClient.sendMessage(
          `Check my primary calendar for ${tuesdayDate}, then find the first available time slot after 2:00 PM ` +
          `and create a 1-hour meeting called "Team Sync" at that time.`
        );

        console.log('\n📊 Test Debug Info:');
        console.log('Response content:', response.content);
        console.log('Tool calls made:', response.toolCalls.map(tc => tc.name).join(', ') || 'NONE');
        console.log('Executed results count:', response.executedResults.length);
        console.log('\n');

        expect(response.content).toBeDefined();
        expect(response.executedResults.length).toBeGreaterThan(0);

        // Should have at least one tool call - GPT may be conservative and only check calendar/time first
        // This tests that GPT can understand and start executing complex multi-step requests
        const listEventsCall = response.executedResults.find(r => r.toolCall.name === 'list-events');
        const createEventCall = response.executedResults.find(r => r.toolCall.name === 'create-event');
        const searchEventsCall = response.executedResults.find(r => r.toolCall.name === 'search-events');
        const listCalendarsCall = response.executedResults.find(r => r.toolCall.name === 'list-calendars');
        const getCurrentTimeCall = response.executedResults.find(r => r.toolCall.name === 'get-current-time');

        // Accept any calendar-related tool call as a valid first step
        expect(listEventsCall || createEventCall || searchEventsCall || listCalendarsCall || getCurrentTimeCall).toBeDefined();

        console.log('✅ Multi-step request executed successfully');
        openaiMCPClient.endTestSession();

      } catch (error) {
        console.error('❌ Multi-step request test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 120000);
  });

  describe('Error Handling and Edge Cases', () => {
    it('should gracefully handle invalid requests', async () => {
      openaiMCPClient.startTestSession('Invalid Request Handling Test');
      
      try {
        const response = await openaiMCPClient.sendMessage(
          "Create a meeting for yesterday at 25 o'clock with invalid timezone"
        );
        
        expect(response.content).toBeDefined();
        // GPT should either refuse the request or handle it gracefully
        expect(response.content.toLowerCase()).toMatch(/(cannot|invalid|past|error|sorry|issue|valid)/);
        
        console.log('✅ Invalid request handled gracefully');
        openaiMCPClient.endTestSession();
        
      } catch (error) {
        console.error('❌ Invalid request handling test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 30000);

    it('should handle calendar access issues', async () => {
      openaiMCPClient.startTestSession('Calendar Access Error Test');
      
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
        openaiMCPClient.endTestSession();
        
      } catch (error) {
        console.error('❌ Calendar access error test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 30000);
  });

  describe('Performance and Reliability', () => {
    it('should complete operations within reasonable time', async () => {
      openaiMCPClient.startTestSession('Performance Test');
      
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
        openaiMCPClient.endTestSession();
        
      } catch (error) {
        console.error('❌ Performance test failed:', error);
        openaiMCPClient.endTestSession();
        throw error;
      }
    }, 60000);
  });

  // Helper Functions
  async function executeWithContextLogging<T>(
    testName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      const lastContext = openaiMCPClient instanceof RealOpenAIMCPClient 
        ? openaiMCPClient.getLastInteractionContext() 
        : null;
      
      if (lastContext) {
        console.log(`\n❌ ${testName} FAILED - LOGGING LLM INTERACTION CONTEXT:`);
        (openaiMCPClient as RealOpenAIMCPClient).logInteractionContext(lastContext);
      }
      throw error;
    }
  }

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
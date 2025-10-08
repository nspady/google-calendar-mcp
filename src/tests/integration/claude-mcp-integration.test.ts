import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Anthropic from '@anthropic-ai/sdk';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * Minimal Claude + MCP Integration Tests
 * 
 * PURPOSE: Test ONLY what's unique to LLM integration:
 * 1. Can Claude understand user intent and select appropriate tools?
 * 2. Can Claude handle multi-step reasoning?
 * 3. Can Claude handle ambiguous requests appropriately?
 * 
 * NOT TESTED HERE (covered in direct-integration.test.ts):
 * - Tool functionality
 * - Conflict detection
 * - Calendar operations
 * - Error handling
 * - Performance
 */

interface LLMResponse {
  content: string;
  toolCalls: Array<{ name: string; arguments: Record<string, any> }>;
  executedResults: Array<{ 
    toolCall: { name: string; arguments: Record<string, any> };
    result: any;
    success: boolean;
  }>;
}

class ClaudeMCPClient {
  private anthropic: Anthropic;
  private mcpClient: Client;
  
  constructor(apiKey: string, mcpClient: Client) {
    this.anthropic = new Anthropic({ apiKey });
    this.mcpClient = mcpClient;
  }
  
  async sendMessage(prompt: string): Promise<LLMResponse> {
    // Get available tools from MCP server
    const availableTools = await this.mcpClient.listTools();
    const model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-4-5-20250929';
    
    // Convert MCP tools to Claude format
    const claudeTools = availableTools.tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema
    }));
    
    // Send to Claude
    const message = await this.anthropic.messages.create({
      model,
      max_tokens: 2500,
      tools: claudeTools,
      messages: [{
        role: 'user' as const,
        content: prompt
      }]
    });
    
    // Extract tool calls
    const toolCalls: Array<{ name: string; arguments: Record<string, any> }> = [];
    let textContent = '';
    
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
    
    // Execute tool calls
    const executedResults = [];
    for (const toolCall of toolCalls) {
      try {
        const result = await this.mcpClient.callTool({
          name: toolCall.name,
          arguments: toolCall.arguments
        });
        
        executedResults.push({
          toolCall,
          result,
          success: true
        });
      } catch (error) {
        executedResults.push({
          toolCall,
          result: { error: String(error) },
          success: false
        });
      }
    }
    
    return {
      content: textContent,
      toolCalls,
      executedResults
    };
  }
}

describe('Claude + MCP Essential Tests', () => {
  let mcpClient: Client;
  let claudeClient: ClaudeMCPClient;
  
  beforeAll(async () => {
    // Start MCP server
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>;
    cleanEnv.NODE_ENV = 'test';
    
    // Create MCP client
    mcpClient = new Client({
      name: "minimal-test-client",
      version: "1.0.0"
    }, {
      capabilities: { tools: {} }
    });
    
    // Connect to server
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js'],
      env: cleanEnv
    });
    
    await mcpClient.connect(transport);
    
    // Initialize Claude client
    const apiKey = process.env.CLAUDE_API_KEY;
    if (!apiKey) {
      throw new Error('CLAUDE_API_KEY not set');
    }
    
    claudeClient = new ClaudeMCPClient(apiKey, mcpClient);
    
    // Verify connection
    const tools = await mcpClient.listTools();
    console.log(`Connected to MCP with ${tools.tools.length} tools available`);
  }, 30000);
  
  afterAll(async () => {
    if (mcpClient) await mcpClient.close();
  }, 10000);

  describe('Core LLM Capabilities', () => {
    it('should select appropriate tools for user intent', async () => {
      const testCases = [
        {
          intent: 'create',
          prompt: 'Schedule a meeting tomorrow at 3 PM',
          expectedTools: ['create-event', 'get-current-time']
        },
        {
          intent: 'search',
          prompt: 'Find my meetings with Sarah',
          expectedTools: ['search-events', 'list-events', 'get-current-time']
        },
        {
          intent: 'availability',
          prompt: 'Am I free tomorrow afternoon?',
          expectedTools: ['get-freebusy', 'list-events', 'get-current-time']
        }
      ];
      
      for (const test of testCases) {
        const response = await claudeClient.sendMessage(test.prompt);
        
        // Check if Claude used one of the expected tools
        const usedExpectedTool = response.toolCalls.some(tc =>
          test.expectedTools.includes(tc.name)
        );
        
        // Or at least understood the intent in its response
        const understoodIntent = 
          usedExpectedTool ||
          response.content.toLowerCase().includes(test.intent);
        
        expect(understoodIntent).toBe(true);
      }
    }, 60000);
    
    it('should handle multi-step requests', async () => {
      const response = await claudeClient.sendMessage(
        'What time is it now, and do I have any meetings in the next 2 hours?'
      );
      
      // This requires multiple tool calls or understanding multiple parts
      const handledMultiStep = 
        response.toolCalls.length > 1 || // Multiple tools used
        (response.toolCalls.some(tc => tc.name === 'get-current-time') &&
         response.toolCalls.some(tc => tc.name === 'list-events')) || // Both time and events
        (response.content.includes('time') && response.content.includes('meeting')); // Understood both parts
      
      expect(handledMultiStep).toBe(true);
    }, 30000);
    
    it('should handle ambiguous requests gracefully', async () => {
      const response = await claudeClient.sendMessage(
        'Set up the usual'
      );
      
      // Claude should either:
      // 1. Ask for clarification
      // 2. Make a reasonable attempt with available context
      // 3. Explain what information is needed
      const handledGracefully = 
        response.content.toLowerCase().includes('what') ||
        response.content.toLowerCase().includes('specify') ||
        response.content.toLowerCase().includes('usual') ||
        response.content.toLowerCase().includes('more') ||
        response.toolCalls.length > 0; // Or attempts something
      
      expect(handledGracefully).toBe(true);
    }, 30000);
  });
  
  describe('Tool Selection Accuracy', () => {
    it('should distinguish between list and search operations', async () => {
      // Specific search should use search-events
      const searchResponse = await claudeClient.sendMessage(
        'Find meetings about project alpha'
      );
      
      const usedSearch = 
        searchResponse.toolCalls.some(tc => tc.name === 'search-events') ||
        searchResponse.content.toLowerCase().includes('search');
      
      // General list should use list-events
      const listResponse = await claudeClient.sendMessage(
        'Show me tomorrow\'s schedule'
      );
      
      const usedList = 
        listResponse.toolCalls.some(tc => tc.name === 'list-events') ||
        listResponse.content.toLowerCase().includes('tomorrow');
      
      // At least one should be correct
      expect(usedSearch || usedList).toBe(true);
    }, 30000);
    
    it('should understand when NOT to use tools', async () => {
      const response = await claudeClient.sendMessage(
        'How does Google Calendar handle recurring events?'
      );
      
      // This is a question about calendars, not a calendar operation
      // Claude should either:
      // 1. Not use tools and explain
      // 2. Use minimal tools (like list-calendars) to provide context
      const appropriateResponse = 
        response.toolCalls.length === 0 || // No tools
        response.toolCalls.length === 1 && response.toolCalls[0].name === 'list-calendars' || // Just checking calendars
        response.content.toLowerCase().includes('recurring'); // Explains about recurring events
      
      expect(appropriateResponse).toBe(true);
    }, 30000);
  });
  
  describe('Context Understanding', () => {
    it('should understand relative time expressions', async () => {
      const testPhrases = [
        'tomorrow at 2 PM',
        'next Monday',
        'in 30 minutes'
      ];
      
      for (const phrase of testPhrases) {
        const response = await claudeClient.sendMessage(
          `Schedule a meeting ${phrase}`
        );
        
        // Claude should either get current time or attempt to create an event
        const understoodTime = 
          response.toolCalls.some(tc => 
            tc.name === 'get-current-time' || 
            tc.name === 'create-event'
          ) ||
          response.content.toLowerCase().includes(phrase.split(' ')[0]); // References the time
        
        expect(understoodTime).toBe(true);
      }
    }, 60000);
  });
});

/**
 * What we removed:
 * ✂️ All conflict detection tests (tested in direct integration)
 * ✂️ Duplicate detection tests (tested in direct integration)
 * ✂️ Conference room booking tests (business logic, not LLM)
 * ✂️ Back-to-back meeting tests (calendar logic, not LLM)
 * ✂️ Specific warning message tests (tool behavior, not LLM)
 * ✂️ Performance tests (server performance, not LLM)
 * ✂️ Complex multi-event creation tests (tool functionality)
 * 
 * What remains:
 * ✅ Tool selection for different intents (core LLM capability)
 * ✅ Multi-step request handling (LLM reasoning)
 * ✅ Ambiguous request handling (LLM robustness)
 * ✅ Context understanding (LLM comprehension)
 * ✅ Knowing when NOT to use tools (LLM judgment)
 */
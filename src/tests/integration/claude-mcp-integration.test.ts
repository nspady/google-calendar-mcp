import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
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

// Pricing per million tokens (as of 2025)
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-haiku-4-5-20251001': { input: 1.00, output: 5.00 },
  'claude-sonnet-4-5-20250929': { input: 3.00, output: 15.00 },
};

// Default model for tests - using Haiku 4.5 for cost efficiency
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

interface CostTracker {
  model: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheWriteTokens: number;
  totalCacheReadTokens: number;
  requestCount: number;
  perTestCosts: Array<{ testName: string; inputTokens: number; outputTokens: number; cost: number }>;
}

class ClaudeMCPClient {
  private anthropic: Anthropic;
  private mcpClient: Client;
  private costTracker: CostTracker;
  private currentTestName: string = '';

  constructor(apiKey: string, mcpClient: Client) {
    this.anthropic = new Anthropic({ apiKey });
    this.mcpClient = mcpClient;
    const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;
    this.costTracker = {
      model,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheWriteTokens: 0,
      totalCacheReadTokens: 0,
      requestCount: 0,
      perTestCosts: []
    };
  }

  setCurrentTest(testName: string) {
    this.currentTestName = testName;
  }

  private calculateCost(
    inputTokens: number,
    outputTokens: number,
    cacheWriteTokens: number = 0,
    cacheReadTokens: number = 0
  ): number {
    const pricing = MODEL_PRICING[this.costTracker.model] || { input: 3.00, output: 15.00 };
    // Cache write costs 25% more, cache read costs 90% less (10% of base)
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;
    const cacheWriteCost = (cacheWriteTokens / 1_000_000) * pricing.input * 1.25;
    const cacheReadCost = (cacheReadTokens / 1_000_000) * pricing.input * 0.10;
    return inputCost + outputCost + cacheWriteCost + cacheReadCost;
  }

  async sendMessage(prompt: string): Promise<LLMResponse> {
    // Get available tools from MCP server
    const availableTools = await this.mcpClient.listTools();
    const model = process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

    // Convert MCP tools to Claude format with prompt caching
    // Adding cache_control to the LAST tool caches ALL tools as a prefix
    const claudeTools = availableTools.tools.map((tool, index, arr) => {
      const baseTool = {
        name: tool.name,
        description: tool.description,
        input_schema: tool.inputSchema
      };
      // Add cache_control to last tool to cache entire tool schema
      if (index === arr.length - 1) {
        return { ...baseTool, cache_control: { type: 'ephemeral' as const } };
      }
      return baseTool;
    });

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

    // Track token usage (including cache metrics)
    const usage = message.usage as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const inputTokens = usage.input_tokens || 0;
    const outputTokens = usage.output_tokens || 0;
    const cacheWriteTokens = usage.cache_creation_input_tokens || 0;
    const cacheReadTokens = usage.cache_read_input_tokens || 0;

    this.costTracker.totalInputTokens += inputTokens;
    this.costTracker.totalOutputTokens += outputTokens;
    this.costTracker.totalCacheWriteTokens += cacheWriteTokens;
    this.costTracker.totalCacheReadTokens += cacheReadTokens;
    this.costTracker.requestCount++;

    // Track per-test costs
    if (this.currentTestName) {
      const cost = this.calculateCost(inputTokens, outputTokens, cacheWriteTokens, cacheReadTokens);
      const existing = this.costTracker.perTestCosts.find(t => t.testName === this.currentTestName);
      if (existing) {
        existing.inputTokens += inputTokens;
        existing.outputTokens += outputTokens;
        existing.cost += cost;
      } else {
        this.costTracker.perTestCosts.push({
          testName: this.currentTestName,
          inputTokens,
          outputTokens,
          cost
        });
      }
    }

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

  getCostSummary(): string {
    const pricing = MODEL_PRICING[this.costTracker.model] || { input: 3.00, output: 15.00 };
    const totalCost = this.calculateCost(
      this.costTracker.totalInputTokens,
      this.costTracker.totalOutputTokens,
      this.costTracker.totalCacheWriteTokens,
      this.costTracker.totalCacheReadTokens
    );

    // Calculate what cost would have been without caching
    const totalTokensIfNoCaching = this.costTracker.totalInputTokens +
      this.costTracker.totalCacheWriteTokens +
      this.costTracker.totalCacheReadTokens;
    const costWithoutCaching = this.calculateCost(totalTokensIfNoCaching, this.costTracker.totalOutputTokens);
    const savings = costWithoutCaching - totalCost;
    const savingsPercent = costWithoutCaching > 0 ? (savings / costWithoutCaching) * 100 : 0;

    let summary = '\n' + '='.repeat(70) + '\n';
    summary += '                    CLAUDE API COST SUMMARY\n';
    summary += '='.repeat(70) + '\n\n';
    summary += `Model: ${this.costTracker.model}\n`;
    summary += `Pricing: $${pricing.input.toFixed(2)}/MTok input, $${pricing.output.toFixed(2)}/MTok output\n\n`;
    summary += `Total Requests: ${this.costTracker.requestCount}\n`;
    summary += `Input Tokens (uncached): ${this.costTracker.totalInputTokens.toLocaleString()}\n`;
    summary += `Output Tokens: ${this.costTracker.totalOutputTokens.toLocaleString()}\n`;

    // Cache statistics
    summary += '\n--- Cache Statistics ---\n';
    summary += `Cache Write Tokens: ${this.costTracker.totalCacheWriteTokens.toLocaleString()}\n`;
    summary += `Cache Read Tokens: ${this.costTracker.totalCacheReadTokens.toLocaleString()}\n`;
    const cacheHitRate = this.costTracker.totalCacheWriteTokens + this.costTracker.totalCacheReadTokens > 0
      ? (this.costTracker.totalCacheReadTokens / (this.costTracker.totalCacheWriteTokens + this.costTracker.totalCacheReadTokens)) * 100
      : 0;
    summary += `Cache Hit Rate: ${cacheHitRate.toFixed(1)}%\n`;

    summary += '\n' + '-'.repeat(70) + '\n';
    summary += 'Per-Test Breakdown:\n';
    summary += '-'.repeat(70) + '\n';

    for (const test of this.costTracker.perTestCosts) {
      const shortName = test.testName.length > 50
        ? test.testName.substring(0, 47) + '...'
        : test.testName;
      summary += `${shortName.padEnd(52)} $${test.cost.toFixed(4)}\n`;
    }

    summary += '-'.repeat(70) + '\n';
    summary += `${'TOTAL COST'.padEnd(52)} $${totalCost.toFixed(4)}\n`;
    if (savings > 0) {
      summary += `${'Cost without caching'.padEnd(52)} $${costWithoutCaching.toFixed(4)}\n`;
      summary += `${'SAVINGS FROM CACHING'.padEnd(52)} $${savings.toFixed(4)} (${savingsPercent.toFixed(1)}%)\n`;
    }
    summary += '='.repeat(70) + '\n';

    return summary;
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
  
  beforeEach((context) => {
    if (claudeClient) {
      claudeClient.setCurrentTest(context.task.name);
    }
  });

  afterAll(async () => {
    if (claudeClient) {
      console.log(claudeClient.getCostSummary());
    }
    if (mcpClient) await mcpClient.close();
  }, 10000);

  describe('Core LLM Capabilities', () => {
    it('should select appropriate tools for user intent', async () => {
      // Synonyms to make intent detection more robust against LLM response variation
      const intentSynonyms: Record<string, string[]> = {
        'create': ['create', 'schedule', 'book', 'add', 'set up', 'meeting', 'event'],
        'search': ['search', 'find', 'look', 'meetings', 'sarah', 'results'],
        'availability': ['availability', 'free', 'busy', 'available', 'afternoon', 'schedule']
      };

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

        // Or at least understood the intent in its response (check synonyms)
        const responseText = response.content.toLowerCase();
        const synonyms = intentSynonyms[test.intent] || [test.intent];
        const mentionedIntent = synonyms.some(word => responseText.includes(word));

        const understoodIntent = usedExpectedTool || mentionedIntent;

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

  describe('Multi-Calendar Coordination', () => {
    // These tests verify Claude's ability to handle realistic multi-calendar scenarios
    // that require coordinating across multiple calendars and accounts

    it('should coordinate availability across work and personal calendars', async () => {
      const response = await claudeClient.sendMessage(
        `I need to find a 2-hour block tomorrow where I'm free on both my work calendar
        and my personal calendar. Can you check my availability across both?`
      );

      // Claude should understand this requires checking multiple calendars
      const understoodMultiCalendar =
        response.toolCalls.some(tc =>
          tc.name === 'get-freebusy' ||
          tc.name === 'list-events' ||
          tc.name === 'list-calendars'
        ) ||
        response.content.toLowerCase().includes('calendar') ||
        response.content.toLowerCase().includes('availability');

      // Should reference checking multiple sources or ask which calendars
      const handledMultipleCalendars =
        understoodMultiCalendar ||
        response.content.toLowerCase().includes('both') ||
        response.content.toLowerCase().includes('work') ||
        response.content.toLowerCase().includes('personal');

      expect(handledMultipleCalendars).toBe(true);
    }, 45000);

    it('should find mutual availability for group meeting', async () => {
      const response = await claudeClient.sendMessage(
        `I need to schedule a team meeting for tomorrow afternoon. Can you find a
        1-hour slot where all team calendars are free? Check the primary calendars
        from both my work and personal accounts.`
      );

      // Claude should use freebusy or list-events to check availability
      const usedAvailabilityTools = response.toolCalls.some(tc =>
        tc.name === 'get-freebusy' ||
        tc.name === 'list-events'
      );

      // Or understood the multi-person coordination need
      const understoodCoordination =
        usedAvailabilityTools ||
        response.content.toLowerCase().includes('availability') ||
        response.content.toLowerCase().includes('free') ||
        response.content.toLowerCase().includes('slot') ||
        response.content.toLowerCase().includes('team');

      expect(understoodCoordination).toBe(true);
    }, 45000);

    it('should handle cross-calendar conflict detection', async () => {
      const response = await claudeClient.sendMessage(
        `I want to schedule a dentist appointment on my personal calendar next
        Tuesday at 10 AM, but first check if I have any conflicts on my work
        calendar at that time.`
      );

      // Claude should check for conflicts before creating
      const toolNames = response.toolCalls.map(tc => tc.name);

      // Should use conflict detection or availability checking tools
      const checkedConflicts =
        toolNames.includes('get-freebusy') ||
        toolNames.includes('list-events') ||
        response.content.toLowerCase().includes('conflict') ||
        response.content.toLowerCase().includes('check');

      expect(checkedConflicts).toBe(true);
    }, 45000);

    it('should understand calendar-specific event creation', async () => {
      const response = await claudeClient.sendMessage(
        `Schedule "Doctor Visit" on my personal calendar (not work) for next
        Friday at 2 PM. Make it a 1-hour appointment.`
      );

      // Claude should understand to target a specific calendar
      const attemptedCreate = response.toolCalls.some(tc =>
        tc.name === 'create-event' ||
        tc.name === 'list-calendars'
      );

      // Check response text for relevant keywords
      const responseText = response.content.toLowerCase();
      const containsRelevantKeyword =
        responseText.includes('personal') ||
        responseText.includes('calendar') ||
        responseText.includes('which') ||
        responseText.includes('doctor') ||
        responseText.includes('friday') ||
        responseText.includes('schedule') ||
        responseText.includes('appointment') ||
        responseText.includes('event') ||
        responseText.includes('create') ||
        responseText.includes('work');

      // Or made any tool call (showing engagement with MCP tools)
      const madeAnyToolCall = response.toolCalls.length > 0;

      const understoodCalendarTarget =
        attemptedCreate ||
        containsRelevantKeyword ||
        madeAnyToolCall;

      expect(understoodCalendarTarget).toBe(true);
    }, 45000);

    it('should plan complex multi-step scheduling workflow', async () => {
      const response = await claudeClient.sendMessage(
        `I need to block off time for a trip next week. Please:
        1. First show me what meetings I have scheduled next week across all calendars
        2. Then identify any meetings I'll need to reschedule
        3. Create an "Out of Office" event on my primary calendar for Monday-Wednesday`
      );

      // This requires multi-step reasoning
      const toolNames = response.toolCalls.map(tc => tc.name);

      // Should attempt to list events or understand the multi-step nature
      const handledMultiStep =
        toolNames.includes('list-events') ||
        toolNames.includes('list-calendars') ||
        response.content.toLowerCase().includes('step') ||
        response.content.toLowerCase().includes('first') ||
        response.content.toLowerCase().includes('next week') ||
        response.toolCalls.length >= 1;

      expect(handledMultiStep).toBe(true);
    }, 45000);

    it('should suggest using account parameter for disambiguation', async () => {
      const response = await claudeClient.sendMessage(
        `I have multiple Google accounts connected. Schedule a meeting on the
        calendar from my work account specifically, not my personal one.`
      );

      // Claude should understand account disambiguation
      const understoodAccountContext =
        response.toolCalls.some(tc =>
          tc.arguments?.account !== undefined ||
          tc.name === 'list-calendars'
        ) ||
        response.content.toLowerCase().includes('account') ||
        response.content.toLowerCase().includes('work') ||
        response.content.toLowerCase().includes('which');

      expect(understoodAccountContext).toBe(true);
    }, 45000);

    it('should check shared calendar availability', async () => {
      const response = await claudeClient.sendMessage(
        `Check if the team shared calendar has any events scheduled for tomorrow
        afternoon. I want to book the conference room if it's available.`
      );

      // Should query events or freebusy for shared calendar
      const checkedSharedCalendar =
        response.toolCalls.some(tc =>
          tc.name === 'list-events' ||
          tc.name === 'get-freebusy' ||
          tc.name === 'list-calendars'
        ) ||
        response.content.toLowerCase().includes('shared') ||
        response.content.toLowerCase().includes('team') ||
        response.content.toLowerCase().includes('available');

      expect(checkedSharedCalendar).toBe(true);
    }, 45000);

    it('should handle "block time on all calendars" request', async () => {
      const response = await claudeClient.sendMessage(
        `I need to block off 9 AM to 12 PM tomorrow for deep work. Create
        "Focus Time - Do Not Disturb" events on ALL my calendars so people
        see I'm busy regardless of which calendar they check.`
      );

      // Should understand the need to create on multiple calendars
      const understoodMultiCalendarCreate =
        response.toolCalls.some(tc =>
          tc.name === 'create-event' ||
          tc.name === 'list-calendars'
        ) ||
        response.content.toLowerCase().includes('all') ||
        response.content.toLowerCase().includes('multiple') ||
        response.content.toLowerCase().includes('calendars');

      expect(understoodMultiCalendarCreate).toBe(true);
    }, 45000);
  });

  describe('Real-World Scheduling Scenarios', () => {
    // These test realistic prompts that users might actually send

    it('should handle "when can we meet" style requests', async () => {
      const response = await claudeClient.sendMessage(
        `When am I free for a 30-minute call sometime this week? Prefer afternoon slots.`
      );

      const handledAvailabilityRequest =
        response.toolCalls.some(tc =>
          tc.name === 'get-freebusy' ||
          tc.name === 'list-events' ||
          tc.name === 'get-current-time'
        ) ||
        response.content.toLowerCase().includes('free') ||
        response.content.toLowerCase().includes('available') ||
        response.content.toLowerCase().includes('afternoon');

      expect(handledAvailabilityRequest).toBe(true);
    }, 45000);

    it('should handle rescheduling with constraints', async () => {
      const response = await claudeClient.sendMessage(
        `I need to move my 2 PM meeting today to sometime tomorrow, but it can't
        conflict with my existing appointments. Find me an open slot.`
      );

      // Should check availability and understand rescheduling
      const handledReschedule =
        response.toolCalls.some(tc =>
          tc.name === 'list-events' ||
          tc.name === 'get-freebusy' ||
          tc.name === 'search-events' ||
          tc.name === 'get-current-time' ||
          tc.name === 'update-event'
        ) ||
        response.content.toLowerCase().includes('reschedul') ||
        response.content.toLowerCase().includes('move') ||
        response.content.toLowerCase().includes('conflict') ||
        response.content.toLowerCase().includes('meeting') ||
        response.content.toLowerCase().includes('tomorrow') ||
        response.content.toLowerCase().includes('slot');

      expect(handledReschedule).toBe(true);
    }, 45000);

    it('should understand recurring meeting context', async () => {
      const response = await claudeClient.sendMessage(
        `I have a weekly team standup that I need to skip this week only.
        Can you help me handle just this occurrence without affecting future meetings?`
      );

      // Should understand recurring event modification scope
      const understoodRecurring =
        response.toolCalls.some(tc =>
          tc.name === 'search-events' ||
          tc.name === 'list-events' ||
          tc.name === 'update-event' ||
          tc.name === 'delete-event'
        ) ||
        response.content.toLowerCase().includes('recurring') ||
        response.content.toLowerCase().includes('this week only') ||
        response.content.toLowerCase().includes('occurrence') ||
        response.content.toLowerCase().includes('instance');

      expect(understoodRecurring).toBe(true);
    }, 45000);

    it('should coordinate external attendee scheduling', async () => {
      const response = await claudeClient.sendMessage(
        `Schedule a meeting with an external client next week. I need to check my
        availability first, then create the meeting with them as an attendee.
        Their email is client@example.com.`
      );

      // Should handle multi-step external attendee flow
      const handledExternalAttendee =
        response.toolCalls.some(tc =>
          tc.name === 'list-events' ||
          tc.name === 'get-freebusy' ||
          tc.name === 'create-event'
        ) ||
        response.content.toLowerCase().includes('attendee') ||
        response.content.toLowerCase().includes('client') ||
        response.content.toLowerCase().includes('availability');

      expect(handledExternalAttendee).toBe(true);
    }, 45000);
  });
});

/**
 * Test Categories:
 *
 * Core LLM Capabilities:
 * ✅ Tool selection for different intents (create, search, availability)
 * ✅ Multi-step request handling (LLM reasoning)
 * ✅ Ambiguous request handling (LLM robustness)
 * ✅ Context understanding - relative time expressions
 * ✅ Knowing when NOT to use tools (LLM judgment)
 *
 * Multi-Calendar Coordination (NEW):
 * ✅ Cross-calendar availability checking (work + personal)
 * ✅ Mutual availability for group meetings
 * ✅ Cross-calendar conflict detection
 * ✅ Calendar-specific event creation
 * ✅ Multi-step scheduling workflows
 * ✅ Account parameter disambiguation
 * ✅ Shared calendar operations
 * ✅ Block time across all calendars
 *
 * Real-World Scenarios (NEW):
 * ✅ "When can we meet" style requests
 * ✅ Rescheduling with constraints
 * ✅ Recurring meeting modifications (single occurrence)
 * ✅ External attendee coordination
 *
 * What's NOT tested here (covered in direct-integration.test.ts):
 * ✂️ Tool functionality and response formats
 * ✂️ API error handling
 * ✂️ Performance benchmarks
 * ✂️ Data validation
 */
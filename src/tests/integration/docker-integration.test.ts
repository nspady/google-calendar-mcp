import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn, ChildProcess, exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs/promises';
import { TestDataFactory } from './test-data-factory.js';

const execAsync = promisify(exec);

/**
 * Docker Integration Tests for Google Calendar MCP Server
 * 
 * REQUIREMENTS TO RUN THESE TESTS:
 * 1. Docker and docker-compose installed
 * 2. Valid Google OAuth credentials file (gcp-oauth.keys.json)
 * 3. For full integration: Authenticated test account (npm run dev auth:test)
 * 4. Environment variables: TEST_CALENDAR_ID
 * 
 * These tests verify:
 * 1. Docker containers start and stop correctly
 * 2. MCP server is accessible within Docker
 * 3. Calendar operations work through Docker
 * 4. Both stdio and HTTP transports function
 * 5. Performance and resource usage
 */

describe('Docker Integration Tests', () => {
  let mcpClient: Client;
  let dockerProcess: ChildProcess;
  let testFactory: TestDataFactory;
  let createdEventIds: string[] = [];
  
  const TEST_CALENDAR_ID = process.env.TEST_CALENDAR_ID;
  const CONTAINER_NAME = 'test-calendar-mcp-integration';
  const HTTP_PORT = 3002; // Different port for test isolation

  beforeAll(async () => {
    console.log('🐳 Starting Docker integration tests...');
    
    if (!TEST_CALENDAR_ID) {
      throw new Error('TEST_CALENDAR_ID environment variable is required');
    }

    testFactory = new TestDataFactory();

    // Ensure any existing test containers are cleaned up
    await cleanupDockerResources();

    // Build fresh test image
    console.log('🔨 Building Docker test image...');
    await execAsync('docker build -t google-calendar-mcp:test .', { 
      cwd: process.cwd(),
      timeout: 60000 
    });

    console.log('✅ Docker image built successfully');
  }, 120000);

  afterAll(async () => {
    // Cleanup all created events
    await cleanupAllCreatedEvents();
    
    // Cleanup Docker resources
    await cleanupDockerResources();
    
    console.log('🧹 Docker integration test cleanup completed');
  }, 30000);

  beforeEach(() => {
    createdEventIds = [];
  });

  afterEach(async () => {
    // Cleanup events created in this test
    await cleanupEvents(createdEventIds);
    createdEventIds = [];
    
    // Ensure client is closed
    if (mcpClient) {
      try {
        await mcpClient.close();
      } catch (error) {
        // Ignore close errors
      }
    }
  });

  describe('Docker Container Functionality', () => {
    it('should start stdio container and connect via MCP', async () => {
      console.log('🔌 Testing stdio container startup...');
      
      // Start container in stdio mode
      const startTime = testFactory.startTimer('docker-stdio-startup');
      
      await execAsync(`docker run -d --name ${CONTAINER_NAME} \
        -v ${process.cwd()}/gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
        -v mcp-test-tokens:/home/nodejs/.config/google-calendar-mcp \
        -e NODE_ENV=test \
        -e TRANSPORT=stdio \
        --entrypoint=/bin/sh \
        google-calendar-mcp:test -c "while true; do sleep 30; done"`);
      
      testFactory.endTimer('docker-stdio-startup', startTime, true);
      
      // Verify container is running
      const { stdout } = await execAsync(`docker ps --filter name=${CONTAINER_NAME} --format "{{.Status}}"`);
      expect(stdout.trim()).toContain('Up');
      
      // Connect to MCP server in container
      mcpClient = new Client({
        name: "docker-integration-client",
        version: "1.0.0"
      }, {
        capabilities: { tools: {} }
      });

      const transport = new StdioClientTransport({
        command: 'docker',
        args: ['exec', '-i', CONTAINER_NAME, 'npm', 'start'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      const connectStartTime = testFactory.startTimer('mcp-connection');
      await mcpClient.connect(transport);
      testFactory.endTimer('mcp-connection', connectStartTime, true);
      
      // Test basic functionality
      const tools = await mcpClient.listTools();
      expect(tools.tools.length).toBeGreaterThan(0);
      
      // Find expected tools
      const expectedTools = ['list-calendars', 'create-event', 'list-events'];
      expectedTools.forEach(toolName => {
        const tool = tools.tools.find(t => t.name === toolName);
        expect(tool).toBeDefined();
      });
      
      console.log(`✅ Connected to MCP server in Docker container (${tools.tools.length} tools available)`);
      
      // Cleanup
      await mcpClient.close();
      await execAsync(`docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}`);
    }, 60000);

    it('should start HTTP container and serve endpoints', async () => {
      console.log('🌐 Testing HTTP container startup...');
      
      const startTime = testFactory.startTimer('docker-http-startup');
      
      // Start container in HTTP mode
      await execAsync(`docker run -d --name ${CONTAINER_NAME}-http \
        -p ${HTTP_PORT}:3000 \
        -v ${process.cwd()}/gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
        -v mcp-test-tokens:/home/nodejs/.config/google-calendar-mcp \
        -e NODE_ENV=test \
        -e TRANSPORT=http \
        -e HOST=0.0.0.0 \
        -e PORT=3000 \
        google-calendar-mcp:test`);
      
      // Wait for HTTP server to be ready
      let serverReady = false;
      for (let i = 0; i < 30; i++) {
        try {
          const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
          if (response.ok) {
            serverReady = true;
            break;
          }
        } catch (error) {
          // Server not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      testFactory.endTimer('docker-http-startup', startTime, serverReady);
      
      expect(serverReady).toBe(true);
      
      // Test health endpoint
      const healthResponse = await fetch(`http://localhost:${HTTP_PORT}/health`);
      expect(healthResponse.ok).toBe(true);
      const healthData = await healthResponse.text();
      expect(healthData).toBe('ok');
      
      // Test info endpoint
      const infoResponse = await fetch(`http://localhost:${HTTP_PORT}/info`);
      expect(infoResponse.ok).toBe(true);
      const infoData = await infoResponse.json();
      expect(infoData).toHaveProperty('name');
      expect(infoData).toHaveProperty('version');
      
      console.log('✅ HTTP container serving endpoints correctly');
      
      // Cleanup
      await execAsync(`docker stop ${CONTAINER_NAME}-http && docker rm ${CONTAINER_NAME}-http`);
    }, 60000);

    it('should work with docker-compose', async () => {
      console.log('🐳 Testing docker-compose integration...');
      
      const startTime = testFactory.startTimer('docker-compose-test');
      const composeOverridePath = `${process.cwd()}/docker-compose.override.yml`;

      try {
        // Test stdio mode (default)
        console.log('  Testing stdio mode with docker-compose...');
        await execAsync('docker compose up -d', { cwd: process.cwd() });
        
        await new Promise(resolve => setTimeout(resolve, 5000));
        
        const { stdout: psStdio } = await execAsync('docker compose ps', { cwd: process.cwd() });
        expect(psStdio).toContain('Up');
        
        await execAsync('docker compose down', { cwd: process.cwd() });
        console.log('  ✅ docker-compose stdio mode works');

        // Test HTTP mode using an override file
        console.log('  Testing http mode with docker-compose...');
        const composeOverride = `
services:
  calendar-mcp:
    ports:
      - "${HTTP_PORT}:3000"
    environment:
      TRANSPORT: http
      HOST: 0.0.0.0
      PORT: 3000
`;
        await fs.writeFile(composeOverridePath, composeOverride);

        await execAsync('docker compose up -d', { cwd: process.cwd() });
        
        let httpReady = false;
        for (let i = 0; i < 20; i++) {
          try {
            const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
            if (response.ok) {
              httpReady = true;
              break;
            }
          } catch (error) { /* wait */ }
          await new Promise(resolve => setTimeout(resolve, 1000));
        }
        
        expect(httpReady).toBe(true);
        console.log('  ✅ docker-compose http mode works');

        testFactory.endTimer('docker-compose-test', startTime, true);
        console.log('✅ docker-compose integration working');
        
      } finally {
        // Always cleanup
        await execAsync('docker compose down', { cwd: process.cwd() }).catch(() => {});
        await fs.unlink(composeOverridePath).catch(() => {});
      }
    }, 90000);
  });

  describe('Calendar Operations via Docker', () => {
    beforeEach(async () => {
      // Start container for calendar operations
      await execAsync(`docker run -d --name ${CONTAINER_NAME} \
        -v ${process.cwd()}/gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
        -v mcp-test-tokens:/home/nodejs/.config/google-calendar-mcp \
        -e NODE_ENV=test \
        -e TRANSPORT=stdio \
        --entrypoint=/bin/sh \
        google-calendar-mcp:test -c "while true; do sleep 30; done"`);
      
      // Connect MCP client
      mcpClient = new Client({
        name: "docker-calendar-client",
        version: "1.0.0"
      }, {
        capabilities: { tools: {} }
      });

      const transport = new StdioClientTransport({
        command: 'docker',
        args: ['exec', '-i', CONTAINER_NAME, 'npm', 'start'],
        env: { ...process.env, NODE_ENV: 'test' }
      });
      
      await mcpClient.connect(transport);
    });

    afterEach(async () => {
      if (mcpClient) {
        await mcpClient.close();
      }
      await execAsync(`docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}`).catch(() => {});
    });

    it('should list calendars through Docker', async () => {
      console.log('📅 Testing calendar listing via Docker...');
      
      const startTime = testFactory.startTimer('docker-list-calendars');
      
      try {
        const result = await mcpClient.callTool({
          name: 'list-calendars',
          arguments: {}
        });
        
        testFactory.endTimer('docker-list-calendars', startTime, true);
        
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        const calendars = result.content as any[];
        expect(Array.isArray(calendars)).toBe(true);
        
        // Should have at least primary calendar
        expect(calendars.length).toBeGreaterThan(0);
        
        console.log(`✅ Listed ${calendars.length} calendars via Docker`);
        
      } catch (error) {
        testFactory.endTimer('docker-list-calendars', startTime, false, String(error));
        throw error;
      }
    }, 30000);

    it('should create and manage events through Docker', async () => {
      console.log('📝 Testing event creation via Docker...');
      
      const eventDetails = TestDataFactory.createSingleEvent({
        summary: 'Docker Integration Test Event'
      });
      
      const eventData = {
        ...eventDetails,
        calendarId: TEST_CALENDAR_ID
      };

      const createStartTime = testFactory.startTimer('docker-create-event');
      
      try {
        // Create event
        const createResult = await mcpClient.callTool({
          name: 'create-event',
          arguments: eventData
        });
        
        testFactory.endTimer('docker-create-event', createStartTime, true);
        
        expect(createResult).toBeDefined();
        expect(createResult.content).toBeDefined();
        
        // Extract event ID for cleanup
        const eventId = TestDataFactory.extractEventIdFromResponse(createResult);
        expect(eventId).toBeTruthy();
        if (eventId) {
          createdEventIds.push(eventId);
        }
        
        console.log(`✅ Created event ${eventId} via Docker`);
        
        // Verify event exists by listing events
        const listStartTime = testFactory.startTimer('docker-list-events');
        
        const listResult = await mcpClient.callTool({
          name: 'list-events',
          arguments: {
            calendarId: TEST_CALENDAR_ID,
            timeMin: eventData.start,
            timeMax: eventData.end
          }
        });
        
        testFactory.endTimer('docker-list-events', listStartTime, true);
        
        expect(listResult.content).toBeDefined();
        const events = Array.isArray(listResult.content) ? listResult.content : [listResult.content];
        const createdEvent = events.find((event: any) => 
          event.text && event.text.includes(eventData.summary)
        );
        expect(createdEvent).toBeDefined();
        
        console.log('✅ Verified event creation through listing');
        
      } catch (error) {
        testFactory.endTimer('docker-create-event', createStartTime, false, String(error));
        throw error;
      }
    }, 45000);

    it('should handle current time requests through Docker', async () => {
      console.log('🕐 Testing current time via Docker...');
      
      const startTime = testFactory.startTimer('docker-current-time');
      
      try {
        const result = await mcpClient.callTool({
          name: 'get-current-time',
          arguments: {
            timeZone: 'America/Los_Angeles'
          }
        });
        
        testFactory.endTimer('docker-current-time', startTime, true);
        
        expect(result).toBeDefined();
        expect(result.content).toBeDefined();
        
        console.log('✅ Current time retrieved via Docker');
        
      } catch (error) {
        testFactory.endTimer('docker-current-time', startTime, false, String(error));
        throw error;
      }
    }, 15000);
  });

  describe('Performance and Resource Testing', () => {
    it('should perform within acceptable resource limits', async () => {
      console.log('📊 Testing Docker container performance...');
      
      // Start container
      await execAsync(`docker run -d --name ${CONTAINER_NAME} \
        -v ${process.cwd()}/gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
        -v mcp-test-tokens:/home/nodejs/.config/google-calendar-mcp \
        -e NODE_ENV=test \
        -e TRANSPORT=stdio \
        --entrypoint=/bin/sh \
        google-calendar-mcp:test -c "while true; do sleep 30; done"`);
      
      // Wait for container to stabilize
      await new Promise(resolve => setTimeout(resolve, 5000));
      
      // Get container stats
      const { stdout } = await execAsync(`docker stats --no-stream --format "{{.MemUsage}},{{.CPUPerc}}" ${CONTAINER_NAME}`);
      const [memUsage, cpuUsage] = stdout.trim().split(',');
      
      console.log(`Memory usage: ${memUsage}`);
      console.log(`CPU usage: ${cpuUsage}`);
      
      // Parse memory usage (e.g., "45.2MiB / 512MiB")
      const memoryMB = parseFloat(memUsage.split('/')[0].replace('MiB', '').trim());
      expect(memoryMB).toBeLessThan(200); // Should use less than 200MB
      
      // Parse CPU usage (e.g., "1.23%")
      const cpuPercent = parseFloat(cpuUsage.replace('%', ''));
      expect(cpuPercent).toBeLessThan(50); // Should use less than 50% CPU when idle
      
      console.log('✅ Container performance within acceptable limits');
      
      // Cleanup
      await execAsync(`docker stop ${CONTAINER_NAME} && docker rm ${CONTAINER_NAME}`);
    }, 30000);

    it('should handle concurrent requests efficiently', async () => {
      console.log('🚀 Testing concurrent request handling...');
      
      // Start HTTP container for concurrent testing
      await execAsync(`docker run -d --name ${CONTAINER_NAME}-http \
        -p ${HTTP_PORT}:3000 \
        -v ${process.cwd()}/gcp-oauth.keys.json:/usr/src/app/gcp-oauth.keys.json:ro \
        -v mcp-test-tokens:/home/nodejs/.config/google-calendar-mcp \
        -e NODE_ENV=test \
        -e TRANSPORT=http \
        -e HOST=0.0.0.0 \
        -e PORT=3000 \
        google-calendar-mcp:test`);
      
      // Wait for server to be ready
      for (let i = 0; i < 20; i++) {
        try {
          const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
          if (response.ok) break;
        } catch (error) {
          // Not ready yet
        }
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // Make concurrent health check requests
      const concurrentRequests = 10;
      const startTime = Date.now();
      
      const requests = Array(concurrentRequests).fill(null).map(async () => {
        const response = await fetch(`http://localhost:${HTTP_PORT}/health`);
        return { ok: response.ok, time: Date.now() };
      });
      
      const results = await Promise.all(requests);
      const totalTime = Date.now() - startTime;
      
      // All requests should succeed
      expect(results.every(r => r.ok)).toBe(true);
      
      // Average response time should be reasonable
      expect(totalTime / concurrentRequests).toBeLessThan(1000); // Less than 1 second per request on average
      
      console.log(`✅ Handled ${concurrentRequests} concurrent requests in ${totalTime}ms`);
      
      // Cleanup
      await execAsync(`docker stop ${CONTAINER_NAME}-http && docker rm ${CONTAINER_NAME}-http`);
    }, 60000);
  });

  // Helper Functions
  async function cleanupDockerResources(): Promise<void> {
    const containerNames = [
      CONTAINER_NAME,
      `${CONTAINER_NAME}-http`
    ];
    
    for (const name of containerNames) {
      try {
        await execAsync(`docker stop ${name} 2>/dev/null || true`);
        await execAsync(`docker rm ${name} 2>/dev/null || true`);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
    
    // Remove test volume
    try {
      await execAsync('docker volume rm mcp-test-tokens 2>/dev/null || true');
    } catch (error) {
      // Ignore cleanup errors
    }
  }

  async function cleanupEvents(eventIds: string[]): Promise<void> {
    if (!mcpClient || eventIds.length === 0) return;
    
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
    await cleanupEvents(createdEventIds);
  }
});
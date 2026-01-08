import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { ChildProcess } from 'child_process';

/**
 * Integration Tests for Google Tasks MCP Tools
 *
 * REQUIREMENTS TO RUN THESE TESTS:
 * 1. Valid Google OAuth credentials file at path specified by GOOGLE_OAUTH_CREDENTIALS env var
 * 2. Authenticated test account with Tasks scope: Run `ENABLE_TASKS=true npm run dev auth:test` first
 * 3. ENABLE_TASKS=true environment variable set
 * 4. Google Tasks API enabled in Google Cloud Console
 * 5. Network access to Google Tasks API
 *
 * These tests exercise all Tasks MCP tools against real Google Tasks and will:
 * - Create, modify, and delete real tasks
 * - Make actual API calls to Google Tasks API
 * - Require valid authentication tokens with Tasks scope
 *
 * Test Strategy:
 * 1. Verify task lists can be retrieved
 * 2. Create test tasks
 * 3. Test read operations (get, list)
 * 4. Test write operations (update, complete via update)
 * 5. Clean up by deleting created tasks
 */

describe('Google Tasks MCP - Direct Integration Tests', () => {
  let client: Client;
  let serverProcess: ChildProcess;
  let createdTaskIds: string[] = [];
  const defaultTaskListId: string = '@default';
  // Use test-primary account which should have Tasks scope
  const TEST_ACCOUNT = process.env.TEST_ACCOUNT_ID || 'test-primary';

  // Performance tracking
  const performanceMetrics: Map<string, { duration: number; success: boolean; error?: string }[]> = new Map();

  const startTimer = (operation: string): number => {
    return Date.now();
  };

  const endTimer = (operation: string, startTime: number, success: boolean, error?: string): void => {
    const duration = Date.now() - startTime;
    if (!performanceMetrics.has(operation)) {
      performanceMetrics.set(operation, []);
    }
    performanceMetrics.get(operation)!.push({ duration, success, error });
  };

  const logPerformanceSummary = (): void => {
    console.log('\n📊 Performance Summary:');
    for (const [operation, metrics] of performanceMetrics) {
      const successful = metrics.filter(m => m.success);
      const avgDuration = successful.length > 0
        ? Math.round(successful.reduce((sum, m) => sum + m.duration, 0) / successful.length)
        : 0;
      console.log(`  ${operation}: ${successful.length}/${metrics.length} successful, avg ${avgDuration}ms`);
    }
  };

  beforeAll(async () => {
    // Verify ENABLE_TASKS is set
    if (process.env.ENABLE_TASKS !== 'true') {
      console.warn('⚠️  ENABLE_TASKS not set to true - Tasks integration tests may fail');
    }

    console.log('🚀 Starting Google Calendar MCP server with Tasks enabled...');

    // Filter out undefined values from process.env and set required vars
    const cleanEnv = Object.fromEntries(
      Object.entries(process.env).filter(([_, value]) => value !== undefined)
    ) as Record<string, string>;
    cleanEnv.NODE_ENV = 'test';
    cleanEnv.ENABLE_TASKS = 'true';

    // Create MCP client
    client = new Client({
      name: "tasks-integration-test-client",
      version: "1.0.0"
    }, {
      capabilities: {
        tools: {}
      }
    });

    // Connect to server
    const transport = new StdioClientTransport({
      command: 'node',
      args: ['build/index.js', '--enable-tasks'],
      env: cleanEnv
    });

    await client.connect(transport);
    console.log('✅ Connected to MCP server with Tasks enabled');
  }, 30000);

  afterAll(async () => {
    console.log('\n🏁 Starting final cleanup...');

    // Final cleanup - ensure all test tasks are removed
    if (createdTaskIds.length > 0) {
      console.log(`📋 Cleaning up ${createdTaskIds.length} tasks created during tests`);
      for (const taskId of createdTaskIds) {
        try {
          await client.callTool({
            name: 'delete-task',
            arguments: {
              account: TEST_ACCOUNT,
              taskListId: defaultTaskListId,
              taskId: taskId
            }
          });
        } catch (error) {
          console.warn(`Failed to delete task ${taskId}: ${error}`);
        }
      }
    }

    // Close client connection
    if (client) {
      await client.close();
      console.log('🔌 Closed MCP client connection');
    }

    // Terminate server process
    if (serverProcess && !serverProcess.killed) {
      serverProcess.kill();
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log('🛑 Terminated MCP server process');
    }

    // Log performance summary
    logPerformanceSummary();

    console.log('✅ Tasks integration test cleanup completed successfully\n');
  }, 30000);

  beforeEach(() => {
    performanceMetrics.clear();
  });

  afterEach(async () => {
    // Cleanup tasks created in this test
    if (createdTaskIds.length > 0) {
      console.log(`🧹 Cleaning up ${createdTaskIds.length} tasks from test...`);
      for (const taskId of createdTaskIds) {
        try {
          await client.callTool({
            name: 'delete-task',
            arguments: {
              account: TEST_ACCOUNT,
              taskListId: defaultTaskListId,
              taskId: taskId
            }
          });
        } catch (error) {
          // Ignore cleanup errors
        }
      }
      createdTaskIds = [];
    }
  });

  describe('Task List Operations', () => {
    it('should list task lists', async () => {
      const startTime = startTimer('list-task-lists');

      try {
        const result = await client.callTool({
          name: 'list-task-lists',
          arguments: {
            account: TEST_ACCOUNT
          }
        });

        endTimer('list-task-lists', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.taskLists).toBeDefined();
        expect(Array.isArray(response.taskLists)).toBe(true);
        expect(response.totalCount).toBeTypeOf('number');
        expect(response.totalCount).toBeGreaterThan(0);

        // Verify at least one task list has required fields
        const firstList = response.taskLists[0];
        expect(firstList.id).toBeDefined();
        expect(firstList.title).toBeDefined();
      } catch (error) {
        endTimer('list-task-lists', startTime, false, String(error));
        throw error;
      }
    });
  });

  describe('Task CRUD Operations', () => {
    it('should create a task with title only', async () => {
      const startTime = startTimer('create-task-basic');

      try {
        const result = await client.callTool({
          name: 'create-task',
          arguments: {
            account: TEST_ACCOUNT,
            title: 'Integration Test Task - Basic'
          }
        });

        endTimer('create-task-basic', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBeDefined();
        expect(response.task.title).toBe('Integration Test Task - Basic');
        expect(response.task.status).toBe('needsAction');
        expect(response.message).toContain('created successfully');

        // Track for cleanup
        createdTaskIds.push(response.task.id);
      } catch (error) {
        endTimer('create-task-basic', startTime, false, String(error));
        throw error;
      }
    });

    it('should create a task with all fields', async () => {
      const startTime = startTimer('create-task-full');
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + 7); // Due in 7 days
      const dueDateStr = dueDate.toISOString().split('T')[0];

      try {
        const result = await client.callTool({
          name: 'create-task',
          arguments: {
            account: TEST_ACCOUNT,
            title: 'Integration Test Task - Full',
            notes: 'This is a test task with all fields populated',
            due: dueDateStr
          }
        });

        endTimer('create-task-full', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBeDefined();
        expect(response.task.title).toBe('Integration Test Task - Full');
        expect(response.task.notes).toBe('This is a test task with all fields populated');
        expect(response.task.due).toBeDefined();
        expect(response.task.status).toBe('needsAction');

        // Track for cleanup
        createdTaskIds.push(response.task.id);
      } catch (error) {
        endTimer('create-task-full', startTime, false, String(error));
        throw error;
      }
    });

    it('should get a specific task by ID', async () => {
      // First create a task
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - Get',
          notes: 'Task for testing get operation'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      const taskId = createResponse.task.id;
      createdTaskIds.push(taskId);

      const startTime = startTimer('get-task');

      try {
        const result = await client.callTool({
          name: 'get-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId
          }
        });

        endTimer('get-task', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBe(taskId);
        expect(response.task.title).toBe('Integration Test Task - Get');
        expect(response.task.notes).toBe('Task for testing get operation');
      } catch (error) {
        endTimer('get-task', startTime, false, String(error));
        throw error;
      }
    });

    it('should list tasks in default task list', async () => {
      // First create a task to ensure there's at least one
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - List'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      createdTaskIds.push(createResponse.task.id);

      const startTime = startTimer('list-tasks');

      try {
        const result = await client.callTool({
          name: 'list-tasks',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default'
          }
        });

        endTimer('list-tasks', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.tasks).toBeDefined();
        expect(Array.isArray(response.tasks)).toBe(true);
        expect(response.totalCount).toBeTypeOf('number');
        expect(response.taskListId).toBe('@default');

        // Verify our created task is in the list
        const foundTask = response.tasks.find((t: any) => t.title === 'Integration Test Task - List');
        expect(foundTask).toBeDefined();
      } catch (error) {
        endTimer('list-tasks', startTime, false, String(error));
        throw error;
      }
    });

    it('should list tasks with showCompleted filter', async () => {
      const startTime = startTimer('list-tasks-filter');

      try {
        const result = await client.callTool({
          name: 'list-tasks',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            showCompleted: false
          }
        });

        endTimer('list-tasks-filter', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.tasks).toBeDefined();
        expect(response.filters).toBeDefined();
        expect(response.filters.showCompleted).toBe(false);

        // All returned tasks should be incomplete
        for (const task of response.tasks) {
          expect(task.status).toBe('needsAction');
        }
      } catch (error) {
        endTimer('list-tasks-filter', startTime, false, String(error));
        throw error;
      }
    });

    it('should update a task title and notes', async () => {
      // First create a task
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - Update Original'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      const taskId = createResponse.task.id;
      createdTaskIds.push(taskId);

      const startTime = startTimer('update-task');

      try {
        const result = await client.callTool({
          name: 'update-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId,
            title: 'Integration Test Task - Updated',
            notes: 'These notes were added during update'
          }
        });

        endTimer('update-task', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBe(taskId);
        expect(response.task.title).toBe('Integration Test Task - Updated');
        expect(response.task.notes).toBe('These notes were added during update');
        expect(response.message).toContain('updated successfully');
        expect(response.updatedFields).toContain('title');
        expect(response.updatedFields).toContain('notes');
      } catch (error) {
        endTimer('update-task', startTime, false, String(error));
        throw error;
      }
    });

    it('should complete a task via update-task with status', async () => {
      // First create a task
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - Complete via Update'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      const taskId = createResponse.task.id;
      createdTaskIds.push(taskId);

      const startTime = startTimer('update-task-complete');

      try {
        const result = await client.callTool({
          name: 'update-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId,
            status: 'completed'
          }
        });

        endTimer('update-task-complete', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBe(taskId);
        expect(response.task.status).toBe('completed');
        expect(response.task.completed).toBeDefined();
        expect(response.updatedFields).toContain('status');
      } catch (error) {
        endTimer('update-task-complete', startTime, false, String(error));
        throw error;
      }
    });

    it('should uncomplete a task via update-task with status needsAction', async () => {
      // First create and complete a task
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - Uncomplete'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      const taskId = createResponse.task.id;
      createdTaskIds.push(taskId);

      // Complete it first
      await client.callTool({
        name: 'update-task',
        arguments: {
          account: TEST_ACCOUNT,
          taskListId: '@default',
          taskId: taskId,
          status: 'completed'
        }
      });

      const startTime = startTimer('update-task-uncomplete');

      try {
        // Now uncomplete it
        const result = await client.callTool({
          name: 'update-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId,
            status: 'needsAction'
          }
        });

        endTimer('update-task-uncomplete', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.task).toBeDefined();
        expect(response.task.id).toBe(taskId);
        expect(response.task.status).toBe('needsAction');
        expect(response.updatedFields).toContain('status');
      } catch (error) {
        endTimer('update-task-uncomplete', startTime, false, String(error));
        throw error;
      }
    });

    it('should delete a task', async () => {
      // First create a task
      const createResult = await client.callTool({
        name: 'create-task',
        arguments: {
          account: TEST_ACCOUNT,
          title: 'Integration Test Task - Delete'
        }
      });
      const createResponse = JSON.parse((createResult.content as any)[0].text);
      const taskId = createResponse.task.id;
      // Don't add to createdTaskIds since we're deleting it in the test

      const startTime = startTimer('delete-task');

      try {
        const result = await client.callTool({
          name: 'delete-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId
          }
        });

        endTimer('delete-task', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.success).toBe(true);
        expect(response.taskId).toBe(taskId);
        expect(response.message).toContain('deleted successfully');

        // Verify task is actually deleted by trying to get it
        const getResult = await client.callTool({
          name: 'get-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: taskId
          }
        });
        const getResponse = JSON.parse((getResult.content as any)[0].text);
        // Should return an error or empty result
        expect(getResponse.error || getResponse.task?.deleted).toBeTruthy();
      } catch (error) {
        endTimer('delete-task', startTime, false, String(error));
        throw error;
      }
    });
  });

  describe('Error Handling', () => {
    it('should handle non-existent task gracefully', async () => {
      const startTime = startTimer('get-task-not-found');

      try {
        const result = await client.callTool({
          name: 'get-task',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: '@default',
            taskId: 'nonexistent-task-id-12345'
          }
        });

        endTimer('get-task-not-found', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        // Should return an error response
        expect(response.error || response.message?.toLowerCase().includes('not found')).toBeTruthy();
      } catch (error) {
        // Error is also acceptable for not found
        endTimer('get-task-not-found', startTime, true);
        expect(String(error)).toMatch(/not found|404|invalid|MCP error/i);
      }
    });

    it('should handle invalid task list ID gracefully', async () => {
      const startTime = startTimer('list-tasks-invalid-list');

      try {
        const result = await client.callTool({
          name: 'list-tasks',
          arguments: {
            account: TEST_ACCOUNT,
            taskListId: 'invalid-task-list-id-99999'
          }
        });

        endTimer('list-tasks-invalid-list', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        // Should return an error response
        expect(response.error || response.message?.toLowerCase().includes('not found')).toBeTruthy();
      } catch (error) {
        // Error is also acceptable
        endTimer('list-tasks-invalid-list', startTime, true);
        expect(String(error)).toMatch(/not found|404|invalid|MCP error/i);
      }
    });
  });

  describe('Multi-Account Support', () => {
    it('should support account parameter in list-task-lists', async () => {
      const startTime = startTimer('list-task-lists-account');

      try {
        // Use test-primary account if available
        const result = await client.callTool({
          name: 'list-task-lists',
          arguments: {
            account: 'test-primary'
          }
        });

        endTimer('list-task-lists-account', startTime, true);

        expect(result.content).toBeDefined();
        const response = JSON.parse((result.content as any)[0].text);
        expect(response.taskLists).toBeDefined();
        expect(response.accountId).toBe('test-primary');
      } catch (error) {
        // If test-primary account doesn't exist or doesn't have Tasks scope, that's OK
        endTimer('list-task-lists-account', startTime, true);
        const errorStr = String(error);
        if (!errorStr.includes('not found') && !errorStr.includes('scope')) {
          throw error;
        }
      }
    });
  });
});

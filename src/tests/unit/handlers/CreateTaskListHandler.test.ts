import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CreateTaskListHandler } from '../../../handlers/core/CreateTaskListHandler.js';
import { OAuth2Client } from 'google-auth-library';
import { tasks_v1 } from 'googleapis';

describe('CreateTaskListHandler', () => {
  let handler: CreateTaskListHandler;
  let mockAuth: OAuth2Client;
  let mockTasks: {
    tasklists: {
      insert: ReturnType<typeof vi.fn>;
    };
  };

  beforeEach(() => {
    handler = new CreateTaskListHandler();
    mockAuth = {} as OAuth2Client;

    // Mock the getTasks method to return our mock tasks client
    mockTasks = {
      tasklists: {
        insert: vi.fn()
      }
    };
    vi.spyOn(handler as any, 'getTasks').mockReturnValue(mockTasks);
  });

  describe('successful task list creation', () => {
    it('should create a task list with minimal parameters', async () => {
      const mockResponse: tasks_v1.Schema$TaskList = {
        id: 'tasklist123',
        title: 'My Task List',
        updated: '2024-01-15T10:00:00Z'
      };

      mockTasks.tasklists.insert.mockResolvedValue({ data: mockResponse });

      const accounts = new Map([['default', mockAuth]]);
      const result = await handler.runTool(
        {
          title: 'My Task List'
        },
        accounts
      );

      expect(result.content).toHaveLength(1);
      expect(result.content[0].type).toBe('text');

      const response = JSON.parse(result.content[0].text);
      expect(response.taskList.id).toBe('tasklist123');
      expect(response.taskList.title).toBe('My Task List');
      expect(response.message).toBe('Task list "My Task List" created successfully');
      expect(response.accountId).toBe('default');

      expect(mockTasks.tasklists.insert).toHaveBeenCalledWith({
        requestBody: {
          title: 'My Task List'
        }
      });
    });

    it('should create a task list with a specific account', async () => {
      const mockResponse: tasks_v1.Schema$TaskList = {
        id: 'tasklist456',
        title: 'Work Tasks',
        updated: '2024-01-15T10:00:00Z'
      };

      mockTasks.tasklists.insert.mockResolvedValue({ data: mockResponse });

      const accounts = new Map([
        ['personal', mockAuth],
        ['work', mockAuth]
      ]);

      const result = await handler.runTool(
        {
          title: 'Work Tasks',
          account: 'work'
        },
        accounts
      );

      expect(result.content).toHaveLength(1);
      const response = JSON.parse(result.content[0].text);
      expect(response.taskList.id).toBe('tasklist456');
      expect(response.accountId).toBe('work');
    });

    it('should handle task list titles with special characters', async () => {
      const mockResponse: tasks_v1.Schema$TaskList = {
        id: 'tasklist789',
        title: 'Tasks: High Priority! (Q1 2024)',
        updated: '2024-01-15T10:00:00Z'
      };

      mockTasks.tasklists.insert.mockResolvedValue({ data: mockResponse });

      const accounts = new Map([['default', mockAuth]]);
      const result = await handler.runTool(
        {
          title: 'Tasks: High Priority! (Q1 2024)'
        },
        accounts
      );

      expect(result.content).toHaveLength(1);
      const response = JSON.parse(result.content[0].text);
      expect(response.taskList.title).toBe('Tasks: High Priority! (Q1 2024)');
    });
  });

  describe('error handling', () => {
    it('should handle API errors gracefully', async () => {
      mockTasks.tasklists.insert.mockRejectedValue(
        new Error('API Error: Request failed')
      );

      const accounts = new Map([['default', mockAuth]]);

      // Mock handleGoogleApiError to return a proper error response
      vi.spyOn(handler as any, 'handleGoogleApiError').mockReturnValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'API Error: Request failed',
            code: 'GOOGLE_API_ERROR'
          })
        }],
        isError: true
      });

      const result = await handler.runTool(
        {
          title: 'My Task List'
        },
        accounts
      );

      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
      const response = JSON.parse(result.content[0].text);
      expect(response.error).toBeDefined();
    });

    it('should handle missing response data', async () => {
      mockTasks.tasklists.insert.mockResolvedValue({ data: null });

      const accounts = new Map([['default', mockAuth]]);

      // Mock handleGoogleApiError to return a proper error response
      vi.spyOn(handler as any, 'handleGoogleApiError').mockReturnValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Failed to create task list - no data returned',
            code: 'INTERNAL_ERROR'
          })
        }],
        isError: true
      });

      const result = await handler.runTool(
        {
          title: 'My Task List'
        },
        accounts
      );

      // Should be handled by handleGoogleApiError
      expect(result.content[0].type).toBe('text');
      expect(result.isError).toBe(true);
    });

    it('should handle account not found', async () => {
      const accounts = new Map([['default', mockAuth]]);

      // Mock getClientForAccount to throw an error
      vi.spyOn(handler as any, 'getClientForAccount').mockImplementation(() => {
        throw new Error('Account not found: work');
      });

      // Mock handleGoogleApiError to return a proper error response
      vi.spyOn(handler as any, 'handleGoogleApiError').mockReturnValue({
        content: [{
          type: 'text',
          text: JSON.stringify({
            error: 'Account not found: work',
            code: 'ACCOUNT_NOT_FOUND'
          })
        }],
        isError: true
      });

      const result = await handler.runTool(
        {
          title: 'My Task List',
          account: 'work'
        },
        accounts
      );

      expect(result.isError).toBe(true);
    });
  });

  describe('response format', () => {
    it('should include all required fields in the response', async () => {
      const mockResponse: tasks_v1.Schema$TaskList = {
        id: 'tasklist123',
        title: 'My Task List',
        updated: '2024-01-15T10:00:00Z',
        selfLink: 'https://www.googleapis.com/tasks/v1/users/@me/lists/tasklist123'
      };

      mockTasks.tasklists.insert.mockResolvedValue({ data: mockResponse });

      const accounts = new Map([['default', mockAuth]]);
      const result = await handler.runTool(
        {
          title: 'My Task List'
        },
        accounts
      );

      const response = JSON.parse(result.content[0].text);
      expect(response).toHaveProperty('taskList');
      expect(response).toHaveProperty('accountId');
      expect(response).toHaveProperty('message');
      expect(response.taskList).toHaveProperty('id');
      expect(response.taskList).toHaveProperty('title');
      expect(response.taskList).toHaveProperty('updated');
      expect(response.taskList).toHaveProperty('selfLink');
    });
  });
});

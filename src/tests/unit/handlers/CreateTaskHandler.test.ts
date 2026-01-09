import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { CreateTaskHandler } from '../../../handlers/core/CreateTaskHandler.js';

// Mock tasks.insert function
const mockTasksInsert = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasks: {
        insert: mockTasksInsert
      }
    })
  }
}));

describe('CreateTaskHandler', () => {
  let handler: CreateTaskHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new CreateTaskHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should create a task successfully', async () => {
    const mockTask = {
      data: {
        id: 'new-task-id',
        title: 'Buy groceries',
        status: 'needsAction',
        notes: 'Milk, eggs, bread',
        due: '2024-01-20T00:00:00Z'
      }
    };

    mockTasksInsert.mockResolvedValue(mockTask);

    const result = await handler.runTool({
      account: 'work',
      title: 'Buy groceries',
      notes: 'Milk, eggs, bread',
      due: '2024-01-20T00:00:00Z'
    }, mockAccounts);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const response = JSON.parse(result.content[0].text);
    expect(response.task.id).toBe('new-task-id');
    expect(response.task.title).toBe('Buy groceries');
    expect(response.task.notes).toBe('Milk, eggs, bread');
    expect(response.accountId).toBe('work');
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksInsert.mockResolvedValue({
      data: { id: 'task1', title: 'Test Task' }
    });

    await handler.runTool({ account: 'work', title: 'Test Task' }, mockAccounts);

    expect(mockTasksInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: '@default'
      })
    );
  });

  it('should use specified taskListId', async () => {
    mockTasksInsert.mockResolvedValue({
      data: { id: 'task1', title: 'Test Task' }
    });

    await handler.runTool({
      account: 'work',
      title: 'Test Task',
      taskListId: 'custom-list'
    }, mockAccounts);

    expect(mockTasksInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: 'custom-list'
      })
    );
  });

  it('should pass title, notes, and due in request body', async () => {
    mockTasksInsert.mockResolvedValue({
      data: { id: 'task1', title: 'Test Task' }
    });

    await handler.runTool({
      account: 'work',
      title: 'My Task',
      notes: 'Task notes',
      due: '2024-02-01T00:00:00Z'
    }, mockAccounts);

    expect(mockTasksInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: {
          title: 'My Task',
          notes: 'Task notes',
          due: '2024-02-01T00:00:00Z'
        }
      })
    );
  });

  it('should create task with only title', async () => {
    mockTasksInsert.mockResolvedValue({
      data: { id: 'task1', title: 'Simple Task', status: 'needsAction' }
    });

    const result = await handler.runTool({
      account: 'work',
      title: 'Simple Task'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.task.title).toBe('Simple Task');
  });

  it('should throw error when creation fails', async () => {
    mockTasksInsert.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', title: 'Test Task' }, mockAccounts)
    ).rejects.toThrow('Failed to create task - no data returned');
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent', title: 'Test Task' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });

  describe('recurring tasks', () => {
    it('should create daily recurring tasks with count', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,  // Return the title that was passed in
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Daily Task',
        due: '2024-01-15',
        recurrence: {
          frequency: 'daily',
          interval: 1,
          count: 5
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(5);
      expect(response.recurringInfo).toEqual({
        frequency: 'daily',
        interval: 1,
        occurrencesCreated: 5
      });
      expect(mockTasksInsert).toHaveBeenCalledTimes(5);

      // Check that titles are numbered
      expect(response.tasks[0].title).toContain('#1/5');
      expect(response.tasks[4].title).toContain('#5/5');
    });

    it('should create weekly recurring tasks', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Weekly Meeting',
        due: '2024-01-15T00:00:00Z',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          count: 3
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(3);
      expect(mockTasksInsert).toHaveBeenCalledTimes(3);
    });

    it('should create monthly recurring tasks', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Monthly Report',
        due: '2024-01-01',
        recurrence: {
          frequency: 'monthly',
          interval: 1,
          count: 3
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(3);
    });

    it('should create yearly recurring tasks', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Annual Review',
        due: '2024-12-31',
        recurrence: {
          frequency: 'yearly',
          interval: 1,
          count: 3
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(3);
    });

    it('should create recurring tasks with until date', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Limited Task',
        due: '2024-01-01',
        recurrence: {
          frequency: 'weekly',
          interval: 1,
          until: '2024-01-21'  // 3 weeks
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      // Should create tasks for Jan 1, 8, 15 (3 tasks, Jan 22 is beyond until date)
      expect(response.tasks.length).toBeGreaterThan(0);
      expect(response.tasks.length).toBeLessThanOrEqual(3);
    });

    it('should create recurring tasks with custom interval', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Every 2 Weeks',
        due: '2024-01-01',
        recurrence: {
          frequency: 'weekly',
          interval: 2,
          count: 3
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(3);
      expect(response.recurringInfo.interval).toBe(2);
    });

    it('should throw error for recurring tasks without due date', async () => {
      await expect(
        handler.runTool({
          account: 'work',
          title: 'Task',
          recurrence: {
            frequency: 'daily',
            interval: 1,
            count: 3
          }
        }, mockAccounts)
      ).rejects.toThrow('Due date is required for recurring tasks');
    });

    it('should handle date-only format in recurring tasks', async () => {
      mockTasksInsert.mockImplementation((params: any) => ({
        data: {
          id: `task-${Date.now()}`,
          title: params.requestBody.title,
          status: 'needsAction',
          due: '2024-01-15T00:00:00.000Z'
        }
      }));

      const result = await handler.runTool({
        account: 'work',
        title: 'Date Only Task',
        due: '2024-01-15',  // Date-only format
        recurrence: {
          frequency: 'daily',
          interval: 1,
          count: 2
        }
      }, mockAccounts);

      const response = JSON.parse(result.content[0].text);
      expect(response.tasks).toHaveLength(2);
    });
  });
});

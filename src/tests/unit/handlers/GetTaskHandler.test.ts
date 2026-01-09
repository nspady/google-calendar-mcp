import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { GetTaskHandler } from '../../../handlers/core/GetTaskHandler.js';

// Mock tasks.get function
const mockTasksGet = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasks: {
        get: mockTasksGet
      }
    })
  }
}));

describe('GetTaskHandler', () => {
  let handler: GetTaskHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new GetTaskHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should get a task successfully', async () => {
    const mockTask = {
      data: {
        id: 'task1',
        title: 'Buy groceries',
        status: 'needsAction',
        due: '2024-01-20T00:00:00Z',
        notes: 'Milk, eggs, bread',
        position: '00000000000000000001',
        updated: '2024-01-15T10:00:00Z',
        selfLink: 'https://www.googleapis.com/tasks/v1/lists/@default/tasks/task1'
      }
    };

    mockTasksGet.mockResolvedValue(mockTask);

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const response = JSON.parse(result.content[0].text);
    expect(response.task.id).toBe('task1');
    expect(response.task.title).toBe('Buy groceries');
    expect(response.task.status).toBe('needsAction');
    expect(response.task.due).toBe('2024-01-20T00:00:00Z');
    expect(response.task.notes).toBe('Milk, eggs, bread');
    expect(response.accountId).toBe('work');
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Test Task' }
    });

    await handler.runTool({ account: 'work', taskId: 'task1' }, mockAccounts);

    expect(mockTasksGet).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: '@default',
        task: 'task1'
      })
    );
  });

  it('should use specified taskListId', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Test Task' }
    });

    await handler.runTool({
      account: 'work',
      taskId: 'task1',
      taskListId: 'custom-list'
    }, mockAccounts);

    expect(mockTasksGet).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: 'custom-list',
        task: 'task1'
      })
    );
  });

  it('should throw error when task not found', async () => {
    mockTasksGet.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', taskId: 'nonexistent' }, mockAccounts)
    ).rejects.toThrow('Task not found: nonexistent');
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent', taskId: 'task1' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });

  it('should handle completed task', async () => {
    const mockTask = {
      data: {
        id: 'task1',
        title: 'Completed Task',
        status: 'completed',
        completed: '2024-01-15T10:00:00Z'
      }
    };

    mockTasksGet.mockResolvedValue(mockTask);

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.task.status).toBe('completed');
    expect(response.task.completed).toBe('2024-01-15T10:00:00Z');
  });
});

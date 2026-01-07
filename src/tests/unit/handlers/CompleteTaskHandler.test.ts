import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { CompleteTaskHandler } from '../../../handlers/core/CompleteTaskHandler.js';

// Mock tasks functions
const mockTasksGet = vi.fn();
const mockTasksUpdate = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasks: {
        get: mockTasksGet,
        update: mockTasksUpdate
      }
    })
  }
}));

describe('CompleteTaskHandler', () => {
  let handler: CompleteTaskHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new CompleteTaskHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should mark task as completed successfully', async () => {
    const existingTask = {
      data: {
        id: 'task1',
        title: 'Buy groceries',
        status: 'needsAction',
        notes: 'Milk, eggs'
      }
    };

    const completedTask = {
      data: {
        id: 'task1',
        title: 'Buy groceries',
        status: 'completed',
        completed: '2024-01-15T10:00:00Z'
      }
    };

    mockTasksGet.mockResolvedValue(existingTask);
    mockTasksUpdate.mockResolvedValue(completedTask);

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    expect(result.content).toHaveLength(1);
    const response = JSON.parse(result.content[0].text);
    expect(response.task.status).toBe('completed');
    expect(response.message).toContain('marked as completed');
    expect(response.completedAt).toBeDefined();
  });

  it('should return message if task already completed', async () => {
    const alreadyCompletedTask = {
      data: {
        id: 'task1',
        title: 'Done Task',
        status: 'completed',
        completed: '2024-01-10T10:00:00Z'
      }
    };

    mockTasksGet.mockResolvedValue(alreadyCompletedTask);

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.message).toBe('Task was already completed');
    expect(response.task.status).toBe('completed');

    // Should not call update if already completed
    expect(mockTasksUpdate).not.toHaveBeenCalled();
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'completed' }
    });

    await handler.runTool({ account: 'work', taskId: 'task1' }, mockAccounts);

    expect(mockTasksGet).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: '@default' })
    );
  });

  it('should use specified taskListId', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'completed' }
    });

    await handler.runTool({
      account: 'work',
      taskId: 'task1',
      taskListId: 'custom-list'
    }, mockAccounts);

    expect(mockTasksGet).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: 'custom-list' })
    );
  });

  it('should throw error when task not found', async () => {
    mockTasksGet.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', taskId: 'nonexistent' }, mockAccounts)
    ).rejects.toThrow('Task not found: nonexistent');
  });

  it('should throw error when update fails', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', taskId: 'task1' }, mockAccounts)
    ).rejects.toThrow('Failed to complete task - no data returned');
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent', taskId: 'task1' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });

  it('should set status to completed in update request', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'completed' }
    });

    await handler.runTool({ account: 'work', taskId: 'task1' }, mockAccounts);

    expect(mockTasksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          status: 'completed'
        })
      })
    );
  });
});

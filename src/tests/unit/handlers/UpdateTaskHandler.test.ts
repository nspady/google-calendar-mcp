import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { UpdateTaskHandler } from '../../../handlers/core/UpdateTaskHandler.js';

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

describe('UpdateTaskHandler', () => {
  let handler: UpdateTaskHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new UpdateTaskHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should update task title successfully', async () => {
    const existingTask = {
      data: {
        id: 'task1',
        title: 'Old Title',
        status: 'needsAction'
      }
    };

    const updatedTask = {
      data: {
        id: 'task1',
        title: 'New Title',
        status: 'needsAction'
      }
    };

    mockTasksGet.mockResolvedValue(existingTask);
    mockTasksUpdate.mockResolvedValue(updatedTask);

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1',
      title: 'New Title'
    }, mockAccounts);

    expect(result.content).toHaveLength(1);
    const response = JSON.parse(result.content[0].text);
    expect(response.task.title).toBe('New Title');
    expect(response.accountId).toBe('work');
  });

  it('should update task notes', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', notes: 'Updated notes', status: 'needsAction' }
    });

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1',
      notes: 'Updated notes'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.task.notes).toBe('Updated notes');
  });

  it('should update task due date', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', due: '2024-02-01T00:00:00Z', status: 'needsAction' }
    });

    await handler.runTool({
      account: 'work',
      taskId: 'task1',
      due: '2024-02-01T00:00:00Z'
    }, mockAccounts);

    expect(mockTasksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        requestBody: expect.objectContaining({
          due: '2024-02-01T00:00:00Z'
        })
      })
    );
  });

  it('should update task status', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'completed', completed: '2024-01-15T10:00:00Z' }
    });

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1',
      status: 'completed'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.task.status).toBe('completed');
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({
      data: { id: 'task1', title: 'Updated', status: 'needsAction' }
    });

    await handler.runTool({
      account: 'work',
      taskId: 'task1',
      title: 'Updated'
    }, mockAccounts);

    expect(mockTasksGet).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: '@default' })
    );
    expect(mockTasksUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: '@default' })
    );
  });

  it('should throw error when task not found', async () => {
    mockTasksGet.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', taskId: 'nonexistent', title: 'New' }, mockAccounts)
    ).rejects.toThrow('Task not found: nonexistent');
  });

  it('should throw error when update fails', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task', status: 'needsAction' }
    });
    mockTasksUpdate.mockResolvedValue({ data: null });

    await expect(
      handler.runTool({ account: 'work', taskId: 'task1', title: 'New' }, mockAccounts)
    ).rejects.toThrow('Failed to update task - no data returned');
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent', taskId: 'task1', title: 'New' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });
});

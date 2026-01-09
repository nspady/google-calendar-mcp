import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { DeleteTaskHandler } from '../../../handlers/core/DeleteTaskHandler.js';

// Mock tasks functions
const mockTasksGet = vi.fn();
const mockTasksDelete = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasks: {
        get: mockTasksGet,
        delete: mockTasksDelete
      }
    })
  }
}));

describe('DeleteTaskHandler', () => {
  let handler: DeleteTaskHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new DeleteTaskHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should delete task successfully', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task to delete' }
    });
    mockTasksDelete.mockResolvedValue({});

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    expect(result.content).toHaveLength(1);
    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(response.taskId).toBe('task1');
    expect(response.message).toContain('Task to delete');
    expect(response.message).toContain('deleted successfully');
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task' }
    });
    mockTasksDelete.mockResolvedValue({});

    await handler.runTool({ account: 'work', taskId: 'task1' }, mockAccounts);

    expect(mockTasksDelete).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: '@default' })
    );
  });

  it('should use specified taskListId', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task' }
    });
    mockTasksDelete.mockResolvedValue({});

    await handler.runTool({
      account: 'work',
      taskId: 'task1',
      taskListId: 'custom-list'
    }, mockAccounts);

    expect(mockTasksDelete).toHaveBeenCalledWith(
      expect.objectContaining({ tasklist: 'custom-list' })
    );
  });

  it('should proceed with deletion even if get task fails', async () => {
    // Simulate task not found but proceed with deletion anyway
    mockTasksGet.mockRejectedValue(new Error('Not found'));
    mockTasksDelete.mockResolvedValue({});

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    // Should still succeed - uses taskId as title fallback
    const response = JSON.parse(result.content[0].text);
    expect(response.success).toBe(true);
    expect(response.taskId).toBe('task1');
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent', taskId: 'task1' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });

  it('should include account ID in response', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task' }
    });
    mockTasksDelete.mockResolvedValue({});

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.accountId).toBe('work');
  });

  it('should include taskListId in response', async () => {
    mockTasksGet.mockResolvedValue({
      data: { id: 'task1', title: 'Task' }
    });
    mockTasksDelete.mockResolvedValue({});

    const result = await handler.runTool({
      account: 'work',
      taskId: 'task1',
      taskListId: 'my-list'
    }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.taskListId).toBe('my-list');
  });
});

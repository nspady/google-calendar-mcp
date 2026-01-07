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
});

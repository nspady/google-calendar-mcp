import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { ListTasksHandler } from '../../../handlers/core/ListTasksHandler.js';

// Mock tasks.list function
const mockTasksList = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasks: {
        list: mockTasksList
      }
    })
  }
}));

describe('ListTasksHandler', () => {
  let handler: ListTasksHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new ListTasksHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should list tasks successfully', async () => {
    const mockTasks = {
      data: {
        items: [
          {
            id: 'task1',
            title: 'Buy groceries',
            status: 'needsAction',
            due: '2024-01-20T00:00:00Z',
            notes: 'Milk, eggs, bread'
          },
          {
            id: 'task2',
            title: 'Call mom',
            status: 'completed',
            completed: '2024-01-15T10:00:00Z'
          }
        ]
      }
    };

    mockTasksList.mockResolvedValue(mockTasks);

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const response = JSON.parse(result.content[0].text);
    expect(response.tasks).toHaveLength(2);
    expect(response.totalCount).toBe(2);
    expect(response.accountId).toBe('work');
    expect(response.tasks[0].id).toBe('task1');
    expect(response.tasks[0].title).toBe('Buy groceries');
    expect(response.tasks[0].status).toBe('needsAction');
    expect(response.tasks[1].id).toBe('task2');
    expect(response.tasks[1].status).toBe('completed');
  });

  it('should use @default task list when no taskListId specified', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    await handler.runTool({ account: 'work' }, mockAccounts);

    expect(mockTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: '@default'
      })
    );
  });

  it('should use specified taskListId', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    await handler.runTool({ account: 'work', taskListId: 'custom-list' }, mockAccounts);

    expect(mockTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        tasklist: 'custom-list'
      })
    );
  });

  it('should filter by showCompleted', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    await handler.runTool({ account: 'work', showCompleted: false }, mockAccounts);

    expect(mockTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        showCompleted: false
      })
    );
  });

  it('should filter by dueMin and dueMax', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    await handler.runTool({
      account: 'work',
      dueMin: '2024-01-01T00:00:00Z',
      dueMax: '2024-01-31T23:59:59Z'
    }, mockAccounts);

    expect(mockTasksList).toHaveBeenCalledWith(
      expect.objectContaining({
        dueMin: '2024-01-01T00:00:00Z',
        dueMax: '2024-01-31T23:59:59Z'
      })
    );
  });

  it('should return empty list when no tasks exist', async () => {
    mockTasksList.mockResolvedValue({ data: { items: [] } });

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.tasks).toHaveLength(0);
    expect(response.totalCount).toBe(0);
  });

  it('should handle null items response', async () => {
    mockTasksList.mockResolvedValue({ data: {} });

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.tasks).toHaveLength(0);
    expect(response.totalCount).toBe(0);
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });
});

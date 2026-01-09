import { describe, it, expect, vi, beforeEach } from 'vitest';
import { OAuth2Client } from 'google-auth-library';
import { ListTaskListsHandler } from '../../../handlers/core/ListTaskListsHandler.js';

// Mock tasklists.list function
const mockTasklistsList = vi.fn();

// Mock googleapis
vi.mock('googleapis', () => ({
  google: {
    tasks: () => ({
      tasklists: {
        list: mockTasklistsList
      }
    })
  }
}));

describe('ListTaskListsHandler', () => {
  let handler: ListTaskListsHandler;
  let mockAccounts: Map<string, OAuth2Client>;
  let mockClient: OAuth2Client;

  beforeEach(() => {
    vi.clearAllMocks();

    handler = new ListTaskListsHandler();
    mockClient = {
      credentials: { access_token: 'test-token' }
    } as unknown as OAuth2Client;

    mockAccounts = new Map([['work', mockClient]]);
  });

  it('should list task lists successfully', async () => {
    const mockTaskLists = {
      data: {
        items: [
          {
            id: 'list1',
            title: 'My Tasks',
            updated: '2024-01-15T10:00:00Z',
            selfLink: 'https://www.googleapis.com/tasks/v1/users/@me/lists/list1'
          },
          {
            id: 'list2',
            title: 'Work Tasks',
            updated: '2024-01-14T10:00:00Z',
            selfLink: 'https://www.googleapis.com/tasks/v1/users/@me/lists/list2'
          }
        ]
      }
    };

    mockTasklistsList.mockResolvedValue(mockTaskLists);

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    expect(result.content).toHaveLength(1);
    expect(result.content[0].type).toBe('text');

    const response = JSON.parse(result.content[0].text);
    expect(response.taskLists).toHaveLength(2);
    expect(response.totalCount).toBe(2);
    expect(response.accountId).toBe('work');
    expect(response.taskLists[0].id).toBe('list1');
    expect(response.taskLists[0].title).toBe('My Tasks');
    expect(response.taskLists[1].id).toBe('list2');
    expect(response.taskLists[1].title).toBe('Work Tasks');
  });

  it('should return empty list when no task lists exist', async () => {
    mockTasklistsList.mockResolvedValue({ data: { items: [] } });

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.taskLists).toHaveLength(0);
    expect(response.totalCount).toBe(0);
  });

  it('should handle null items response', async () => {
    mockTasklistsList.mockResolvedValue({ data: {} });

    const result = await handler.runTool({ account: 'work' }, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.taskLists).toHaveLength(0);
    expect(response.totalCount).toBe(0);
  });

  it('should use first account when none specified', async () => {
    mockTasklistsList.mockResolvedValue({
      data: {
        items: [{ id: 'list1', title: 'Tasks' }]
      }
    });

    const result = await handler.runTool({}, mockAccounts);

    const response = JSON.parse(result.content[0].text);
    expect(response.taskLists).toHaveLength(1);
  });

  it('should throw error when no accounts available', async () => {
    const emptyAccounts = new Map<string, OAuth2Client>();

    await expect(handler.runTool({}, emptyAccounts)).rejects.toThrow(
      'No authenticated accounts available'
    );
  });

  it('should throw error for invalid account', async () => {
    await expect(
      handler.runTool({ account: 'nonexistent' }, mockAccounts)
    ).rejects.toThrow('Account "nonexistent" not found');
  });
});

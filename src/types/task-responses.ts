/**
 * Structured response types for Google Tasks API tools.
 *
 * These types define the shape of responses returned by task handlers,
 * ensuring consistent and well-typed API responses.
 */

import { FormattedTask, FormattedTaskList } from '../handlers/core/BaseTaskHandler.js';

/**
 * Response for list-task-lists tool
 */
export interface ListTaskListsResponse {
  taskLists: FormattedTaskList[];
  totalCount: number;
  accountId: string;
}

/**
 * Response for list-tasks tool
 */
export interface ListTasksResponse {
  tasks: FormattedTask[];
  totalCount: number;
  taskListId: string;
  taskListTitle?: string;
  accountId: string;
  filters?: {
    showCompleted: boolean;
    showHidden: boolean;
    dueMin?: string;
    dueMax?: string;
  };
}

/**
 * Response for get-task tool
 */
export interface GetTaskResponse {
  task: FormattedTask;
  taskListId: string;
  accountId: string;
}

/**
 * Response for create-task tool
 */
export interface CreateTaskResponse {
  task: FormattedTask;
  taskListId: string;
  accountId: string;
  message: string;
}

/**
 * Response for update-task tool
 */
export interface UpdateTaskResponse {
  task: FormattedTask;
  taskListId: string;
  accountId: string;
  message: string;
  updatedFields: string[];
}

/**
 * Response for complete-task tool
 */
export interface CompleteTaskResponse {
  task: FormattedTask;
  taskListId: string;
  accountId: string;
  message: string;
  completedAt: string;
}

/**
 * Response for delete-task tool
 */
export interface DeleteTaskResponse {
  success: boolean;
  taskId: string;
  taskListId: string;
  accountId: string;
  message: string;
}

/**
 * Common error response structure for task operations
 */
export interface TaskErrorResponse {
  error: string;
  code: string;
  taskId?: string;
  taskListId?: string;
  accountId?: string;
}

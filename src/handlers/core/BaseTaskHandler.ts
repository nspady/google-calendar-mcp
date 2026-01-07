import { OAuth2Client } from "google-auth-library";
import { tasks_v1, google } from "googleapis";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { getCredentialsProjectId } from "../../auth/utils.js";

/**
 * Base handler class for Google Tasks API tools.
 * Extends BaseToolHandler with Tasks-specific functionality.
 */
export abstract class BaseTaskHandler<TArgs = any> extends BaseToolHandler<TArgs> {
  /**
   * Get a Google Tasks API client instance.
   *
   * @param auth - OAuth2Client for authentication
   * @returns Tasks API v1 client
   */
  protected getTasks(auth: OAuth2Client): tasks_v1.Tasks {
    // Try to get project ID from credentials file for quota project header
    const quotaProjectId = getCredentialsProjectId();

    const config: any = {
      version: 'v1',
      auth,
      timeout: 3000 // 3 second timeout for API calls
    };

    // Add quota project ID if available
    if (quotaProjectId) {
      config.quotaProjectId = quotaProjectId;
    }

    return google.tasks(config);
  }

  /**
   * Get the default task list ID for an account.
   * The Google Tasks API uses '@default' to reference the user's default task list.
   *
   * @param taskListId - Task list ID from input, or undefined
   * @returns The task list ID to use (defaults to '@default')
   */
  protected getTaskListId(taskListId?: string): string {
    return taskListId || '@default';
  }

  /**
   * Format a task for structured response output.
   *
   * @param task - Raw task from Google Tasks API
   * @returns Formatted task object
   */
  protected formatTask(task: tasks_v1.Schema$Task): FormattedTask {
    return {
      id: task.id || '',
      title: task.title || '',
      notes: task.notes || undefined,
      status: task.status as 'needsAction' | 'completed' || 'needsAction',
      due: task.due || undefined,
      completed: task.completed || undefined,
      parent: task.parent || undefined,
      position: task.position || undefined,
      updated: task.updated || undefined,
      selfLink: task.selfLink || undefined,
      hidden: task.hidden || false,
      deleted: task.deleted || false
    };
  }

  /**
   * Format a task list for structured response output.
   *
   * @param taskList - Raw task list from Google Tasks API
   * @returns Formatted task list object
   */
  protected formatTaskList(taskList: tasks_v1.Schema$TaskList): FormattedTaskList {
    return {
      id: taskList.id || '',
      title: taskList.title || '',
      updated: taskList.updated || undefined,
      selfLink: taskList.selfLink || undefined
    };
  }
}

/**
 * Formatted task structure for API responses.
 */
export interface FormattedTask {
  id: string;
  title: string;
  notes?: string;
  status: 'needsAction' | 'completed';
  due?: string;
  completed?: string;
  parent?: string;
  position?: string;
  updated?: string;
  selfLink?: string;
  hidden: boolean;
  deleted: boolean;
}

/**
 * Formatted task list structure for API responses.
 */
export interface FormattedTaskList {
  id: string;
  title: string;
  updated?: string;
  selfLink?: string;
}

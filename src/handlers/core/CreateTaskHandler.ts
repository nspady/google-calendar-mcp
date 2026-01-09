import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { CreateTaskInput } from "../../tools/task-schemas.js";
import { CreateTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for create-task tool.
 * Creates a new task in the specified task list.
 * Supports recurring tasks by creating multiple individual tasks.
 */
export class CreateTaskHandler extends BaseTaskHandler<CreateTaskInput> {
  async runTool(
    args: CreateTaskInput,
    accounts: Map<string, OAuth2Client>
  ): Promise<CallToolResult> {
    try {
      // Get the client for the specified account or the only available account
      const client = this.getClientForAccount(args.account, accounts);

      // Get the account ID that was used
      const accountId = args.account ||
        (accounts.size === 1 ? Array.from(accounts.keys())[0] : 'default');

      // Get Tasks API client
      const tasks = this.getTasks(client);

      // Get the task list ID (defaults to @default)
      const taskListId = this.getTaskListId(args.taskListId);

      // Check if this is a recurring task
      if (args.recurrence) {
        return await this.createRecurringTasks(tasks, taskListId, accountId, args);
      }

      // Single task creation (non-recurring)
      const formattedTask = await this.createSingleTask(tasks, taskListId, args);

      const result: CreateTaskResponse = {
        task: formattedTask,
        taskListId,
        accountId,
        message: `Task "${args.title}" created successfully`
      };

      return {
        content: [{
          type: "text",
          text: JSON.stringify(result, null, 2)
        }]
      };
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }

  /**
   * Create a single task (helper method).
   */
  private async createSingleTask(
    tasks: any,
    taskListId: string,
    args: CreateTaskInput
  ) {
    // Build the task request body
    const taskBody: any = {
      title: args.title
    };

    if (args.notes) {
      taskBody.notes = args.notes;
    }

    if (args.due) {
      // Google Tasks API expects RFC 3339 format for due date
      // If only a date is provided (YYYY-MM-DD), convert to RFC 3339
      if (/^\d{4}-\d{2}-\d{2}$/.test(args.due)) {
        taskBody.due = `${args.due}T00:00:00.000Z`;
      } else {
        taskBody.due = args.due;
      }
    }

    // Build query parameters for positioning
    const queryParams: any = {
      tasklist: taskListId
    };

    if (args.parent) {
      queryParams.parent = args.parent;
    }

    if (args.previous) {
      queryParams.previous = args.previous;
    }

    // Create the task
    const response = await tasks.tasks.insert({
      ...queryParams,
      requestBody: taskBody
    });

    if (!response.data) {
      throw new Error('Failed to create task - no data returned');
    }

    return this.formatTask(response.data);
  }

  /**
   * Create multiple recurring tasks based on recurrence pattern.
   */
  private async createRecurringTasks(
    tasks: any,
    taskListId: string,
    accountId: string,
    args: CreateTaskInput
  ): Promise<CallToolResult> {
    if (!args.recurrence) {
      throw new Error('Recurrence pattern not provided');
    }

    // Parse base due date
    if (!args.due) {
      throw new Error('Due date is required for recurring tasks');
    }

    const baseDueDate = this.parseDueDate(args.due);
    const dueDates = this.calculateRecurringDueDates(baseDueDate, args.recurrence);

    // Create tasks for each occurrence
    const createdTasks = [];
    let occurrenceNum = 1;

    for (const dueDate of dueDates) {
      const taskTitle = dueDates.length > 1
        ? `${args.title} (#${occurrenceNum}/${dueDates.length})`
        : args.title;

      const taskArgs = {
        ...args,
        title: taskTitle,
        due: this.formatDueDate(dueDate),
        recurrence: undefined // Remove recurrence to use createSingleTask
      };

      const formattedTask = await this.createSingleTask(tasks, taskListId, taskArgs);
      createdTasks.push(formattedTask);
      occurrenceNum++;
    }

    const result: CreateTaskResponse = {
      tasks: createdTasks,
      taskListId,
      accountId,
      message: `Created ${createdTasks.length} recurring tasks: "${args.title}"`,
      recurringInfo: {
        frequency: args.recurrence.frequency,
        interval: args.recurrence.interval || 1,
        occurrencesCreated: createdTasks.length
      }
    };

    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  /**
   * Parse due date string to Date object.
   */
  private parseDueDate(dueStr: string): Date {
    // Handle date-only format (YYYY-MM-DD)
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueStr)) {
      return new Date(dueStr + 'T00:00:00.000Z');
    }
    return new Date(dueStr);
  }

  /**
   * Format Date object back to RFC 3339 string.
   */
  private formatDueDate(date: Date): string {
    return date.toISOString();
  }

  /**
   * Calculate due dates for recurring tasks based on recurrence pattern.
   */
  private calculateRecurringDueDates(
    baseDate: Date,
    recurrence: NonNullable<CreateTaskInput['recurrence']>
  ): Date[] {
    const dates: Date[] = [];
    const { frequency, interval = 1, count, until } = recurrence;

    // Determine how many occurrences to create
    let maxOccurrences = count || 365; // Default to max if no count specified
    if (until) {
      maxOccurrences = 365; // Will be limited by until date
    }

    const untilDate = until ? new Date(until + 'T23:59:59.999Z') : null;

    for (let i = 0; i < maxOccurrences; i++) {
      const date = new Date(baseDate);

      switch (frequency) {
        case 'daily':
          date.setUTCDate(date.getUTCDate() + (i * interval));
          break;
        case 'weekly':
          date.setUTCDate(date.getUTCDate() + (i * interval * 7));
          break;
        case 'monthly':
          date.setUTCMonth(date.getUTCMonth() + (i * interval));
          break;
        case 'yearly':
          date.setUTCFullYear(date.getUTCFullYear() + (i * interval));
          break;
      }

      // Stop if we've passed the until date
      if (untilDate && date > untilDate) {
        break;
      }

      dates.push(date);
    }

    // If count was specified, ensure we don't exceed it
    if (count && dates.length > count) {
      return dates.slice(0, count);
    }

    return dates;
  }
}

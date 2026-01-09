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
      const client = this.getClientForAccount(args.account, accounts);
      const tasks = this.getTasks(client);
      const taskListId = this.getTaskListId(args.taskListId);
      const accountId = this.getAccountId(args.account, accounts);

      if (args.recurrence) {
        return await this.createRecurringTasks(tasks, taskListId, accountId, args);
      }

      const task = await this.createSingleTask(tasks, taskListId, args);

      return this.jsonResponse({
        task,
        taskListId,
        accountId,
        message: `Task "${args.title}" created successfully`
      } satisfies CreateTaskResponse);
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
    const taskBody: any = { title: args.title };
    if (args.notes) taskBody.notes = args.notes;
    if (args.due) taskBody.due = this.normalizeDueDate(args.due);

    const response = await tasks.tasks.insert({
      tasklist: taskListId,
      ...(args.parent && { parent: args.parent }),
      ...(args.previous && { previous: args.previous }),
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
    if (!args.due) {
      throw new Error('Due date is required for recurring tasks');
    }

    const baseDueDate = this.parseDueDate(args.due);
    const dueDates = this.calculateRecurringDueDates(baseDueDate, args.recurrence);

    const createdTasks = [];
    for (let i = 0; i < dueDates.length; i++) {
      const taskTitle = dueDates.length > 1
        ? `${args.title} (#${i + 1}/${dueDates.length})`
        : args.title;

      const task = await this.createSingleTask(tasks, taskListId, {
        ...args,
        title: taskTitle,
        due: dueDates[i].toISOString(),
        recurrence: undefined
      });
      createdTasks.push(task);
    }

    return this.jsonResponse({
      tasks: createdTasks,
      taskListId,
      accountId,
      message: `Created ${createdTasks.length} recurring tasks: "${args.title}"`,
      recurringInfo: {
        frequency: args.recurrence.frequency,
        interval: args.recurrence.interval || 1,
        occurrencesCreated: createdTasks.length
      }
    } satisfies CreateTaskResponse);
  }

  /**
   * Parse due date string to Date object.
   */
  private parseDueDate(dueStr: string): Date {
    if (/^\d{4}-\d{2}-\d{2}$/.test(dueStr)) {
      return new Date(dueStr + 'T00:00:00.000Z');
    }
    return new Date(dueStr);
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

import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { CompleteTaskInput } from "../../tools/task-schemas.js";
import { CompleteTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for complete-task tool.
 * Marks a task as completed. This is a convenience wrapper that sets
 * status to 'completed' and records the completion timestamp.
 */
export class CompleteTaskHandler extends BaseTaskHandler<CompleteTaskInput> {
  async runTool(
    args: CompleteTaskInput,
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

      // Get the task list ID
      const taskListId = this.getTaskListId(args.taskListId);

      // First, get the existing task
      const existingTask = await tasks.tasks.get({
        tasklist: taskListId,
        task: args.taskId
      });

      if (!existingTask.data) {
        throw new Error(`Task not found: ${args.taskId}`);
      }

      // Check if already completed
      if (existingTask.data.status === 'completed') {
        const formattedTask = this.formatTask(existingTask.data);
        const result: CompleteTaskResponse = {
          task: formattedTask,
          taskListId,
          accountId,
          message: 'Task was already completed',
          completedAt: existingTask.data.completed || new Date().toISOString()
        };

        return {
          content: [{
            type: "text",
            text: JSON.stringify(result, null, 2)
          }]
        };
      }

      // Mark as completed
      const completedAt = new Date().toISOString();
      const response = await tasks.tasks.update({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: {
          id: existingTask.data.id,
          title: existingTask.data.title,
          notes: existingTask.data.notes,
          due: existingTask.data.due,
          status: 'completed',
          completed: completedAt
        }
      });

      if (!response.data) {
        throw new Error('Failed to complete task - no data returned');
      }

      // Format the response
      const formattedTask = this.formatTask(response.data);

      const result: CompleteTaskResponse = {
        task: formattedTask,
        taskListId,
        accountId,
        message: `Task "${existingTask.data.title}" marked as completed`,
        completedAt
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
}

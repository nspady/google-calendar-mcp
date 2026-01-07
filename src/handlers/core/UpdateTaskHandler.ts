import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { UpdateTaskInput } from "../../tools/task-schemas.js";
import { UpdateTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for update-task tool.
 * Updates an existing task with new values.
 */
export class UpdateTaskHandler extends BaseTaskHandler<UpdateTaskInput> {
  async runTool(
    args: UpdateTaskInput,
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

      // First, get the existing task to merge with updates
      const existingTask = await tasks.tasks.get({
        tasklist: taskListId,
        task: args.taskId
      });

      if (!existingTask.data) {
        throw new Error(`Task not found: ${args.taskId}`);
      }

      // Track which fields are being updated
      const updatedFields: string[] = [];

      // Build the update request body, starting with existing task
      const taskBody: any = {
        id: existingTask.data.id,
        title: existingTask.data.title,
        notes: existingTask.data.notes,
        status: existingTask.data.status,
        due: existingTask.data.due
      };

      // Apply updates
      if (args.title !== undefined) {
        taskBody.title = args.title;
        updatedFields.push('title');
      }

      if (args.notes !== undefined) {
        taskBody.notes = args.notes;
        updatedFields.push('notes');
      }

      if (args.due !== undefined) {
        // Google Tasks API expects RFC 3339 format for due date
        // If only a date is provided (YYYY-MM-DD), convert to RFC 3339
        if (/^\d{4}-\d{2}-\d{2}$/.test(args.due)) {
          taskBody.due = `${args.due}T00:00:00.000Z`;
        } else {
          taskBody.due = args.due;
        }
        updatedFields.push('due');
      }

      if (args.status !== undefined) {
        taskBody.status = args.status;
        updatedFields.push('status');

        // If marking as completed, set completed timestamp
        if (args.status === 'completed') {
          taskBody.completed = new Date().toISOString();
        } else {
          // If uncompleting, clear the completed timestamp
          taskBody.completed = null;
        }
      }

      // Update the task
      const response = await tasks.tasks.update({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: taskBody
      });

      if (!response.data) {
        throw new Error('Failed to update task - no data returned');
      }

      // Format the response
      const formattedTask = this.formatTask(response.data);

      const result: UpdateTaskResponse = {
        task: formattedTask,
        taskListId,
        accountId,
        message: `Task updated successfully`,
        updatedFields
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

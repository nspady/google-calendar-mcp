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
      const client = this.getClientForAccount(args.account, accounts);
      const tasks = this.getTasks(client);
      const taskListId = this.getTaskListId(args.taskListId);

      // Get existing task to merge with updates
      const existingTask = await tasks.tasks.get({
        tasklist: taskListId,
        task: args.taskId
      });

      if (!existingTask.data) {
        throw new Error(`Task not found: ${args.taskId}`);
      }

      const updatedFields: string[] = [];
      const taskBody: any = {
        id: existingTask.data.id,
        title: existingTask.data.title,
        notes: existingTask.data.notes,
        status: existingTask.data.status,
        due: existingTask.data.due
      };

      if (args.title !== undefined) {
        taskBody.title = args.title;
        updatedFields.push('title');
      }
      if (args.notes !== undefined) {
        taskBody.notes = args.notes;
        updatedFields.push('notes');
      }
      if (args.due !== undefined) {
        taskBody.due = this.normalizeDueDate(args.due);
        updatedFields.push('due');
      }
      if (args.status !== undefined) {
        taskBody.status = args.status;
        taskBody.completed = args.status === 'completed' ? new Date().toISOString() : null;
        updatedFields.push('status');
      }

      const response = await tasks.tasks.update({
        tasklist: taskListId,
        task: args.taskId,
        requestBody: taskBody
      });

      if (!response.data) {
        throw new Error('Failed to update task - no data returned');
      }

      return this.jsonResponse({
        task: this.formatTask(response.data),
        taskListId,
        accountId: this.getAccountId(args.account, accounts),
        message: `Task updated successfully`,
        updatedFields
      } satisfies UpdateTaskResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

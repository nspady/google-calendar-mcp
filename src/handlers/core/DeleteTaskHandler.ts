import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { DeleteTaskInput } from "../../tools/task-schemas.js";
import { DeleteTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for delete-task tool.
 * Permanently deletes a task from the specified task list.
 */
export class DeleteTaskHandler extends BaseTaskHandler<DeleteTaskInput> {
  async runTool(
    args: DeleteTaskInput,
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

      // Get task info before deletion for the confirmation message
      let taskTitle = args.taskId;
      try {
        const existingTask = await tasks.tasks.get({
          tasklist: taskListId,
          task: args.taskId
        });
        if (existingTask.data?.title) {
          taskTitle = existingTask.data.title;
        }
      } catch {
        // If we can't get the task info, proceed with deletion anyway
      }

      // Delete the task
      await tasks.tasks.delete({
        tasklist: taskListId,
        task: args.taskId
      });

      const result: DeleteTaskResponse = {
        success: true,
        taskId: args.taskId,
        taskListId,
        accountId,
        message: `Task "${taskTitle}" deleted successfully`
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

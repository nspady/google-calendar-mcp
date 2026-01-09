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
      const client = this.getClientForAccount(args.account, accounts);
      const tasks = this.getTasks(client);
      const taskListId = this.getTaskListId(args.taskListId);

      // Get task title for confirmation message
      let taskTitle = args.taskId;
      try {
        const existingTask = await tasks.tasks.get({ tasklist: taskListId, task: args.taskId });
        if (existingTask.data?.title) taskTitle = existingTask.data.title;
      } catch {
        // If we can't get the task info, proceed with deletion anyway
      }

      await tasks.tasks.delete({ tasklist: taskListId, task: args.taskId });

      return this.jsonResponse({
        success: true,
        taskId: args.taskId,
        taskListId,
        accountId: this.getAccountId(args.account, accounts),
        message: `Task "${taskTitle}" deleted successfully`
      } satisfies DeleteTaskResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

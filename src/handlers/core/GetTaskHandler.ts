import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { GetTaskInput } from "../../tools/task-schemas.js";
import { GetTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for get-task tool.
 * Gets details of a specific task by ID.
 */
export class GetTaskHandler extends BaseTaskHandler<GetTaskInput> {
  async runTool(
    args: GetTaskInput,
    accounts: Map<string, OAuth2Client>
  ): Promise<CallToolResult> {
    try {
      // Get the client for the specified account or the only available account
      const client = this.getClientForAccountOrFirst(args.account, accounts);

      // Get the account ID that was used
      const accountId = args.account ||
        (accounts.size === 1 ? Array.from(accounts.keys())[0] : 'default');

      // Get Tasks API client
      const tasks = this.getTasks(client);

      // Get the task list ID
      const taskListId = this.getTaskListId(args.taskListId);

      // Get the task
      const response = await tasks.tasks.get({
        tasklist: taskListId,
        task: args.taskId
      });

      if (!response.data) {
        throw new Error(`Task not found: ${args.taskId}`);
      }

      // Format the response
      const formattedTask = this.formatTask(response.data);

      const result: GetTaskResponse = {
        task: formattedTask,
        taskListId,
        accountId
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

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
      const client = this.getClientForAccountOrFirst(args.account, accounts);
      const tasks = this.getTasks(client);
      const taskListId = this.getTaskListId(args.taskListId);

      const response = await tasks.tasks.get({
        tasklist: taskListId,
        task: args.taskId
      });

      if (!response.data) {
        throw new Error(`Task not found: ${args.taskId}`);
      }

      return this.jsonResponse({
        task: this.formatTask(response.data),
        taskListId,
        accountId: this.getAccountId(args.account, accounts)
      } satisfies GetTaskResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

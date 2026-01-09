import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { CreateTaskListInput } from "../../tools/task-schemas.js";
import { CreateTaskListResponse } from "../../types/task-responses.js";

/**
 * Handler for create-task-list tool.
 * Creates a new task list for the authenticated user.
 */
export class CreateTaskListHandler extends BaseTaskHandler<CreateTaskListInput> {
  async runTool(
    args: CreateTaskListInput,
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

      // Build the task list request body
      const taskListBody: any = {
        title: args.title
      };

      // Create the task list
      const response = await tasks.tasklists.insert({
        requestBody: taskListBody
      });

      if (!response.data) {
        throw new Error('Failed to create task list - no data returned');
      }

      // Format the response
      const formattedTaskList = this.formatTaskList(response.data);

      const result: CreateTaskListResponse = {
        taskList: formattedTaskList,
        accountId,
        message: `Task list "${args.title}" created successfully`
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

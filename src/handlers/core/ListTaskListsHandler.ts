import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { ListTaskListsInput } from "../../tools/task-schemas.js";
import { ListTaskListsResponse } from "../../types/task-responses.js";

/**
 * Handler for list-task-lists tool.
 * Lists all task lists for the authenticated user.
 */
export class ListTaskListsHandler extends BaseTaskHandler<ListTaskListsInput> {
  async runTool(
    args: ListTaskListsInput,
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

      // List all task lists
      const response = await tasks.tasklists.list({
        maxResults: 100 // Maximum allowed by API
      });

      const taskLists = response.data.items || [];

      // Format the response
      const formattedTaskLists = taskLists.map(tl => this.formatTaskList(tl));

      const result: ListTaskListsResponse = {
        taskLists: formattedTaskLists,
        totalCount: formattedTaskLists.length,
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

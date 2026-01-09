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
      const client = this.getClientForAccountOrFirst(args.account, accounts);
      const tasks = this.getTasks(client);

      const response = await tasks.tasklists.list({ maxResults: 100 });
      const taskLists = (response.data.items || []).map(tl => this.formatTaskList(tl));

      return this.jsonResponse({
        taskLists,
        totalCount: taskLists.length,
        accountId: this.getAccountId(args.account, accounts)
      } satisfies ListTaskListsResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

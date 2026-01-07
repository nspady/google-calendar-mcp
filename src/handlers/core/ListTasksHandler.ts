import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { ListTasksInput } from "../../tools/task-schemas.js";
import { ListTasksResponse } from "../../types/task-responses.js";

/**
 * Handler for list-tasks tool.
 * Lists tasks within a specific task list with optional filtering.
 */
export class ListTasksHandler extends BaseTaskHandler<ListTasksInput> {
  async runTool(
    args: ListTasksInput,
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

      // Get the task list ID (defaults to @default)
      const taskListId = this.getTaskListId(args.taskListId);

      // Build query parameters
      const queryParams: any = {
        tasklist: taskListId,
        maxResults: args.maxResults || 100,
        showCompleted: args.showCompleted ?? true,
        showHidden: args.showHidden ?? false
      };

      // Add date filters if provided
      if (args.dueMin) {
        queryParams.dueMin = args.dueMin;
      }
      if (args.dueMax) {
        queryParams.dueMax = args.dueMax;
      }

      // List tasks
      const response = await tasks.tasks.list(queryParams);

      const taskItems = response.data.items || [];

      // Format the response
      const formattedTasks = taskItems.map(t => this.formatTask(t));

      // Get task list info for the title
      let taskListTitle: string | undefined;
      try {
        const listInfo = await tasks.tasklists.get({ tasklist: taskListId });
        taskListTitle = listInfo.data.title || undefined;
      } catch {
        // Ignore errors getting task list title
      }

      const result: ListTasksResponse = {
        tasks: formattedTasks,
        totalCount: formattedTasks.length,
        taskListId,
        taskListTitle,
        accountId,
        filters: {
          showCompleted: args.showCompleted ?? true,
          showHidden: args.showHidden ?? false,
          dueMin: args.dueMin,
          dueMax: args.dueMax
        }
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

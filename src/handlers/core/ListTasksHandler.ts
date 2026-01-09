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
      const client = this.getClientForAccountOrFirst(args.account, accounts);
      const tasks = this.getTasks(client);
      const taskListId = this.getTaskListId(args.taskListId);

      const response = await tasks.tasks.list({
        tasklist: taskListId,
        maxResults: args.maxResults || 100,
        showCompleted: args.showCompleted ?? true,
        showHidden: args.showHidden ?? false,
        ...(args.dueMin && { dueMin: args.dueMin }),
        ...(args.dueMax && { dueMax: args.dueMax })
      });

      const formattedTasks = (response.data.items || []).map(t => this.formatTask(t));

      // Get task list title
      let taskListTitle: string | undefined;
      try {
        const listInfo = await tasks.tasklists.get({ tasklist: taskListId });
        taskListTitle = listInfo.data.title || undefined;
      } catch {
        // Ignore errors getting task list title
      }

      return this.jsonResponse({
        tasks: formattedTasks,
        totalCount: formattedTasks.length,
        taskListId,
        taskListTitle,
        accountId: this.getAccountId(args.account, accounts),
        filters: {
          showCompleted: args.showCompleted ?? true,
          showHidden: args.showHidden ?? false,
          dueMin: args.dueMin,
          dueMax: args.dueMax
        }
      } satisfies ListTasksResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

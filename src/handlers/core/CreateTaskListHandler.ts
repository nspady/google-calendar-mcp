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
      const client = this.getClientForAccount(args.account, accounts);
      const tasks = this.getTasks(client);

      const response = await tasks.tasklists.insert({
        requestBody: { title: args.title }
      });

      if (!response.data) {
        throw new Error('Failed to create task list - no data returned');
      }

      return this.jsonResponse({
        taskList: this.formatTaskList(response.data),
        accountId: this.getAccountId(args.account, accounts),
        message: `Task list "${args.title}" created successfully`
      } satisfies CreateTaskListResponse);
    } catch (error) {
      return this.handleGoogleApiError(error);
    }
  }
}

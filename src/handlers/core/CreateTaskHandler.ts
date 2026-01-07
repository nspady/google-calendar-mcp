import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseTaskHandler } from "./BaseTaskHandler.js";
import { CreateTaskInput } from "../../tools/task-schemas.js";
import { CreateTaskResponse } from "../../types/task-responses.js";

/**
 * Handler for create-task tool.
 * Creates a new task in the specified task list.
 */
export class CreateTaskHandler extends BaseTaskHandler<CreateTaskInput> {
  async runTool(
    args: CreateTaskInput,
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

      // Get the task list ID (defaults to @default)
      const taskListId = this.getTaskListId(args.taskListId);

      // Build the task request body
      const taskBody: any = {
        title: args.title
      };

      if (args.notes) {
        taskBody.notes = args.notes;
      }

      if (args.due) {
        // Google Tasks API expects RFC 3339 format for due date
        // If only a date is provided (YYYY-MM-DD), convert to RFC 3339
        if (/^\d{4}-\d{2}-\d{2}$/.test(args.due)) {
          taskBody.due = `${args.due}T00:00:00.000Z`;
        } else {
          taskBody.due = args.due;
        }
      }

      // Build query parameters for positioning
      const queryParams: any = {
        tasklist: taskListId
      };

      if (args.parent) {
        queryParams.parent = args.parent;
      }

      if (args.previous) {
        queryParams.previous = args.previous;
      }

      // Create the task
      const response = await tasks.tasks.insert({
        ...queryParams,
        requestBody: taskBody
      });

      if (!response.data) {
        throw new Error('Failed to create task - no data returned');
      }

      // Format the response
      const formattedTask = this.formatTask(response.data);

      const result: CreateTaskResponse = {
        task: formattedTask,
        taskListId,
        accountId,
        message: `Task "${args.title}" created successfully`
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

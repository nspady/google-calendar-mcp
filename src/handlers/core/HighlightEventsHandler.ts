import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { OAuth2Client } from "google-auth-library";
import { BaseToolHandler } from "./BaseToolHandler.js";
import { createStructuredResponse } from "../../utils/response-builder.js";

/**
 * Handler for highlight-events tool.
 * Pure UI pass-through: returns the highlight instruction as structured data
 * so the day-view app can apply the filter.
 */
export class HighlightEventsHandler extends BaseToolHandler<{
  eventIds?: string[];
  label?: string;
}> {
  async runTool(
    args: { eventIds?: string[]; label?: string },
    _accounts: Map<string, OAuth2Client>
  ): Promise<CallToolResult> {
    return createStructuredResponse({
      action: 'highlight',
      eventIds: args.eventIds || [],
      label: args.label
    });
  }
}

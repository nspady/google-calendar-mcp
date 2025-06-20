import { BaseToolHandler } from "./BaseToolHandler.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export class GetDateTimeHandler extends BaseToolHandler {
    async runTool(_:any): Promise<CallToolResult> {
        return {
            content: [{
                type: "text",
                text: new Date().toISOString()
            }],
        };
    }
}

/**
 * Zod schemas for Google Tasks API tools.
 *
 * This file defines input validation schemas for all task-related tools,
 * keeping the main registry.ts focused on calendar tools.
 */

import { z } from "zod";

// Single account schema - consistent with calendar tools
const singleAccountSchema = z.string()
  .regex(/^[a-z0-9_-]{1,64}$/, "Account nickname must be 1-64 characters: lowercase letters, numbers, dashes, underscores only")
  .optional()
  .describe(
    "Account nickname (e.g., 'work'). Optional if only one account connected."
  );

/**
 * Task tool schemas for input validation.
 */
export const TaskSchemas = {
  /**
   * Schema for list-task-lists tool
   * Lists all task lists for the authenticated user.
   */
  'list-task-lists': z.object({
    account: singleAccountSchema
  }),

  /**
   * Schema for list-tasks tool
   * Lists tasks within a specific task list with optional filtering.
   */
  'list-tasks': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .default('@default')
      .describe("Task list ID (use '@default' for the default task list)"),
    showCompleted: z.boolean()
      .optional()
      .default(true)
      .describe("Include completed tasks (default: true)"),
    showHidden: z.boolean()
      .optional()
      .default(false)
      .describe("Include hidden tasks (default: false)"),
    dueMin: z.string()
      .optional()
      .describe("Filter by minimum due date (RFC 3339 format, e.g., '2024-01-01T00:00:00Z')"),
    dueMax: z.string()
      .optional()
      .describe("Filter by maximum due date (RFC 3339 format, e.g., '2024-12-31T23:59:59Z')"),
    maxResults: z.number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .default(100)
      .describe("Maximum number of tasks to return (1-100, default: 100)")
  }),

  /**
   * Schema for get-task tool
   * Gets details of a specific task by ID.
   */
  'get-task': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .describe("Task list ID (use '@default' for the default task list)"),
    taskId: z.string()
      .describe("ID of the task to retrieve")
  }),

  /**
   * Schema for create-task tool
   * Creates a new task in the specified task list.
   */
  'create-task': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .default('@default')
      .describe("Task list ID (use '@default' for the default task list)"),
    title: z.string()
      .min(1)
      .max(1024)
      .describe("Title of the task (required, max 1024 characters)"),
    notes: z.string()
      .max(8192)
      .optional()
      .describe("Description/notes for the task (max 8192 characters)"),
    due: z.string()
      .optional()
      .describe("Due date in RFC 3339 format (e.g., '2024-01-15T00:00:00Z' or date-only '2024-01-15')"),
    parent: z.string()
      .optional()
      .describe("Parent task ID to create this as a subtask"),
    previous: z.string()
      .optional()
      .describe("Previous sibling task ID for ordering")
  }),

  /**
   * Schema for update-task tool
   * Updates an existing task with new values.
   */
  'update-task': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .describe("Task list ID (use '@default' for the default task list)"),
    taskId: z.string()
      .describe("ID of the task to update"),
    title: z.string()
      .min(1)
      .max(1024)
      .optional()
      .describe("Updated title (max 1024 characters)"),
    notes: z.string()
      .max(8192)
      .optional()
      .describe("Updated description/notes (max 8192 characters)"),
    due: z.string()
      .optional()
      .describe("Updated due date in RFC 3339 format"),
    status: z.enum(['needsAction', 'completed'])
      .optional()
      .describe("Updated status: 'needsAction' (incomplete) or 'completed'")
  }),

  /**
   * Schema for complete-task tool
   * Marks a task as completed. This is a convenience wrapper around update-task.
   */
  'complete-task': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .describe("Task list ID (use '@default' for the default task list)"),
    taskId: z.string()
      .describe("ID of the task to complete")
  }),

  /**
   * Schema for delete-task tool
   * Permanently deletes a task.
   */
  'delete-task': z.object({
    account: singleAccountSchema,
    taskListId: z.string()
      .describe("Task list ID (use '@default' for the default task list)"),
    taskId: z.string()
      .describe("ID of the task to delete")
  })
} as const;

// Generate TypeScript types from schemas
export type TaskInputs = {
  [K in keyof typeof TaskSchemas]: z.infer<typeof TaskSchemas[K]>
};

// Export individual types for convenience
export type ListTaskListsInput = TaskInputs['list-task-lists'];
export type ListTasksInput = TaskInputs['list-tasks'];
export type GetTaskInput = TaskInputs['get-task'];
export type CreateTaskInput = TaskInputs['create-task'];
export type UpdateTaskInput = TaskInputs['update-task'];
export type CompleteTaskInput = TaskInputs['complete-task'];
export type DeleteTaskInput = TaskInputs['delete-task'];

/**
 * List of all task tool names for validation.
 */
export const TASK_TOOL_NAMES = Object.keys(TaskSchemas) as (keyof typeof TaskSchemas)[];

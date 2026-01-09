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
   * Schema for create-task-list tool
   * Creates a new task list.
   */
  'create-task-list': z.object({
    account: singleAccountSchema,
    title: z.string()
      .min(1)
      .max(1024)
      .describe("Title of the task list (required, max 1024 characters)")
  }),

  /**
   * Schema for create-task tool
   * Creates a new task in the specified task list.
   * Note: Google Tasks API only supports date-level due dates, not specific times.
   * The time component in the 'due' field will be stored but not used for scheduling.
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
      .describe("Due date in RFC 3339 format (e.g., '2024-01-15T00:00:00Z' or date-only '2024-01-15'). Note: Google Tasks only uses the date portion; time is ignored."),
    parent: z.string()
      .optional()
      .describe("Parent task ID to create this as a subtask"),
    previous: z.string()
      .optional()
      .describe("Previous sibling task ID for ordering"),
    recurrence: z.object({
      frequency: z.enum(['daily', 'weekly', 'monthly', 'yearly'])
        .describe("How often the task repeats"),
      interval: z.number()
        .int()
        .min(1)
        .max(999)
        .default(1)
        .describe("Repeat every N days/weeks/months/years (default: 1)"),
      count: z.number()
        .int()
        .min(1)
        .max(365)
        .optional()
        .describe("Number of occurrences to create (max 365)"),
      until: z.string()
        .optional()
        .describe("End date in YYYY-MM-DD format")
    }).optional()
      .describe("Recurrence pattern for creating multiple tasks. Note: Google Tasks API doesn't natively support recurring tasks; this creates separate tasks for each occurrence.")
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
export type CreateTaskListInput = TaskInputs['create-task-list'];
export type CreateTaskInput = TaskInputs['create-task'];
export type UpdateTaskInput = TaskInputs['update-task'];
export type DeleteTaskInput = TaskInputs['delete-task'];

// Note: complete-task was intentionally removed as it's just syntactic sugar
// for update-task with status: 'completed'. Use update-task instead.

/**
 * List of all task tool names for validation.
 */
export const TASK_TOOL_NAMES = Object.keys(TaskSchemas) as (keyof typeof TaskSchemas)[];

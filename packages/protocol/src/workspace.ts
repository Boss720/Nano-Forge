import { z } from "zod";

const workspaceIdSchema = z.string().min(1).max(128);
const requestIdSchema = z.string().min(1).max(128);
const workspacePathSchema = z.string().min(1).max(4096);
const generationSchema = z.number().int().positive();
const timestampSchema = z.string().datetime();
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/i);

export const workspaceCapabilitiesSchema = z.object({
  read: z.boolean(),
  stat: z.boolean(),
  watch: z.boolean(),
  search: z.boolean(),
  git: z.boolean(),
  terminal: z.boolean(),
  subagents: z.boolean(),
  memory: z.boolean(),
  reviewedWrite: z.boolean(),
});
export type WorkspaceCapabilities = z.infer<typeof workspaceCapabilitiesSchema>;

export const workspaceDescriptorSchema = z.object({
  id: workspaceIdSchema,
  name: z.string().min(1).max(255),
  displayPath: workspacePathSchema,
  generation: generationSchema,
  capabilities: workspaceCapabilitiesSchema,
});
export type WorkspaceDescriptor = z.infer<typeof workspaceDescriptorSchema>;

const generationAwareFields = {
  requestId: requestIdSchema,
  generation: generationSchema.optional(),
};

export const workspaceDescribeRequestSchema = z.object({
  type: z.literal("workspace.describe"),
  requestId: requestIdSchema,
});

export const workspaceOpenRequestSchema = z.object({
  type: z.literal("workspace.open"),
  requestId: requestIdSchema,
  path: workspacePathSchema,
  generation: generationSchema,
});

export const workspaceReadDirRequestSchema = z.object({
  type: z.literal("workspace.readDir"),
  ...generationAwareFields,
  path: z.string().max(4096),
});

export const workspaceReadFileRequestSchema = z.object({
  type: z.literal("workspace.readFile"),
  ...generationAwareFields,
  path: workspacePathSchema,
});

export const workspaceWriteRequestSchema = z.object({
  type: z.literal("workspace.writeFile"),
  ...generationAwareFields,
  path: workspacePathSchema,
  content: z.string().max(1024 * 1024),
  expectedSha256: sha256Schema.optional(),
  expectedModified: timestampSchema.optional(),
});

export const workspaceStatRequestSchema = z.object({
  type: z.literal("workspace.stat"),
  ...generationAwareFields,
  path: workspacePathSchema,
});

export const workspaceSearchRequestSchema = z.object({
  type: z.literal("workspace.search"),
  ...generationAwareFields,
  query: z.string().min(1).max(4096),
  options: z.object({
    caseSensitive: z.boolean().optional(),
    includes: z.array(z.string().max(512)).max(64).optional(),
    maxResults: z.number().int().min(1).max(1000).optional(),
  }).optional(),
});

export const workspaceGitStatusRequestSchema = z.object({
  type: z.literal("workspace.gitStatus"),
  ...generationAwareFields,
});

export const workspaceWatchRequestSchema = z.object({
  type: z.literal("workspace.watch"),
  requestId: requestIdSchema.optional(),
  generation: generationSchema.optional(),
  enabled: z.boolean(),
});

export const workspaceUnwatchRequestSchema = z.object({
  type: z.literal("workspace.unwatch"),
  ...generationAwareFields,
});

export const workspaceClientRequestSchema = z.discriminatedUnion("type", [
  workspaceDescribeRequestSchema,
  workspaceOpenRequestSchema,
  workspaceReadDirRequestSchema,
  workspaceReadFileRequestSchema,
  workspaceWriteRequestSchema,
  workspaceStatRequestSchema,
  workspaceSearchRequestSchema,
  workspaceGitStatusRequestSchema,
  workspaceWatchRequestSchema,
  workspaceUnwatchRequestSchema,
]);
export type WorkspaceClientRequest = z.infer<typeof workspaceClientRequestSchema>;

export const workspaceReadySchema = z.object({
  type: z.literal("workspace.ready"),
  requestId: requestIdSchema.optional(),
  workspace: workspaceDescriptorSchema,
  at: timestampSchema,
});

export const workspaceErrorCodeSchema = z.enum([
  "invalid_path",
  "not_found",
  "not_directory",
  "permission_denied",
  "root_too_broad",
  "stale_generation",
  "active_work",
  "reconnect_required",
  "path_outside_workspace",
  "file_too_large",
  "binary_file",
  "write_conflict",
  "write_not_approved",
  "invalid_search",
  "io_error",
]);
export type WorkspaceErrorCode = z.infer<typeof workspaceErrorCodeSchema>;

export const workspaceErrorSchema = z.object({
  type: z.literal("workspace.error"),
  requestId: requestIdSchema.optional(),
  code: workspaceErrorCodeSchema,
  message: z.string().min(1).max(4096),
  generation: generationSchema,
  recoverable: z.boolean(),
  requestedWorkspace: workspaceDescriptorSchema.optional(),
  at: timestampSchema,
});

export const workspaceWatchResultSchema = z.object({
  type: z.literal("workspace.watch.result"),
  requestId: requestIdSchema.optional(),
  enabled: z.boolean(),
  generation: generationSchema,
});

export const workspaceWriteResultSchema = z.object({
  type: z.literal("workspace.writeFile.result"),
  requestId: requestIdSchema,
  path: z.string(),
  success: z.literal(true),
  generation: generationSchema,
  sha256: sha256Schema,
  size: z.number().int().nonnegative(),
  modified: timestampSchema,
});

export type WorkspaceOpenRequest = z.infer<typeof workspaceOpenRequestSchema>;
export type WorkspaceReady = z.infer<typeof workspaceReadySchema>;
export type WorkspaceError = z.infer<typeof workspaceErrorSchema>;
export type WorkspaceWriteRequest = z.infer<typeof workspaceWriteRequestSchema>;
export type WorkspaceWriteResult = z.infer<typeof workspaceWriteResultSchema>;

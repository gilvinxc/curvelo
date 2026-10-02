import { z } from "zod";

export const CONVERSATION_KINDS = [
  "ANNOUNCEMENT",
  "TEAM_CHAT",
  "GROUP_CHAT",
] as const;

export const teamConversationsParamsSchema = z.object({
  id: z.string().uuid(), // team id
});

export const conversationParamsSchema = z.object({
  id: z.string().uuid(), // team id
  convId: z.string().uuid(),
});

export const messageParamsSchema = z.object({
  id: z.string().uuid(), // message id
});

export const sendMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
export type SendMessageInput = z.infer<typeof sendMessageSchema>;

export const editMessageSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});

export const messagesQuerySchema = z.object({
  before: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

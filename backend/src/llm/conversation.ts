import { z } from "zod";

// 深掘り対話のやり取り1件分。Knowledge ExtractionとDeep Diveの両方で共通して使う型。
export const conversationTurnSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});
export type ConversationTurn = z.infer<typeof conversationTurnSchema>;

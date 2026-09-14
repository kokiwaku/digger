import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";
import { conversationTurnSchema } from "./conversation.js";
import { userKnowledgeSchema } from "./personalizedAnalysis.js";

// Deep Dive: ユーザーが記事の解析結果を見たあと、自由入力または候補の質問で
// その場で深掘りする処理。Article Analysisとは別処理として分離する
// （記事の客観的な解析と、対話形式でのQ&Aは別の関心事のため）。
//
// 候補ボタンをクリックした場合も自由入力の場合も、同じDeepDiveServiceを使う
// （question文字列として渡すだけなので、呼び出し側で区別する必要がない）。

export const deepDiveInputSchema = z.object({
  articleAnalysis: articleAnalysisSchema,
  question: z.string().min(1),
  conversationHistory: z.array(conversationTurnSchema),
  userKnowledge: z.array(userKnowledgeSchema).optional(),
});
export type DeepDiveInput = z.infer<typeof deepDiveInputSchema>;

export const deepDiveResponseSchema = z.object({
  answer: z.string(),
  relatedConcepts: z.array(z.string()),
  suggestedFollowUps: z.array(z.string()),
});
export type DeepDiveResponse = z.infer<typeof deepDiveResponseSchema>;

export interface DeepDiveService {
  ask(input: DeepDiveInput): Promise<DeepDiveResponse>;
}

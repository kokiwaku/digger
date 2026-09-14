import { z } from "zod";
import { articleAnalysisSchema } from "./articleAnalysis.js";

// Personalized Analysis: Article Analysisの結果と、そのユーザーが過去に理解した知識を
// 照合し、「このユーザーには何を説明すべきか」を決める処理。

// ユーザーが過去に理解した知識1件分。Personalized AnalysisとDeep Diveの両方で使う。
export const userKnowledgeSchema = z.object({
  id: z.string(),
  concept: z.string(),
  statement: z.string(),
  confidence: z.enum(["low", "medium", "high"]).optional(),
});
export type UserKnowledge = z.infer<typeof userKnowledgeSchema>;

const relatedHistorySchema = z.object({
  title: z.string(),
  summary: z.string(),
  learned: z.array(z.string()),
});

export const personalizedAnalysisInputSchema = z.object({
  articleAnalysis: articleAnalysisSchema,
  userKnowledge: z.array(userKnowledgeSchema),
  relatedHistory: z.array(relatedHistorySchema).optional(),
});
export type PersonalizedAnalysisInput = z.infer<typeof personalizedAnalysisInputSchema>;

const needsExplanationSchema = z.object({
  conceptId: z.string(),
  reason: z.string(),
});

const relatedPastKnowledgeSchema = z.object({
  knowledgeId: z.string(),
  reason: z.string(),
});

const suggestedQuestionSchema = z.object({
  question: z.string(),
  reason: z.string(),
});

export const personalizedAnalysisSchema = z.object({
  alreadyKnown: z.array(z.string()),
  needsExplanation: z.array(needsExplanationSchema),
  relatedPastKnowledge: z.array(relatedPastKnowledgeSchema),
  personalizedExplanation: z.string(),
  suggestedQuestions: z.array(suggestedQuestionSchema),
});
export type PersonalizedAnalysis = z.infer<typeof personalizedAnalysisSchema>;

export interface PersonalizedAnalysisService {
  analyze(input: PersonalizedAnalysisInput): Promise<PersonalizedAnalysis>;
}

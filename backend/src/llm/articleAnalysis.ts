import { z } from "zod";

// Article Analysis: 記事そのものを客観的に解析する処理。
// ユーザーの知識・履歴はここには一切渡さない（それはPersonalized Analysisの役割）。

export const articleAnalysisInputSchema = z.object({
  title: z.string(),
  url: z.string(),
  content: z.string(),
});
export type ArticleAnalysisInput = z.infer<typeof articleAnalysisInputSchema>;

const conceptSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  importance: z.enum(["required", "helpful"]),
});

const entitySchema = z.object({
  name: z.string(),
  type: z.enum(["person", "organization", "place", "event", "other"]),
  description: z.string().optional(),
});

const connectionSchema = z.object({
  topic: z.string(),
  relation: z.string(),
});

// LLMのレスポンス(JSON)をこのschemaで検証してからArticleAnalysisとして扱う。
// 実装をモックから本物のLLM呼び出しに差し替えるときも、この形式は変えない想定。
export const articleAnalysisSchema = z.object({
  summary: z.string(),
  whyItMatters: z.string(),
  concepts: z.array(conceptSchema),
  entities: z.array(entitySchema),
  connections: z.array(connectionSchema),
  deepDiveQuestions: z.array(z.string()),
});
export type ArticleAnalysis = z.infer<typeof articleAnalysisSchema>;

export interface ArticleAnalysisService {
  analyze(input: ArticleAnalysisInput): Promise<ArticleAnalysis>;
}

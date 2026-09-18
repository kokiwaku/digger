import { z } from "zod";

// Article Analysis: 入力（記事URL・貼り付けテキスト・画像のいずれか）そのものを
// 客観的に解析する処理。ユーザーの知識・履歴はここには一切渡さない
// （それはPersonalized Analysisの役割）。
//
// 元々はURL記事専用（title/url/contentすべて必須）だったが、Diggerの入力方式を
// テキスト貼り付け・画像へ拡張したことに伴い一般化した。URL記事はcontentに本文、
// 貼り付けテキストもcontentにそのまま入れる（同じ「テキストを解析する」処理として扱える
// ため、Service側の分岐は最小限で済む）。画像はcontent無しでimageだけを渡す
// （マルチモーダル入力、LlmProvider.generateText()のimages経由）。
// content/imageのどちらか一方は必須（refineで強制）。
export const articleAnalysisImageInputSchema = z.object({
  data: z.string(), // base64エンコードされた画像データ（data URLのprefixは含まない）
  mimeType: z.string(),
});
export type ArticleAnalysisImageInput = z.infer<typeof articleAnalysisImageInputSchema>;

export const articleAnalysisInputSchema = z
  .object({
    // URL記事の場合のみ意味を持つ。貼り付けテキスト・画像には無い（無くても解析はできる）。
    title: z.string().optional(),
    url: z.string().optional(),
    content: z.string().optional(),
    image: articleAnalysisImageInputSchema.optional(),
  })
  .refine((data) => Boolean(data.content) || Boolean(data.image), {
    message: "content or image is required",
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

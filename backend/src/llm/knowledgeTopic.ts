import { z } from "zod";

// Knowledge Topic分類: 保存済みKnowledgeを「自分の理解」ページのトピックビューで
// 階層表示するための、簡易的なtopic付与処理。MVPでは正規化されたTopicコレクションは作らず、
// 各Knowledgeドキュメントに`topicPath`（例: ["経済", "金融政策", "政策金利"]）を
// 直接持たせるだけの単純な構造にする（過剰な分類基盤は作らない）。

// 深すぎる階層を作らないよう、最大3階層（例: 大分類/中分類/小分類）に制限する。
export const knowledgeTopicPathSchema = z.array(z.string().min(1)).min(1).max(3);
export type KnowledgeTopicPath = z.infer<typeof knowledgeTopicPathSchema>;

export const topicAssignmentInputItemSchema = z.object({
  id: z.string(),
  concept: z.string(),
  statement: z.string(),
});
export type TopicAssignmentInputItem = z.infer<typeof topicAssignmentInputItemSchema>;

export const knowledgeTopicInputSchema = z.object({
  items: z.array(topicAssignmentInputItemSchema).min(1),
  // 既存のtopicPath一覧。同じ意味のトピックに毎回違う名前を付けないよう、
  // 既存の命名を再利用する参考情報として渡す（無理に既存に合わせる必要はない）。
  existingTopicPaths: z.array(knowledgeTopicPathSchema),
});
export type KnowledgeTopicInput = z.infer<typeof knowledgeTopicInputSchema>;

export const topicAssignmentSchema = z.object({
  id: z.string(),
  path: knowledgeTopicPathSchema,
});
export type TopicAssignment = z.infer<typeof topicAssignmentSchema>;

export const knowledgeTopicResultSchema = z.object({
  assignments: z.array(topicAssignmentSchema),
});
export type KnowledgeTopicResult = z.infer<typeof knowledgeTopicResultSchema>;

export interface KnowledgeTopicService {
  classify(input: KnowledgeTopicInput): Promise<KnowledgeTopicResult>;
}

import { z } from "zod";

// Diggerへの入力元（掘った対象）を表す唯一の定義。以前は`web_article`固定の
// `{ type, url, title }`だけだったが、URL以外（テキスト貼り付け・画像）からも
// 掘れるようにするため判別可能なユニオンへ拡張した。
// `web_article`は既存の形をそのまま残しており、既存データ・既存フローとの後方互換性がある。
// このファイルが唯一の定義で、以前は`llm/knowledgeExtraction.ts`・`knowledge.ts`（2箇所）・
// `types.ts`にほぼ同じ形が個別に重複定義されていたため、ここへ集約した。
export const knowledgeSourceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("web_article"),
    url: z.string(),
    title: z.string(),
  }),
  // テキスト貼り付け。urlは存在しない。titleは無くてもよい（無ければUIが
  // 「テキスト入力」のようなfallback表示をする、またはLLMが短いtitleを生成する）。
  z.object({
    type: z.literal("text"),
    title: z.string().optional(),
  }),
  // 画像アップロード。画像自体はMVPでは永続保存しない（Gemini処理後に破棄）ため、
  // urlも実データも持たない。titleは無くてもよい。
  z.object({
    type: z.literal("image"),
    title: z.string().optional(),
  }),
  // 「自分の理解」画面（Understanding Map）のConceptを起点に、そのConceptについて
  // 改めてDeep Diveしたセッションから保存されたKnowledge。外部からの入力
  // （URL/text/image）ではなく、既に理解済みのConceptから「さらに掘る」循環に由来する。
  // conceptIdは掘った時点のConceptを指すが、後からConceptが削除・統合される可能性が
  // あるため、titleにConcept名のスナップショットを残す（表示用のfallback）。
  z.object({
    type: z.literal("concept_dig"),
    conceptId: z.string(),
    title: z.string().optional(),
  }),
  // 同上のTopic版。Topicの配下Concept・Knowledgeをまとめて俯瞰しながら掘ったセッション。
  z.object({
    type: z.literal("topic_dig"),
    topicId: z.string(),
    title: z.string().optional(),
  }),
]);
export type KnowledgeSource = z.infer<typeof knowledgeSourceSchema>;

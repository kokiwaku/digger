// URLだけでなく、貼り付けテキスト・画像、さらには「自分の理解」画面のConcept/Topicを
// 起点に再び掘ったセッションからも保存できるようにしたための判別可能なユニオン。
// web_articleは既存の形のまま（urlを持つのはこれだけ）。それ以外にはurlが無く、
// titleは任意（無ければUI側がfallback表示をする）。
export type DigSource =
  | { type: "web_article"; url: string; title: string }
  | { type: "text"; title?: string }
  | { type: "image"; title?: string }
  | { type: "concept_dig"; conceptId: string; title?: string }
  | { type: "topic_dig"; topicId: string; title?: string };

export type Concept = {
  id: string;
  name: string;
  description: string;
  importance: "required" | "helpful";
};

export type Entity = {
  name: string;
  type: "person" | "organization" | "place" | "event" | "other";
  description?: string;
};

export type Connection = {
  topic: string;
  relation: string;
};

export type ArticleAnalysis = {
  summary: string;
  whyItMatters: string;
  concepts: Concept[];
  entities: Entity[];
  connections: Connection[];
  deepDiveQuestions: string[];
};

export type DigResult = {
  source: DigSource;
  analysis: ArticleAnalysis;
};

export type ConversationTurn = {
  role: "user" | "assistant";
  content: string;
};

export type RelatedConcept = {
  name: string;
  relation: string;
};

export type DeepDiveResponse = {
  answer: string;
  relatedConcepts: RelatedConcept[];
  suggestedFollowUps: string[];
};

export type KnowledgeRelation = "new" | "reinforces" | "extends" | "supersedes";

export type RelationToExisting = {
  type: KnowledgeRelation;
  knowledgeId?: string;
  reason?: string;
};

// backendがrelationToExisting（LLMの生出力）から変換した、UI表示用のカテゴリ。
// reinforces相当の候補は確認UIから除外されるため、ここには来ない。
export type KnowledgeDisplayCategory = "new" | "deepened" | "updated";

export type KnowledgeCandidate = {
  id: string;
  concept: string;
  statement: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  isNew: boolean;
  relationToExisting?: RelationToExisting;
  displayCategory: KnowledgeDisplayCategory;
  relatedKnowledge?: { concept: string; statement: string };
};

// Diggerの保存機能を、「AIがKnowledgeを記録する」から「ユーザーとAIが一緒に、残したい
// 理解・判断を整理する」へ広げるためのモデル。既存のKnowledge Extraction/保存機能は
// 一切変更せず（KnowledgeCandidate/KnowledgeDisplayCategoryは引き続き型としては残す）、
// より一般的なMemoryCandidate/MemoryItemを並行して追加している。
export type MemoryItemType = "knowledge" | "preference" | "candidate" | "decision" | "open_question";

// origin: AIが一方的に保存内容を決めないという方針を表す出自フィールド。
// - ai_extracted: AI候補を編集せずそのまま保存した
// - user_edited: AI候補をユーザーが編集してから保存した
// - user_created: ユーザーが「自分で追加」から作成した
export type MemoryItemOrigin = "ai_extracted" | "user_created" | "user_edited";

// candidate（検討対象）専用の補足情報。将来の比較機能のための受け皿。
export type CandidateMetadata = {
  reasons?: string[];
  concerns?: string[];
  status?: "candidate" | "shortlisted" | "selected" | "rejected";
};

// Memory ExtractionがLLMから返す候補。typeによってtitle/metadataの使われ方が変わる
// （knowledge/candidateは短いtitleを持つことが多く、preference/decision/open_questionは
// contentのみのことが多い）。displayCategory/relatedKnowledgeはknowledge型のみ設定される。
export type MemoryCandidate = {
  id: string;
  type: MemoryItemType;
  title?: string;
  content: string;
  reason?: string;
  metadata?: CandidateMetadata;
  confidence: "low" | "medium" | "high";
  relationToExisting?: RelationToExisting;
  displayCategory?: KnowledgeDisplayCategory;
  relatedKnowledge?: { concept: string; statement: string };
};

// 保存確認パネルでユーザーが選択・編集・追加した1件。origin未確定のAI候補は
// パネル内部で"ai_extracted"として扱い、編集された時点で"user_edited"に切り替える。
export type MemoryDraftItem = MemoryCandidate & { origin: MemoryItemOrigin };

export type KnowledgeStatus = "active" | "foundational" | "merged" | "outdated";

// マップビューの辺（edge）用。reinforces/newは対象Knowledgeを持たないため、
// 保存されるのはextends/supersedesのみ。
export type KnowledgeRelationOut = {
  knowledgeId: string;
  type: "extends" | "supersedes";
};

export type SavedKnowledge = {
  _id: string;
  concept: string;
  statement: string;
  confidence: "low" | "medium" | "high";
  // 未設定の既存データはbackend側でactive扱いされるが、frontendには生の値がそのまま届く
  // ことがあるため、表示側でも「未設定ならactive」という前提でstatusを解釈する。
  status?: KnowledgeStatus;
  source: DigSource;
  relatedKnowledgeIds?: string[];
  relationsOut?: KnowledgeRelationOut[];
  // 「自分の理解」ページのトピックビュー用。1〜3階層のパス。未分類の場合は省略される。
  topicPath?: string[];
  // 新しいTopic/Concept/Knowledgeモデル（backendのunderstandingStructure.ts）用のConcept参照。
  conceptIds?: string[];
  createdAt: string;
  updatedAt?: string;
};

// Topic/Concept/ConceptRelationモデル（backendのtopic.ts/concept.ts/conceptRelation.ts）。
// マップタブ（UnderstandingMapView.tsx）で使用する。
export type EntityStatus = "active" | "merged" | "archived";

export type Topic = {
  _id: string;
  userId: string;
  name: string;
  parentId?: string | null;
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
};

// backend側の`Concept`（Article Analysisの前提知識カード）とは別物のため、
// frontend型としては名前を分けている。
export type UnderstandingConcept = {
  _id: string;
  userId: string;
  name: string;
  topicIds: string[];
  status: EntityStatus;
  createdAt: string;
  updatedAt: string;
};

export type ConceptRelationType =
  | "related"
  | "prerequisite"
  | "part_of"
  | "causes"
  | "contrasts"
  | "extends"
  | "supersedes";

export type ConceptRelation = {
  _id: string;
  userId: string;
  fromConceptId: string;
  toConceptId: string;
  type: ConceptRelationType;
  createdAt: string;
  updatedAt: string;
};

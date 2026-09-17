export type DigSource = {
  type: "web_article";
  url: string;
  title: string;
};

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

export type KnowledgeCandidate = {
  id: string;
  concept: string;
  statement: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  isNew: boolean;
};

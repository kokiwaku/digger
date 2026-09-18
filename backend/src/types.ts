import type { ArticleAnalysis } from "./llm/articleAnalysis.js";
import type { KnowledgeSource } from "./knowledgeSource.js";

// POST /api/dig のリクエストボディ。inputは自由な文字列（URLかもしれないし、貼り付けた
// テキストかもしれない）で、URL/テキストの判定はdig.tsのresolveInputSource()が行う。
// urlは古いクライアント（{ url: "..." }のみ送るもの）との後方互換のために残している。
export type DigRequest = {
  input?: string;
  url?: string;
  image?: { data: string; mimeType: string };
};

export type DigSource = KnowledgeSource;

export type DigResult = {
  source: DigSource;
  analysis: ArticleAnalysis;
};

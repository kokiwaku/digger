import type { ArticleAnalysis } from "./llm/articleAnalysis.js";

export type DigRequest = {
  url: string;
};

export type DigSource = {
  type: "web_article";
  url: string;
  title: string;
};

export type DigResult = {
  source: DigSource;
  analysis: ArticleAnalysis;
};

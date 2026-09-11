export type BackgroundKnowledge = {
  id: string;
  title: string;
  summary: string;
};

export type DigSource = {
  type: "web_article";
  url: string;
  title: string;
};

export type DigResult = {
  source: DigSource;
  summary: string;
  whyItMatters: string;
  backgroundKnowledge: BackgroundKnowledge[];
};

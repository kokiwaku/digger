import type { ArticleAnalysis, ConceptRelation, DigSource, SavedKnowledge, Topic, UnderstandingConcept } from "./types";

// Diggerの循環体験（Map→Conceptを選ぶ→掘る→Knowledge保存→Mapへ戻る→理解構造が更新されている）
// の中心となる部分。「自分の理解」画面のConcept/Topicを起点に、既存のDeep Dive/Knowledge
// Extractionの仕組みへそのまま流し込むためのContext（ArticleAnalysis相当）を組み立てる。
//
// 新しいbackend APIは追加していない。ArticleAnalysis型・POST /api/deep-dive・
// POST /api/knowledge/extract・POST /api/knowledge/saveは既存のURL/text/image起点と完全に
// 同じもので、ここではその入力として渡す「合成されたArticleAnalysis」と「source」を
// 組み立てるだけ。Deep Dive/Knowledge Extractionの実装は入力元をまったく意識しない。

// 関連性の高いものだけに絞り、全Knowledgeを無制限に送らないようにする。
const MAX_CONTEXT_KNOWLEDGE_ITEMS = 8;
const MAX_CONTEXT_RELATED_CONCEPTS = 6;
const MAX_TOPIC_CONTEXT_CONCEPTS = 10;

export type EntityDigContext = {
  analysis: ArticleAnalysis;
  source: DigSource;
  heading: string;
  introMessage: string;
};

function buildTopicBreadcrumb(topics: Topic[], topicId: string): string[] {
  const byId = new Map(topics.map((t) => [t._id, t]));
  const chain: string[] = [];
  let current = byId.get(topicId);
  const seen = new Set<string>();
  while (current && !seen.has(current._id)) {
    chain.unshift(current.name);
    seen.add(current._id);
    current = current.parentId ? byId.get(current.parentId) : undefined;
  }
  return chain;
}

// 指定したTopicとその配下（子孫）すべてのidを集める（Topic起点のcontext構築に使う）。
function collectDescendantTopicIds(topics: Topic[], rootId: string): Set<string> {
  const childrenByParent = new Map<string, string[]>();
  for (const topic of topics) {
    if (!topic.parentId) continue;
    const list = childrenByParent.get(topic.parentId);
    if (list) list.push(topic._id);
    else childrenByParent.set(topic.parentId, [topic._id]);
  }

  const result = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;
    for (const childId of childrenByParent.get(current) ?? []) {
      if (!result.has(childId)) {
        result.add(childId);
        queue.push(childId);
      }
    }
  }
  return result;
}

// Conceptを起点に掘る場合のContext。「selected Concept」「そのConceptに紐づくKnowledge」
// 「related Concepts」「Topic」をArticleAnalysis相当の形に詰め込む。既存Knowledgeを
// summaryへそのまま含めることで、Deep Dive側（formatArticleContext()）が自然に
// 「前提として知っている内容」として扱い、起源から長く説明し直すことを避けやすくする。
export function buildConceptDigContext(
  concept: UnderstandingConcept,
  topics: Topic[],
  concepts: UnderstandingConcept[],
  relations: ConceptRelation[],
  knowledge: SavedKnowledge[],
): EntityDigContext {
  const breadcrumb = concept.topicIds[0] ? buildTopicBreadcrumb(topics, concept.topicIds[0]) : [];
  const knowledgeItems = knowledge
    .filter((k) => (k.conceptIds ?? []).includes(concept._id))
    .slice(0, MAX_CONTEXT_KNOWLEDGE_ITEMS);

  const conceptById = new Map(concepts.map((c) => [c._id, c]));
  const relatedConceptNames = relations
    .filter((r) => r.fromConceptId === concept._id || r.toConceptId === concept._id)
    .map((r) => (r.fromConceptId === concept._id ? r.toConceptId : r.fromConceptId))
    .map((id) => conceptById.get(id)?.name)
    .filter((name): name is string => Boolean(name))
    .slice(0, MAX_CONTEXT_RELATED_CONCEPTS);

  const analysis: ArticleAnalysis = {
    summary:
      knowledgeItems.length > 0
        ? `${concept.name}について、これまでに次のことを理解しています。${knowledgeItems.map((k) => k.statement).join(" ")}`
        : `${concept.name}について、まだ詳しい理解は蓄積されていません。`,
    whyItMatters: breadcrumb.length > 0 ? `「${breadcrumb.join(" > ")}」というトピックに属する概念です。` : "",
    concepts: relatedConceptNames.map((name, i) => ({
      id: `related-${i}`,
      name,
      description: "関連する概念",
      importance: "helpful" as const,
    })),
    entities: [],
    connections: breadcrumb.map((name) => ({ topic: name, relation: "所属するトピック" })),
    deepDiveQuestions: [],
  };

  return {
    analysis,
    source: { type: "concept_dig", conceptId: concept._id, title: concept.name },
    heading: `${concept.name}について掘る`,
    introMessage: `${concept.name}について、これまでの理解を踏まえてさらに掘り下げましょう。気になることをそのまま聞いてください。`,
  };
}

// Topicを起点に掘る場合のContext。「Topic」「child Topics」「関連Concept」「配下の主要
// Knowledge」を詰め込む。配下のConcept/Knowledgeは無制限に送らず、上限で絞る。
export function buildTopicDigContext(
  topic: Topic,
  topics: Topic[],
  concepts: UnderstandingConcept[],
  knowledge: SavedKnowledge[],
): EntityDigContext {
  const breadcrumb = buildTopicBreadcrumb(topics, topic._id);
  const subtreeIds = collectDescendantTopicIds(topics, topic._id);
  const childTopicNames = topics
    .filter((t) => t.status === "active" && t.parentId === topic._id)
    .map((t) => t.name);
  const subtreeConcepts = concepts
    .filter((c) => c.status === "active" && c.topicIds.some((id) => subtreeIds.has(id)))
    .slice(0, MAX_TOPIC_CONTEXT_CONCEPTS);
  const conceptIds = new Set(subtreeConcepts.map((c) => c._id));
  const knowledgeItems = knowledge
    .filter((k) => (k.conceptIds ?? []).some((id) => conceptIds.has(id)))
    .slice(0, MAX_CONTEXT_KNOWLEDGE_ITEMS);

  const analysis: ArticleAnalysis = {
    summary:
      knowledgeItems.length > 0
        ? `「${topic.name}」というトピックについて、これまでに次のことを理解しています。${knowledgeItems.map((k) => k.statement).join(" ")}`
        : `「${topic.name}」というトピックについて、まだ詳しい理解は蓄積されていません。`,
    whyItMatters: "",
    concepts: subtreeConcepts.map((c) => ({
      id: c._id,
      name: c.name,
      description: "このトピックに含まれる概念",
      importance: "helpful" as const,
    })),
    entities: [],
    connections: [
      ...breadcrumb.slice(0, -1).map((name) => ({ topic: name, relation: "親トピック" })),
      ...childTopicNames.map((name) => ({ topic: name, relation: "配下のトピック" })),
    ],
    deepDiveQuestions: [],
  };

  return {
    analysis,
    source: { type: "topic_dig", topicId: topic._id, title: topic.name },
    heading: `${topic.name}について掘る`,
    introMessage: `「${topic.name}」について、これまでの理解を踏まえてさらに掘り下げましょう。気になることをそのまま聞いてください。`,
  };
}

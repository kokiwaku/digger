// Understanding Mapのノード配置ロジック（Reactに依存しない純粋なモジュール）。
//
// Mapは完全なTreeでも完全なforce-directed graphでもない。Topic hierarchyを
// 「理解構造の背骨」として使い、ConceptRelationを「理解の横方向の広がり」として
// 重ねる中間的な構造を目指す。そのためTopic→Topic・Topic→Concept（親子関係）だけを
// dagreでレイアウトし、ConceptRelationは位置が決まった後の補助edgeとして重ねる
// （relationが0件でもTopic hierarchyだけでMapとして成立する）。
// Conceptは1つのTopicだけの子にする必要はなく、複数のTopicに属する場合は
// 複数の親からedgeを引く（同じConceptを複製しない。dagreはtreeではなくDAGとして
// 扱えるため、1つのnodeが複数の親を持つことも問題なくレイアウトできる）。
// Knowledgeは「Map上のnode」ではなく「Concept詳細（右Panel）の中身」として扱うため、
// レイアウト対象にはしない。
import dagre from "dagre";

export interface TopicLike {
  _id: string;
  parentId?: string | null;
}

export const UNCLASSIFIED_CLUSTER = "__unclassified__";

// topicIdの親を辿ってルートTopicのidを返す（色分け・「すべて」表示時のtree単位に使う）。
export function findRootTopicId(topics: TopicLike[], topicId: string): string {
  const byId = new Map(topics.map((t) => [t._id, t]));
  let current = byId.get(topicId);
  const seen = new Set<string>();
  while (current?.parentId && !seen.has(current._id)) {
    seen.add(current._id);
    const parent = byId.get(current.parentId);
    if (!parent) break;
    current = parent;
  }
  return current?._id ?? topicId;
}

export interface ConceptLike {
  _id: string;
  topicIds: string[];
}

// 色分け・ツリー単位分けの基準は、Conceptの最初のtopicIdが属するルートTopic。
// topicIdsが空（未分類）のConceptは専用の「未分類」ツリーに入れる。
// Conceptが複数Topicに属する場合も、色は代表として最初のtopicId基準で1色に決める
// （node自体は複数の親からedgeを受けるが、色分け自体は単純さを優先する）。
export function getClusterKey(concept: ConceptLike, topics: TopicLike[]): string {
  const primaryTopicId = concept.topicIds[0];
  if (!primaryTopicId) return UNCLASSIFIED_CLUSTER;
  return findRootTopicId(topics, primaryTopicId);
}

export type Point = { x: number; y: number };

// Node sizeは「理解構造上の階層」の3段階だけを主基準にする（Relation数・edge数を
// 主要因にしない）。階層が一目で分かるよう段階間の差ははっきり付け、同一階層内での
// 補助調整（childCount/knowledgeCountなど）は小さな範囲（最大6〜8px）にとどめる。
export const ROOT_TOPIC_BASE_SIZE = 68;
export const ROOT_TOPIC_MAX_SIZE = 76;
export const SUBTOPIC_BASE_SIZE = 52;
export const SUBTOPIC_MAX_SIZE = 60;
export const CONCEPT_BASE_SIZE = 36;
export const CONCEPT_MAX_SIZE = 44;

export function computeRootTopicSize(childCount: number): number {
  return Math.min(ROOT_TOPIC_MAX_SIZE, ROOT_TOPIC_BASE_SIZE + Math.min(8, childCount));
}

export function computeSubtopicSize(childCount: number): number {
  return Math.min(SUBTOPIC_MAX_SIZE, SUBTOPIC_BASE_SIZE + Math.min(8, childCount));
}

// Knowledge数による補助調整は最大6pxまで（Relation数はここに関与させない）。
export function computeConceptSize(knowledgeCount: number): number {
  return Math.min(CONCEPT_MAX_SIZE, CONCEPT_BASE_SIZE + Math.min(6, knowledgeCount * 1.5));
}

export type MapNodeKind = "rootTopic" | "subtopic" | "concept";

export interface HierarchyNodeInput {
  id: string;
  kind: MapNodeKind;
  width: number;
  height: number;
}

export interface HierarchyEdgeInput {
  id: string;
  source: string;
  target: string;
}

// 階層構造（Topic→Topic、Topic→Concept）だけをdagreに渡してレイアウトする。
// Conceptが複数Topicに属する場合は、呼び出し側がそのTopic数だけHierarchyEdgeInputを
// 渡してよい（1つのConcept nodeが複数の親からedgeを受け取るDAGとしてdagreに渡す。
// dagreは厳密なtreeを要求しないため、複数の親を持つnodeもそのままレイアウトできる）。
// ConceptRelation（横断的なつながり）はレイアウトには使わず、位置が決まった後に見た目だけの
// 補助edgeとして重ねる。複数のルートTopicがある場合、dagreは非連結なグラフとしてまとめて
// 配置する（「すべて」表示時に複数の木が横に並ぶ）。
export function computeHierarchyLayout(
  nodes: HierarchyNodeInput[],
  edges: HierarchyEdgeInput[],
  direction: "LR" | "TB" = "LR",
): Map<string, Point> {
  const positions = new Map<string, Point>();
  if (nodes.length === 0) return positions;

  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  g.setGraph({
    rankdir: direction,
    // ranksep: 階層間（Root Topic→Subtopic→Concept）の間隔。
    // nodesep: 同じ階層内でのnode間の間隔。詰まって見えないよう広げつつ、
    // 離れすぎて「複数の島」に見えないよう、branchが重ならない程度にとどめる。
    ranksep: 70,
    nodesep: 36,
    marginx: 24,
    marginy: 24,
  });

  for (const node of nodes) {
    g.setNode(node.id, { width: node.width, height: node.height });
  }
  for (const edge of edges) {
    g.setEdge(edge.source, edge.target);
  }

  dagre.layout(g);

  for (const node of nodes) {
    const pos = g.node(node.id);
    if (!pos) continue;
    // dagreはnodeの中心座標を返すが、React Flowのpositionは左上原点なので変換する。
    positions.set(node.id, { x: pos.x - node.width / 2, y: pos.y - node.height / 2 });
  }
  return positions;
}

const TOPIC_COLOR_PALETTE = ["#2b6cb0", "#c0392b", "#2f855a", "#b7791f", "#6b46c1", "#00838f", "#ad1457", "#4e5d94"];

// 出現順にトピック（ツリー）へ色を割り当てる。未分類は常に固定のグレーにする
// （「他とは違う」ことが分かるようにするため、パレット循環の対象からは外す）。
export function buildTopicColorMap(clusterKeys: string[]): Map<string, string> {
  const map = new Map<string, string>();
  let paletteIndex = 0;
  for (const key of clusterKeys) {
    if (key === UNCLASSIFIED_CLUSTER) {
      map.set(key, "#999999");
      continue;
    }
    map.set(key, TOPIC_COLOR_PALETTE[paletteIndex % TOPIC_COLOR_PALETTE.length]);
    paletteIndex++;
  }
  return map;
}

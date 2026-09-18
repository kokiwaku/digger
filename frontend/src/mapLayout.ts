// Understanding Mapのノード配置ロジック（Reactに依存しない純粋なモジュール）。
//
// Mapは「Conceptをランダムに散らしてつなぐもの」ではなく「ユーザーの現在の理解構造
// （Topic hierarchy）を視覚化したもの」として設計する。そのためforce-directed layout
// （d3-force）はやめ、Root Topic → Subtopic → Concept → Knowledgeという階層を
// そのまま木構造レイアウト（dagre）で描画する。ConceptRelationは階層を補足する
// 横断的なつながりとして別途重ねるだけで、レイアウト自体はTopic hierarchyだけで
// 常に成立する（relationが0件でも意味のあるMapになる）。
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
export function getClusterKey(concept: ConceptLike, topics: TopicLike[]): string {
  const primaryTopicId = concept.topicIds[0];
  if (!primaryTopicId) return UNCLASSIFIED_CLUSTER;
  return findRootTopicId(topics, primaryTopicId);
}

export type Point = { x: number; y: number };

// Node sizeは「理解構造上の階層」を第一基準にする（relation数・Knowledge数を主基準にしない）。
// 階層が一目で分かるよう、Root Topic > Subtopic > Concept > Knowledgeの差を明確に付ける。
export const ROOT_TOPIC_BASE_SIZE = 60;
export const SUBTOPIC_BASE_SIZE = 48;
export const CONCEPT_BASE_SIZE = 38;
export const KNOWLEDGE_NODE_WIDTH = 132;
export const KNOWLEDGE_NODE_HEIGHT = 30;

// 同階層内の補助差（あくまで基本サイズへの小さな上乗せにとどめる。主基準は階層そのもの）。
export function computeRootTopicSize(childCount: number): number {
  return ROOT_TOPIC_BASE_SIZE + Math.min(8, childCount * 1.2);
}

export function computeSubtopicSize(childCount: number): number {
  return SUBTOPIC_BASE_SIZE + Math.min(6, childCount * 1);
}

export function computeConceptSize(knowledgeCount: number): number {
  return CONCEPT_BASE_SIZE + Math.min(6, knowledgeCount * 1.5);
}

export type MapNodeKind = "rootTopic" | "subtopic" | "concept" | "knowledge";

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

// 階層構造（Topic→Topic、Topic→Concept、Concept→Knowledge）だけをdagreに渡してレイアウトする。
// ConceptRelation（横断的なつながり）はレイアウトには使わず、位置が決まった後に見た目だけの
// 補助edgeとして重ねる（レイアウトを乱さないようにするため）。
// 複数のルートTopicがある場合、dagreは非連結なグラフとしてまとめて配置する
// （「すべて」表示時に複数の木が横に並ぶ）。
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
    // ranksep: 階層間（Root Topic→Subtopic→Concept→Knowledge）の間隔。
    // nodesep: 同じ階層内でのnode間の間隔。木同士が混ざらない程度の余白は欲しいが、
    // 離れすぎて「複数の島」に見えないよう、控えめな値にとどめる。
    ranksep: 70,
    nodesep: 20,
    marginx: 20,
    marginy: 20,
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

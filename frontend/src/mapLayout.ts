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
//
// dagreの出力はそのまま最終座標にしない。あくまで「階層構造という骨格」の初期値として使い、
// この後のapplyRelaxedLayout()で少し有機的に崩す（center座標のまま渡すのはそのため。
// React Flow用の左上原点への変換はcenterToTopLeft()で最後にまとめて行う）。
function runDagreHierarchyLayout(
  nodes: HierarchyNodeInput[],
  edges: HierarchyEdgeInput[],
  direction: "LR" | "TB",
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
    positions.set(node.id, pos);
  }
  return positions;
}

// dagreのcenter座標をそのまま返す版（relaxed layoutの入力用）。
export function computeHierarchyLayoutCenters(
  nodes: HierarchyNodeInput[],
  edges: HierarchyEdgeInput[],
  direction: "LR" | "TB" = "LR",
): Map<string, Point> {
  return runDagreHierarchyLayout(nodes, edges, direction);
}

// dagreのcenter座標を、React Flowが使う左上原点座標へ変換したものを返す版
// （relaxed layoutを経由しない単純な利用や、テストでの直接比較に使う）。
export function computeHierarchyLayout(
  nodes: HierarchyNodeInput[],
  edges: HierarchyEdgeInput[],
  direction: "LR" | "TB" = "LR",
): Map<string, Point> {
  const centers = runDagreHierarchyLayout(nodes, edges, direction);
  const sizeById = new Map(nodes.map((n) => [n.id, { width: n.width, height: n.height }]));
  const positions = new Map<string, Point>();
  for (const [id, center] of centers) {
    const size = sizeById.get(id);
    positions.set(id, centerToTopLeft(center, size?.width ?? 0, size?.height ?? 0));
  }
  return positions;
}

export function centerToTopLeft(center: Point, width: number, height: number): Point {
  return { x: center.x - width / 2, y: center.y - height / 2 };
}

// --- ここから「relaxed tree layout」: dagreが出した座標をそのまま最終座標にせず、
// 階層構造という骨格を保ったまま、少し有機的に崩す後処理レイヤー。
// 完全なTreeでも完全なforce-directed graphでもない、中間を狙う。
// すべて文字列（node id）のハッシュに基づく決定的な処理にし、Math.random()は使わない
// （同じデータなら常に同じ配置になる。#13の「layoutの安定性」要件）。

// FNV-1a風の単純な文字列ハッシュを[0,1)の疑似乱数値に変換する。暗号強度は不要で、
// 「同じidなら常に同じ値」という決定性だけが必要。
function hashStringToUnit(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

// idとaxis（"x"/"y"）から[-range, range)の決定的なオフセットを作る。
function jitterAmount(id: string, axis: "x" | "y", range: number): number {
  if (range <= 0) return 0;
  const unit = hashStringToUnit(`${id}:${axis}`);
  return (unit - 0.5) * 2 * range;
}

// 階層ごとのjitterの強さ。Root Topicは「大きな中心」であることを保ちたいのでわずかに、
// Conceptは末端なので大きめに揺らす（#5「階層制約は維持する」・#3「siblingを完全な
// 等間隔にしない」の両方をこの強さの差だけで満たす）。rankdir="LR"前提で、depth方向
// （x）は階層の読みやすさを壊さないよう小さめ、cross方向（y、sibling展開方向）は
// 有機的な広がりを出すためやや大きめにする。
const JITTER_BY_KIND: Record<MapNodeKind, { x: number; y: number }> = {
  rootTopic: { x: 6, y: 14 },
  subtopic: { x: 10, y: 26 },
  concept: { x: 16, y: 40 },
};

export interface RelaxLayoutNodeInput {
  id: string;
  kind: MapNodeKind;
  size: number;
}

export interface RelationEdgeInput {
  source: string;
  target: string;
}

// #2/#3: 同じdepthのnodeが完全な1列・siblingが完全な等間隔にならないよう、
// node idから決定的なjitterを加える。
function applyOrganicJitter(
  positions: Map<string, Point>,
  nodes: RelaxLayoutNodeInput[],
): Map<string, Point> {
  const result = new Map<string, Point>();
  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const range = JITTER_BY_KIND[node.kind];
    result.set(node.id, {
      x: pos.x + jitterAmount(node.id, "x", range.x),
      y: pos.y + jitterAmount(node.id, "y", range.y),
    });
  }
  return result;
}

const RELATION_ATTRACTION_ITERATIONS = 3;
// cross方向（y）を中心に引き寄せ、depth方向（x、階層の意味を持つ軸）への影響は
// 弱く抑える（#4「Topic hierarchy上の位置を壊さない範囲で」・#5「階層制約は維持する」）。
const RELATION_ATTRACTION_Y_FACTOR = 0.16;
const RELATION_ATTRACTION_X_FACTOR = 0.05;
const RELATION_MAX_PULL = 36;

// #4: ConceptRelationで結ばれたConcept同士を、階層方向の位置を大きく崩さない範囲で
// 少し近づける。相互に少しずつ動かす（一方だけを動かすと非対称になりすぎるため）。
function applyRelationAttraction(
  positions: Map<string, Point>,
  relationEdges: RelationEdgeInput[],
): Map<string, Point> {
  if (relationEdges.length === 0) return positions;
  const result = new Map(positions);

  for (let iter = 0; iter < RELATION_ATTRACTION_ITERATIONS; iter++) {
    for (const edge of relationEdges) {
      const a = result.get(edge.source);
      const b = result.get(edge.target);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const pullX = clamp(dx * RELATION_ATTRACTION_X_FACTOR, -RELATION_MAX_PULL, RELATION_MAX_PULL);
      const pullY = clamp(dy * RELATION_ATTRACTION_Y_FACTOR, -RELATION_MAX_PULL, RELATION_MAX_PULL);
      result.set(edge.source, { x: a.x + pullX, y: a.y + pullY });
      result.set(edge.target, { x: b.x - pullX, y: b.y - pullY });
    }
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

const COLLISION_ITERATIONS = 4;
const COLLISION_PADDING = 14;

// #5: jitter・引力で寄せた結果、node同士が重なってしまうことがあるため、
// 円同士の距離が(半径の和+余白)未満なら押し離す。短時間・固定回数で止める
// （#22「長時間simulationを動かし続けない」）。
function resolveCollisions(positions: Map<string, Point>, nodes: RelaxLayoutNodeInput[]): Map<string, Point> {
  const ids = nodes.map((n) => n.id);
  const sizeById = new Map(nodes.map((n) => [n.id, n.size]));
  const result = new Map(positions);

  for (let iter = 0; iter < COLLISION_ITERATIONS; iter++) {
    for (let i = 0; i < ids.length; i++) {
      const idA = ids[i];
      const a = result.get(idA);
      if (!a) continue;
      for (let j = i + 1; j < ids.length; j++) {
        const idB = ids[j];
        const b = result.get(idB);
        if (!b) continue;

        const minDist = (sizeById.get(idA) ?? 40) / 2 + (sizeById.get(idB) ?? 40) / 2 + COLLISION_PADDING;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        if (dist >= minDist) continue;

        const overlap = (minDist - dist) / 2;
        const ux = dx / dist;
        const uy = dy / dist;
        result.set(idA, { x: a.x - ux * overlap, y: a.y - uy * overlap });
        result.set(idB, { x: b.x + ux * overlap, y: b.y + uy * overlap });
      }
    }
  }
  return result;
}

// #7: 複数のRoot Topicが「すべて」表示されるとき、dagreは非連結な木を単純に並べるだけなので
// 一直線に整列しがちになる。root topicごとに小さな決定的なY方向オフセットを与え、
// 完全な横一列ではなく緩やかに散らばった「島」に見えるようにする（近づきすぎない程度の幅）。
const CLUSTER_OFFSET_RANGE = 46;

function applyClusterOffsets(
  positions: Map<string, Point>,
  clusterKeyById: Map<string, string>,
): Map<string, Point> {
  const result = new Map<string, Point>();
  for (const [id, pos] of positions) {
    const clusterKey = clusterKeyById.get(id);
    const offsetY = clusterKey ? jitterAmount(clusterKey, "y", CLUSTER_OFFSET_RANGE) : 0;
    result.set(id, { x: pos.x, y: pos.y + offsetY });
  }
  return result;
}

// dagreが出したcenter座標（+node情報）から、階層構造を保ったまま少し有機的に崩した
// 最終center座標を返す。呼び出し順序が結果を左右するため、常に
// 「jitter → cluster offset → relation attraction → collision解消」の順で適用する
// （jitterで個々をばらけさせた後に島単位でまとめて動かし、関係で引き寄せてから、
// 最後に重なりだけを解消する）。
export function applyRelaxedLayout(
  centerPositions: Map<string, Point>,
  nodes: RelaxLayoutNodeInput[],
  relationEdges: RelationEdgeInput[],
  clusterKeyById: Map<string, string>,
): Map<string, Point> {
  let positions = applyOrganicJitter(centerPositions, nodes);
  positions = applyClusterOffsets(positions, clusterKeyById);
  positions = applyRelationAttraction(positions, relationEdges);
  positions = resolveCollisions(positions, nodes);
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

// Understanding Mapのノード配置ロジック（Reactに依存しない純粋なモジュール）。
//
// Mapの役割は「すべてを一覧させること」ではなく「気になるConceptから、理解のつながりを
// 辿ること」に絞っている。そのためTopicはグラフ上のnode（hub node）としては扱わず、
// 同じクラスタのConcept群をまとめる背景ラベル（表示専用・非physicsな存在）としてのみ扱う。
// force simulationの対象はConcept nodeだけで、Topic階層のedge（親子・所属）も張らない
// （「近い」ことは色分け＋弱いクラスタリング力だけで表現し、線を増やしすぎない）。
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";

export interface TopicLike {
  _id: string;
  parentId?: string | null;
}

export const UNCLASSIFIED_CLUSTER = "__unclassified__";

// topicIdの親を辿ってルートTopicのidを返す（マップのクラスタ分けに使う）。
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

// クラスタ分け（画面上でどのTopicファミリーに属するか）の基準は、Conceptの最初の
// topicIdが属するルートTopic。topicIdsが空（未分類）のConceptは専用の「未分類」
// クラスタに入れる。Topicの階層（親子）はクラスタ分けにしか使わず、Map上に
// 個別の階層構造としては描画しない（ルートTopicひとつにつき、ラベルはひとつだけ）。
export function getClusterKey(concept: ConceptLike, topics: TopicLike[]): string {
  const primaryTopicId = concept.topicIds[0];
  if (!primaryTopicId) return UNCLASSIFIED_CLUSTER;
  return findRootTopicId(topics, primaryTopicId);
}

export type Point = { x: number; y: number };

// クラスタの中心点を外周円上に配置する。d3-forceの「引き寄せ先」として使うだけで、
// 最終座標そのものではない（各クラスタ内部の配置はforceLink/forceManyBody/forceCollideが決める）。
export function computeClusterCenters(clusterKeys: string[]): Map<string, Point> {
  const clusterCount = Math.max(clusterKeys.length, 1);
  // クラスタ間の距離を広げすぎると「1つの理解マップ」ではなく孤立した島の集まりに
  // 見えてしまう。node同士の重なりはforceCollideが防ぐため、ここでの半径は控えめにとどめる。
  const radius = Math.max(120, clusterCount * 55);
  const angleStep = (2 * Math.PI) / clusterCount;

  const centers = new Map<string, Point>();
  clusterKeys.forEach((key, index) => {
    const angle = index * angleStep;
    centers.set(key, {
      x: radius + radius * Math.cos(angle),
      y: radius + radius * Math.sin(angle),
    });
  });
  return centers;
}

// Node sizeは「なぜこのNodeが大きいのか」が直感的に分かるよう、Conceptに紐づく
// Knowledge数だけで決める（relation数は使わない。relationが多い＝理解が深いとは限らないため）。
// サイズ差も極端にならないよう3段階・6px刻みに抑える。
export function computeConceptRadius(knowledgeCount: number): number {
  if (knowledgeCount <= 1) return 18; // 36px
  if (knowledgeCount <= 3) return 21; // 42px
  return 24; // 48px
}

export interface ForceNodeInput {
  id: string;
  clusterKey: string;
  radius: number;
}

export interface ForceLinkInput {
  source: string;
  target: string;
}

interface SimNode extends ForceNodeInput {
  x: number;
  y: number;
  vx?: number;
  vy?: number;
}

const SIMULATION_TICKS = 300;

// ConceptRelationのedge（force layout上ではこれだけがlink force）。「近すぎてどれが
// 繋がっているか分からない」ことを避けつつ、関連するConcept同士が自然に近づく程度の距離・強さ。
const RELATION_LINK_DISTANCE = 120;
const RELATION_LINK_STRENGTH = 0.32;

// previousPositions（フィルタ変更前・ドラッグ後の位置）が渡された場合はwarm startとして使う。
// 新規ノードはクラスタ中心付近にランダムな初期位置を与える。
export function computeForceLayout(
  nodes: ForceNodeInput[],
  links: ForceLinkInput[],
  clusterCenters: Map<string, Point>,
  previousPositions?: Map<string, Point>,
): Map<string, Point> {
  if (nodes.length === 0) return new Map();

  if (nodes.length === 1) {
    return new Map([[nodes[0].id, { x: 0, y: 0 }]]);
  }

  if (nodes.length === 2) {
    return new Map([
      [nodes[0].id, { x: -90, y: 0 }],
      [nodes[1].id, { x: 90, y: 0 }],
    ]);
  }

  const simNodes: SimNode[] = nodes.map((n) => {
    const previous = previousPositions?.get(n.id);
    const center = clusterCenters.get(n.clusterKey) ?? { x: 0, y: 0 };
    const seed = previous ?? {
      x: center.x + (Math.random() - 0.5) * 40,
      y: center.y + (Math.random() - 0.5) * 40,
    };
    return { ...n, x: seed.x, y: seed.y };
  });

  const nodeIds = new Set(simNodes.map((n) => n.id));
  const validLinks = links.filter((l) => nodeIds.has(l.source) && nodeIds.has(l.target));

  const simulation = forceSimulation(simNodes)
    .force(
      "link",
      forceLink<SimNode, ForceLinkInput>(validLinks)
        .id((d) => d.id)
        .distance(RELATION_LINK_DISTANCE)
        .strength(RELATION_LINK_STRENGTH),
    )
    // 反発はnode同士の重なり防止に必要な最小限にとどめる（強すぎるとクラスタが
    // 孤立した島のように離れてしまう）。重なり防止自体はforceCollideが担う。
    .force("charge", forceManyBody().strength(-150))
    .force(
      "collide",
      forceCollide<SimNode>().radius((d) => d.radius + 10),
    )
    .force(
      "clusterX",
      forceX<SimNode>((d) => clusterCenters.get(d.clusterKey)?.x ?? 0).strength(0.08),
    )
    .force(
      "clusterY",
      forceY<SimNode>((d) => clusterCenters.get(d.clusterKey)?.y ?? 0).strength(0.08),
    )
    // 全体を中心へ寄せる力を強めにし、クラスタ同士が完全に分断されず
    // 「1つのマップ」として見え、かつ全体がコンパクトにまとまるようにする。
    .force("center", forceCenter(0, 0).strength(0.06))
    .stop();

  for (let i = 0; i < SIMULATION_TICKS; i++) {
    simulation.tick();
  }

  return new Map(simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

export interface ClusterMember {
  id: string;
  clusterKey: string;
  radius: number;
}

// Topicは「重いボックス」ではなく、クラスタの上に浮かべる控えめなラベルとして表現する。
// 実際のConcept配置（force layout後の座標）からクラスタの外接矩形を求め、その上端中央を
// ラベルのアンカー座標にする（ラベル自体はCSS側でtranslate(-50%, -100%)し、アンカーの
// 真上・中央に浮くように描画する）。
export function computeClusterLabelAnchors(members: ClusterMember[], positions: Map<string, Point>): Map<string, Point> {
  const bounds = new Map<string, { minX: number; maxX: number; minY: number }>();
  for (const member of members) {
    const pos = positions.get(member.id);
    if (!pos) continue;
    const current = bounds.get(member.clusterKey) ?? { minX: Infinity, maxX: -Infinity, minY: Infinity };
    current.minX = Math.min(current.minX, pos.x - member.radius);
    current.maxX = Math.max(current.maxX, pos.x + member.radius);
    current.minY = Math.min(current.minY, pos.y - member.radius);
    bounds.set(member.clusterKey, current);
  }

  const LABEL_GAP = 20;
  const anchors = new Map<string, Point>();
  for (const [key, b] of bounds) {
    anchors.set(key, { x: (b.minX + b.maxX) / 2, y: b.minY - LABEL_GAP });
  }
  return anchors;
}

const TOPIC_COLOR_PALETTE = ["#2b6cb0", "#c0392b", "#2f855a", "#b7791f", "#6b46c1", "#00838f", "#ad1457", "#4e5d94"];

// 出現順にトピック（クラスタ）へ色を割り当てる。未分類は常に固定のグレーにする
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

// Understanding Mapのノード配置ロジック（Reactに依存しない純粋なモジュール）。
// 「トピックごとに二重円を機械的に並べる」だけの配置ではなく、d3-forceの
// force-directed layoutで「関連するConceptは近く、同じTopicのConceptは自然に集まる」
// 有機的な配置を一度だけ計算する。continuous animationはしない（計算後にsimulationを止める）。
import { forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";
import type { ConceptRelation } from "./types";

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

// クラスタ分けの基準は、Conceptの最初のtopicIdが属するルートTopic。
// topicIdsが空（未分類）のConceptは専用の「未分類」クラスタに入れる。
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
  const radius = Math.max(220, clusterCount * 90);
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

// Concept重要度（紐づくKnowledge数＋関係数）から、視覚サイズと衝突判定の両方に使う半径を求める。
// 差が極端にならないよう上限8でクランプする。
export function computeConceptRadius(degree: number): number {
  const sizeBoost = Math.min(degree, 8);
  return 34 + sizeBoost * 2.2;
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
        .distance(90)
        .strength(0.4),
    )
    .force("charge", forceManyBody().strength(-140))
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
    .force("center", forceCenter(0, 0).strength(0.02))
    .stop();

  for (let i = 0; i < SIMULATION_TICKS; i++) {
    simulation.tick();
  }

  return new Map(simNodes.map((n) => [n.id, { x: n.x, y: n.y }]));
}

// 各クラスタの実際に落ち着いた座標（settled positions）から、ラベルを置くべき位置
// （そのクラスタの一番上・水平方向の中心）を求める。円形の理論上の中心ではなく実際の
// 分布を見るため、force-directed layoutで多少歪んだクラスタでも自然にラベルが乗る。
export function computeClusterLabelPositions(
  nodes: ForceNodeInput[],
  positions: Map<string, Point>,
): Map<string, Point> {
  const minYByCluster = new Map<string, number>();
  const sumXByCluster = new Map<string, { sum: number; count: number }>();

  for (const node of nodes) {
    const pos = positions.get(node.id);
    if (!pos) continue;
    const currentMinY = minYByCluster.get(node.clusterKey);
    if (currentMinY === undefined || pos.y < currentMinY) minYByCluster.set(node.clusterKey, pos.y);
    const agg = sumXByCluster.get(node.clusterKey) ?? { sum: 0, count: 0 };
    agg.sum += pos.x;
    agg.count += 1;
    sumXByCluster.set(node.clusterKey, agg);
  }

  const labelPositions = new Map<string, Point>();
  for (const [key, minY] of minYByCluster) {
    const agg = sumXByCluster.get(key);
    const avgX = agg ? agg.sum / agg.count : 0;
    labelPositions.set(key, { x: avgX, y: minY - 50 });
  }
  return labelPositions;
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

// Conceptの重要度（node sizeの根拠）＝紐づくKnowledge数＋関係数。
export function computeConceptDegree(conceptId: string, knowledgeCount: number, relations: ConceptRelation[]): number {
  const relationCount = relations.filter((r) => r.fromConceptId === conceptId || r.toConceptId === conceptId).length;
  return knowledgeCount + relationCount;
}

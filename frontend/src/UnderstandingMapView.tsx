import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ConceptRelation, ConceptRelationType, SavedKnowledge, Topic, UnderstandingConcept } from "./types";
import { STATUS_LABELS, effectiveStatus, statusClassName } from "./UnderstandingPage";
import ConceptNode, { type ConceptNodeData } from "./ConceptNode";
import TopicNode, { type TopicNodeData } from "./TopicNode";
import {
  UNCLASSIFIED_CLUSTER,
  buildTopicColorMap,
  computeClusterCenters,
  computeConceptDegree,
  computeConceptRadius,
  computeForceLayout,
  computeTopicDepth,
  computeTopicRadius,
  findRootTopicId,
  getClusterKey,
  type ForceLinkInput,
  type ForceNodeInput,
  type Point,
} from "./mapLayout";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

const NODE_TYPES = { concept: ConceptNode, topic: TopicNode };
const MINIMAP_THRESHOLD = 15;

type UnderstandingMapData = {
  topics: Topic[];
  concepts: UnderstandingConcept[];
  relations: ConceptRelation[];
};

type MapFetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | ({ status: "success" } & UnderstandingMapData);

async function parseMapResponse(res: Response): Promise<UnderstandingMapData> {
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }
  return { topics: body?.topics ?? [], concepts: body?.concepts ?? [], relations: body?.relations ?? [] };
}

// 読み取り専用。lazy migrationやLLMによるTopic分類などの副作用は一切行わない
// （マップタブを開くたびに呼んでも安全）。
async function fetchUnderstandingMap(): Promise<UnderstandingMapData> {
  const res = await fetch(`${API_BASE_URL}/api/understanding-map`);
  return parseMapResponse(res);
}

// 未移行のKnowledgeのConcept化と、未分類のConceptのTopic分類（LLM呼び出しを伴う）を
// 明示的に実行する。ユーザーが「理解マップを更新」を押したときだけ呼ぶ。
async function refreshUnderstandingMap(): Promise<UnderstandingMapData> {
  const res = await fetch(`${API_BASE_URL}/api/understanding-map/refresh`, { method: "POST" });
  return parseMapResponse(res);
}

type TopicTreeNode = {
  id: string;
  name: string;
  children: TopicTreeNode[];
};

// Topic.parentIdから階層ツリーを組み立てる（archived/mergedは除外）。
function buildTopicHierarchy(topics: Topic[]): TopicTreeNode[] {
  const active = topics.filter((t) => t.status === "active");
  const childrenByParent = new Map<string | null, Topic[]>();
  for (const topic of active) {
    const key = topic.parentId ?? null;
    const list = childrenByParent.get(key);
    if (list) list.push(topic);
    else childrenByParent.set(key, [topic]);
  }

  function build(parentId: string | null): TopicTreeNode[] {
    const children = childrenByParent.get(parentId) ?? [];
    return children
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name, "ja"))
      .map((topic) => ({ id: topic._id, name: topic.name, children: build(topic._id) }));
  }

  return build(null);
}

// 指定したTopicとその配下（子孫）すべてのidを集める（Topic選択によるConcept絞り込み用）。
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

// selectedTopicIdが無いときの起点（=「すべて」表示時に階層の深さ0として扱うTopic群）。
// ルートTopic（parentIdが無いactiveなTopic）を起点にする。
function getBaseTopicIds(topics: Topic[], selectedTopicId: string | null): string[] {
  if (selectedTopicId) return [selectedTopicId];
  return topics.filter((t) => t.status === "active" && !t.parentId).map((t) => t._id);
}

// baseIdsを深さ0として、maxDepth階層下までのTopic idを集める（maxDepth=nullなら無制限）。
// 「2階層まで表示」のような深さ制限フィルタのために使う。
function collectTopicIdsWithinDepth(topics: Topic[], baseIds: string[], maxDepth: number | null): Set<string> {
  if (maxDepth === null) {
    const result = new Set<string>();
    for (const id of baseIds) {
      for (const descendantId of collectDescendantTopicIds(topics, id)) result.add(descendantId);
    }
    return result;
  }

  const childrenByParent = new Map<string, string[]>();
  for (const topic of topics) {
    if (!topic.parentId) continue;
    const list = childrenByParent.get(topic.parentId);
    if (list) list.push(topic._id);
    else childrenByParent.set(topic.parentId, [topic._id]);
  }

  const result = new Set<string>();
  let frontier = baseIds.map((id) => ({ id, depth: 0 }));
  while (frontier.length > 0) {
    const next: { id: string; depth: number }[] = [];
    for (const { id, depth } of frontier) {
      if (result.has(id)) continue;
      result.add(id);
      if (depth < maxDepth) {
        for (const childId of childrenByParent.get(id) ?? []) next.push({ id: childId, depth: depth + 1 });
      }
    }
    frontier = next;
  }
  return result;
}

function getVisibleConcepts(
  activeConcepts: UnderstandingConcept[],
  topics: Topic[],
  selectedTopicId: string | null,
  maxDepth: number | null,
): UnderstandingConcept[] {
  const baseIds = getBaseTopicIds(topics, selectedTopicId);
  const allowed = collectTopicIdsWithinDepth(topics, baseIds, maxDepth);
  // 未分類（topicIdsが空）のConceptは階層の深さの概念が無いため、常に表示対象にする。
  return activeConcepts.filter((c) => c.topicIds.length === 0 || c.topicIds.some((id) => allowed.has(id)));
}

// Conceptに紐づくKnowledgeをconceptIdごとにまとめる（outdatedは詳細一覧からも外す）。
function countKnowledgeByConcept(knowledge: SavedKnowledge[]): Map<string, SavedKnowledge[]> {
  const map = new Map<string, SavedKnowledge[]>();
  for (const item of knowledge) {
    if (effectiveStatus(item) === "outdated") continue;
    for (const conceptId of item.conceptIds ?? []) {
      const list = map.get(conceptId);
      if (list) list.push(item);
      else map.set(conceptId, [item]);
    }
  }
  return map;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyChanged(concept: UnderstandingConcept, knowledgeItems: SavedKnowledge[]): boolean {
  const now = Date.now();
  if (now - new Date(concept.createdAt).getTime() <= WEEK_MS) return true;
  return knowledgeItems.some((k) => now - new Date(k.createdAt).getTime() <= WEEK_MS);
}

// Mapは俯瞰用のUIなので、node内のlabelは原則1〜2行に収まる文字数に短縮する
// （3〜4行に折り返されて読みにくいというユーザー指摘への対応）。フルテキストは
// ConceptNode.tsx側でtitle属性（hover tooltip）として保持し、詳細パネルでも確認できる。
const CONCEPT_LABEL_MAX_CHARS = 12;

function truncateLabel(text: string, max = CONCEPT_LABEL_MAX_CHARS): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// ConceptRelationにはまだ「強さ」を表す独立したフィールドが無いため、backendの
// データモデルは変えずにfrontend側だけの簡易的な基準で「弱いつながり」を判定する。
// "related"は他のtype（前提/一部/要因/対立/深掘り/更新）と違って意味が限定されない
// 最も緩やかな関連付けであるため、これだけを「弱いつながり」として扱う。
function isWeakRelation(type: ConceptRelationType): boolean {
  return type === "related";
}

function filterRelationsByStrength(relations: ConceptRelation[], showWeakLinks: boolean): ConceptRelation[] {
  return showWeakLinks ? relations : relations.filter((r) => !isWeakRelation(r.type));
}

// トピック選択用の<select>に、階層の深さをインデントで表現しつつ全Topicをフラットに並べる。
function flattenTopicOptions(nodes: TopicTreeNode[], depth = 0): { id: string; name: string; depth: number }[] {
  const result: { id: string; name: string; depth: number }[] = [];
  for (const node of nodes) {
    result.push({ id: node.id, name: node.name, depth });
    result.push(...flattenTopicOptions(node.children, depth + 1));
  }
  return result;
}

const RELATION_TYPE_LABEL: Record<ConceptRelationType, string> = {
  related: "関連",
  prerequisite: "前提",
  part_of: "一部",
  causes: "要因",
  contrasts: "対立",
  extends: "深掘り",
  supersedes: "更新",
};

// relation typeを色分けで複雑化せず、edgeが「つながっている」ことが分かる程度の
// 控えめな単色＋小さなラベルにとどめる（hover時のみ強調、UnderstandingMapView側で処理）。
// 矢印（markerEnd）を付け、fromConceptId→toConceptIdの向き（例:「深掘り」ならfromがtoの
// 理解をさらに広げた側）が見て分かるようにする。
function buildConceptEdges(relations: ConceptRelation[], visibleIds: Set<string>): Edge[] {
  return relations
    .filter((r) => visibleIds.has(r.fromConceptId) && visibleIds.has(r.toConceptId))
    .map((r) => ({
      id: r._id,
      source: r.fromConceptId,
      target: r.toConceptId,
      label: RELATION_TYPE_LABEL[r.type],
      style: { stroke: "#ccc" },
      labelStyle: { fontSize: 10, fill: "#999" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#ccc", width: 14, height: 14 },
    }));
}

// Topicの親子関係（parentId）とTopic→Conceptの所属関係を、それぞれ別のedge kindとして
// 生成する。ConceptRelation（意味的な関係）とは見た目を変え、細く控えめな線＋矢印にする
// ことで「これは階層構造のedgeだ」と直感的に区別できるようにする。
function buildHierarchyEdges(
  topicParentLinks: { source: string; target: string }[],
  topicConceptLinks: { source: string; target: string }[],
): Edge[] {
  const edges: Edge[] = [];
  for (const link of topicParentLinks) {
    edges.push({
      id: `topic-parent-${link.source}-${link.target}`,
      source: link.source,
      target: link.target,
      style: { stroke: "#d8d8d8", strokeDasharray: "4 3" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#d8d8d8", width: 12, height: 12 },
    });
  }
  for (const link of topicConceptLinks) {
    edges.push({
      id: `topic-concept-${link.source}-${link.target}`,
      source: link.source,
      target: link.target,
      style: { stroke: "#e5e5e5" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#e5e5e5", width: 10, height: 10 },
    });
  }
  return edges;
}

// visibleConceptsが属するTopicのうち、実際にグラフへhub nodeとして表示すべきもの
// （選択中Topicがあればそこから下だけ、無ければ各rootまで遡って含める）。
function collectRelevantTopicIds(
  concepts: UnderstandingConcept[],
  topics: Topic[],
  selectedTopicId: string | null,
): Set<string> {
  const byId = new Map(topics.map((t) => [t._id, t]));
  const relevant = new Set<string>();
  for (const concept of concepts) {
    const primary = concept.topicIds[0];
    if (!primary) continue;
    let current = byId.get(primary);
    const seen = new Set<string>();
    while (current && !seen.has(current._id)) {
      relevant.add(current._id);
      seen.add(current._id);
      if (selectedTopicId && current._id === selectedTopicId) break;
      current = current.parentId ? byId.get(current.parentId) : undefined;
    }
  }
  return relevant;
}

function computeMapSummary(
  knowledge: SavedKnowledge[],
  topics: Topic[],
  concepts: UnderstandingConcept[],
  relations: ConceptRelation[],
) {
  const now = Date.now();
  const recentKnowledge = knowledge.filter((k) => now - new Date(k.createdAt).getTime() <= WEEK_MS).length;
  const recentRelations = relations.filter((r) => now - new Date(r.createdAt).getTime() <= WEEK_MS).length;
  return {
    knowledgeCount: knowledge.length,
    topicCount: topics.filter((t) => t.status === "active").length,
    conceptCount: concepts.filter((c) => c.status === "active").length,
    relationCount: relations.length,
    recentKnowledge,
    recentRelations,
  };
}

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

function ConceptDetailPanel({
  concept,
  topics,
  concepts,
  relations,
  knowledgeItems,
  onClose,
  onSelectConcept,
}: {
  concept: UnderstandingConcept;
  topics: Topic[];
  concepts: UnderstandingConcept[];
  relations: ConceptRelation[];
  knowledgeItems: SavedKnowledge[];
  onClose: () => void;
  onSelectConcept: (conceptId: string) => void;
}) {
  const conceptById = useMemo(() => new Map(concepts.map((c) => [c._id, c])), [concepts]);
  const breadcrumb = concept.topicIds[0] ? buildTopicBreadcrumb(topics, concept.topicIds[0]) : [];

  const relatedConceptIds = useMemo(() => {
    const ids = new Set<string>();
    for (const r of relations) {
      if (r.fromConceptId === concept._id) ids.add(r.toConceptId);
      if (r.toConceptId === concept._id) ids.add(r.fromConceptId);
    }
    return Array.from(ids);
  }, [relations, concept._id]);

  return (
    <div className="concept-detail-panel">
      <div className="concept-detail-header">
        <h3>{concept.name}</h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      {breadcrumb.length > 0 && <p className="concept-detail-breadcrumb">{breadcrumb.join(" > ")}</p>}

      <h4 className="concept-detail-section-title">自分が理解していること</h4>
      {knowledgeItems.length === 0 ? (
        <p className="concept-detail-empty">まだこのConceptに紐づく理解はありません。</p>
      ) : (
        <ul className="concept-detail-knowledge-list">
          {knowledgeItems.map((item) => {
            const status = effectiveStatus(item);
            return (
              <li key={item._id} className={statusClassName(item)}>
                <p className="concept-detail-knowledge-statement">{item.statement}</p>
                <p className="concept-detail-knowledge-meta">
                  {status !== "active" && <span className="understanding-item-status">{STATUS_LABELS[status]}</span>}
                  <a href={item.source.url} target="_blank" rel="noreferrer">
                    {item.source.title}
                  </a>
                </p>
              </li>
            );
          })}
        </ul>
      )}

      {relatedConceptIds.length > 0 && (
        <>
          <h4 className="concept-detail-section-title">関連する概念</h4>
          <ul className="concept-detail-related-list">
            {relatedConceptIds.map((id) => {
              const related = conceptById.get(id);
              if (!related) return null;
              return (
                <li key={id}>
                  <button type="button" className="topic-item-button" onClick={() => onSelectConcept(id)}>
                    {related.name}
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

export default function UnderstandingMapView({
  knowledge,
  initialTopicName,
}: {
  knowledge: SavedKnowledge[];
  initialTopicName?: string | null;
}) {
  const navigate = useNavigate();
  const [mapState, setMapState] = useState<MapFetchState>({ status: "loading" });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  // 表示するTopic階層の深さ（選択中Topic、または「すべて」ならルートTopicを深さ0として数える）。
  // nullは無制限。大きなマップでもクラスタが多すぎて見づらくならないよう、初期値は2階層までにする。
  const [maxDepth, setMaxDepth] = useState<number | null>(2);
  // ConceptRelationに強さの区分がまだ無いため、frontend側の簡易基準（isWeakRelation）で
  // 「弱いつながり」を判定し、既定では非表示にする（つながりが多すぎて見づらくなるのを防ぐ）。
  const [showWeakLinks, setShowWeakLinks] = useState(false);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const appliedInitialTopicRef = useRef(false);

  const [nodes, setNodes, onNodesChange] = useNodesState<ConceptNodeData | TopicNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);

  useEffect(() => {
    let cancelled = false;
    fetchUnderstandingMap()
      .then((data) => {
        if (!cancelled) setMapState({ status: "success", ...data });
      })
      .catch((err) => {
        if (!cancelled) {
          setMapState({ status: "error", message: err instanceof Error ? err.message : "取得に失敗しました" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // トピックタブから渡された旧モデルのトピック名と、新モデルのTopic名が一致すれば
  // 初期絞り込みとして使う（ベストエフォート。一致しなければ「すべて」のまま）。
  useEffect(() => {
    if (appliedInitialTopicRef.current) return;
    if (mapState.status !== "success" || !initialTopicName) return;
    const match = mapState.topics.find((t) => t.status === "active" && t.name === initialTopicName);
    if (match) setSelectedTopicId(match._id);
    appliedInitialTopicRef.current = true;
  }, [mapState, initialTopicName]);

  const topics = mapState.status === "success" ? mapState.topics : [];
  const concepts = mapState.status === "success" ? mapState.concepts : [];
  const relations = mapState.status === "success" ? mapState.relations : [];

  const activeConcepts = useMemo(() => concepts.filter((c) => c.status === "active"), [concepts]);
  const knowledgeByConcept = useMemo(() => countKnowledgeByConcept(knowledge), [knowledge]);
  const topicHierarchy = useMemo(() => buildTopicHierarchy(topics), [topics]);
  const visibleConcepts = useMemo(
    () => getVisibleConcepts(activeConcepts, topics, selectedTopicId, maxDepth),
    [activeConcepts, topics, selectedTopicId, maxDepth],
  );
  const visibleRelations = useMemo(
    () => filterRelationsByStrength(relations, showWeakLinks),
    [relations, showWeakLinks],
  );
  const topicOptions = useMemo(() => flattenTopicOptions(topicHierarchy), [topicHierarchy]);
  const visibleIds = useMemo(() => new Set(visibleConcepts.map((c) => c._id)), [visibleConcepts]);
  const allClusterKeys = useMemo(
    () => Array.from(new Set(activeConcepts.map((c) => getClusterKey(c, topics)))),
    [activeConcepts, topics],
  );
  const topicColorMap = useMemo(() => buildTopicColorMap(allClusterKeys), [allClusterKeys]);
  const summary = useMemo(
    () => computeMapSummary(knowledge, topics, concepts, relations),
    [knowledge, topics, concepts, relations],
  );
  const unclassifiedCount = useMemo(
    () => activeConcepts.filter((c) => c.topicIds.length === 0).length,
    [activeConcepts],
  );

  // ノードの初期配置（force-directed layout）を計算し、React Flowのnodes/edges stateへ反映する。
  // Topic自体もグラフ上のhub nodeとして扱い、Topic->Topic（親子）・Topic->Concept（所属）の
  // edgeを張ることで、階層関係を「近くにまとまっている」だけでなく「線と矢印で繋がっている」
  // ことで見て分かるようにする。
  // resetPositions=falseのときは直前の位置をwarm startとして使い（ドラッグ位置・既存クラスタの
  // 位置を尊重）、resetPositions=true（「整列」ボタン）のときは全ノードをクラスタ中心付近へ
  // 再シードする。この関数は「①データ取得/更新」「②Topicフィルタ変更」「③整列ボタン」の
  // 3か所からしか呼ばれない（hoverや詳細パネルの開閉など他の再レンダーでは呼ばれない）ため、
  // ユーザーがドラッグした位置がそれ以外のタイミングで勝手に戻ることはない。
  function recomputeLayout(resetPositions: boolean) {
    const relevantTopicIds = collectRelevantTopicIds(visibleConcepts, topics, selectedTopicId);
    const hasUnclassified = visibleConcepts.some((c) => c.topicIds.length === 0);
    const topicById = new Map(topics.map((t) => [t._id, t]));

    const clusterKeysSet = new Set<string>();
    for (const topicId of relevantTopicIds) clusterKeysSet.add(findRootTopicId(topics, topicId));
    if (hasUnclassified) clusterKeysSet.add(UNCLASSIFIED_CLUSTER);
    const clusterCenters = computeClusterCenters(Array.from(clusterKeysSet));

    const directConceptCountByTopic = new Map<string, number>();
    for (const concept of visibleConcepts) {
      const primary = concept.topicIds[0] ?? UNCLASSIFIED_CLUSTER;
      directConceptCountByTopic.set(primary, (directConceptCountByTopic.get(primary) ?? 0) + 1);
    }

    const forceNodes: ForceNodeInput[] = [];
    for (const topicId of relevantTopicIds) {
      const depth = computeTopicDepth(topics, topicId);
      const directCount = directConceptCountByTopic.get(topicId) ?? 0;
      forceNodes.push({
        id: topicId,
        kind: "topic",
        clusterKey: findRootTopicId(topics, topicId),
        radius: computeTopicRadius(depth, directCount),
      });
    }
    if (hasUnclassified) {
      forceNodes.push({
        id: UNCLASSIFIED_CLUSTER,
        kind: "topic",
        clusterKey: UNCLASSIFIED_CLUSTER,
        radius: computeTopicRadius(0, directConceptCountByTopic.get(UNCLASSIFIED_CLUSTER) ?? 0),
      });
    }
    for (const concept of visibleConcepts) {
      const knowledgeItems = knowledgeByConcept.get(concept._id) ?? [];
      const degree = computeConceptDegree(concept._id, knowledgeItems.length, visibleRelations);
      forceNodes.push({
        id: concept._id,
        kind: "concept",
        clusterKey: getClusterKey(concept, topics),
        radius: computeConceptRadius(degree),
      });
    }

    const topicParentLinks: { source: string; target: string }[] = [];
    for (const topicId of relevantTopicIds) {
      const parentId = topicById.get(topicId)?.parentId;
      if (parentId && relevantTopicIds.has(parentId)) {
        topicParentLinks.push({ source: parentId, target: topicId });
      }
    }
    const topicConceptLinks: { source: string; target: string }[] = visibleConcepts.map((c) => ({
      source: c.topicIds[0] ?? UNCLASSIFIED_CLUSTER,
      target: c._id,
    }));

    const forceLinks: ForceLinkInput[] = [
      ...topicParentLinks.map((l) => ({ ...l, kind: "topicParent" as const })),
      ...topicConceptLinks.map((l) => ({ ...l, kind: "topicConcept" as const })),
      ...visibleRelations
        .filter((r) => visibleIds.has(r.fromConceptId) && visibleIds.has(r.toConceptId))
        .map((r) => ({ source: r.fromConceptId, target: r.toConceptId, kind: "conceptRelation" as const })),
    ];

    const previousPositions = resetPositions
      ? undefined
      : new Map<string, Point>(nodesRef.current.map((n) => [n.id, n.position]));
    const positions = computeForceLayout(forceNodes, forceLinks, clusterCenters, previousPositions);

    const newNodes: Node[] = [];
    for (const topicId of relevantTopicIds) {
      const pos = positions.get(topicId) ?? { x: 0, y: 0 };
      const depth = computeTopicDepth(topics, topicId);
      const directCount = directConceptCountByTopic.get(topicId) ?? 0;
      const data: TopicNodeData = {
        name: topicById.get(topicId)?.name ?? "",
        color: topicColorMap.get(findRootTopicId(topics, topicId)) ?? "#888",
        radius: computeTopicRadius(depth, directCount),
        dimmed: false,
        highlighted: false,
      };
      newNodes.push({ id: topicId, type: "topic", position: pos, data });
    }
    if (hasUnclassified) {
      const pos = positions.get(UNCLASSIFIED_CLUSTER) ?? { x: 0, y: 0 };
      const data: TopicNodeData = {
        name: "未分類",
        color: "#999999",
        radius: computeTopicRadius(0, directConceptCountByTopic.get(UNCLASSIFIED_CLUSTER) ?? 0),
        dimmed: false,
        highlighted: false,
      };
      newNodes.push({ id: UNCLASSIFIED_CLUSTER, type: "topic", position: pos, data });
    }

    for (const concept of visibleConcepts) {
      const pos = positions.get(concept._id) ?? { x: 0, y: 0 };
      const knowledgeItems = knowledgeByConcept.get(concept._id) ?? [];
      const degree = computeConceptDegree(concept._id, knowledgeItems.length, visibleRelations);
      const clusterKey = getClusterKey(concept, topics);
      const data: ConceptNodeData = {
        name: concept.name,
        label: truncateLabel(concept.name),
        knowledgeCount: knowledgeItems.length,
        color: topicColorMap.get(clusterKey) ?? "#2b6cb0",
        isNew: isRecentlyChanged(concept, knowledgeItems),
        dimmed: false,
        highlighted: false,
        selected: false,
        radius: computeConceptRadius(degree),
      };
      newNodes.push({ id: concept._id, type: "concept", position: pos, data });
    }

    setNodes(newNodes);
    setEdges([
      ...buildHierarchyEdges(topicParentLinks, topicConceptLinks),
      ...buildConceptEdges(visibleRelations, visibleIds),
    ]);
    setLayoutVersion((v) => v + 1);
  }

  // トリガー①②: データ取得・更新（mapStateの参照が変わる）とTopic/階層深さ/弱いつながり表示の
  // フィルタ変更。eslint的なexhaustive-depsはあえて満たさず、この変化だけを明示的なトリガーにする
  // （visibleConcepts等の派生値まで依存に含めると、hoverや詳細パネル開閉のたびに
  // レイアウトが再計算されてしまうため）。
  useEffect(() => {
    if (mapState.status !== "success") return;
    recomputeLayout(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopicId, maxDepth, showWeakLinks, mapState]);

  // hoverの隣接判定はConceptRelationだけでなく、Topic階層のedge（親子・所属）も含めた
  // 「今画面に引かれているすべてのedge」から求める。これにより、Conceptをhoverすると
  // 所属Topicも、Topic hub nodeをhoverするとその直下のConcept/子Topicも強調される。
  const neighborIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const e of edges) {
      if (e.source === hoveredNodeId) ids.add(e.target);
      if (e.target === hoveredNodeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, edges]);

  const displayNodes = useMemo(() => {
    return nodes.map((n) => {
      const highlighted = neighborIds ? neighborIds.has(n.id) : false;
      const dimmed = neighborIds ? !highlighted : false;
      if (n.type === "concept") {
        const selected = n.id === selectedConceptId;
        return { ...n, data: { ...n.data, highlighted, dimmed, selected } };
      }
      return { ...n, data: { ...n.data, highlighted, dimmed } };
    });
  }, [nodes, neighborIds, selectedConceptId]);

  const displayEdges = useMemo(() => {
    if (!hoveredNodeId) return edges;
    return edges.map((e) => {
      const touches = e.source === hoveredNodeId || e.target === hoveredNodeId;
      return {
        ...e,
        style: { ...e.style, stroke: touches ? "#2b6cb0" : "#eee" },
        labelStyle: e.label ? { fontSize: 10, fill: touches ? "#2b6cb0" : "#ddd" } : undefined,
        markerEnd: e.markerEnd
          ? { type: MarkerType.ArrowClosed, color: touches ? "#2b6cb0" : "#eee" }
          : undefined,
        zIndex: touches ? 1 : 0,
      };
    });
  }, [edges, hoveredNodeId]);

  const selectedConcept = useMemo(
    () => activeConcepts.find((c) => c._id === selectedConceptId) ?? null,
    [activeConcepts, selectedConceptId],
  );
  const selectedConceptKnowledge = useMemo(
    () => (selectedConcept ? (knowledgeByConcept.get(selectedConcept._id) ?? []) : []),
    [selectedConcept, knowledgeByConcept],
  );

  function handleSelectTopic(id: string | null) {
    setSelectedTopicId(id);
  }

  function handleSelectConcept(id: string) {
    setSelectedConceptId(id);
    setMobileDetailOpen(true);
  }

  function handleCloseDetail() {
    setSelectedConceptId(null);
    setMobileDetailOpen(false);
  }

  async function handleRefresh() {
    setRefreshing(true);
    setRefreshError(null);
    try {
      const data = await refreshUnderstandingMap();
      setMapState({ status: "success", ...data });
    } catch (err) {
      setRefreshError(err instanceof Error ? err.message : "更新に失敗しました");
    } finally {
      setRefreshing(false);
    }
  }

  if (mapState.status === "loading") {
    return <p className="section-body">読み込み中…</p>;
  }

  if (mapState.status === "error") {
    return <p className="error-message">エラー: {mapState.message}</p>;
  }

  if (activeConcepts.length === 0) {
    return (
      <div className="understanding-empty">
        <img className="understanding-empty-image" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
        <p className="understanding-empty-text">
          まだ理解マップは小さいです。
          <br />
          「理解マップを更新」を押すと、保存した理解から概念のつながりを組み立てます。
        </p>
        <button type="button" className="dig-button" onClick={handleRefresh} disabled={refreshing}>
          {refreshing ? "更新中…" : "理解マップを更新"}
        </button>
        {refreshError && <p className="error-message">{refreshError}</p>}
      </div>
    );
  }

  return (
    <div className="understanding-map-view">
      <div className="map-summary-bar">
        <div className="map-summary-stats">
          <span>
            <strong>{summary.knowledgeCount}</strong> Knowledge
          </span>
          <span>
            <strong>{summary.topicCount}</strong> トピック
          </span>
          <span>
            <strong>{summary.conceptCount}</strong> 概念
          </span>
          <span>
            <strong>{summary.relationCount}</strong> つながり
          </span>
        </div>
        <p className="map-summary-recent">
          今週 +{summary.recentKnowledge}件の理解 ・ +{summary.recentRelations}件のつながり
        </p>
        <div className="map-toolbar-buttons">
          <button type="button" className="map-refresh-button" onClick={() => recomputeLayout(true)}>
            整列
          </button>
          <button type="button" className="map-refresh-button" onClick={handleRefresh} disabled={refreshing}>
            {refreshing
              ? "更新中…"
              : unclassifiedCount > 0
                ? `理解マップを更新（未分類 ${unclassifiedCount}件）`
                : "理解マップを更新"}
          </button>
        </div>
      </div>
      {refreshError && <p className="error-message">{refreshError}</p>}

      {/* Topicはツリー表示の左パネルではなく、セレクトボックスで絞り込む形にしている
          （Topic数が増えても場所を取らず、モバイルでも同じUIで操作できるため）。 */}
      <div className="map-filter-bar">
        <select
          className="map-filter-select"
          value={selectedTopicId ?? ""}
          onChange={(e) => handleSelectTopic(e.target.value || null)}
          aria-label="表示するトピック"
        >
          <option value="">すべてのトピック</option>
          {topicOptions.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {"　".repeat(opt.depth)}
              {opt.name}
            </option>
          ))}
        </select>

        <select
          className="map-filter-select"
          value={maxDepth === null ? "all" : String(maxDepth)}
          onChange={(e) => setMaxDepth(e.target.value === "all" ? null : Number(e.target.value))}
          aria-label="表示する階層の深さ"
        >
          <option value="all">すべての階層を表示</option>
          <option value="1">1階層まで表示</option>
          <option value="2">2階層まで表示</option>
          <option value="3">3階層まで表示</option>
        </select>

        <label className="map-filter-toggle">
          <input
            type="checkbox"
            checked={showWeakLinks}
            onChange={(e) => setShowWeakLinks(e.target.checked)}
          />
          <span className="map-filter-toggle-track" aria-hidden="true" />
          関連の弱いつながりも表示
        </label>
      </div>

      <div className="understanding-map-layout">
        <div className="knowledge-map concept-map">
          <ReactFlow
            key={`${selectedTopicId ?? "all"}-${layoutVersion}`}
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={NODE_TYPES}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onNodeClick={(_, node) => {
              if (node.type === "concept") handleSelectConcept(node.id);
              else if (node.type === "topic") handleSelectTopic(node.id === UNCLASSIFIED_CLUSTER ? null : node.id);
            }}
            fitView
            minZoom={0.1}
            // デフォルトのautoPanOnNodeDrag（nodeをpaneの端近くまでドラッグすると
            // 自動でpan/zoomして追従する挙動）を無効化する。Map領域が狭い場合
            // （詳細パネル表示中など）、この自動追従がズームを大きく変えてしまい、
            // 「視覚的な安定感を優先する」という方針と相容れないため。
            autoPanOnNodeDrag={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            {visibleConcepts.length >= MINIMAP_THRESHOLD && <MiniMap pannable zoomable />}
          </ReactFlow>
        </div>

        {/* 詳細パネルの列は選択の有無に関わらず常に確保する（幅を固定し、Mapの表示幅が
            選択のたびにガクッと変わらないようにするため）。未選択時は軽いプレースホルダーを表示する。
            モバイルではCSS側でこの列自体を非表示にし、選択時だけ下からのシートとして表示する。 */}
        <div
          className={mobileDetailOpen ? "map-mobile-backdrop" : "map-mobile-backdrop map-mobile-backdrop-hidden"}
          onClick={handleCloseDetail}
        />
        <div
          className={
            selectedConcept && mobileDetailOpen
              ? "concept-detail-panel-wrapper map-mobile-open"
              : "concept-detail-panel-wrapper"
          }
        >
          {selectedConcept ? (
            <ConceptDetailPanel
              concept={selectedConcept}
              topics={topics}
              concepts={activeConcepts}
              relations={relations}
              knowledgeItems={selectedConceptKnowledge}
              onClose={handleCloseDetail}
              onSelectConcept={handleSelectConcept}
            />
          ) : (
            <div className="concept-detail-placeholder">
              <p>Conceptを選択すると、ここに詳細が表示されます。</p>
            </div>
          )}
        </div>
      </div>

      {activeConcepts.length <= 2 && (
        <p className="map-small-state-hint">
          少しずつConceptが増えていきます。気になる記事を掘ってみましょう。
          <button type="button" className="topic-node-map-link" onClick={() => navigate("/dig")}>
            記事を掘る →
          </button>
        </p>
      )}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import ReactFlow, { Background, Controls, MiniMap, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import type { ConceptRelation, ConceptRelationType, SavedKnowledge, Topic, UnderstandingConcept } from "./types";
import { STATUS_LABELS, effectiveStatus, statusClassName } from "./UnderstandingPage";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

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

// topicIdの親をたどってルートTopicのidを返す（マップのクラスタ分けに使う）。
function findRootTopicId(topics: Topic[], topicId: string): string {
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

const UNCLASSIFIED_CLUSTER = "__unclassified__";

// クラスタ分けの基準は、Conceptの最初のtopicIdが属するルートTopic。
// topicIdsが空（未分類）のConceptは専用の「未分類」クラスタに入れる。
function getClusterKey(concept: UnderstandingConcept, topics: Topic[]): string {
  const primaryTopicId = concept.topicIds[0];
  if (!primaryTopicId) return UNCLASSIFIED_CLUSTER;
  return findRootTopicId(topics, primaryTopicId);
}

function getVisibleConcepts(
  activeConcepts: UnderstandingConcept[],
  topics: Topic[],
  selectedTopicId: string | null,
): UnderstandingConcept[] {
  if (!selectedTopicId) return activeConcepts;
  const allowed = collectDescendantTopicIds(topics, selectedTopicId);
  return activeConcepts.filter((c) => c.topicIds.some((id) => allowed.has(id)));
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

function computeConceptDegree(conceptId: string, knowledgeCount: number, relations: ConceptRelation[]): number {
  const relationCount = relations.filter((r) => r.fromConceptId === conceptId || r.toConceptId === conceptId).length;
  return knowledgeCount + relationCount;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function isRecentlyChanged(concept: UnderstandingConcept, knowledgeItems: SavedKnowledge[]): boolean {
  const now = Date.now();
  if (now - new Date(concept.createdAt).getTime() <= WEEK_MS) return true;
  return knowledgeItems.some((k) => now - new Date(k.createdAt).getTime() <= WEEK_MS);
}

function truncateLabel(text: string, max = 14): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

const CLUSTER_LABEL_PREFIX = "cluster-label-";

// 力学シミュレーション等の専用ライブラリは導入せず、単純な「クラスタごとの円形レイアウト」で
// 初期配置する（PR #14/#15と同じ考え方）。ノードはConcept名のみをlabelにし、
// Knowledge本文はnode化しない。degreeに応じてわずかにサイズを変える。
function layoutConceptsByCluster(
  concepts: UnderstandingConcept[],
  topics: Topic[],
  knowledgeByConcept: Map<string, SavedKnowledge[]>,
  relations: ConceptRelation[],
): Node[] {
  const groups = new Map<string, UnderstandingConcept[]>();
  for (const concept of concepts) {
    const key = getClusterKey(concept, topics);
    const list = groups.get(key);
    if (list) list.push(concept);
    else groups.set(key, [concept]);
  }

  const clusterKeys = Array.from(groups.keys());
  const clusterCount = Math.max(clusterKeys.length, 1);
  // クラスタ数が増えてもReactFlowのfitViewが対応できるminZoom範囲に収まるよう、
  // 半径は緩やかにしか広げない（PR #14での教訓）。
  const clusterRadius = Math.max(160, clusterCount * 55);
  const clusterAngleStep = (2 * Math.PI) / clusterCount;
  const topicNameById = new Map(topics.map((t) => [t._id, t.name]));

  const nodes: Node[] = [];

  clusterKeys.forEach((key, clusterIndex) => {
    const members = groups.get(key) ?? [];
    const clusterAngle = clusterIndex * clusterAngleStep;
    const centerX = clusterRadius + clusterRadius * Math.cos(clusterAngle);
    const centerY = clusterRadius + clusterRadius * Math.sin(clusterAngle);
    const innerRadius = members.length <= 1 ? 0 : Math.max(70, members.length * 20);
    const innerAngleStep = (2 * Math.PI) / Math.max(members.length, 1);
    const clusterLabel = key === UNCLASSIFIED_CLUSTER ? "未分類" : (topicNameById.get(key) ?? "未分類");

    nodes.push({
      id: `${CLUSTER_LABEL_PREFIX}${key}`,
      data: { label: clusterLabel },
      position: { x: centerX, y: centerY - innerRadius - 36 },
      draggable: false,
      selectable: false,
      connectable: false,
      style: {
        border: "none",
        background: "transparent",
        color: "#2b6cb0",
        fontWeight: 700,
        fontSize: "0.78rem",
        padding: 0,
        pointerEvents: "none",
      },
    });

    members.forEach((concept, memberIndex) => {
      const angle = memberIndex * innerAngleStep;
      const knowledgeItems = knowledgeByConcept.get(concept._id) ?? [];
      const degree = computeConceptDegree(concept._id, knowledgeItems.length, relations);
      const sizeBoost = Math.min(degree, 8);
      const isNew = isRecentlyChanged(concept, knowledgeItems);

      nodes.push({
        id: concept._id,
        data: {
          label: (
            <span title={concept.name}>
              {isNew && <span className="concept-node-badge">NEW</span>}
              {truncateLabel(concept.name)}
            </span>
          ),
        },
        position: {
          x: centerX + innerRadius * Math.cos(angle),
          y: centerY + innerRadius * Math.sin(angle),
        },
        style: {
          border: `${1 + Math.floor(sizeBoost / 3)}px solid #2b6cb0`,
          borderRadius: 10,
          padding: `${(0.3 + sizeBoost * 0.02).toFixed(2)}rem ${(0.55 + sizeBoost * 0.02).toFixed(2)}rem`,
          fontSize: `${(0.75 + sizeBoost * 0.01).toFixed(2)}rem`,
          maxWidth: 130,
          background: "#fff",
          color: "#1a1a1a",
          boxShadow: "0 1px 3px rgba(0,0,0,0.08)",
        },
      });
    });
  });

  return nodes;
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
// 控えめな単色＋小さなラベルにとどめる。
function buildConceptEdges(relations: ConceptRelation[], visibleIds: Set<string>): Edge[] {
  return relations
    .filter((r) => visibleIds.has(r.fromConceptId) && visibleIds.has(r.toConceptId))
    .map((r) => ({
      id: r._id,
      source: r.fromConceptId,
      target: r.toConceptId,
      label: RELATION_TYPE_LABEL[r.type],
      style: { stroke: "#bbb" },
      labelStyle: { fontSize: 10, fill: "#888" },
    }));
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

function TopicNavTree({
  nodes,
  selectedTopicId,
  onSelect,
}: {
  nodes: TopicTreeNode[];
  selectedTopicId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <ul className="map-topic-nav-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <button
            type="button"
            className={selectedTopicId === node.id ? "map-topic-nav-item active" : "map-topic-nav-item"}
            onClick={() => onSelect(node.id)}
          >
            {node.name}
          </button>
          {node.children.length > 0 && (
            <div className="map-topic-nav-children">
              <TopicNavTree nodes={node.children} selectedTopicId={selectedTopicId} onSelect={onSelect} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
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
  onGoDig,
  initialTopicName,
}: {
  knowledge: SavedKnowledge[];
  onGoDig: () => void;
  initialTopicName?: string | null;
}) {
  const [mapState, setMapState] = useState<MapFetchState>({ status: "loading" });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  const [selectedConceptId, setSelectedConceptId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const appliedInitialTopicRef = useRef(false);

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
    () => getVisibleConcepts(activeConcepts, topics, selectedTopicId),
    [activeConcepts, topics, selectedTopicId],
  );
  const visibleIds = useMemo(() => new Set(visibleConcepts.map((c) => c._id)), [visibleConcepts]);
  const nodes = useMemo(
    () => layoutConceptsByCluster(visibleConcepts, topics, knowledgeByConcept, relations),
    [visibleConcepts, topics, knowledgeByConcept, relations],
  );
  const edges = useMemo(() => buildConceptEdges(relations, visibleIds), [relations, visibleIds]);
  const summary = useMemo(
    () => computeMapSummary(knowledge, topics, concepts, relations),
    [knowledge, topics, concepts, relations],
  );
  const unclassifiedCount = useMemo(
    () => activeConcepts.filter((c) => c.topicIds.length === 0).length,
    [activeConcepts],
  );
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
    setMobileNavOpen(false);
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
        <button type="button" className="map-refresh-button" onClick={handleRefresh} disabled={refreshing}>
          {refreshing
            ? "更新中…"
            : unclassifiedCount > 0
              ? `理解マップを更新（未分類 ${unclassifiedCount}件）`
              : "理解マップを更新"}
        </button>
      </div>
      {refreshError && <p className="error-message">{refreshError}</p>}

      <div className="understanding-map-layout">
        <button type="button" className="map-mobile-nav-toggle" onClick={() => setMobileNavOpen(true)}>
          トピック ☰
        </button>

        <aside className={mobileNavOpen ? "map-topic-nav map-topic-nav-mobile-open" : "map-topic-nav"}>
          <div className="map-topic-nav-header">
            <span>トピック</span>
            <button
              type="button"
              className="modal-close map-mobile-only"
              onClick={() => setMobileNavOpen(false)}
              aria-label="閉じる"
            >
              ×
            </button>
          </div>
          <button
            type="button"
            className={selectedTopicId === null ? "map-topic-nav-item active" : "map-topic-nav-item"}
            onClick={() => handleSelectTopic(null)}
          >
            すべて
          </button>
          <TopicNavTree nodes={topicHierarchy} selectedTopicId={selectedTopicId} onSelect={handleSelectTopic} />
        </aside>
        {mobileNavOpen && <div className="map-mobile-backdrop" onClick={() => setMobileNavOpen(false)} />}

        <div className="knowledge-map concept-map">
          <ReactFlow
            key={selectedTopicId ?? "all"}
            nodes={nodes}
            edges={edges}
            onNodeClick={(_, node) => {
              if (node.id.startsWith(CLUSTER_LABEL_PREFIX)) return;
              handleSelectConcept(node.id);
            }}
            fitView
            minZoom={0.1}
            proOptions={{ hideAttribution: true }}
          >
            <Background />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable />
          </ReactFlow>
        </div>

        {selectedConcept && (
          <>
            <div
              className={mobileDetailOpen ? "map-mobile-backdrop" : "map-mobile-backdrop map-mobile-backdrop-hidden"}
              onClick={handleCloseDetail}
            />
            <div
              className={
                mobileDetailOpen
                  ? "concept-detail-panel-wrapper map-mobile-open"
                  : "concept-detail-panel-wrapper"
              }
            >
              <ConceptDetailPanel
                concept={selectedConcept}
                topics={topics}
                concepts={activeConcepts}
                relations={relations}
                knowledgeItems={selectedConceptKnowledge}
                onClose={handleCloseDetail}
                onSelectConcept={handleSelectConcept}
              />
            </div>
          </>
        )}
      </div>

      {activeConcepts.length <= 2 && (
        <p className="map-small-state-hint">
          少しずつConceptが増えていきます。気になる記事を掘ってみましょう。
          <button type="button" className="topic-node-map-link" onClick={onGoDig}>
            記事を掘る →
          </button>
        </p>
      )}
    </div>
  );
}

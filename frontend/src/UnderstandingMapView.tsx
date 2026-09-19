import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import ReactFlow, {
  Background,
  Controls,
  MarkerType,
  MiniMap,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "reactflow";
import "reactflow/dist/style.css";
import type { ConceptRelation, ConceptRelationType, SavedKnowledge, Topic, UnderstandingConcept } from "./types";
import { STATUS_LABELS, effectiveStatus, statusClassName } from "./UnderstandingPage";
import { sourceDisplayTitle } from "./sourceLabel";
import ConceptNode, { type ConceptNodeData } from "./ConceptNode";
import TopicNode, { type TopicNodeData } from "./TopicNode";
import {
  UNCLASSIFIED_CLUSTER,
  buildTopicColorMap,
  computeConceptSize,
  computeHierarchyLayout,
  computeRootTopicSize,
  computeSubtopicSize,
  findRootTopicId,
  getClusterKey,
  type HierarchyEdgeInput,
  type HierarchyNodeInput,
  type MapNodeKind,
} from "./mapLayout";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

// Mapのnodeは基本的にRoot Topic / Topic(Subtopic) / Conceptまで。Knowledgeは
// 「Map上のnode」ではなく「Concept詳細（右Detail Panel）の中身」として扱うため、
// KnowledgeNodeのようなnodeTypeはここに存在しない。
const NODE_TYPES = { concept: ConceptNode, topic: TopicNode };
const MINIMAP_THRESHOLD = 25;

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

// Topic.parentIdから階層ツリーを組み立てる（archived/mergedは除外）。Topicフィルタのボタン
// （ルートTopicのみ使用）を組み立てるのと、Topic Viewと同じ木構造をMapでも使うために使う。
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

// 指定したTopicとその配下（子孫）すべてのidを集める（Topicフィルタによるsubtree絞り込み用）。
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

// Conceptに紐づくKnowledgeをconceptIdごとにまとめる（outdatedはleafからも外す）。
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

// Mapは俯瞰用のUIなので、node内のlabelは原則1〜2行に収まる文字数に短縮する。
// フルテキストはtitle属性（hover tooltip）と詳細パネルで確認できる。
const LABEL_MAX_CHARS = 12;

function truncateLabel(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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

// ConceptRelation（横断的なつながり）は階層のparent-child edgeより控えめに表示する
// （階層構造が主役、横断的なつながりは補足という位置づけのため、破線・薄い色にする）。
function buildCrossRelationEdges(relations: ConceptRelation[], visibleConceptIds: Set<string>): Edge[] {
  return relations
    .filter((r) => visibleConceptIds.has(r.fromConceptId) && visibleConceptIds.has(r.toConceptId))
    .map((r) => ({
      id: r._id,
      source: r.fromConceptId,
      target: r.toConceptId,
      label: RELATION_TYPE_LABEL[r.type],
      style: { stroke: "#ddd", strokeDasharray: "3 3" },
      labelStyle: { fontSize: 9, fill: "#aaa" },
      markerEnd: { type: MarkerType.ArrowClosed, color: "#ddd", width: 10, height: 10 },
      zIndex: 0,
    }));
}

// 階層edge（parent-child）はMapの主構造なので、branchが追いやすいよう elbow風の
// smoothstepにする（ConceptRelationのbezier曲線とは見た目を変え、主従がはっきり分かる
// ようにする）。細すぎず、しかし主張しすぎない太さ・色にとどめる。
function buildParentChildEdges(edges: HierarchyEdgeInput[]): Edge[] {
  return edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    type: "smoothstep",
    style: { stroke: "#b0b0b0", strokeWidth: 1.75 },
    markerEnd: { type: MarkerType.ArrowClosed, color: "#b0b0b0", width: 12, height: 12 },
    zIndex: 1,
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

// Map上のnodeはTopic/Conceptのみ（KnowledgeはMap nodeとして存在しない）。
type SelectedNode = { kind: "topic"; id: string } | { kind: "concept"; id: string };

type SearchResult =
  | { kind: "topic"; id: string; label: string; sublabel: string }
  | { kind: "concept"; id: string; label: string; sublabel: string }
  // knowledge検索結果はMap上に対応するnodeを持たないため、focus先は常にconceptId
  // （そのKnowledgeが属するConcept）にする。conceptIdが無い（Concept未紐付けの
  // 古いデータ）場合は検索結果自体に出さない。
  | { kind: "knowledge"; id: string; conceptId: string; label: string; sublabel: string };

// Topic / Subtopic / Concept / Knowledgeを横断した単純な部分一致検索。結果は種別ラベル付きで
// 表示し、選択するとその種別に応じたNodeへフォーカスする（knowledgeは所属Conceptへ）。
function searchMap(
  query: string,
  topics: Topic[],
  concepts: UnderstandingConcept[],
  knowledge: SavedKnowledge[],
  topicById: Map<string, Topic>,
  limit = 20,
): SearchResult[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const results: SearchResult[] = [];

  for (const t of topics) {
    if (t.status !== "active") continue;
    if (!t.name.toLowerCase().includes(q)) continue;
    const breadcrumb = buildTopicBreadcrumb(topics, t._id);
    results.push({
      kind: "topic",
      id: t._id,
      label: t.name,
      sublabel: breadcrumb.slice(0, -1).join(" > ") || (t.parentId ? "" : "ルートTopic"),
    });
  }

  for (const c of concepts) {
    if (c.status !== "active") continue;
    if (!c.name.toLowerCase().includes(q)) continue;
    const topicName = c.topicIds[0] ? (topicById.get(c.topicIds[0])?.name ?? "") : "未分類";
    results.push({ kind: "concept", id: c._id, label: c.name, sublabel: topicName });
  }

  for (const k of knowledge) {
    if (effectiveStatus(k) === "outdated") continue;
    const conceptId = k.conceptIds?.[0];
    if (!conceptId) continue;
    if (!k.concept.toLowerCase().includes(q) && !k.statement.toLowerCase().includes(q)) continue;
    results.push({
      kind: "knowledge",
      id: k._id,
      conceptId,
      label: k.concept,
      sublabel: truncateLabel(k.statement, 28),
    });
  }

  return results.slice(0, limit);
}

function TopicDetailPanel({
  topic,
  topics,
  concepts,
  onClose,
  onSelectConcept,
  onSelectTopic,
  onDigTopic,
}: {
  topic: Topic;
  topics: Topic[];
  concepts: UnderstandingConcept[];
  onClose: () => void;
  onSelectConcept: (id: string) => void;
  onSelectTopic: (id: string) => void;
  onDigTopic: (topicId: string) => void;
}) {
  const breadcrumb = buildTopicBreadcrumb(topics, topic._id);
  const childTopics = useMemo(
    () => topics.filter((t) => t.status === "active" && t.parentId === topic._id),
    [topics, topic._id],
  );
  const directConcepts = useMemo(
    () => concepts.filter((c) => c.status === "active" && c.topicIds[0] === topic._id),
    [concepts, topic._id],
  );

  return (
    <div className="concept-detail-panel">
      <div className="concept-detail-header">
        <h3>{topic.name}</h3>
        <button type="button" className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      {breadcrumb.length > 1 && <p className="concept-detail-breadcrumb">{breadcrumb.join(" > ")}</p>}

      {childTopics.length > 0 && (
        <>
          <h4 className="concept-detail-section-title">配下のトピック</h4>
          <ul className="concept-detail-related-list">
            {childTopics.map((t) => (
              <li key={t._id}>
                <button type="button" className="topic-item-button" onClick={() => onSelectTopic(t._id)}>
                  {t.name}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <h4 className="concept-detail-section-title">このトピックの概念</h4>
      {directConcepts.length === 0 ? (
        <p className="concept-detail-empty">まだこのトピックに直接紐づく概念はありません。</p>
      ) : (
        <ul className="concept-detail-related-list">
          {directConcepts.map((c) => (
            <li key={c._id}>
              <button type="button" className="topic-item-button" onClick={() => onSelectConcept(c._id)}>
                {c.name}
              </button>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="dig-button entity-dig-cta" onClick={() => onDigTopic(topic._id)}>
        このトピックを掘る
      </button>
    </div>
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
  onDigConcept,
}: {
  concept: UnderstandingConcept;
  topics: Topic[];
  concepts: UnderstandingConcept[];
  relations: ConceptRelation[];
  knowledgeItems: SavedKnowledge[];
  onClose: () => void;
  onSelectConcept: (conceptId: string) => void;
  onDigConcept: (conceptId: string) => void;
}) {
  const conceptById = useMemo(() => new Map(concepts.map((c) => [c._id, c])), [concepts]);
  const breadcrumb = concept.topicIds[0] ? buildTopicBreadcrumb(topics, concept.topicIds[0]) : [];

  // 「関連する概念」＝1-hopのConceptだけを表示する（MVPでは2-hopまで広げない）。
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

      {/* KnowledgeはMap上のnodeではなく、ここ（選択したConceptの詳細）で全文を読む。
          Map上へは戻れる先が無いため、statementはクリック不可の地の文として表示する。 */}
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
                  {item.source.type === "web_article" ? (
                    <a href={item.source.url} target="_blank" rel="noreferrer">
                      {item.source.title}
                    </a>
                  ) : (
                    <span>{sourceDisplayTitle(item.source)}</span>
                  )}
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

      <button type="button" className="dig-button entity-dig-cta" onClick={() => onDigConcept(concept._id)}>
        このConceptを掘る
      </button>
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
  const location = useLocation();
  const [mapState, setMapState] = useState<MapFetchState>({ status: "loading" });
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  // Topicのボタンは最初はルートTopicを5個までしか出さず（増えすぎると場所を取るため）、
  // 「もっと表示する」を押すと全件表示に切り替える。
  const [topicFilterExpanded, setTopicFilterExpanded] = useState(false);
  const [selectedNode, setSelectedNode] = useState<SelectedNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const appliedInitialTopicRef = useRef(false);

  // 検索は「見たいものが既に決まっている」ときの直接アクセス、Mapは「周辺を辿りながら
  // 発見する」もの、という役割分担にする。
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  // 検索やDetail Panelから選んだNodeが、現在のTopicフィルタの都合でまだMap上に存在しない
  // 場合に、フィルタ解除後の再描画を待ってからカメラを寄せるための一時的な保留id。
  const [pendingFocusId, setPendingFocusId] = useState<string | null>(null);

  const [nodes, setNodes, onNodesChange] = useNodesState<ConceptNodeData | TopicNodeData>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge[]>([]);
  const nodesRef = useRef<Node[]>([]);
  useEffect(() => {
    nodesRef.current = nodes;
  }, [nodes]);
  // <ReactFlow>はTopicフィルタ変更等でkeyが変わり再マウントされるため、useReactFlow()を
  // 使わずonInitでインスタンスをrefに保持する（再マウントのたびにonInitが呼ばれ更新される）。
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);

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
    if (match) setSelectedTopicId(findRootTopicId(mapState.topics, match._id));
    appliedInitialTopicRef.current = true;
  }, [mapState, initialTopicName]);

  // Concept/Topic起点のDeep Dive画面（EntityDigPage.tsx）から「理解マップへ戻る」で
  // 戻ってきた場合、そのnavigate stateにあるrestoreTopicId/restoreConceptIdでMap側の
  // 絞り込み・選択状態を復元する（「Map→Conceptを選ぶ→掘る→Knowledge保存→Mapへ戻る→
  // 理解構造が更新されている」という循環体験のうち、戻った後に元の場所を保つ部分）。
  const appliedRestoreStateRef = useRef(false);
  useEffect(() => {
    if (appliedRestoreStateRef.current) return;
    if (mapState.status !== "success") return;
    const state = location.state as { restoreTopicId?: string | null; restoreConceptId?: string | null } | null;
    if (!state) return;
    appliedRestoreStateRef.current = true;
    if (state.restoreTopicId) setSelectedTopicId(state.restoreTopicId);
    if (state.restoreConceptId) {
      setSelectedNode({ kind: "concept", id: state.restoreConceptId });
      setPendingFocusId(state.restoreConceptId);
    }
  }, [mapState, location.state]);

  // 「/」またはCmd/Ctrl+Kで検索欄にフォーカス、Escで閉じる（必須ではないが、決め打ちで
  // 検索したいユーザー向けのショートカット）。
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      const isTypingElsewhere =
        active instanceof HTMLElement &&
        (active.tagName === "INPUT" || active.tagName === "TEXTAREA") &&
        active !== searchInputRef.current;
      if (isTypingElsewhere) return;

      if (e.key === "/" && active !== searchInputRef.current) {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchInputRef.current?.focus();
      } else if (e.key === "Escape" && active === searchInputRef.current) {
        searchInputRef.current?.blur();
        setSearchOpen(false);
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const topics = mapState.status === "success" ? mapState.topics : [];
  const concepts = mapState.status === "success" ? mapState.concepts : [];
  const relations = mapState.status === "success" ? mapState.relations : [];

  const activeTopics = useMemo(() => topics.filter((t) => t.status === "active"), [topics]);
  const activeConcepts = useMemo(() => concepts.filter((c) => c.status === "active"), [concepts]);
  const knowledgeByConcept = useMemo(() => countKnowledgeByConcept(knowledge), [knowledge]);
  const topicById = useMemo(() => new Map(topics.map((t) => [t._id, t])), [topics]);
  const topicHierarchy = useMemo(() => buildTopicHierarchy(topics), [topics]);
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

  // Topicのボタンはルートトピック（parentIdが無いもの）だけを表示する。
  const rootTopics = useMemo(() => topicHierarchy.map((t) => ({ id: t.id, name: t.name })), [topicHierarchy]);
  const TOPIC_CHIP_LIMIT = 5;
  const visibleTopicChips = topicFilterExpanded ? rootTopics : rootTopics.slice(0, TOPIC_CHIP_LIMIT);
  const hasMoreTopicChips = rootTopics.length > TOPIC_CHIP_LIMIT;

  // 「すべて」なら全Topic、選択中なら選択Topicとその子孫だけをMapの対象にする
  // （Topic Viewと同じ、Topic.parentId由来の階層をそのままsubtree絞り込みに使う）。
  const relevantTopicIds = useMemo(() => {
    if (!selectedTopicId) return new Set(activeTopics.map((t) => t._id));
    return collectDescendantTopicIds(topics, selectedTopicId);
  }, [activeTopics, topics, selectedTopicId]);

  const relevantConcepts = useMemo(() => {
    return activeConcepts.filter((c) => {
      if (c.topicIds.length === 0) return selectedTopicId === null; // 未分類は「すべて」のときだけ
      return c.topicIds.some((id) => relevantTopicIds.has(id));
    });
  }, [activeConcepts, relevantTopicIds, selectedTopicId]);

  const relevantConceptIds = useMemo(() => new Set(relevantConcepts.map((c) => c._id)), [relevantConcepts]);

  const searchResults = useMemo(
    () => searchMap(searchQuery, topics, activeConcepts, knowledge, topicById),
    [searchQuery, topics, activeConcepts, knowledge, topicById],
  );

  // Root Topic → Subtopic → Conceptという階層をMapの骨格としてdagreでレイアウトする。
  // Knowledgeはnodeを持たない（Concept詳細＝右Panelの中身として読む）。Conceptが複数の
  // Topicに属する場合は、その全topicIdからそれぞれ1本ずつhierarchy edgeを引く
  // （Conceptを複製せず、同じConcept nodeへ複数の親からedgeを集める。1つのConceptが
  // 複数箇所に重複表示される問題はこれで解消する）。ConceptRelation（横断的なつながり）は
  // レイアウトには使わず、位置が決まった後に見た目だけの補助edgeとして重ねる。
  // relationが0件でもTopic hierarchyだけでMapとして成立する。
  function recomputeLayout() {
    const relevantTopics = activeTopics.filter((t) => relevantTopicIds.has(t._id));
    const topicChildCount = new Map<string, number>();
    for (const t of relevantTopics) {
      if (t.parentId && relevantTopicIds.has(t.parentId)) {
        topicChildCount.set(t.parentId, (topicChildCount.get(t.parentId) ?? 0) + 1);
      }
    }
    // 1つのConceptが複数Topicに属す場合、それぞれの親Topicの「配下の子」としてカウントする
    // （Topicの大きさは「どれだけの理解を束ねているか」を表すため、Conceptがどのtopicにも
    // 実際にedgeを引く分だけ加算してよい）。
    for (const c of relevantConcepts) {
      for (const topicId of c.topicIds) {
        if (relevantTopicIds.has(topicId)) {
          topicChildCount.set(topicId, (topicChildCount.get(topicId) ?? 0) + 1);
        }
      }
    }

    const hasUnclassified = selectedTopicId === null && relevantConcepts.some((c) => c.topicIds.length === 0);

    const hierarchyNodes: HierarchyNodeInput[] = [];
    const hierarchyEdges: HierarchyEdgeInput[] = [];

    for (const t of relevantTopics) {
      const isRoot = !t.parentId;
      const size = isRoot
        ? computeRootTopicSize(topicChildCount.get(t._id) ?? 0)
        : computeSubtopicSize(topicChildCount.get(t._id) ?? 0);
      hierarchyNodes.push({ id: t._id, kind: isRoot ? "rootTopic" : "subtopic", width: size, height: size });
      if (t.parentId && relevantTopicIds.has(t.parentId)) {
        hierarchyEdges.push({ id: `topic-${t.parentId}-${t._id}`, source: t.parentId, target: t._id });
      }
    }

    if (hasUnclassified) {
      const count = relevantConcepts.filter((c) => c.topicIds.length === 0).length;
      hierarchyNodes.push({
        id: UNCLASSIFIED_CLUSTER,
        kind: "rootTopic",
        width: computeRootTopicSize(count),
        height: computeRootTopicSize(count),
      });
    }

    const knowledgeByConceptFiltered = new Map<string, SavedKnowledge[]>();
    for (const c of relevantConcepts) {
      knowledgeByConceptFiltered.set(c._id, knowledgeByConcept.get(c._id) ?? []);
    }

    for (const c of relevantConcepts) {
      const knowledgeItems = knowledgeByConceptFiltered.get(c._id) ?? [];
      const size = computeConceptSize(knowledgeItems.length);
      hierarchyNodes.push({ id: c._id, kind: "concept", width: size, height: size });

      // 複数Topicに属するConceptは、そのすべての親からedgeを引く（1つだけに絞らない）。
      const parentTopicIds = c.topicIds.filter((id) => relevantTopicIds.has(id));
      if (parentTopicIds.length > 0) {
        for (const parentTopicId of parentTopicIds) {
          hierarchyEdges.push({ id: `topic-concept-${parentTopicId}-${c._id}`, source: parentTopicId, target: c._id });
        }
      } else if (c.topicIds.length === 0 && hasUnclassified) {
        hierarchyEdges.push({ id: `topic-concept-${UNCLASSIFIED_CLUSTER}-${c._id}`, source: UNCLASSIFIED_CLUSTER, target: c._id });
      }
    }

    const positions = computeHierarchyLayout(hierarchyNodes, hierarchyEdges, "LR");

    const newNodes: Node[] = [];
    for (const t of relevantTopics) {
      const pos = positions.get(t._id) ?? { x: 0, y: 0 };
      const isRoot = !t.parentId;
      const size = isRoot
        ? computeRootTopicSize(topicChildCount.get(t._id) ?? 0)
        : computeSubtopicSize(topicChildCount.get(t._id) ?? 0);
      const rootId = findRootTopicId(topics, t._id);
      const data: TopicNodeData = {
        name: t.name,
        variant: isRoot ? "root" : "sub",
        color: topicColorMap.get(rootId) ?? "#888",
        size,
        dimmed: false,
        highlighted: false,
        selected: false,
      };
      newNodes.push({ id: t._id, type: "topic", position: pos, data, style: { width: size, height: size }, zIndex: 2 });
    }
    if (hasUnclassified) {
      const pos = positions.get(UNCLASSIFIED_CLUSTER) ?? { x: 0, y: 0 };
      const count = relevantConcepts.filter((c) => c.topicIds.length === 0).length;
      const size = computeRootTopicSize(count);
      const data: TopicNodeData = {
        name: "未分類",
        variant: "root",
        color: "#999999",
        size,
        dimmed: false,
        highlighted: false,
        selected: false,
      };
      newNodes.push({
        id: UNCLASSIFIED_CLUSTER,
        type: "topic",
        position: pos,
        data,
        style: { width: size, height: size },
        zIndex: 2,
      });
    }

    for (const c of relevantConcepts) {
      const pos = positions.get(c._id) ?? { x: 0, y: 0 };
      const knowledgeItems = knowledgeByConceptFiltered.get(c._id) ?? [];
      const size = computeConceptSize(knowledgeItems.length);
      const clusterKey = getClusterKey(c, topics);
      const data: ConceptNodeData = {
        name: c.name,
        label: truncateLabel(c.name, LABEL_MAX_CHARS),
        knowledgeCount: knowledgeItems.length,
        color: topicColorMap.get(clusterKey) ?? "#2b6cb0",
        dimmed: false,
        highlighted: false,
        selected: false,
        size,
      };
      newNodes.push({ id: c._id, type: "concept", position: pos, data, style: { width: size, height: size }, zIndex: 2 });
    }

    setNodes(newNodes);
    setEdges([...buildParentChildEdges(hierarchyEdges), ...buildCrossRelationEdges(relations, relevantConceptIds)]);
    setLayoutVersion((v) => v + 1);
  }

  // トリガー①②: データ取得・更新（mapStateの参照が変わる）とTopicフィルタ変更。
  // dagreは決定的なレイアウトのため（d3-forceと違いwarm startは不要）、この2つの変化と
  // 「整列」ボタンだけを明示的なトリガーにする（visibleConcepts等の派生値まで依存に含めると、
  // hoverや詳細パネル開閉のたびにレイアウトが再計算されてしまうため）。
  useEffect(() => {
    if (mapState.status !== "success") return;
    recomputeLayout();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedTopicId, mapState]);

  // Nodeを辿る体験の中心となる「隣接強調」。parent-child edgeとConceptRelationの
  // 両方を対象に、hoverまたは選択中のnodeと直接つながるnode・edgeだけを強調し、
  // それ以外を薄くする（優先順位: hover > 選択中）。
  const hoverNeighborIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const e of edges) {
      if (e.source === hoveredNodeId) ids.add(e.target);
      if (e.target === hoveredNodeId) ids.add(e.source);
    }
    return ids;
  }, [hoveredNodeId, edges]);

  const selectionNeighborIds = useMemo(() => {
    if (!selectedNode) return null;
    const ids = new Set<string>([selectedNode.id]);
    for (const e of edges) {
      if (e.source === selectedNode.id) ids.add(e.target);
      if (e.target === selectedNode.id) ids.add(e.source);
    }
    return ids;
  }, [selectedNode, edges]);

  const activeNeighborIds = hoverNeighborIds ?? selectionNeighborIds;

  const displayNodes = useMemo(() => {
    return nodes.map((n) => {
      const highlighted = activeNeighborIds ? activeNeighborIds.has(n.id) : false;
      // 選択・hoverが無関係の場所全体を消えたように見せると、Map全体の位置関係が
      // 分からなくなってしまう（「選択Conceptが分かることは重要だが、他が見えなくなる
      // ほど薄くしない」という方針）。dimmedは各Node componentのCSS側でopacity 0.6程度に
      // とどめている（0.25のような強い減衰はしない）。
      const dimmed = activeNeighborIds ? !highlighted : false;
      // selectedはhoverの有無に関わらず「今クリックして選んでいるNode」を常に示す
      // 独立した状態（outline+halo+わずかな拡大）で、Topic/Concept/Knowledgeいずれの
      // 種別でも同じ扱いにする。
      const selected = selectedNode?.id === n.id;
      return { ...n, data: { ...n.data, highlighted, dimmed, selected } };
    });
  }, [nodes, activeNeighborIds, selectedNode]);

  const displayEdges = useMemo(() => {
    if (!activeNeighborIds) return edges;
    const focusId = hoveredNodeId ?? selectedNode?.id;
    return edges.map((e) => {
      const touches = e.source === focusId || e.target === focusId;
      return {
        ...e,
        style: { ...e.style, stroke: touches ? "#2b6cb0" : "#eee" },
        labelStyle: e.label ? { fontSize: 9, fill: touches ? "#2b6cb0" : "#eee" } : undefined,
        markerEnd: e.markerEnd ? { type: MarkerType.ArrowClosed, color: touches ? "#2b6cb0" : "#eee" } : undefined,
        zIndex: touches ? 1 : 0,
      };
    });
  }, [edges, activeNeighborIds, hoveredNodeId, selectedNode]);

  const selectedTopic = useMemo(() => {
    if (selectedNode?.kind !== "topic") return null;
    if (selectedNode.id === UNCLASSIFIED_CLUSTER) return null;
    return topics.find((t) => t._id === selectedNode.id) ?? null;
  }, [selectedNode, topics]);
  const selectedConcept = useMemo(() => {
    if (selectedNode?.kind !== "concept") return null;
    return activeConcepts.find((c) => c._id === selectedNode.id) ?? null;
  }, [selectedNode, activeConcepts]);
  const selectedConceptKnowledge = useMemo(
    () => (selectedConcept ? (knowledgeByConcept.get(selectedConcept._id) ?? []) : []),
    [selectedConcept, knowledgeByConcept],
  );
  const hasSelection = selectedNode !== null;

  // 選択中Nodeへカメラを寄せる。「必要に応じて少し寄せる」程度にとどめ、既にある程度
  // ズームしていればそのズームレベルを保つ（毎回激しくzoom/panすると位置感覚を失うため）。
  function panToNode(id: string) {
    const instance = reactFlowInstanceRef.current;
    const node = nodesRef.current.find((n) => n.id === id);
    if (!instance || !node) return;
    const width = typeof node.style?.width === "number" ? node.style.width : 40;
    const height = typeof node.style?.height === "number" ? node.style.height : 40;
    const currentZoom = instance.getZoom();
    const targetZoom = currentZoom < 0.6 ? 0.8 : currentZoom;
    instance.setCenter(node.position.x + width / 2, node.position.y + height / 2, {
      zoom: targetZoom,
      duration: 450,
    });
  }

  // 保留中のフォーカス要求（フィルタ解除待ち）を、対象Nodeが実際にnodesへ現れたタイミングで
  // 消化する。
  useEffect(() => {
    if (!pendingFocusId) return;
    const found = nodes.some((n) => n.id === pendingFocusId);
    if (!found) return;
    const targetId = pendingFocusId;
    const timer = setTimeout(() => {
      panToNode(targetId);
      setPendingFocusId(null);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, pendingFocusId]);

  function handleSelectTopicFilter(id: string | null) {
    setSelectedTopicId(id);
  }

  // Map上で直接Nodeをクリックしたときの選択（既に見えている位置なので、カメラは動かさない）。
  function handleSelectNode(node: SelectedNode) {
    setSelectedNode(node);
    setMobileDetailOpen(true);
  }

  // 検索結果選択・Detail Panelからのnavigationなど、今見ている場所とは離れたNodeへ
  // 「辿る/移動する」ときの選択。現在のTopicフィルタで隠れている場合はフィルタを
  // 解除してから、そうでなければ即座にカメラを寄せる。
  function focusNode(node: SelectedNode) {
    setSelectedNode(node);
    setMobileDetailOpen(true);
    setSearchOpen(false);
    setSearchQuery("");
    const isVisible = nodesRef.current.some((n) => n.id === node.id);
    if (isVisible) {
      panToNode(node.id);
    } else {
      setPendingFocusId(node.id);
      setSelectedTopicId(null);
    }
  }

  function handleCloseDetail() {
    setSelectedNode(null);
    setMobileDetailOpen(false);
  }

  // 「このConceptを掘る」「このTopicを掘る」。Diggerの循環体験（Map→Conceptを選ぶ→掘る→
  // Knowledge保存→Mapへ戻る）の入口。現在のTopicフィルタ（selectedTopicId）をnavigate stateへ
  // 積んでおき、EntityDigPage側の「理解マップへ戻る」で同じ絞り込みへ戻れるようにする。
  function handleDigConcept(conceptId: string) {
    navigate(`/dig/concept/${conceptId}`, { state: { returnTopicId: selectedTopicId } });
  }

  function handleDigTopic(topicId: string) {
    navigate(`/dig/topic/${topicId}`, { state: { returnTopicId: selectedTopicId } });
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
          <button type="button" className="map-refresh-button" onClick={() => recomputeLayout()}>
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

      {/* 検索対象はTopic/Subtopic/Concept/Knowledgeすべて。「見たいものが既に決まっている」
          ときの直接アクセスとして使う。結果を選ぶと該当Nodeへフォーカスする。 */}
      <div className="map-search-bar">
        <div className="map-search-box">
          <input
            ref={searchInputRef}
            type="text"
            className="map-search-input"
            placeholder="理解を検索…（/）"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              setSearchOpen(true);
            }}
            onFocus={() => setSearchOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setSearchOpen(false), 120);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setSearchOpen(false);
                (e.target as HTMLInputElement).blur();
              }
            }}
          />
          {searchOpen && searchQuery.trim() && (
            <ul className="map-search-results">
              {searchResults.length === 0 ? (
                <li className="map-search-empty">該当する理解はまだありません</li>
              ) : (
                searchResults.map((r) => (
                  <li key={`${r.kind}-${r.id}`}>
                    <button
                      type="button"
                      className="map-search-result"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() =>
                        focusNode(r.kind === "knowledge" ? { kind: "concept", id: r.conceptId } : { kind: r.kind, id: r.id })
                      }
                    >
                      <span className={`map-search-result-kind map-search-result-kind-${r.kind}`}>
                        {r.kind === "topic" ? "トピック" : r.kind === "concept" ? "概念" : "理解"}
                      </span>
                      <span className="map-search-result-name">{r.label}</span>
                      {r.sublabel && <span className="map-search-result-topic">{r.sublabel}</span>}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </div>
      </div>

      {/* TopicはルートTopicだけをクリック可能なボタンとして並べる。選択するとそのTopicの
          subtree（子孫Topic・配下Concept・Knowledge）だけをMapに表示する。 */}
      <div className="map-topic-filter-bar">
        <button
          type="button"
          className={selectedTopicId === null ? "map-topic-chip active" : "map-topic-chip"}
          onClick={() => handleSelectTopicFilter(null)}
        >
          すべて
        </button>
        {visibleTopicChips.map((t) => (
          <button
            key={t.id}
            type="button"
            className={selectedTopicId === t.id ? "map-topic-chip active" : "map-topic-chip"}
            onClick={() => handleSelectTopicFilter(t.id)}
          >
            {t.name}
          </button>
        ))}
        {hasMoreTopicChips && (
          <button
            type="button"
            className="map-topic-chip map-topic-chip-more"
            onClick={() => setTopicFilterExpanded((v) => !v)}
          >
            {topicFilterExpanded ? "少なく表示" : "もっと表示する"}
          </button>
        )}
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
            onInit={(instance) => {
              reactFlowInstanceRef.current = instance;
            }}
            onNodeMouseEnter={(_, node) => setHoveredNodeId(node.id)}
            onNodeMouseLeave={() => setHoveredNodeId(null)}
            onNodeClick={(_, node) => {
              const kind = node.type as MapNodeKind | undefined;
              if (kind === "concept") handleSelectNode({ kind: "concept", id: node.id });
              else if (kind === "rootTopic" || kind === "subtopic" || node.type === "topic") {
                handleSelectNode({ kind: "topic", id: node.id });
              }
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
            {nodes.length >= MINIMAP_THRESHOLD && <MiniMap pannable zoomable />}
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
            hasSelection && mobileDetailOpen ? "concept-detail-panel-wrapper map-mobile-open" : "concept-detail-panel-wrapper"
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
              onSelectConcept={(id) => focusNode({ kind: "concept", id })}
              onDigConcept={handleDigConcept}
            />
          ) : selectedTopic ? (
            <TopicDetailPanel
              topic={selectedTopic}
              topics={topics}
              concepts={activeConcepts}
              onClose={handleCloseDetail}
              onSelectConcept={(id) => focusNode({ kind: "concept", id })}
              onSelectTopic={(id) => focusNode({ kind: "topic", id })}
              onDigTopic={handleDigTopic}
            />
          ) : (
            <div className="concept-detail-placeholder">
              <p>Topic / Conceptを選択すると、ここに詳細が表示されます。</p>
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

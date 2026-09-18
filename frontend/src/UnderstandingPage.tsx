import { useEffect, useMemo, useState } from "react";
import ReactFlow, { Background, Controls, type Edge, type Node } from "reactflow";
import "reactflow/dist/style.css";
import type { KnowledgeStatus, SavedKnowledge } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; items: SavedKnowledge[] };

type UnderstandingTab = "recent" | "topic" | "map";

async function fetchSavedKnowledge(): Promise<SavedKnowledge[]> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge`);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body.knowledge ?? [];
}

const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  active: "理解済み",
  foundational: "基礎として定着",
  merged: "統合済み",
  outdated: "更新済み",
};

function effectiveStatus(item: SavedKnowledge): KnowledgeStatus {
  return item.status ?? "active";
}

// Diggerは「Knowledgeを増やすこと」ではなく「今、何を理解しているか」を見せたい。
// merged/outdatedは通常のビューでは目立たせず、控えめな表示に留める（非表示にはしない。
// 「必要なら詳細から確認できる」状態を保つため）。foundationalはactiveと同列だが軽い印。
function statusClassName(item: SavedKnowledge): string {
  const status = effectiveStatus(item);
  if (status === "merged" || status === "outdated") return "understanding-item-dimmed";
  return "";
}

function formatDateGroupLabel(date: Date): string {
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const diffDays = Math.round((startOfDay(new Date()) - startOfDay(date)) / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return "今日";
  if (diffDays === 1) return "昨日";
  return date.toLocaleDateString("ja-JP", { month: "long", day: "numeric" });
}

// backendがcreatedAt降順で返す前提で、連続する同じ日付の項目をまとめてグルーピングする。
function groupByDate(items: SavedKnowledge[]): { label: string; items: SavedKnowledge[] }[] {
  const groups: { label: string; items: SavedKnowledge[] }[] = [];
  for (const item of items) {
    const label = formatDateGroupLabel(new Date(item.createdAt));
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(item);
    } else {
      groups.push({ label, items: [item] });
    }
  }
  return groups;
}

type TopicNode = {
  id: string;
  name: string;
  children: TopicNode[];
  items: SavedKnowledge[];
};

// topicPath（例:["経済","金融政策","政策金利"]）を持つKnowledgeから、共通の接頭辞を
// まとめた木構造を組み立てる。topicPathが無いものは別途「未分類」として扱う。
function buildTopicTree(items: SavedKnowledge[]): { tree: TopicNode[]; unclassified: SavedKnowledge[] } {
  const tree: TopicNode[] = [];
  const unclassified: SavedKnowledge[] = [];

  for (const item of items) {
    const path = item.topicPath;
    if (!path || path.length === 0) {
      unclassified.push(item);
      continue;
    }

    let level = tree;
    let idPrefix = "";
    let node: TopicNode | undefined;
    for (const segment of path) {
      idPrefix = idPrefix ? `${idPrefix}/${segment}` : segment;
      node = level.find((n) => n.name === segment);
      if (!node) {
        node = { id: idPrefix, name: segment, children: [], items: [] };
        level.push(node);
      }
      level = node.children;
    }
    node?.items.push(item);
  }

  return { tree, unclassified };
}

function TopicTree({
  nodes,
  onSelect,
  onViewInMap,
  depth = 0,
}: {
  nodes: TopicNode[];
  onSelect: (item: SavedKnowledge) => void;
  onViewInMap?: (topTopic: string) => void;
  depth?: number;
}) {
  return (
    <ul className="topic-tree">
      {nodes.map((node) => (
        <li key={node.id} className="topic-node">
          <p className="topic-node-name">
            {node.name}
            {depth === 0 && onViewInMap && (
              <button type="button" className="topic-node-map-link" onClick={() => onViewInMap(node.name)}>
                この分野をマップで見る →
              </button>
            )}
          </p>
          {node.items.length > 0 && (
            <ul className="topic-node-items">
              {node.items.map((item) => (
                <li key={item._id}>
                  <button
                    type="button"
                    className={`topic-item-button ${statusClassName(item)}`}
                    onClick={() => onSelect(item)}
                  >
                    {item.concept}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {node.children.length > 0 && (
            <div className="topic-node-children">
              <TopicTree nodes={node.children} onSelect={onSelect} onViewInMap={onViewInMap} depth={depth + 1} />
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

const RELATION_EDGE_LABEL: Record<"extends" | "supersedes", string> = {
  extends: "深掘り",
  supersedes: "更新",
};
const RELATION_EDGE_COLOR: Record<"extends" | "supersedes", string> = {
  extends: "#2b6cb0",
  supersedes: "#c0392b",
};

const UNCLASSIFIED_TOPIC_LABEL = "未分類";

// マップ上での「同じ意味領域」はtopicPathの1階層目（トップレベルトピック）で判断する。
// トピック分類自体はサーバー側で既にLLMが行っているので、ここでは再分類はしない。
function getTopLevelTopic(item: SavedKnowledge): string {
  return item.topicPath?.[0] ?? UNCLASSIFIED_TOPIC_LABEL;
}

const TOPIC_COLOR_PALETTE = [
  "#2b6cb0",
  "#c0392b",
  "#2f855a",
  "#b7791f",
  "#6b46c1",
  "#00838f",
  "#ad1457",
  "#4e5d94",
];

// 出現順にトピックへ色を割り当てる。件数が多い順ではなく初出順にすることで、
// 同じデータに対して毎回同じ色になり、UIがちらつかないようにする。
function buildTopicColorMap(topics: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  topics.forEach((topic, index) => {
    map[topic] = TOPIC_COLOR_PALETTE[index % TOPIC_COLOR_PALETTE.length];
  });
  return map;
}

function truncateLabel(text: string, max = 14): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

// 力学シミュレーション等の専用ライブラリは導入せず、単純な「クラスタごとの円形レイアウト」で
// 初期配置する。トップレベルトピックごとに中心点を外周円上に配置し、その中心の周りに
// 同じトピックのKnowledgeを小さな円で固める。これにより明示的な辺が無いKnowledge同士も
// 「同じ意味領域は近くに見える」形になり、孤立ノードだらけの見た目を避ける。
// dragで自由に動かせる（位置の永続化はしない）。
function layoutNodesByTopic(items: SavedKnowledge[], colorMap: Record<string, string>): Node[] {
  const groups = new Map<string, SavedKnowledge[]>();
  for (const item of items) {
    const topic = getTopLevelTopic(item);
    const group = groups.get(topic);
    if (group) group.push(item);
    else groups.set(topic, [item]);
  }

  const topics = Array.from(groups.keys());
  const clusterCount = Math.max(topics.length, 1);
  const clusterRadius = Math.max(220, clusterCount * 90);
  const clusterAngleStep = (2 * Math.PI) / clusterCount;

  const nodes: Node[] = [];

  topics.forEach((topic, clusterIndex) => {
    const members = groups.get(topic) ?? [];
    const clusterAngle = clusterIndex * clusterAngleStep;
    const centerX = clusterRadius + clusterRadius * Math.cos(clusterAngle);
    const centerY = clusterRadius + clusterRadius * Math.sin(clusterAngle);
    const innerRadius = members.length <= 1 ? 0 : Math.max(70, members.length * 20);
    const innerAngleStep = (2 * Math.PI) / Math.max(members.length, 1);
    const color = colorMap[topic];

    // クラスタの中心にトピック名だけのラベルを置く（ドラッグ・クリック不可の背景的な存在）。
    nodes.push({
      id: `topic-label-${topic}`,
      data: { label: topic },
      position: { x: centerX, y: centerY - innerRadius - 36 },
      draggable: false,
      selectable: false,
      connectable: false,
      style: {
        border: "none",
        background: "transparent",
        color,
        fontWeight: 700,
        fontSize: "0.78rem",
        padding: 0,
        pointerEvents: "none",
      },
    });

    members.forEach((item, memberIndex) => {
      const angle = memberIndex * innerAngleStep;
      const dimmed = statusClassName(item) !== "";
      nodes.push({
        id: item._id,
        data: { label: <span title={item.concept}>{truncateLabel(item.concept)}</span> },
        position: {
          x: centerX + innerRadius * Math.cos(angle),
          y: centerY + innerRadius * Math.sin(angle),
        },
        style: {
          border: `2px solid ${dimmed ? "#ccc" : color}`,
          borderRadius: 10,
          padding: "0.35rem 0.6rem",
          fontSize: "0.75rem",
          maxWidth: 130,
          background: dimmed ? "#f5f5f5" : "#fff",
          color: dimmed ? "#999" : "#1a1a1a",
          boxShadow: dimmed ? "none" : "0 1px 3px rgba(0,0,0,0.08)",
        },
      });
    });
  });

  return nodes;
}

function buildEdgesFromRelations(items: SavedKnowledge[]): Edge[] {
  const idSet = new Set(items.map((item) => item._id));
  const edges: Edge[] = [];

  for (const item of items) {
    for (const relation of item.relationsOut ?? []) {
      if (!idSet.has(relation.knowledgeId)) continue; // 参照先が現在の表示対象に無ければ描かない
      edges.push({
        id: `${item._id}->${relation.knowledgeId}`,
        source: item._id,
        target: relation.knowledgeId,
        label: RELATION_EDGE_LABEL[relation.type],
        style: { stroke: RELATION_EDGE_COLOR[relation.type] },
        labelStyle: { fontSize: 10, fill: RELATION_EDGE_COLOR[relation.type] },
      });
    }
  }

  return edges;
}

// 「グラフを表示しただけ」に見えないよう、俯瞰しただけで伝わる小さな成長の手がかりを添える。
// 新しいKnowledgeの件数や新設フィールドは増やさず、既存のcreatedAt/relationsOutだけから計算する。
function computeGrowthStats(items: SavedKnowledge[]): { recentCount: number; connectedTopicCount: number } {
  const weekMs = 7 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  const recentCount = items.filter((item) => now - new Date(item.createdAt).getTime() <= weekMs).length;

  const byTopic = new Map<string, SavedKnowledge[]>();
  for (const item of items) {
    const topic = getTopLevelTopic(item);
    const group = byTopic.get(topic);
    if (group) group.push(item);
    else byTopic.set(topic, [item]);
  }

  let connectedTopicCount = 0;
  for (const members of byTopic.values()) {
    const ids = new Set(members.map((m) => m._id));
    const hasInternalEdge = members.some((m) => (m.relationsOut ?? []).some((r) => ids.has(r.knowledgeId)));
    if (hasInternalEdge) connectedTopicCount++;
  }

  return { recentCount, connectedTopicCount };
}

function TopicFilterChips({
  topics,
  colorMap,
  activeTopic,
  onSelect,
}: {
  topics: string[];
  colorMap: Record<string, string>;
  activeTopic: string | null;
  onSelect: (topic: string | null) => void;
}) {
  return (
    <div className="map-topic-filters">
      <button
        type="button"
        className={activeTopic === null ? "map-topic-chip active" : "map-topic-chip"}
        onClick={() => onSelect(null)}
      >
        すべて
      </button>
      {topics.map((topic) => (
        <button
          key={topic}
          type="button"
          className={activeTopic === topic ? "map-topic-chip active" : "map-topic-chip"}
          style={{ borderColor: colorMap[topic] }}
          onClick={() => onSelect(activeTopic === topic ? null : topic)}
        >
          <span className="map-topic-chip-dot" style={{ background: colorMap[topic] }} />
          {topic}
        </button>
      ))}
    </div>
  );
}

function KnowledgeMap({
  items,
  activeTopic,
  onSelectTopic,
  onSelect,
}: {
  items: SavedKnowledge[];
  activeTopic: string | null;
  onSelectTopic: (topic: string | null) => void;
  onSelect: (item: SavedKnowledge) => void;
}) {
  const allTopics = useMemo(() => Array.from(new Set(items.map(getTopLevelTopic))), [items]);
  const colorMap = useMemo(() => buildTopicColorMap(allTopics), [allTopics]);
  const stats = useMemo(() => computeGrowthStats(items), [items]);

  const visibleItems = useMemo(
    () => (activeTopic ? items.filter((item) => getTopLevelTopic(item) === activeTopic) : items),
    [items, activeTopic],
  );

  const nodes = useMemo(() => layoutNodesByTopic(visibleItems, colorMap), [visibleItems, colorMap]);
  const edges = useMemo(() => buildEdgesFromRelations(visibleItems), [visibleItems]);

  return (
    <div>
      <p className="map-growth-stats">
        今週 {stats.recentCount}件の理解が増えました ・ {stats.connectedTopicCount}個のトピックでつながりが生まれています
      </p>
      <TopicFilterChips topics={allTopics} colorMap={colorMap} activeTopic={activeTopic} onSelect={onSelectTopic} />
      <div className="knowledge-map">
        {/* fitViewは初回マウント時にしか効かないため、絞り込みでノード集合が変わるたびに
            keyを変えて再マウントし、表示中のノード全体に改めてフィットさせる。 */}
        <ReactFlow
          key={activeTopic ?? "all"}
          nodes={nodes}
          edges={edges}
          onNodeClick={(_, node) => {
            const item = items.find((i) => i._id === node.id);
            if (item) onSelect(item);
          }}
          fitView
          proOptions={{ hideAttribution: true }}
        >
          <Background />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>
    </div>
  );
}

function KnowledgeDetailModal({
  item,
  allItems,
  onClose,
}: {
  item: SavedKnowledge;
  allItems: SavedKnowledge[];
  onClose: () => void;
}) {
  const relatedConcepts = (item.relationsOut ?? [])
    .map((relation) => allItems.find((i) => i._id === relation.knowledgeId)?.concept)
    .filter((concept): concept is string => Boolean(concept));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="modal-close" onClick={onClose} aria-label="閉じる">
          ×
        </button>
        <h3 className="modal-title">{item.concept}</h3>
        <p className="modal-statement">{item.statement}</p>
        <dl className="modal-meta">
          <dt>理解した日</dt>
          <dd>{new Date(item.createdAt).toLocaleDateString("ja-JP")}</dd>
          <dt>状態</dt>
          <dd>{STATUS_LABELS[effectiveStatus(item)]}</dd>
          <dt>元の記事</dt>
          <dd>
            <a href={item.source.url} target="_blank" rel="noreferrer">
              {item.source.title}
            </a>
          </dd>
          {relatedConcepts.length > 0 && (
            <>
              <dt>関連する理解</dt>
              <dd>
                <ul className="modal-related-list">
                  {relatedConcepts.map((concept) => (
                    <li key={concept}>{concept}</li>
                  ))}
                </ul>
              </dd>
            </>
          )}
        </dl>
      </div>
    </div>
  );
}

function EmptyState({ onGoDig }: { onGoDig: () => void }) {
  return (
    <div className="understanding-empty">
      <img className="understanding-empty-image" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
      <p className="understanding-empty-text">
        まだ理解マップは小さいです。
        <br />
        気になる記事を掘ると、ここにあなたの理解が少しずつ育っていきます。
      </p>
      <button type="button" className="dig-button" onClick={onGoDig}>
        記事を掘る
      </button>
    </div>
  );
}

function KnowledgeRow({ item, onSelect }: { item: SavedKnowledge; onSelect: (item: SavedKnowledge) => void }) {
  const status = effectiveStatus(item);
  return (
    <li className={`understanding-item ${statusClassName(item)}`}>
      <button type="button" className="understanding-item-button" onClick={() => onSelect(item)}>
        <p className="understanding-item-concept">{item.concept}</p>
        <p className="understanding-item-statement">{item.statement}</p>
        <p className="understanding-item-meta">
          {status !== "active" && <span className="understanding-item-status">{STATUS_LABELS[status]}</span>}
          <span>{item.source.title}</span>
        </p>
      </button>
    </li>
  );
}

export default function UnderstandingPage({ onGoDig }: { onGoDig: () => void }) {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [tab, setTab] = useState<UnderstandingTab>("recent");
  const [selected, setSelected] = useState<SavedKnowledge | null>(null);
  const [mapTopicFilter, setMapTopicFilter] = useState<string | null>(null);

  // トピックビューから「この分野をマップで見る」を押したときに、マップ側の絞り込みを
  // セットしつつタブを切り替える。トピックとマップが別々の画面という感覚を避けるための導線。
  function goToMapFilteredByTopic(topic: string) {
    setMapTopicFilter(topic);
    setTab("map");
  }

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading" });
    fetchSavedKnowledge()
      .then((items) => {
        if (!cancelled) setState({ status: "success", items });
      })
      .catch((err) => {
        if (!cancelled) {
          setState({ status: "error", message: err instanceof Error ? err.message : "取得に失敗しました" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="understanding-page">
      <h2 className="understanding-title">自分の理解</h2>

      {state.status === "loading" && <p className="section-body">読み込み中…</p>}
      {state.status === "error" && <p className="error-message">エラー: {state.message}</p>}

      {state.status === "success" && state.items.length === 0 && <EmptyState onGoDig={onGoDig} />}

      {state.status === "success" && state.items.length > 0 && (
        <>
          <div className="understanding-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "recent"}
              className={tab === "recent" ? "understanding-tab active" : "understanding-tab"}
              onClick={() => setTab("recent")}
            >
              最近
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "topic"}
              className={tab === "topic" ? "understanding-tab active" : "understanding-tab"}
              onClick={() => setTab("topic")}
            >
              トピック
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "map"}
              className={tab === "map" ? "understanding-tab active" : "understanding-tab"}
              onClick={() => setTab("map")}
            >
              マップ
            </button>
          </div>

          {tab === "recent" && (
            <div className="understanding-view">
              {groupByDate(state.items).map((group) => (
                <div key={group.label} className="understanding-date-group">
                  <h3 className="understanding-date-label">{group.label}</h3>
                  <ul className="understanding-item-list">
                    {group.items.map((item) => (
                      <KnowledgeRow key={item._id} item={item} onSelect={setSelected} />
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}

          {tab === "topic" && (
            <div className="understanding-view">
              {(() => {
                const { tree, unclassified } = buildTopicTree(state.items);
                return (
                  <>
                    <TopicTree nodes={tree} onSelect={setSelected} onViewInMap={goToMapFilteredByTopic} />
                    {unclassified.length > 0 && (
                      <div className="topic-node">
                        <p className="topic-node-name">
                          未分類
                          <button
                            type="button"
                            className="topic-node-map-link"
                            onClick={() => goToMapFilteredByTopic(UNCLASSIFIED_TOPIC_LABEL)}
                          >
                            この分野をマップで見る →
                          </button>
                        </p>
                        <ul className="topic-node-items">
                          {unclassified.map((item) => (
                            <li key={item._id}>
                              <button
                                type="button"
                                className={`topic-item-button ${statusClassName(item)}`}
                                onClick={() => setSelected(item)}
                              >
                                {item.concept}
                              </button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {tab === "map" && (
            <div className="understanding-view">
              <KnowledgeMap
                items={state.items.filter((item) => effectiveStatus(item) !== "outdated")}
                activeTopic={mapTopicFilter}
                onSelectTopic={setMapTopicFilter}
                onSelect={setSelected}
              />
            </div>
          )}
        </>
      )}

      {selected && (
        <KnowledgeDetailModal
          item={selected}
          allItems={state.status === "success" ? state.items : []}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

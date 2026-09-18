import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes, useNavigate } from "react-router-dom";
import type { KnowledgeStatus, SavedKnowledge } from "./types";
import { sourceDisplayTitle } from "./sourceLabel";
import UnderstandingMapView from "./UnderstandingMapView";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type FetchState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; items: SavedKnowledge[] };

async function fetchSavedKnowledge(): Promise<SavedKnowledge[]> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge`);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body.knowledge ?? [];
}

export const STATUS_LABELS: Record<KnowledgeStatus, string> = {
  active: "理解済み",
  foundational: "基礎として定着",
  merged: "統合済み",
  outdated: "更新済み",
};

export function effectiveStatus(item: SavedKnowledge): KnowledgeStatus {
  return item.status ?? "active";
}

// Diggerは「Knowledgeを増やすこと」ではなく「今、何を理解しているか」を見せたい。
// merged/outdatedは通常のビューでは目立たせず、控えめな表示に留める（非表示にはしない。
// 「必要なら詳細から確認できる」状態を保つため）。foundationalはactiveと同列だが軽い印。
export function statusClassName(item: SavedKnowledge): string {
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

const UNCLASSIFIED_TOPIC_LABEL = "未分類";

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
          <dt>{item.source.type === "web_article" ? "元の記事" : "入力元"}</dt>
          <dd>
            {item.source.type === "web_article" ? (
              <a href={item.source.url} target="_blank" rel="noreferrer">
                {item.source.title}
              </a>
            ) : (
              sourceDisplayTitle(item.source)
            )}
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

function EmptyState() {
  const navigate = useNavigate();
  return (
    <div className="understanding-empty">
      <img className="understanding-empty-image" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
      <p className="understanding-empty-text">
        まだ理解マップは小さいです。
        <br />
        気になったものを掘ると、ここにあなたの理解が少しずつ育っていきます。
      </p>
      <button type="button" className="dig-button" onClick={() => navigate("/dig")}>
        掘りに行く
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
          <span>{sourceDisplayTitle(item.source)}</span>
        </p>
      </button>
    </li>
  );
}

function RecentView({
  items,
  onSelect,
}: {
  items: SavedKnowledge[];
  onSelect: (item: SavedKnowledge) => void;
}) {
  return (
    <div className="understanding-view">
      {groupByDate(items).map((group) => (
        <div key={group.label} className="understanding-date-group">
          <h3 className="understanding-date-label">{group.label}</h3>
          <ul className="understanding-item-list">
            {group.items.map((item) => (
              <KnowledgeRow key={item._id} item={item} onSelect={onSelect} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function TopicView({
  items,
  onSelect,
  onViewInMap,
}: {
  items: SavedKnowledge[];
  onSelect: (item: SavedKnowledge) => void;
  onViewInMap: (topic: string) => void;
}) {
  const { tree, unclassified } = buildTopicTree(items);
  return (
    <div className="understanding-view">
      <TopicTree nodes={tree} onSelect={onSelect} onViewInMap={onViewInMap} />
      {unclassified.length > 0 && (
        <div className="topic-node">
          <p className="topic-node-name">
            未分類
            <button
              type="button"
              className="topic-node-map-link"
              onClick={() => onViewInMap(UNCLASSIFIED_TOPIC_LABEL)}
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
                  onClick={() => onSelect(item)}
                >
                  {item.concept}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default function UnderstandingPage() {
  const [state, setState] = useState<FetchState>({ status: "loading" });
  const [selected, setSelected] = useState<SavedKnowledge | null>(null);
  const [mapTopicFilter, setMapTopicFilter] = useState<string | null>(null);
  const navigate = useNavigate();

  // トピックビューから「この分野をマップで見る」を押したときに、マップ側の絞り込みを
  // セットしつつマップのrouteへ移動する。トピックビュー（旧Knowledge.topicPathモデル）と
  // マップ（新しいTopic/Conceptモデル）は別の分類結果を持つため、同名のTopicがマップ側にも
  // あれば絞り込む「ベストエフォート」の連携とする（一致しなければ「すべて」表示になる。
  // 詳細はUnderstandingMapView.tsxのinitialTopicName処理を参照）。
  function goToMapFilteredByTopic(topic: string) {
    setMapTopicFilter(topic);
    navigate("/understanding/map");
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

      {state.status === "success" && state.items.length === 0 && <EmptyState />}

      {state.status === "success" && state.items.length > 0 && (
        <>
          <div className="understanding-tabs" role="tablist">
            <NavLink
              to="/understanding/recent"
              className={({ isActive }) => (isActive ? "understanding-tab active" : "understanding-tab")}
            >
              最近
            </NavLink>
            <NavLink
              to="/understanding/topic"
              className={({ isActive }) => (isActive ? "understanding-tab active" : "understanding-tab")}
            >
              トピック
            </NavLink>
            <NavLink
              to="/understanding/map"
              className={({ isActive }) => (isActive ? "understanding-tab active" : "understanding-tab")}
            >
              マップ
            </NavLink>
          </div>

          <Routes>
            <Route index element={<Navigate to="recent" replace />} />
            <Route path="recent" element={<RecentView items={state.items} onSelect={setSelected} />} />
            <Route
              path="topic"
              element={<TopicView items={state.items} onSelect={setSelected} onViewInMap={goToMapFilteredByTopic} />}
            />
            <Route
              path="map"
              element={
                <div className="understanding-view understanding-view-map">
                  <UnderstandingMapView knowledge={state.items} initialTopicName={mapTopicFilter} />
                </div>
              }
            />
          </Routes>
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

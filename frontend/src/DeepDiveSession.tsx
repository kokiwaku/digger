import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
  ArticleAnalysis,
  Concept,
  ConversationTurn,
  DeepDiveResponse,
  DigSource,
  MemoryCandidate,
  MemoryDraftItem,
  MemoryItemType,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

// deepDiveQuestions/suggestedFollowUpsはAI主導の「次の質問」提案のため、Diggerの
// 「ユーザー自身の疑問を起点に掘る」という方針に合わせてUI上は表示しない。
// レスポンスは受け取るが、会話ログにはrole/contentだけを保持する。
export type ChatMessage = { role: "user" | "assistant"; content: string };

type DeepDiveState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

type MemorySaveState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "extracted"; items: MemoryDraftItem[] }
  | { status: "saving" }
  | { status: "saved"; message: string }
  | { status: "error"; message: string };

// バックエンドが生成する文章量と、最初にユーザーへ見せる文章量は別物として扱う。
// summaryは長めに返ってくることがあるため、冒頭の数文だけを切り出して表示する
// （文末記号（。！？）で区切った先頭N文だけを使う単純な方式）。
function firstSentences(text: string, maxSentences: number): string {
  const sentences = text.match(/[^。！？]*[。！？]|[^。！？]+$/g);
  if (!sentences) return text.trim();
  return sentences.slice(0, maxSentences).join("").trim();
}

// typeごとの表示ラベル・グループ表示順。knowledgeを保存対象の先頭に置くのは、
// 既存のKnowledge Extractionからの自然な連続性のため。
const TYPE_LABELS: Record<MemoryItemType, string> = {
  knowledge: "理解したこと",
  preference: "条件・好み",
  candidate: "候補",
  decision: "決めたこと",
  open_question: "未解決",
};
const TYPE_ORDER: MemoryItemType[] = ["knowledge", "preference", "candidate", "decision", "open_question"];

function groupItemsByType(items: MemoryDraftItem[]): Partial<Record<MemoryItemType, MemoryDraftItem[]>> {
  const groups: Partial<Record<MemoryItemType, MemoryDraftItem[]>> = {};
  for (const item of items) {
    (groups[item.type] ??= []).push(item);
  }
  return groups;
}

// 保存後のフィードバックを「N件残しました」だけでなく、type別の内訳も添える。
// ただし主張しすぎないよう、1行に収まる簡潔な文言にとどめる（#23）。
function describeSaveResult(selectedItems: MemoryDraftItem[], savedCount: number, skippedCount: number): string {
  const counts: Partial<Record<MemoryItemType, number>> = {};
  for (const item of selectedItems) {
    counts[item.type] = (counts[item.type] ?? 0) + 1;
  }

  const parts = TYPE_ORDER.map((type) => {
    const count = counts[type];
    return count ? `${TYPE_LABELS[type]} ${count}件` : null;
  }).filter((part): part is string => part !== null);

  const base = parts.length > 0 ? `${savedCount}件残しました（${parts.join("・")}）` : `${savedCount}件残しました`;
  const skipped = skippedCount > 0 ? `（${skippedCount}件は既に保存済みのためスキップしました）` : "";
  return `${base}${skipped}`;
}

function splitCommaList(text: string): string[] {
  return text
    .split(/[、,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

async function askDeepDive(
  articleAnalysis: ArticleAnalysis,
  question: string,
  conversationHistory: ConversationTurn[],
): Promise<DeepDiveResponse> {
  const res = await fetch(`${API_BASE_URL}/api/deep-dive`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ articleAnalysis, question, conversationHistory }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body as DeepDiveResponse;
}

async function extractMemory(
  source: DigSource,
  articleAnalysis: ArticleAnalysis,
  conversationHistory: ConversationTurn[],
): Promise<MemoryCandidate[]> {
  const res = await fetch(`${API_BASE_URL}/api/memory/extract`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, articleAnalysis, conversationHistory }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body.candidates ?? [];
}

async function saveMemory(
  source: DigSource,
  items: MemoryDraftItem[],
): Promise<{ savedCount: number; skippedCount: number }> {
  const res = await fetch(`${API_BASE_URL}/api/memory/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source,
      items: items.map((item) => ({
        id: item.id,
        type: item.type,
        title: item.title,
        content: item.content,
        reason: item.reason,
        metadata: item.metadata,
        confidence: item.confidence,
        origin: item.origin,
        relationToExisting: item.relationToExisting,
      })),
    }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body;
}

// 自由入力欄。Enterで送信、Shift+Enterで改行。pre-chat/chat両方の入力欄で共有する
// （プレースホルダーとボタン文言だけが呼び出し元ごとに異なる）。
function DeepDiveInputForm({
  value,
  onChange,
  onSubmit,
  loading,
  placeholder,
  submitLabel,
  loadingLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  loading: boolean;
  placeholder: string;
  submitLabel: string;
  loadingLabel: string;
}) {
  return (
    <form
      className="ask-form"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
    >
      <textarea
        className="ask-textarea"
        rows={3}
        placeholder={placeholder}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            onSubmit();
          }
        }}
        disabled={loading}
      />
      <button className="dig-button ask-submit" type="submit" disabled={loading || !value.trim()}>
        {loading ? loadingLabel : submitLabel}
      </button>
    </form>
  );
}

function usePrefersReducedMotion(): boolean {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    const handleChange = () => setPrefersReducedMotion(mediaQuery.matches);
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, []);

  return prefersReducedMotion;
}

// Diggerのキャラクター（掘るモグラ）のローディング表示。通常のspinnerの代わりに使う。
// prefers-reduced-motionが有効な環境では、GIFではなく静止フレームを表示する。
export function MoleLoader({ label }: { label: string }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  return (
    <div className="mole-loader" role="status" aria-live="polite">
      <img
        className="mole-loader-image"
        src={prefersReducedMotion ? "/assets/frames/mole-dig-1.png" : "/assets/digger-mole-dig.gif"}
        alt="Diggerが掘っています"
      />
      <p className="mole-loader-label">{label}</p>
    </div>
  );
}

// Knowledge Extraction中に使う、ノートに書き込んで整理しているモグラのフレーム。
// GIFではなく静止画4枚をsetIntervalで順番に切り替える方式（掘るモグラのGIFとは別素材のため）。
const NOTE_FRAMES = [
  "/assets/frames/mole-note-1.png",
  "/assets/frames/mole-note-2.png",
  "/assets/frames/mole-note-3.png",
  "/assets/frames/mole-note-4.png",
];
const NOTE_FRAME_INTERVAL_MS = 350;

// 「わかったことを整理中…」のローディング表示。MoleLoaderと見た目・構造は共通（同じCSSクラスを再利用）
// だが、アニメーション方式が異なる（GIFではなくPNGフレームの手動切り替え）ため別コンポーネントにしている。
function NoteMoleLoader({ label }: { label: string }) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion) return;
    const timer = setInterval(() => {
      setFrameIndex((i) => (i + 1) % NOTE_FRAMES.length);
    }, NOTE_FRAME_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [prefersReducedMotion]);

  return (
    <div className="mole-loader" role="status" aria-live="polite">
      <img
        className="mole-loader-image"
        src={prefersReducedMotion ? NOTE_FRAMES[0] : NOTE_FRAMES[frameIndex]}
        alt="Diggerがわかったことを整理しています"
      />
      <p className="mole-loader-label">{label}</p>
    </div>
  );
}

// 前提知識1件分。名前だけの軽い行として表示し、クリックした場合だけ説明を展開する。
function ConceptDisclosure({ concept }: { concept: Concept }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <li>
      <button type="button" className="concept-line" onClick={() => setExpanded((v) => !v)}>
        {concept.name}
      </button>
      {expanded && <p className="concept-line-description">{concept.description}</p>}
    </li>
  );
}

// 1件分の編集可能なフィールド。title/contentは全typeで編集可能、metadataはcandidateのみ。
type MemoryItemPatch = Partial<Pick<MemoryDraftItem, "title" | "content" | "metadata">>;

function MemoryItemRow({
  item,
  selected,
  onToggleSelect,
  onUpdate,
  saving,
}: {
  item: MemoryDraftItem;
  selected: boolean;
  onToggleSelect: () => void;
  onUpdate: (patch: MemoryItemPatch) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const showTitleField = item.type === "knowledge" || item.type === "candidate";
  const hasCandidateMetadata =
    item.type === "candidate" &&
    ((item.metadata?.reasons && item.metadata.reasons.length > 0) ||
      (item.metadata?.concerns && item.metadata.concerns.length > 0));

  return (
    <li className="knowledge-item">
      <label className="knowledge-checkbox">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={saving} />
        <span className="knowledge-concept">{item.title || item.content}</span>
      </label>

      {!editing && (
        <>
          {item.displayCategory === "updated" && item.relatedKnowledge ? (
            <div className="knowledge-update-compare">
              <p className="knowledge-update-line">
                <span className="knowledge-update-label">以前の理解:</span> {item.relatedKnowledge.statement}
              </p>
              <p className="knowledge-update-line">
                <span className="knowledge-update-label">今回の理解:</span> {item.content}
              </p>
            </div>
          ) : (
            item.title && item.title !== item.content && <p className="knowledge-statement">{item.content}</p>
          )}

          {item.displayCategory === "deepened" && item.relatedKnowledge && (
            <p className="knowledge-relation-hint">
              以前の「{item.relatedKnowledge.concept}」から理解が深まりました
            </p>
          )}

          {hasCandidateMetadata && (
            <div className="memory-candidate-metadata">
              {item.metadata?.reasons && item.metadata.reasons.length > 0 && (
                <p className="memory-candidate-reasons">理由: {item.metadata.reasons.join("・")}</p>
              )}
              {item.metadata?.concerns && item.metadata.concerns.length > 0 && (
                <p className="memory-candidate-concerns">懸念: {item.metadata.concerns.join("・")}</p>
              )}
            </div>
          )}
        </>
      )}

      {editing ? (
        <div className="memory-item-edit">
          {showTitleField && (
            <input
              className="memory-edit-input"
              value={item.title ?? ""}
              onChange={(e) => onUpdate({ title: e.target.value })}
              placeholder="タイトル"
              disabled={saving}
            />
          )}
          <textarea
            className="memory-edit-textarea"
            value={item.content}
            onChange={(e) => onUpdate({ content: e.target.value })}
            rows={2}
            disabled={saving}
          />
          {item.type === "candidate" && (
            <>
              <input
                className="memory-edit-input"
                value={item.metadata?.reasons?.join("、") ?? ""}
                onChange={(e) => onUpdate({ metadata: { ...item.metadata, reasons: splitCommaList(e.target.value) } })}
                placeholder="理由（読点区切り）"
                disabled={saving}
              />
              <input
                className="memory-edit-input"
                value={item.metadata?.concerns?.join("、") ?? ""}
                onChange={(e) => onUpdate({ metadata: { ...item.metadata, concerns: splitCommaList(e.target.value) } })}
                placeholder="懸念（読点区切り）"
                disabled={saving}
              />
            </>
          )}
          <button type="button" className="link-button" onClick={() => setEditing(false)}>
            完了
          </button>
        </div>
      ) : (
        <button type="button" className="link-button memory-edit-toggle" onClick={() => setEditing(true)} disabled={saving}>
          編集
        </button>
      )}

      {item.confidence && <p className="knowledge-confidence">信頼度: {item.confidence}</p>}
    </li>
  );
}

// 保存候補UIに「＋ 自分で追加」を持たせる。AIが出した候補だけに保存内容を限定しない、
// という方針（#最重要の思想）を満たすための入口。
function AddOwnItemForm({
  onAdd,
  disabled,
}: {
  onAdd: (type: MemoryItemType, content: string, note: string) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<MemoryItemType>("preference");
  const [content, setContent] = useState("");
  const [note, setNote] = useState("");

  if (!open) {
    return (
      <button type="button" className="link-button memory-add-toggle" onClick={() => setOpen(true)} disabled={disabled}>
        ＋ 自分で追加
      </button>
    );
  }

  return (
    <div className="memory-add-form">
      <div className="memory-add-type-picker">
        {TYPE_ORDER.map((t) => (
          <button
            key={t}
            type="button"
            className={t === type ? "memory-add-type-button active" : "memory-add-type-button"}
            onClick={() => setType(t)}
          >
            {TYPE_LABELS[t]}
          </button>
        ))}
      </div>
      <textarea
        className="memory-edit-textarea"
        placeholder="内容"
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={2}
      />
      <input
        className="memory-edit-input"
        placeholder="補足（任意）"
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="memory-add-actions">
        <button
          type="button"
          className="dig-button"
          disabled={!content.trim()}
          onClick={() => {
            onAdd(type, content.trim(), note.trim());
            setContent("");
            setNote("");
            setOpen(false);
          }}
        >
          追加
        </button>
        <button type="button" className="link-button" onClick={() => setOpen(false)}>
          キャンセル
        </button>
      </div>
    </div>
  );
}

function MemoryConfirmationPanel({
  items,
  selectedIds,
  onToggleSelect,
  onUpdate,
  onAdd,
  onSave,
  saving,
}: {
  items: MemoryDraftItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onUpdate: (id: string, patch: MemoryItemPatch) => void;
  onAdd: (type: MemoryItemType, content: string, note: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const selectedCount = items.filter((i) => selectedIds.has(i.id)).length;
  const groups = groupItemsByType(items);

  return (
    <div className="knowledge-panel">
      <div className="details-panel">
        <h3 className="section-label">今回残したいこと</h3>

        {items.length === 0 && (
          <p className="section-body">AIからの候補はありませんでした。気になることがあれば、下から自分で追加できます。</p>
        )}

        {TYPE_ORDER.map((type) => {
          const groupItems = groups[type];
          if (!groupItems || groupItems.length === 0) return null;
          return (
            <div key={type} className="knowledge-category">
              <h4 className="knowledge-category-label">{TYPE_LABELS[type]}</h4>
              <ul className="card-list">
                {groupItems.map((item) => (
                  <MemoryItemRow
                    key={item.id}
                    item={item}
                    selected={selectedIds.has(item.id)}
                    onToggleSelect={() => onToggleSelect(item.id)}
                    onUpdate={(patch) => onUpdate(item.id, patch)}
                    saving={saving}
                  />
                ))}
              </ul>
            </div>
          );
        })}

        <AddOwnItemForm onAdd={onAdd} disabled={saving} />

        {selectedCount > 0 && (
          <button className="dig-button" onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : "保存する"}
          </button>
        )}
      </div>
    </div>
  );
}

export interface DeepDiveSessionProps {
  analysis: ArticleAnalysis;
  source: DigSource;
  /** URL/text/image起点の通常フロー用: 記事ヘッダー（タイトル+リンク、またはfallback表示）。
   *  headingを指定する場合（Concept/Topic起点）は不要。 */
  header?: ReactNode;
  /** Concept/Topic起点の場合の見出し（例:「MI6について掘る」）。指定すると、記事情報カード・
   *  前提知識/背景パネルを持つ通常のpre-chat viewを出さず、最初からDigger側の短い導入
   *  メッセージ＋自由入力だけのシンプルな画面になる（「自由入力を主役にする」という方針）。 */
  heading?: string;
  /** headingを指定する場合の、Digger側からの短い導入（最初のassistant発言として表示）。 */
  introMessage?: string;
  /** 画面上部・headingのすぐ下に追加で表示する要素（例:「理解マップへ戻る」ボタン）。 */
  headerExtra?: ReactNode;
  /** 保存が成功した直後に呼ばれる（Understanding Map側の再取得トリガー等に使える）。 */
  onMemorySaved?: () => void;
}

// Deep Dive〜Knowledge Extraction〜保存までの一連のUIをまとめたコンポーネント。
// 「掘る」の起点（URL/テキスト/画像から新しく掘るか、Concept/Topicを起点に既存の理解から
// さらに掘るか）を問わず共通で使う。起点の違いはDigPage.tsx / ConceptDigPage.tsx /
// TopicDigPage.tsxが呼び出し前に組み立てる`analysis`/`source`/`heading`だけに閉じ込め、
// Deep Dive・Knowledge Extraction・保存のロジック自体は完全に共通化している。
export default function DeepDiveSession({
  analysis,
  source,
  header,
  heading,
  introMessage,
  headerExtra,
  onMemorySaved,
}: DeepDiveSessionProps) {
  // Concept/Topic起点（heading指定あり）は、Digger側の短い導入をassistantの最初の発言として
  // 予め入れておくことで、「自由入力を主役にする」シンプルな画面（記事情報カードなどを
  // 経由しない）を、既存のChat View（hasStartedChat）の描画パスにそのまま乗せて実現する。
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    heading && introMessage ? [{ role: "assistant", content: introMessage }] : [],
  );
  const [question, setQuestion] = useState("");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>({ status: "idle" });

  const [showConcepts, setShowConcepts] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [showSummaryInChat, setShowSummaryInChat] = useState(false);

  const [memorySaveState, setMemorySaveState] = useState<MemorySaveState>({ status: "idle" });
  const [memorySelectedIds, setMemorySelectedIds] = useState<Set<string>>(new Set());
  const [showMemoryPanel, setShowMemoryPanel] = useState(false);

  const handleDeepDive = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || deepDiveState.status === "loading") return;

    const history: ConversationTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuestion("");
    setDeepDiveState({ status: "loading" });

    try {
      const response = await askDeepDive(analysis, trimmed, history);
      // response.suggestedFollowUpsはAI主導の次の質問提案のためUIには表示しない（受け取るだけ）。
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      setDeepDiveState({ status: "idle" });
    } catch (err) {
      setDeepDiveState({ status: "error", message: err instanceof Error ? err.message : "深掘りに失敗しました" });
    }
  };

  const handleExtractMemory = async () => {
    const history: ConversationTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));

    setMemorySaveState({ status: "extracting" });
    setShowMemoryPanel(true);
    setMemorySelectedIds(new Set());

    try {
      const candidates = await extractMemory(source, analysis, history);
      const items: MemoryDraftItem[] = candidates.map((candidate) => ({ ...candidate, origin: "ai_extracted" }));
      setMemorySaveState({ status: "extracted", items });
    } catch (err) {
      setMemorySaveState({ status: "error", message: err instanceof Error ? err.message : "抽出に失敗しました" });
    }
  };

  // AI候補のtitle/content/metadataを編集する。編集した時点でoriginを"user_edited"に切り替える
  // （ユーザーが自分で追加したitemは"user_created"のまま維持する）。
  const handleUpdateMemoryItem = (id: string, patch: MemoryItemPatch) => {
    if (memorySaveState.status !== "extracted") return;
    setMemorySaveState({
      status: "extracted",
      items: memorySaveState.items.map((item) =>
        item.id === id
          ? { ...item, ...patch, origin: item.origin === "user_created" ? item.origin : "user_edited" }
          : item,
      ),
    });
  };

  // 「＋ 自分で追加」から、AI候補を介さずユーザー自身がMemoryItemを追加する。
  const handleAddOwnMemoryItem = (type: MemoryItemType, content: string, note: string) => {
    if (memorySaveState.status !== "extracted") return;
    const newItem: MemoryDraftItem = {
      id: crypto.randomUUID(),
      type,
      content,
      reason: note || undefined,
      confidence: "high",
      origin: "user_created",
    };
    setMemorySaveState({ status: "extracted", items: [...memorySaveState.items, newItem] });
    setMemorySelectedIds((prev) => new Set(prev).add(newItem.id));
  };

  const handleSaveSelectedMemory = async () => {
    if (memorySaveState.status !== "extracted") return;

    const selectedItems = memorySaveState.items.filter((item) => memorySelectedIds.has(item.id));

    if (selectedItems.length === 0) return;

    setMemorySaveState({ status: "saving" });

    try {
      const result = await saveMemory(source, selectedItems);
      setMemorySaveState({
        status: "saved",
        message: describeSaveResult(selectedItems, result.savedCount, result.skippedCount),
      });
      setShowMemoryPanel(false);
      setMemorySelectedIds(new Set());
      onMemorySaved?.();

      // 大げさな画面遷移はせず、チャット画面上の小さなフィードバックのみ。数秒後に自動的に消す。
      setTimeout(() => {
        setMemorySaveState({ status: "idle" });
      }, 4000);
    } catch (err) {
      setMemorySaveState({
        status: "error",
        message: err instanceof Error ? err.message : "保存に失敗しました",
      });
    }
  };

  // Concept/Topic起点は最初からmessagesに導入メッセージを持つため、常にChat View扱いになる。
  const hasStartedChat = messages.length > 0;
  const shortSummary = firstSentences(analysis.summary, 3);

  return (
    <article className="result">
      {header}
      {heading && (
        <header className="entity-dig-header">
          <h2 className="result-title">{heading}</h2>
          {headerExtra}
        </header>
      )}

      {!hasStartedChat && (
        <>
          <p className="intro-summary">{shortSummary}</p>

          <section className="ask-hero">
            <p className="ask-heading">気になることを聞いてみましょう</p>

            <DeepDiveInputForm
              value={question}
              onChange={setQuestion}
              onSubmit={() => handleDeepDive(question)}
              loading={deepDiveState.status === "loading"}
              placeholder="分からないことを、そのまま書いてください"
              submitLabel="掘る"
              loadingLabel="掘っています..."
            />

            {deepDiveState.status === "loading" && <MoleLoader label="もう少し掘っています…" />}
            {deepDiveState.status === "error" && <p className="error-message">エラー: {deepDiveState.message}</p>}
          </section>

          <div className="secondary-links">
            {analysis.concepts.length > 0 && (
              <button type="button" className="link-button" onClick={() => setShowConcepts((v) => !v)}>
                {showConcepts ? "前提知識を閉じる" : "前提知識を見る"}
              </button>
            )}
            <button type="button" className="link-button" onClick={() => setShowBackground((v) => !v)}>
              {showBackground ? "背景を閉じる" : "背景を見る"}
            </button>
          </div>

          {showConcepts && (
            <div className="details-panel">
              <ul className="card-list">
                {analysis.concepts.map((concept) => (
                  <ConceptDisclosure key={concept.id} concept={concept} />
                ))}
              </ul>
            </div>
          )}

          {showBackground && (
            <div className="details-panel">
              <section>
                <h3 className="section-label">なぜ重要？</h3>
                <p className="section-body">{analysis.whyItMatters}</p>
              </section>

              {analysis.connections.length > 0 && (
                <section>
                  <h3 className="section-label">この話とのつながり</h3>
                  <ul className="connection-list">
                    {analysis.connections.map((connection) => (
                      <li key={connection.topic} className="connection-item">
                        <p className="connection-topic">{connection.topic}</p>
                        <p className="connection-relation">→ {connection.relation}</p>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {analysis.entities.length > 0 && (
                <section>
                  <h3 className="section-label">関連する人物・組織など</h3>
                  <ul className="card-list">
                    {analysis.entities.map((entity) => (
                      <li key={entity.name} className="entity-item">
                        <p className="entity-name">{entity.name}</p>
                        {entity.description && <p className="entity-description">{entity.description}</p>}
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </div>
          )}
        </>
      )}

      {hasStartedChat && (
        <section className="chat-section">
          {!heading && (
            <button type="button" className="link-button" onClick={() => setShowSummaryInChat((v) => !v)}>
              {showSummaryInChat ? "要点を閉じる" : "要点を見る"}
            </button>
          )}

          {showSummaryInChat && !heading && <p className="intro-summary chat-summary">{shortSummary}</p>}

          <div className="chat-log">
            {messages.map((message, index) => (
              <div
                key={index}
                className={message.role === "user" ? "chat-bubble chat-user" : "chat-message chat-assistant"}
              >
                <p className="chat-content">{message.content}</p>
              </div>
            ))}
          </div>

          {deepDiveState.status === "loading" && <MoleLoader label="もう少し掘っています…" />}
          {deepDiveState.status === "error" && <p className="error-message">エラー: {deepDiveState.message}</p>}

          <DeepDiveInputForm
            value={question}
            onChange={setQuestion}
            onSubmit={() => handleDeepDive(question)}
            loading={deepDiveState.status === "loading"}
            placeholder="気になることを入力してください"
            submitLabel="掘る"
            loadingLabel="掘っています..."
          />

          {messages.some((m) => m.role === "assistant") && (
            <button type="button" className="link-button" onClick={handleExtractMemory}>
              今回残したいこと
            </button>
          )}

          {(memorySaveState.status === "extracted" || memorySaveState.status === "saving") && showMemoryPanel && (
            <MemoryConfirmationPanel
              items={memorySaveState.status === "extracted" ? memorySaveState.items : []}
              selectedIds={memorySelectedIds}
              onToggleSelect={(id) => {
                const next = new Set(memorySelectedIds);
                if (next.has(id)) {
                  next.delete(id);
                } else {
                  next.add(id);
                }
                setMemorySelectedIds(next);
              }}
              onUpdate={handleUpdateMemoryItem}
              onAdd={handleAddOwnMemoryItem}
              onSave={handleSaveSelectedMemory}
              saving={memorySaveState.status === "saving"}
            />
          )}

          {memorySaveState.status === "extracting" && (
            <div className="knowledge-loading">
              <NoteMoleLoader label="残したいことを整理中…" />
            </div>
          )}

          {memorySaveState.status === "error" && <p className="error-message">エラー: {memorySaveState.message}</p>}

          {memorySaveState.status === "saved" && <p className="success-message">{memorySaveState.message}</p>}
        </section>
      )}
    </article>
  );
}

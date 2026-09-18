import { useEffect, useRef, useState } from "react";
import type {
  ArticleAnalysis,
  Concept,
  ConversationTurn,
  DeepDiveResponse,
  DigResult,
  DigSource,
  KnowledgeCandidate,
} from "./types";
import { sourceDisplayTitle } from "./sourceLabel";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

// backendのdig.ts（ALLOWED_IMAGE_MIME_TYPES/MAX_IMAGE_BYTES）と同じ基準をfrontend側でも
// 事前チェックする（サーバーへ送る前にユーザーへすぐフィードバックするため。最終的な
// 検証はbackend側が権威を持つ＝ここを迂回されても後段で弾かれる）。
const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

type ComposerImage = { file: File; previewUrl: string };

type InputKind = "url" | "text" | "image";

// Composerは1つのURL/テキスト入力欄と、任意の画像添付という単純な構成にし、
// 「URLかテキストか」をユーザーに選ばせない（自動判定する）。厳密な判定はbackendの
// resolveInputSource()が行うため、ここではローディング文言の出し分け程度の軽い判定でよい。
function detectInputKind(text: string, hasImage: boolean): InputKind {
  if (hasImage) return "image";
  const trimmed = text.trim();
  if (trimmed.length > 0 && !/\s/.test(trimmed) && /^https?:\/\//i.test(trimmed)) {
    try {
      new URL(trimmed);
      return "url";
    } catch {
      // fall through to text
    }
  }
  return "text";
}

const LOADING_LABELS: Record<InputKind, string> = {
  url: "記事を掘っています…",
  text: "内容を整理しています…",
  image: "画像をじっくり見ています…",
};

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("画像の読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

type DigState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: DigResult };

// deepDiveQuestions/suggestedFollowUpsはAI主導の「次の質問」提案のため、Diggerの
// 「ユーザー自身の疑問を起点に掘る」という方針に合わせてUI上は表示しない。
// レスポンスは受け取るが、会話ログにはrole/contentだけを保持する。
type ChatMessage = { role: "user" | "assistant"; content: string };

type DeepDiveState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

type KnowledgeSaveState =
  | { status: "idle" }
  | { status: "extracting" }
  | { status: "extracted"; candidates: KnowledgeCandidate[] }
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

// 保存後のフィードバックを「N件保存しました」だけでなく、可能な範囲でrelationに応じた
// 表現にする（新しくわかったこと/理解が深まったこと/更新したこと）。保存対象を選んだ時点の
// displayCategoryから算出するだけの簡易な実装（実際の保存件数と多少ずれても許容する）。
function describeSaveResult(
  selectedCandidates: KnowledgeCandidate[],
  savedCount: number,
  skippedCount: number,
): string {
  const counts = { new: 0, deepened: 0, updated: 0 };
  for (const candidate of selectedCandidates) {
    counts[candidate.displayCategory]++;
  }

  const sentences: string[] = [];
  if (counts.new > 0) sentences.push(`新しい理解を${counts.new}件保存しました。`);
  if (counts.deepened > 0) sentences.push(`理解が${counts.deepened}件深まりました。`);
  if (counts.updated > 0) sentences.push(`理解を${counts.updated}件更新しました。`);

  const base = sentences.length > 0 ? sentences.join("") : `${savedCount}件の理解を保存しました。`;
  const skipped = skippedCount > 0 ? `（${skippedCount}件は既に保存済みのためスキップしました）` : "";
  return `${base}${skipped}`;
}

// input（URL/テキスト。空でもよい＝画像だけの場合）とimage（任意）を渡す。URL/テキストの
// 判定はbackendのresolveInputSource()が行うため、ここでは判定済みの種別を意識しない。
async function digContent(body: { input?: string; image?: { data: string; mimeType: string } }): Promise<DigResult> {
  const res = await fetch(`${API_BASE_URL}/api/dig`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const responseBody = await res.json().catch(() => null);

  if (!res.ok) {
    const message =
      responseBody && typeof responseBody.error === "string" ? responseBody.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return responseBody as DigResult;
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

async function extractKnowledge(
  source: DigSource,
  articleAnalysis: ArticleAnalysis,
  conversationHistory: ConversationTurn[],
): Promise<KnowledgeCandidate[]> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge/extract`, {
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

async function saveKnowledge(
  source: DigSource,
  candidates: KnowledgeCandidate[],
): Promise<{ savedCount: number; skippedCount: number }> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge/save`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ source, candidates }),
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
function MoleLoader({ label }: { label: string }) {
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
// 将来的に保存処理中など他のKnowledge関連のローディングでも label を変えるだけで再利用できる。
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

// Diggerは「Knowledgeを増やすこと」ではなく「理解状態がどう変化したか」を見せたい。
// reinforces相当の候補はbackend側で確認候補一覧から除外済みなので、ここに来る候補は
// 常にnew/deepened/updatedのいずれか（displayCategory）。カテゴリごとに見出しを分けて表示する。
const CATEGORY_LABELS: Record<KnowledgeCandidate["displayCategory"], string> = {
  new: "新しくわかったこと",
  deepened: "理解が深まったこと",
  updated: "理解を更新する",
};
const CATEGORY_ORDER: KnowledgeCandidate["displayCategory"][] = ["new", "deepened", "updated"];

function groupCandidatesByCategory(
  candidates: KnowledgeCandidate[],
): Partial<Record<KnowledgeCandidate["displayCategory"], KnowledgeCandidate[]>> {
  const groups: Partial<Record<KnowledgeCandidate["displayCategory"], KnowledgeCandidate[]>> = {};
  for (const candidate of candidates) {
    (groups[candidate.displayCategory] ??= []).push(candidate);
  }
  return groups;
}

function KnowledgeCandidateItem({
  candidate,
  selected,
  onToggleSelect,
  saving,
}: {
  candidate: KnowledgeCandidate;
  selected: boolean;
  onToggleSelect: () => void;
  saving: boolean;
}) {
  return (
    <li className="knowledge-item">
      <label className="knowledge-checkbox">
        <input type="checkbox" checked={selected} onChange={onToggleSelect} disabled={saving} />
        <span className="knowledge-concept">{candidate.concept}</span>
      </label>

      {candidate.displayCategory === "updated" && candidate.relatedKnowledge ? (
        <div className="knowledge-update-compare">
          <p className="knowledge-update-line">
            <span className="knowledge-update-label">以前の理解:</span> {candidate.relatedKnowledge.statement}
          </p>
          <p className="knowledge-update-line">
            <span className="knowledge-update-label">今回の理解:</span> {candidate.statement}
          </p>
        </div>
      ) : (
        <p className="knowledge-statement">{candidate.statement}</p>
      )}

      {candidate.displayCategory === "deepened" && candidate.relatedKnowledge && (
        <p className="knowledge-relation-hint">
          以前の「{candidate.relatedKnowledge.concept}」から理解が深まりました
        </p>
      )}

      <p className="knowledge-confidence">信頼度: {candidate.confidence}</p>
    </li>
  );
}

function KnowledgeConfirmationPanel({
  candidates,
  selectedIds,
  onToggleSelect,
  onSave,
  saving,
}: {
  candidates: KnowledgeCandidate[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const selectedCount = candidates.filter((c) => selectedIds.has(c.id)).length;

  if (candidates.length === 0) {
    return (
      <div className="knowledge-panel">
        <div className="details-panel">
          <p className="section-body">今回は新しく保存する内容はありませんでした。</p>
        </div>
      </div>
    );
  }

  const groups = groupCandidatesByCategory(candidates);

  return (
    <div className="knowledge-panel">
      <div className="details-panel">
        <h3 className="section-label">今回、理解がどう変わったか</h3>
        {CATEGORY_ORDER.map((category) => {
          const items = groups[category];
          if (!items || items.length === 0) return null;
          return (
            <div key={category} className="knowledge-category">
              <h4 className="knowledge-category-label">{CATEGORY_LABELS[category]}</h4>
              <ul className="card-list">
                {items.map((candidate) => (
                  <KnowledgeCandidateItem
                    key={candidate.id}
                    candidate={candidate}
                    selected={selectedIds.has(candidate.id)}
                    onToggleSelect={() => onToggleSelect(candidate.id)}
                    saving={saving}
                  />
                ))}
              </ul>
            </div>
          );
        })}
        {selectedCount > 0 && (
          <button className="dig-button" onClick={onSave} disabled={saving}>
            {saving ? "保存中..." : "保存する"}
          </button>
        )}
      </div>
    </div>
  );
}

export default function DigPage() {
  const [composerText, setComposerText] = useState("");
  const [composerImage, setComposerImage] = useState<ComposerImage | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<InputKind>("text");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<DigState>({ status: "idle" });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>({ status: "idle" });

  const [showConcepts, setShowConcepts] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [showSummaryInChat, setShowSummaryInChat] = useState(false);

  const [knowledgeSaveState, setKnowledgeSaveState] = useState<KnowledgeSaveState>({ status: "idle" });
  const [knowledgeSelectedIds, setKnowledgeSelectedIds] = useState<Set<string>>(new Set());
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);

  // 選んだ画像はまだアップロードせず、ブラウザ内のプレビュー用URLを持つだけ（実際に
  // base64化してbackendへ送るのは送信時のみ）。差し替え・削除時は必ずrevokeして
  // オブジェクトURLのリークを防ぐ。
  function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setComposerError(null);
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      setComposerError("対応していない画像形式です（JPEG・PNG・WebPのみ対応しています）");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setComposerError(`画像サイズが大きすぎます（${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB以下にしてください）`);
      return;
    }

    setComposerImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return { file, previewUrl: URL.createObjectURL(file) };
    });
  }

  function handleRemoveImage() {
    setComposerImage((prev) => {
      if (prev) URL.revokeObjectURL(prev.previewUrl);
      return null;
    });
  }

  // Composerを離れるときに、選択中の画像プレビュー用オブジェクトURLを解放する。
  useEffect(() => {
    return () => {
      if (composerImage) URL.revokeObjectURL(composerImage.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setComposerError(null);

    const trimmedText = composerText.trim();
    if (!composerImage && trimmedText.length === 0) {
      setComposerError("URL、文章、または画像のいずれかを入力してください");
      return;
    }

    const kind = detectInputKind(trimmedText, Boolean(composerImage));
    setPendingKind(kind);
    setState({ status: "loading" });
    setMessages([]);
    setDeepDiveState({ status: "idle" });
    setShowConcepts(false);
    setShowBackground(false);
    setShowSummaryInChat(false);
    try {
      let image: { data: string; mimeType: string } | undefined;
      if (composerImage) {
        const dataUrl = await readFileAsDataUrl(composerImage.file);
        image = { data: dataUrl, mimeType: composerImage.file.type };
      }
      const result = await digContent({ input: trimmedText || undefined, image });
      setState({ status: "success", result });
      // 送信に成功したらComposerをクリアする（失敗時は入力し直せるよう残す）。
      setComposerText("");
      handleRemoveImage();
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "掘れませんでした" });
    }
  };

  const handleDeepDive = async (questionText: string) => {
    const trimmed = questionText.trim();
    if (!trimmed || state.status !== "success" || deepDiveState.status === "loading") return;

    const history: ConversationTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));

    setMessages((prev) => [...prev, { role: "user", content: trimmed }]);
    setQuestion("");
    setDeepDiveState({ status: "loading" });

    try {
      const response = await askDeepDive(state.result.analysis, trimmed, history);
      // response.suggestedFollowUpsはAI主導の次の質問提案のためUIには表示しない（受け取るだけ）。
      setMessages((prev) => [...prev, { role: "assistant", content: response.answer }]);
      setDeepDiveState({ status: "idle" });
    } catch (err) {
      setDeepDiveState({ status: "error", message: err instanceof Error ? err.message : "深掘りに失敗しました" });
    }
  };

  const handleExtractKnowledge = async () => {
    if (state.status !== "success") return;

    const history: ConversationTurn[] = messages.map((m) => ({ role: m.role, content: m.content }));

    setKnowledgeSaveState({ status: "extracting" });
    setShowKnowledgePanel(true);
    setKnowledgeSelectedIds(new Set());

    try {
      const candidates = await extractKnowledge(state.result.source, state.result.analysis, history);
      setKnowledgeSaveState({ status: "extracted", candidates });
    } catch (err) {
      setKnowledgeSaveState({ status: "error", message: err instanceof Error ? err.message : "知識抽出に失敗しました" });
    }
  };

  const handleSaveSelectedKnowledge = async () => {
    if (state.status !== "success" || knowledgeSaveState.status !== "extracted") return;

    const selectedCandidates = knowledgeSaveState.candidates.filter((c) => knowledgeSelectedIds.has(c.id));

    if (selectedCandidates.length === 0) return;

    setKnowledgeSaveState({ status: "saving" });

    try {
      const result = await saveKnowledge(state.result.source, selectedCandidates);
      setKnowledgeSaveState({
        status: "saved",
        message: describeSaveResult(selectedCandidates, result.savedCount, result.skippedCount),
      });
      setShowKnowledgePanel(false);
      setKnowledgeSelectedIds(new Set());

      // 大げさな画面遷移はせず、チャット画面上の小さなフィードバックのみ。数秒後に自動的に消す。
      setTimeout(() => {
        setKnowledgeSaveState({ status: "idle" });
      }, 4000);
    } catch (err) {
      setKnowledgeSaveState({
        status: "error",
        message: err instanceof Error ? err.message : "知識の保存に失敗しました",
      });
    }
  };

  const analysis = state.status === "success" ? state.result.analysis : null;
  const hasStartedChat = messages.length > 0;
  const shortSummary = analysis ? firstSentences(analysis.summary, 3) : "";

  return (
    <div className="dig-page-inner">
      <form className="composer-form" onSubmit={handleSubmit}>
        <p className="composer-heading">気になったものを掘る</p>
        <textarea
          className="composer-textarea"
          rows={3}
          placeholder="URLや文章を貼り付ける"
          value={composerText}
          onChange={(e) => setComposerText(e.target.value)}
          disabled={state.status === "loading"}
        />

        {composerImage && (
          <div className="composer-image-preview">
            <img src={composerImage.previewUrl} alt="添付する画像のプレビュー" />
            <button
              type="button"
              className="composer-image-remove"
              onClick={handleRemoveImage}
              disabled={state.status === "loading"}
              aria-label="画像を削除"
            >
              ×
            </button>
          </div>
        )}

        <div className="composer-actions">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="composer-file-input"
            onChange={handleImageSelect}
          />
          <button
            type="button"
            className="composer-attach-button"
            onClick={() => fileInputRef.current?.click()}
            disabled={state.status === "loading"}
          >
            + 画像を追加
          </button>
          <button
            className="dig-button"
            type="submit"
            disabled={state.status === "loading" || (!composerImage && composerText.trim().length === 0)}
          >
            {state.status === "loading" ? "掘っています..." : "掘る"}
          </button>
        </div>

        {composerError && <p className="error-message">{composerError}</p>}
      </form>

      {state.status === "loading" && <MoleLoader label={LOADING_LABELS[pendingKind]} />}

      {state.status === "error" && <p className="error-message">エラー: {state.message}</p>}

      {state.status === "success" && analysis && (
        <article className="result">
          <header>
            {state.result.source.type === "web_article" ? (
              <>
                <h2 className="result-title">{state.result.source.title}</h2>
                <a className="result-source-url" href={state.result.source.url} target="_blank" rel="noreferrer">
                  {state.result.source.url}
                </a>
              </>
            ) : (
              <h2 className="result-title">{sourceDisplayTitle(state.result.source)}</h2>
            )}
          </header>

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
              <button type="button" className="link-button" onClick={() => setShowSummaryInChat((v) => !v)}>
                {showSummaryInChat ? "要点を閉じる" : "要点を見る"}
              </button>

              {showSummaryInChat && <p className="intro-summary chat-summary">{shortSummary}</p>}

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
                placeholder="さらに気になることを入力してください"
                submitLabel="掘る"
                loadingLabel="掘っています..."
              />

              {messages.some((m) => m.role === "assistant") && (
                <button type="button" className="link-button" onClick={handleExtractKnowledge}>
                  今回わかったことを残す
                </button>
              )}

              {(knowledgeSaveState.status === "extracted" || knowledgeSaveState.status === "saving") &&
                showKnowledgePanel && (
                  <KnowledgeConfirmationPanel
                    candidates={
                      knowledgeSaveState.status === "extracted"
                        ? knowledgeSaveState.candidates
                        : []
                    }
                    selectedIds={knowledgeSelectedIds}
                    onToggleSelect={(id) => {
                      const next = new Set(knowledgeSelectedIds);
                      if (next.has(id)) {
                        next.delete(id);
                      } else {
                        next.add(id);
                      }
                      setKnowledgeSelectedIds(next);
                    }}
                    onSave={handleSaveSelectedKnowledge}
                    saving={knowledgeSaveState.status === "saving"}
                  />
                )}

              {knowledgeSaveState.status === "extracting" && (
                <div className="knowledge-loading">
                  <NoteMoleLoader label="わかったことを整理中…" />
                </div>
              )}

              {knowledgeSaveState.status === "error" && (
                <p className="error-message">エラー: {knowledgeSaveState.message}</p>
              )}

              {knowledgeSaveState.status === "saved" && (
                <p className="success-message">{knowledgeSaveState.message}</p>
              )}
            </section>
          )}
        </article>
      )}
    </div>
  );
}

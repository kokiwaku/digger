import { useEffect, useState } from "react";
import "./App.css";
import type {
  ArticleAnalysis,
  Concept,
  ConversationTurn,
  DeepDiveResponse,
  DigResult,
  KnowledgeCandidate,
  SavedKnowledge,
} from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

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
  | { status: "saved"; savedCount: number; skippedCount: number }
  | { status: "error"; message: string };

// 保存済みKnowledgeの確認用テスト表示。恒久的な一覧UIではなく、動作確認のための
// 暫定実装（不要になったら削除してよい）。
type KnowledgeListState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; items: SavedKnowledge[] };

// バックエンドが生成する文章量と、最初にユーザーへ見せる文章量は別物として扱う。
// summaryは長めに返ってくることがあるため、冒頭の数文だけを切り出して表示する
// （文末記号（。！？）で区切った先頭N文だけを使う単純な方式）。
function firstSentences(text: string, maxSentences: number): string {
  const sentences = text.match(/[^。！？]*[。！？]|[^。！？]+$/g);
  if (!sentences) return text.trim();
  return sentences.slice(0, maxSentences).join("").trim();
}

async function digUrl(url: string): Promise<DigResult> {
  const res = await fetch(`${API_BASE_URL}/api/dig`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body as DigResult;
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
  source: { type: "web_article"; url: string; title: string },
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
  source: { type: "web_article"; url: string; title: string },
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

async function fetchSavedKnowledge(): Promise<SavedKnowledge[]> {
  const res = await fetch(`${API_BASE_URL}/api/knowledge`);
  const body = await res.json().catch(() => null);

  if (!res.ok) {
    const message = body && typeof body.error === "string" ? body.error : `HTTP ${res.status}`;
    throw new Error(message);
  }

  return body.knowledge ?? [];
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

function KnowledgeConfirmationPanel({
  candidates,
  selectedIndices,
  onToggleSelect,
  onSave,
  saving,
}: {
  candidates: KnowledgeCandidate[];
  selectedIndices: Set<number>;
  onToggleSelect: (index: number) => void;
  onSave: () => void;
  saving: boolean;
}) {
  const selectedCandidates = candidates.filter((_, i) => selectedIndices.has(i));

  return (
    <div className="knowledge-panel">
      <div className="details-panel">
        <h3 className="section-label">今回わかったことを確認</h3>
        <ul className="card-list">
          {candidates.map((candidate, i) => (
            <li key={candidate.id} className="knowledge-item">
              <label className="knowledge-checkbox">
                <input
                  type="checkbox"
                  checked={selectedIndices.has(i)}
                  onChange={() => onToggleSelect(i)}
                  disabled={saving}
                />
                <span className="knowledge-concept">{candidate.concept}</span>
              </label>
              <p className="knowledge-statement">{candidate.statement}</p>
              <p className="knowledge-confidence">信頼度: {candidate.confidence}</p>
            </li>
          ))}
        </ul>
        {selectedCandidates.length > 0 && (
          <button
            className="dig-button"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? "保存中..." : `${selectedCandidates.length}件を保存する`}
          </button>
        )}
      </div>
    </div>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DigState>({ status: "idle" });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>({ status: "idle" });

  const [showConcepts, setShowConcepts] = useState(false);
  const [showBackground, setShowBackground] = useState(false);
  const [showSummaryInChat, setShowSummaryInChat] = useState(false);

  const [knowledgeSaveState, setKnowledgeSaveState] = useState<KnowledgeSaveState>({ status: "idle" });
  const [knowledgeSelectedIndices, setKnowledgeSelectedIndices] = useState<Set<number>>(new Set());
  const [showKnowledgePanel, setShowKnowledgePanel] = useState(false);

  const [showKnowledgeList, setShowKnowledgeList] = useState(false);
  const [knowledgeListState, setKnowledgeListState] = useState<KnowledgeListState>({ status: "idle" });

  const handleToggleKnowledgeList = async () => {
    if (showKnowledgeList) {
      setShowKnowledgeList(false);
      return;
    }
    setShowKnowledgeList(true);
    setKnowledgeListState({ status: "loading" });
    try {
      const items = await fetchSavedKnowledge();
      setKnowledgeListState({ status: "success", items });
    } catch (err) {
      setKnowledgeListState({
        status: "error",
        message: err instanceof Error ? err.message : "取得に失敗しました",
      });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "loading" });
    setMessages([]);
    setDeepDiveState({ status: "idle" });
    setShowConcepts(false);
    setShowBackground(false);
    setShowSummaryInChat(false);
    try {
      const result = await digUrl(url);
      setState({ status: "success", result });
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
    setKnowledgeSelectedIndices(new Set());

    try {
      const candidates = await extractKnowledge(state.result.source, state.result.analysis, history);
      setKnowledgeSaveState({ status: "extracted", candidates });
    } catch (err) {
      setKnowledgeSaveState({ status: "error", message: err instanceof Error ? err.message : "知識抽出に失敗しました" });
    }
  };

  const handleSaveSelectedKnowledge = async () => {
    if (state.status !== "success" || knowledgeSaveState.status !== "extracted") return;

    const selectedCandidates = knowledgeSaveState.candidates.filter((_, i) =>
      knowledgeSelectedIndices.has(i),
    );

    if (selectedCandidates.length === 0) return;

    setKnowledgeSaveState({ status: "saving" });

    try {
      const result = await saveKnowledge(state.result.source, selectedCandidates);
      setKnowledgeSaveState({
        status: "saved",
        savedCount: result.savedCount,
        skippedCount: result.skippedCount,
      });
      setShowKnowledgePanel(false);
      setKnowledgeSelectedIndices(new Set());

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
    <div className="page">
      <h1 className="brand">
        <img className="brand-icon" src="/assets/frames/mole-icon.png" alt="" aria-hidden="true" />
        Digger
      </h1>
      <p className="tagline">興味を持ったことを深掘りし、理解を蓄積していくためのツール</p>

      <button type="button" className="link-button knowledge-list-toggle" onClick={handleToggleKnowledgeList}>
        {showKnowledgeList ? "保存済みの理解を閉じる" : "保存済みの理解を見る（テスト表示）"}
      </button>

      {showKnowledgeList && (
        <div className="knowledge-list-panel">
          {knowledgeListState.status === "loading" && <p className="section-body">読み込み中…</p>}
          {knowledgeListState.status === "error" && (
            <p className="error-message">エラー: {knowledgeListState.message}</p>
          )}
          {knowledgeListState.status === "success" && (
            <>
              {knowledgeListState.items.length === 0 ? (
                <p className="section-body">まだ保存された理解はありません。</p>
              ) : (
                <ul className="card-list">
                  {knowledgeListState.items.map((item) => (
                    <li key={item._id} className="knowledge-list-item">
                      <p className="knowledge-concept">{item.concept}</p>
                      <p className="knowledge-statement">{item.statement}</p>
                      <p className="knowledge-list-meta">
                        confidence: {item.confidence} / {new Date(item.createdAt).toLocaleString()} /{" "}
                        <a href={item.source.url} target="_blank" rel="noreferrer">
                          {item.source.title}
                        </a>
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      <form className="dig-form" onSubmit={handleSubmit}>
        <input
          className="dig-input"
          type="url"
          placeholder="https://example.com/article"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          required
        />
        <button className="dig-button" type="submit" disabled={state.status === "loading"}>
          {state.status === "loading" ? "掘っています..." : "掘る"}
        </button>
      </form>

      {state.status === "loading" && <MoleLoader label="記事を掘っています…" />}

      {state.status === "error" && <p className="error-message">エラー: {state.message}</p>}

      {state.status === "success" && analysis && (
        <article className="result">
          <header>
            <h2 className="result-title">{state.result.source.title}</h2>
            <a className="result-source-url" href={state.result.source.url} target="_blank" rel="noreferrer">
              {state.result.source.url}
            </a>
          </header>

          {!hasStartedChat && (
            <>
              <p className="intro-summary">{shortSummary}</p>

              <section className="ask-hero">
                <p className="ask-heading">この記事について、何が気になりますか？</p>

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
                  {showBackground ? "背景を閉じる" : "この記事の背景"}
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
                {showSummaryInChat ? "記事の要点を閉じる" : "記事の要点を見る"}
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
                    selectedIndices={knowledgeSelectedIndices}
                    onToggleSelect={(i) => {
                      const next = new Set(knowledgeSelectedIndices);
                      if (next.has(i)) {
                        next.delete(i);
                      } else {
                        next.add(i);
                      }
                      setKnowledgeSelectedIndices(next);
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
                <p className="success-message">
                  {knowledgeSaveState.savedCount}件の理解を保存しました
                  {knowledgeSaveState.skippedCount > 0 &&
                    `（${knowledgeSaveState.skippedCount}件は既に保存済みのためスキップしました）`}
                </p>
              )}
            </section>
          )}
        </article>
      )}
    </div>
  );
}

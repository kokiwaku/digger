import { useState } from "react";
import "./App.css";
import type { ArticleAnalysis, ConversationTurn, DeepDiveResponse, DigResult } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type DigState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: DigResult };

type ChatMessage =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; suggestedFollowUps: string[] };

type DeepDiveState = { status: "idle" } | { status: "loading" } | { status: "error"; message: string };

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

export default function App() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DigState>({ status: "idle" });

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>({ status: "idle" });
  const [revealedFollowUps, setRevealedFollowUps] = useState<Set<number>>(new Set());

  const [showHints, setShowHints] = useState(false);
  const [showBackground, setShowBackground] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "loading" });
    setMessages([]);
    setDeepDiveState({ status: "idle" });
    setRevealedFollowUps(new Set());
    setShowHints(false);
    setShowBackground(false);
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
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: response.answer, suggestedFollowUps: response.suggestedFollowUps },
      ]);
      setDeepDiveState({ status: "idle" });
    } catch (err) {
      setDeepDiveState({ status: "error", message: err instanceof Error ? err.message : "深掘りに失敗しました" });
    }
  };

  const toggleFollowUps = (index: number) => {
    setRevealedFollowUps((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const analysis = state.status === "success" ? state.result.analysis : null;
  const hasStartedChat = messages.length > 0;
  const shortSummary = analysis ? firstSentences(analysis.summary, 3) : "";
  const premiseNames = analysis?.concepts.slice(0, 4).map((c) => c.name) ?? [];

  return (
    <div className="page">
      <h1 className="brand">Digger</h1>
      <p className="tagline">興味を持ったことを深掘りし、理解を蓄積していくためのツール</p>

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

      {state.status === "loading" && <p className="loading-message">記事を読み解いています…</p>}

      {state.status === "error" && <p className="error-message">エラー: {state.message}</p>}

      {state.status === "success" && analysis && (
        <article className="result">
          <header>
            <h2 className="result-title">{state.result.source.title}</h2>
            <span className="result-source-url">{state.result.source.url}</span>
          </header>

          {!hasStartedChat && (
            <>
              <section className="primary-card">
                <h3 className="section-label">この記事について</h3>
                <p className="section-body">{shortSummary}</p>
              </section>

              {premiseNames.length > 0 && (
                <p className="premise-line">
                  <span className="premise-label">この記事の前提: </span>
                  {premiseNames.join(" ・ ")}
                </p>
              )}

              <section className="ask-hero">
                <h3 className="ask-heading">気になることを聞いてみる</h3>
                <p className="ask-subtext">この記事について、何が気になりますか？</p>

                <form
                  className="dig-form"
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleDeepDive(question);
                  }}
                >
                  <input
                    className="dig-input"
                    type="text"
                    placeholder="例: そもそも、なぜこうなるの？"
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                  />
                  <button className="dig-button" type="submit" disabled={deepDiveState.status === "loading"}>
                    {deepDiveState.status === "loading" ? "掘り下げています..." : "掘り下げる"}
                  </button>
                </form>

                {deepDiveState.status === "error" && <p className="error-message">エラー: {deepDiveState.message}</p>}

                {analysis.deepDiveQuestions.length > 0 && (
                  <div className="hint-area">
                    {!showHints ? (
                      <button type="button" className="link-button" onClick={() => setShowHints(true)}>
                        質問が浮かばないときはヒントを見る
                      </button>
                    ) : (
                      <ul className="card-list">
                        {analysis.deepDiveQuestions.map((deepDiveQuestion) => (
                          <li key={deepDiveQuestion}>
                            <button
                              type="button"
                              className="question-button"
                              disabled={deepDiveState.status === "loading"}
                              onClick={() => handleDeepDive(deepDiveQuestion)}
                            >
                              → {deepDiveQuestion}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <button type="button" className="link-button" onClick={() => setShowBackground((v) => !v)}>
                {showBackground ? "背景を閉じる" : "記事の背景を見る"}
              </button>

              {showBackground && (
                <div className="details-panel">
                  <section>
                    <h3 className="section-label">なぜ重要？</h3>
                    <p className="section-body">{analysis.whyItMatters}</p>
                  </section>

                  {analysis.concepts.length > 0 && (
                    <section>
                      <h3 className="section-label">前提知識</h3>
                      <ul className="card-list">
                        {analysis.concepts.map((concept) => (
                          <li key={concept.id} className="concept-item">
                            <p className="concept-item-title">{concept.name}</p>
                            <p className="concept-item-description">{concept.description}</p>
                          </li>
                        ))}
                      </ul>
                    </section>
                  )}

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
              <div className="chat-log">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={message.role === "user" ? "chat-bubble chat-user" : "chat-message chat-assistant"}
                  >
                    <p className="chat-content">{message.content}</p>
                    {message.role === "assistant" && message.suggestedFollowUps.length > 0 && (
                      <div className="followup-area">
                        {!revealedFollowUps.has(index) ? (
                          <button type="button" className="link-button" onClick={() => toggleFollowUps(index)}>
                            次の問いを見る
                          </button>
                        ) : (
                          <div className="followup-list">
                            {message.suggestedFollowUps.map((followUp) => (
                              <button
                                key={followUp}
                                type="button"
                                className="question-button"
                                disabled={deepDiveState.status === "loading"}
                                onClick={() => handleDeepDive(followUp)}
                              >
                                → {followUp}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {deepDiveState.status === "error" && <p className="error-message">エラー: {deepDiveState.message}</p>}

              <form
                className="dig-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  handleDeepDive(question);
                }}
              >
                <input
                  className="dig-input"
                  type="text"
                  placeholder="さらに気になることを入力..."
                  value={question}
                  onChange={(e) => setQuestion(e.target.value)}
                />
                <button className="dig-button" type="submit" disabled={deepDiveState.status === "loading"}>
                  {deepDiveState.status === "loading" ? "掘り下げています..." : "送る"}
                </button>
              </form>
            </section>
          )}
        </article>
      )}
    </div>
  );
}

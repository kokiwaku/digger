import { useState } from "react";
import "./App.css";
import type { ArticleAnalysis, Concept, ConversationTurn, DeepDiveResponse, DigResult } from "./types";

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
// summary/whyItMattersは長めに返ってくることがあるため、Primary Viewでは冒頭の
// 数文だけを切り出し、残りはSecondary Information（詳細パネル）でのみ表示する。
function firstSentences(text: string, maxSentences: number): string {
  const sentences = text.match(/[^。！？]*[。！？]|[^。！？]+$/g);
  if (!sentences) return text.trim();
  return sentences.slice(0, maxSentences).join("").trim();
}

function hasMoreText(full: string, shown: string): boolean {
  return full.trim().length > shown.trim().length;
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

// 前提知識カード。初期状態は短い1文だけを表示し、クリックすると全文を展開する
// （descriptionが1文で収まっている場合は展開の余地がないのでボタン化しない）。
function ConceptCard({ concept }: { concept: Concept }) {
  const [expanded, setExpanded] = useState(false);
  const shortDescription = firstSentences(concept.description, 1);
  const expandable = hasMoreText(concept.description, shortDescription);

  return (
    <li>
      <button
        type="button"
        className="concept-card"
        onClick={() => expandable && setExpanded((v) => !v)}
        aria-expanded={expandable ? expanded : undefined}
      >
        <p className="concept-card-title">{concept.name}</p>
        <p className="concept-card-summary">{expanded ? concept.description : shortDescription}</p>
        {expandable && <span className="card-toggle-hint">{expanded ? "閉じる" : "詳しく見る"}</span>}
      </button>
    </li>
  );
}

export default function App() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DigState>({ status: "idle" });

  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [question, setQuestion] = useState("");
  const [deepDiveState, setDeepDiveState] = useState<DeepDiveState>({ status: "idle" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "loading" });
    setMessages([]);
    setDeepDiveState({ status: "idle" });
    setDetailsExpanded(false);
    setShowAllQuestions(false);
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

  const analysis = state.status === "success" ? state.result.analysis : null;
  const requiredConcepts = analysis?.concepts.filter((c) => c.importance === "required").slice(0, 3) ?? [];
  const helpfulConcepts = analysis?.concepts.filter((c) => c.importance !== "required") ?? [];
  const [topQuestion, ...restQuestions] = analysis?.deepDiveQuestions ?? [];
  const shortSummary = analysis ? firstSentences(analysis.summary, 3) : "";
  const shortWhyItMatters = analysis ? firstSentences(analysis.whyItMatters, 1) : "";
  const hasSecondaryInfo =
    analysis !== null &&
    (hasMoreText(analysis.whyItMatters, shortWhyItMatters) ||
      helpfulConcepts.length > 0 ||
      analysis.connections.length > 0 ||
      analysis.entities.length > 0);

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

          <section className="primary-card">
            <h3 className="section-label">この記事で大事なのは</h3>
            <p className="section-body">{shortSummary}</p>
            {shortWhyItMatters && <p className="section-subtle">なぜ重要？ {shortWhyItMatters}</p>}
          </section>

          {requiredConcepts.length > 0 && (
            <section>
              <h3 className="section-label">まず知っておくこと</h3>
              <ul className="card-list">
                {requiredConcepts.map((concept) => (
                  <ConceptCard key={concept.id} concept={concept} />
                ))}
              </ul>
            </section>
          )}

          {topQuestion && (
            <section>
              <h3 className="section-label">次に掘るなら</h3>
              <ul className="card-list">
                <li>
                  <button
                    type="button"
                    className="question-button"
                    disabled={deepDiveState.status === "loading"}
                    onClick={() => handleDeepDive(topQuestion)}
                  >
                    → {topQuestion}
                  </button>
                </li>
              </ul>
              {restQuestions.length > 0 && !showAllQuestions && (
                <button type="button" className="link-button" onClick={() => setShowAllQuestions(true)}>
                  他の質問を見る（{restQuestions.length}件）
                </button>
              )}
              {showAllQuestions && (
                <ul className="card-list">
                  {restQuestions.map((deepDiveQuestion) => (
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
            </section>
          )}

          {hasSecondaryInfo && !detailsExpanded && (
            <button type="button" className="link-button" onClick={() => setDetailsExpanded(true)}>
              もう少し詳しく見る
            </button>
          )}

          {hasSecondaryInfo && detailsExpanded && (
            <div className="details-panel">
              <button type="button" className="link-button" onClick={() => setDetailsExpanded(false)}>
                詳細を閉じる
              </button>

              <section>
                <h3 className="section-label">なぜ重要？</h3>
                <p className="section-body">{analysis.whyItMatters}</p>
              </section>

              {helpfulConcepts.length > 0 && (
                <section>
                  <h3 className="section-label">知っているとさらに理解が深まること</h3>
                  <ul className="card-list">
                    {helpfulConcepts.map((concept) => (
                      <ConceptCard key={concept.id} concept={concept} />
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

          <section className="deep-dive">
            <h3 className="section-label">他に気になることは？</h3>

            {messages.length > 0 && (
              <div className="chat-log">
                {messages.map((message, index) => (
                  <div
                    key={index}
                    className={message.role === "user" ? "chat-bubble chat-user" : "chat-bubble chat-assistant"}
                  >
                    <p className="chat-role">{message.role === "user" ? "User" : "Digger"}</p>
                    <p className="chat-content">{message.content}</p>
                    {message.role === "assistant" && message.suggestedFollowUps.length > 0 && (
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
                ))}
              </div>
            )}

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
                placeholder="自由に入力してください"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
              />
              <button className="dig-button" type="submit" disabled={deepDiveState.status === "loading"}>
                {deepDiveState.status === "loading" ? "掘り下げています..." : "掘り下げる"}
              </button>
            </form>
          </section>
        </article>
      )}
    </div>
  );
}

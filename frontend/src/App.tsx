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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "loading" });
    setMessages([]);
    setDeepDiveState({ status: "idle" });
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

      {state.status === "error" && <p className="error-message">エラー: {state.message}</p>}

      {state.status === "success" && (
        <article className="result">
          <header>
            <h2 className="result-title">{state.result.source.title}</h2>
            <span className="result-source-url">{state.result.source.url}</span>
          </header>

          <section>
            <h3 className="section-label">まずこれだけ</h3>
            <p className="section-body">{state.result.analysis.summary}</p>
          </section>

          <section>
            <h3 className="section-label">なぜ重要？</h3>
            <p className="section-body">{state.result.analysis.whyItMatters}</p>
          </section>

          <section>
            <h3 className="section-label">理解するための前提</h3>
            <ul className="card-list">
              {state.result.analysis.concepts.map((concept) => (
                <li key={concept.id}>
                  <button type="button" className="concept-card">
                    <p className="concept-card-title">{concept.name}</p>
                    <p className="concept-card-summary">{concept.description}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="section-label">この話とのつながり</h3>
            <ul className="connection-list">
              {state.result.analysis.connections.map((connection) => (
                <li key={connection.topic} className="connection-item">
                  <p className="connection-topic">{connection.topic}</p>
                  <p className="connection-relation">→ {connection.relation}</p>
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h3 className="section-label">次に掘るなら</h3>
            <ul className="card-list">
              {state.result.analysis.deepDiveQuestions.map((deepDiveQuestion) => (
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
          </section>

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

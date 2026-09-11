import { useState } from "react";
import "./App.css";
import type { DigResult } from "./types";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type DigState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "success"; result: DigResult };

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

export default function App() {
  const [url, setUrl] = useState("");
  const [state, setState] = useState<DigState>({ status: "idle" });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setState({ status: "loading" });
    try {
      const result = await digUrl(url);
      setState({ status: "success", result });
    } catch (err) {
      setState({ status: "error", message: err instanceof Error ? err.message : "掘れませんでした" });
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
            <h3 className="section-label">要約</h3>
            <p className="section-body">{state.result.summary}</p>
          </section>

          <section>
            <h3 className="section-label">なぜ重要か</h3>
            <p className="section-body">{state.result.whyItMatters}</p>
          </section>

          <section>
            <h3 className="section-label">理解するための前提知識</h3>
            <ul className="knowledge-list">
              {state.result.backgroundKnowledge.map((knowledge) => (
                <li key={knowledge.id}>
                  <button type="button" className="knowledge-card">
                    <p className="knowledge-card-title">{knowledge.title}</p>
                    <p className="knowledge-card-summary">{knowledge.summary}</p>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        </article>
      )}
    </div>
  );
}

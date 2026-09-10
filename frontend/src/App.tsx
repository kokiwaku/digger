import { useEffect, useState } from "react";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8787";

type ApiStatus = {
  loading: boolean;
  data: unknown;
  error: string | null;
};

function useApiCheck(path: string): ApiStatus {
  const [state, setState] = useState<ApiStatus>({ loading: true, data: null, error: null });

  useEffect(() => {
    let cancelled = false;

    fetch(`${API_BASE_URL}${path}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data) => {
        if (!cancelled) setState({ loading: false, data, error: null });
      })
      .catch((err: Error) => {
        if (!cancelled) setState({ loading: false, data: null, error: err.message });
      });

    return () => {
      cancelled = true;
    };
  }, [path]);

  return state;
}

function StatusCard({ title, status }: { title: string; status: ApiStatus }) {
  return (
    <div style={{ border: "1px solid #ccc", borderRadius: 8, padding: "1rem", minWidth: 280 }}>
      <h3>{title}</h3>
      {status.loading && <p>確認中...</p>}
      {status.error && <p style={{ color: "crimson" }}>エラー: {status.error}</p>}
      {status.data !== null && (
        <pre style={{ background: "#f5f5f5", padding: "0.5rem", overflowX: "auto" }}>
          {JSON.stringify(status.data, null, 2)}
        </pre>
      )}
    </div>
  );
}

export default function App() {
  const health = useApiCheck("/api/health");
  const dbHealth = useApiCheck("/api/health/db");

  return (
    <div style={{ fontFamily: "sans-serif", padding: "2rem", maxWidth: 720, margin: "0 auto" }}>
      <h1>Digger</h1>
      <p>興味を持ったことを深掘りし、理解を蓄積していくためのサービス基盤です。</p>
      <div style={{ display: "flex", gap: "1rem", flexWrap: "wrap" }}>
        <StatusCard title="React → Hono 疎通確認" status={health} />
        <StatusCard title="Hono → MongoDB 接続確認" status={dbHealth} />
      </div>
    </div>
  );
}

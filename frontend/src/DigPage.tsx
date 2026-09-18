import { useEffect, useRef, useState } from "react";
import type { DigResult } from "./types";
import { sourceDisplayTitle } from "./sourceLabel";
import DeepDiveSession, { MoleLoader } from "./DeepDiveSession";

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

export default function DigPage() {
  const [composerText, setComposerText] = useState("");
  const [composerImage, setComposerImage] = useState<ComposerImage | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [pendingKind, setPendingKind] = useState<InputKind>("text");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<DigState>({ status: "idle" });

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

      {state.status === "success" && (
        <DeepDiveSession
          analysis={state.result.analysis}
          source={state.result.source}
          header={
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
          }
        />
      )}
    </div>
  );
}

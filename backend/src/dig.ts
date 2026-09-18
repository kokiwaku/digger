import { fetchArticle } from "./articleFetcher.js";
import { getArticleAnalysisService } from "./llm/articleAnalysisFactory.js";
import type { DigResult } from "./types.js";

// Diggerは「URLを入れること」自体を価値にしない。ユーザーが気になったものを、
// URL・テキスト貼り付け・画像のいずれの形でも同じ「掘る」体験へ流し込めるよう、
// リクエストボディを共通のInputSourceへ正規化してから、種別ごとの取得・検証を行う。
export type InputSource =
  | { type: "url"; url: string }
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string; caption?: string };

export type DigInputStatus = 400 | 413;

export class DigInputError extends Error {
  readonly status: DigInputStatus;

  constructor(message: string, status: DigInputStatus = 400) {
    super(message);
    this.status = status;
  }
}

// テキスト入力の上限。articleAnalysis.vertex.tsのMAX_CONTENT_LENGTH（12,000文字）で
// 最終的にtruncateされるが、それとは別に「そもそも受け付けない」ラインとして、
// 濫用防止のため大きめの上限を設ける（記事本文の貼り付け程度は十分収まる想定）。
export const MAX_TEXT_INPUT_LENGTH = 50_000;

export const ALLOWED_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
// 5〜10MB程度を上限候補にする、という指示に沿って8MBとする。
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// URLかどうかは「URLとして妥当かどうか」で判定する。誤判定を避けるため、
// 空白を含む文字列（＝自由なテキストである可能性が高い）は一律テキスト扱いにする
// （URLに空白は含まれ得ないため、これだけで大半の誤判定を防げる）。
function looksLikeUrl(trimmed: string): boolean {
  if (trimmed.length === 0 || /\s/.test(trimmed)) return false;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function parseArticleUrl(rawUrl: unknown): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim() === "") {
    throw new Error("url is required");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new Error("url is not a valid URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("url must use http or https");
  }

  return parsed;
}

// data URL（"data:image/png;base64,...."）で送られてきた場合はprefixを取り除く。
// frontendはFileReader.readAsDataURL()で読み込むのが最も簡単なため、この形式を許容する。
function stripDataUrlPrefix(data: string): string {
  const match = /^data:[^;]+;base64,(.+)$/s.exec(data);
  return match ? match[1] : data;
}

function parseImageInput(raw: unknown, caption: string | undefined): InputSource {
  if (!raw || typeof raw !== "object") {
    throw new DigInputError("画像データを確認してください");
  }
  const { data, mimeType } = raw as { data?: unknown; mimeType?: unknown };

  if (typeof mimeType !== "string" || !ALLOWED_IMAGE_MIME_TYPES.has(mimeType)) {
    throw new DigInputError("対応していない画像形式です（JPEG・PNG・WebPのみ対応しています）");
  }
  if (typeof data !== "string" || data.trim().length === 0) {
    throw new DigInputError("画像データを確認してください");
  }

  const base64 = stripDataUrlPrefix(data.trim());
  // 概算のバイトサイズ（base64は元データの約4/3の長さになる）。
  const approxBytes = Math.floor((base64.length * 3) / 4);
  if (approxBytes > MAX_IMAGE_BYTES) {
    throw new DigInputError(
      `画像サイズが大きすぎます（${Math.round(MAX_IMAGE_BYTES / (1024 * 1024))}MB以下にしてください）`,
      413,
    );
  }

  return { type: "image", data: base64, mimeType, caption: caption?.trim() || undefined };
}

// フロントエンドはComposer（1つの入力欄＋画像添付ボタン）から送るため、リクエストボディは
// 「inputという1つの文字列」と「任意のimage」という単純な形にしている。typeをユーザーに
// 選ばせる必要はなく、ここでURL/テキストを自動判定する（画像が添付されていれば常にimage、
// テキストがあればcaptionとして添える）。
export function resolveInputSource(body: unknown): InputSource {
  if (!body || typeof body !== "object") {
    throw new DigInputError("入力を確認してください");
  }
  const b = body as { input?: unknown; url?: unknown; image?: unknown };

  // 後方互換: 以前の{ url: "..." }という形のリクエストもそのまま受け付ける。
  const rawInput = typeof b.input === "string" ? b.input : typeof b.url === "string" ? b.url : undefined;

  if (b.image !== undefined && b.image !== null) {
    return parseImageInput(b.image, rawInput);
  }

  if (typeof rawInput !== "string" || rawInput.trim().length === 0) {
    throw new DigInputError("URL、文章、または画像のいずれかを入力してください");
  }

  const trimmed = rawInput.trim();
  if (looksLikeUrl(trimmed)) {
    return { type: "url", url: trimmed };
  }

  if (trimmed.length > MAX_TEXT_INPUT_LENGTH) {
    throw new DigInputError(
      `テキストが長すぎます（${MAX_TEXT_INPUT_LENGTH.toLocaleString()}文字以下にしてください）`,
    );
  }

  return { type: "text", text: trimmed };
}

// 記事の取得・本文抽出は articleFetcher.ts が担当し、Article Analysis（LLM処理。LLM_PROVIDERで
// mock/vertexを切り替え）が summary/whyItMatters/concepts/entities/connections/deepDiveQuestions
// を生成する。ユーザーの知識・履歴は渡さない（Personalized AnalysisはArticle Analysisの後段の別処理）。
// URL/テキスト/画像のいずれの入力でも、最終的にはこの同じDigResult（source + analysis）へ
// たどり着く。Deep Dive・Knowledge Extraction・Understanding Mapは入力形式を意識しない。
export async function buildDigResult(input: InputSource): Promise<DigResult> {
  if (input.type === "url") {
    const url = parseArticleUrl(input.url);
    const article = await fetchArticle(url);
    const analysis = await getArticleAnalysisService().analyze({
      title: article.title,
      url: url.toString(),
      content: article.textContent,
    });
    return {
      source: { type: "web_article", url: url.toString(), title: article.title },
      analysis,
    };
  }

  if (input.type === "text") {
    const analysis = await getArticleAnalysisService().analyze({ content: input.text });
    return { source: { type: "text" }, analysis };
  }

  const analysis = await getArticleAnalysisService().analyze({
    image: { data: input.data, mimeType: input.mimeType },
    // 画像に添えられた自由入力があれば、解析の補足コンテキストとして渡す。
    content: input.caption,
  });
  return { source: { type: "image" }, analysis };
}

import type { DigSource } from "./types";

// URLを持たないsource（text/image）にはtitleが無いことがあるため、その場合の
// fallback表示をここに集約する（複数箇所で同じ判定を書かないため）。
export function sourceDisplayTitle(source: DigSource): string {
  if (source.type === "web_article") return source.title;
  if (source.title) return source.title;
  return source.type === "text" ? "テキスト入力" : "画像入力";
}

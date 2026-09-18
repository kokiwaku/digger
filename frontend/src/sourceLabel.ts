import type { DigSource } from "./types";

// URLを持たないsource（text/image/concept_dig/topic_dig）にはtitleが無いことがあるため、
// その場合のfallback表示をここに集約する（複数箇所で同じ判定を書かないため）。
export function sourceDisplayTitle(source: DigSource): string {
  if (source.type === "web_article") return source.title;
  if (source.type === "concept_dig") return source.title ? `「${source.title}」を掘った理解` : "概念から掘った理解";
  if (source.type === "topic_dig") return source.title ? `「${source.title}」を掘った理解` : "トピックから掘った理解";
  if (source.title) return source.title;
  return source.type === "text" ? "テキスト入力" : "画像入力";
}

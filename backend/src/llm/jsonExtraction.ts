// LLMがresponseMimeType=application/jsonを指定していても、稀にmarkdownのコード
// フェンスで出力を囲むことがあるため、その場合は中身を取り出してからJSON.parseする。
// Article Analysis / Deep Dive の両方の実LLM実装で共通して使う小さなユーティリティ。
export function extractJsonText(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fenced ? fenced[1] : text).trim();
}

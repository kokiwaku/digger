// LLMプロバイダーの共通interface。ArticleAnalysisService等の各処理は、
// このinterfaceだけに依存し、Vertex AI/Geminiなど特定プロバイダーのSDKには
// 直接依存しない（provider固有コードはこの下の実装ファイルに閉じ込める）。

// マルチモーダル入力（画像）の1パート。過剰な抽象化はせず、今回必要な「base64画像1枚」
// だけを表現する最小限の形にする（将来pdf/audio/video等を追加する場合はこの型を
// 判別可能なユニオンへ拡張する余地がある）。
export type GenerateTextImageInput = {
  data: string; // base64エンコードされた画像データ（data URLのprefixは含まない）
  mimeType: string;
};

export type GenerateTextInput = {
  systemPrompt?: string;
  prompt: string;
  // 構造化出力を要求する場合の標準JSON Schema。JSON Schema自体はベンダー中立な仕様であり、
  // 対応していないproviderはこのフィールドを無視してよい（例: MockLlmProvider）。
  responseJsonSchema?: Record<string, unknown>;
  // マルチモーダル入力に対応するproviderはこの画像もあわせてLLMへ送る。対応しない
  // provider（MockLlmProvider等）はこのフィールドを無視してよい。
  images?: GenerateTextImageInput[];
};

export interface LlmProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}

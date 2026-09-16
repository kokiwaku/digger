// LLMプロバイダーの共通interface。ArticleAnalysisService等の各処理は、
// このinterfaceだけに依存し、Vertex AI/Geminiなど特定プロバイダーのSDKには
// 直接依存しない（provider固有コードはこの下の実装ファイルに閉じ込める）。

export type GenerateTextInput = {
  systemPrompt?: string;
  prompt: string;
  // 構造化出力を要求する場合の標準JSON Schema。JSON Schema自体はベンダー中立な仕様であり、
  // 対応していないproviderはこのフィールドを無視してよい（例: MockLlmProvider）。
  responseJsonSchema?: Record<string, unknown>;
};

export interface LlmProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}

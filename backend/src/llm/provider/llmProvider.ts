// LLMプロバイダーの共通interface。ArticleAnalysisService等の各処理は、
// このinterfaceだけに依存し、Vertex AI/Geminiなど特定プロバイダーのSDKには
// 直接依存しない（provider固有コードはこの下の実装ファイルに閉じ込める）。

export type GenerateTextInput = {
  systemPrompt?: string;
  prompt: string;
};

export interface LlmProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}

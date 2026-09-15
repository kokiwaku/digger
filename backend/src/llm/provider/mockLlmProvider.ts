import type { GenerateTextInput, LlmProvider } from "./llmProvider.js";

// 実際のLLMを呼ばず、受け取ったプロンプトをそのまま埋め込んだ固定文言を返すだけの実装。
// LLM_PROVIDER=mock（デフォルト）のときに使われる。
export class MockLlmProvider implements LlmProvider {
  async generateText(input: GenerateTextInput): Promise<string> {
    return `（モックLLM応答）「${input.prompt}」というプロンプトを受け取りました。実際のLLMサービスにはまだ接続されていません。`;
  }
}

import { deepDiveInputSchema, type DeepDiveInput, type DeepDiveResponse } from "./llm/deepDive.js";
// LLMの実装を差し替えるときは、このimportを本物の実装に変えるだけでよい
// （DeepDiveServiceインターフェースは変わらない想定）。
import { mockDeepDiveService as deepDiveService } from "./llm/deepDive.mock.js";

export function parseDeepDiveInput(body: unknown): DeepDiveInput {
  const result = deepDiveInputSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

export async function buildDeepDiveResponse(input: DeepDiveInput): Promise<DeepDiveResponse> {
  return deepDiveService.ask(input);
}

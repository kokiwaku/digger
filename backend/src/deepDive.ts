import { deepDiveInputSchema, type DeepDiveInput, type DeepDiveResponse } from "./llm/deepDive.js";
import { getDeepDiveService } from "./llm/deepDiveFactory.js";

export function parseDeepDiveInput(body: unknown): DeepDiveInput {
  const result = deepDiveInputSchema.safeParse(body);
  if (!result.success) {
    throw new Error(result.error.issues[0]?.message ?? "invalid request");
  }
  return result.data;
}

export async function buildDeepDiveResponse(input: DeepDiveInput): Promise<DeepDiveResponse> {
  return getDeepDiveService().ask(input);
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { createVertexDeepDiveService } from "./deepDive.vertex.js";
import { LlmProviderError } from "./provider/llmProviderError.js";
import type { LlmProvider, GenerateTextInput } from "./provider/llmProvider.js";
import type { ArticleAnalysis } from "./articleAnalysis.js";
import type { ConversationTurn } from "./conversation.js";
import type { UserKnowledge } from "./personalizedAnalysis.js";
import type { DeepDiveMemoryItem } from "./deepDive.js";

const ARTICLE_ANALYSIS: ArticleAnalysis = {
  summary: "テスト用の要約です。",
  whyItMatters: "テスト用の重要性の説明です。",
  concepts: [
    { id: "concept-1", name: "テスト概念", description: "説明", importance: "required" },
  ],
  entities: [{ name: "テスト組織", type: "organization", description: "説明" }],
  connections: [{ topic: "関連トピック", relation: "関連の説明" }],
  deepDiveQuestions: ["なぜ？", "どういう仕組み？", "誰にどう影響する？"],
};

const VALID_RESPONSE = {
  answer: "テスト用の回答です。",
  relatedConcepts: [{ name: "テスト概念", relation: "今回の質問の前提となる概念だから" }],
  suggestedFollowUps: ["次に掘るならこの問い？", "もう一つの問い？"],
};

function baseInput(
  overrides: Partial<{
    question: string;
    conversationHistory: ConversationTurn[];
    userKnowledge: UserKnowledge[];
    relevantMemory: DeepDiveMemoryItem[];
  }> = {},
) {
  return {
    articleAnalysis: ARTICLE_ANALYSIS,
    question: "なぜこれが起きたの？",
    conversationHistory: [],
    ...overrides,
  };
}

function fakeProvider(generateText: LlmProvider["generateText"]): LlmProvider {
  return { generateText };
}

test("ask() returns validated data when the LLM returns valid JSON on the first try", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const result = await service.ask(baseInput());

  assert.deepEqual(result, VALID_RESPONSE);
  assert.equal(callCount, 1);
});

test("ask() retries once when the first response fails JSON parsing, then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    if (callCount === 1) return "this is not JSON";
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const result = await service.ask(baseInput());

  assert.deepEqual(result, VALID_RESPONSE);
  assert.equal(callCount, 2);
});

test("ask() retries once when the first response fails schema validation, then succeeds", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    // relatedConceptsが古い(string[])形式で返ってきたケースを想定
    if (callCount === 1) return JSON.stringify({ ...VALID_RESPONSE, relatedConcepts: ["テスト概念"] });
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const result = await service.ask(baseInput());

  assert.deepEqual(result, VALID_RESPONSE);
  assert.equal(callCount, 2);
});

test("ask() throws after the retry also fails schema validation", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    return "still not JSON";
  });

  const service = createVertexDeepDiveService(() => provider);

  await assert.rejects(
    () => service.ask(baseInput()),
    (err: unknown) => err instanceof LlmProviderError,
  );
  assert.equal(callCount, 2);
});

test("ask() propagates an LLM provider error immediately without retrying", async () => {
  let callCount = 0;
  const provider = fakeProvider(async () => {
    callCount++;
    throw new LlmProviderError("timed out", "timeout");
  });

  const service = createVertexDeepDiveService(() => provider);

  await assert.rejects(
    () => service.ask(baseInput()),
    (err: unknown) => err instanceof LlmProviderError && err.code === "timeout",
  );
  assert.equal(callCount, 1);
});

test("ask() includes the question and conversation history in the prompt sent to the provider", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const history: ConversationTurn[] = [
    { role: "user", content: "以前の質問です" },
    { role: "assistant", content: "以前の回答です" },
  ];
  await service.ask(baseInput({ question: "今回の質問です", conversationHistory: history }));

  assert.ok(capturedInput);
  assert.match(capturedInput.prompt, /今回の質問です/);
  assert.match(capturedInput.prompt, /以前の質問です/);
  assert.match(capturedInput.prompt, /以前の回答です/);
});

test("ask() truncates conversation history beyond the safe limit, dropping the oldest messages", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const longHistory: ConversationTurn[] = Array.from({ length: 25 }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `メッセージ${i}`,
  }));
  await service.ask(baseInput({ conversationHistory: longHistory }));

  assert.ok(capturedInput);
  assert.doesNotMatch(capturedInput.prompt, /メッセージ0(?!\d)/);
  assert.match(capturedInput.prompt, /メッセージ24/);
});

test("ask() works when userKnowledge is not provided", async () => {
  const provider = fakeProvider(async () => JSON.stringify(VALID_RESPONSE));
  const service = createVertexDeepDiveService(() => provider);

  const result = await service.ask(baseInput());
  assert.deepEqual(result, VALID_RESPONSE);
});

test("ask() includes selected userKnowledge in the prompt when provided", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const userKnowledge: UserKnowledge[] = [
    { id: "k1", concept: "政策金利", statement: "政策金利の変更は市場金利や貸出金利に波及しうる" },
  ];
  await service.ask(baseInput({ userKnowledge }));

  assert.ok(capturedInput);
  assert.match(capturedInput.prompt, /政策金利の変更は市場金利や貸出金利に波及しうる/);
});

test("ask() omits the past-understanding section entirely when userKnowledge is empty", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput({ userKnowledge: [] }));

  assert.ok(capturedInput);
  assert.doesNotMatch(capturedInput.prompt, /過去の会話で理解したと確認済み/);
});

test("ask() prompt discourages forcing a mention of past understanding in every answer", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const userKnowledge: UserKnowledge[] = [
    { id: "k1", concept: "政策金利", statement: "政策金利の変更は市場金利や貸出金利に波及しうる" },
  ];
  await service.ask(baseInput({ userKnowledge }));

  assert.ok(capturedInput);
  // 「毎回答で無理に既存理解へ言及する」ことを求める指示になっていないことの確認。
  assert.match(capturedInput.prompt, /毎回答で繰り返す必要はありません/);
  assert.doesNotMatch(capturedInput.prompt, /必ず.*言及/);
});

test("ask() system prompt defines length guidance per question type", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  // 単純な事実質問
  assert.match(capturedInput.systemPrompt ?? "", /150〜300文字程度/);
  // 因果関係・仕組みの質問
  assert.match(capturedInput.systemPrompt ?? "", /300〜500文字程度/);
  assert.match(capturedInput.systemPrompt ?? "", /3〜5段落程度/);
  // 詳細要求（明示的に求められた場合のみ長くしてよい）
  assert.match(capturedInput.systemPrompt ?? "", /詳細要求/);
  assert.match(capturedInput.systemPrompt ?? "", /求められた分だけ詳しく説明してよい/);
});

test("ask() prompt tells the model to stay within the scope of the question and leave room for follow-ups", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  assert.match(capturedInput.systemPrompt ?? "", /質問された範囲を超えて説明を広げすぎない/);
  assert.match(capturedInput.systemPrompt ?? "", /次の疑問が自然に生まれる余白を残す/);
  assert.match(capturedInput.prompt, /質問された範囲を超えて周辺知識や背景まで広げすぎない/);
});

test("ask() prompt prioritizes a sufficient answer over a detailed one, without blurring information for brevity", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  assert.match(capturedInput.systemPrompt ?? "", /「詳しい回答」より「今の疑問にちょうどよく答える」ことを優先/);
  assert.match(capturedInput.systemPrompt ?? "", /短くするために情報を曖昧にしない/);
});

test("ask() system prompt explicitly permits recommendations/comparisons/candidates and forbids the old refusal framing", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  const systemPrompt = capturedInput.systemPrompt ?? "";
  assert.match(systemPrompt, /候補を探す/);
  assert.match(systemPrompt, /比較する/);
  assert.match(systemPrompt, /ユーザーが具体的な候補・比較・おすすめ・ランキングを求めた場合は、それを拒否せず直接答えてください/);
  assert.match(systemPrompt, /Digger側がどの掘り方だけを許可するかを決めつけないでください/);
});

test("ask() system prompt distinguishes objective info / general tendency / preference-based recommendation / uncertain speculation", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  const systemPrompt = capturedInput.systemPrompt ?? "";
  assert.match(systemPrompt, /客観情報/);
  assert.match(systemPrompt, /一般的傾向/);
  assert.match(systemPrompt, /ユーザー条件からの推奨/);
  assert.match(systemPrompt, /不確実な推測/);
});

test("ask() system prompt tells the model not to assert time-sensitive info (rankings/prices/latest news) as current without web search", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  const systemPrompt = capturedInput.systemPrompt ?? "";
  assert.match(systemPrompt, /Web検索機能を持たない/);
  assert.match(systemPrompt, /最新の事実であるかのように断定しないでください/);
});

test("ask() system prompt adds a candidate/comparison/recommendation question-type guidance that answers first without a long preamble", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput());

  assert.ok(capturedInput);
  assert.match(capturedInput.systemPrompt ?? "", /候補・比較・推薦の質問/);
  assert.match(capturedInput.prompt, /候補・比較・推薦を求められた場合はDigger側の役割を理由に断らず/);
});

test("ask() includes relevantMemory (preference/candidate/decision/open_question) in the prompt when provided", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const relevantMemory: DeepDiveMemoryItem[] = [
    { type: "preference", content: "子供2人が酔いづらいことを重視する" },
    { type: "candidate", title: "トヨタ RAV4", content: "トヨタ RAV4", metadata: { reasons: ["後席が広い", "国産"] } },
    { type: "decision", content: "RAV4とフォレスターを比較する" },
  ];
  await service.ask(baseInput({ question: "SUVを5台候補にして", relevantMemory }));

  assert.ok(capturedInput);
  assert.match(capturedInput.prompt, /子供2人が酔いづらいことを重視する/);
  assert.match(capturedInput.prompt, /トヨタ RAV4/);
  assert.match(capturedInput.prompt, /後席が広い、国産/);
  assert.match(capturedInput.prompt, /RAV4とフォレスターを比較する/);
});

test("ask() omits the relevant-memory section entirely when relevantMemory is empty/undefined", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  await service.ask(baseInput({ relevantMemory: [] }));

  assert.ok(capturedInput);
  assert.doesNotMatch(capturedInput.prompt, /検討候補・決めたこと・未解決の疑問/);
});

test("ask() prompt does not force mentioning relevant memory in every answer", async () => {
  let capturedInput: GenerateTextInput | undefined;
  const provider = fakeProvider(async (input) => {
    capturedInput = input;
    return JSON.stringify(VALID_RESPONSE);
  });

  const service = createVertexDeepDiveService(() => provider);
  const relevantMemory: DeepDiveMemoryItem[] = [{ type: "preference", content: "国産車を優先したい" }];
  await service.ask(baseInput({ relevantMemory }));

  assert.ok(capturedInput);
  assert.match(capturedInput.prompt, /自然に反映するだけで構いません/);
});

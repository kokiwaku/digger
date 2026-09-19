import { randomUUID } from "node:crypto";
import { memoryExtractionResultSchema, type MemoryExtractionService } from "./memoryExtraction.js";

// モック実装: 対話内容は解析せず、5種類のtypeを一通り含む固定候補を返す
// （UI側でtype別グループ表示を確認できるようにするため）。
export const mockMemoryExtractionService: MemoryExtractionService = {
  async extract() {
    const result = {
      candidates: [
        {
          id: randomUUID(),
          type: "knowledge" as const,
          title: "政策金利",
          content: "政策金利の変更は市場金利や銀行の貸出金利に波及しうる",
          reason: "ユーザーが利上げと住宅ローンの関係を自分の言葉で確認した",
          confidence: "high" as const,
        },
        {
          id: randomUUID(),
          type: "preference" as const,
          content: "国産車を優先したい",
          reason: "ユーザーが明示的に発言した",
          confidence: "high" as const,
        },
        {
          id: randomUUID(),
          type: "candidate" as const,
          title: "トヨタ RAV4",
          content: "トヨタ RAV4",
          reason: "ユーザーが「RAV4良さそう」と発言した",
          metadata: { reasons: ["後席が広い", "国産"] },
          confidence: "medium" as const,
        },
      ],
    };

    return memoryExtractionResultSchema.parse(result);
  },
};

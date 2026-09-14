import {
  personalizedAnalysisSchema,
  type PersonalizedAnalysis,
  type PersonalizedAnalysisService,
} from "./personalizedAnalysis.js";

// モック実装: 本物のLLMは呼ばず、concept名の単純な文字列一致だけで
// 「既知/未知」を振り分ける。実際のLLM実装では、この一致判定と説明文の生成を
// LLMに委ねることになる（インターフェースの入出力形式は変えない）。
export const mockPersonalizedAnalysisService: PersonalizedAnalysisService = {
  async analyze(input) {
    const knownConceptNames = new Set(
      input.userKnowledge.map((knowledge) => knowledge.concept.trim().toLowerCase()),
    );

    const alreadyKnown: string[] = [];
    const needsExplanation: PersonalizedAnalysis["needsExplanation"] = [];

    for (const concept of input.articleAnalysis.concepts) {
      if (knownConceptNames.has(concept.name.trim().toLowerCase())) {
        alreadyKnown.push(concept.name);
      } else {
        needsExplanation.push({
          conceptId: concept.id,
          reason: `「${concept.name}」についての学習履歴が見当たらないため`,
        });
      }
    }

    const relatedPastKnowledge = input.userKnowledge
      .filter((knowledge) => alreadyKnown.includes(knowledge.concept))
      .map((knowledge) => ({
        knowledgeId: knowledge.id,
        reason: `過去に学習した「${knowledge.concept}」の知識が今回の理解に関連するため`,
      }));

    const personalizedExplanation =
      needsExplanation.length > 0
        ? "今回は前提知識のうち未学習のものを中心に説明します。（モック応答）"
        : "この記事の前提知識はすでに学習済みのようです。（モック応答）";

    const suggestedQuestions = input.articleAnalysis.deepDiveQuestions.map((question) => ({
      question,
      reason: "記事の解析結果から示唆される深掘りの問いです。（モック応答）",
    }));

    const result = {
      alreadyKnown,
      needsExplanation,
      relatedPastKnowledge,
      personalizedExplanation,
      suggestedQuestions,
    };

    return personalizedAnalysisSchema.parse(result);
  },
};

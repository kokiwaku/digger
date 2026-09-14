import { articleAnalysisSchema, type ArticleAnalysisService } from "./articleAnalysis.js";

// モック実装: 実際の記事内容(input)には依存せず、デモとして分かりやすい固定のサンプル
// （日銀の利上げ）を返す。実装差し替え時は、この関数の中身をLLM呼び出し＋
// articleAnalysisSchema.parse(...) に置き換えるだけでよい（インターフェースは変わらない）。
export const mockArticleAnalysisService: ArticleAnalysisService = {
  async analyze() {
    const result = {
      summary:
        "この記事では日本銀行が政策金利の引き上げを決定したことが報じられています。長期間続いた低金利政策からの転換点であり、住宅ローンや企業の資金調達コストへの影響が注目されています。",
      whyItMatters:
        "金利の変化は物価・為替・家計や企業の資金繰りなど経済全体に波及するため、今回の利上げは今後の日本経済の方向性を左右する重要な転換点だからです。",
      concepts: [
        {
          id: "concept-policy-rate",
          name: "政策金利",
          description: "中央銀行が金融政策の手段として設定する基準となる金利。",
          importance: "required" as const,
        },
        {
          id: "concept-rate-gap",
          name: "日米金利差",
          description: "日本と米国の金利の差。為替レートに影響を与える要因の一つ。",
          importance: "helpful" as const,
        },
      ],
      entities: [
        {
          name: "日本銀行",
          type: "organization" as const,
          description: "日本の中央銀行。金融政策の決定を行う。",
        },
        {
          name: "植田和男",
          type: "person" as const,
          description: "日本銀行総裁。",
        },
      ],
      connections: [
        {
          topic: "円安",
          relation: "金利差を通じて為替に影響する",
        },
      ],
      deepDiveQuestions: [
        "なぜ利上げすると円高になりやすい？",
        "住宅ローンにはいつ影響する？",
        "日本はなぜ今まで金利を上げなかった？",
      ],
    };

    return articleAnalysisSchema.parse(result);
  },
};

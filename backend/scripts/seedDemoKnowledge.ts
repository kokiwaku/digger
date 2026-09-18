// 「自分の理解」ページ（最近／トピック／マップ）を、実際に何十件も記事を掘らなくても
// それらしいボリュームで確認できるようにするための開発用シードスクリプト。
// 実行: npm run seed:demo （backendコンテナ内、またはMONGODB_URIが到達可能なローカル環境で）
// 既存のKnowledgeを全部消してから入れ直したい場合: RESET_DEMO_KNOWLEDGE=1 npm run seed:demo
//
// 実際のdig→深掘り→Knowledge Extractionのフローは通さず、user_knowledgeコレクションへ
// 直接投入する。topicPathは意図的に付与しない（GET /api/knowledgeが呼ばれた際に
// assignTopicsToUnclassified()がまとめて1回のLLM呼び出しで分類する、既存の遅延分類の
// 仕組みをそのまま使うため）。
import { ObjectId } from "mongodb";
import { getMongoClient } from "../src/db.js";
import { FIXED_USER_ID } from "../src/knowledge.js";

const MONGODB_DB_NAME = process.env.MONGODB_DB_NAME ?? "digger";
const KNOWLEDGE_COLLECTION = "user_knowledge";

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// 実行のたびに同じ_idになるよう、ランダムではなく連番から決定的に生成する
// （再実行してもレコードが重複せず、relationsOutの参照先も安定する）。
function demoId(seq: number): ObjectId {
  return new ObjectId(seq.toString(16).padStart(24, "0"));
}

type DemoItem = {
  seq: number;
  concept: string;
  statement: string;
  evidence: string;
  confidence: "low" | "medium" | "high";
  source: { title: string; url: string };
  daysAgo: number;
  // 同じ意味領域のKnowledgeが少しずつ理解を広げていく様子をマップで見せるための、
  // 既存Knowledgeへのextends関係（同じデモセット内の別itemのseqを指す）。
  extendsSeq?: number;
};

const ITEMS: DemoItem[] = [
  {
    seq: 1,
    concept: "海面上昇の主な要因",
    statement:
      "地球温暖化に伴う海水の熱膨張と氷床・氷河の融解が、海面上昇の主な要因となっている。",
    evidence: "記事中の海面上昇メカニズムの説明箇所を要約。",
    confidence: "high",
    source: { title: "気候変動と海面上昇", url: "https://example.com/climate/sea-level" },
    daysAgo: 0,
  },
  {
    seq: 2,
    concept: "パリ協定の目標",
    statement:
      "パリ協定は、産業革命前と比べて世界の平均気温上昇を2度未満、可能なら1.5度に抑えることを目標としている。",
    evidence: "記事中のパリ協定の数値目標に関する記述。",
    confidence: "high",
    source: { title: "気候変動と海面上昇", url: "https://example.com/climate/sea-level" },
    daysAgo: 0,
  },
  {
    seq: 3,
    concept: "カーボンプライシングの仕組み",
    statement:
      "炭素税や排出量取引制度は、CO2排出に価格をつけることで排出削減を経済的に誘導する仕組みである。",
    evidence: "深掘り会話でのカーボンプライシングに関する質疑から抽出。",
    confidence: "medium",
    source: { title: "カーボンプライシング入門", url: "https://example.com/climate/carbon-pricing" },
    daysAgo: 1,
    extendsSeq: 2,
  },
  {
    seq: 4,
    concept: "ロケットの再利用技術",
    statement:
      "SpaceXのFalcon 9は、打ち上げ後に第一段ロケットを着陸させて再利用することで、打ち上げコストを大幅に削減している。",
    evidence: "記事中の再利用ロケットのコスト削減効果に関する記述。",
    confidence: "high",
    source: { title: "再利用ロケットの現在地", url: "https://example.com/space/reusable-rocket" },
    daysAgo: 1,
  },
  {
    seq: 5,
    concept: "低軌道と静止軌道の違い",
    statement:
      "低軌道(LEO)は地表から2000km以内で通信衛星群などに使われ、静止軌道は約36000kmで地球の自転と同期し常に同じ地点上空に留まる。",
    evidence: "記事中の軌道の種類に関する説明を要約。",
    confidence: "medium",
    source: { title: "人工衛星の軌道入門", url: "https://example.com/space/orbit-types" },
    daysAgo: 2,
  },
  {
    seq: 6,
    concept: "有人火星探査の主な課題",
    statement:
      "有人火星探査は、長期宇宙滞在による健康影響、着陸時の減速手段、地球からの通信遅延など複数の技術的課題を抱えている。",
    evidence: "深掘り会話での有人火星探査の課題に関する質疑から抽出。",
    confidence: "medium",
    source: { title: "有人火星探査への道", url: "https://example.com/space/mars-mission" },
    daysAgo: 2,
    extendsSeq: 4,
  },
  {
    seq: 7,
    concept: "睡眠の記憶定着への役割",
    statement:
      "深い睡眠(徐波睡眠)の間に、海馬で獲得した短期記憶が大脳皮質へ転送され、長期記憶として定着すると考えられている。",
    evidence: "記事中の睡眠段階と記憶固定に関する説明。",
    confidence: "high",
    source: { title: "睡眠と記憶の科学", url: "https://example.com/brain/sleep-memory" },
    daysAgo: 3,
  },
  {
    seq: 8,
    concept: "腸内細菌と脳の関係（腸脳相関）",
    statement:
      "腸内細菌叢は迷走神経やホルモンを介して脳の機能や気分に影響を与えることがわかっており、これは腸脳相関と呼ばれる。",
    evidence: "深掘り会話での腸脳相関に関する質疑から抽出。",
    confidence: "medium",
    source: { title: "腸内細菌と脳", url: "https://example.com/brain/gut-brain-axis" },
    daysAgo: 3,
  },
  {
    seq: 9,
    concept: "有酸素運動が認知機能に与える影響",
    statement:
      "定期的な有酸素運動は海馬の体積を増加させ、記憶力や学習能力の維持に寄与することが複数の研究で示されている。",
    evidence: "記事中の運動と海馬の体積に関する研究紹介を要約。",
    confidence: "high",
    source: { title: "運動と脳の健康", url: "https://example.com/brain/exercise-cognition" },
    daysAgo: 4,
    extendsSeq: 7,
  },
  {
    seq: 10,
    concept: "Transformerのself-attention機構",
    statement:
      "Transformerのself-attentionは、系列内の各要素が他の全要素との関連度を計算することで、長距離の依存関係を捉えられるようにする仕組みである。",
    evidence: "深掘り会話でのTransformer構造に関する質疑から抽出。",
    confidence: "high",
    source: { title: "Transformer入門", url: "https://example.com/ai/transformer" },
    daysAgo: 4,
  },
  {
    seq: 11,
    concept: "過学習とその対策",
    statement:
      "過学習は訓練データに過度に適合し未知データへの汎化性能が下がる現象で、正則化やドロップアウト、データ拡張などで軽減される。",
    evidence: "記事中の過学習対策の一覧を要約。",
    confidence: "high",
    source: { title: "機械学習の基礎", url: "https://example.com/ai/overfitting" },
    daysAgo: 5,
  },
  {
    seq: 12,
    concept: "強化学習における報酬設計の難しさ",
    statement:
      "強化学習では、意図しない挙動を誘発しない適切な報酬関数を設計すること自体が難しく、報酬ハッキングと呼ばれる問題が起こりうる。",
    evidence: "深掘り会話での報酬ハッキングに関する質疑から抽出。",
    confidence: "medium",
    source: { title: "強化学習の落とし穴", url: "https://example.com/ai/reward-hacking" },
    daysAgo: 5,
  },
  {
    seq: 13,
    concept: "半導体の微細化とムーアの法則",
    statement:
      "ムーアの法則は、半導体集積回路上のトランジスタ数が約2年ごとに倍増するという経験則で、近年は微細化の限界から鈍化しつつある。",
    evidence: "記事中のムーアの法則の現状に関する記述。",
    confidence: "high",
    source: { title: "半導体産業の今", url: "https://example.com/tech/moores-law" },
    daysAgo: 6,
  },
  {
    seq: 14,
    concept: "EUVリソグラフィの役割",
    statement:
      "極端紫外線（EUV）リソグラフィは、従来の光源より波長が短く、より微細な回路パターンを半導体基板上に転写できる先端露光技術である。",
    evidence: "深掘り会話でのEUV露光技術に関する質疑から抽出。",
    confidence: "medium",
    source: { title: "EUV露光技術とは", url: "https://example.com/tech/euv-lithography" },
    daysAgo: 6,
    extendsSeq: 13,
  },
  {
    seq: 15,
    concept: "ローマ帝国の分裂",
    statement:
      "395年、ローマ帝国はテオドシウス1世の死後、東西に分割統治されるようになり、後の東ローマ（ビザンツ）帝国と西ローマ帝国の起源となった。",
    evidence: "記事中の395年の帝国分割に関する記述。",
    confidence: "high",
    source: { title: "ローマ帝国の興亡", url: "https://example.com/history/roman-empire-split" },
    daysAgo: 8,
  },
  {
    seq: 16,
    concept: "シルクロードの交易品",
    statement:
      "シルクロードでは中国から絹や陶磁器、西方からガラス製品や香辛料などが取引され、東西の文化交流の重要な経路となった。",
    evidence: "深掘り会話でのシルクロード交易品に関する質疑から抽出。",
    confidence: "medium",
    source: { title: "シルクロードの歴史", url: "https://example.com/history/silk-road" },
    daysAgo: 9,
  },
  {
    seq: 17,
    concept: "為替介入の目的",
    statement:
      "通貨当局が為替介入を行う主な目的は、急激な為替変動を抑制し、実体経済や物価への過度な悪影響を防ぐことにある。",
    evidence: "記事中の為替介入の目的に関する記述。",
    confidence: "high",
    source: { title: "為替介入の仕組み", url: "https://example.com/economy/fx-intervention" },
    daysAgo: 10,
  },
  {
    seq: 18,
    concept: "購買力平価説の基本的な考え方",
    statement:
      "購買力平価説は、二国間の為替レートは長期的に両国の物価水準の比によって決まるという考え方である。",
    evidence: "深掘り会話での購買力平価説に関する質疑から抽出。",
    confidence: "medium",
    source: { title: "為替レート理論入門", url: "https://example.com/economy/ppp" },
    daysAgo: 12,
    extendsSeq: 17,
  },
];

async function main() {
  const client = getMongoClient();
  await client.connect();
  const collection = client.db(MONGODB_DB_NAME).collection(KNOWLEDGE_COLLECTION);

  if (process.env.RESET_DEMO_KNOWLEDGE === "1") {
    const deleted = await collection.deleteMany({ userId: FIXED_USER_ID });
    console.log(`RESET_DEMO_KNOWLEDGE=1: cleared ${deleted.deletedCount} existing Knowledge document(s) for ${FIXED_USER_ID}.`);
  }

  let inserted = 0;
  let refreshed = 0;

  for (const item of ITEMS) {
    const _id = demoId(item.seq);
    const relationsOut = item.extendsSeq
      ? [{ knowledgeId: demoId(item.extendsSeq).toHexString(), type: "extends" as const }]
      : undefined;

    const doc = {
      userId: FIXED_USER_ID,
      concept: item.concept,
      statement: item.statement,
      evidence: item.evidence,
      confidence: item.confidence,
      status: "active" as const,
      source: { type: "web_article" as const, url: item.source.url, title: item.source.title },
      createdAt: daysAgo(item.daysAgo),
      updatedAt: daysAgo(item.daysAgo),
      ...(relationsOut ? { relatedKnowledgeIds: relationsOut.map((r) => r.knowledgeId), relationsOut } : {}),
    };

    const result = await collection.updateOne({ _id }, { $set: doc, $setOnInsert: { _id } }, { upsert: true });
    if (result.upsertedCount > 0) inserted++;
    else refreshed++;
  }

  console.log(`Demo knowledge seeded: ${inserted} inserted, ${refreshed} already existed (refreshed dates/content, topicPath left untouched).`);
  console.log("topicPath is intentionally left unset on insert; open 「自分の理解」(or GET /api/knowledge) to trigger classification.");

  await client.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

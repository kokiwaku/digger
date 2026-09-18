# digger-backend

Hono + TypeScript 製のAPIサーバー。`@hono/node-server` を使い、Node.js ランタイム上で動作します。

## ディレクトリ構成

```
backend/
├── src/
│   ├── index.ts                    # エントリーポイント。Honoアプリの定義とルーティング、サーバー起動
│   ├── db.ts                        # MongoDB接続クライアントの生成・pingヘルパー
│   ├── dig.ts                         # /api/dig のURLバリデーションと解析結果の組み立て
│   ├── deepDive.ts                     # /api/deep-dive のリクエスト検証と回答の組み立て
│   ├── deepDive.test.ts                 # deepDive.ts のユニットテスト（mock providerでの/api/deep-dive相当のフルパス確認）
│   ├── knowledgeApi.ts                   # /api/knowledge/extract・/api/knowledge/save・/api/knowledge のリクエスト検証と組み立て
│   ├── knowledge.ts                       # Knowledge（保存済みの理解）のMongoDB永続化と重複判定
│   ├── knowledge.test.ts                   # knowledge.ts のユニットテスト（正規化ロジックのみ、Mongo未使用）
│   ├── knowledgeApi.test.ts                 # knowledgeApi.ts のユニットテスト（リクエスト検証・confidenceフィルタ、Mongo未使用）
│   ├── llmTest.ts                       # /api/llm/test（開発用のLLM疎通確認API）のロジック
│   ├── articleFetcher.ts                 # 記事HTMLの取得（リダイレクト追跡）とReadabilityによる本文/タイトル抽出
│   ├── network.ts                         # SSRF対策（private/loopback/link-localホストの拒否）
│   ├── robots.ts                           # robots.txtの取得・パース・許可判定
│   ├── errors.ts                             # ArticleFetchError（記事取得系エラーの共通型）
│   ├── types.ts                               # /api/dig のリクエスト/レスポンス型
│   ├── network.test.ts                         # network.ts のユニットテスト
│   ├── robots.test.ts                           # robots.ts のユニットテスト
│   ├── llmTest.test.ts                           # llmTest.ts のユニットテスト
│   └── llm/                                        # LLMを使う4処理の型・schema・interface・モック/実LLM実装
│       ├── conversation.ts                           # 会話ターンの共通型（Knowledge Extraction / Deep Diveで共用）
│       ├── articleAnalysis.ts                        # 型・zod schema・ArticleAnalysisService interface
│       ├── articleAnalysis.mock.ts                    # モック実装（固定のデモ用サンプルを返す）
│       ├── articleAnalysis.mock.test.ts                # モック実装のユニットテスト
│       ├── articleAnalysis.vertex.ts                     # 実LLM実装（Gemini呼び出し＋prompt生成＋schema検証＋1回だけ再試行）
│       ├── articleAnalysis.vertex.test.ts                 # 上記のユニットテスト（フェイクのLlmProviderを使用、ネットワーク未使用）
│       ├── articleAnalysisFactory.ts                        # LLM_PROVIDER環境変数によるArticleAnalysisService切り替え
│       ├── articleAnalysisFactory.test.ts                    # 上記のユニットテスト
│       ├── personalizedAnalysis.ts                       # 型・zod schema・PersonalizedAnalysisService interface
│       ├── personalizedAnalysis.mock.ts                   # モック実装（concept名の単純一致で既知/未知を判定）
│       ├── personalizedAnalysis.mock.test.ts               # モック実装のユニットテスト
│       ├── knowledgeExtraction.ts                            # 型・zod schema・KnowledgeExtractionService interface
│       ├── knowledgeExtraction.mock.ts                         # モック実装（固定の候補を1件返す）
│       ├── knowledgeExtraction.vertex.ts                        # 実LLM実装（Gemini呼び出し＋prompt生成＋schema検証＋1回だけ再試行、idはサーバー側で付与）
│       ├── knowledgeExtraction.vertex.test.ts                    # 上記のユニットテスト（フェイクのLlmProviderを使用、ネットワーク未使用）
│       ├── knowledgeExtractionFactory.ts                          # LLM_PROVIDER環境変数によるKnowledgeExtractionService切り替え
│       ├── deepDive.ts                                           # 型・zod schema・DeepDiveService interface
│       ├── deepDive.mock.ts                                       # モック実装（記事の解析結果から応答を組み立てる）
│       ├── deepDive.mock.test.ts                                   # モック実装のユニットテスト
│       ├── deepDive.vertex.ts                                       # 実LLM実装（Gemini呼び出し＋prompt生成＋schema検証＋1回だけ再試行）
│       ├── deepDive.vertex.test.ts                                   # 上記のユニットテスト（フェイクのLlmProviderを使用、ネットワーク未使用）
│       ├── deepDiveFactory.ts                                         # LLM_PROVIDER環境変数によるDeepDiveService切り替え
│       ├── deepDiveFactory.test.ts                                     # 上記のユニットテスト
│       ├── knowledgeRetrieval.ts                                        # Relevant Knowledge Retrieval（Deep Diveへ渡すKnowledgeの絞り込み）
│       ├── knowledgeRetrieval.test.ts                                    # 上記のユニットテスト（フェイクのLlmProviderを使用、ネットワーク未使用）
│       ├── knowledgeTopic.ts                                              # 型・zod schema・KnowledgeTopicService interface（「自分の理解」ページのトピック分類）
│       ├── knowledgeTopic.mock.ts                                          # モック実装（conceptをそのまま単一階層のtopicにする）
│       ├── knowledgeTopic.mock.test.ts                                      # モック実装のユニットテスト
│       ├── knowledgeTopic.vertex.ts                                          # 実LLM実装（Gemini呼び出し＋prompt生成＋schema検証＋1回だけ再試行）
│       ├── knowledgeTopic.vertex.test.ts                                      # 上記のユニットテスト（フェイクのLlmProviderを使用、ネットワーク未使用）
│       ├── knowledgeTopicFactory.ts                                            # LLM_PROVIDER環境変数によるKnowledgeTopicService切り替え
│       ├── jsonExtraction.ts                                            # 実LLM実装間で共有するJSON抽出ヘルパー（markdownコードフェンス対応）
│       └── provider/                                                 # LLMプロバイダー抽象化層（Vertex AI/Geminiなど）
│           ├── llmProvider.ts                                          # LlmProvider interface（generateTextのみ）
│           ├── llmProviderError.ts                                      # LlmProviderError と安全なAPIレスポンスへの変換
│           ├── llmProviderError.test.ts                                  # 上記のユニットテスト
│           ├── mockLlmProvider.ts                                        # モック実装（固定文言を返す）
│           ├── vertexGeminiProvider.ts                                    # Vertex AI Gemini実装（@google/genai使用）
│           ├── vertexGeminiProvider.test.ts                                # エラー分類ロジック等のユニットテスト（ネットワーク未使用）
│           ├── llmProviderFactory.ts                                        # LLM_PROVIDER環境変数によるprovider切り替え
│           └── llmProviderFactory.test.ts                                    # 上記のユニットテスト
├── Dockerfile
├── tsconfig.json
└── package.json
```

## アーキテクチャ

```mermaid
flowchart TD
    subgraph index.ts
        A["Hono アプリ"] -->|CORS ミドルウェア<br/>origin: FRONTEND_ORIGIN| B["/api/* ルート"]
        B --> C["GET /api/health"]
        B --> D["GET /api/health/db"]
    end

    B --> H["POST /api/dig"]

    D -->|pingDatabase| E["db.ts<br/>getMongoClient()"]
    E -->|MongoClient| F[("MongoDB")]

    H -->|parseArticleUrl| I["dig.ts<br/>buildDigResult"]
    I -->|fetchArticle| J["articleFetcher.ts<br/>リダイレクトをホップごとに追跡"]
    J -->|各ホップで検証| N["network.ts<br/>assertPublicHost"]
    J -->|各ホップで検証| R["robots.ts<br/>ensureAllowedByRobots"]
    N -.->|SSRF対象なら400| J
    R -.->|Disallowなら403| J
    J -->|"fetch(url)"| K["対象Webサイト"]
    K -->|HTML| J
    J -->|"JSDOM + Readability<br/>title / textContent"| I
    I -->|"getArticleAnalysisService()"| AAF["articleAnalysisFactory.ts"]
    AAF -->|"LLM_PROVIDER=mock"| AAM["articleAnalysis.mock.ts"]
    AAF -->|"LLM_PROVIDER=vertex"| AAV["articleAnalysis.vertex.ts<br/>prompt生成→LlmProvider→JSON parse→schema検証<br/>（失敗時1回だけ再試行）"]
    AAV -->|"getLlmProvider()"| PF2["llm/provider/llmProviderFactory.ts"]
    PF2 -->|"generateText(responseJsonSchema付き)"| VP2["vertexGeminiProvider.ts"]
    VP2 -->|"generateContent()"| VX2[("Vertex AI<br/>Gemini")]
    AAM -->|ArticleAnalysis| I
    AAV -->|ArticleAnalysis| I
    I --> H

    B --> M["POST /api/deep-dive"]
    M -->|"deepDiveInputSchema.safeParse"| DD["deepDive.ts<br/>buildDeepDiveResponse"]
    DD -->|"getDeepDiveService()"| DDF["deepDiveFactory.ts"]
    DDF -->|"LLM_PROVIDER=mock"| DDM["deepDive.mock.ts"]
    DDF -->|"LLM_PROVIDER=vertex"| DDV["deepDive.vertex.ts<br/>prompt生成→LlmProvider→JSON parse→schema検証<br/>（失敗時1回だけ再試行）"]
    DDV -->|"getLlmProvider()"| PF2
    DDM -->|DeepDiveResponse| DD
    DDV -->|DeepDiveResponse| DD
    DD --> M

    B --> T["POST /api/llm/test"]
    T -->|"{ message }"| LT["llmTest.ts<br/>callLlmTest"]
    LT -->|"getLlmProvider()"| PF["llm/provider/llmProviderFactory.ts"]
    PF -->|"LLM_PROVIDER=mock"| MP["mockLlmProvider.ts"]
    PF -->|"LLM_PROVIDER=vertex"| VP["vertexGeminiProvider.ts<br/>(@google/genai)"]
    VP -->|"generateContent()"| VX[("Vertex AI<br/>Gemini")]
    MP -->|string| LT
    VX -->|text| VP
    VP -->|string / LlmProviderError| LT
    LT --> T

    A -->|"serve()"| G["@hono/node-server<br/>:8787"]
```

- **`index.ts`**: Honoインスタンスを作成し、`/api/*` にCORSミドルウェアを適用した上でルートを定義しています。`serve()`（`@hono/node-server`）でNode.js上にHTTPサーバーとして起動します。
- **`db.ts`**: `MongoClient` をモジュールスコープでシングルトン管理し（`getMongoClient()`）、毎回の接続確立コストを避けています。`pingDatabase()` は `{ ping: 1 }` コマンドでDB疎通を確認するだけの軽量な関数です。
- **`articleFetcher.ts`**: `fetchArticle(url)` が本文取得の中心。
  1. リダイレクトは`redirect: "manual"`で自前追跡し（最大5ホップ）、**各ホップ**で `network.ts` の `assertPublicHost()` と `robots.ts` の `ensureAllowedByRobots()` を実行してから`fetch()`する。これによりリダイレクト先（最終URL）に対してもSSRF対策・robots.txt確認が適用される。
  2. `fetch()` はタイムアウト10秒、User-Agentは`Digger/0.1 (+https://github.com/kokiwaku/digger)`を明示的に送信（一般ブラウザへの偽装はしない）。ネットワークエラー・非2xxは `ArticleFetchError`（`502`）。
  3. `content-type` がHTML系でなければ `ArticleFetchError`（`422`）。
  4. `jsdom` でDOMを構築し、`@mozilla/readability`（Firefoxリーダービューと同じ抽出エンジン）で nav/footer/広告等を除いた `title` と `textContent` を抽出。抽出できた本文が短すぎる（200文字未満）場合は抽出失敗として `ArticleFetchError`（`422`）。
  - ニュースサイト固有のスクレイピングルールは持たず、一般的なHTML構造の記事ページを対象にした汎用実装です。
- **`network.ts`**: `assertPublicHost(url)` がSSRF対策を担当。ホスト名が`localhost`/`*.localhost`、またはIPリテラルでプライベート/ループバック/リンクローカル（`169.254.169.254`等のクラウドメタデータエンドポイントを含む）なら`ArticleFetchError`（`400`）。ホスト名の場合はDNS解決した実IPも同様にチェックし、DNSリバインディングを防ぐ。
- **`robots.ts`**: `ensureAllowedByRobots(url, userAgent)` がrobots.txtを取得・パースし、Diggerの User-Agent（`digger`）または`*`グループのルールと照合。`Disallow`に一致すれば`ArticleFetchError`（`403`）。robots.txt自体が取得できない（ネットワークエラー・非2xxなど）場合は許可されているものとして扱う。簡易パーサのため`Allow`/`Disallow`のみサポートし、`Crawl-delay`等は無視する。
- **`errors.ts`**: `ArticleFetchError`（`400`/`403`/`422`/`502`のいずれかのステータスを持つ）。記事取得パイプライン全体（URL検証・SSRF対策・robots確認・HTTP取得・本文抽出）で共通に使うエラー型。
- **`dig.ts`**: `parseArticleUrl()` がリクエストの `url` を検証（未指定・不正な形式・http/https以外のプロトコルはエラー）。`buildDigResult()` が `fetchArticle()` で取得した実際の `title`/`textContent` を `llm/articleAnalysisFactory.ts` の `getArticleAnalysisService()`（`LLM_PROVIDER`に応じてmock/vertexを切り替え）に渡し、その結果と組み合わせて `DigResult` を返します。`LlmProviderError`は`index.ts`側で捕捉し、`toSafeApiResponse()`で安全なレスポンスに変換します。
- **`deepDive.ts`**: `parseDeepDiveInput()` がリクエストボディを `llm/deepDive.ts` の `deepDiveInputSchema` でそのまま検証（`articleAnalysis`/`question`/`conversationHistory`/`userKnowledge?`の形が正しいか）。`buildDeepDiveResponse()`（`createBuildDeepDiveResponse()`のデフォルトエクスポート）は、クライアントが`userKnowledge`を渡さなかった場合に`resolveUserKnowledge`（デフォルトは`defaultResolveUserKnowledge`）を呼んで補い、`llm/deepDiveFactory.ts` の `getDeepDiveService()`（`LLM_PROVIDER`でmock/vertexを切り替え）へ渡します。`resolveUserKnowledge`は`getProvider`と同様の理由（テストで実際のMongoDB接続を発生させないため）で注入可能にしており、`deepDive.test.ts`ではフェイクの関数を渡してテストしています。`defaultResolveUserKnowledge`の実装は`knowledge.ts`の`getKnowledgeForDeepDive()`（status: active/foundationalのみ）→`llm/knowledgeRetrieval.ts`の`hybridKnowledgeRetrievalService`という流れで、取得・選定に失敗しても例外を投げず`undefined`にフォールバックします（Deep Dive自体は従来通り継続）。
- **`types.ts`**: `/api/dig` のリクエスト型（`DigRequest`）とレスポンス型（`DigResult` / `DigSource`、および `llm/articleAnalysis.ts` の `ArticleAnalysis`）を定義。frontend側の `src/types.ts` と同じ形を手動で同期しています（共有パッケージ化はまだしていません）。`/api/deep-dive` は `llm/deepDive.ts` の型をそのままリクエスト/レスポンス型として使うため、`types.ts` に重複定義はありません。
- **`llm/`**: LLMを使う4処理（後述）の型・schema・interface・モック実装、および`llm/provider/`（Vertex AI等のプロバイダー抽象化層。後述）。
- **`llmTest.ts`**: 開発用の疎通確認API `POST /api/llm/test` のロジック。リクエストの`message`をzodで検証し、`llm/provider/`の`getLlmProvider()`が返す`LlmProvider`（デフォルトはモック）の`generateText()`を、固定のsystem promptと一緒に呼ぶだけです。Diggerの業務ロジック（Article Analysis等）はまだ関与しません。
- 現時点でルートは8つ:
  - `GET /api/health` — プロセスが生きていることの確認（DBには触れない）
  - `GET /api/health/db` — `pingDatabase()` を呼び、成功なら `200 { status: "ok", db: "connected" }`、失敗なら `503 { status: "error", db: "disconnected", message }`
  - `POST /api/dig` — `{ url: string }` を受け取り、URLバリデーション失敗またはSSRF対象ホストは `400`、robots.txtにより不許可なら `403`、記事取得・抽出・Article Analysisに成功すれば `200` で `DigResult`、それ以外の取得・抽出失敗は `422`（本文抽出失敗・非HTML）または `502`（アクセス失敗・非2xx・ホスト名解決失敗）で `{ error: string }`
  - `POST /api/deep-dive` — `{ articleAnalysis, question, conversationHistory, userKnowledge? }` を受け取り、schemaバリデーション失敗は `400`、成功すれば `200` で `DeepDiveResponse`（`answer`/`relatedConcepts: { name, relation }[]`/`suggestedFollowUps`）、LLMプロバイダー側のエラーは原因に応じて `500`/`502`/`504`、それ以外の失敗は `502` で `{ error: string }`。**`userKnowledge`をクライアントが渡さない場合、サーバー側で保存済みKnowledge（`status: active`/`foundational`のみ）から今回の質問・記事に関連しそうなものだけを自動的に選んでLLMへ渡す**（詳細は[Relevant Knowledge Retrieval](#relevant-knowledge-retrievalとknowledgeの再利用)を参照）
  - `POST /api/knowledge/extract` — `{ source, articleAnalysis, conversationHistory }` を受け取り、schemaバリデーション失敗は `400`。保存済みKnowledge（あれば）を`existingKnowledge`としてLLMへ渡した上でKnowledge Extractionを実行し、`200` で `{ candidates: KnowledgeCandidate[] }`（`confidence: "low"`の候補はUXをシンプルに保つため事前に除外）。LLMプロバイダー側のエラーは原因に応じて`500`/`502`/`504`、それ以外の失敗は`502`で`{ error: string }`
  - `POST /api/knowledge/save` — `{ source, candidates: KnowledgeCandidate[] }`（ユーザーがチェックボックスで選んだ候補のみ）を受け取り、schemaバリデーション失敗は`400`。既存Knowledgeと（concept完全一致 + statement正規化後一致で）重複するものは保存せずスキップし、`200`で`{ savedCount: number, skippedCount: number }`、それ以外の失敗は`502`で`{ error: string }`
  - `GET /api/knowledge` — 保存済みKnowledge（固定userId分）を`createdAt`降順で`200`の`{ knowledge: KnowledgeDocument[] }`として返す。取得失敗時は`502`で`{ error: string }`
  - `POST /api/llm/test` — 開発用のLLM疎通確認API（後述）。`{ message: string }` を受け取り、バリデーション失敗は `400`、成功すれば `200` で `{ response: string }`、LLMプロバイダー側のエラーは原因に応じて `500`/`502`/`504` で `{ error: string }`（安全な汎用メッセージのみ。詳細はサーバーログへ）

## LLM処理（Article Analysis / Personalized Analysis / Knowledge Extraction / Deep Dive）

Diggerのコア機能である「記事を深掘りして理解を蓄積する」部分は、4つの独立したLLM処理として実装します。**Article Analysis・Deep Dive・Knowledge Extractionは実LLM化済みで、`LLM_PROVIDER=vertex`のときVertex AI Geminiが実際に処理します。** Personalized Analysisはまだ`llm/personalizedAnalysis.mock.ts`の固定/簡易ロジックのみで、呼び出し導線自体も未実装です。

```mermaid
flowchart LR
    subgraph "1. Article Analysis（実LLM化済み・/api/digから呼ばれる）"
        AAI["ArticleAnalysisInput<br/>title / url / content"] --> AAF2["articleAnalysisFactory.ts"]
        AAF2 -->|mock| AAS["articleAnalysis.mock.ts"]
        AAF2 -->|vertex| AAV2["articleAnalysis.vertex.ts<br/>(Gemini + structured output +<br/>schema検証 + 1回だけ再試行)"]
        AAS --> AA["ArticleAnalysis<br/>summary / whyItMatters / concepts /<br/>entities / connections / deepDiveQuestions"]
        AAV2 --> AA
    end

    subgraph "2. Personalized Analysis（型・モックのみ、未接続）"
        PAI["PersonalizedAnalysisInput<br/>articleAnalysis + userKnowledge + relatedHistory"] --> PAS["PersonalizedAnalysisService<br/>(personalizedAnalysis.mock.ts)"]
        PAS --> PA["PersonalizedAnalysis<br/>alreadyKnown / needsExplanation /<br/>relatedPastKnowledge / personalizedExplanation / suggestedQuestions"]
    end

    subgraph "3. Knowledge Extraction（実LLM化済み・/api/knowledge/extractから呼ばれる）"
        KEI["KnowledgeExtractionInput<br/>source + articleAnalysis + conversation<br/>+ existingKnowledge?"] --> KEF["knowledgeExtractionFactory.ts"]
        KEF -->|mock| KES["knowledgeExtraction.mock.ts"]
        KEF -->|vertex| KEV["knowledgeExtraction.vertex.ts<br/>(Gemini + structured output +<br/>schema検証 + 1回だけ再試行 +<br/>idをサーバー側で付与)"]
        KES --> KE["KnowledgeExtractionResult<br/>candidates: { id / concept / statement /<br/>evidence / confidence / isNew }[]"]
        KEV --> KE
    end

    subgraph "4. Deep Dive（実LLM化済み・/api/deep-diveから呼ばれる）"
        DDI["DeepDiveInput<br/>articleAnalysis + question +<br/>conversationHistory + userKnowledge?"] --> DDF2["deepDiveFactory.ts"]
        DDF2 -->|mock| DDS["deepDive.mock.ts"]
        DDF2 -->|vertex| DDV2["deepDive.vertex.ts<br/>(Gemini + structured output +<br/>schema検証 + 1回だけ再試行)"]
        DDS --> DDO["DeepDiveResponse<br/>answer / relatedConcepts:{name,relation}[] /<br/>suggestedFollowUps"]
        DDV2 --> DDO
    end

    AA -.->|将来: userKnowledgeと合わせて入力| PAI
    AA -->|「今回わかったことを残す」クリック時に<br/>会話ログと合わせて渡す| KEI
    AA -->|質問のたびに渡す| DDI
    DDO -.->|会話ログとしてconversationHistoryに蓄積| DDI
    KE -.->|ユーザーが確認・選択| SAVE["POST /api/knowledge/save<br/>選択されたcandidateのみ保存"]
    SAVE --> MONGO[("MongoDB<br/>user_knowledge collection")]
```

- **なぜ4つに分離するか**: それぞれ目的も入力も異なるため（記事の客観的な解析／ユーザー個人への最適化／対話からの知識抽出／その場のQ&A）。将来的に別々のプロンプト・別々のモデル（例: 安価なモデルで要約、高性能なモデルで個人化）に切り替えられるよう、最初から独立した`interface`にしています。候補ボタンのクリックと自由入力のどちらから来た質問も、同じ`question: string`として`DeepDiveService`に渡るため、呼び出し側で区別する必要がありません。
- **共通パターン**: 各処理は `xxx.ts`（型・zod schema・`XxxService` interfaceの3点セット）と `xxx.mock.ts`（そのinterfaceを実装するモック）に分かれています。本物のLLM実装を追加する際は、同じinterfaceを実装する `xxx.openai.ts` のような新しいファイルを作り、呼び出し側（`dig.ts`/`deepDive.ts`など）のimportを差し替えるだけで済む構造です。
- **runtime validation**: 型定義には[Zod](https://zod.dev/)を使い、`z.infer<typeof schema>` でTypeScript型をschemaから導出しています（型とバリデーションルールの二重管理を避けるため）。モック実装も生成したデータを`schema.parse(...)`に通してから返しており、本物のLLM実装でも「LLMのレスポンス(JSON)を`schema.parse(...)`で検証してから返す」という同じパターンを踏襲する想定です。LLMの出力は外部から来る信頼できないデータなので、ここでの検証は将来的に特に重要になります。`deepDive.ts`の`deepDiveInputSchema`はさらに、クライアントからのリクエストボディの検証にもそのまま使われています（`deepDive.ts`（backend直下）の`parseDeepDiveInput()`）。
- **共通型の再利用**: 会話ターンの型（`{ role: "user" | "assistant", content: string }`）は`llm/conversation.ts`に切り出し、Knowledge ExtractionとDeep Diveの両方から利用しています。ユーザーの過去の知識の型（`UserKnowledge`）は`llm/personalizedAnalysis.ts`からexportし、Deep Diveから再利用しています。
- **ユーザー知識・履歴の扱い**: Article Analysisにはユーザーの知識や履歴を一切渡しません（記事そのものの客観的な解析のため）。ユーザー個人への最適化はPersonalized Analysisの責務として分離しています。
- **1. Article Analysis**（`llm/articleAnalysis.ts` / `articleAnalysis.mock.ts` / `articleAnalysis.vertex.ts` / `articleAnalysisFactory.ts`）: 記事の`title`/`url`/`content`から、要約・重要性・前提知識（`concepts`）・関連する人物や組織（`entities`）・他テーマとの関連（`connections`）・深掘りの問い（`deepDiveQuestions`）を生成。`dig.ts`が`articleAnalysisFactory.ts`の`getArticleAnalysisService()`（`LLM_PROVIDER`で`articleAnalysis.mock.ts`/`articleAnalysis.vertex.ts`を切り替え）を呼び、結果は`/api/dig`のレスポンスに含まれます。実LLM実装の詳細は次項を参照。
- **2. Personalized Analysis**（`llm/personalizedAnalysis.ts` / `personalizedAnalysis.mock.ts`）: Article Analysisの結果とユーザーの過去の理解（`userKnowledge`）を照合し、「何を説明すべきか」を判定。モック実装はLLMを使わず、concept名の文字列一致だけで「既知/未知」を振り分ける簡易ロジックです。**まだどのルートからも呼ばれていません**（ユーザーの理解履歴を保存する仕組み自体が未実装のため）。
- **3. Knowledge Extraction**（`llm/knowledgeExtraction.ts` / `knowledgeExtraction.mock.ts` / `knowledgeExtraction.vertex.ts` / `knowledgeExtractionFactory.ts`）: 深掘り対話のログ（`conversation`）から、新しく理解したと思われる知識の"候補"（`KnowledgeCandidate`）を抽出。AIが理解を勝手に確定させないよう、あくまで候補を返すだけで、保存の可否はユーザーが決める設計です。既存Knowledge（`existingKnowledge`）との関係（`relationToExisting`: `new`/`reinforces`/`extends`/`supersedes`）も判定し、「Knowledgeを増やすだけでなく、理解状態として捉える」ための材料にします（詳細は[Knowledgeモデル](#knowledgeモデル-不変のメモではなく現在の理解状態)を参照）。`knowledgeApi.ts`（backend直下）が`knowledgeExtractionFactory.ts`の`getKnowledgeExtractionService()`を呼び、`POST /api/knowledge/extract`から利用されます。実LLM実装の詳細は次項を参照。
- **4. Deep Dive**（`llm/deepDive.ts` / `deepDive.mock.ts` / `deepDive.vertex.ts` / `deepDiveFactory.ts`）: Article Analysisの結果・質問（`question`）・これまでの会話（`conversationHistory`）から、その場の回答（`answer`）・関連する前提知識（`relatedConcepts: { name, relation }[]`。単なるキーワード列挙ではなく「今回の質問とどう関係するか」を含む）・次の質問候補（`suggestedFollowUps`）を生成。`backend/src/deepDive.ts`が`deepDiveFactory.ts`の`getDeepDiveService()`を呼び、`POST /api/deep-dive`のレスポンスになります。実LLM実装の詳細は次項を参照。

> **注記**: Personalized Analysisのみまだ`llm/provider/`（次項）を使っておらず、`personalizedAnalysis.mock.ts`が固定値/簡易ロジックを返すだけです。Article Analysis・Deep Dive・Knowledge Extractionは実際に`llm/provider/`経由でVertex AI Geminiを呼ぶ実装（`articleAnalysis.vertex.ts` / `deepDive.vertex.ts` / `knowledgeExtraction.vertex.ts`）を追加済みで、3つとも同じ構造（prompt生成→structured output→schema検証→1回だけ再試行）を踏襲しています。

### Article Analysisの実LLM化（`articleAnalysis.vertex.ts`）

`LLM_PROVIDER=vertex`のとき、`articleAnalysisFactory.ts`が`vertexArticleAnalysisService`を選択します。処理の流れ:

1. **入力サイズの制御**: 記事本文（`content`）が`MAX_CONTENT_LENGTH`（12,000文字）を超える場合は切り詰め、末尾に省略した旨を追記します。トークン数ではなく文字数での単純な制御です（Gemini 2.5 Flash等のコンテキストウィンドウ自体は十分大きいですが、コスト・レイテンシを抑えるための保守的な上限です）。
2. **prompt生成**: システムプロンプトでDiggerのArticle Analysisエンジンとしての役割（何が起きたか／なぜ重要か／前提知識／関連テーマ／深掘りの問いを整理する。単なる要約ではない）を指示し、ユーザープロンプトで記事のtitle/url/本文と、各フィールド（`summary`/`whyItMatters`/`concepts`/`entities`/`connections`/`deepDiveQuestions`）ごとの具体的な出力ルール（良い例/悪い例を含む）を渡します。**frontendのProgressive Disclosure UI（詳細は[`frontend/README.md`](../frontend/README.md)）に合わせ、`summary`/`whyItMatters`は最大3文、`concept.description`は1〜2文、`deepDiveQuestions`は最大4件（最初の1件が最も優先度の高い問いになるよう指示）に絞るようpromptで制約しています。schema自体（フィールド構成）は変更していません**。frontend側でも`firstSentences()`（文末記号での単純な冒頭N文抽出）により、想定より長い応答が来た場合の安全弁として表示文字数を制御しています。
3. **structured output**: `articleAnalysisSchema`を[Zod 4の`z.toJSONSchema()`](https://zod.dev/json-schema)（追加ライブラリ不要）でJSON Schemaに変換し、`LlmProvider.generateText()`の`responseJsonSchema`として渡します。`vertexGeminiProvider.ts`はこれを`responseMimeType: "application/json"` + `responseJsonSchema`として`@google/genai`の`generateContent()`に渡し、Geminiのnative構造化出力機能でJSON形式の出力を強制します。
4. **runtime validation**: 返ってきたテキストを`JSON.parse()`し（万一markdownのコードフェンスで囲まれていても対応）、`articleAnalysisSchema.safeParse()`で検証します。**LLMが返した値は無条件に信用しません。**
5. **再試行**: JSON parse失敗・schema validation失敗（必須フィールド欠落・不正なenum値・空レスポンス等）の場合、「前回の出力がschemaに適合しなかったため、指定schemaに厳密に従って再生成してください」という指示を追加して**1回だけ**再試行します。それでも失敗すれば`LlmProviderError`（`empty_response`）を投げ、`index.ts`が`502`として返します。複雑な自動修復は行いません。
6. **ログ**: `[ArticleAnalysis] start`（provider/model/url）→（失敗時）`[ArticleAnalysis] validation failed, retrying once`→`[ArticleAnalysis] success`または`failed after retry`（provider/model/処理時間ms/retriedの有無）をサーバーログに出力します。記事本文全文やcredentialは出力しません。トークン使用量（`promptTokens`/`candidatesTokens`/`totalTokens`）は`vertexGeminiProvider.ts`側で`[VertexGeminiProvider] token usage`として出力します（`@google/genai`のレスポンスに含まれる`usageMetadata`をそのまま使うだけで、追加の実装は行っていません）。
7. **timeout**: `llm/provider/vertexGeminiProvider.ts`が持つ既存の30秒タイムアウト（`AbortController`）をそのまま利用します。再試行時も同じタイムアウトが個別に適用されるため、最悪ケースでも無限待ちにはなりません（1回の呼び出しごとに最大30秒、再試行込みで最大2回）。
8. **テスト容易性**: `createVertexArticleAnalysisService(getProvider)`という形でproviderの解決を関数として注入できるようにしており、テストではフェイクの`LlmProvider`を渡すことで、実際のVertex AI呼び出しなしに正常系・JSON parse失敗・schema validation失敗・再試行成功・再試行後も失敗・LLM呼び出しエラー（再試行しないこと）を検証しています（`articleAnalysis.vertex.test.ts`）。

> markdownコードフェンス対応のJSON抽出処理（`extractJsonText()`）は`llm/jsonExtraction.ts`に切り出し、Article Analysis・Deep Dive・Knowledge Extractionの3つの実LLM実装で共有しています（再試行のオーケストレーションやログ出力は各サービス固有のロジックのため共通化せず、あえて別々のまま残しています）。

### Deep Diveの実LLM化（`deepDive.vertex.ts`）

Article Analysisと同じ構造・パターンを踏襲しています。差分のみ記載します。

1. **コンテキストの組み立て**: 記事本文を毎回再送するのではなく、`ArticleAnalysis`の結果（`summary`/`whyItMatters`/`concepts`/`entities`/`connections`）を`formatArticleContext()`で読みやすいテキストに整形してコンテキストとして使います。
2. **会話履歴の制御**: `conversationHistory`は直近`MAX_HISTORY_MESSAGES`（20件）のみを使用し、古い発言から落とす単純な上限制御です（要約による圧縮はまだ行いません）。`userKnowledge`が渡されていればプロンプトに含め、`undefined`/空でも問題なく動作します。
3. **役割設定**: システムプロンプトで「一般的な雑談チャットではなく、今読んでいる記事・テーマを理解するための専用家庭教師」という役割を指示し、回答方針（まず結論を簡潔に答える→今回質問された範囲に集中し周辺知識まで無理に広げない→会話履歴で既出の内容を繰り返さない→ユーザーが既に理解している知識を前提に一段先を説明する→断定を避ける→自分から話を広げすぎず次の疑問が生まれる余白を残す）をpromptで制約しています。**Diggerは1回の回答でテーマ全体を説明し切るのではなく、会話の往復を通じて理解を深めるサービスであることを明示しています。**
4. **回答の長さ**: `answer`の出力ルールで「まず結論を簡潔に述べてから、必要な分だけ補足する」「目安として300〜500文字程度、3〜5段落以内」「不要な背景説明や周辺知識まで広げすぎない」「『さらに詳しく言うと〜』のように自分から話を広げすぎない（ユーザーが詳細を求めてきた場合のみ詳しく説明する）」と明示しています。ただし「短さを優先しつつ、質問への直接的な回答に必要な情報は省略しないこと」も併記しており、文字数を機械的に強制するものではありません（実際に`LLM_PROVIDER=vertex`で検証したところ、397文字・446文字程度の、結論から入る3〜4段落の回答になることを確認しています）。`suggestedFollowUps`（質問提案）のUIは復活させておらず、短さはprompt自体の指示のみで実現しています。
5. **`relatedConcepts`のschema変更**: `string[]`（概念名の羅列）ではなく`{ name: string, relation: string }[]`にすることで、「今回の質問となぜ関係するのか」をLLMに明示させます。`deepDive.mock.ts`もこの形（`relation`は記事の`concept.description`から組み立て）に追従済みです。
6. **structured output / 検証 / 再試行 / ログ / timeout**: Article Analysisと全く同じパターン（`z.toJSONSchema()`でJSON Schema化、`safeParse`で検証、1回だけ再試行、`[DeepDive] ...`のログ。質問文や会話全文はログに出さず、provider/model/処理時間/`conversationLength`のみ出力）。
7. **テスト容易性**: フェイクの`LlmProvider`を注入して、正常系・JSON parse失敗/schema validation失敗からの再試行成功・再試行後も失敗・LLM呼び出しエラー（再試行しないこと）・`conversationHistory`が実際にpromptへ渡ること・上限超過時に古い発言が落ちること・`userKnowledge`未指定でも動作すること・簡潔さ/段落数のガイドラインがpromptに含まれること・質問の範囲に集中し余白を残す旨の指示が含まれることを検証しています（`deepDive.vertex.test.ts`）。

### Knowledge Extractionの実LLM化（`knowledgeExtraction.vertex.ts`）

Article Analysisと同じ構造・パターンを踏襲しています。差分のみ記載します。

1. **入力**: `KnowledgeExtractionInput`は`source`（記事のtype/url/title）・`articleAnalysis`・`conversation`（深掘り対話ログ）・`existingKnowledge?`（保存済みKnowledge。`knowledgeApi.ts`がMongoDBから取得して渡す。取得に失敗しても抽出自体は続行し、空配列で進めます）の4つ。会話が長くなりすぎた場合は直近`MAX_CONVERSATION_TURNS`（30件）だけに切り詰めます（Article Analysisの`MAX_CONTENT_LENGTH`と同じ考え方）。
2. **prompt生成**: システムプロンプトで「AIが理解を勝手に確定してはいけない、あくまで候補」「記事本文に書いてあるだけの内容や、ユーザーが質問しただけの内容は理解済み扱いしない」「ユーザーの言い換え・確認・関連づけを理解の根拠として重視する」という制約を明示。ユーザープロンプトには記事のtitle/url/summary/前提知識、会話ログ、そして**既存Knowledgeの一覧（`[id] concept: statement`の形でidを含めて渡す）**を渡します。
3. **relationToExistingの判定**: システムプロンプトに、新しいcandidateが既存Knowledgeと意味的に関係する場合は`relationToExisting`（`type`/`knowledgeId`/`reason`）を判定するよう指示しています。`reinforces`（表現違いレベルの再確認）/`extends`（既存を前提にさらに広がっている）/`supersedes`（既存が不正確・古く置き換えるべき）のいずれかに該当する場合は既存Knowledgeの`[id]`を`knowledgeId`に設定して`isNew`をfalseに、関連がなければ`relationToExisting`自体を省略して`isNew`をtrueにするよう指示しています。**無理に既存Knowledgeへ紐付けないこと**も明記しています。今回はこの関係を判定・保持するところまでで、**`merged`/`outdated`への自動変更・既存Knowledgeのstatement書き換え・自動統合は一切行いません**（次のステップの設計課題）。実際に`LLM_PROVIDER=vertex`で確認したところ、`new`/`extends`は狙って発生させやすい一方、`supersedes`は意図的に発生させるのが難しいことが分かりました。Deep Dive自体がユーザーの誤解をその場で訂正する（SYSTEM_PROMPTの「不明なことを断定しない」等の方針）ため、明確に誤った内容がKnowledgeとして確定的に保存される状況自体が起きにくいためです。`supersedes`のマッピング・UI表示ロジックは`extends`と全く同じコードパス（`toDisplayCategory()`のswitch文の別分岐）なのでユニットテストで検証していますが、実LLM出力での確認は`new`/`extends`/`reinforces`の3種類のみ行っています。
4. **idの扱い**: `KnowledgeCandidate`の`id`はLLMには生成させません（一意性をLLMの出力に依存させないため）。LLMには`concept`/`statement`/`evidence`/`confidence`/`isNew`/`relationToExisting?`だけを含む"draft" schema（`knowledgeExtractionDraftSchema`）で構造化出力させ、schema検証に成功した後で`randomUUID()`により`id`をサーバー側で付与します（`withGeneratedIds()`）。`relationToExisting.knowledgeId`はLLMが既存Knowledgeの`id`をそのまま返す値なので、こちらはサーバー側で書き換えません。
5. **structured output / 検証 / 再試行 / ログ / timeout**: Article Analysisと全く同じパターン（`z.toJSONSchema()`でJSON Schema化、`safeParse`で検証、1回だけ再試行、`[KnowledgeExtraction] ...`のログ、既存の30秒タイムアウトをそのまま利用）。`relationToExisting.type`に不正な値（enum外）が返ってきた場合もschema validation failureとして扱われ、他のフィールドの不備と同様に1回だけ再試行されます。
6. **confidenceのフィルタリングはこの層では行いません**: `knowledgeExtraction.vertex.ts`はLLMが判定した`confidence`（`low`/`medium`/`high`）をそのまま返します。「確認UIには`low`を出さない」というUX判断は、呼び出し側の`knowledgeApi.ts`（`filterForConfirmationUi()`）で行っています（MVPとしてシンプルにするための判断で、必要なら将来的にUI側の設定に変更できます）。
7. **テスト容易性**: Article Analysisと同じくフェイクの`LlmProvider`を注入して、正常系（idが生成されること）・`conversationHistory`の内容が実際にpromptに含まれること・`existingKnowledge`が空/未指定でも動作すること・`existingKnowledge`のid付き内容がpromptに含まれること・`relationToExisting`の4種類（`new`/`reinforces`/`extends`/`supersedes`）が受理されること・不正な`relationToExisting.type`が再試行されること・再試行成功/失敗・LLM呼び出しエラー（再試行しないこと）・markdownフェンス付きJSON・空配列の候補、を検証しています（`knowledgeExtraction.vertex.test.ts`）。

## Knowledgeモデル: 「不変のメモ」ではなく「現在の理解状態」

Diggerのゴールは「Knowledgeを増やすこと」ではなく「ユーザーの理解状態を表現し、更新していくこと」です。これを支えるため、Knowledgeには`status`と`relationToExisting`という2つの概念を導入しています（今回はどちらも**判定・記録するところまで**で、自動的な統合や書き換えは行いません）。

- **`status`**（`knowledge.ts`の`knowledgeStatusSchema`）: `active`（現在の理解として利用する）/ `foundational`（十分理解され暗黙の前提として扱える）/ `merged`（より上位のKnowledgeへ統合された）/ `outdated`（後から得た理解で置き換えられた）の4値。新規保存されるKnowledgeは常に`active`です。`foundational`/`merged`/`outdated`への遷移や自動昇格は**今回は一切実装していません**（`status`フィールドと、それをUIの表示・Deep Diveでの利用対象から除外する読み取りロジックだけを用意した状態です）。既存ドキュメントに`status`が無い場合は`getEffectiveStatus()`が`"active"`として扱うため、後方互換性は保たれます。
- **`relationToExisting`**（Knowledge Extraction時にLLMが判定。`llm/knowledgeExtraction.ts`の`knowledgeRelationSchema`）: 新しいcandidateが既存Knowledgeに対してどう関係するかを`new`（既存にはない新しい理解）/ `reinforces`（別の文脈での再確認・強化。表現違いレベル）/ `extends`（既存を前提にさらに理解が広がっている）/ `supersedes`（既存が不正確・古く、今回の理解で置き換えるべき）の4種類で判定します。`{ type, knowledgeId?, reason? }`という形で、対応する既存Knowledgeの`id`と短い理由も保持できます。

## Knowledge保存とMongoDB（`knowledge.ts` / `knowledgeApi.ts`）

Deep Dive会話から抽出された候補（`KnowledgeCandidate`）のうち、**ユーザーが確認して選択したものだけ**をMongoDBへ永続化します。「AIが勝手に理解を確定・保存しない」という方針を、抽出（LLM）と保存（ユーザー操作起点のAPI呼び出し）を別のリクエストに分けることで担保しています。

- **認証は未実装（MVP）**: すべてのKnowledgeは固定の`userId: "local-user"`（`knowledge.ts`の`FIXED_USER_ID`）に紐づきます。複数ユーザーの分離は将来の認証実装時に対応します。
- **コレクション**: `user_knowledge`（DBは`MONGODB_DB_NAME`環境変数、既定`digger`）。ドキュメント形は`{ _id, userId, concept, statement, evidence, confidence, status, source: { type, url, title }, relatedKnowledgeIds?, relationsOut?, topicPath?, createdAt, updatedAt }`。`status`/`relatedKnowledgeIds`/`relationsOut`/`topicPath`はすべて`optional`のzod schemaにしており、これらが無い既存ドキュメントもそのまま`knowledgeDocumentSchema.parse()`に通ります（`relationsOut`/`topicPath`は「自分の理解」ページ用に今回追加。詳細は後述）。MVPのため、インデックス定義やスキーマバリデーション（MongoDB側の`$jsonSchema`等）は行わず、アプリケーション側のzod schemaでのみ形を保証しています。
- **重複判定・関係に基づく保存の扱い**: `saveMultipleKnowledge()`は各candidateについて上から順に次を評価します。①`relationToExisting.type === "reinforces"`なら無条件にスキップ（`shouldSkipAsReinforcement()`）。②同じ`userId`+`concept`完全一致のドキュメントの中に、`statement`を正規化（`normalizeForDedup()`）した上で完全一致するものがあればスキップ（`isDuplicateKnowledge()`）。③どちらにも該当しなければ（`new`/`extends`/`supersedes`はここに来る）、`status: "active"`の新しいドキュメントとして保存し、`relationToExisting.knowledgeId`があれば`relatedKnowledgeIds`にそのidを記録します（`buildRelatedKnowledgeIds()`）。**`supersedes`の場合でも、今回は参照元の既存Knowledgeを自動で`outdated`へ変更しません**（次のステップの設計課題）。スキップされた件数は`POST /api/knowledge/save`のレスポンス（`skippedCount`）でフロントエンドに伝わり、「N件は既に保存済みのためスキップしました」という控えめなフィードバックに使われます。
- **`knowledgeApi.ts`**: `POST /api/knowledge/extract`と`POST /api/knowledge/save`のリクエスト検証（zod）・組み立てロジック。`extractKnowledgeRequestSchema`は`articleAnalysisSchema`（`llm/articleAnalysis.ts`）をそのまま使ってバリデーションするため、`articleAnalysis`の形が不正なリクエストは`400`になります。`saveKnowledgeRequestSchema`は`knowledgeCandidateSchema`（`id`・`relationToExisting?`を含む）をそのまま使うため、フロントエンドは`/api/knowledge/extract`のレスポンスに含まれる候補をそのまま（ユーザーが選んだものだけ）送り返すだけで済みます。
- **確認UI向けの変換（`knowledgeApi.ts`）**: DiggerはKnowledge Candidateを「保存する知識一覧」ではなく「今回の会話で理解がどう変化したか」として見せたいため、LLMの生の`relationToExisting`をそのままUIに渡さず、`/api/knowledge/extract`のレスポンス時点で変換しています。
  - `toDisplayCategory(candidate)`: `relationToExisting.type`を表示用の`displayCategory`（`new`/`deepened`/`updated`）に変換（`extends`→`deepened`、`supersedes`→`updated`、それ以外（`new`または未設定）→`new`）。
  - `shouldShowForConfirmation(candidate)`: `reinforces`と判定された候補を確認UIの一覧からそもそも除外する（`filterForConfirmationUi()`内で適用）。「既に理解しているのに、なぜ確認・保存を求められるのか」がユーザーから見て分かりにくいための判断で、除外するだけで`reinforceCount`等のDB更新はまだ行いません。
  - `attachRelatedKnowledge(candidates, existingKnowledge)`: `relationToExisting.knowledgeId`が指す既存Knowledgeの`concept`/`statement`を`relatedKnowledge`として付与する。frontendはこれを使って「以前の『◯◯』から理解が深まりました」（`deepened`）や、「以前の理解 / 今回の理解」の比較（`updated`）を表示できる。
  - この変換は`filterForConfirmationUi(result)`→`attachRelatedKnowledge(...)`という2段階のパイプラインで、`buildKnowledgeExtractionResponse()`から呼ばれます（`ConfirmationResult` / `ConfirmationCandidate`型）。

## Relevant Knowledge Retrievalと、Deep DiveでのKnowledgeの再利用（`llm/knowledgeRetrieval.ts`）

保存済みKnowledgeを次のDeep Diveで活かすための処理です。「毎回全KnowledgeをLLMへ無条件に送る」ことを避けるため、質問・記事内容に関連しそうなものだけを3〜5件程度に絞り込む、独立した責務として`KnowledgeRetrievalService`インターフェース（`{ question, articleAnalysis, knowledge } → UserKnowledge[]`）を切り出しています。

- **呼び出し元**: `deepDive.ts`（backend直下）の`createBuildDeepDiveResponse()`。クライアントが`userKnowledge`を渡さなかった場合のみ、`defaultResolveUserKnowledge()`が①`knowledge.ts`の`getKnowledgeForDeepDive()`（`status: active`/`foundational`のみ。`isEligibleForDeepDive()`でフィルタ）でMongoDBから取得し、②`hybridKnowledgeRetrievalService`で絞り込んでから、Deep Diveへ渡します。取得・絞り込みのどちらかが失敗しても例外を投げず`undefined`にフォールバックするため、Deep Dive自体は常に従来通り動作します（Knowledge 0件の場合も同様）。
- **`keywordKnowledgeRetrievalService`**（1段目、LLM不要で高速）: concept文字列がquestionに部分一致するか（+3点）、articleAnalysis.conceptsの名前・説明と一致するか（+1〜2点）、questionとstatementの単純なトークン一致（+1点/token）でスコアリングし、スコア0（無関係）を除外した上で上位`MAX_RELEVANT_KNOWLEDGE`（5件）だけを返します。
- **`hybridKnowledgeRetrievalService`**（2段目、`createHybridKnowledgeRetrievalService(getProvider)`）: まず`keywordKnowledgeRetrievalService`を試し、1件でもヒットすればそれをそのまま採用します（LLM呼び出しなし）。**キーワード一致が0件だった場合のみ**、Geminiに候補一覧（`[id] concept: statement`）・質問・記事要約を渡し、関連するidを選ばせる軽量なフォールバック呼び出しを1回だけ行います。これは「利上げ」⇔「政策金利」のような、キーワード一致だけでは拾えない言い換えを補うためです（実際に`LLM_PROVIDER=vertex`で検証し、キーワード一致だけでは拾えなかったこのケースをLLMフォールバックが正しく拾うことを確認しました）。この呼び出しは構造化出力＋zod検証は行いますが、**再試行はしません**（失敗時は例外を投げず空配列にフォールバックするだけで十分なため）。`getProvider`の遅延解決・注入は他の実LLM実装と同じパターンで、テストではフェイクの`LlmProvider`を注入しています。
- **Deep Diveプロンプトへの反映**（`llm/deepDive.vertex.ts`）: 選定されたKnowledgeが1件以上ある場合のみ、「ユーザーが過去の会話で理解したと確認済みの内容」というセクションをプロンプトに追加します（0件なら**セクションごと省略**）。文面は「同じ内容を初歩から繰り返し説明する必要はない」「関連性が高い場合は自然につながりを示してよいが、毎回答で無理に言及する必要はない」という、言及を強制しないガイドとして書いており、`deepDive.vertex.test.ts`でこのガイド文言の有無・過去理解の内容がプロンプトに実際に含まれることをテストしています。
- **将来Embedding/Vector Searchへ差し替える場合**: `KnowledgeRetrievalService`interfaceを実装する新しいファイルを追加し、`deepDive.ts`の`hybridKnowledgeRetrievalService`への依存を差し替えるだけで済む構造にしています。

## 「自分の理解」ページとKnowledge Topic分類（`llm/knowledgeTopic.ts`）

frontendの「自分の理解」ページ（最近／トピック／マップの3ビュー）は、既存の`GET /api/knowledge`をそのまま再利用しています。このAPIのためだけの大規模なbackend変更は行わず、追加したのは「トピックビュー用にKnowledgeへ`topicPath`を付与する」処理と、「マップビュー用に関係の種別（`extends`/`supersedes`）を保持する」フィールドだけです。

- **トピック分類（`llm/knowledgeTopic.ts` / `.mock.ts` / `.vertex.ts` / `knowledgeTopicFactory.ts`）**: 正規化されたTopicコレクション（`KnowledgeTopic { id, name, parentId? }`のような形）は作らず、各Knowledgeドキュメントに`topicPath: string[]`（例:`["経済","金融政策","政策金利"]`、最大3階層）を直接持たせるだけの単純な構造にしました。理由は、現状のデータ量・要件では正規化されたコレクション（孤立ノードの掃除やid管理が必要になる）を導入するほどの複雑さが正当化できないためです。frontend側で`topicPath`が共通する接頭辞ごとにグルーピングして木構造を組み立てます（`UnderstandingPage.tsx`の`buildTopicTree()`）。
- **分類のタイミング（毎回全KnowledgeをLLMへ送らない）**: `knowledge.ts`の`assignTopicsToUnclassified()`が、`topicPath`未設定のKnowledgeが1件でもあれば、それらだけをまとめて1回のLLM呼び出しで分類し、結果をDBへ書き戻します（既存の`topicPath`一覧も参考情報として渡し、同じテーマに毎回違う名前が付かないよう配慮）。一度分類されたKnowledgeは次回以降このLLM呼び出し自体が発生しません。`GET /api/knowledge`（`knowledgeApi.ts`の`fetchUserKnowledge()`）は`getUserKnowledgeWithTopics()`を呼ぶことで、一覧取得のたびに未分類分だけを遅延分類してから返します。分類に失敗しても例外を投げず、該当Knowledgeは「未分類」のまま一覧取得自体は継続します。
- **マップビューの辺（`relationsOut`）**: 既存の`relatedKnowledgeIds`（idのみの配列）に加えて、`relationsOut: { knowledgeId, type: "extends" | "supersedes" }[]`を新設しました。`relatedKnowledgeIds`はこれまで書き込むだけで読み出す処理が無かったため、後方互換を保ったまま関係の種別も保持できるよう追加した形です（`knowledge.ts`の`buildRelationsOut()`。`new`/`reinforces`は対象Knowledgeを持たない、または保存自体されないため辺を作りません）。frontendはこの`relationsOut`をそのままReact Flowの辺として描画します。
- **既存データとの後方互換性**: `topicPath`・`relationsOut`はどちらも`knowledgeDocumentSchema`でoptionalにしており、これらのフィールドが無い既存ドキュメントも問題なく読み書きできます（`knowledge.test.ts`で検証）。

## LLMプロバイダー層（`llm/provider/`）

Article Analysis等の各LLM処理が「どのAIベンダーを使うか」を意識しないで済むよう、生成AI呼び出しそのものを抽象化する薄いレイヤーです。Article Analysisが最初にこの層を実際に使う処理になりました。

```ts
// llm/provider/llmProvider.ts
export type GenerateTextInput = {
  systemPrompt?: string;
  prompt: string;
  // 構造化出力(JSON)を要求する場合の標準JSON Schema。対応していないproviderは無視してよい。
  responseJsonSchema?: Record<string, unknown>;
};

export interface LlmProvider {
  generateText(input: GenerateTextInput): Promise<string>;
}
```

- **`llmProvider.ts`**: 上記の`LlmProvider` interfaceのみを定義。`ArticleAnalysisService`等の既存interfaceとは別レイヤー（既存interfaceは「記事を解析して構造化データを返す」というDigger固有の処理、`LlmProvider`は「テキストを1回生成する」という汎用的な処理）なので、新設しても既存interfaceの乱立にはあたりません。
- **`mockLlmProvider.ts`**: `MockLlmProvider`。受け取った`prompt`を埋め込んだ固定文言を返すだけで、外部通信は一切行いません。
- **`vertexGeminiProvider.ts`**: `VertexGeminiProvider`。[`@google/genai`](https://www.npmjs.com/package/@google/genai)（Googleの統一Gen AI SDK。Vertex AIとGemini Developer APIの両方に対応し、旧来の`@google-cloud/vertexai`はGemini 2.0以降の新機能を受け取らないため今回は不採用）を使い、`GCP_PROJECT_ID`/`GCP_LOCATION`/`GEMINI_MODEL`（すべて環境変数、コードにモデル名はハードコードしない）でVertex AI上のGeminiを呼び出します。認証は明示的なAPIキーではなくApplication Default Credentials（ADC）任せにしています（後述）。タイムアウトは`AbortController`で30秒に設定（`REQUEST_TIMEOUT_MS`）。
  - `responseJsonSchema`が渡された場合は`responseMimeType: "application/json"`と合わせて`generateContent()`のconfigに設定し、Geminiのnative構造化出力機能を使う。未指定の場合は通常のテキスト応答（`/api/llm/test`はこちらの経路）。
  - レスポンスの`usageMetadata`（`promptTokenCount`/`candidatesTokenCount`/`totalTokenCount`）を`console.log`でそのまま出力するだけの軽量なトークン使用量ロギングを行う（本文全文やcredentialは出力しない）。
  - `classifyVertexError()`という純粋関数でエラーを分類しています（ネットワークを使わないので単体テスト可能）: `AbortError`→`timeout`、HTTP `401`/`403`→`auth_failed`、HTTP `404`→`invalid_model`、ADC関連のエラーメッセージ→`auth_failed`、それ以外→`api_error`。呼び出し自体は成功したがテキストが空の場合は`empty_response`。
- **`llmProviderError.ts`**: `LlmProviderError`（`config_missing`/`auth_failed`/`invalid_model`/`timeout`/`api_error`/`empty_response`のいずれかの`code`を持つ）と、それを安全なHTTPレスポンス（ステータスコード＋汎用メッセージ）に変換する`toSafeApiResponse()`。**ユーザー向けレスポンスには元のエラーメッセージ（credentialや内部情報を含み得る）を含めず**、詳細はサーバーログにのみ出力します（`index.ts`の`console.error`）。
- **`llmProviderFactory.ts`**: `getLlmProvider()`が環境変数`LLM_PROVIDER`（`mock` | `vertex`、デフォルト`mock`）を見て、対応する`LlmProvider`実装を返すだけの単純なswitch文です。DIコンテナ等は導入していません。

## Vertex AI (Gemini) のセットアップ

`LLM_PROVIDER=vertex`で実際にGoogle Cloud Vertex AI上のGeminiを呼び出す場合に必要な手順です。`LLM_PROVIDER=mock`（デフォルト）のままであれば、この節の作業は不要です。

### 1. GCPプロジェクトを選択

Vertex AIを使うGoogle Cloudプロジェクトを用意し、プロジェクトIDを控えます（`gcloud projects list`または[Cloud Console](https://console.cloud.google.com/)で確認できます）。課金が有効なプロジェクトである必要があります。

### 2. Vertex AI APIを有効化

```bash
gcloud config set project <YOUR_PROJECT_ID>
gcloud services enable aiplatform.googleapis.com
```

（Cloud Consoleの場合は「Vertex AI API」を検索して有効化）

### 3. ローカル開発用のApplication Default Credentials設定

サービスアカウントキーJSONはリポジトリは元よりローカルにも保存せず、`gcloud` CLIが発行するApplication Default Credentials（ADC）を使います。

```bash
gcloud auth application-default login
```

ブラウザでの認証後、認証情報が`~/.config/gcloud/application_default_credentials.json`（macOS/Linux）に保存されます。このファイルは`.gitignore`済みの場所にあり、リポジトリには含まれません。`@google/genai`は`vertexai: true`で初期化するとこのADCを自動的に見つけて使うため、コード側でキーファイルのパスを指定する必要はありません。

自分のユーザーに`roles/aiplatform.user`相当の権限（Vertex AI呼び出し権限）が付与されている必要があります。権限がない場合はプロジェクトの管理者に付与を依頼してください。

### 4. 必要な環境変数

`backend/.env.example`にある以下をコピーして設定します（`cp .env.example .env`）。

| 変数名 | 説明 | 例 |
| --- | --- | --- |
| `LLM_PROVIDER` | `mock`（デフォルト）または `vertex` | `vertex` |
| `GCP_PROJECT_ID` | Vertex AIを使うGCPプロジェクトID | `digger-508713` |
| `GCP_LOCATION` | Vertex AIのリージョン（または`global`。後述） | `asia-northeast1` |
| `GEMINI_MODEL` | 使用するGeminiのモデルID | `gemini-2.5-flash`（コストと速度優先の実運用確認済み設定） |

モデルIDはコードにハードコードしていないため、新しいモデルが出た場合も環境変数の変更だけで切り替えられます。

**モデルの利用可否はリージョンごとに異なります。** 実際に`digger-508713`プロジェクトで検証した結果は以下の通りです（あくまで検証時点のスナップショットで、モデルの提供状況は変わります）。

| モデルID | `asia-northeast1` | `us-central1` | `global` |
| --- | --- | --- | --- |
| `gemini-2.5-flash` | ✅ | ✅ | ✅ |
| `gemini-2.5-flash-lite` | ❌ (404) | ✅ | 未検証 |
| `gemini-flash-latest` | ❌ (404) | ❌ (404) | ✅ |
| `gemini-3.5-flash-lite` | ❌ (404) | ❌ (404) | ✅ |

`GCP_LOCATION=global`という特別な値を指定すると、Vertex AIが利用可能なリージョンへ自動的にルーティングします。**新しいモデルほど、まず`global`でのみ提供され、その後個別リージョンに展開される傾向があります**（上表の`gemini-flash-latest`/`gemini-3.5-flash-lite`はこのパターン）。一方で`global`は「どの地理的リージョンで処理されるか」を自分で制御できないため、データレジデンシー要件がある場合は特定リージョンを指定してください。Diggerは現状そうした要件がないため、`asia-northeast1` + `gemini-2.5-flash`（両リージョン・`global`いずれでも動作確認済み）をひとまずの既定値としています。新しいモデルを試したい場合は`GEMINI_MODEL`（および必要なら`GCP_LOCATION=global`）を変更するだけで切り替えられます。

### 5. Docker環境から認証する場合の注意

ADCの認証情報ファイル（`~/.config/gcloud/`以下）はホストマシンにあるため、コンテナ内のプロセスからは何もしなければ見えません。Docker Composeで`LLM_PROVIDER=vertex`を試す場合は、このディレクトリをコンテナへ**読み取り専用でマウント**する必要があります。

```yaml
# docker-compose.yml の backend サービスに追加する例
services:
  backend:
    volumes:
      - ./backend:/app
      - backend_node_modules:/app/node_modules
      - ~/.config/gcloud:/root/.config/gcloud:ro # ADCをコンテナへ渡す（読み取り専用）
```

このリポジトリの`docker-compose.yml`にはデフォルトでこのマウントを含めていません（`gcloud`未導入の環境で`docker compose up`しても空ディレクトリが作られないようにするため）。Vertex AIをDocker経由で試す場合のみ、上記のように自分の環境で追記してください。またリポジトリ直下の`.env.example`を`.env`にコピーすると、`docker compose`が`LLM_PROVIDER`/`GCP_PROJECT_ID`/`GCP_LOCATION`/`GEMINI_MODEL`を読み込みます（`backend/.env`とは別ファイルです。Docker Composeの変数展開はプロジェクト直下の`.env`からのみ行われるため）。

コンテナ内のホームディレクトリがマウント先と一致している必要があります（このリポジトリの`backend/Dockerfile`は`node:22-slim`をベースにしており、`USER`指定がないためroot実行＝`HOME=/root`です。上記の`/root/.config/gcloud`はそれに合わせています）。

## 環境変数（`.env`）

`.env.example` をコピーして使用します。

| 変数名 | 説明 | デフォルト |
| --- | --- | --- |
| `PORT` | 待受ポート | `8787` |
| `MONGODB_URI` | MongoDB接続文字列 | `mongodb://localhost:27017` |
| `MONGODB_DB_NAME` | 使用するDB名 | `digger` |
| `FRONTEND_ORIGIN` | CORSで許可するオリジン（フロントエンドのURL） | `http://localhost:5173` |
| `LLM_PROVIDER` | 使用するLLMプロバイダー（`mock` または `vertex`） | `mock` |
| `GCP_PROJECT_ID` | Vertex AIを使うGCPプロジェクトID（`LLM_PROVIDER=vertex`時のみ必須） | 未設定 |
| `GCP_LOCATION` | Vertex AIのリージョン（`LLM_PROVIDER=vertex`時のみ必須） | 未設定 |
| `GEMINI_MODEL` | 使用するGeminiのモデルID（`LLM_PROVIDER=vertex`時のみ必須） | 未設定 |

いずれも `process.env` から直接読み込んでおり（`dotenv`等は未使用）、`npm run dev`（`tsx watch`）実行時にOS/シェル側で環境変数が読み込まれている前提です。Docker Compose経由の場合は `docker-compose.yml` の `environment` で注入されます（Vertex AI関連の変数は[前述](#vertex-ai-gemini-のセットアップ)の通りプロジェクト直下の`.env`から読み込まれます）。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | `tsx watch src/index.ts` — ソース変更を検知して自動再起動する開発サーバー |
| `npm run build` | `tsc -p tsconfig.json` — `dist/` にコンパイル（`*.test.ts` は除外） |
| `npm start` | `node dist/index.js` — ビルド済みファイルを実行（本番想定） |
| `npm test` | `tsx --test src/*.test.ts src/llm/*.test.ts src/llm/provider/*.test.ts` — Node.js標準の`node:test`ランナーでユニットテストを実行。**Vertex AIへの実際の通信は行わない**（`classifyVertexError`等の純粋関数のみテスト） |

## 依存関係

- `hono` — ルーティング・ミドルウェア（CORS）を提供するWebフレームワーク本体
- `@hono/node-server` — HonoのfetchハンドラをNode.jsの`http`サーバー上で動かすアダプター
- `mongodb` — MongoDB公式Node.jsドライバ
- `jsdom` — 取得したHTMLをパースしてDOMを構築するライブラリ（Node.js上でDOM APIを再現）
- `@mozilla/readability` — `jsdom`で構築したDOMから記事本文・タイトルを抽出するライブラリ（Firefoxリーダービューと同じエンジン）
- `@google/genai` — Google Cloudの統一Gen AI SDK。Vertex AI上のGeminiを`llm/provider/vertexGeminiProvider.ts`から呼び出すために使用（採用理由は[LLMプロバイダー層](#llmプロバイダー層llmprovider)を参照）
- `zod` — LLM入出力の型定義とruntime validationに使用（`llm/`配下）。Zod 4の`z.toJSONSchema()`（追加ライブラリ不要）で`articleAnalysisSchema`をJSON Schemaに変換し、Geminiのstructured output機能にそのまま渡している。テストは追加ライブラリなしでNode.js標準の`node:test`を使用
- `tsx` — TypeScriptをトランスパイルなしで直接実行する開発用ランナー（ウォッチモード対応）

`jsdom` はNode.js 22系を要求するため、ローカルで直接実行する場合もNode 22系が必要です（[ローカル起動](#ローカル起動)参照）。

## ローカル起動

```bash
cp .env.example .env
npm install
npm run dev
```

`http://localhost:8787/api/health` と `http://localhost:8787/api/health/db` で確認できます（MongoDBが別途起動している必要があります）。

LLMの疎通確認（`LLM_PROVIDER=mock`のままでも、`vertex`に設定してVertex AIの実際の応答を試す場合でも）は以下で行えます。

```bash
curl -X POST http://localhost:8787/api/llm/test \
  -H "Content-Type: application/json" \
  -d '{"message": "日本の中央銀行は何ですか？"}'
# => {"response":"..."}
```

## 記事取得が対応できないケース

- **JavaScriptレンダリングが必須のSPA**: 素の`fetch`でHTMLを取得するだけなので、クライアントサイドでDOMを組み立てるサイトは本文が空になり抽出失敗（`422`）になります（ヘッドレスブラウザ未導入）。
- **ボット/クローラーブロック**: 固定のUser-Agent（`Digger/0.1 ...`、一般ブラウザへの偽装はしない）のみで、Cookie・JS実行・CAPTCHA回避などは行いません。403等で弾かれるサイトは`502`になります。
- **robots.txtで許可されていないページ**: `Disallow`に一致する場合は取得自体を行わず`403`を返します（[記事取得ポリシー](../README.md#記事取得ポリシー)参照）。
- **ログイン必須・有料会員限定コンテンツ**: 認証やペイウォール回避を行わないため、要約だけが取得され本文抽出に失敗する場合があります。
- **極端に短い記事・非文章系ページ**（本文200文字未満）: 抽出失敗として扱われます（閾値は`articleFetcher.ts`の`MIN_TEXT_LENGTH`）。
- **PDF・画像などHTML以外のドキュメント**: `content-type`チェックで`422`を返します。
- **localhost/private IP/link-local（クラウドメタデータ含む）を指すURL**: SSRF対策として`400`で拒否します。リダイレクトで内部ネットワークへ誘導しようとするケースも各ホップで検証するため防げます。

## 今後の拡張ポイント（未実装）

- `POST /api/llm/test`は開発用の疎通確認APIのため、他の処理の実LLM化が進んだら削除を検討する
- Deep Diveの会話履歴を要約してからpromptに含める（現状は直近`MAX_HISTORY_MESSAGES`（20件）を単純に切り詰めるだけで、それ以前の文脈は完全に失われる）
- 記事本文の切り詰め（`MAX_CONTENT_LENGTH`、現状12,000文字の単純な文字数カット）を、文の区切りを考慮した切り詰めや要約前処理に改善する
- Personalized Analysisを呼び出す導線（ユーザーの理解履歴のデータモデルが前提。`llm/personalizedAnalysis.ts`の型自体は`user_knowledge`コレクションと親和性があるので、実装自体は大きくないはず）
- JavaScriptレンダリングが必要なサイトへの対応（ヘッドレスブラウザの導入）
- 保存済みKnowledgeのきちんとした一覧UI（現状は動作確認用の暫定的なテスト表示のみ。詳細は[`frontend/README.md`](../frontend/README.md)を参照）
- Knowledge Extractionの重複判定をEmbedding/Vector Searchベースの意味的な類似度判定に強化する（現状は文字列の正規化一致のみで、言い回しが変わると重複として検出できない）
- Knowledge ExtractionをArticle Analysisの深掘りだけでなく、記事を読んだだけ（Deep Diveなし）のケースにも広げるかどうかの検討（現状は会話ログが前提）
- **Knowledgeの自動統合**: `relationToExisting`（`extends`/`supersedes`）を判定・保持するところまでは実装済みだが、それを使って実際に既存Knowledgeを`merged`/`outdated`へ自動遷移させたり、statementを書き換えたりする処理は未実装（意図的にスコープ外とした。ユーザーに見せずに理解状態を書き換えることの是非を含め、次のステップで設計する必要がある）
- **reinforcesの活用**: 現状は確認UIから除外するだけで終わっており、`reinforceCount`（再確認された回数）・`lastReinforcedAt`・`confidence`の自動補強といったフィールド/ロジックは未実装（MongoDBのschema・保存ロジックともに変更なし）
- **`active`→`foundational`への自動昇格**: 「何度も正しく利用された」「複数の理解の前提になった」等の基準でKnowledgeを`foundational`へ昇格する仕組み（`status`フィールド自体は用意済み）
- **Relevant Knowledge Retrievalの精度向上**: 現状はキーワード一致→（0件のときのみ）LLMフォールバックという2段構え。LLMフォールバックは言い換えを拾えるが、質問のたびに追加のLLM呼び出しが発生し得るコスト・レイテンシ増を伴う。Embedding/Vector Searchへの置き換えは`KnowledgeRetrievalService`interfaceを実装する新しいファイルを追加するだけで済む構造にしている
- Knowledge一覧の`GET /api/knowledge`に`status`でのフィルタ（例: `foundational`以上だけ表示等）を追加する
- ルーティングが増えた場合の分割（現状は `index.ts` に直書き）
- リクエストバリデーションの共通化（Honoの `@hono/zod-validator` 等。`llm/`ではすでにzodを導入済み）
- MongoDBのインデックス定義（`user_knowledge`の`{ userId, concept }`や`{ userId, createdAt }`など。現状は件数が少ない前提でインデックス未設定）
- エラーハンドリングの共通化（現状は各ルートでtry/catch）
- frontend/backend間で重複しているリクエスト/レスポンス型の共有化
- `robots.ts`のパーサはAllow/Disallowのみ対応。ワイルドカード（`*`, `$`）や`Crawl-delay`など、より厳密なrobots.txt仕様への対応

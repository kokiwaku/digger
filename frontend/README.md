# digger-frontend

React + Vite + TypeScript 製のSPA。バックエンド（Hono API）に `fetch` で直接アクセスします。

## ディレクトリ構成

```
frontend/
├── index.html       # Viteのエントリーhtml。#root にReactをマウント
├── src/
│   ├── main.tsx      # Reactのエントリーポイント（createRoot）
│   ├── App.tsx        # アプリ本体。URL入力〜「掘る」結果表示のUI
│   ├── App.css          # App.tsx のスタイル
│   ├── types.ts          # /api/dig のリクエスト/レスポンス型
│   └── vite-env.d.ts   # Vite用の型定義（import.meta.env等）
├── Dockerfile
├── vite.config.ts
└── tsconfig.json
```

## アーキテクチャ

```mermaid
flowchart TD
    A["index.html<br/>#root"] --> B["main.tsx<br/>ReactDOM.createRoot"]
    B --> C["App.tsx"]
    C -->|"入力状態(url)<br/>結果状態(DigState)"| C
    C -->|"POST /api/dig<br/>{ url }"| F["Backend API<br/>VITE_API_BASE_URL"]
    F -->|"200: DigResult / 4xx,5xx: error"| C
    C --> G["Pre-chat Primary View<br/>タイトル/短い要約/前提の一言/<br/>「気になることを聞いてみる」入力欄"]
    G -.->|"ヒントを見る / 背景を見る"| G2["補助UI（初期は非表示）<br/>deepDiveQuestions / whyItMatters全文 /<br/>concepts全件 / connections / entities"]
    C -->|"最初の質問を送信 → hasStartedChat=true"| C
    C -->|"POST /api/deep-dive<br/>{ articleAnalysis, question, conversationHistory }"| F
    F -->|"200: DeepDiveResponse / 4xx,5xx: error"| C
    C --> H["Chat View（記事情報カードは非表示）<br/>User吹き出し + Digger本文（プレーンテキスト）+<br/>「次の問いを見る」で隠れたsuggestedFollowUps"]
```

- **`main.tsx`**: `App` を `React.StrictMode` でラップしてDOMにマウントするだけの薄いエントリーポイント。
- **`App.tsx`**:
  - `API_BASE_URL` は `import.meta.env.VITE_API_BASE_URL`（未設定時は `http://localhost:8787` にフォールバック）。
  - フォームでURLを入力し「掘る」を押すと `digUrl()` が `POST /api/dig` を呼び出します。バックエンドが実際にURLへアクセスして抽出した`title`と、Article Analysis（backendの`LLM_PROVIDER`に応じてモックまたはVertex AI Geminiによる実解析）の結果が表示されます。ローディング中は「記事を読み解いています…」と表示します。
  - 状態は `DigState`（`idle` / `loading` / `error` / `success`）という判別可能なユニオン型1つで管理し、状態管理ライブラリは使わず `useState` のみです。
  - **情報カード中心からチャット中心へ**: Diggerの差別化は「大量のカードや機能を見せること」ではなく「今読んでいる記事を理解している」「会話から理解を深める」という裏側の体験にある、という方針のもと、表側のUIは`hasStartedChat`（`messages.length > 0`から導出。stateとしては持たない）を境に2つの画面に分かれます。**ArticleAnalysisのデータ自体・`DeepDiveInput`/`DeepDiveResponse`の型は変更していません**（表側は簡素化、裏側に渡すコンテキストは従来通り豊富なまま）。
    - **Pre-chat Primary View**（`!hasStartedChat`）: 主役は「気になることを聞いてみる」という見出し＋自由入力欄＋「掘り下げる」ボタンです。記事情報としては、`summary`の冒頭3文だけの短い要約（`firstSentences()`というローカル関数で文末（。！？）区切りに冒頭N文だけ切り出す）と、`concepts`の名前だけを「この記事の前提: 政策金利 ・ 金利差 ・ ...」という1行に並べた軽い表示のみを常時表示します。`whyItMatters`・`concepts`の説明文・`connections`・`entities`・`deepDiveQuestions`はここでは一切出しません。
    - **補助UI**（初期は非表示、Pre-chat Primary Viewのみに存在）: 「質問が浮かばないときはヒントを見る」を押すと`deepDiveQuestions`が候補ボタンとして展開されます（クリックでその質問がそのまま深掘り開始）。「記事の背景を見る」を押すと、`whyItMatters`全文・`concepts`全件（名前＋説明）・`connections`・`entities`をまとめた詳細パネルが開きます。ユーザー自身の疑問を先回りしないよう、どちらも既定では閉じています。
    - **Chat View**（`hasStartedChat`）: 最初の質問を送った瞬間、記事情報のカード・ヒント・背景パネルは全て非表示になり、画面はチャットのみになります（タイトル行だけは記事の目印として残す）。ユーザーの発言は右寄せの吹き出し、Diggerの回答はカードや枠を持たない地の文（ChatGPTに近い見た目）で表示します。回答についてくる`suggestedFollowUps`はメッセージごとに既定で隠しており、「次の問いを見る」を押した場合のみ候補ボタンとして表示します（`revealedFollowUps: Set<number>`でメッセージ単位に開閉を管理）。AIが会話の方向を常時提示し続けないようにするためです。
    - 「次に掘るなら」の質問ボタン、ヒントの`deepDiveQuestions`ボタン、回答内の`suggestedFollowUps`ボタン、自由入力欄のいずれから質問しても、同じ`handleDeepDive(questionText)`関数が呼ばれ、同じ`askDeepDive()`（`POST /api/deep-dive`）を叩きます。送信のたびに、それまでの`messages`を`{ role, content }[]`に変換して`conversationHistory`として一緒に送ります（backendへ渡す文脈の豊富さは変えていません）。ページ遷移はせず、`messages`にユーザーの質問とDiggerの回答を追記していくだけです。深掘り用のローディング/エラー状態は`DeepDiveState`という別のstateで、記事解析の`DigState`とは独立しています。
  - エラー時はバックエンドが返した `error` メッセージ、またはネットワークエラーの内容を表示します（`400`/`403`/`422`/`502`いずれも同じ見た目で表示、種別による出し分けは未実装）。
- **`types.ts`**: `/api/dig`・`/api/deep-dive` のレスポンス型（`DigResult` / `DigSource` / `ArticleAnalysis` / `Concept` / `Entity` / `Connection` / `ConversationTurn` / `DeepDiveResponse`）を定義。backend側の `src/types.ts`・`src/llm/*.ts` と同じ形を手動で同期しています（共有パッケージ化はまだしていません）。チャットUI用の`ChatMessage`型（`ConversationTurn`に`suggestedFollowUps`を加えたもの）は`App.tsx`内にのみ存在するローカル型で、`types.ts`には含めていません。
- **`App.css`**: 余白の広いシンプルなレイアウト。`flex-wrap` と相対単位でスマホ幅でも崩れないようにしています。CSSフレームワーク等は未導入です。

## 環境変数（`.env`）

`.env.example` をコピーして使用します。Viteの仕様上、クライアントに埋め込まれる変数は `VITE_` プレフィックスが必須です。

| 変数名 | 説明 | デフォルト |
| --- | --- | --- |
| `VITE_API_BASE_URL` | バックエンドAPIのベースURL | `http://localhost:8787` |

ビルド時に値が埋め込まれるため、Docker Compose経由でも `docker-compose.yml` の `environment` で渡した値を反映するには開発サーバー（Vite dev server）の再起動が必要です。

## スクリプト

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | `vite --host` — 開発サーバー起動（HMR対応、`--host` でLAN内からもアクセス可） |
| `npm run build` | `tsc -b && vite build` — 型チェック後に本番ビルド |
| `npm run preview` | ビルド成果物をローカルでプレビュー |

## 依存関係

- `react` / `react-dom` — UIライブラリ本体
- `@vitejs/plugin-react` — Viteの公式Reactプラグイン（Fast Refresh対応）
- `vite` — 開発サーバー/バンドラー
- `typescript` — 型チェック（`tsc -b` はビルド時のみ実行、Vite自体はesbuildでトランスパイル）

## ローカル起動

```bash
cp .env.example .env
npm install
npm run dev
```

`http://localhost:5173` を開き、URL入力欄に記事URLを入れて「掘る」を押すと、実際に取得したタイトルとArticle Analysisの解析結果が表示されます（backendが`LLM_PROVIDER=mock`なら日銀の利上げに関する固定デモデータ、`LLM_PROVIDER=vertex`なら実際の記事内容に応じたVertex AI Geminiの解析結果）。バックエンドが起動していない、またはURLが不正だとエラーメッセージが表示されます。その下の「他に気になることは？」欄から自由入力、または「次に掘るなら」の質問ボタンをクリックすると、その場でチャット形式の深掘りができます（Deep Diveは現状もモック応答）。

## 今後の拡張ポイント（未実装）

- Chat Viewでも「記事の背景を見る」相当の情報に戻れる導線（現状は最初の質問を送ると記事情報には一切戻れない）
- 会話から理解したことを蓄積するUI（backendのKnowledge Extractionが実LLM化・接続された後に追加）
- エラー種別（`400`/`403`/`422`/`502`）に応じたUIの出し分け（現状は全て同じ見た目）
- 深掘りの会話をリロード後も残すための永続化（現状はページをリロードすると消える）
- ルーティング（現状はApp.tsx単一ページ）
- 状態管理ライブラリ（現状はuseStateのみ）
- UIコンポーネントの共通化・デザインシステム導入
- APIクライアントの共通化（現状は `digUrl` 関数に `fetch` 直書き）
- frontend/backend間で重複しているレスポンス型の共有化

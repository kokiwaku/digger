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
    F -->|"200: DigResult / 400: error"| C
    C --> G["結果表示<br/>タイトル/要約/なぜ重要か/前提知識カード"]
```

- **`main.tsx`**: `App` を `React.StrictMode` でラップしてDOMにマウントするだけの薄いエントリーポイント。
- **`App.tsx`**:
  - `API_BASE_URL` は `import.meta.env.VITE_API_BASE_URL`（未設定時は `http://localhost:8787` にフォールバック）。
  - フォームでURLを入力し「掘る」を押すと `digUrl()` が `POST /api/dig` を呼び出します。バックエンドが実際にURLへアクセスして抽出した`title`が表示されます（`summary`/`whyItMatters`/`backgroundKnowledge`はまだ固定のモック値）。
  - 状態は `DigState`（`idle` / `loading` / `error` / `success`）という判別可能なユニオン型1つで管理し、状態管理ライブラリは使わず `useState` のみです。
  - 成功時はレスポンス（`DigResult`）のタイトル・要約・なぜ重要か・前提知識（カード風の `<button>` 一覧）を順に表示します。前提知識カードはクリックしても現状は何も起きません（深掘り導線は未実装）。
  - エラー時はバックエンドが返した `error` メッセージ、またはネットワークエラーの内容を表示します。
- **`types.ts`**: `/api/dig` のレスポンス型（`DigResult` / `DigSource` / `BackgroundKnowledge`）を定義。backend側の `src/types.ts` と同じ形を手動で同期しています（共有パッケージ化はまだしていません）。
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

`http://localhost:5173` を開き、URL入力欄に記事URLを入れて「掘る」を押すと、バックエンドからのモック解析結果が表示されます。バックエンドが起動していない、またはURLが不正だとエラーメッセージが表示されます。

## 今後の拡張ポイント（未実装）

- 前提知識カードをクリックした際の深掘り（関連トピックの掘り下げ）導線
- ルーティング（現状はApp.tsx単一ページ）
- 状態管理ライブラリ（現状はuseStateのみ）
- UIコンポーネントの共通化・デザインシステム導入
- APIクライアントの共通化（現状は `digUrl` 関数に `fetch` 直書き）
- frontend/backend間で重複しているレスポンス型の共有化

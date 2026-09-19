# digger-frontend

React + Vite + TypeScript 製のSPA。バックエンド（Hono API）に `fetch` で直接アクセスします。

## ディレクトリ構成

```
frontend/
├── index.html       # Viteのエントリーhtml。#root にReactをマウント
├── public/
│   └── assets/         # 静的アセット（ビルド時にそのままdist直下へコピーされる）
│       ├── digger-mole-dig.gif          # 「掘る」ローディング表示用のモグラアニメーション
│       ├── digger-mole-dig-spritesheet.png  # 元素材（今回は未使用）
│       └── frames/
│           ├── mole-dig-1.png〜4.png       # 掘るモグラの静止フレーム（prefers-reduced-motion時にmole-dig-1.pngを使用）
│           ├── mole-icon.png               # ロゴ横アイコン/ファビコン用（mole-dig-1.pngを透明余白なしに切り抜いたもの）
│           └── mole-note-1.png〜4.png      # Knowledge Extraction用「ノートに書き込むモグラ」の静止フレーム（NoteMoleLoaderがsetIntervalで順番に切り替え）
├── src/
│   ├── main.tsx      # Reactのエントリーポイント（createRoot、BrowserRouterでApp全体をラップ）
│   ├── App.tsx        # ルート定義のみ（AppShellの中に/dig・/understanding/*をマウントする）
│   ├── AppShell.tsx    # アプリ全体の骨格。左Navigation（サイドバー/モバイルはボトムナビ）＋Main Content
│   ├── DigPage.tsx     # 「掘る」ページ本体（Composer部分のみ）。URL/テキスト/画像入力〜Article Analysis取得までを担当し、結果表示以降はDeepDiveSessionに委譲
│   ├── DeepDiveSession.tsx # Deep Dive会話〜Knowledge Extraction〜確認〜保存の共通UI。DigPage.tsxとEntityDigPage.tsxの両方から使われる
│   ├── EntityDigPage.tsx   # 「自分の理解」画面のConcept/Topicを起点に再び掘るための画面（ConceptDigPage/TopicDigPage）。Composerを持たず、DeepDiveSessionのみを表示
│   ├── digOrigin.ts        # Concept/Topic起点のDeep Diveに必要な「合成ArticleAnalysis」「DigSource」「見出し/導入メッセージ」を構築する純粋関数
│   ├── UnderstandingPage.tsx  # 「自分の理解」ページ（最近/トピック/マップのsecondary navigation、Knowledge詳細モーダル）
│   ├── UnderstandingMapView.tsx # 「マップ」タブの実体。Topic/Concept/ConceptRelationモデルによる3ペインMap UI（Concept/Topic Detail Panelから「掘る」への導線を含む）
│   ├── mapLayout.ts       # dagreによるMapの階層レイアウト計算（Reactに依存しない純粋ロジック）
│   ├── TopicNode.tsx      # React FlowのCustom Node（Root Topic / Subtopic共用の丸node）
│   ├── ConceptNode.tsx    # React FlowのCustom Node（Concept node本体。Map上のnodeはTopic系とこれのみ）
│   ├── sourceLabel.ts     # DigSource（URL/テキスト/画像）の表示用title・fallback文言を1箇所にまとめる
│   ├── App.css          # App.tsx・UnderstandingPage.tsx・UnderstandingMapView.tsx共通のスタイル
│   ├── types.ts          # /api/dig 等のリクエスト/レスポンス型
│   └── vite-env.d.ts   # Vite用の型定義（import.meta.env等）
├── Dockerfile
├── vite.config.ts
└── tsconfig.json
```

## アーキテクチャ

```mermaid
flowchart TD
    A["index.html<br/>#root"] --> B["main.tsx<br/>ReactDOM.createRoot + BrowserRouter"]
    B --> Ap["App.tsx<br/>Routes定義のみ"]
    Ap --> Sh["AppShell.tsx<br/>左Navigation + Main Content"]
    Sh -->|"/dig"| C["DigPage.tsx"]
    Sh -->|"/dig/concept/:id, /dig/topic/:id"| Ed["EntityDigPage.tsx<br/>(ConceptDigPage / TopicDigPage)"]
    Sh -->|"/understanding/*"| Up["UnderstandingPage.tsx"]
    C --> Dd["DeepDiveSession.tsx<br/>(会話〜Extraction〜保存、共通)"]
    Ed --> Dd
    C -->|"入力状態(url)<br/>結果状態(DigState)"| C
    C -->|"POST /api/dig<br/>{ url }"| F["Backend API<br/>VITE_API_BASE_URL"]
    F -->|"200: DigResult / 4xx,5xx: error"| C
    C --> G["Pre-chat Primary View<br/>タイトル/短い要約（地の文）/<br/>「この記事について、何が気になりますか？」+ textarea"]
    G -.->|"前提知識を見る"| G2b["concepts名の一覧（クリックで個別に説明を展開）"]
    G -.->|"この記事の背景"| G2c["whyItMatters全文 / connections / entities"]
    C -->|"最初の質問を送信 → hasStartedChat=true"| C
    C -->|"POST /api/deep-dive<br/>{ articleAnalysis, question, conversationHistory }"| F
    F -->|"200: DeepDiveResponse / 4xx,5xx: error"| C
    C --> H["Chat View（記事情報カードは非表示）<br/>User吹き出し + Digger本文（プレーンテキスト）+<br/>自由入力欄のみ、AIからの次の質問提案は非表示"]
    H -->|"「今回残したいこと」クリック"| I["POST /api/memory/extract<br/>{ source, articleAnalysis, conversationHistory }"]
    I --> F
    F -->|"200: { candidates: MemoryCandidate[] }"| J["MemoryConfirmationPanel<br/>type別グループ・チェックボックス・編集・自分で追加"]
    J -->|"ユーザーが選択/編集/追加して保存"| K["POST /api/memory/save<br/>{ source, items(選択分のみ、origin付き) }"]
    K --> F
    F -->|"200: { savedCount, skippedCount, byType }"| L["小さな成功フィードバック<br/>（画面遷移なし、数秒で自動的に消える）"]
```

- **`index.html`**: ファビコン（`favicon-32x32.png` / `favicon-16x16.png` / `apple-touch-icon.png`、いずれも`public/`直下）を`<link>`で指定。3つとも`public/assets/frames/mole-icon.png`（後述）から`sips`で生成した派生物です。
- **`main.tsx`**: `App` を `React.StrictMode` と `BrowserRouter`（`react-router-dom`）でラップしてDOMにマウントするだけの薄いエントリーポイント。URLに対応したナビゲーション（direct URL access・ブラウザの戻る/進む）を実現するため、今回`react-router-dom`を導入しました。
- **`App.tsx`**: `AppShell`の中に`<Routes>`をマウントするだけの、ルート定義専用の薄いコンポーネントです。`/`は`/dig`へ`Navigate`、`/dig`は`DigPage`、`/dig/concept/:conceptId`は`ConceptDigPage`、`/dig/topic/:topicId`は`TopicDigPage`（いずれも`EntityDigPage.tsx`）、`/understanding/*`は`UnderstandingPage`（内部でさらにネストしたルートを持つ）にそれぞれ対応します。以前はこのファイルに「掘る」フローの全ロジック・JSXが集中していましたが（1ファイル700行超）、Navigation構造の変更に合わせて`AppShell.tsx`（骨格）と`DigPage.tsx`（「掘る」フロー本体）に分離しました。ロジックの切り出しは機械的なもので、`DigPage.tsx`側の挙動は分離前と変わっていません。
- **`AppShell.tsx`**（新規）: アプリ全体で共通の骨格。デスクトップでは左に固定サイドバー（`brand`/`tagline` + 「掘る」`/dig`・「自分の理解」`/understanding`への`NavLink`2つ）、右に`<main className="app-main">{children}</main>`という構成です。現在地は`NavLink`の`isActive`で判定し、下線ではなく控えめな背景色で示します（タブ的な強い強調は避ける方針）。ルート遷移のたびにこのコンポーネント自体が再マウントされることはなく（`App.tsx`の`<Routes>`は`AppShell`の**子**として描画される）、サイドバーの位置・幅は画面間で一切変化しません。`.app-main`は常に同じ`max-width: 1100px`を持ち、外枠の幅もルートに関わらず固定です（「掘る」の会話中心な狭いレイアウトは、`DigPage.tsx`内部の`.dig-page-inner { max-width: 640px; }`という内側ラッパーで実現しており、外枠自体は動きません）。モバイル（`max-width: 900px`、Understanding Map刷新時に導入した既存ブレークポイントを流用）ではサイドバーを`display: none`にし、代わりに画面下部固定のBottom Navigation（同じ2項目）と、ブランドロゴを表示する軽量な`.app-mobile-header`を表示します。
- **`DigPage.tsx`**（`App.tsx`から分離、内容は従来通り）:
  - タイトル「Digger」の左に`brand-icon`としてモグラのアイコン（`public/assets/frames/mole-icon.png`）を表示します（`alt=""` + `aria-hidden="true"`で装飾画像として扱い、スクリーンリーダーには読み上げさせません）。`mole-icon.png`は`mole-dig-1.png`（512x512、MoleLoaderの静止フレームと共用の元画像）から、透明ピクセルの外接矩形で切り抜いた上でその向きに合わせた最小限の余白のみを残したものです。元画像はキャラクター周囲の透明な余白が大きく、そのまま40px前後の小サイズで縮小表示するとキャラクターが小さく見えすぎる問題があったため、このアイコン専用に切り抜き直しました（`MoleLoader`側は96px/72pxと表示サイズが大きいため`mole-dig-1.png`のままで問題なく、変更していません）。ファビコンの3ファイルも同じ`mole-icon.png`から生成しています。（※ブランドアイコン自体は現在`AppShell.tsx`のサイドバー/モバイルヘッダー側に表示されます。この説明は元々のアイコン切り抜きの経緯として残しています。）
  - `API_BASE_URL` は `import.meta.env.VITE_API_BASE_URL`（未設定時は `http://localhost:8787` にフォールバック）。
  - **Composer（URL/テキスト/画像を1つの入力欄で受け付ける）**: Diggerは「URLを入れること」自体を価値にしないため、tab切り替えではなく1つのComposer（`<textarea>`＋画像添付ボタン＋「掘る」ボタン）で、URL・貼り付けテキスト・画像のいずれも受け付けます。URLかテキストかをユーザーに選ばせる必要はなく、送信時にbackendの`resolveInputSource()`が自動判定します（frontend側の`detectInputKind()`はローディング文言の出し分けだけに使う軽い判定で、最終的な判定はbackend側が権威を持ちます）。画像は`<input type="file" accept="image/jpeg,image/png,image/webp">`（隠し要素、「+ 画像を追加」ボタンから開く）で選び、選択直後にmime/サイズ（8MB）をclient側でも検証してから`URL.createObjectURL()`によるプレビューを表示します（実際にbackendへ送るのは「掘る」を押した時点で、`FileReader.readAsDataURL()`によりbase64化してから`POST /api/dig`の`image: { data, mimeType }`に載せます）。プレビュー用のオブジェクトURLは、画像の差し替え・削除・コンポーネントのアンマウント時に必ず`URL.revokeObjectURL()`で解放します。送信に成功したらComposerをクリアしますが、失敗時は入力し直せるようテキスト・画像とも残します。
  - `digContent({ input, image? })` が `POST /api/dig` を呼び出します。バックエンドが入力形式（URL/テキスト/画像）に応じて取得・解析し、Article Analysis（backendの`LLM_PROVIDER`に応じてモックまたはVertex AI Geminiによる実解析。画像はGeminiのマルチモーダル入力で直接解析され、OCR専用処理は別途実装していません）の結果が表示されます。ローディング中の`MoleLoader`（後述）のラベルは入力形式ごとに変えています（`LOADING_LABELS`）: URLは「記事を掘っています…」、テキストは「内容を整理しています…」、画像は「画像をじっくり見ています…」。
  - 状態は `DigState`（`idle` / `loading` / `error` / `success`）という判別可能なユニオン型1つで管理し、状態管理ライブラリは使わず `useState` のみです。
  - **`DigSource`の一般化**: 以前は`source`が常に`{type:"web_article",url,title}`固定でしたが、`text`/`image`という入力にはURLが無いため、`DigSource`（`frontend/src/types.ts`、backend側`knowledgeSource.ts`と対になる型）を判別可能なユニオンへ拡張しました。`text`/`image`には`title`が無いことがあるため、`sourceLabel.ts`の`sourceDisplayTitle()`が「テキスト入力」「画像入力」というfallback表示を1箇所にまとめ、`DigPage.tsx`（結果ヘッダー）・`UnderstandingPage.tsx`（一覧・詳細モーダル）・`UnderstandingMapView.tsx`（Detail Panel）の3箇所で共通利用しています。`source.type === "web_article"`のときだけ元記事へのリンクを表示し、それ以外はプレーンテキストで表示します（存在しないURLへリンクを張らないため）。
  - **情報カード中心から会話中心へ**: Diggerの差別化は「大量のカードや機能を見せること」ではなく「今読んでいる記事を理解している」「会話から理解を深める」という裏側の体験にある、という方針のもと、表側のUIは`hasStartedChat`（`messages.length > 0`から導出。stateとしては持たない）を境に2つの画面に分かれます。**ArticleAnalysisのデータ自体・`DeepDiveInput`/`DeepDiveResponse`の型は変更していません**（表側は簡素化、裏側に渡すコンテキストは従来通り豊富なまま）。
    - **AI主導の「次の質問」提案は一切表示しない**: `deepDiveQuestions`（記事解析結果）も`suggestedFollowUps`（Deep Dive回答）も、Diggerの「ユーザー自身の疑問を起点に掘る」という方針に反するため、UI上には一切表示しません。バックエンドは引き続き生成・返却しており、`DigResult`/`DeepDiveResponse`の型・schemaも変更していません（frontendが単に無視しているだけです）。次のアクションは常に自由入力のみです。
    - **Pre-chat Primary View**（`!hasStartedChat`）: 記事情報は`summary`の冒頭3文（`firstSentences()`というローカル関数で文末（。！？）区切りに冒頭N文だけ切り出す）を、カードや枠を持たない地の文として表示するだけです。主役は「気になることを聞いてみましょう」（以前は「この記事について、何が気になりますか？」でしたが、URL以外の入力にも自然な文言へ一般化しました）という一言の下にある大きめの`<textarea>`（`DeepDiveInputForm`コンポーネント、Enterで送信・Shift+Enterで改行）です。`whyItMatters`・`concepts`（名前を含め一切）・`connections`・`entities`はここでは一切出しません。
    - **補助UI**（初期は非表示、Pre-chat Primary Viewのみに存在。AI主導の質問提案とは無関係な、背景情報のみを扱う）: ①「前提知識を見る」→`concepts`の名前だけをプレーンテキストのリンク風の行として並べ（カード化しない）、`ConceptDisclosure`コンポーネントによりクリックした概念だけ説明文を展開する2段階の開示。②「背景を見る」（以前は「この記事の背景」）→`whyItMatters`全文・`connections`・`entities`をまとめたパネル。どちらも既定では閉じています。
    - **Chat View**（`hasStartedChat`）: 最初の質問を送った瞬間、記事情報・前提知識・背景パネルは全て非表示になり、画面はほぼ会話のみになります（タイトル行と、任意で開ける「要点を見る」（以前は「記事の要点を見る」）だけが目印として残る）。ユーザーの発言は右寄せの吹き出し、Diggerの回答はカードや枠を持たない地の文（ChatGPTに近い見た目）で表示するだけで、回答の下には何も続きません（`suggestedFollowUps`は受け取った`DeepDiveResponse`から読み捨てており、`ChatMessage`型にも保持しません）。
    - **自由入力欄（`DeepDiveInputForm`）**: pre-chat/chat両方で共有する小さなコンポーネントで、`<textarea rows={3}>`（横幅いっぱい、`resize: vertical`）＋送信ボタンで構成されます。Enterキー押下（Shift未併用）で送信、Shift+Enterで改行、送信中は入力欄・ボタンとも無効化、空文字は送信不可です。プレースホルダーは特定の質問例に寄せすぎないよう「分からないことを、そのまま書いてください」（pre-chat）「さらに気になることを入力してください」（chat）としています。
    - 自由入力欄から質問すると`handleDeepDive(questionText)`が呼ばれ、`askDeepDive()`（`POST /api/deep-dive`）を叩きます。送信のたびに、それまでの`messages`を`{ role, content }[]`に変換して`conversationHistory`として一緒に送ります（backendへ渡す文脈の豊富さは変えていません）。ページ遷移はせず、`messages`にユーザーの質問とDiggerの回答を追記していくだけです。深掘り用のローディング/エラー状態は`DeepDiveState`という別のstateで、記事解析の`DigState`とは独立しています。
    - **「今回残したいこと」（Memory Extraction）**: Chat Viewの入力欄の下に、控えめな`link-button`として表示されます（常時大きな保存UIは出さない方針。以前は「今回わかったことを残す」という文言でしたが、Knowledge以外も残せるようになったため一般化しました）。表示条件は`messages.some(m => m.role === "assistant")`（少なくとも1往復の会話があること）で、押すたびに`handleExtractMemory()`が`extractMemory()`（`POST /api/memory/extract`）を呼び、会話ログ全体（`messages`）を渡します。抽出中は`NoteMoleLoader`（後述、「残したいことを整理中…」）を表示します。
    - **候補確認パネル（`MemoryConfirmationPanel`）**: 見出しは「今回残したいこと」。返ってくる`MemoryCandidate[]`を`type`（`knowledge`/`preference`/`candidate`/`decision`/`open_question`）別にグルーピングし（`groupItemsByType()`）、候補が1件もないtypeの見出しは表示しません（`TYPE_LABELS`: 理解したこと/条件・好み/候補/決めたこと/未解決、`TYPE_ORDER`がこの順で並べる）。
      - `knowledge`型のみ、従来通り`displayCategory`（`new`/`deepened`/`updated`。`reinforces`はbackend側で候補一覧からそもそも除外済み）に応じて「以前の『◯◯』から理解が深まりました」のヒントや「以前の理解 / 今回の理解」の比較表示を出します（`MemoryItemRow`内、`item.displayCategory`で分岐）。他typeにはこの分岐は無く、`content`をそのまま表示するだけです。
      - `candidate`型は、`metadata.reasons`/`metadata.concerns`があれば「理由: 〜」「懸念: 〜」という控えめな1〜2行を追加表示します（`.memory-candidate-metadata`）。
      - **AI候補は編集できます**（`MemoryItemRow`内の「編集」トグル）。`knowledge`/`candidate`はtitle（短い名詞句）とcontent（本文）、`candidate`はさらにreasons/concerns（読点区切りのテキスト入力を`splitCommaList()`で配列化）を編集可能です。実際に値が変わった時点（`onUpdate`）で、その候補の`origin`が`ai_extracted`から`user_edited`へ切り替わります（編集フォームを開いただけでは切り替わりません）。
      - **「＋ 自分で追加」（`AddOwnItemForm`）**: type選択（5つのトグルボタン）＋内容（`<textarea>`）＋補足（任意の`<input>`、保存時は`reason`として送る）の小さなフォームです。「追加」を押すと`handleAddOwnMemoryItem()`が新しい`MemoryDraftItem`（`origin: "user_created"`、`confidence: "high"`、`id`は`crypto.randomUUID()`）を候補リストへ追加し、自動的に選択状態にします（AI候補を介さずユーザー自身で残したいことを追加できるようにするための入口）。
      - 選択状態は`Set<string>`（`memorySelectedIds`、候補/追加itemの`id`をキーにする）で管理し、1件以上選ぶと「保存する」ボタンが有効になります。**AIは自動保存しません**。`reason`・紐付け先の`knowledgeId`はUIには常時表示しません（内部的な判断材料として保持するのみ）。
      - 候補が0件の場合も（「AIからの候補はありませんでした。気になることがあれば、下から自分で追加できます。」という1文とともに）パネル自体は表示し続け、「＋ 自分で追加」から追加できるようにしています（AI候補の有無に保存機能全体を左右させないため）。
    - 保存を押すと`handleSaveSelectedMemory()`が`saveMemory()`（`POST /api/memory/save`）を呼び、選択された項目（AI候補も自分で追加した項目も同じ形、`origin`付き）を送ります。保存後のフィードバックは単純な「N件残しました」だけでなく、`describeSaveResult()`が選択項目のtype別件数から「6件残しました（条件・好み3件・候補2件・決めたこと1件）」のような1行の内訳を組み立てます（実際の保存件数と多少ずれる可能性がある簡易な実装で、backendが重複等でスキップした件数があれば「（M件は既に保存済みのためスキップしました）」も併記）。画面遷移はせず、パネルを閉じてチャット画面上に小さく表示し、4秒後に自動的に消えます。状態は`MemorySaveState`（`idle`/`extracting`/`extracted`/`saving`/`saved`/`error`）という1つの判別可能なユニオン型で管理します。
    - 保存失敗時は`error-message`で`error`メッセージを表示するのみで、チャット自体やそれまでの会話状態は壊れません（`memorySaveState`は独立したstateのため）。
  - エラー時はバックエンドが返した `error` メッセージ、またはネットワークエラーの内容を表示します（`400`/`403`/`422`/`502`いずれも同じ見た目で表示、種別による出し分けは未実装）。
  - **`MoleLoader`（掘るモグラのローディング表示）**: 通常のspinnerの代わりに、Diggerのキャラクター（スコップで掘るモグラ）のGIFアニメーションを表示するコンポーネントです。`public/assets/digger-mole-dig.gif`（96px、モバイルは72px。`@media (max-width: 480px)`で切り替え）とラベル文言を横並びで表示するだけの軽量な実装で、画面全体を覆うオーバーレイにはせず、処理中のセクション内に自然に差し込みます。3箇所で使用: ①`digUrl()`実行中（「記事を掘っています…」）、②Pre-chat Primary Viewでの初回Deep Dive送信中、③Chat Viewでの2回目以降のDeep Dive送信中（②③とも「もう少し掘っています…」、`deepDiveState.status === "loading"`から表示）。`usePrefersReducedMotion()`という小さなフックが`window.matchMedia("(prefers-reduced-motion: reduce)")`を監視し、有効な環境ではGIFの代わりに静止フレーム`public/assets/frames/mole-dig-1.png`を表示します。エラー時・完了時はstateが`loading`から外れるため、既存のローディング分岐の仕組みに乗る形でDOMから自動的に消えます（表示/非表示のロジック自体は変更していません）。
  - **`NoteMoleLoader`（ノートに書き込んで整理しているモグラのローディング表示）**: Knowledge Extraction専用のローディング表示で、`knowledgeSaveState.status === "extracting"`（`handleExtractKnowledge()`が`POST /api/knowledge/extract`のレスポンス待ちをしている間）にのみ表示されます。`MoleLoader`とは素材（GIF vs 静止PNG4枚）が異なるため別コンポーネントにしていますが、見た目・DOM構造は共通の`.mole-loader`/`.mole-loader-image`/`.mole-loader-label`クラスを再利用しており、サイズ（96px/72px）も`MoleLoader`と同じです。GIFを持たないため、`public/assets/frames/mole-note-1.png`〜`mole-note-4.png`という4枚の静止フレームを`setInterval`（`NOTE_FRAME_INTERVAL_MS = 350ms`）で単純に順番切り替えする方式（GIF化やスプライトシート化は行わず、新規ライブラリも導入していません）。`usePrefersReducedMotion()`が有効な場合はタイマー自体を起動せず、常に1枚目（`mole-note-1.png`）だけを表示します（`alt="Diggerがわかったことを整理しています"`）。`knowledgeSaveState`が`extracting`から`extracted`/`error`のいずれかに遷移した時点でコンポーネントごとアンマウントされ、`setInterval`は`useEffect`のクリーンアップで確実に解除されるため、成功時・失敗時ともにローディングが残り続けることはありません。ラベル文言（`label`プロップ）は呼び出し側で自由に変えられるため、将来`/api/knowledge/save`の保存中表示にも同じコンポーネントをそのまま再利用できます（今回はKnowledge Extractionの抽出中のみで使用）。
- **`DeepDiveSession.tsx`**（`DigPage.tsx`から抽出）: Deep Dive会話〜「今回残したいこと」〜Memory Extraction〜確認パネル〜保存という一連のUIとロジックを、`DigPage.tsx`から丸ごと切り出した共通コンポーネントです（`MoleLoader`もここから`named export`し、`EntityDigPage.tsx`側の初期ローディング表示にも再利用しています）。`analysis`（`ArticleAnalysis`）・`source`（`DigSource`）・`header`（結果ヘッダー、任意）・`heading`/`introMessage`（見出しと最初の一言、任意）・`headerExtra`（「理解マップへ戻る」ボタン等、任意）・`onMemorySaved`（保存後コールバック、任意）をpropsで受け取ります。`heading`と`introMessage`が両方渡された場合、`messages`のuseState初期値にその一言を差し込むことで、初回描画から「チャット表示」の分岐（`hasStartedChat`）に入り、通常フローにあるPre-chatの要約/前提知識/背景パネルを完全にスキップします。これにより、Concept/Topic起点の画面は新しい条件分岐をほとんど増やさずに「見出し＋一言＋自由入力欄」というシンプルな見た目になります。保存機能をKnowledgeから一般化した際も、この起点非依存の構造は変えていません（Memory Extractionの`source`は通常フロー/Concept/Topic Digいずれの場合もそのまま使われます）。
- **`digOrigin.ts`**（新規）: 「自分の理解」画面のConcept/Topicから「掘る」を始める際に必要な情報を組み立てる、Reactに依存しない純粋関数群です。新しいbackend APIは追加しておらず、既存の`ArticleAnalysis`と同じ形（`summary`/`concepts`/`connections`等）のオブジェクトをConcept/Topic/Knowledge/ConceptRelationのデータから合成し、既存の`/api/deep-dive`・`/api/knowledge/extract`・`/api/knowledge/save`へそのまま渡せるようにしています。
  - `buildConceptDigContext(concept, topics, concepts, relations, knowledge)`: 対象Conceptに紐づく既存Knowledge（最大`MAX_CONTEXT_KNOWLEDGE_ITEMS`=8件）をsummaryへ埋め込み、`ConceptRelation`経由の関連Concept（最大`MAX_CONTEXT_RELATED_CONCEPTS`=6件）をconnectionsに、所属Topicのパンくず（`buildTopicBreadcrumb()`）をwhyItMattersに含めます。既存Knowledgeをsummaryの一部として渡すことで、既存の（変更していない）Deep Dive prompt側のポリシー「既にカバー済みの内容を繰り返さない」がそのまま働き、新しいprompt調整なしに「既存Knowledgeを長々と再説明しない」という要件を満たします。`source`は`{type:"concept_dig",conceptId,title:concept.name}`。
  - `buildTopicDigContext(topic, topics, concepts, knowledge)`: 対象Topic配下（`collectDescendantTopicIds()`によるBFS）のConcept（最大`MAX_TOPIC_CONTEXT_CONCEPTS`=10件）とその代表的なKnowledgeをsummaryへ、子Topic名をconnectionsに含めます。`source`は`{type:"topic_dig",topicId,title:topic.name}`。
  - どちらも`heading`（例:「田沢梨乃容疑者について掘る」）と`introMessage`（例:「田沢梨乃容疑者について、これまでの理解を踏まえてさらに掘り下げましょう。気になることをそのまま聞いてください。」）を返し、`DeepDiveSession`にそのまま渡されます。
  - ユーザーが当初想定していた`DigOrigin`という新しい判別可能なユニオン型（`{type:"source"|"concept"|"topic"}`）は、そのままの形では導入していません。同等の情報は、保存時に永続化される`DigSource`の新バリアント（`concept_dig`/`topic_dig`、backend `knowledgeSource.ts`）と、UIでのみ使う一時的な`heading`/`introMessage`の組み合わせで表現しています。セッションの起点を判別する情報はKnowledgeの`source`として保存する価値がある一方、`heading`/`introMessage`はUIの見せ方に過ぎず永続化する理由が無いため、あえて分離しました。
- **`EntityDigPage.tsx`**（新規）: 「自分の理解」画面のConcept/Topicから「掘る」を始めるための2つのルートコンポーネント（`ConceptDigPage`/`TopicDigPage`）。共通処理は内部の`EntityDigScreen`にまとめています。`UnderstandingMapView.tsx`が保持するメモリ上のデータには依存せず、マウント時に自身で`GET /api/understanding-map`・`GET /api/knowledge`を呼び直します（直接URLアクセス・リロードでも動作させるため）。対象のConcept/Topicが見つからない場合（削除済み等）は「対象のConcept/Topicが見つかりませんでした」というエラー表示＋「理解マップへ戻る」ボタンを出します。「← 理解マップへ戻る」ボタンは`navigate("/understanding/map", { state: { restoreTopicId, restoreConceptId } })`で、掘り始めた時点のTopicフィルタ・選択中Conceptを`UnderstandingMapView.tsx`側へ引き継ぎます（`react-router-dom`のnavigate stateを使うシンプルな実装のため、直接URLアクセスやリロードをまたいだ復元はできません）。
- **`UnderstandingMapView.tsx`への追加**: `ConceptDetailPanel`/`TopicDetailPanel`それぞれに「このConceptを掘る」「このTopicを掘る」ボタン（`.entity-dig-cta`）を追加し、押すと`navigate(`/dig/concept/${id}`, { state: { returnTopicId: selectedTopicId } })`（Topicも同様）で`EntityDigPage.tsx`へ遷移します。`location.state`に`restoreTopicId`/`restoreConceptId`が入った状態で`/understanding/map`に戻ってきた場合（「理解マップへ戻る」ボタン経由）は、専用の`useEffect`が一度だけ`selectedTopicId`・`selectedNode`・`pendingFocusId`を復元し、Topicフィルタと選択中Concept（Detail Panelの再オープン、Map上のカメラ移動）の両方を元に戻します。
- **`UnderstandingPage.tsx`**: 「自分の理解」ページ。保存済みKnowledgeを「一覧」ではなく「自分の理解が育っている」と感じられる形で見せることを目的にした画面で、独立したファイルに分離しています（`App.tsx`が既に大きいため）。マウント時に`fetchSavedKnowledge()`（`GET /api/knowledge`）を1回呼び、以降はタブ切り替えのみで同じデータを使い回します（タブごとに再取得しません）。
  - **タブ（secondary navigation）**: 「最近」「トピック」「マップ」を`/understanding/recent`・`/understanding/topic`・`/understanding/map`という3つのネストしたルートとして実装しています（`index`ルートは`recent`へ`Navigate`）。タブ見出しは`understanding-tab`クラスの`NavLink`で、見た目は従来のボタンUIのままですが、選択状態はローカルstateではなくURLで管理されるため、直接アクセスやリロードでも選択中のタブが保たれます。`AppShell.tsx`の「掘る/自分の理解」という**アプリ全体**のNavigationとは別階層の、**「自分の理解」内**の2段目のNavigationという位置づけです。`NavLink`の`to`はいずれも絶対パス（例: `to="/understanding/map"`）で指定しています。相対パス（`to="map"`）だと、現在地が`/understanding/recent`のときに`/understanding/recent/map`という誤ったURLに解決されてしまうため（React Routerのネストルートにおける相対パス解決の仕様）、必ず絶対パスを使う必要があります。
  - **「最近」ビュー**: `groupByDate()`が、backendが`createdAt`降順で返す配列を前提に、連続する同じ日付（今日/昨日/それ以外は「9月17日」のような表示）の項目をまとめてグルーピングします。各行（`KnowledgeRow`）は`concept`・`statement`の冒頭・出典記事タイトルを表示し、`status`が`active`以外の場合だけ控えめなバッジ（`understanding-item-status`）を添えます。クリックするとKnowledge詳細モーダルが開きます。
  - **「トピック」ビュー**: `buildTopicTree()`が、各Knowledgeの`topicPath`（backendが付与する1〜3階層のパス。無ければ「未分類」）から、共通の接頭辞をまとめた木構造を組み立て、`TopicTree`コンポーネントが再帰的に描画します。正規化されたTopicコレクションではなく、`topicPath: string[]`をそのままグルーピングに使う単純な実装です。
  - **「マップ」タブ（`UnderstandingMapView.tsx`）**: 独立したファイルに分離された、Topic/Concept/ConceptRelationモデル（[`backend/README.md`](../backend/README.md#topic--concept--conceptrelationモデルtopicts--conceptts--conceptrelationts--understandingstructurets)参照）ベースの3ペインUI。詳細は同ファイルの説明を参照。
  - **Knowledge詳細（`KnowledgeDetailModal`）**: 固定オーバーレイの簡易モーダルで、`concept`・`statement`・`理解した日`（`createdAt`）・`状態`（`status`を`STATUS_LABELS`で日本語化）・`元の記事`（`source.title`へのリンク）・（`relationsOut`があれば）`関連する理解`（参照先Knowledgeの`concept`を`allItems`から逆引き）を表示します。現在のKnowledge schemaで取得できる情報だけを使い、存在しないデータは表示しません。
  - **Empty State**: Knowledgeが0件の場合はタブ自体を表示せず、モグラのアイコンと「まだ理解マップは小さいです。気になる記事を掘ると、ここにあなたの理解が少しずつ育っていきます。」という一言、「記事を掘る」ボタン（`useNavigate()`で`/dig`へ遷移。以前は`onGoDig`というpropを`App.tsx`から受け取っていましたが、ルーティング導入に伴い各コンポーネントが`useNavigate()`を直接呼ぶ形にし、このprop受け渡しは廃止しました）だけを表示します。
- **`UnderstandingMapView.tsx`**: 「マップ」タブの実体。Topic/Concept/ConceptRelationモデル（backendの`GET /api/understanding-map`・`POST /api/understanding-map/refresh`）を使い、「保存したKnowledgeを並べたグラフ」ではなく「今のユーザーの理解状態」を感じられるUIを構築します。**Topic hierarchyを理解構造の背骨、ConceptRelationを理解の横方向の広がりとして扱う**設計です（完全なTreeでも完全なforce-directed graphでもない、中間的な構造を目指す）。「最近」「トピック」タブは引き続き旧`Knowledge.topicPath`モデルのまま無変更です（2つの分類システムが並存。Mapの階層は`Topic.parentId`由来のTopic/Conceptモデル側を単一の情報源として使っており、`topicPath`とは完全には一致しません。詳細は[`backend/README.md`](../backend/README.md#topic--concept--conceptrelationモデルtopicts--conceptts--conceptrelationts--understandingstructurets)を参照）。
  - **Map上のnodeはRoot Topic／Subtopic／Conceptの3種類のみ**です。Knowledgeはnodeとして表示せず、Conceptをクリックした右Detail Panelの「自分が理解していること」セクションで全文を読みます（`KnowledgeNode.tsx`は削除済み）。Mapを「内容を読む場所」ではなく「理解構造を見て辿る場所」に保つための変更です。
  - **同一Conceptは常に1nodeだけ表示します**。以前は`concept.topicIds[0]`（最初のTopicのみ）からhierarchy edgeを1本引いていたため、Conceptが複数Topicに属していても1つの親としか繋がりませんでしたが、`topicIds`に含まれる**すべての関連Topic**から複数のedgeを引くように変更しました（`recomputeLayout()`）。dagreは厳密なtreeを要求しないDAGレイアウトなので、1つのConcept nodeが複数の親から辺を受け取ってもレイアウトは破綻しません（node idは常に`concept._id`を使っており、同名Conceptがあっても混同しません）。
  - **Node sizeは3段階**（`mapLayout.ts`）: Root Topic 68〜76px／Subtopic 52〜60px／Concept 36〜44px。同一階層内の補助調整（childCount/knowledgeCount）は最大6〜8pxにとどめ、ConceptRelationの本数（edge数）はサイズに一切関与させません。
  - **Detail Panel**: `ConceptDetailPanel`のKnowledge一覧は、対応するMap nodeが無くなったためクリック不可の地の文表示に変更しました（`KnowledgeDetailPanel`コンポーネント自体を削除）。検索でKnowledgeを選んだ場合も、そのKnowledgeが属するConceptへフォーカスします（`conceptIds`が無い古いデータは検索結果自体に出しません）。
  - **データ取得**: マウント時に`GET /api/understanding-map`を呼びます（読み取り専用でlazy migrationやLLM呼び出しなどの副作用が無いため、タブを開き直すたびに呼んでも軽い）。`knowledge`（`SavedKnowledge[]`）は親の`UnderstandingPage`が既に持っているものをpropsで受け取り、二重fetchしません。
  - **「理解マップを更新」ボタン**: `POST /api/understanding-map/refresh`を呼びます（未移行のKnowledgeのConcept化＋未分類ConceptのLLM Topic分類を行う、相対的に重い処理）。ボタン付近に未分類Concept数を表示し、押すタイミングの目安にします。押している間はボタンを無効化するだけの簡易的なローディング表現です。
  - **Topicフィルタ（`.map-topic-filter-bar`）**: Map上部に、ルートTopic（`Topic.parentId`が無いもの）だけをクリック可能なボタン（チップ）として並べています。選択すると`selectedTopicId`が変わり、そのTopicとその子孫すべて（Subtopic・配下のConcept・Knowledge）だけをMapに表示します（`collectDescendantTopicIds()`。Topic Viewと同じ`Topic.parentId`の親子関係をそのままsubtree絞り込みに使っています）。「すべて」で解除すると、すべてのルートTopicがそれぞれ独立したtreeとして横に並びます。ルートTopicが多い場合に一覧が縦に伸びすぎないよう、初期表示は5個までにとどめ、「もっと表示する」ボタンで全件表示に切り替えられます（`topicFilterExpanded` state）。
  - **検索（`.map-search-bar`）**: 「見たいものが既に決まっている」場合の直接アクセス。`searchMap()`がTopic名・Subtopic名・Concept名・Knowledgeの`concept`/`statement`を横断して部分一致検索し、結果を種別バッジ（トピック/概念/理解）付きで最大20件返します（Embedding/Semantic Searchは今回のスコープ外）。結果をクリックすると`focusNode()`が呼ばれ、該当Nodeを選択状態にしてDetail Panelを開き、後述のカメラ移動でMap上のNodeへ視点を寄せます。0件のときは「該当する理解はまだありません」と表示するだけです。`/`または`Cmd/Ctrl+K`で検索欄にフォーカス、Escで閉じるショートカットも用意しています（必須ではない任意機能）。
  - **中央: マップ（`mapLayout.ts` + `TopicNode.tsx` + `ConceptNode.tsx`）**: 「Conceptをランダムに散らしてつなぐもの」ではなく、Topic hierarchyを理解構造の背骨、ConceptRelationを理解の横方向の広がりとして扱う「地図」として設計しています。node配置は[`dagre`](https://github.com/dagrejs/dagre)による決定的なレイアウトです（`computeHierarchyLayout()`。同じnode/edge構成なら常に同じ配置になります）。
    - **3種類のNodeを明確に区別する**: `rootTopic`（`parentId`の無いTopic）・`subtopic`（それ以外のTopic、深さに関わらず1種類として扱う）・`concept`の3種類をReact Flowの別々のcustom nodeとして描画し、サイズ・形をはっきり変えています。**Knowledgeはnodeとして存在しません**（後述）。
      - Root Topic（`TopicNode.tsx`、`variant="root"`）: 円、`computeRootTopicSize()`で68〜76px（直属の子数に応じて補助調整）、太い枠・強めの塗りつぶし。
      - Subtopic（`TopicNode.tsx`、`variant="sub"`）: 円、`computeSubtopicSize()`で52〜60px、Root Topicより細い枠・薄い塗りつぶし。
      - Concept（`ConceptNode.tsx`）: 円、`computeConceptSize()`で36〜44px（紐づくKnowledge数に応じて最大+6pxの補助調整のみ、Relation数はサイズに一切関与しません）。名前は12文字を超えたら`truncateLabel()`で省略し1〜2行に収め、フルテキストは`title`属性のhover tooltipとDetail Panelで確認します。
      - サイズの主基準は常に「階層のどの役割か」という3段階（68〜76 → 52〜60 → 36〜44）です。同一階層内の補助差は最大6〜8px程度にとどめ、relationやedgeが多いConceptでもConcept以上の大きさにはなりません（「つながりが多い＝理解が深い」ではないため）。
    - **KnowledgeはMap上のnodeではなくConcept詳細の中身**: 以前はKnowledgeも小さなdot+captionのleaf nodeとして表示していましたが、Map上のノイズになるという指摘を受けて廃止しました（`KnowledgeNode.tsx`は削除済み）。Conceptをクリックすると、右Detail Panelの「自分が理解していること」セクションで全文を読めます（Map＝地図を眺める場所、Detail＝内容を読む場所、という役割分担）。
    - **同一Conceptを複数箇所に重複表示しない**: 以前は`concept.topicIds[0]`（配列の先頭のTopicのみ）からhierarchy edgeを1本引いていたため、Conceptが複数Topicに属していても見た目上どこか1箇所にしか繋がっているように見えませんでした。現在は`topicIds`に含まれる**すべての関連Topic**から複数のhierarchy edgeを引くように変更し（`recomputeLayout()`）、Conceptを複製せず単一nodeのまま複数の親を持てるようにしています。dagreは厳密なtreeを要求しないDAGレイアウトのため、これでレイアウトが破綻することはありません。node idには常に`concept._id`（Concept ID）を使っており、表示名の一致で別Conceptと混同することもありません。
    - **階層をレイアウトの骨格に、ConceptRelationは補助edgeに**: `recomputeLayout()`はTopic→Topic（親子）・Topic→Concept（所属。複数Topicに属す場合は複数edge）という**parent-child edgeだけ**を`dagre`に渡してレイアウトします（`rankdir: "LR"`で左→右に階層が広がる）。位置が決まった後、`ConceptRelation`（横断的なつながり）を`buildCrossRelationEdges()`で別途重ねるだけで、レイアウト計算そのものには一切関与しません。そのためConceptRelationが0件でも、Topic hierarchyだけでMapとして完全に成立します。
    - **edgeの見た目の主従**: parent-child edge（`buildParentChildEdges()`）はReact Flowの`smoothstep`（elbow風の折れ線）にし、branch構造・子方向が追いやすいようにしています。太さも1.75pxへ少し上げ「細すぎない」程度にしつつ、色は控えめなグレー（`#b0b0b0`）にとどめ「主張しすぎない」バランスを取っています。cross relation edge（`buildCrossRelationEdges()`）はデフォルトの曲線（bezier）のまま、薄いグレーの破線＋小さな日本語typeラベルにして、階層edgeよりはっきり控えめにしています（elbowの実線 vs 曲線の破線、という形自体の違いでも主従を表現しています）。
    - **複数のルートTopicは独立したtreeとして横に並ぶ**: 「すべて」表示では、dagreが非連結なグラフ（複数のルートTopicにまたがるtree群）をまとめて配置し、それぞれ独立したtreeとして並びます。無理に1つのグラフへ繋げようとはしません（「複数の島」ではなく「複数の理解領域」に見えるよう、`nodesep`/`ranksep`は木同士が混ざらない程度の余白にとどめています。Knowledgeが小さなdotになったことでMap全体の密度も下がったため、`ranksep`を70→60に詰めてコンパクトさを保ちつつ、`nodesep`は20→28に広げて兄弟node・label同士が詰まって見えないようにしています）。
    - **未分類Conceptの扱い**: `topicIds`が空のConceptは、「すべて」表示のときだけ`__unclassified__`という専用のRoot Topic相当のnode（名前は「未分類」、グレー固定色）の直下に並べます。特定のTopicで絞り込んでいるときは未分類は表示しません（どのTopicのsubtreeにも属さないため）。
    - **隣接強調（hover/選択）**: parent-child edgeとConceptRelation edgeの両方を対象に、hoverまたは選択中のNodeと直接つながるNode・edgeだけを強調し、それ以外を薄くします（優先順位: hover > 選択中）。これにより「このNodeから次にどこへ辿れるか」が親・子・横断関連の別を問わず直感的に分かります。**無関係なnodeを薄くしすぎるとMap全体の位置関係が分からなくなる**という指摘を受け、dimmed時のopacityを0.25→0.6へ引き上げています（他のtreeの存在も薄っすら見え続けるようにする）。選択中のNode（Topic/Concept/Knowledgeいずれも共通）には、hoverの軽い強調（枠線をやや太くするだけ）とは別に、outline＋わずかな拡大（`transform: scale(1.06〜1.15)`、Knowledgeのdotは小さいぶん拡大率を大きめにしています）という独立した「選択中」の見た目を常時表示します。
    - **クリック interaction（node種別ごとに詳細パネルを出し分け）**: `onNodeClick`はクリックしたNodeの`type`（`topic`/`concept`/`knowledge`）に応じて`selectedNode`（`{ kind, id }`の判別可能なユニオン）を設定し、後述のDetail Panel側がその種別に応じた内容を描画します。
    - **Node Navigation（辿る）**: Detail Panelの各種リンク（関連する概念・配下のトピック・所属する概念など）や検索結果を選ぶと`focusNode()`が呼ばれます。対象NodeがすでにMap上に見えていれば即座にカメラを寄せ、現在のTopicフィルタの都合で隠れている場合はフィルタを一旦解除してから、その再描画を待ってカメラを寄せます（`pendingFocusId`という一時state経由。ReactFlowインスタンスはTopicフィルタ変更等での再マウントのたびに`onInit`で参照を取り直すため、`useReactFlow()`ではなくrefで保持しています）。Map上でNodeを直接クリックしたとき（`handleSelectNode`）は、既に見えている位置なのでカメラは動かしません。
    - **カメラ移動は控えめに**: `panToNode()`は選択したNodeを中心に据えますが、毎回激しくズーム/パンしてユーザーの位置感覚を失わせないよう、現在のズームがある程度（0.6以上）あればそれを保ち、大きくズームアウトしている場合だけ0.8まで軽く寄せます。
    - **NEWの表現はKnowledgeのdotだけに、7日以内だけ**: 以前はConcept nodeにもテキストの「NEW」バッジを表示していましたが、Knowledge nodeだけに限定しました（`isRecent()`、`createdAt`が7日以内かどうかだけを見るシンプルな判定）。Knowledgeのdot自体が22pxとごく小さいため、テキストバッジではなくdotの縁を彩る細いリング（`.knowledge-leaf-dot-new`）という控えめな表現に変え、Map全体のNodeに何かしらの印が付いて視認性が下がることを避けています。
    - **色分け**: トップレベルTopic（ルートTopic）ごとに固定パレットから色を割り当て（`buildTopicColorMap()`）、Topic/Concept/Knowledgeいずれのnodeの枠線・塗りにも同じ色を使い、同じtree（理解領域）に属することが一目で分かるようにしています。未分類は常に固定のグレーです。
    - **「整列」ボタン**: dagreは決定的なレイアウトのため、同じデータであれば毎回同じ配置になります。ユーザーがドラッグしてNodeを動かした場合に、それを明示的にリセットして`recomputeLayout()`をもう一度呼ぶためのボタンとして残しています（d3-force時代の「warm start」という概念自体が無くなったため、以前あった「resetPositions」引数は廃止しました）。
    - **MiniMap**: 全Node（Topic+Concept+Knowledgeの合計）が25件以上のときだけ表示します（React Flowの`<MiniMap />`をそのまま使用。以前はConcept数だけを基準にしていましたが、階層化でNode総数が増えたため合計件数に基準を変えています）。
    - **ドラッグ時に画面全体が意図せずズーム/パンするバグの修正（既存）**: 詳細パネル列を常時確保したことでMapのcanvas幅が狭くなり、node1つをドラッグしただけでReact Flowが「node がpaneの端に近づいた」と判定し、`autoPanOnNodeDrag`（デフォルト`true`）によってcanvas全体を大きくズームアウト・再配置してしまう現象があったため、`<ReactFlow autoPanOnNodeDrag={false}>`を指定しています。
    - **モバイルでのはまりどころ（既存）**: `.understanding-map-layout`がモバイルで`flex-direction: column`になるため、Map要素のbase CSS（`.concept-map { flex: 1 1 0%; }`）のflex-basisがcolumn方向では高さの基準として優先され、`height`指定を上書きしてしまい、モバイルでMapの高さが0になって何も表示されないバグがありました。モバイル用メディアクエリ側で`flex: none;`をリセットすることで解消しています。
  - **右: Detail Panel（`ConceptDetailPanel`/`TopicDetailPanel`/`KnowledgeDetailPanel`）**: Nodeを「理解する場所」として扱い、Map上には詰め込まない情報をここに寄せます。`selectedNode.kind`に応じて3つのコンポーネントを出し分けます。
    - **Topic選択時（`TopicDetailPanel`）**: Topic名、パンくず（`buildTopicBreadcrumb()`）、配下のTopic一覧、直属のConcept一覧を表示します。それぞれクリックすると`focusNode()`でそのNodeへ遷移します。
    - **Concept選択時（`ConceptDetailPanel`）**: Concept名、所属Topicのパンくず、紐づくKnowledge一覧（`SavedKnowledge.conceptIds`から逆引き。`outdated`は除外、`merged`は控えめ表示、`foundational`はラベル付き。`UnderstandingPage.tsx`の`STATUS_LABELS`/`effectiveStatus`/`statusClassName`をexportして再利用。各Knowledgeの文もクリックでそのKnowledge nodeへ遷移）、関連する概念一覧（`ConceptRelation`の双方向、1-hopのみ）、参照元記事リンクを表示します。
    - **Knowledge選択時（`KnowledgeDetailPanel`）**: そのKnowledgeのstatement全文、状態バッジ、出典記事リンク、所属する概念（クリックでConceptへ遷移）を表示します。
    - パネルの列（`.concept-detail-panel-wrapper`、幅固定320px）は選択の有無に関わらず常にレンダリングし、未選択時は「Topic / Concept / Knowledgeを選択すると、ここに詳細が表示されます」というプレースホルダーを表示します。列自体を常時確保することでMapの表示幅は選択・非選択に関わらず変化しません（幅が同一であることをPlaywrightで直接検証済み）。
  - **成長summary（`computeMapSummary()`）**: 「Knowledge N件・トピック N個・概念 N個・つながり N件」＋「今週 +N件の理解・+M件のつながり」を、既存データ（`createdAt`）だけから計算して表示します。
  - **Empty State**: active Conceptが0件のときは、モグラのアイコンと「理解マップを更新」ボタンだけを表示する専用の軽量表示にしています（Concept未作成＝多くの場合まだ一度もrefreshを実行していない状態のため）。
  - **レスポンシブ**: デスクトップは検索/Topicフィルタ行＋Map＋Detail Panelの縦積み＋横flex構成。検索はテキスト入力、Topicフィルタはボタンの折り返しなので、モバイルでも同じUIでそのまま操作できます（専用のドロワーは不要。Topicフィルタで選択Topicのsubtreeだけに絞り込む操作自体が、モバイルでの「今見たい範囲だけ表示する」navigationを兼ねています）。Detail Panelだけはモバイルでノードクリック時に下からのシート風パネルになります（既存の`.modal-overlay`的な考え方をCSSだけで再現したもので、新しいジェスチャーライブラリは導入していません）。
  - **旧「トピック」タブとの橋渡し（ベストエフォート）**: 旧トピックタブの「この分野をマップで見る」で渡されるトピック名文字列と、新モデルのTopic名が一致すれば、そのTopicが属するルートTopicをTopicフィルタの初期値として使います（`initialTopicName` prop、`findRootTopicId()`）。2つの分類システムは独立しているため、一致しない場合は「すべて」表示にフォールバックします。
- **`types.ts`**: `/api/dig`・`/api/deep-dive`・`/api/memory/extract`・`GET /api/knowledge`・`GET /api/understanding-map` のレスポンス型（`DigResult` / `DigSource` / `ArticleAnalysis` / `Concept` / `Entity` / `Connection` / `ConversationTurn` / `DeepDiveResponse` / `KnowledgeCandidate` / `MemoryItemType` / `MemoryItemOrigin` / `CandidateMetadata` / `MemoryCandidate` / `MemoryDraftItem` / `SavedKnowledge` / `KnowledgeRelationOut` / `Topic` / `UnderstandingConcept` / `ConceptRelationType` / `ConceptRelation`）を定義。`MemoryCandidate`/`MemoryDraftItem`は保存対象をKnowledgeから一般化したもので、既存の`KnowledgeCandidate`型自体は変更せず残しています（後方互換のための旧APIの型として）。backend側の `src/types.ts`・`src/llm/*.ts`・`src/topic.ts`・`src/concept.ts`・`src/conceptRelation.ts` と同じ形を手動で同期しています（共有パッケージ化はまだしていません）。`UnderstandingConcept`という名前にしているのは、Article Analysisの前提知識カード用に既存の`Concept`型が使われているため（名前の衝突を避けるための別名）。チャットUI用の`ChatMessage`型（現在は`DeepDiveSession.tsx`内のローカル型）は`{ role, content }`のみを持ち、`suggestedFollowUps`は保持しません（UIで使わないため）。`DigSource`は`{type:"web_article",url,title} | {type:"text",title?} | {type:"image",title?} | {type:"concept_dig",conceptId,title?} | {type:"topic_dig",topicId,title?}`という判別可能なユニオンで、backend側`knowledgeSource.ts`の`knowledgeSourceSchema`と対になります。
- **`App.css`**: 余白の広いシンプルなレイアウト。`flex-wrap` と相対単位でスマホ幅でも崩れないようにしています。CSSフレームワーク等は未導入です。ページ間の幅の揺れ（ガタつき）を防ぐため、外枠の幅は`.app-main`（`max-width: 1100px`、ルートに関わらず常に同じ）が一元管理し、ページごとの見た目の違いは内側のラッパーだけで表現します：「掘る」は`.dig-page-inner`（`max-width: 640px`）、「自分の理解」の最近/トピックは`.understanding-view`（`max-width: 720px`）、マップだけは`.understanding-view-map`でこの上限を`max-width: none`に戻し`.app-main`いっぱいまで使います。

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
- `reactflow` — 「自分の理解」ページのマップ表示（zoom/pan/drag/クリック/MiniMap等）
- `dagre`（+ `@types/dagre`） — マップのnode配置計算（Topic hierarchyを骨格にした階層レイアウト）。以前使っていた`d3-force`（force-directed layout）は、階層構造を主役にする今回の再設計に伴い置き換えて削除した
- `react-router-dom` — アプリ全体のURLルーティング（`/dig`・`/understanding/recent`・`/understanding/topic`・`/understanding/map`等）。direct URL access・ブラウザの戻る/進む・左サイドバーNavigationの現在地表示を実現するために導入

## ローカル起動

```bash
cp .env.example .env
npm install
npm run dev
```

`http://localhost:5173` を開き、Composerの入力欄にURL・貼り付けテキスト・画像のいずれかを入れて「掘る」を押すと、実際に取得・解析した結果が表示されます（backendが`LLM_PROVIDER=mock`なら日銀の利上げに関する固定デモデータ、`LLM_PROVIDER=vertex`なら実際の入力内容に応じたVertex AI Geminiの解析結果。画像はGeminiのマルチモーダル入力でそのまま解析されます）。バックエンドが起動していない、またはURLが不正・画像が対応形式外だとエラーメッセージが表示されます。「気になることを聞いてみましょう」欄から自由入力で質問すると、その場でチャット形式の深掘りができます（`LLM_PROVIDER=vertex`ならAnalysis結果とこれまでの会話を踏まえたVertex AI Geminiの回答、`mock`なら固定応答）。

## 今後の拡張ポイント（未実装）

- Chat Viewから「前提知識を見る」「背景を見る」相当の情報に戻れる導線（現状は「要点を見る」で短い要約だけ再表示可能。前提知識・背景はChat View突入後は見られない）
- 保存済みKnowledgeのきちんとした一覧UI（現状は「保存済みの理解を見る（テスト表示）」という動作確認用の暫定表示のみ。デザイン・ページネーション・編集/削除等は未実装で、いずれ作り直すか削除する前提）
- エラー種別（`400`/`403`/`413`/`422`/`502`）に応じたUIの出し分け（現状は全て同じ見た目。`/api/knowledge/*`も同様）
- 深掘りの会話をリロード後も残すための永続化（現状はページをリロードすると消える）
- 状態管理ライブラリ（現状はuseStateのみ）
- UIコンポーネントの共通化・デザインシステム導入
- APIクライアントの共通化（現状は `digContent` 関数に `fetch` 直書き）
- 入力方式のさらなる拡張（PDF・音声・動画）。backend側の`InputSource`/`GenerateTextInput.images`は拡張しやすい形にしてあるため（詳細は[`backend/README.md`](../backend/README.md)）、frontend側もComposerに新しい添付ボタンを足す程度で対応できる想定（今回は意図的にスコープ外）
- frontend/backend間で重複しているレスポンス型の共有化
- `POST /api/knowledge/save`（保存処理中）にも`NoteMoleLoader`を再利用する（`label`を変えて呼ぶだけで対応可能な構造にはなっているが、今回はKnowledge Extractionの抽出中のみで使用）
- 「理解を更新する」（`updated`/`supersedes`）候補を保存した際に、実際に既存Knowledgeを`outdated`へ変更する導線（現状はbackendが自動遷移しないため、UI上も「更新候補」として見せるだけで、保存すると新しいKnowledgeが追加されるのみ）
- `describeSaveResult()`は選択時点の`displayCategory`から件数を計算する簡易な実装のため、backendの実際の保存結果（`savedCount`）とcategory別の内訳が完全に一致するとは限らない（重複スキップ等で稀にずれ得る）

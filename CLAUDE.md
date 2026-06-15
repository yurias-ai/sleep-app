# 眠りの森学園 体験版アプリ（PMS×睡眠×動物キャラ カレンダー）

> 設計の共通原則（基本原則・資産価値の原則・自律解決の原則）は `~/.claude/CLAUDE.md` に従う。

## このアプリの絶対制約（最優先・違反禁止）

- **完全無料**：サーバー費・API利用料・課金・サブスクを一切発生させない。有料外部API（生成AI API・有料DB等）を呼ばない。
- **外部送信なし**：データは端末内のみ。外部サーバー・クラウド保存・トラッキング・外部CDNを使わない（完全自己完結）。
- **ログイン不要・登録不要・個人情報サーバー送信なし**。
- **storage制限対応**：localStorageが使えない環境（LINE内ブラウザ等）では、起動中のメモリ内 state にフォールバックする。
- 画面に「**完全無料／料金は一切かかりません**」を必ず明記。
- **「個性心理学」という語・出典をアプリ内に一切出さない**（独自の動物キャラとして表現）。

## プロジェクト設定

技術スタック:
  形態: 単一HTMLファイル（自己完結・ビルド不要）
  frontend: HTML + CSS + Vanilla JavaScript
  backend: なし
  database: なし（localStorage / メモリ state）

ポート設定:
  preview: 3384（ローカルプレビュー用の静的サーバ。例: `npx serve -l 3384` 等）

## 環境変数

- 使用しない（外部API・キー・接続情報が一切ないため）。
- **絶対禁止**: .env, .env.test, .env.development, .env.example は作成しない。

## 命名規則

- 変数・関数: camelCase / 定数: UPPER_SNAKE_CASE
- キャラ・フェーズ等の静的データは定数として一箇所に集約（単一性）。

## コード品質

- 関数: 100行以下 / ファイル: 700行以下 / 複雑度: 10以下 / 行長: 120文字
- 単一HTMLでも、JSは機能単位（storage層・フェーズ判定・キャラ判定・描画）に分割し肥大化を防ぐ。

## 実装上の必須ルール

- **storage抽象層を必ず1つ用意**：`try/catch`でlocalStorageを試し、失敗時はメモリMapへフォールバック。アプリ全体はこの層経由でのみ読み書きする。
- **XSS対策**：ユーザー入力のDOM挿入は `textContent` を使い、`innerHTML` への生挿入を避ける。
- **決定論**：同じ生年月日 → 必ず同じ動物キャラ（ランダム禁止）。
- グラフは外部ライブラリ非依存（SVG/Canvas自前描画 or 軽量CSS）。

## ドキュメント管理

許可されたドキュメントのみ作成可能:
- docs/SCOPE_PROGRESS.md（実装計画・進捗）
- docs/requirements.md（要件定義）
- docs/DEPLOYMENT.md（デプロイ情報）
- docs/e2e-specs/（E2Eテスト仕様書）
上記以外のドキュメント作成はユーザー許諾が必要。実装済みの記載は積極的に削除する。

## デプロイ

- 無料静的ホスティング（GitHub Pages 等）に単一HTMLを置いて固定URL化（リッチメニュー・特典配布で使用）。
- デプロイはユーザーの明示的な承認を得てから実行する。

## Playwright

スクリーンショット保存先: /tmp/bluelamp-screenshots/

## CI/CD設定（ローカルゲート主体 + 軽量Actions）

### 品質ゲートの三段構え
| 段 | どこで | 何を | トリガー |
|---|---|---|---|
| 第一防壁 | ローカル git hook | pre-commit: 秘密情報チェック（tsc/lintは対象があれば実行） ／ pre-push: test（対象があれば） | commit / push 時に自動 |
| 第二防壁 | ローカル受入ゲート（@11） | E2E / ローカル動作確認を緑に | merge / デプロイ前 |
| 最終防壁 | GitHub Actions（`ci.yml`） | HTML基本検証（軽量・課金微小） | PR / main push |

※ このアプリは単一HTML静的アプリ（バックエンド・ビルド・テストなし）。Actions には重い検証を載せず、HTMLの存在・最低限の妥当性のみ機構的に確認する。

### ブランチ戦略 / 保護
- `main`: 本番（直 push 禁止・PR必須・`verify` 緑必須）
- `develop`: 開発統合ブランチ
- `feature/*`: 機能開発ブランチ
- branch protection を有効化（plan制約で掛けられない場合はローカル hook + Actions 緑の目視確認で代替）

### リポジトリ
- URL: https://github.com/yurias-ai/sleep-app
- 公開設定: Private（デプロイ時に公開へ切替予定）

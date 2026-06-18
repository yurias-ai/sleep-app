# クロスページ導線 E2Eテスト仕様書（ページ横断ジャーニー）

対象: 単一HTMLアプリ「眠りの森学園 体験版」`index.html`
スコープ: **ページ（ビュー）をまたぐユーザー導線と、ページ間データ連携のみ**を検証する。ページ内の入力・バリデーション・描画詳細は各ページのE2E仕様書（P-000〜P-003）でカバー済みのため、本書には含めない。

## 設計方針（厳守）
- 単一ロール（一般ユーザー）・認証なしのため、ジャーニーは **3本** に絞る。
- **ログインヘルパー・`?redirect=` 等のショートカット遷移を使わない**。実ユーザーと同じ「タブタップ／画面内ボタン押下／リロード」のみで遷移する。
- 各テストは「**入口（初期状態／起動）→ 最終到達ページ・状態**」の形式。途中ページ内の細部操作は最小限（連携を成立させるための入力のみ）に留める。

## 前提・共通メモ（実装事実）
- storage 名前空間 `nemorino:`。アプリは `Storage` 層経由でのみ読み書きする。
- 共有キー: `App.PROFILE_KEY="profile"`（`{birthdate,charaId}`）／ `Domain.PERIOD_KEY="periodStarts"`（`["YYYY-MM-DD",...]`）／ `Domain.SWEET_KEY="sweetCravings"`。
- 起動分岐（`App.start`）: `isOnboarded()`（profile に整数 `charaId` がある）が真ならオンボーディングを飛ばし `top` 直行、偽なら `onboarding` を表示し `body.onboarding` で下部ナビを隠す。
- ビュー切替（`App.showView`）は遷移ごとに `onShow` フックを呼び、**最新 storage で再描画**する（ページ間データ連携の要）。
- 黄体期バナー `#top-line-banner` の表示条件は **最新生理開始日のフェーズが黄体期（経過17日以降）であること**。タップで `forecast` へ遷移する。
- 予告ページ `#fc-line` の強調（`.is-emphasized`）条件: フェーズが黄体期、**または** `periodStarts`＋`sweetCravings` の合計件数 ≥ 3。
- 「今日」依存テストは固定日付を埋め込まず、実行日からの相対日付で投入する（黄体期＝開始日が今日から16日以上前 = D-16 以前）。

## テストケース

| ID | テスト項目 | フロー（入口 → 最終到達） | 検証ポイント（遷移・ページ間データ連携） |
|---|---|---|---|
| E2E-JOURNEY-001 | 初回導線：オンボーディング → トップ到達 → profile永続化 → 次回スキップ | **入口**: storage 空でアプリ起動 → `#view-onboarding` 表示・下部ナビ非表示 → 生年月日を選択し「判定する」→ 結果カードで「はじめる」(`#ob-start`) → **到達**: `#view-top`。続けてリロード → **到達**: `#view-top`（オンボーディングを経由しない） | 1) 起動時 `body` に `onboarding` クラスが付き `.bottom-nav` 非表示、`#view-onboarding` が `is-active`。 2)「はじめる」後に `onboarding` クラスが外れ下部ナビ出現、`#view-top` が `is-active`。 3) storage `profile` に `{birthdate, charaId}` が保存され、トップの `#top-name`／`#top-emoji` が判定キャラと一致（オンボーディング結果がページをまたいでトップに反映）。 4) **リロード後**、`isOnboarded()`＝真により `#view-onboarding` を表示せず直接 `#view-top` が `is-active`（profile の永続化と起動分岐）。 |
| E2E-JOURNEY-002 | 記録 → トップ反映：未記録トップ → 記録タブ → 生理開始日記録 → トップ復帰でフェーズ表示 | **入口**: `profile` 設定済み・`periodStarts` 無しで起動 → `#view-top`（`#top-no-record` 表示・`#top-phase` hidden）→ `#top-to-record` をクリック → **到達**: `#view-record` → 生理開始日（D0=今日）を入力し「記録」→ 下部ナビ「トップ」をタップ → **到達**: `#view-top` | 1) `#top-to-record` クリックで `#view-record` が `is-active`、下部ナビ記録ボタンが `is-active`（ページ遷移）。 2) 記録ページでの保存が `Domain.PERIOD_KEY` に追記される。 3) **トップ復帰時 `onShow("top")` の再描画**により、リロードなしで `#top-no-record` が hidden、`#top-phase` 表示・`#top-phase-name`＝「月経期」、`#top-msg` 表示（記録ページの保存がトップへ即時連携）。 4) `#top-msg-body` は当該フェーズ×profile.charaId の決定論メッセージと一致。 |
| E2E-JOURNEY-003 | LINE誘導導線：黄体期記録 → トップのLINEバナー出現 → タップで予告ページ到達・案内強調 | **入口**: `profile` 設定済み・`periodStarts=[D-16]`（黄体期相当・実行日基準の相対日付）で起動 → `#view-top` → `#top-line-banner` 表示 → バナーをタップ → **到達**: `#view-forecast` | 1) トップで `#top-phase-name`＝「黄体期」、`#top-line-banner` が表示（hidden 解除）。 2) バナータップで `#view-forecast` が `is-active`、下部ナビ予告ボタンが `is-active`（ページ遷移）。 3) 予告ページ表示時の `onShow("forecast")` 再評価で `#fc-line` に `.is-emphasized` が付与され `#fc-line-flag`＝「🌙 ゆらぎやすい時期。今がおすすめ」（黄体期という同一storage状態がトップ→予告へ一貫して連携）。 4) `#fc-line-id` の href が `https://line.me/R/ti/p/@l.hidamari`。 |

## 注記
- 相対日付（D0／D-16）は実行日基準で投入し、固定日付を埋め込まないこと（フェーズ判定が「今日」依存のため）。
- 本書はページ**横断**の遷移とデータ連携のみを対象とする。各ページ内のバリデーション・グラフ描画・甘いもの欲タップ等は P-000〜P-003 の各仕様書で検証する（重複させない）。
- 遷移は必ず実UI操作（`#ob-start`・`#top-to-record`・`#top-line-banner`・下部ナビボタン）で行い、`App.showView` の直接呼び出しやURLパラメータでショートカットしないこと。

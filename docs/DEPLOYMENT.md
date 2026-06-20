# デプロイ情報

## 本番環境URL（⚠️ 変更禁止 / LINEリッチメニュー・特典配布に使用）
- 公開URL: https://yurias-ai.github.io/sleep-app/

## 構成
- 形態: 単一HTML静的アプリ（`index.html`・ビルド不要・外部送信なし・完全無料）
- ホスティング: GitHub Pages（`yurias-ai/sleep-app` リポジトリ・`main` ブランチ / ルート）
- リポジトリ公開設定: Public（GitHub Pages 無料配信の条件）

## デプロイ方法（更新時）
`main` ブランチに push すれば GitHub Pages が自動で再ビルド・再配信する。

```bash
git checkout main
git merge develop --ff-only   # develop で開発 → main へ反映
git push origin main          # 数十秒〜数分で本番反映
```

ビルド状態の確認:
```bash
gh api repos/yurias-ai/sleep-app/pages/builds/latest --jq '.status'   # built なら完了
```

## 環境変数
- なし（外部API・キー・接続情報を一切使わないため）

## 残タスク（拡張フェーズで対応）
- LINE導線URL: 現在 `index.html` 内に仮の `@l.hidamari` が4箇所（966 / 1020 / 2796行 ほか）。
  エルメの「流入経路URL」が用意でき次第、4箇所を差し替えて再 push する。
- 申込者ごとの専用トラッキングリンク（開封・再訪計測）: 申込者リスト入手後に発行・配布。
  ※ アプリ本体は外部送信なしのまま（リンク側で計測）。

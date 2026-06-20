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

## LINE導線（実装済み）
- アプリ内のLINE導線リンク（3箇所: 傾向インサイト / 予告ページ / クイズ節目）は、
  エルメ（L Message）の QRコードアクションURL に差し替え済み：
  `https://s.lmes.jp/landing-qr/2006353028-ZkXRAR0K?uLand=HfZHgJ`
- 動作: このURLを踏んだ友だちに「アプリ経由」タグを自動付与＋体験入学リンク入りメッセージを送信。
  （エルメ無料プラン。LINE公式アカウント @657cfxmf ／ 体験入学LP: https://moonlit-pony-797b22.netlify.app/）
- ※ アプリ本体は外部送信なしのまま（計測・タグ付けはエルメ側で実施）。

## 残タスク（拡張フェーズで対応）
- 申込者ごとの専用トラッキングリンク（開封・再訪計測）: 申込者リスト入手後に発行・配布。
  ※ アプリ本体は外部送信なしのまま（リンク側で計測）。

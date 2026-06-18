import { test, expect, type Page } from '@playwright/test';

/**
 * クロスページ導線（ページ横断ジャーニー） E2E
 * 対象: index.html を実ブラウザで操作（モック不使用）。
 * スコープ: ページ（ビュー）をまたぐ遷移とページ間データ連携のみ。
 * storage名前空間: nemorino:
 *   profile        = {"birthdate":"YYYY-MM-DD","charaId":0-11}   (App.PROFILE_KEY="profile")
 *   periodStarts   = ["YYYY-MM-DD", ...]                          (Domain.PERIOD_KEY)
 * 遷移は必ず実UI（#ob-start / #top-to-record / #top-line-banner / 下部ナビ）で行う。
 * App.showView の直接呼び出し・URLパラメータでのショートカット禁止。
 * 「今日」依存は実行日からの相対日付で投入する（固定日付を埋め込まない）。
 *   D0  = 今日                 → getPhaseFromStart days=1  → 月経期
 *   D-16= 今日から16日前       → getPhaseFromStart days=17 → 黄体期
 */

const PROFILE_KEY = 'nemorino:profile';
const PERIOD_KEY = 'nemorino:periodStarts';

// 1990-04-15 → charaId 5「もりの子熊」🐻（p-000 実証済みの決定論値）。
const SEED_BIRTHDATE = '1990-04-15';
const SEED_CHARA_ID = 5;

// 実行日から offset 日ずらした "YYYY-MM-DD"（ローカル日付・固定日付を埋め込まない）。
function ymdFromToday(offsetDays: number): string {
  const base = new Date();
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate() + offsetDays);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// profile を事前投入してオンボーディングをスキップさせる（JOURNEY-002/003 の入口作り）。
async function seedProfile(page: Page) {
  await page.addInitScript(
    ([key, val]) => {
      try { window.localStorage.setItem(key, val); } catch (_) { /* storage制限時はそのまま */ }
    },
    [PROFILE_KEY, JSON.stringify({ birthdate: SEED_BIRTHDATE, charaId: SEED_CHARA_ID })] as const,
  );
}

// periodStarts を事前投入する。
async function seedPeriodStarts(page: Page, starts: string[]) {
  await page.addInitScript(
    ([key, val]) => {
      try { window.localStorage.setItem(key, val); } catch (_) { /* noop */ }
    },
    [PERIOD_KEY, JSON.stringify(starts)] as const,
  );
}

// ---------------------------------------------------------------------------
// E2E-JOURNEY-001 初回導線: オンボーディング → トップ到達 → profile永続化 → 次回スキップ
// ---------------------------------------------------------------------------
test('E2E-JOURNEY-001 初回導線: オンボーディング→トップ→永続化→リロードでスキップ', async ({ page }) => {
  // 入口: storage 空（投入なし）でアプリ起動。
  await page.goto('/');

  // 1) 起動時はオンボーディング表示・下部ナビ非表示。
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).not.toBeVisible();

  // 実UIで生年月日を選択して判定する。
  await page.locator('#ob-year').selectOption(String(1990));
  await page.locator('#ob-month').selectOption(String(4));
  await page.locator('#ob-day').selectOption(String(15));
  await page.locator('#ob-judge').click();
  await expect(page.locator('#ob-result')).toBeVisible();
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');

  // 結果カードで「はじめる」→ トップ到達。
  await page.locator('#ob-start').click();

  // 2)「はじめる」後に onboarding クラスが外れ下部ナビ出現、#view-top が is-active。
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).toBeVisible();

  // 3) profile が保存され、トップの名前・絵文字が判定キャラと一致（ページ跨ぎ反映）。
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY);
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw as string)).toEqual({ birthdate: SEED_BIRTHDATE, charaId: SEED_CHARA_ID });
  await expect(page.locator('#top-name')).toHaveText('もりの子熊');
  await expect(page.locator('#top-emoji')).toHaveText('🐻');

  // 4) リロード後、isOnboarded()=真によりオンボーディングを経由せず直接トップ。
  await page.reload();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('#view-onboarding')).not.toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

// ---------------------------------------------------------------------------
// E2E-JOURNEY-002 記録→トップ反映: 未記録トップ → 記録タブ → 生理開始日記録 → トップ復帰でフェーズ表示
// ---------------------------------------------------------------------------
test('E2E-JOURNEY-002 記録→トップ反映: 記録タブで生理開始日記録→トップ復帰でフェーズ即時連携', async ({ page }) => {
  // 入口: profile 設定済み・periodStarts 無しで起動。
  await seedProfile(page);
  await page.goto('/');

  // 未記録トップ: #top-no-record 表示・#top-phase hidden。
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('#top-no-record')).toBeVisible();
  await expect(page.locator('#top-phase')).toBeHidden();

  // 1) #top-to-record クリックで記録ページへ遷移、下部ナビ記録ボタンが is-active。
  await page.locator('#top-to-record').click();
  await expect(page.locator('#view-record')).toHaveClass(/is-active/);
  await expect(page.locator('.bottom-nav button[data-nav="record"]')).toHaveClass(/is-active/);

  // 生理開始日（D0=今日）を入力し「記録」。
  const today = ymdFromToday(0);
  await page.locator('#rec-date').fill(today);
  await page.locator('#rec-save').click();
  await expect(page.locator('#rec-done')).toBeVisible();

  // 2) 保存が Domain.PERIOD_KEY に追記される。
  const stored = await page.evaluate((key) => window.localStorage.getItem(key), PERIOD_KEY);
  expect(JSON.parse(stored as string)).toEqual([today]);

  // 下部ナビ「トップ」をタップしてトップ復帰。
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);

  // 3) onShow("top") 再描画により、リロードなしでトップへ即時連携。
  await expect(page.locator('#top-no-record')).toBeHidden();
  await expect(page.locator('#top-phase')).toBeVisible();
  await expect(page.locator('#top-phase-name')).toHaveText('月経期'); // D0 → 月経期
  await expect(page.locator('#top-msg')).toBeVisible();

  // 4) #top-msg-body は当該フェーズ×profile.charaId の決定論メッセージと一致（公開関数経由で照合）。
  const expected = await page.evaluate(
    ([charaId, birthdate]) => Domain.getDailyMessage(charaId as number, 'menstrual', birthdate as string),
    [SEED_CHARA_ID, SEED_BIRTHDATE] as const,
  );
  expect((expected as string).length).toBeGreaterThan(0);
  await expect(page.locator('#top-msg-body')).toHaveText(expected as string);
});

// ---------------------------------------------------------------------------
// E2E-JOURNEY-003 LINE誘導導線: 黄体期記録 → トップのLINEバナー出現 → タップで予告ページ到達・案内強調
// ---------------------------------------------------------------------------
test('E2E-JOURNEY-003 LINE誘導導線: 黄体期トップのバナー→タップで予告ページ強調へ連携', async ({ page }) => {
  // 入口: profile 設定済み・periodStarts=[D-16]（黄体期相当・実行日基準の相対日付）。
  await seedProfile(page);
  await seedPeriodStarts(page, [ymdFromToday(-16)]);
  await page.goto('/');

  // 1) トップで黄体期、#top-line-banner が表示（hidden 解除）。
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('#top-phase-name')).toHaveText('黄体期');
  await expect(page.locator('#top-line-banner')).toBeVisible();

  // 2) バナータップで予告ページへ遷移、下部ナビ予告ボタンが is-active。
  await page.locator('#top-line-banner').click();
  await expect(page.locator('#view-forecast')).toHaveClass(/is-active/);
  await expect(page.locator('.bottom-nav button[data-nav="forecast"]')).toHaveClass(/is-active/);

  // 3) onShow("forecast") 再評価で #fc-line に .is-emphasized が付与され、黄体期フラグ文言一致。
  await expect(page.locator('#fc-line')).toHaveClass(/is-emphasized/);
  await expect(page.locator('#fc-line-flag')).toHaveText('🌙 ゆらぎやすい時期。今がおすすめ');

  // 4) #fc-line-id の href が LINE 公式アカウント URL。
  await expect(page.locator('#fc-line-id')).toHaveAttribute('href', 'https://line.me/R/ti/p/@l.hidamari');
});

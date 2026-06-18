import { test, expect, type Page } from '@playwright/test';

/**
 * P-003 予告（#view-forecast / data-view="forecast"） E2E
 * 対象: 実 index.html を実ブラウザで操作（モック・スタブ不使用）。
 * storage名前空間: nemorino:
 *   - profile        = { birthdate, charaId }   （App.PROFILE_KEY = "profile"）
 *   - periodStarts   = ["YYYY-MM-DD", ...]       （Domain.PERIOD_KEY = "periodStarts"・最新採用）
 *   - sweetCravings  = [{ date, level }, ...]     （Domain.SWEET_KEY = "sweetCravings"）
 *
 * 強調条件（実装 §4 / forecast script shouldEmphasize）:
 *   黄体期（最新生理開始日から17日目以降） または
 *   (periodStarts.length + sweetCravings.length) >= 3
 *
 * 特典文言・@l.hidamari は実装内 LINE_BODY / anchor に固定。期待値は仕様書 P-003 と
 * 一字一句一致で検証する（捏造禁止・各テスト独立・自前 storage 投入）。
 * フェーズ境界は「今日(2026-06-18)」起点の相対日（D-offset）で算出する。
 */

const PROFILE_KEY = 'nemorino:profile';
const PERIOD_KEY = 'nemorino:periodStarts';
const SWEET_KEY = 'nemorino:sweetCravings';

const BIRTHDATE = '1990-04-15';

// 今日(ローカル)から offset 日ずらした "YYYY-MM-DD" を返す（実際の今日起点）。
function ymdOffset(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

// 各テスト独立: 初回ナビゲーション時のみ nemorino: 名前空間を一掃して前提を投入する。
async function seed(page: Page, data: Record<string, unknown>) {
  await page.addInitScript((payload) => {
    try {
      if (!window.sessionStorage.getItem('__e2e_seeded')) {
        Object.keys(window.localStorage)
          .filter((k) => k.startsWith('nemorino:'))
          .forEach((k) => window.localStorage.removeItem(k));
        for (const [k, v] of Object.entries(payload)) {
          window.localStorage.setItem(k, v as string);
        }
        window.sessionStorage.setItem('__e2e_seeded', '1');
      }
    } catch (_) { /* storage制限環境ではそのまま */ }
  }, data);
}

function profileJson(charaId: number, birthdate = BIRTHDATE): string {
  return JSON.stringify({ birthdate, charaId });
}

// 予告タブを開く共通操作。
async function openForecast(page: Page) {
  await page.locator('.bottom-nav button[data-nav="forecast"]').click();
  await expect(page.locator('#view-forecast')).toHaveClass(/is-active/);
}

// ---------------------------------------------------------------------------
// E2E-FC-001: 予告ページ表示・ロックカード4枚
// ---------------------------------------------------------------------------
test('E2E-FC-001 予告ページ表示・ロックカード4枚（淡色・破線・🔒）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(0) });
  await page.goto('/');
  await openForecast(page);

  // 見出し・リード（改行込み）。
  await expect(page.locator('#view-forecast .app-title h1')).toHaveText('🔒 予告');
  const lead = await page.locator('#view-forecast .fc-lead').innerText();
  expect(lead.replace(/\s+/g, ' ').trim())
    .toBe('体験版ではここまで。 講座に入るとここまで分かります🌿');

  // ロックカード4枚・順序。
  const names = page.locator('#view-forecast .fc-lock .fc-lock-name');
  await expect(names).toHaveCount(4);
  await expect(names).toHaveText([
    '睡眠スコア自動算出',
    '食事の写真アップロード分析',
    '朝のスッキリ感チェック',
    '行動記録と睡眠の相関分析',
  ]);

  // 各カードに🔒。
  const keys = page.locator('#view-forecast .fc-lock .fc-lock-key');
  await expect(keys).toHaveCount(4);
  for (let i = 0; i < 4; i++) {
    await expect(keys.nth(i)).toHaveText('🔒');
  }

  // トーンダウン（破線枠）の実装確認: .fc-lock の border-style が dashed。
  const borderStyle = await page.locator('#view-forecast .fc-lock').first()
    .evaluate((el) => getComputedStyle(el).borderTopStyle);
  expect(borderStyle).toBe('dashed');

  // 末尾ヒント。
  await expect(page.locator('#view-forecast .fc-lock-hint'))
    .toHaveText('🎓 講座に入るとここまで分かります');
});

// ---------------------------------------------------------------------------
// E2E-FC-002: ロック機能は未実装（予告のみ・押しても何も起きない）
// ---------------------------------------------------------------------------
test('E2E-FC-002 ロックカードをタップしても遷移・機能起動なし', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(0) });
  await page.goto('/');
  await openForecast(page);

  const cards = page.locator('#view-forecast .fc-lock');
  const count = await cards.count();
  for (let i = 0; i < count; i++) {
    await cards.nth(i).click();
    // 予告ビューに留まり続ける（遷移なし）。
    await expect(page.locator('#view-forecast')).toHaveClass(/is-active/);
  }

  // 入力欄・ボタン等の操作可能要素がロックカード内に存在しない（予告表示のみ）。
  await expect(page.locator('#view-forecast .fc-lock input')).toHaveCount(0);
  await expect(page.locator('#view-forecast .fc-lock button')).toHaveCount(0);
  await expect(page.locator('#view-forecast .fc-lock a')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// E2E-FC-003: LINE特典文言が一字一句表示・@l.hidamari
// ---------------------------------------------------------------------------
test('E2E-FC-003 LINE特典4行一字一句一致・@l.hidamari/href/rel', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(0) });
  await page.goto('/');
  await openForecast(page);

  // 本文4行（改行込み・white-space:pre-line。textContent は \n を保持）。
  const expectedBody = [
    '📲LINEに登録すると今すぐ受け取れます🌿',
    '🧭 睡眠の羅針盤（独自の睡眠診断）',
    '🌱 今夜から使えるケア6選',
    '🎓 眠りの森学園 体験入学',
  ].join('\n');
  const body = await page.locator('#fc-line-body').textContent();
  expect(body).toBe(expectedBody);

  // 実装の真実の源（LINE_BODY）と描画が一致することを念のため確認。
  // LINE_BODY は forecast script 内クロージャで未公開のため、表示テキストと仕様書値の一致で担保。

  // リンク文言・href・rel。
  const link = page.locator('#fc-line-id');
  await expect(link).toHaveText('→ @l.hidamari');
  await expect(link).toHaveAttribute('href', 'https://line.me/R/ti/p/@l.hidamari');
  await expect(link).toHaveAttribute('rel', 'noreferrer noopener');
});

// ---------------------------------------------------------------------------
// E2E-FC-004: 通常時はLINE案内が常設（非強調）
// ---------------------------------------------------------------------------
test('E2E-FC-004 記録なし・非黄体期では常設だが非強調', async ({ page }) => {
  // periodStarts・sweetCravings 共に空（合計0件）かつ黄体期でない。
  await seed(page, { [PROFILE_KEY]: profileJson(0) });
  await page.goto('/');
  await openForecast(page);

  // 常設: 本文・@l.hidamari は表示される。
  await expect(page.locator('#fc-line-body')).toHaveText(/📲LINEに登録すると今すぐ受け取れます🌿/);
  await expect(page.locator('#fc-line-id')).toHaveText('→ @l.hidamari');

  // 強調なし: is-emphasized が付かない。
  await expect(page.locator('#fc-line')).not.toHaveClass(/is-emphasized/);

  // フラグ文言は CSS で非表示（is-emphasized 時のみ display:block）。
  await expect(page.locator('#fc-line-flag')).toBeHidden();
});

// ---------------------------------------------------------------------------
// E2E-FC-005: 黄体期で案内が強調される
// ---------------------------------------------------------------------------
test('E2E-FC-005 黄体期で is-emphasized・黄体期フラグ文言', async ({ page }) => {
  // 黄体期となる生理開始日（D-20 = 21日目 → 17日目以降で luteal）。
  await seed(page, {
    [PROFILE_KEY]: profileJson(0),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-20)]),
  });
  await page.goto('/');
  await openForecast(page);

  // 強調: is-emphasized が付く。
  await expect(page.locator('#fc-line')).toHaveClass(/is-emphasized/);

  // フラグ文言（黄体期）。
  await expect(page.locator('#fc-line-flag')).toBeVisible();
  await expect(page.locator('#fc-line-flag')).toHaveText('🌙 ゆらぎやすい時期。今がおすすめ');

  // 太枠＋影の実装確認（border-width が太く・box-shadow が none でない）。
  const styles = await page.locator('#fc-line').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { border: cs.borderTopWidth, shadow: cs.boxShadow };
  });
  expect(parseFloat(styles.border)).toBeGreaterThan(1);
  expect(styles.shadow).not.toBe('none');

  // 本文・@l.hidamari は引き続き表示。
  await expect(page.locator('#fc-line-body')).toHaveText(/📲LINEに登録すると今すぐ受け取れます🌿/);
  await expect(page.locator('#fc-line-id')).toHaveText('→ @l.hidamari');
});

// ---------------------------------------------------------------------------
// E2E-FC-006: 記録合計3件以上で強調（非黄体期でも）
// ---------------------------------------------------------------------------
test('E2E-FC-006 非黄体期でも記録合計3件以上で is-emphasized・記録フラグ文言', async ({ page }) => {
  // 黄体期にならない直近の生理開始日（D-5 = 6日目 → 卵胞期）を1件、
  // 甘いもの欲を別日2件 → 合計3件で強調条件を満たす（非黄体期）。
  await seed(page, {
    [PROFILE_KEY]: profileJson(0),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-5)]),
    [SWEET_KEY]: JSON.stringify([
      { date: ymdOffset(-1), level: 2 },
      { date: ymdOffset(-2), level: 3 },
    ]),
  });
  await page.goto('/');
  await openForecast(page);

  // 黄体期ではないことを実装で確認（前提の妥当性検証・捏造防止）。
  const phaseId = await page.evaluate(() => {
    const starts = (Storage as any).get((Domain as any).PERIOD_KEY, []);
    const start = (Domain as any).latestPeriodStart(starts);
    const phase = start ? (Domain as any).getPhaseFromStart(start) : null;
    return phase ? phase.id : null;
  });
  expect(phaseId).not.toBe('luteal');

  // 強調: is-emphasized が付く。
  await expect(page.locator('#fc-line')).toHaveClass(/is-emphasized/);

  // フラグ文言（記録蓄積）。
  await expect(page.locator('#fc-line-flag')).toBeVisible();
  await expect(page.locator('#fc-line-flag')).toHaveText('🌱 記録おつかれさま。続きはLINEで');

  // 本文・@l.hidamari は引き続き表示。
  await expect(page.locator('#fc-line-body')).toHaveText(/📲LINEに登録すると今すぐ受け取れます🌿/);
  await expect(page.locator('#fc-line-id')).toHaveText('→ @l.hidamari');
});

// ---------------------------------------------------------------------------
// E2E-FC-007: トップ黄体期バナー → 予告遷移（ページ間連携）
// ---------------------------------------------------------------------------
test('E2E-FC-007 トップ黄体期バナータップで予告へ遷移・強調状態', async ({ page }) => {
  // 黄体期となる生理開始日を記録済み（FC-005 と同等の状態）。
  await seed(page, {
    [PROFILE_KEY]: profileJson(0),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-20)]),
  });
  await page.goto('/');

  // トップに黄体期バナーが表示されている。
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  const banner = page.locator('#top-line-banner');
  await expect(banner).toBeVisible();
  await expect(banner.locator('.fc-line-flag'))
    .toHaveText('🌙 ゆらぎやすい時期。LINE特典を見る →');

  // タップで予告ビューへ遷移。
  await banner.click();
  await expect(page.locator('#view-forecast')).toHaveClass(/is-active/);

  // 予告ページの LINE案内が強調状態（FC-005 同等）。
  await expect(page.locator('#fc-line')).toHaveClass(/is-emphasized/);
  await expect(page.locator('#fc-line-flag')).toHaveText('🌙 ゆらぎやすい時期。今がおすすめ');
  await expect(page.locator('#fc-line-body')).toHaveText(/📲LINEに登録すると今すぐ受け取れます🌿/);
  await expect(page.locator('#fc-line-id')).toHaveText('→ @l.hidamari');
});

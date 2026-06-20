import { test, expect, type Page } from '@playwright/test';

/**
 * P-005 傾向インサイト＆やり直す E2E
 * 対象: 実 index.html を実ブラウザで操作（モック不使用）。
 * storage名前空間: nemorino:
 *   - profile        = { birthdate, charaId }            （App.PROFILE_KEY）
 *   - periodStarts   = ["YYYY-MM-DD", ...]               （Domain.PERIOD_KEY）
 *   - sweetCravings  = [{ date:"YYYY-MM-DD", level:1-4 }]（Domain.SWEET_KEY）
 *   - menopause      = true|false                        （Domain.MENOPAUSE_KEY）
 *   - grow/quiz/inventory/outfit                         （リセット対象）
 *
 * 真実の源は実装の Domain（computeSweetInsight / PHASES / getPhaseFromStart）と DOM。
 * 期待文言は仕様書 P-005 と Domain.computeSweetInsight の出力に厳密一致で照合する。
 * フェーズ依存ケースは実行日(2026-06-18)起点の相対日付(D±n)でレコード・開始日を投入し、固定日付は埋め込まない。
 * 各テスト独立: addInitScript で初回のみ nemorino名前空間を一掃→前提投入（reload では消さない）。
 */

const PROFILE_KEY = 'nemorino:profile';
const PERIOD_KEY = 'nemorino:periodStarts';
const SWEET_KEY = 'nemorino:sweetCravings';
const MENOPAUSE_KEY = 'nemorino:menopause';
const GROW_KEY = 'nemorino:grow';
const QUIZ_KEY = 'nemorino:quiz';
const INVENTORY_KEY = 'nemorino:inventory';
const OUTFIT_KEY = 'nemorino:outfit';

// やり直す RESET_KEYS（仕様書§の8キー / 真実の源は reset スクリプト定数）。
const RESET_FULL_KEYS = [
  PROFILE_KEY, PERIOD_KEY, SWEET_KEY, MENOPAUSE_KEY,
  GROW_KEY, QUIZ_KEY, INVENTORY_KEY, OUTFIT_KEY,
];

const BIRTHDATE = '1990-04-15'; // charaId 5

// 今日(ローカル=2026-06-18)から offset 日ずらした "YYYY-MM-DD"。
function ymdOffset(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function profileJson(charaId = 5, birthdate = BIRTHDATE): string {
  return JSON.stringify({ birthdate, charaId });
}

function sweet(offsetDays: number, level: number) {
  return { date: ymdOffset(offsetDays), level };
}

// 初回ナビゲーションのみ storage を一掃し前提投入（永続化検証のため reload では維持）。
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

// 記録タブへ遷移。
async function openRecord(page: Page) {
  await page.locator('.bottom-nav button[data-nav="record"]').click();
  await expect(page.locator('[data-view="record"]')).toHaveClass(/is-active/);
}

// トップタブへ遷移。
async function openTop(page: Page) {
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await expect(page.locator('[data-view="top"]')).toHaveClass(/is-active/);
}

// nemorino:<key> の生値が存在するか（reset 検証用）。
async function hasKey(page: Page, fullKey: string): Promise<boolean> {
  return page.evaluate((k) => window.localStorage.getItem(k) !== null, fullKey);
}

// Domain.computeSweetInsight を実装で評価（真実の源・テスト側に文言を二重定義しない）。
// Domain は script トップレベルの const（bare global 参照で取得・p-002 と同パターン）。
async function expectInsight(page: Page, records: unknown, starts: unknown, menopause: boolean) {
  return page.evaluate(([r, s, m]) =>
    (Domain as any).computeSweetInsight(r, s, m), [records, starts, menopause] as const);
}

// =====================================================================
// 1. 記録不足時の促し（導線なし）
// =====================================================================

test('P005-INS-01 記録ゼロ件は促し表示（導線なし）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() }); // sweetCravings 未記録
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-insight-body'))
    .toHaveText('あと 5 回ほど甘いもの欲を記録すると、傾向が見えてきます🌿');
  await expect(page.locator('#rec-insight-nudge')).toBeHidden();
});

test('P005-INS-02 4件は未満で促し（残り回数表示）', async ({ page }) => {
  const records = [sweet(-3, 1), sweet(-2, 2), sweet(-1, 3), sweet(0, 4)];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-insight-body'))
    .toHaveText('あと 1 回ほど甘いもの欲を記録すると、傾向が見えてきます🌿');
  await expect(page.locator('#rec-insight-nudge')).toBeHidden();
});

test('P005-INS-03 無効levelは件数に数えない', async ({ page }) => {
  // 有効4件 + 無効(level0 / level5)。isSweetLevel を満たさない分は集計対象外。
  const records = [
    sweet(-5, 1), sweet(-4, 2), sweet(-3, 3), sweet(-2, 4),
    sweet(-1, 0), sweet(0, 5),
  ];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-insight-body'))
    .toHaveText('あと 1 回ほど甘いもの欲を記録すると、傾向が見えてきます🌿');
  await expect(page.locator('#rec-insight-nudge')).toBeHidden();
});

// =====================================================================
// 2. 5件以上で傾向＋導線表示
// =====================================================================

// 開始日 D-30 を基準にすると days=offset+31。
// 月経期 1..5 → offset -30..-26 / 卵胞期 6..13 → -25..-18
// 排卵期 14..16 → -17..-15 / 黄体期 ≥17 → offset ≥ -14
const LUTEAL_START = ymdOffset(-30);

test('P005-INS-04 黄体期に欲が高いタイプを表示', async ({ page }) => {
  // 黄体期(offset≥-14)に高レベル、他フェーズに低レベル → luteal 平均が最大。
  const records = [
    sweet(-14, 4), sweet(-10, 4), sweet(-5, 4), // 黄体期
    sweet(-25, 1),                              // 卵胞期
    sweet(-28, 1),                              // 月経期
  ];
  const starts = [LUTEAL_START];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify(starts),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  const r = await expectInsight(page, records, starts, false) as any;
  expect(r.enough).toBe(true);
  expect(r.topPhase).toBe('luteal');
  await expect(page.locator('#rec-insight-body')).toHaveText(r.message);
  // 仕様書明記の文言と一致（黄体期）。
  await expect(page.locator('#rec-insight-body')).toHaveText(
    '黄体期に甘いもの欲が高まりやすいタイプのようです。それは自然な体のリズム。責めずに、やさしくいたわってあげて🌷');
});

test('P005-INS-05 フェーズ別最大平均のフェーズが選ばれる（卵胞期）', async ({ page }) => {
  // 卵胞期(offset -25..-18)に高レベル集中 → follicular 平均が最大。
  const records = [
    sweet(-25, 4), sweet(-22, 4), sweet(-18, 4), // 卵胞期
    sweet(-5, 1),                                // 黄体期
    sweet(-28, 1),                               // 月経期
  ];
  const starts = [LUTEAL_START];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify(starts),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  const r = await expectInsight(page, records, starts, false) as any;
  expect(r.enough).toBe(true);
  expect(r.topPhase).toBe('follicular');
  // 文頭は当該フェーズ label（PHASES から取得）。
  const label = await page.evaluate(() => (Domain as any).PHASES.follicular.label);
  await expect(page.locator('#rec-insight-body')).toHaveText(r.message);
  await expect(page.locator('#rec-insight-body')).toContainText(label + 'に甘いもの欲が高まりやすいタイプ');
});

test('P005-INS-06 傾向表示時はLINE/体験入学導線が出る', async ({ page }) => {
  const records = [
    sweet(-14, 4), sweet(-10, 4), sweet(-5, 4),
    sweet(-25, 1), sweet(-28, 1),
  ];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([LUTEAL_START]),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-insight-nudge')).toBeVisible();
  await expect(page.locator('#rec-insight-nudge-text'))
    .toHaveText('自分のリズムが分かると、整え方も見えてきます。もっと深く知りたくなったら🌱');
  await expect(page.locator('#rec-insight-link'))
    .toHaveText('→ LINE / 体験入学を見る');
  await expect(page.locator('#rec-insight-link'))
    .toHaveAttribute('href', 'https://s.lmes.jp/landing-qr/2006353028-ZkXRAR0K?uLand=HfZHgJ');
});

test('P005-INS-07 同条件は決定論で同一文', async ({ page }) => {
  const records = [
    sweet(-14, 4), sweet(-10, 4), sweet(-5, 4),
    sweet(-25, 1), sweet(-28, 1),
  ];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([LUTEAL_START]),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);
  const first = await page.locator('#rec-insight-body').textContent();

  await page.reload(); // storage は維持
  await openRecord(page);
  const second = await page.locator('#rec-insight-body').textContent();

  expect(first).not.toBeNull();
  expect(second).toBe(first);
});

// =====================================================================
// 3. 閉経時のフェーズ非依存切替
// =====================================================================

test('P005-INS-08 閉経時はフェーズ非依存の傾向文に切替', async ({ page }) => {
  // menopause=true・有効5件以上で平均 avg≥3（高レベル中心）。
  const records = [sweet(-4, 4), sweet(-3, 4), sweet(-2, 3), sweet(-1, 3), sweet(0, 4)];
  const starts: string[] = [];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [MENOPAUSE_KEY]: JSON.stringify(true),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  const r = await expectInsight(page, records, starts, true) as any;
  expect(r.enough).toBe(true);
  expect(r.menopause).toBe(true);
  await expect(page.locator('#rec-insight-body')).toHaveText(r.message);
  await expect(page.locator('#rec-insight-body')).toHaveText(
    'これまでの記録では、甘いもの欲が高まりやすい傾向が見られます。記録を続けるほど、あなたのリズムが見えてきます🌿');
  // フェーズ名（○○期）は出ない。
  await expect(page.locator('#rec-insight-body')).not.toContainText('期に甘いもの欲');
});

test('P005-INS-09 閉経・中程度平均で文言が変わる', async ({ page }) => {
  // menopause=true・平均が 2〜3未満（level2 中心）→ sweetTendencyWord 中段分岐。
  const records = [sweet(-4, 2), sweet(-3, 2), sweet(-2, 2), sweet(-1, 2), sweet(0, 2)];
  const starts: string[] = [];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [MENOPAUSE_KEY]: JSON.stringify(true),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  const r = await expectInsight(page, records, starts, true) as any;
  expect(r.enough).toBe(true);
  expect(r.menopause).toBe(true);
  await expect(page.locator('#rec-insight-body')).toHaveText(r.message);
  await expect(page.locator('#rec-insight-body')).toContainText('ほどほどに甘いものが恋しくなる傾向が見られます');
});

test('P005-INS-10 生理開始日未記録（閉経OFF）でもフェーズ非依存に切替', async ({ page }) => {
  // menopause=false・periodStarts 未記録・有効5件以上 → 全体平均文（menopause:true 相当）。
  const records = [sweet(-4, 4), sweet(-3, 4), sweet(-2, 3), sweet(-1, 3), sweet(0, 4)];
  const starts: string[] = [];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [SWEET_KEY]: JSON.stringify(records),
  }); // periodStarts / menopause 未投入
  await page.goto('/');
  await openRecord(page);

  const r = await expectInsight(page, records, starts, false) as any;
  expect(r.enough).toBe(true);
  expect(r.menopause).toBe(true); // 最新開始日が無くフェーズ分類できない
  await expect(page.locator('#rec-insight-body')).toHaveText(r.message);
  await expect(page.locator('#rec-insight-body')).toHaveText(
    'これまでの記録では、甘いもの欲が高まりやすい傾向が見られます。記録を続けるほど、あなたのリズムが見えてきます🌿');
  await expect(page.locator('#rec-insight-body')).not.toContainText('期に甘いもの欲');
});

test('P005-INS-11 閉経時も傾向出れば導線表示', async ({ page }) => {
  const records = [sweet(-4, 4), sweet(-3, 4), sweet(-2, 3), sweet(-1, 3), sweet(0, 4)];
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [MENOPAUSE_KEY]: JSON.stringify(true),
    [SWEET_KEY]: JSON.stringify(records),
  });
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-insight-nudge')).toBeVisible();
  await expect(page.locator('#rec-insight-link'))
    .toHaveText('→ LINE / 体験入学を見る');
  await expect(page.locator('#rec-insight-link'))
    .toHaveAttribute('href', 'https://s.lmes.jp/landing-qr/2006353028-ZkXRAR0K?uLand=HfZHgJ');
});

// =====================================================================
// 4. やり直す：2段階確認
// =====================================================================

test('P005-RST-01 やり直すリンクの存在（確認カード初期は非表示）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openTop(page);

  await expect(page.locator('#top-reset-link')).toBeVisible();
  await expect(page.locator('#top-reset-link')).toHaveText('やり直す（はじめからにする）');
  await expect(page.locator('#top-reset-confirm')).toBeHidden();
});

test('P005-RST-02 リンク押下で確認カードが開く', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click();
  await expect(page.locator('#top-reset-confirm')).toBeVisible();
  await expect(page.locator('#top-reset-link')).toBeHidden();
  await expect(page.locator('#top-reset-no')).toHaveText('やめておく');
  await expect(page.locator('#top-reset-yes')).toHaveText('はい、やり直す');
  await expect(page.locator('#top-reset-confirm')).toContainText('本当にやり直しますか？');
});

test('P005-RST-03 確認なしではデータが消えない', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-3)]),
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
  });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click(); // 確認カードを開くだけ
  await expect(page.locator('#top-reset-confirm')).toBeVisible();

  expect(await hasKey(page, PROFILE_KEY)).toBe(true);
  expect(await hasKey(page, PERIOD_KEY)).toBe(true);
  expect(await hasKey(page, SWEET_KEY)).toBe(true);
});

test('P005-RST-04 キャンセルで確認カードを閉じデータ維持', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-3)]),
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
  });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click();
  await page.locator('#top-reset-no').click();

  await expect(page.locator('#top-reset-confirm')).toBeHidden();
  await expect(page.locator('#top-reset-link')).toBeVisible();
  expect(await hasKey(page, PROFILE_KEY)).toBe(true);
  expect(await hasKey(page, PERIOD_KEY)).toBe(true);
  expect(await hasKey(page, SWEET_KEY)).toBe(true);
});

test('P005-RST-05 タブ離脱で確認状態がリセットされる', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click();
  await expect(page.locator('#top-reset-confirm')).toBeVisible();

  await openRecord(page); // 別タブへ移動
  await openTop(page);    // 再びトップへ → onShow("top") で初期状態へ

  await expect(page.locator('#top-reset-confirm')).toBeHidden();
  await expect(page.locator('#top-reset-link')).toBeVisible();
});

// =====================================================================
// 5. やり直す：実行（全クリア＆オンボーディング復帰）
// =====================================================================

test('P005-RST-06 実行で全 RESET_KEYS を削除', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-3)]),
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
    [MENOPAUSE_KEY]: JSON.stringify(false),
    [GROW_KEY]: JSON.stringify({ startYmd: ymdOffset(-1), lastOpenYmd: ymdOffset(0), openDays: 2, collection: [] }),
    [QUIZ_KEY]: JSON.stringify({ lastYmd: ymdOffset(0), answered: {}, correct: {}, bonusDone: {} }),
    [INVENTORY_KEY]: JSON.stringify(['x']),
    [OUTFIT_KEY]: JSON.stringify(['x']),
  });
  await page.goto('/');
  await openTop(page);

  // 8キーすべて投入済みを確認。
  for (const k of RESET_FULL_KEYS) {
    expect(await hasKey(page, k)).toBe(true);
  }

  await page.locator('#top-reset-link').click();
  await page.locator('#top-reset-yes').click();
  await page.waitForLoadState('load'); // reload 完了待ち

  for (const k of RESET_FULL_KEYS) {
    expect(await hasKey(page, k)).toBe(false);
  }
});

test('P005-RST-07 実行後オンボーディングへ復帰', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [PERIOD_KEY]: JSON.stringify([ymdOffset(-3)]),
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
  });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click();
  await page.locator('#top-reset-yes').click();
  await page.waitForLoadState('load');

  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await expect(page.locator('#view-top')).not.toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).toBeHidden();
});

test('P005-RST-08 reload不可環境のフォールバック', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
  });
  await page.goto('/');
  await openTop(page);

  // location.reload を例外化（不可環境を再現）。フォールバックでオンボーディングへ。
  // window.location.reload は非設定可のため、Location.prototype 側を上書きして例外化する。
  await page.evaluate(() => {
    Object.defineProperty(Object.getPrototypeOf(window.location), 'reload', {
      configurable: true,
      writable: true,
      value: () => { throw new Error('reload disabled'); },
    });
  });

  await page.locator('#top-reset-link').click();
  await page.locator('#top-reset-yes').click();

  // reload せずフォールバック：キー削除＋オンボーディング表示（エラーで落ちない）。
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/onboarding/);
  expect(await hasKey(page, PROFILE_KEY)).toBe(false);
  expect(await hasKey(page, SWEET_KEY)).toBe(false);
});

test('P005-RST-09 再判定後は通常フローに復帰できる', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(0), // 旧キャラ
    [SWEET_KEY]: JSON.stringify([sweet(0, 3)]),
  });
  await page.goto('/');
  await openTop(page);

  await page.locator('#top-reset-link').click();
  await page.locator('#top-reset-yes').click();
  await page.waitForLoadState('load');
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);

  // 新しい生年月日で判定 → profile 保存 → はじめる → トップへ。
  await page.locator('#ob-year').selectOption('1990');
  await page.locator('#ob-month').selectOption('4');
  await page.locator('#ob-day').selectOption('15');
  await page.locator('#ob-judge').click();
  await expect(page.locator('#ob-result')).toBeVisible();
  await page.locator('#ob-start').click();

  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/onboarding/);

  // 新 profile が保存され、旧記録は引き継がれない。
  const profile = await page.evaluate(() => {
    const raw = window.localStorage.getItem('nemorino:profile');
    return raw == null ? null : JSON.parse(raw);
  });
  expect(profile).not.toBeNull();
  expect((profile as any).birthdate).toBe('1990-04-15');
  expect(await hasKey(page, SWEET_KEY)).toBe(false); // 旧記録は復帰しない
});

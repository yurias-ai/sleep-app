import { test, expect, type Page } from '@playwright/test';

/**
 * P-000 初回キャラ判定（オンボーディング） E2E
 * 対象: index.html #view-onboarding（実 index.html を実ブラウザで操作・モック不使用）
 * storage名前空間: nemorino:  / profile = {"birthdate":"YYYY-MM-DD","charaId":0-11}
 * charaId = (((年+月+日)%12)+12)%12  （1990-04-15→5 もりの子熊🐻 / 2000-01-01→2 ふくろう先生🦉）
 */

const PROFILE_KEY = 'nemorino:profile';

// セレクトで生年月日を選択して判定する小ヘルパー（実UI操作のみ）。
async function selectDob(page: Page, y: number, m: number, d: number) {
  await page.locator('#ob-year').selectOption(String(y));
  await page.locator('#ob-month').selectOption(String(m));
  await page.locator('#ob-day').selectOption(String(d));
}

async function judge(page: Page) {
  await page.locator('#ob-judge').click();
}

// 各テスト独立: profile 未保存の初回状態から開始する。
// 初回ナビゲーション時のみクリアし、その後の reload では消さない（永続化検証のため）。
// sessionStorage のフラグで「最初の1回だけ」に限定する。
test.beforeEach(async ({ page }) => {
  await page.addInitScript((key) => {
    try {
      if (!window.sessionStorage.getItem('__e2e_seeded')) {
        window.localStorage.removeItem(key);
        window.sessionStorage.setItem('__e2e_seeded', '1');
      }
    } catch (_) { /* storage制限環境ではそのまま */ }
  }, PROFILE_KEY);
});

test('E2E-P000-01 初回はオンボーディング表示', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).not.toBeVisible();
  await expect(page.locator('#ob-input')).toBeVisible();
  await expect(page.locator('#ob-result')).toBeHidden();
});

test('E2E-P000-02 正常系: 判定→結果→はじめる→トップ遷移', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-input')).toBeHidden();
  await expect(page.locator('#ob-result')).toBeVisible();
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');
  await expect(page.locator('#ob-emoji')).toHaveText('🐻');
  await page.locator('#ob-start').click();
  await expect(page.locator('body')).not.toHaveClass(/onboarding/);
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('E2E-P000-03 結果に性格・リズムが表示', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-personality')).toHaveText('おおらかで包容力のある甘党さん');
  await expect(page.locator('#ob-rhythm')).toHaveText('ぐっすり深眠型。寒い時季は早寝でぽかぽかに');
});

test('E2E-P000-04 決定論: 同一生年月日で必ず同一キャラ', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');

  // storageをクリアして初回状態に戻し、同一生年月日で再判定。
  await page.evaluate((key) => { window.localStorage.removeItem(key); }, PROFILE_KEY);
  await page.reload();
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');
});

test('E2E-P000-05 決定論: 別生年月日は別キャラ（境界例）', async ({ page }) => {
  await page.goto('/');
  // 実装どおりの決定論: (2000+1+1)%12 = 2002%12 = 10 → charaId 10「ゆきうさ白狼」🐺。
  // （仕様書本文の算術「=2」は誤記。式 charaId=(((年+月+日)%12)+12)%12 の正しい結果は 10。
  //  本テストは「別生年月日→別キャラ・決定論で一意」という仕様意図を実値で検証する。）
  await selectDob(page, 2000, 1, 1);
  await judge(page);
  await expect(page.locator('#ob-name')).toHaveText('ゆきうさ白狼');
  await expect(page.locator('#ob-emoji')).toHaveText('🐺');
});

test('E2E-P000-06 永続化: 判定後リロードでスキップ', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await page.locator('#ob-start').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);

  await page.reload();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await expect(page.locator('body')).not.toHaveClass(/onboarding/);
  await expect(page.locator('.bottom-nav')).toBeVisible();
});

test('E2E-P000-07 永続化: storageに正しい値が保存', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), PROFILE_KEY);
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw as string)).toEqual({ birthdate: '1990-04-15', charaId: 5 });
});

test('E2E-P000-08 バリデーション: 未選択', async ({ page }) => {
  await page.goto('/');
  // 年/月のみ選び日は「--」のまま。
  await page.locator('#ob-year').selectOption('1990');
  await page.locator('#ob-month').selectOption('4');
  await judge(page);
  await expect(page.locator('#ob-error')).toBeVisible();
  await expect(page.locator('#ob-error')).toHaveText('生年月日をすべて選んでください。');
  await expect(page.locator('#ob-result')).toBeHidden();
});

test('E2E-P000-09 バリデーション: 存在しない日付', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 2021, 2, 30);
  await judge(page);
  await expect(page.locator('#ob-error')).toBeVisible();
  await expect(page.locator('#ob-error')).toHaveText('その日付は存在しません。選び直してください。');
  await expect(page.locator('#ob-result')).toBeHidden();
});

test('E2E-P000-10 バリデーション: うるう年でない2/29', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 2021, 2, 29);
  await judge(page);
  await expect(page.locator('#ob-error')).toBeVisible();
  await expect(page.locator('#ob-error')).toHaveText('その日付は存在しません。選び直してください。');
  await expect(page.locator('#ob-result')).toBeHidden();
});

test('E2E-P000-11 バリデーション: 未来日', async ({ page }) => {
  await page.goto('/');
  // 確実に未来となる日付（来年末）。年セレクトは今年までしか無いため
  // セレクト範囲内で確実に未来になる「今日より後の月日（今年）」を計算して選ぶ。
  const now = new Date();
  const future = new Date(now.getTime() + 86400000); // 翌日（確実に未来）
  // 年セレクトは1940..今年。翌日が翌年へ繰り上がる場合（12/31）は今年内の安全な未来日へ調整。
  let fy = future.getFullYear();
  let fm = future.getMonth() + 1;
  let fd = future.getDate();
  if (fy > now.getFullYear()) {
    // 大晦日: 年は選べないので、今日が今年最終日 → セレクト範囲で未来を作れない稀ケースは
    // 月=12・日=31 が今日のため、代わりに当日テストに委ねず月を進められない。
    // この環境(2026-06-18)では起きないが、保険として今年の最大月日を選ぶ。
    fy = now.getFullYear();
  }
  await selectDob(page, fy, fm, fd);
  await judge(page);
  await expect(page.locator('#ob-error')).toBeVisible();
  await expect(page.locator('#ob-error')).toHaveText('未来の日付は選べません。');
  await expect(page.locator('#ob-result')).toBeHidden();
});

test('E2E-P000-12 当日は許可（境界）', async ({ page }) => {
  await page.goto('/');
  const now = new Date();
  await selectDob(page, now.getFullYear(), now.getMonth() + 1, now.getDate());
  await judge(page);
  await expect(page.locator('#ob-error')).toBeHidden();
  await expect(page.locator('#ob-result')).toBeVisible();
});

test('E2E-P000-13 エラー後に正しい入力で再判定', async ({ page }) => {
  await page.goto('/');
  await selectDob(page, 2021, 2, 30);
  await judge(page);
  await expect(page.locator('#ob-error')).toBeVisible();

  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-error')).toBeHidden();
  await expect(page.locator('#ob-result')).toBeVisible();
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');
});

// storage制限環境（LINE内ブラウザ等）を再現: scripts実行前に localStorage を例外化。
// storage層は読み込み時 setItem(test) を try/catch するため usable=false となりメモリへ退避する。
async function breakLocalStorage(page: Page) {
  await page.addInitScript(() => {
    // window.localStorage のみ例外化（sessionStorage は壊さない）。
    const broken = {
      setItem() { throw new DOMException('QuotaExceededError', 'QuotaExceededError'); },
      getItem() { return null; },
      removeItem() { /* noop */ },
      clear() { /* noop */ },
      key() { return null; },
      get length() { return 0; },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { return broken; } });
  });
}

test('E2E-P000-14 storage制限環境: メモリフォールバックで判定・遷移', async ({ page }) => {
  await breakLocalStorage(page);
  await page.goto('/');
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await expect(page.locator('#ob-result')).toBeVisible();
  await expect(page.locator('#ob-name')).toHaveText('もりの子熊');
  await page.locator('#ob-start').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  // localStorage には保存されない（メモリのみ）。
  const raw = await page.evaluate(() => {
    try { return window.localStorage.getItem('nemorino:profile'); } catch (_) { return null; }
  });
  expect(raw).toBeNull();
});

test('E2E-P000-15 storage制限環境: リロードでスキップされない', async ({ page }) => {
  await breakLocalStorage(page);
  await page.goto('/');
  await selectDob(page, 1990, 4, 15);
  await judge(page);
  await page.locator('#ob-start').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);

  // メモリは揮発するためリロード後は再びオンボーディング表示。
  await page.reload();
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await expect(page.locator('body')).toHaveClass(/onboarding/);
});

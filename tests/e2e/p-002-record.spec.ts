import { test, expect, type Page } from '@playwright/test';

/**
 * P-002 記録（#view-record / 下部ナビ「📝 記録」） E2E
 * 対象: 実 index.html を実ブラウザで操作（モック不使用）。
 * storage名前空間: nemorino:
 *   - profile        = { birthdate, charaId }
 *   - periodStarts   = ["YYYY-MM-DD", ...]            （Domain.PERIOD_KEY）
 *   - sweetCravings  = [{ date:"YYYY-MM-DD", level:1-4 }]（Domain.SWEET_KEY）
 *
 * 真実の源は実装の Domain（SWEET_LEVELS / getPhaseFromStart など）と DOM。
 * 期待文言は仕様書 P-002-記録-e2e.md に厳密一致で照合する。
 * 各テスト独立: addInitScript で初回のみ nemorino名前空間を一掃→前提投入（reloadでは消さない）。
 */

const PROFILE_KEY = 'nemorino:profile';
const PERIOD_KEY = 'nemorino:periodStarts';
const SWEET_KEY = 'nemorino:sweetCravings';

const BIRTHDATE = '1990-04-15'; // charaId 5（もりの子熊）

// 今日(ローカル)から offset 日ずらした "YYYY-MM-DD"。
function ymdOffset(offsetDays: number): string {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function profileJson(charaId: number, birthdate = BIRTHDATE): string {
  return JSON.stringify({ birthdate, charaId });
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

// nemorino:<key> を JSON parse して返す（未設定は null）。
async function readStore(page: Page, fullKey: string): Promise<unknown> {
  return page.evaluate((k) => {
    const raw = window.localStorage.getItem(k);
    return raw == null ? null : JSON.parse(raw);
  }, fullKey);
}

// 実装の SWEET_LEVELS（真実の源）を取得。
async function sweetLevels(page: Page): Promise<Array<{ level: number; label: string }>> {
  return page.evaluate(() => (Domain as any).SWEET_LEVELS.map((x: any) => ({ level: x.level, label: x.label })));
}

// =====================================================================
// 1. 生理開始日の記録
// =====================================================================

test('P002-PERIOD-01 正常記録→保存・doneにフェーズ名', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) }); // periodStarts 未記録
  await page.goto('/');
  await openRecord(page);

  const ymd = ymdOffset(0); // 当日（実在・非未来）
  await page.locator('#rec-date').fill(ymd);
  await page.locator('#rec-save').click();

  // storage に当日が追加。
  expect(await readStore(page, PERIOD_KEY)).toEqual([ymd]);

  // done 表示・実装どおりのフェーズ名（開始日=当日 → 1日目 = 月経期）。
  const expectedLabel = await page.evaluate((y) => {
    const [yy, mm, dd] = y.split('-').map(Number);
    const phase = (Domain as any).getPhaseFromStart(new Date(yy, mm - 1, dd));
    return phase ? phase.label : '—';
  }, ymd);
  await expect(page.locator('#rec-done')).toBeVisible();
  await expect(page.locator('#rec-done'))
    .toHaveText('記録しました。今日のリズムは「' + expectedLabel + '」です🌙');
  await expect(page.locator('#rec-error')).toBeHidden();
});

test('P002-PERIOD-02 フェーズがトップに反映（ページ間連携）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  const ymd = ymdOffset(-5); // 6日目 → 卵胞期
  await page.locator('#rec-date').fill(ymd);
  await page.locator('#rec-save').click();

  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await expect(page.locator('[data-view="top"]')).toHaveClass(/is-active/);
  await expect(page.locator('#top-phase')).toBeVisible();
  await expect(page.locator('#top-msg')).toBeVisible();
  await expect(page.locator('#top-no-record')).toBeHidden();
  await expect(page.locator('#top-phase-name')).toHaveText('卵胞期');
});

test('P002-PERIOD-03 重複日は二重登録されない', async ({ page }) => {
  const ymd = ymdOffset(-2);
  await seed(page, { [PROFILE_KEY]: profileJson(5), [PERIOD_KEY]: JSON.stringify([ymd]) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-date').fill(ymd); // 同一日を再入力
  await page.locator('#rec-save').click();

  expect(await readStore(page, PERIOD_KEY)).toEqual([ymd]); // 増えない
  await expect(page.locator('#rec-done')).toBeVisible();
  await expect(page.locator('#rec-error')).toBeHidden();
});

test('P002-PERIOD-04 複数の異なる日を記録・最新起点で判定', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  const older = ymdOffset(-30);
  const newer = ymdOffset(-5); // 6日目 → 卵胞期
  await page.locator('#rec-date').fill(older);
  await page.locator('#rec-save').click();
  await page.locator('#rec-date').fill(newer);
  await page.locator('#rec-save').click();

  expect(await readStore(page, PERIOD_KEY)).toEqual([older, newer]);

  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await expect(page.locator('#top-phase-name')).toHaveText('卵胞期'); // 最新=newer起点
});

test('P002-PERIOD-05 日付未選択でエラー', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-date').fill(''); // 空に
  await page.locator('#rec-save').click();

  await expect(page.locator('#rec-error')).toBeVisible();
  await expect(page.locator('#rec-error')).toHaveText('日付を選んでください。');
  expect(await readStore(page, PERIOD_KEY)).toBeNull();
  await expect(page.locator('#rec-done')).toBeHidden();
});

test('P002-PERIOD-06 未来日でエラー・記録されない', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  // max=今日 のためピッカーでは抑止されるが、value を直接未来日に設定して保存を試みる。
  const future = ymdOffset(1);
  await page.evaluate((y) => { (document.getElementById('rec-date') as HTMLInputElement).value = y; }, future);
  await page.locator('#rec-save').click();

  await expect(page.locator('#rec-error')).toBeVisible();
  await expect(page.locator('#rec-error')).toHaveText('未来の日付は記録できません。');
  expect(await readStore(page, PERIOD_KEY)).toBeNull();

  // 補足: max 属性が今日。
  await expect(page.locator('#rec-date')).toHaveAttribute('max', ymdOffset(0));
});

test('P002-PERIOD-07 非実在日でエラー', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  // 2026-02-30 は実在しない。input[type=date] はブラウザが不正値を空に正規化して保持しないため、
  // 構文上は正しい非実在日文字列を value に載せられるよう一時的に type=text にしてから設定する
  // （検証対象は実装の onSavePeriod → isValidDate 判定。ブラウザのネイティブ正規化は本コードの責務外）。
  await page.evaluate(() => {
    const el = document.getElementById('rec-date') as HTMLInputElement;
    el.type = 'text';
    el.value = '2026-02-30';
  });
  await page.locator('#rec-save').click();

  await expect(page.locator('#rec-error')).toBeVisible();
  await expect(page.locator('#rec-error')).toHaveText('その日付は存在しません。');
  expect(await readStore(page, PERIOD_KEY)).toBeNull();
});

test('P002-PERIOD-08 入力初期値が当日', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);
  await expect(page.locator('#rec-date')).toHaveValue(ymdOffset(0));
});

// =====================================================================
// 2. 甘いもの欲（任意・4段階タップ）
// =====================================================================

test('P002-SWEET-01 レベル1記録・aria-pressed反映', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-sweet-list button[data-level="1"]').click();

  expect(await readStore(page, SWEET_KEY)).toEqual([{ date: ymdOffset(0), level: 1 }]);
  await expect(page.locator('#rec-sweet-list button[data-level="1"]')).toHaveAttribute('aria-pressed', 'true');
  for (const lv of [2, 3, 4]) {
    await expect(page.locator(`#rec-sweet-list button[data-level="${lv}"]`)).toHaveAttribute('aria-pressed', 'false');
  }
});

test('P002-SWEET-02 レベル2/3/4記録・該当のみpressed', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  for (const target of [2, 3, 4]) {
    await page.locator(`#rec-sweet-list button[data-level="${target}"]`).click();
    expect(await readStore(page, SWEET_KEY)).toEqual([{ date: ymdOffset(0), level: target }]);
    for (const lv of [1, 2, 3, 4]) {
      await expect(page.locator(`#rec-sweet-list button[data-level="${lv}"]`))
        .toHaveAttribute('aria-pressed', lv === target ? 'true' : 'false');
    }
  }
});

test('P002-SWEET-03 同日再タップで上書き（重複しない）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5), [SWEET_KEY]: JSON.stringify([{ date: ymdOffset(0), level: 1 }]) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-sweet-list button[data-level="4"]').click();

  const stored = await readStore(page, SWEET_KEY) as Array<{ date: string; level: number }>;
  expect(stored.length).toBe(1);
  expect(stored[0]).toEqual({ date: ymdOffset(0), level: 4 });
  await expect(page.locator('#rec-sweet-list button[data-level="4"]')).toHaveAttribute('aria-pressed', 'true');
  for (const lv of [1, 2, 3]) {
    await expect(page.locator(`#rec-sweet-list button[data-level="${lv}"]`)).toHaveAttribute('aria-pressed', 'false');
  }
});

test('P002-SWEET-04 任意項目（未記録でもエラーなし）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  // 甘いもの欲を一切タップせず生理開始日のみ記録 → 成立しエラー無し。
  const ymd = ymdOffset(0);
  await page.locator('#rec-date').fill(ymd);
  await page.locator('#rec-save').click();

  await expect(page.locator('#rec-done')).toBeVisible();
  await expect(page.locator('#rec-error')).toBeHidden();
  expect(await readStore(page, SWEET_KEY)).toBeNull(); // 甘いもの欲は未保存
  expect(await readStore(page, PERIOD_KEY)).toEqual([ymd]); // 生理記録は成立
});

test('P002-SWEET-05 状態の永続反映（タブ往復で復元）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5), [SWEET_KEY]: JSON.stringify([{ date: ymdOffset(0), level: 3 }]) });
  await page.goto('/');
  await openRecord(page);
  await expect(page.locator('#rec-sweet-list button[data-level="3"]')).toHaveAttribute('aria-pressed', 'true');

  // 別タブ→記録タブへ戻る（storageから再同期）。
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openRecord(page);
  await expect(page.locator('#rec-sweet-list button[data-level="3"]')).toHaveAttribute('aria-pressed', 'true');
  for (const lv of [1, 2, 4]) {
    await expect(page.locator(`#rec-sweet-list button[data-level="${lv}"]`)).toHaveAttribute('aria-pressed', 'false');
  }
});

test('P002-SWEET-06 4段階すべてのボタンが生成・ラベル一致', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  const levels = await sweetLevels(page); // 真実の源
  const btns = page.locator('#rec-sweet-list button[data-level]');
  await expect(btns).toHaveCount(4);

  for (const item of levels) {
    const btn = page.locator(`#rec-sweet-list button[data-level="${item.level}"]`);
    await expect(btn).toHaveCount(1);
    await expect(btn).toContainText(item.label); // SWEET_LEVELS の文言と一致
  }
});

// =====================================================================
// 3. 甘いもの欲グラフ（直近14日・CSS bar）
// =====================================================================

test('P002-CHART-01 データ無し時の空状態', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) }); // sweetCravings 未記録
  await page.goto('/');
  await openRecord(page);

  await expect(page.locator('#rec-chart-empty')).toBeVisible();
  await expect(page.locator('#rec-chart-wrap')).toBeHidden();
  await expect(page.locator('#rec-chart .rec-bar-cell')).toHaveCount(0);
});

test('P002-CHART-02 データ反映（14日内・当日列）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-sweet-list button[data-level="2"]').click();

  await expect(page.locator('#rec-chart-wrap')).toBeVisible();
  await expect(page.locator('#rec-chart-empty')).toBeHidden();
  await expect(page.locator('#rec-chart .rec-bar-cell')).toHaveCount(14);

  // 当日列＝最後のセル（buildSeries は古い→新しい順）。
  const lastBar = page.locator('#rec-chart .rec-bar-cell').last().locator('.rec-bar');
  await expect(lastBar).toHaveClass(/lv2/);
  // 高さ level/4 × 100% = 50%。
  const height = await lastBar.evaluate((el) => (el as HTMLElement).style.height);
  expect(height).toBe('50%');
});

test('P002-CHART-03 レベル別の高さ・クラス（最大4=100%）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  await page.locator('#rec-sweet-list button[data-level="4"]').click();

  const cells = page.locator('#rec-chart .rec-bar-cell');
  await expect(cells).toHaveCount(14);

  const lastBar = cells.last().locator('.rec-bar');
  await expect(lastBar).toHaveClass(/lv4/);
  expect(await lastBar.evaluate((el) => (el as HTMLElement).style.height)).toBe('100%'); // 4/4

  // 記録の無い日（先頭セル）は .empty・高さ3px。
  const firstBar = cells.first().locator('.rec-bar');
  await expect(firstBar).toHaveClass(/empty/);
  expect(await firstBar.evaluate((el) => (el as HTMLElement).style.height)).toBe('3px');
});

test('P002-CHART-04 14日より古い記録は範囲外（空状態は出ない）', async ({ page }) => {
  // 15日以上前の記録のみ存在。
  await seed(page, {
    [PROFILE_KEY]: profileJson(5),
    [SWEET_KEY]: JSON.stringify([{ date: ymdOffset(-20), level: 3 }]),
  });
  await page.goto('/');
  await openRecord(page);

  // 配列が空でないため空状態は出ず棒グラフ枠が表示。
  await expect(page.locator('#rec-chart-wrap')).toBeVisible();
  await expect(page.locator('#rec-chart-empty')).toBeHidden();
  await expect(page.locator('#rec-chart .rec-bar-cell')).toHaveCount(14);

  // 直近14日に該当棒は無い → lv1〜lv4 のクラスを持つ棒は0本（全て empty）。
  await expect(page.locator('#rec-chart .rec-bar.lv1, #rec-chart .rec-bar.lv2, #rec-chart .rec-bar.lv3, #rec-chart .rec-bar.lv4')).toHaveCount(0);
  await expect(page.locator('#rec-chart .rec-bar.empty')).toHaveCount(14);
});

// =====================================================================
// 4. データ自己完結・無料明記
// =====================================================================

test('P002-LOCAL-01 端末内storageのみ・外部送信なし', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });

  // ネットワーク監視: アプリ自身のドキュメント以外への送信があれば失敗とする。
  const externalRequests: string[] = [];
  page.on('request', (req) => {
    const url = req.url();
    if (!url.startsWith('http://localhost:3384') && !url.startsWith('data:') && !url.startsWith('blob:')) {
      externalRequests.push(`${req.method()} ${url}`);
    }
  });

  await page.goto('/');
  await openRecord(page);

  // 記録操作（生理開始日＋甘いもの欲）。
  const ymd = ymdOffset(0);
  await page.locator('#rec-date').fill(ymd);
  await page.locator('#rec-save').click();
  await page.locator('#rec-sweet-list button[data-level="3"]').click();

  // CSP connect-src 'none' によりブラウザ内 fetch/XHR/beacon は遮断される。
  // 念のため fetch を試みても外部送信が成立しないことを確認。
  const fetchBlocked = await page.evaluate(async () => {
    try {
      await fetch('https://example.com/collect', { method: 'POST', body: '1' });
      return false; // 送信が成立してしまった
    } catch (_) {
      return true; // CSP で遮断（期待）
    }
  });
  expect(fetchBlocked).toBe(true);

  // 記録操作中に外部への通信は一切発生していない。
  expect(externalRequests).toEqual([]);

  // データは nemorino名前空間の localStorage にのみ書き込まれる。
  expect(await readStore(page, PERIOD_KEY)).toEqual([ymd]);
  expect(await readStore(page, SWEET_KEY)).toEqual([{ date: ymd, level: 3 }]);
});

test('P002-LOCAL-02 localStorage不可環境のフォールバック', async ({ page }) => {
  // window.localStorage を例外化（読み書き全てthrow）→ 実コードの usable=false / メモリMap経路を通す。
  await page.addInitScript(() => {
    const thrower = {
      getItem() { throw new Error('blocked'); },
      setItem() { throw new Error('blocked'); },
      removeItem() { throw new Error('blocked'); },
      clear() { throw new Error('blocked'); },
      key() { throw new Error('blocked'); },
      get length(): number { throw new Error('blocked'); },
    };
    Object.defineProperty(window, 'localStorage', { configurable: true, get() { return thrower; } });
  });

  await page.goto('/');
  // localStorage不可 → profile も読めずオンボーディング。UIでキャラ判定し profile をメモリへ。
  await expect(page.locator('#view-onboarding')).toHaveClass(/is-active/);
  await page.locator('#ob-year').selectOption('1990');
  await page.locator('#ob-month').selectOption('4');
  await page.locator('#ob-day').selectOption('15');
  await page.locator('#ob-judge').click();
  await page.locator('#ob-start').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);

  // 記録タブで甘いもの欲を記録（メモリへ）。
  await openRecord(page);
  await page.locator('#rec-sweet-list button[data-level="2"]').click();
  await expect(page.locator('#rec-sweet-list button[data-level="2"]')).toHaveAttribute('aria-pressed', 'true');

  // 別タブ往復 → メモリ内stateから aria-pressed / グラフが復元される（エラーで落ちない）。
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openRecord(page);
  await expect(page.locator('#rec-sweet-list button[data-level="2"]')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#rec-chart-wrap')).toBeVisible();
  await expect(page.locator('#rec-chart .rec-bar-cell')).toHaveCount(14);
});

test('P002-FREE-01 無料明記の表示', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(5) });
  await page.goto('/');
  await openRecord(page);

  const noteText = (await page.locator('#view-record .note').allInnerTexts()).join('\n');
  expect(noteText).toContain('完全無料です。料金は一切かかりません。');
  expect(noteText).toContain('記録データはこの端末内のみで扱い、外部に送信されません。');
});

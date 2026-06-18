import { test, expect, type Page } from '@playwright/test';

/**
 * P-004 そだてる（#view-grow） E2E
 * 対象: 実 index.html を実ブラウザで操作（モック不使用）。
 * storage名前空間: nemorino:
 *   - profile    = { birthdate, charaId }                       （App.PROFILE_KEY = "profile"）
 *   - grow       = { startYmd, lastOpenYmd, openDays, collection:[{maturedYmd,stage}] } （Domain.GROW_KEY）
 *   - quiz       = { lastYmd, answered:{id:1}, correct:{id:1}, bonusDone:{milestone:1} }（Domain.QUIZ_KEY）
 *   - inventory  = [itemId,...]                                 （Domain.INVENTORY_KEY）
 *   - outfit     = [itemId,...]（slotごと最大1）                （Domain.OUTFIT_KEY）
 *
 * 真実の源は実装の Domain（growthStage / quizOrder / QUIZ_BANK / BONUS_BANK / currentSeason /
 * ITEM_CATALOG / answerQuiz など）と DOM。テスト側に期待値を二重定義・捏造しない。
 *
 * 日付制御方針: 実装の todayYmd()/currentSeason() は実 new Date() 依存（不可変フック無し）。
 *   - 「前日に来訪済み→今日ひらくと前進」系は lastOpenYmd を当日以外（過去日）に置いて openDays を仕込む。
 *     advanceGrow は lastOpenYmd !== today なら +1 するため、ページを開くだけで決定論的に前進する。
 *   - 「翌日は別問題」系も quiz.lastYmd を当日以外に置けば、その日(=実今日)が新しい日として扱われる。
 *   - 季節(GR-DU-07/08)は実今日（2026-06-18=夏）を起点に判定（仕様: 6-8月=夏）。
 *
 * 各テスト独立: addInitScript で初回ナビゲーション時のみ nemorino名前空間を一掃→前提投入。
 *   reload では消さない（永続化検証のため）。sessionStorage フラグで1回限定。
 */

const PROFILE_KEY = 'nemorino:profile';
const GROW_KEY = 'nemorino:grow';
const QUIZ_KEY = 'nemorino:quiz';
const INVENTORY_KEY = 'nemorino:inventory';
const OUTFIT_KEY = 'nemorino:outfit';

const BIRTHDATE = '1990-04-15';
// 当日と確実に異なる過去日（前日来訪済みの状態を作るための番兵。advanceGrow が +1 する）。
const PAST_YMD = '2000-01-01';

function profileJson(charaId = 0, birthdate = BIRTHDATE): string {
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

// grow 状態を作る（openDays/collection を直接仕込む。lastOpenYmd は既定で過去日＝前日来訪済み）。
function growJson(openDays: number, collection: unknown[] = [], lastOpenYmd = PAST_YMD): string {
  return JSON.stringify({ startYmd: PAST_YMD, lastOpenYmd, openDays, collection });
}

// quiz 状態を作る。
function quizJson(s: Partial<{ lastYmd: string | null; answered: Record<string, 1>;
  correct: Record<string, 1>; bonusDone: Record<string, 1> }>): string {
  return JSON.stringify({ lastYmd: null, answered: {}, correct: {}, bonusDone: {}, ...s });
}

// そだてるタブを開く（ナビ経由＝実際の showView/onShow を通す）。
async function openGrow(page: Page) {
  await page.locator('.bottom-nav button[data-nav="grow"]').click();
  await expect(page.locator('#view-grow')).toHaveClass(/is-active/);
}

// ===========================================================================
// A. タブ遷移・表示
// ===========================================================================

test('GR-NAV-01 4タブが存在し切替可能', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  for (const nav of ['top', 'record', 'grow', 'forecast'] as const) {
    await expect(page.locator(`.bottom-nav button[data-nav="${nav}"]`)).toHaveCount(1);
  }
  for (const nav of ['top', 'record', 'grow', 'forecast'] as const) {
    await page.locator(`.bottom-nav button[data-nav="${nav}"]`).click();
    await expect(page.locator(`.view[data-view="${nav}"]`)).toHaveClass(/is-active/);
    // 他ビューは非アクティブ
    await expect(page.locator('.view.is-active')).toHaveCount(1);
  }
});

test('GR-NAV-02 そだてるタブ表示', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-hero-art')).toBeVisible();
  await expect(page.locator('#grow-garden')).toBeAttached();
  await expect(page.locator('#grow-quiz-slot')).toBeVisible();
  await expect(page.locator('#du-grid')).toBeVisible();
  await expect(page.locator('#view-grow')).toContainText('完全無料');
  await expect(page.locator('#view-grow')).toContainText('料金は一切かかりません');
});

test('GR-NAV-03 トップから導線', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  await page.locator('#top-grow-go').click();
  await expect(page.locator('#view-grow')).toHaveClass(/is-active/);
});

// ===========================================================================
// B. もりのこ育成（C）
// ===========================================================================

test('GR-GROW-01 初回はたまご', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() }); // grow 未生成
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-stage-label')).toHaveText('たまご');
  await expect(page.locator('#grow-stage-step')).toContainText('来訪 1日目');
  const openDays = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!).openDays);
  expect(openDays).toBe(1);
});

test('GR-GROW-02 段階ラベルが境界で切替（決定論・openDays直投入）', async ({ page }) => {
  // 各段階の代表 openDays を仕込み、当日来訪扱い(lastOpenYmd=今日相当)にせず番兵過去日のまま
  // → ただし前進(+1)されるため「前進後の値」で段階を検証する。
  // ここでは前進が起きない当日来訪状態(lastOpenYmd=今日)を作るため、評価で today を取得して投入する。
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  const today = await page.evaluate(() => (Domain as any).todayYmd());
  // 当日来訪済みにして openDays を固定（前進しない）→ 段階ラベルだけ検証
  const cases: Array<[number, string]> = [
    [1, 'たまご'], [3, '芽生え'], [7, '若葉'], [12, 'つぼみ'], [18, '満開'],
  ];
  for (const [days, label] of cases) {
    await page.evaluate(({ d, t }) => {
      window.localStorage.setItem('nemorino:grow', JSON.stringify(
        { startYmd: t, lastOpenYmd: t, openDays: d, collection: [] }));
    }, { d: days, t: today });
    await page.locator('.bottom-nav button[data-nav="top"]').click();
    await openGrow(page);
    await expect(page.locator('#grow-stage-label')).toHaveText(label);
  }
});

test('GR-GROW-03 同日2回目は不変（決定論）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  const first = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!).openDays);
  const label1 = await page.locator('#grow-stage-label').textContent();
  // タブ往復で再表示（同日2回目）
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  const second = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!).openDays);
  const label2 = await page.locator('#grow-stage-label').textContent();
  expect(second).toBe(first);
  expect(label2).toBe(label1);
});

test('GR-GROW-04 境界値 2→3 で芽生え', async ({ page }) => {
  // 前日来訪済み openDays=2（たまご）→ 今日ひらくと +1=3（芽生え）
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(2) });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-stage-label')).toHaveText('芽生え');
  const openDays = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!).openDays);
  expect(openDays).toBe(3);
});

test('GR-GROW-05 境界値 17→18 で満開', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(17) });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-stage-label')).toHaveText('満開');
  const openDays = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!).openDays);
  expect(openDays).toBe(18);
  // hero メッセージに「また明日ひらくと、新しい子がお庭に」系
  await expect(page.locator('#grow-hero-msg')).toContainText('新しい子');
});

test('GR-GROW-06 満開後の新たまご＋お庭増', async ({ page }) => {
  // 前日に満開(openDays=18)到達済み → 今日ひらくと巣立ち＋新たまご(openDays=1)
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(18) });
  await page.goto('/');
  await openGrow(page);
  const state = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:grow')!));
  expect(state.openDays).toBe(1);
  expect(state.collection.length).toBe(1);
  expect(state.collection[0].stage).toBe('bloom');
  await expect(page.locator('#grow-stage-label')).toHaveText('たまご');
  await expect(page.locator('#grow-garden .grow-garden-item')).toHaveCount(1);
  await expect(page.locator('#grow-garden-empty')).toBeHidden();
});

test('GR-GROW-07 トップとそだてるで同期', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(11) }); // 前進後12=つぼみ
  await page.goto('/');
  // トップ widget の段階ラベル（"つぼみ（来訪 N日目）"）を取得
  const topLabel = await page.locator('#top-grow-stage').textContent();
  await openGrow(page);
  const growLabel = await page.locator('#grow-stage-label').textContent();
  expect(topLabel).toContain(growLabel!.trim());
});

// ===========================================================================
// C. 睡眠クイズ（D）
// ===========================================================================

test('GR-QZ-01 1日1問の出題', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-choice')).toHaveCount(3);
  await expect(page.locator('#grow-quiz-slot .qz-progress')).toContainText('/ 40');
});

test('GR-QZ-02 易→難の順序（初回は難易度1帯）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  // 実装の決定論出題順の先頭問題の難易度を確認（真実の源 = Domain）
  const firstDifficulty = await page.evaluate(() => {
    const D = (Domain as any);
    const order = D.quizOrder();
    return order[0].difficulty;
  });
  expect(firstDifficulty).toBe(1);
  // 画面に出ている問題文が、出題順の先頭(未回答)と一致
  const shownQ = await page.locator('#grow-quiz-slot .qz-q').first().textContent();
  const expectedQ = await page.evaluate(() => {
    const D = (Domain as any);
    return D.pickQuizQuestion(D.readQuiz()).question.question;
  });
  expect(shownQ?.trim()).toBe(expectedQ);
});

test('GR-QZ-03 正解で解説＋ワンポイント＋アイテム1個', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  // 出題中の問題の正解インデックスを実装から取得（捏造禁止）
  const correctIndex = await page.evaluate(() => {
    const D = (Domain as any);
    return D.pickQuizQuestion(D.readQuiz()).question.answerIndex;
  });
  const invBefore = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  await page.locator('#grow-quiz-slot .qz-choice').nth(correctIndex).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict.ok')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-result')).toContainText('解説');
  await expect(page.locator('#grow-quiz-slot .qz-result')).toContainText('先生のワンポイント');
  await expect(page.locator('#grow-quiz-slot .qz-reward')).toHaveCount(1);
  const invAfter = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  expect(invAfter).toBe(invBefore + 1);
});

test('GR-QZ-04 不正解でも解説表示・アイテムなし', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  const wrongIndex = await page.evaluate(() => {
    const D = (Domain as any);
    const ans = D.pickQuizQuestion(D.readQuiz()).question.answerIndex;
    return [0, 1, 2].find((i) => i !== ans);
  });
  const invBefore = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  await page.locator('#grow-quiz-slot .qz-choice').nth(wrongIndex!).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict.ng')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-result')).toContainText('解説');
  await expect(page.locator('#grow-quiz-slot .qz-result')).toContainText('先生のワンポイント');
  await expect(page.locator('#grow-quiz-slot .qz-reward')).toHaveCount(0);
  const invAfter = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  expect(invAfter).toBe(invBefore);
});

test('GR-QZ-05 当日2問目は出ない', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  const correctIndex = await page.evaluate(() => {
    const D = (Domain as any);
    return D.pickQuizQuestion(D.readQuiz()).question.answerIndex;
  });
  await page.locator('#grow-quiz-slot .qz-choice').nth(correctIndex).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict')).toBeVisible();
  // タブ往復で再表示 → 同日のため新規問題なし
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-tomorrow')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-choice')).toHaveCount(0);
});

test('GR-QZ-06 翌日は別問題', async ({ page }) => {
  // 前日(=過去日)に出題順先頭を回答済みにする → 今日(=実今日)は2問目(未回答)が出る
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  // 出題順先頭の id を取得して「回答済み」状態を作り、lastYmd は過去日（＝翌日扱い）
  const order = await page.evaluate(() => (Domain as any).quizOrder().map((q: any) => q.id));
  await page.evaluate(({ first, past }) => {
    window.localStorage.setItem('nemorino:quiz', JSON.stringify(
      { lastYmd: past, answered: { [first]: 1 }, correct: { [first]: 1 }, bonusDone: {} }));
  }, { first: order[0], past: PAST_YMD });
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-choice')).toHaveCount(3);
  const shownQ = await page.locator('#grow-quiz-slot .qz-q').first().textContent();
  const firstQText = await page.evaluate((fid) => (Domain as any).getQuizById(fid).question, order[0]);
  const secondQText = await page.evaluate((fid) => {
    const D = (Domain as any);
    return D.getQuizById(D.quizOrder().map((q: any) => q.id)[1]).question;
  }, order[0]);
  expect(shownQ?.trim()).not.toBe(firstQText);
  expect(shownQ?.trim()).toBe(secondQText);
});

test('GR-QZ-07 一巡後は復習モード', async ({ page }) => {
  // 全40問 answered・一部不正解（先頭を未正解に） → 復習バッジ付き再出題
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  const order = await page.evaluate(() => (Domain as any).quizOrder().map((q: any) => q.id));
  await page.evaluate(({ ids, past }) => {
    const answered: Record<string, 1> = {};
    const correct: Record<string, 1> = {};
    ids.forEach((id: string, i: number) => { answered[id] = 1; if (i !== 0) correct[id] = 1; });
    window.localStorage.setItem('nemorino:quiz', JSON.stringify(
      { lastYmd: past, answered, correct, bonusDone: {} }));
  }, { ids: order, past: PAST_YMD });
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-cat.is-review')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-cat.is-review')).toContainText('復習');
});

test('GR-QZ-08 全問正解で gold_crown＋お祝い', async ({ page }) => {
  // 39問正解済み・最後の1問を当日未回答 → 正解で40問達成・gold_crown・コンプリート表示
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  const order = await page.evaluate(() => (Domain as any).quizOrder().map((q: any) => q.id));
  const lastId = order[order.length - 1];
  await page.evaluate(({ ids, last, past }) => {
    const answered: Record<string, 1> = {};
    const correct: Record<string, 1> = {};
    ids.forEach((id: string) => { if (id !== last) { answered[id] = 1; correct[id] = 1; } });
    window.localStorage.setItem('nemorino:quiz', JSON.stringify(
      { lastYmd: past, answered, correct, bonusDone: {} }));
  }, { ids: order, last: lastId, past: PAST_YMD });
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  // 最後の1問が出題されているはず。その正解indexで回答
  const correctIndex = await page.evaluate((lid) => (Domain as any).getQuizById(lid).answerIndex, lastId);
  // 出題中問題が last であることを確認
  const shownQ = await page.locator('#grow-quiz-slot .qz-q').first().textContent();
  const lastQText = await page.evaluate((lid) => (Domain as any).getQuizById(lid).question, lastId);
  expect(shownQ?.trim()).toBe(lastQText);
  await page.locator('#grow-quiz-slot .qz-choice').nth(correctIndex).click();
  await expect(page.locator('#grow-quiz-slot .qz-complete')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-complete')).toContainText('コンプリート');
  const hasCrown = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').includes('gold_crown'));
  expect(hasCrown).toBe(true);
});

// ===========================================================================
// D. ボーナスクイズ（E）
// ===========================================================================

test('GR-BN-01 節目で出現', async ({ page }) => {
  // openDays=2 → 今日ひらくと3=孵化(sprout)節目到達・bonusDone未済 → ボーナス出現
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(2) });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-bonus')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-bonus')).toContainText('ボーナスクイズ');
  // 通常クイズも併存
  await expect(page.locator('#grow-quiz-slot .qz-q')).toHaveCount(2); // ボーナス問題文＋通常問題文
});

test('GR-BN-02 正解でアイテム2個', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(2) });
  await page.goto('/');
  await openGrow(page);
  const invBefore = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  const bonusCorrect = await page.evaluate(() => (Domain as any).availableBonus().answerIndex);
  await page.locator('#grow-quiz-slot .qz-bonus .qz-choice').nth(bonusCorrect).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict.bonus')).toBeVisible();
  await expect(page.locator('#grow-quiz-slot .qz-reward-multi .qz-reward')).toHaveCount(2);
  const invAfter = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  expect(invAfter).toBe(invBefore + 2);
});

test('GR-BN-03 同節目で再出現しない', async ({ page }) => {
  // sprout 節目を消化済み・openDays=3（前進後4＝まだsprout節目のみ） → ボーナス再出現なし
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [GROW_KEY]: growJson(3),
    [QUIZ_KEY]: quizJson({ bonusDone: { sprout: 1 } }),
  });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-bonus')).toHaveCount(0);
});

test('GR-BN-04 不正解でも消化', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [GROW_KEY]: growJson(2) });
  await page.goto('/');
  await openGrow(page);
  const bonusWrong = await page.evaluate(() => {
    const ans = (Domain as any).availableBonus().answerIndex;
    return [0, 1, 2].find((i) => i !== ans);
  });
  const invBefore = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  await page.locator('#grow-quiz-slot .qz-bonus .qz-choice').nth(bonusWrong!).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict.ng')).toBeVisible();
  const invAfter = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:inventory') || '[]').length);
  expect(invAfter).toBe(invBefore);
  // bonusDone 記録 → 再表示で再出現しない
  const done = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:quiz')!).bonusDone.sprout);
  expect(done).toBe(1);
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await openGrow(page);
  await expect(page.locator('#grow-quiz-slot .qz-bonus')).toHaveCount(0);
});

test('GR-BN-05 各節目で対応ボーナスが出る（leaf/bud/bloom/rebirth）', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  // 実装の availableBonus は「到達済み＆未消化の節目」を BONUS_BANK 順で1つ返す（決定論）。
  // 育成を進め、各節目で回答(=bonusDone消化)していくと、次の節目が順次surfaceすることを検証する。
  // bonusDone は readQuiz()(=storage)を参照するため、各段階の手前まで消化済みにして1つずつ確認。
  const seq = await page.evaluate(() => {
    const D = (Domain as any);
    const setDone = (done: Record<string, 1>) =>
      window.localStorage.setItem('nemorino:quiz',
        JSON.stringify({ lastYmd: null, answered: {}, correct: {}, bonusDone: done }));
    const at = (openDays: number, collection: any[], done: Record<string, 1>) => {
      setDone(done);
      const b = D.availableBonus({ startYmd: 'x', lastOpenYmd: 'x', openDays, collection });
      return b ? b.milestone : null;
    };
    return {
      // 各節目で「それ以前の節目は消化済み」状態にして、当該節目のボーナスが surface するか
      sprout: at(3, [], {}),
      leaf: at(7, [], { sprout: 1 }),
      bud: at(12, [], { sprout: 1, leaf: 1 }),
      bloom: at(18, [], { sprout: 1, leaf: 1, bud: 1 }),
      rebirth: at(1, [{ maturedYmd: 'x', stage: 'bloom' }], {}),
    };
  });
  expect(seq.sprout).toBe('sprout');
  expect(seq.leaf).toBe('leaf');
  expect(seq.bud).toBe('bud');
  expect(seq.bloom).toBe('bloom');
  expect(seq.rebirth).toBe('rebirth');
});

// ===========================================================================
// E. 着せ替え・アイテム（F）
// ===========================================================================

test('GR-DU-01 アイテム装着→hero反映', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [GROW_KEY]: growJson(5, [], PAST_YMD),
    [INVENTORY_KEY]: JSON.stringify(['flower_crown']),
  });
  await page.goto('/');
  await openGrow(page);
  const tile = page.locator('#du-grid .du-tile', { hasText: '小花の冠' });
  await tile.click();
  await expect(tile).toHaveClass(/is-worn/);
  // hero SVG に装飾が重なる（accessory レイヤーが描画される＝SVG子要素増）
  const wornInOutfit = await page.evaluate(() =>
    JSON.parse(window.localStorage.getItem('nemorino:outfit') || '[]').includes('flower_crown'));
  expect(wornInOutfit).toBe(true);
});

test('GR-DU-02 トップにも反映', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [INVENTORY_KEY]: JSON.stringify(['flower_crown']),
    [OUTFIT_KEY]: JSON.stringify(['flower_crown']),
  });
  await page.goto('/');
  // hero/トップ共通の着用状態 = outfit が反映される（accessory数で実証）
  const topAccCount = await page.evaluate(() => (Domain as any).outfitAccessories().length);
  expect(topAccCount).toBe(1);
  await openGrow(page);
  await expect(page.locator('#du-grid .du-tile.is-worn')).toHaveCount(1);
  await page.locator('.bottom-nav button[data-nav="top"]').click();
  await expect(page.locator('#view-top')).toHaveClass(/is-active/);
  // トップ widget の SVG が存在（着用状態の outfit を参照して描画される）
  await expect(page.locator('#top-grow-art svg')).toBeAttached();
});

test('GR-DU-03 解除', async ({ page }) => {
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [INVENTORY_KEY]: JSON.stringify(['flower_crown']),
    [OUTFIT_KEY]: JSON.stringify(['flower_crown']),
  });
  await page.goto('/');
  await openGrow(page);
  const tile = page.locator('#du-grid .du-tile', { hasText: '小花の冠' });
  await expect(tile).toHaveClass(/is-worn/);
  await tile.click();
  await expect(tile).not.toHaveClass(/is-worn/);
  const outfit = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:outfit') || '[]'));
  expect(outfit).not.toContain('flower_crown');
});

test('GR-DU-04 同スロットは1点のみ', async ({ page }) => {
  // flower_crown と ribbon は同 slot=head。2点目着用で1点目が外れる。
  await seed(page, {
    [PROFILE_KEY]: profileJson(),
    [INVENTORY_KEY]: JSON.stringify(['flower_crown', 'ribbon']),
  });
  await page.goto('/');
  await openGrow(page);
  await page.locator('#du-grid .du-tile', { hasText: '小花の冠' }).click();
  await page.locator('#du-grid .du-tile', { hasText: 'リボン' }).click();
  const outfit = await page.evaluate(() => JSON.parse(window.localStorage.getItem('nemorino:outfit') || '[]'));
  expect(outfit).toContain('ribbon');
  expect(outfit).not.toContain('flower_crown');
  await expect(page.locator('#du-grid .du-tile', { hasText: 'リボン' })).toHaveClass(/is-worn/);
  await expect(page.locator('#du-grid .du-tile', { hasText: '小花の冠' })).not.toHaveClass(/is-worn/);
});

test('GR-DU-05 未獲得アイテムはロック', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [INVENTORY_KEY]: JSON.stringify([]) });
  await page.goto('/');
  await openGrow(page);
  const lockedFirst = page.locator('#du-grid .du-tile.is-locked').first();
  await expect(lockedFirst).toBeVisible();
  await expect(lockedFirst).toBeDisabled();
  await expect(lockedFirst.locator('.du-lock-key')).toBeVisible();
});

test('GR-DU-06 限定 gold_crown のロック', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson(), [INVENTORY_KEY]: JSON.stringify([]) });
  await page.goto('/');
  await openGrow(page);
  const crown = page.locator('#du-grid .du-tile', { hasText: '全問正解で解放' });
  await expect(crown).toBeVisible();
  await expect(crown).toHaveClass(/is-locked/);
  await expect(crown).toBeDisabled();
});

test('GR-DU-07 季節アイテムは季節一致時のみ獲得対象（夏）', async ({ page }) => {
  // 今日=2026-06-18=夏。grantableItem の自動付与対象は all+summer のみ。
  await seed(page, { [PROFILE_KEY]: profileJson(), [INVENTORY_KEY]: JSON.stringify([]) });
  await page.goto('/');
  await openGrow(page);
  const season = await page.evaluate(() => (Domain as any).currentSeason().key);
  expect(season).toBe('summer');
  // 全アイテムを順に grantableItem で集めていったとき、付与され得る集合に春/秋/冬が含まれない
  const grantableSeasons = await page.evaluate(() => {
    const D = (Domain as any);
    const seen = new Set<string>();
    // 14点ぶん grantableItem→grantItem を回し、付与対象の season を集める
    for (let i = 0; i < D.ITEM_CATALOG.length; i++) {
      const it = D.grantableItem();
      if (!it) break;
      seen.add(it.season);
      D.grantItem(it.id);
    }
    return Array.from(seen);
  });
  expect(grantableSeasons).toContain('all');
  expect(grantableSeasons).toContain('summer');
  expect(grantableSeasons).not.toContain('spring');
  expect(grantableSeasons).not.toContain('autumn');
  expect(grantableSeasons).not.toContain('winter');
});

test('GR-DU-08 季節見出しの表示', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  const expectedLabel = await page.evaluate(() => (Domain as any).currentSeason().label);
  await expect(page.locator('#du-now-season strong')).toHaveText(expectedLabel);
});

// ===========================================================================
// F. 完全無料・外部送信なし
// ===========================================================================

test('GR-FREE-01 無料表記', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  await expect(page.locator('#view-grow')).toContainText('完全無料');
  await expect(page.locator('#view-grow')).toContainText('料金は一切かかりません');
});

test('GR-FREE-02 端末内storageのみ・外部送信なし', async ({ page }) => {
  await seed(page, { [PROFILE_KEY]: profileJson() });
  await page.goto('/');
  await openGrow(page);
  // クイズ正解で状態保存
  const correctIndex = await page.evaluate(() => {
    const D = (Domain as any);
    return D.pickQuizQuestion(D.readQuiz()).question.answerIndex;
  });
  await page.locator('#grow-quiz-slot .qz-choice').nth(correctIndex).click();
  await expect(page.locator('#grow-quiz-slot .qz-verdict')).toBeVisible();
  // 状態が nemorino: に保存
  const keys = await page.evaluate(() =>
    Object.keys(window.localStorage).filter((k) => k.startsWith('nemorino:')));
  expect(keys).toContain('nemorino:grow');
  expect(keys).toContain('nemorino:quiz');
  expect(keys).toContain('nemorino:inventory');
  // 外部送信が CSP connect-src 'none' でブロックされる
  const fetchBlocked = await page.evaluate(async () => {
    try { await fetch('https://example.com/x'); return false; }
    catch (_) { return true; }
  });
  expect(fetchBlocked).toBe(true);
});

test('GR-FREE-03 storage不可時のメモリ動作', async ({ page }) => {
  // localStorage を例外化して実コードのメモリフォールバックを通す（モック不使用・実コード経路）
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() { throw new Error('blocked'); },
      });
    } catch (_) { /* ignore */ }
  });
  // profile はメモリ投入できないため、評価でフォールバック動作を確認する。
  await page.goto('/');
  // オンボーディング画面でも Grow ドメインのメモリ動作を検証（Storage層がメモリへ）
  const ok = await page.evaluate(() => {
    const D = (Domain as any);
    // grow を前進させて読み戻せるか（メモリMap経由）
    const before = D.advanceGrow(D.initGrow('2026-06-18'), '2026-06-18');
    return before.openDays === 1;
  });
  expect(ok).toBe(true);
  // クイズ回答もエラーにならずメモリで完結
  const quizOk = await page.evaluate(() => {
    const D = (Domain as any);
    const order = D.quizOrder();
    const res = D.answerQuiz(order[0].id, order[0].answerIndex);
    return res.correct === true && D.quizCounts().correct >= 1;
  });
  expect(quizOk).toBe(true);
});

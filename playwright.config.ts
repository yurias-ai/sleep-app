import { defineConfig, devices } from '@playwright/test';

// 単一HTML静的アプリ（眠りの森学園 体験版）のE2E設定。
// バックエンド・ビルドなし。ローカル静的サーバ（ポート3384）で index.html を配信して検証する。
export default defineConfig({
  testDir: './tests/e2e',
  outputDir: './tests/temp',
  timeout: 60000,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [
    ['html', { outputFolder: './playwright-report', open: 'never' }],
    ['list'],
  ],
  use: {
    baseURL: 'http://localhost:3384',
    headless: true, // 🚨 ヘッドレスモード強制
    trace: 'retain-on-failure',
    screenshot: {
      mode: 'only-on-failure',
      fullPage: true,
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});

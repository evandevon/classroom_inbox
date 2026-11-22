import { defineConfig, devices } from '@playwright/test';

// Page tests run against a local copy of the site and a stand-in inbox
// (requests to script.google.com are intercepted). Set CHROME_PATH to use an
// installed Chrome instead of Playwright's own browser.
export default defineConfig({
  testDir: 'tests/pages',
  timeout: 20000,
  use: {
    baseURL: 'http://localhost:8765',
    ...(process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {}),
  },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'ipad-size', use: { ...devices['Desktop Chrome'], viewport: { width: 820, height: 1180 }, hasTouch: true } },
  ],
  webServer: { command: 'node tests/serve.mjs 8765', url: 'http://localhost:8765/', reuseExistingServer: true },
});

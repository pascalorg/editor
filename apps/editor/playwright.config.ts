import { fileURLToPath } from 'node:url'
import { defineConfig, devices } from '@playwright/test'

const port = Number(process.env.E2E_PORT ?? 3102)
const baseURL = `http://localhost:${port}`
const appDir = fileURLToPath(new URL('.', import.meta.url))
const reuseExistingServer = process.env.E2E_REUSE_SERVER === '1'

export default defineConfig({
  testDir: './e2e',
  timeout: 240_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    command: `bunx next dev --port ${port}`,
    cwd: appDir,
    env: {
      FACTORY_E2E_SMOKE: '1',
      NEXT_PUBLIC_FACTORY_E2E_SMOKE: '1',
      NEXT_PUBLIC_APP_URL: baseURL,
      PASCAL_SCENE_API_RATE_LIMIT: '0',
    },
    reuseExistingServer,
    timeout: 120_000,
    url: baseURL,
  },
})

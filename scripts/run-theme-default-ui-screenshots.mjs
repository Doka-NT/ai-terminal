// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const mainEntry = join(repoRoot, 'out/main/index.js')
const screenshotDir = join(repoRoot, 'screenshots/theme-default-ui')

if (!existsSync(mainEntry)) {
  throw new Error('Build output is missing. Run `npm run build` before theme default UI screenshots.')
}

await rm(screenshotDir, { recursive: true, force: true })
await mkdir(screenshotDir, { recursive: true })

const userDataDir = await mkdtemp(join(tmpdir(), 'taviraq-theme-default-ui-'))
const screenshots = []

const expectedThemes = {
  horizon: {
    bgWindow: '#1C1E26',
    bgTerminal: '#16181E',
    computedWindow: 'rgb(28, 30, 38)',
    computedTerminal: 'rgb(22, 24, 30)'
  },
  'taviraq-dark': {
    bgWindow: '#111113',
    bgTerminal: '#0C0C0E',
    computedWindow: 'rgb(17, 17, 19)',
    computedTerminal: 'rgb(12, 12, 14)'
  },
  dracula: {
    bgWindow: '#12131D',
    bgTerminal: '#0B0C14',
    computedWindow: 'rgb(18, 19, 29)',
    computedTerminal: 'rgb(11, 12, 20)'
  }
}

async function setStoredTheme(page, currentTheme, legacyTheme) {
  await page.evaluate(({ currentTheme, legacyTheme }) => {
    localStorage.clear()
    if (currentTheme) localStorage.setItem('taviraq.theme', currentTheme)
    if (legacyTheme) localStorage.setItem('ai-terminal.theme', legacyTheme)
  }, { currentTheme, legacyTheme })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
}

async function themeSelect(page) {
  const settings = page.locator('.settings-screen')
  if (!await settings.isVisible()) {
    await page.getByRole('button', { name: 'Settings (⌘,)' }).click()
  }
  await settings.waitFor({ state: 'visible' })
  const appearanceNav = settings.locator('.settings-nav-item').filter({ hasText: 'Appearance' })
  if (!await page.getByRole('heading', { name: 'Appearance' }).isVisible()) {
    await appearanceNav.click()
  }
  await page.getByRole('heading', { name: 'Appearance' }).waitFor({ state: 'visible' })
  return page.locator('.appearance-row')
    .filter({ has: page.locator('option[value="horizon"]') })
    .locator('select')
}

async function assertTheme(page, themeId, screenshotName) {
  const expected = expectedThemes[themeId]
  assert.ok(expected, `Missing expected colors for ${themeId}`)

  await page.waitForFunction((expectedThemeId) => (
    localStorage.getItem('taviraq.theme') === expectedThemeId
  ), themeId)
  await page.locator('.terminal-container').first().waitFor({ state: 'visible' })

  const state = await page.evaluate(() => {
    const root = document.documentElement
    const appShell = document.querySelector('.app-shell')
    const terminalContainer = document.querySelector('.terminal-container')
    return {
      storedTheme: localStorage.getItem('taviraq.theme'),
      bgWindow: root.style.getPropertyValue('--bg-window'),
      bgTerminal: root.style.getPropertyValue('--bg-terminal'),
      computedWindow: appShell ? getComputedStyle(appShell).backgroundColor : '',
      computedTerminal: terminalContainer ? getComputedStyle(terminalContainer).backgroundColor : ''
    }
  })

  assert.equal(state.storedTheme, themeId)
  assert.equal(state.bgWindow, expected.bgWindow)
  assert.equal(state.bgTerminal, expected.bgTerminal)
  assert.equal(state.computedWindow, expected.computedWindow)
  assert.equal(state.computedTerminal, expected.computedTerminal)

  const select = await themeSelect(page)
  assert.equal(await select.inputValue(), themeId)
  assert.equal(await select.locator('option:checked').textContent(), themeId === 'taviraq-dark' ? 'Taviraq Dark' : themeId[0].toUpperCase() + themeId.slice(1))

  const path = join(screenshotDir, screenshotName)
  await page.screenshot({ path })
  screenshots.push(path)
}

const app = await electron.launch({
  args: [repoRoot],
  env: {
    ...process.env,
    TAVIRAQ_DEMO_MODE: '1',
    TAVIRAQ_USER_DATA_DIR: userDataDir
  }
})

try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1320, height: 900 })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })
  await page.locator('.app-shell').waitFor({ state: 'visible' })

  // Fresh profile: no current or legacy preference.
  await assertTheme(page, 'horizon', '00-fresh-horizon.png')

  // Existing modern preference remains authoritative.
  await setStoredTheme(page, 'dracula')
  await assertTheme(page, 'dracula', '01-saved-dracula.png')

  // Legacy Taviraq Dark stays dark instead of following the new default.
  await setStoredTheme(page, undefined, 'ai-terminal-dark')
  await assertTheme(page, 'taviraq-dark', '02-legacy-taviraq-dark.png')

  // Unknown ids normalize to Horizon and are persisted canonically.
  await setStoredTheme(page, 'missing-theme')
  await assertTheme(page, 'horizon', '03-invalid-fallback-horizon.png')

  // A user selection remains valid after reload.
  const select = await themeSelect(page)
  await select.selectOption('dracula')
  await page.waitForFunction(() => localStorage.getItem('taviraq.theme') === 'dracula')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  await assertTheme(page, 'dracula', '04-selected-dracula-after-reload.png')

  console.log(`Saved ${screenshots.length} screenshot(s):`)
  for (const path of screenshots) console.log(`  ${path}`)
} finally {
  await app.close()
  await rm(userDataDir, { recursive: true, force: true })
}

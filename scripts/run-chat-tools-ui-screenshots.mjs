// SPDX-License-Identifier: MPL-2.0
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from 'playwright'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = resolve(scriptDir, '..')
const mainEntry = join(repoRoot, 'out/main/index.js')
const screenshotDir = join(repoRoot, 'screenshots/chat-tools-ui')

if (!existsSync(mainEntry)) {
  throw new Error('Build output is missing. Run `npm run build` before chat tools UI screenshots.')
}

await rm(screenshotDir, { recursive: true, force: true })
await mkdir(screenshotDir, { recursive: true })

const userDataDir = await mkdtemp(join(tmpdir(), 'taviraq-chat-tools-ui-'))

const activeStepText = [
  'Проверить подключение к серверу и последовательно сверить DNS, TLS-сертификат,',
  'ответ health-check, журналы systemd и метрики процесса во всех окружениях,',
  'зафиксировав каждое отклонение и безопасно остановившись до перезапуска сервиса,',
  'если хотя бы одна обязательная проверка не прошла успешно, затем сравнить результат',
  'с предыдущим стабильным запуском, проверить доступность зависимых API и очередей,',
  'убедиться в отсутствии новых ошибок и предупреждений, подготовить краткий отчёт',
  'с временными метками и только после этого перейти к следующему шагу плана'
].join(' ')

const longInlineToken = 'configuration_segment_'.repeat(24)
const longCodeLine = `const overflow_probe_${'0123456789abcdef'.repeat(32)} = true`
const overflowProbe = [
  'Проверяю восстановленную историю с длинным текстом, URL и встроенным кодом, чтобы содержимое оставалось внутри панели.',
  'URL: https://example.com/terminal/assistant/layout/with/a/very/long/path/that/must/wrap/inside/the/chat/panel',
  `Inline code: \`${longInlineToken}\``,
  '',
  '| Surface | Long value | Expected behavior |',
  '| --- | --- | --- |',
  `| chat | ${'wide-table-cell-'.repeat(18)} | Scroll only inside this table |`,
  '',
  '```javascript',
  longCodeLine,
  '```'
].join('\n')

// Seed a session whose assistant turn carries a task list + detailed plan, so
// the derived checklist panel renders with real content.
const taskListMessage = [
  'Понял задачу, вот план:',
  '',
  '```tasklist',
  '- [x] Прочитать конфигурацию',
  `- [-] ${activeStepText}`,
  '- [ ] Перезапустить сервис',
  '- [ ] Проверить логи',
  '```',
  '',
  'Начинаю со второго шага.',
  '',
  '```taskplan',
  '# План',
  '1. Прочитать ~/.app/config.yml и убедиться, что хост задан.',
  '2. Выполнить health-check эндпоинта.',
  '3. systemctl restart app.',
  '4. journalctl -u app -n 50 для проверки.',
  '```',
  '',
  overflowProbe
].join('\n')

await writeFile(join(userDataDir, 'session-state.json'), JSON.stringify({
  version: 1,
  savedAt: new Date().toISOString(),
  activeSessionId: 'chat-tools-session',
  sessions: [{
    id: 'chat-tools-session',
    kind: 'local',
    label: 'Local',
    cwd: repoRoot,
    shell: '/bin/zsh',
    command: '/bin/zsh',
    createdAt: Date.now(),
    status: 'running',
    output: ''
  }],
  assistantThreads: {
    'chat-tools-session': {
      messages: [
        { role: 'user', content: 'Перезапусти сервис и проверь, что он поднялся.' },
        { role: 'assistant', content: taskListMessage }
      ],
      draft: '',
      session: { id: 'chat-tools-session', kind: 'local', label: 'Local', cwd: repoRoot, shell: '/bin/zsh' }
    }
  }
}), 'utf8')

const app = await electron.launch({
  args: [repoRoot],
  env: {
    ...process.env,
    TAVIRAQ_DEMO_MODE: '1',
    TAVIRAQ_USER_DATA_DIR: userDataDir
  }
})

const screenshots = []

async function captureSettings(page, name) {
  const path = join(screenshotDir, name)
  await page.locator('.settings-screen').screenshot({ path })
  screenshots.push(path)
}

async function captureLocator(locator, name) {
  const path = join(screenshotDir, name)
  await locator.screenshot({ path })
  screenshots.push(path)
}

async function assertNoOuterHorizontalScroll(chatLog, label) {
  const metrics = await chatLog.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    const forcedScrollLeft = element.scrollLeft
    element.scrollLeft = 0
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      forcedScrollLeft
    }
  })

  assert.ok(
    metrics.scrollWidth <= metrics.clientWidth + 1,
    `${label}: chat overflowed horizontally (${metrics.scrollWidth} > ${metrics.clientWidth})`
  )
  assert.ok(
    metrics.forcedScrollLeft <= 1,
    `${label}: chat accepted horizontal scrollLeft ${metrics.forcedScrollLeft}`
  )
}

async function assertLocalHorizontalScroll(locator, label) {
  const metrics = await locator.evaluate((element) => {
    element.scrollLeft = element.scrollWidth
    return {
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      scrollLeft: element.scrollLeft
    }
  })

  assert.ok(
    metrics.scrollWidth > metrics.clientWidth + 1,
    `${label}: fixture did not overflow locally (${metrics.scrollWidth} <= ${metrics.clientWidth})`
  )
  assert.ok(metrics.scrollLeft > 1, `${label}: local horizontal scrolling did not move`)
}

try {
  const page = await app.firstWindow()
  await page.setViewportSize({ width: 1320, height: 900 })
  page.on('console', (message) => {
    if (message.type() === 'error') console.error(`[renderer] ${message.text()}`)
  })

  await page.evaluate(() => {
    localStorage.setItem('taviraq.language', 'ru')
    localStorage.setItem('taviraq.sidebarVisible', 'true')
    localStorage.setItem('taviraq.sidebarWidth', '420')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })

  // 1. Settings → Chat Tools, toggle off by default.
  await page.getByRole('button', { name: 'Настройки (⌘,)' }).click()
  await page.getByRole('button', { name: 'Инструменты чата' }).click()
  await page.getByRole('heading', { name: 'Инструменты чата' }).waitFor({ state: 'visible' })

  const taskListSwitch = page.getByRole('switch', { name: 'Список задач и планирование' })
  await taskListSwitch.waitFor({ state: 'visible' })
  assert.equal(await taskListSwitch.getAttribute('aria-checked'), 'false')
  await captureSettings(page, '00-task-list-default-off.png')

  // 2. Enable it.
  await taskListSwitch.click()
  await page.waitForFunction(() => (
    document.querySelector('.settings-screen [role="switch"]')?.getAttribute('aria-checked') === 'true'
  ))
  await captureSettings(page, '01-task-list-enabled.png')

  // 3. Close settings; the seeded conversation shows the checklist panel.
  //    The panel is collapsed by default: only the in-progress step + progress
  //    counter are visible; the pending steps stay hidden behind `hidden` +
  //    `.task-list-items:not([hidden]) { display: grid }` (otherwise the author
  //    `display:grid` would override `[hidden] { display:none }`).
  await page.getByRole('button', { name: 'Закрыть настройки' }).click()
  await page.locator('.settings-screen').waitFor({ state: 'hidden' })
  const panel = page.locator('.task-list-panel')
  await panel.waitFor({ state: 'visible' })
  const chatLog = page.locator('.chat-log')
  const llmPanel = page.locator('.llm-panel')
  const toggle = panel.locator('.task-list-toggle')
  await toggle.waitFor({ state: 'visible' })
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false')
  const currentStep = panel.locator('.task-list-current-step')
  await currentStep.getByText(activeStepText).waitFor({ state: 'visible' })
  const currentStepMetrics = await currentStep.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    tabIndex: element.tabIndex
  }))
  assert.ok(currentStepMetrics.clientHeight <= 120, `current step exceeded 120px: ${currentStepMetrics.clientHeight}`)
  assert.ok(currentStepMetrics.scrollHeight > currentStepMetrics.clientHeight, 'verbose current step must overflow internally')
  assert.equal(currentStepMetrics.overflowY, 'auto')
  assert.equal(currentStepMetrics.tabIndex, 0)
  // Pending step exists in the DOM but must NOT be visible while collapsed.
  await panel.getByText('Перезапустить сервис').waitFor({ state: 'hidden' })
  await assertNoOuterHorizontalScroll(chatLog, 'collapsed task list at 420px')
  await captureLocator(panel, '02-task-list-collapsed.png')
  await captureLocator(llmPanel, '03-task-list-collapsed-in-chat.png')
  await captureLocator(llmPanel, '05-chat-overflow-collapsed-420.png')

  // 4. Expand via the toggle: every step is now laid out and visible.
  await toggle.click()
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true')
  await panel.getByText('Перезапустить сервис').waitFor({ state: 'visible' })
  await panel.getByText('Проверить логи').waitFor({ state: 'visible' })
  await chatLog.evaluate((element) => { element.scrollTop = 0 })
  await assertNoOuterHorizontalScroll(chatLog, 'expanded task list at 420px')
  await captureLocator(panel, '04-task-list-expanded.png')
  await captureLocator(llmPanel, '06-chat-overflow-expanded-420.png')

  // 5. Re-open the restored conversation at the supported minimum sidebar
  //    width. The outer chat must still stay fixed while deliberately wide
  //    tables and code blocks retain their own local horizontal scrolling.
  await page.evaluate(() => {
    localStorage.setItem('taviraq.sidebarWidth', '300')
  })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.locator('.app-shell').waitFor({ state: 'visible' })
  const narrowPanel = page.locator('.llm-panel')
  const narrowChatLog = page.locator('.chat-log')
  const narrowTaskList = page.locator('.task-list-panel')
  await narrowTaskList.waitFor({ state: 'visible' })
  await narrowChatLog.evaluate((element) => { element.scrollTop = 0 })
  const narrowPanelWidth = await narrowPanel.evaluate((element) => element.getBoundingClientRect().width)
  assert.ok(
    narrowPanelWidth >= 299 && narrowPanelWidth <= 301,
    `minimum sidebar width was not 300px: ${narrowPanelWidth}`
  )
  await assertNoOuterHorizontalScroll(narrowChatLog, 'collapsed task list at 300px')
  await captureLocator(narrowPanel, '07-chat-overflow-narrow-300.png')

  const codeBlock = page.locator('.msg-code-block').filter({ hasText: 'overflow_probe_' })
  const codePre = codeBlock.locator('pre')
  const tableWrap = page.locator('.message-table-wrap').last()
  await codePre.waitFor({ state: 'visible' })
  await tableWrap.waitFor({ state: 'visible' })
  await assertLocalHorizontalScroll(codePre, 'code block')
  await assertLocalHorizontalScroll(tableWrap, 'table')
  await assertNoOuterHorizontalScroll(narrowChatLog, 'after local code and table scrolling')
  await captureLocator(codeBlock, '08-code-block-local-scroll.png')

  console.log(`Saved ${screenshots.length} screenshot(s):`)
  for (const path of screenshots) console.log(`  ${path}`)
} finally {
  await app.close()
  await rm(userDataDir, { recursive: true, force: true })
}

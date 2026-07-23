// SPDX-License-Identifier: MPL-2.0
import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, nativeImage, screen, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type {
  AppConfig,
  AppShortcutAction,
  ChatStreamRequest,
  CommandSnippet,
  CommandRiskAssessmentRequest,
  CreateSshCommandRequest,
  CreateTerminalRequest,
  DataUsageStats,
  DiscoveredMcpServer,
  ExportData,
  ImportResult,
  ListModelsResult,
  LLMProviderConfig,
  McpServerConfig,
  PromptTemplate,
  SaveSessionStateRequest,
  SaveLLMProviderRequest,
  SavedChat,
  SecretMaskingAuditEvent,
  SecretMaskingAuditScope,
  SecretMaskingAuditSource,
  SecretMaskingMode,
  SecretMaskingSettings,
  SSHProfile,
  ChatToolsSettings,
  SSHProfileConfig,
  TelemetrySettings,
  TerminalContext,
  SummarizeConversationRequest
} from '@shared/types'
import { TerminalManager } from './services/TerminalManager'
import { ChatHistoryStore } from './services/chatHistoryStore'
import { ConfigStore, normalizeSecretMaskingMode, normalizeSecretMaskingSettings } from './services/configStore'
import { createDefaultChatToolsSettings, normalizeChatToolsSettings } from '@shared/chatToolsConfig'
import { createDefaultTelemetrySettings, normalizeTelemetrySettings } from '@shared/telemetryConfig'
import { PromptStore } from './services/promptStore'
import { CommandSnippetStore } from './services/commandSnippetStore'
import { SessionStateStore } from './services/sessionStateStore'
import {
  buildProxyPasswordRef,
  deleteApiKey,
  deleteProxyPassword,
  getApiKey,
  getProxyPassword,
  saveApiKey,
  saveProxyPassword,
  warmSecretCache
} from './services/secretStore'
import { discoverExternalMcpServers, McpConfigStore } from './services/mcpConfigStore'
import { listMcpServerTools } from './services/mcpRuntime'
import {
  assessCommandRisk,
  invalidateProviderProxyAgents,
  listModels,
  streamChatCompletion,
  summarizeConversation
} from './services/llmService'
import { CapabilityRegistry, emitCapabilityAuditEvent, loadCapabilities } from './capabilities'
import { createExampleSafetyPolicy } from './capabilities/reference/exampleSafetyPolicy'
import { extractCommandProposals } from './utils/commandProposals'
import {
  addSecretFindingsToContext,
  cloneSecretMaskContext,
  diffSecretMaskContext,
  maskTextForDisplay,
  resolveSecretPlaceholders,
  sanitizeSavedChatForStorage,
  type SecretMaskContext
} from './utils/secretMasking'
import { buildAccelerator } from '../shared/accelerator'
import { normalizeHttpProxyUrl } from './utils/proxy'
import { SECRET_MASKING_AUDIT_LIMIT, createDefaultSecretMaskingSettings, isStrictTerminalContextActive } from '@shared/secretMaskingConfig'
import { createAboutWindowHtml } from './utils/aboutWindow'
import { checkForUpdates, disposeAutoUpdates, getUpdateStatus, initAutoUpdates, quitAndInstall } from './services/updateService'
import { clearPendingEvents, flushPendingEvents, isTelemetryActive, setTelemetrySettings, setupTelemetry, trackEvent } from './services/telemetryService'

const userDataDir = process.env.TAVIRAQ_USER_DATA_DIR ?? process.env.AI_TERMINAL_USER_DATA_DIR

if (userDataDir) {
  app.setPath('userData', userDataDir)
}

let mainWindow: BrowserWindow | undefined
let aboutWindow: BrowserWindow | undefined
const pendingApprovedCommands = new Map<string, Set<string>>()

// Canonical key for matching an approved command against the one actually run.
// The renderer trims the confirmed command, but heredocs and LLM-proposed
// commands routinely carry CRLF line endings and trailing whitespace; matching
// raw strings would spuriously reject an approved command as "not approved".
function normalizeApprovalKey(command: string): string {
  return command.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim()
}
let isQuitting = false
let currentHideShortcut = ''
let isRecordingShortcut = false
let saveWindowBoundsTimer: NodeJS.Timeout | undefined
let quitWindowBoundsSave: Promise<void> | undefined
const configStore = new ConfigStore()

/**
 * Classify an AI request failure into a low-cardinality, non-identifying enum
 * for telemetry. Never includes the error message or any content.
 */
function classifyAiError(error: unknown): string {
  const text = (error instanceof Error ? error.message : String(error)).toLowerCase()
  if (/\b(401|403)\b|unauthorized|forbidden|invalid[_ ]?api[_ ]?key|authentication|api key/.test(text)) return 'auth'
  if (/\b429\b|rate[_ ]?limit|too many requests/.test(text)) return 'rate_limit'
  if (/timeout|timed out|etimedout/.test(text)) return 'timeout'
  if (/enotfound|econnrefused|econnreset|eai_again|network|fetch failed|socket hang up|\bdns\b/.test(text)) return 'network'
  if (/\b5\d\d\b|server error|bad gateway|service unavailable/.test(text)) return 'server'
  return 'other'
}

/** Push the latest telemetry settings to the renderer so all views stay in sync. */
function broadcastTelemetrySettings(settings: TelemetrySettings | undefined): void {
  if (settings && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('config:telemetryChanged', settings)
  }
}
const promptStore = new PromptStore()
const commandSnippetStore = new CommandSnippetStore()
const sessionStateStore = new SessionStateStore()
const chatHistoryStore = new ChatHistoryStore()
const mcpConfigStore = new McpConfigStore()
const capabilityRegistry = new CapabilityRegistry()
const summarizeControllers = new Map<string, AbortController>()
const chatStreamControllers = new Map<string, AbortController>()
const secretContextsBySession = new Map<string, SecretMaskContext>()
const secretContextLocksBySession = new Map<string, Promise<void>>()
const secretMaskingAuditEvents: SecretMaskingAuditEvent[] = []
const terminalManager = new TerminalManager(() => mainWindow, (sessionId) => {
  secretContextsBySession.delete(sessionId)
  secretContextLocksBySession.delete(sessionId)
})
const OPEN_EXTERNAL_PROTOCOLS = new Set(['http:', 'https:'])
const DISCOVERED_MCP_SOURCES = new Set<DiscoveredMcpServer['source']>([
  'claude',
  'copilot',
  'codex',
  'opencode',
  'lmstudio',
  'ollama',
  'cursor',
  'windsurf'
])
const TAVIRAQ_WEBSITE = 'https://taviraq.dev'
const TAVIRAQ_SUPPORT_URL = 'https://github.com/Doka-NT/Taviraq#support'
const ABOUT_ICON_SIZE = 144
const DEMO_MODE = process.env.TAVIRAQ_DEMO_MODE === '1' || process.env.AI_TERMINAL_DEMO_MODE === '1'
const DATA_USAGE_PATHS = [
  'config.json',
  'chat-history.json',
  'session-state.json',
  'command-snippets.json',
  'mcp.json',
  'prompts'
]
const demoProvider = {
  name: 'Taviraq Demo',
  providerType: 'openai' as const,
  baseUrl: 'https://demo.local',
  apiKeyRef: 'taviraq-demo',
  selectedModel: 'demo-agent',
  commandRiskModel: 'demo-safety'
}
const demoConfig: AppConfig = {
  providers: [demoProvider],
  activeProviderRef: demoProvider.apiKeyRef,
  hideShortcut: 'CommandOrControl+Shift+Space',
  secretMasking: createDefaultSecretMaskingSettings(),
  chatTools: createDefaultChatToolsSettings(),
  // Demo runs with a resolved consent decision so the first-run consent prompt
  // never overlays the recording (telemetry stays off either way).
  telemetry: { ...createDefaultTelemetrySettings(() => 'demo-install-id'), consentDecision: 'denied' },
  windowBounds: {
    width: 1440,
    height: 920
  }
}

let secretMaskingSettingsCache: SecretMaskingSettings = normalizeSecretMaskingSettings(demoConfig.secretMasking)
let secretMaskingSettingsCacheReady: Promise<void> | undefined

function initializeSecretMaskingModeCache(): Promise<void> {
  secretMaskingSettingsCacheReady ??= (async () => {
    if (DEMO_MODE) {
      updateSecretMaskingSettingsCache(demoConfig)
      return
    }

    updateSecretMaskingSettingsCache(await configStore.load())
  })()
  return secretMaskingSettingsCacheReady
}

async function ensureSecretMaskingSettingsCache(): Promise<void> {
  await initializeSecretMaskingModeCache()
}

async function warmProviderSecrets(): Promise<void> {
  if (DEMO_MODE) return
  try {
    const config = await configStore.load()
    const refs: string[] = []
    for (const provider of config.providers) {
      if (provider.apiKeyRef) refs.push(provider.apiKeyRef)
      if (provider.proxyPasswordRef) refs.push(provider.proxyPasswordRef)
    }
    await warmSecretCache(refs)
  } catch {
    // Non-critical: if warming fails, secrets are read on first actual access
  }
}

function updateSecretMaskingSettingsCache(config: AppConfig): void {
  secretMaskingSettingsCache = normalizeSecretMaskingSettings(config.secretMasking)
}

function getSecretMaskingSettings(): SecretMaskingSettings {
  return DEMO_MODE ? normalizeSecretMaskingSettings(demoConfig.secretMasking) : secretMaskingSettingsCache
}

function getScopedSecretMaskingSettings(scope: SecretMaskingAuditScope): SecretMaskingSettings {
  const settings = getSecretMaskingSettings()
  const enabled = scope === 'provider-payload'
    ? settings.applyToProviderPayloads
    : settings.applyToChatDisplay
  return enabled ? settings : { ...settings, mode: 'off' }
}

function applyTerminalContextPolicy<T extends { context: TerminalContext }>(request: T): T {
  if (!isStrictTerminalContextActive(getSecretMaskingSettings())) return request

  return {
    ...request,
    context: {
      ...request.context,
      selectedText: '',
      terminalOutput: undefined,
      session: undefined
    }
  }
}

function recordSecretMaskingAuditEvent(
  source: SecretMaskingAuditSource,
  scope: SecretMaskingAuditScope,
  context: SecretMaskContext,
  sessionLabel?: string
): void {
  if (context.bindings.length === 0) return

  const event: SecretMaskingAuditEvent = {
    id: randomAuditId(),
    createdAt: new Date().toISOString(),
    source,
    scope,
    sessionLabel,
    maskedSecretCount: context.bindings.length,
    categories: [...new Set(context.bindings.map((binding) => binding.kind))]
  }
  secretMaskingAuditEvents.unshift(event)
  secretMaskingAuditEvents.splice(SECRET_MASKING_AUDIT_LIMIT)
  mainWindow?.webContents.send('secret:auditEvent', event)
  recordCapabilityAuditEvent(event)
}

function recordCapabilityAuditEvent(event: SecretMaskingAuditEvent): void {
  emitCapabilityAuditEvent(
    capabilityRegistry.get('audit-sink'),
    {
      type: 'secret-masking',
      at: Date.now(),
      payload: {
        source: event.source,
        scope: event.scope,
        sessionLabel: event.sessionLabel,
        maskedSecretCount: event.maskedSecretCount,
        categories: event.categories
      }
    },
    (sink, error) => {
      console.warn(`[capabilities] audit-sink provider "${sink.id}" failed`, error)
    }
  )
}

async function initializeCapabilities(): Promise<void> {
  if (process.env.TAVIRAQ_ENABLE_REFERENCE_CAPABILITY === '1') {
    capabilityRegistry.register(createExampleSafetyPolicy())
  }

  await loadCapabilities(capabilityRegistry, {
    allowUnsigned: !app.isPackaged,
    onError: (error, entry) => {
      const label = entry ? ` "${entry.id}"` : ''
      console.warn(`[capabilities] failed to load${label}`, error)
    }
  })
}

function randomAuditId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

function getSessionLabel(sessionId: string): string | undefined {
  return terminalManager.list().find((session) => session.id === sessionId)?.label
}

function mergeNewSecretContext(
  currentContext: SecretMaskContext | undefined,
  fullContext: SecretMaskContext,
  newContext: SecretMaskContext
): SecretMaskContext {
  if (!currentContext) return fullContext

  const mergedContext = cloneSecretMaskContext(currentContext)
  addSecretFindingsToContext(
    mergedContext,
    newContext.bindings.map((binding) => ({ ruleId: binding.kind, secret: binding.value }))
  )
  return mergedContext
}

async function withSessionSecretContextLock<T>(sessionId: string, task: () => T | Promise<T>): Promise<T> {
  const previous = secretContextLocksBySession.get(sessionId) ?? Promise.resolve()
  let release = (): void => {}
  const current = new Promise<void>((resolve) => {
    release = resolve
  })
  const queued = previous.catch(() => undefined).then(() => current)
  secretContextLocksBySession.set(sessionId, queued)

  await previous.catch(() => undefined)
  try {
    return await task()
  } finally {
    release()
    if (secretContextLocksBySession.get(sessionId) === queued) {
      secretContextLocksBySession.delete(sessionId)
    }
  }
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return OPEN_EXTERNAL_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

async function getPathSize(path: string): Promise<number> {
  try {
    const entry = await stat(path)
    if (!entry.isDirectory()) return entry.size

    const children = await readdir(path)
    const childSizes = await Promise.all(children.map((child) => getPathSize(join(path, child))))
    return childSizes.reduce((total, size) => total + size, 0)
  } catch {
    return 0
  }
}

function normalizeProviderProxy(provider: LLMProviderConfig): LLMProviderConfig {
  const proxyUrl = provider.proxyUrl?.trim()
  const proxyUsername = provider.proxyUsername?.trim()
  if (!proxyUrl) {
    return {
      ...provider,
      proxyUrl: undefined,
      proxyUsername: undefined,
      proxyPasswordRef: undefined
    }
  }

  return {
    ...provider,
    proxyUrl: normalizeHttpProxyUrl(proxyUrl),
    proxyUsername: proxyUsername || undefined,
    proxyPasswordRef: proxyUsername ? provider.proxyPasswordRef : undefined
  }
}

async function prepareProviderRequest(
  request: SaveLLMProviderRequest,
  options: { deleteDisabledProxyPassword?: boolean; saveSecrets?: boolean } = {}
): Promise<LLMProviderConfig> {
  const saveSecrets = options.saveSecrets !== false
  if (saveSecrets && request.apiKey?.trim()) {
    await saveApiKey(request.provider.apiKeyRef, request.apiKey.trim())
  }

  const proxyPasswordRef = buildProxyPasswordRef(request.provider.apiKeyRef)
  const hasProxyPasswordField = Object.prototype.hasOwnProperty.call(request, 'proxyPassword')
  const proxyPassword = request.proxyPassword
  const provider = normalizeProviderProxy({
    ...request.provider,
    ...(saveSecrets && hasProxyPasswordField
      ? proxyPassword ? { proxyPasswordRef } : { proxyPasswordRef: undefined }
      : {})
  })

  if (saveSecrets && proxyPassword && provider.proxyPasswordRef) {
    await saveProxyPassword(provider.proxyPasswordRef, proxyPassword)
  }

  if (
    saveSecrets &&
    options.deleteDisabledProxyPassword !== false &&
    ((hasProxyPasswordField && !proxyPassword) || !provider.proxyUrl || !provider.proxyUsername)
  ) {
    await deleteProxyPasswordIfPresent(proxyPasswordRef)
  }

  return provider
}

async function deleteProxyPasswordIfPresent(proxyPasswordRef: string): Promise<void> {
  try {
    await deleteProxyPassword(proxyPasswordRef)
  } catch {
    // Removing a missing or inaccessible keychain entry should not block saving provider settings.
  }
}

function withExportableProxyRefs(config: AppConfig, proxyPasswords: Record<string, string>): AppConfig {
  return {
    ...config,
    providers: config.providers.map((provider) => {
      if (!provider.proxyPasswordRef || proxyPasswords[provider.proxyPasswordRef]) return provider
      return { ...provider, proxyPasswordRef: undefined }
    })
  }
}

function buildImportableProxyRefs(
  providers: LLMProviderConfig[],
  proxyPasswords: Record<string, string> | undefined
): { providers: LLMProviderConfig[]; proxyPasswords: Record<string, string> } {
  const canonicalProxyPasswords: Record<string, string> = {}
  const importableProviders = providers.map((provider) => {
    if (!provider.proxyPasswordRef) return provider
    const proxyPassword = proxyPasswords?.[provider.proxyPasswordRef]
    if (!proxyPassword) return { ...provider, proxyPasswordRef: undefined }
    const canonicalRef = buildProxyPasswordRef(provider.apiKeyRef)
    canonicalProxyPasswords[canonicalRef] = proxyPassword
    return { ...provider, proxyPasswordRef: canonicalRef }
  })
  return { providers: importableProviders, proxyPasswords: canonicalProxyPasswords }
}

function withExportableMcpServers(servers: McpServerConfig[], includeSecrets: boolean): McpServerConfig[] {
  if (includeSecrets) return servers
  return servers.map((server) => {
    const safeServer: McpServerConfig = {
      id: server.id,
      name: server.name,
      command: server.command,
      enabled: server.enabled,
      source: server.source,
      importedFrom: server.importedFrom,
      createdAt: server.createdAt,
      updatedAt: server.updatedAt,
      ...(server.args ? { args: server.args } : {}),
      ...(server.tools ? { tools: server.tools } : {})
    }
    return safeServer
  })
}

function getMcpImportKey(server: Pick<McpServerConfig, 'name'>): string {
  return server.name.trim().toLowerCase()
}

function isObjectPayload(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isMcpServerPayload(value: unknown): value is McpServerConfig {
  return isObjectPayload(value) && typeof value.name === 'string' && typeof value.command === 'string'
}

function isDiscoveredMcpServerPayload(value: unknown): value is DiscoveredMcpServer {
  if (!isObjectPayload(value)) return false
  return typeof value.name === 'string' &&
    typeof value.command === 'string' &&
    typeof value.sourcePath === 'string' &&
    DISCOVERED_MCP_SOURCES.has(value.source as DiscoveredMcpServer['source'])
}

async function openAllowedExternalUrl(url: string): Promise<void> {
  if (!isAllowedExternalUrl(url)) {
    throw new Error('Unsupported external URL')
  }

  await shell.openExternal(url)
}

async function sendDemoChatStream(
  event: Electron.IpcMainEvent,
  request: ChatStreamRequest,
  signal: AbortSignal
): Promise<void> {
  const lastMessage = request.messages.at(-1)?.content.toLowerCase() ?? ''
  const chunks = lastMessage.startsWith('command `')
    ? [
        'The command finished successfully.\n\n',
        'You can see the live PTY output on the left while I keep the result in the assistant thread. ',
        'This makes agent execution reviewable without hiding the terminal.'
      ]
    : lastMessage.includes('risk') || lastMessage.includes('safety') || lastMessage.includes('опас')
      ? [
          'Sure — I will clean up the build output for you.\n\n',
          'I will run:\n',
          '```bash\nrm -rf ./out\n```'
        ]
      : [
          'I will inspect the local workspace and summarize what matters.\n\n',
          'I will run:\n',
          '```bash\npwd\nprintf "\\nProject files:\\n"\nls -1 | sed -n "1,12p"\nprintf "\\nPackage scripts:\\n"\nnode -e "const p=require(\\"./package.json\\"); for (const [k,v] of Object.entries(p.scripts)) console.log(k + \\": \\" + v)"\n```'
        ]

  for (const content of chunks) {
    if (signal.aborted) return
    event.sender.send('llm:chatStream:event', {
      requestId: request.requestId,
      type: 'chunk',
      content
    })
    await new Promise((resolve) => setTimeout(resolve, 280))
  }
}

function beginQuit(): void {
  isQuitting = true
  terminalManager.killAll()
}

function finishQuit(): void {
  globalShortcut.unregisterAll()
  app.exit(0)
}

function requestQuit(): void {
  if (!isQuitting) {
    beginQuit()
  }
  if (!mainWindow || mainWindow.isDestroyed()) {
    finishQuit()
    return
  }
  app.quit()
}

function getAboutIconDataUrl(): string {
  const iconPath = app.isPackaged
    ? join(process.resourcesPath, 'icon.png')
    : join(app.getAppPath(), 'build', 'icon.png')
  const icon = nativeImage.createFromPath(iconPath)

  if (icon.isEmpty()) {
    return ''
  }

  return icon.resize({ width: ABOUT_ICON_SIZE, height: ABOUT_ICON_SIZE, quality: 'best' }).toDataURL()
}

function showAboutWindow(): void {
  if (aboutWindow && !aboutWindow.isDestroyed()) {
    aboutWindow.show()
    aboutWindow.focus()
    return
  }

  const visibleMainWindow = mainWindow?.isVisible() ? mainWindow : undefined

  aboutWindow = new BrowserWindow({
    width: 360,
    height: 300,
    parent: visibleMainWindow,
    modal: Boolean(visibleMainWindow),
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    title: 'About Taviraq',
    backgroundColor: '#10101a',
    autoHideMenuBar: true,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  aboutWindow.webContents.setWindowOpenHandler((details) => {
    void openAllowedExternalUrl(details.url).catch((error: unknown) => {
      console.error('[open about external url failed]', error)
    })
    return { action: 'deny' }
  })

  aboutWindow.on('closed', () => {
    aboutWindow = undefined
  })

  aboutWindow.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'Escape' && aboutWindow && !aboutWindow.isDestroyed()) {
      event.preventDefault()
      aboutWindow.close()
    }
  })

  const html = createAboutWindowHtml({
    version: app.getVersion(),
    websiteHref: TAVIRAQ_WEBSITE,
    supportHref: TAVIRAQ_SUPPORT_URL,
    iconDataUrl: getAboutIconDataUrl()
  })
  const aboutUrl = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`

  aboutWindow.webContents.on('will-navigate', (event, url) => {
    if (url === aboutUrl) return
    event.preventDefault()
    void openAllowedExternalUrl(url).catch((error: unknown) => {
      console.error('[open about external url failed]', error)
    })
  })

  void aboutWindow.loadURL(aboutUrl)
}

function registerApplicationMenu(): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: app.name,
      submenu: [
        {
          label: 'About Taviraq',
          click: showAboutWindow
        },
        { type: 'separator' },
        {
          label: 'Quit Taviraq',
          accelerator: 'Command+Q',
          click: requestQuit
        }
      ]
    },
    {
      role: 'editMenu'
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+Command+I',
          click: () => mainWindow?.webContents.toggleDevTools()
        }
      ]
    },
    {
      role: 'windowMenu'
    }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerHideShortcut(shortcut: string): boolean {
  if (currentHideShortcut) globalShortcut.unregister(currentHideShortcut)
  const success = globalShortcut.register(shortcut, () => {
    if (!mainWindow) return
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide()
    } else if (mainWindow.isVisible()) {
      mainWindow.focus()
    } else {
      mainWindow.setOpacity(0)
      mainWindow.show()
      mainWindow.focus()
      mainWindow.webContents.send('app:window-show')
    }
  })
  if (success) {
    currentHideShortcut = shortcut
  } else {
    // Re-register previous shortcut if new one failed
    if (currentHideShortcut) {
      globalShortcut.register(currentHideShortcut, () => {
        if (!mainWindow) return
        if (mainWindow.isVisible() && mainWindow.isFocused()) {
          mainWindow.hide()
        } else if (mainWindow.isVisible()) {
          mainWindow.focus()
        } else {
          mainWindow.setOpacity(0)
          mainWindow.show()
          mainWindow.focus()
          mainWindow.webContents.send('app:window-show')
        }
      })
    }
  }
  return success
}

const defaultWindowBounds = {
  width: 1440,
  height: 920
}

function normalizeWindowBounds(
  bounds: Awaited<ReturnType<ConfigStore['load']>>['windowBounds']
): { width: number; height: number; x?: number; y?: number } {
  const width = Math.max(bounds?.width ?? defaultWindowBounds.width, 1060)
  const height = Math.max(bounds?.height ?? defaultWindowBounds.height, 680)

  if (typeof bounds?.x !== 'number' || typeof bounds?.y !== 'number') {
    return { width, height }
  }
  const { x, y } = bounds

  const visible = screen.getAllDisplays().some((display) => {
    const area = display.workArea
    return (
      x < area.x + area.width &&
      x + width > area.x &&
      y < area.y + area.height &&
      y + height > area.y
    )
  })

  return visible ? { width, height, x, y } : { width, height }
}

async function saveWindowBounds(): Promise<void> {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const bounds = mainWindow.getNormalBounds()
  const isMaximized = mainWindow.isMaximized()

  try {
    await configStore.update((config) => ({
      ...config,
      windowBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        isMaximized
      }
    }))
  } catch (error: unknown) {
    console.error('[window bounds save failed]', error)
  }
}

function queueWindowBoundsSave(): void {
  if (saveWindowBoundsTimer) clearTimeout(saveWindowBoundsTimer)
  saveWindowBoundsTimer = setTimeout(() => {
    void saveWindowBounds()
  }, 300)
}

async function createWindow(): Promise<void> {
  const config = await configStore.load()
  const bounds = normalizeWindowBounds(config.windowBounds)

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 1060,
    minHeight: 680,
    title: 'Taviraq',
    backgroundColor: '#050514',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      // sandbox: true is incompatible with the ESM preload (.mjs): Electron's sandboxed
      // preload context does not support ES module syntax. Sandbox hardening requires
      // converting the preload to CJS first (tracked separately).
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  })

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    const prefix = level >= 2 ? 'renderer error' : 'renderer log'
    console.log(`[${prefix}] ${message} (${sourceId}:${line})`)
  })

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[renderer load failed] ${errorCode} ${errorDescription}: ${validatedURL}`)
  })

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    console.error(`[renderer gone] ${details.reason}`)
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void openAllowedExternalUrl(details.url).catch((error: unknown) => {
      console.error('[open external url failed]', error)
    })
    return { action: 'deny' }
  })

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith('app://') && !url.startsWith('file://')) {
      event.preventDefault()
    }
  })

  mainWindow.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown' || input.isAutoRepeat) return

    // Shortcut recording mode: capture any key combo and send to renderer
    if (isRecordingShortcut) {
      const accelerator = buildAccelerator(!!input.meta, !!input.control, !!input.shift, !!input.alt, input.code ?? '')
      if (accelerator) {
        event.preventDefault()
        mainWindow?.webContents.send('shortcut:recorded', accelerator)
        isRecordingShortcut = false
      }
      return
    }

    if (input.meta && !input.control && !input.alt && input.shift && (input.key.toLowerCase() === 'k' || input.code === 'KeyK')) {
      event.preventDefault()
      mainWindow?.webContents.send('app:shortcut', 'open-command-snippets' satisfies AppShortcutAction)
      return
    }

    if (input.meta && !input.control && !input.alt && input.shift && (input.key.toLowerCase() === 'j' || input.code === 'KeyJ')) {
      event.preventDefault()
      mainWindow?.webContents.send('app:shortcut', 'open-prompt-library' satisfies AppShortcutAction)
      return
    }

    if (input.meta && !input.control && !input.alt && input.shift && (input.key.toLowerCase() === 'p' || input.code === 'KeyP')) {
      event.preventDefault()
      mainWindow?.webContents.send('app:shortcut', 'open-command-palette' satisfies AppShortcutAction)
      return
    }

    if (
      input.meta &&
      input.alt &&
      !input.control &&
      !input.shift &&
      (input.key.toLowerCase() === 'i' || input.code === 'KeyI')
    ) {
      event.preventDefault()
      mainWindow?.webContents.toggleDevTools()
      return
    }

    if (
      !input.meta ||
      input.control ||
      input.alt ||
      input.shift
    ) {
      return
    }

    const key = input.key.toLowerCase()
    const isQuitShortcut = key === 'q' || input.code === 'KeyQ'
    const isSettingsShortcut = key === ',' || input.code === 'Comma'
    const isNewTabShortcut = key === 't' || input.code === 'KeyT'
    const isCloseTabShortcut = key === 'w' || input.code === 'KeyW'
    const isClearTerminalShortcut = key === 'k' || input.code === 'KeyK'
    const tabShortcut = /^[1-9]$/.test(key) ? Number(key) : undefined
    let action: AppShortcutAction | undefined

    if (isQuitShortcut) {
      event.preventDefault()
      requestQuit()
      return
    }

    if (tabShortcut) {
      action = `switch-tab-${tabShortcut}` as AppShortcutAction
    } else if (isSettingsShortcut) {
      action = 'open-settings'
    } else if (isNewTabShortcut) {
      action = 'new-tab'
    } else if (isCloseTabShortcut) {
      action = 'close-tab'
    } else if (isClearTerminalShortcut) {
      action = 'clear-terminal'
    }

    if (!action) return

    event.preventDefault()
    mainWindow?.webContents.send('app:shortcut', action)
  })

  mainWindow.on('close', (e) => {
    if (!isQuitting) {
      e.preventDefault()
      void saveWindowBounds()
      mainWindow?.hide()
      return
    }

    if (saveWindowBoundsTimer) {
      clearTimeout(saveWindowBoundsTimer)
      saveWindowBoundsTimer = undefined
    }

    if (!quitWindowBoundsSave) {
      e.preventDefault()
      quitWindowBoundsSave = saveWindowBounds()
        .catch((error: unknown) => {
          console.error('[window bounds save before quit failed]', error)
        })
        .finally(() => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.destroy()
          }
          finishQuit()
        })
    }
  })

  mainWindow.on('closed', () => {
    mainWindow = undefined
  })

  mainWindow.on('resize', queueWindowBoundsSave)
  mainWindow.on('move', queueWindowBoundsSave)

  if (config.windowBounds?.isMaximized) {
    mainWindow.maximize()
  }

  if (process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  registerHideShortcut(config.hideShortcut ?? 'CommandOrControl+Shift+Space')
}

function registerIpc(): void {
  ipcMain.handle('config:load', async () => {
    const config = DEMO_MODE ? demoConfig : await configStore.load()
    updateSecretMaskingSettingsCache(config)
    return config
  })

  ipcMain.handle('config:setSecretMaskingMode', async (_event, mode: SecretMaskingMode) => {
    const normalizedMode = normalizeSecretMaskingMode(mode)
    if (DEMO_MODE) {
      demoConfig.secretMasking = {
        ...normalizeSecretMaskingSettings(demoConfig.secretMasking),
        mode: normalizedMode
      }
      updateSecretMaskingSettingsCache(demoConfig)
      return demoConfig
    }

    const config = await configStore.updateSecretMaskingMode(normalizedMode)
    updateSecretMaskingSettingsCache(config)
    return config
  })

  ipcMain.handle('config:setSecretMaskingSettings', async (_event, settings: SecretMaskingSettings) => {
    if (DEMO_MODE) {
      demoConfig.secretMasking = normalizeSecretMaskingSettings(settings)
      updateSecretMaskingSettingsCache(demoConfig)
      return demoConfig
    }

    const config = await configStore.updateSecretMaskingSettings(settings)
    updateSecretMaskingSettingsCache(config)
    return config
  })

  ipcMain.handle('config:setChatToolsSettings', async (_event, settings: ChatToolsSettings) => {
    if (DEMO_MODE) {
      demoConfig.chatTools = normalizeChatToolsSettings(settings)
      return demoConfig
    }

    return configStore.updateChatToolsSettings(settings)
  })

  ipcMain.handle('telemetry:getRuntimeState', () => ({
    // Demo mode showcases the active UI state without ever really sending.
    possible: DEMO_MODE ? true : isTelemetryActive()
  }))

  ipcMain.handle('config:setTelemetrySettings', async (_event, patch: Partial<TelemetrySettings>) => {
    if (DEMO_MODE) {
      const current = normalizeTelemetrySettings(demoConfig.telemetry, () => 'demo-install-id')
      const record = patch && typeof patch === 'object' ? patch : {}
      demoConfig.telemetry = normalizeTelemetrySettings(
        { ...current, ...record, installId: current.installId },
        () => current.installId
      )
      broadcastTelemetrySettings(demoConfig.telemetry)
      return demoConfig
    }

    const config = await configStore.updateTelemetrySettings(patch)
    setTelemetrySettings(config.telemetry)
    broadcastTelemetrySettings(config.telemetry)
    // Replay (or drop) the funnel events held while consent was pending, so a
    // user who opts in on first run still produces the activation signals.
    if (config.telemetry?.enabled) {
      flushPendingEvents()
    } else {
      clearPendingEvents()
    }
    return config
  })

ipcMain.handle('app:openExternalUrl', (_event, url: string) => {
    return openAllowedExternalUrl(url)
  })

  ipcMain.handle('app:setWindowOpacity', (_event, opacity: number) => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    const normalizedOpacity = Number.isFinite(opacity)
      ? Math.min(1, Math.max(0.9, opacity))
      : 1
    mainWindow.setOpacity(normalizedOpacity)
  })

  ipcMain.handle('shortcut:setHide', async (_event, shortcut: string) => {
    const success = registerHideShortcut(shortcut)
    if (success) {
      const config = await configStore.load()
      await configStore.save({ ...config, hideShortcut: shortcut })
    }
    return success
  })

  ipcMain.on('app:window-ready', () => {
    mainWindow?.setOpacity(1)
  })

  ipcMain.handle('update:getStatus', () => getUpdateStatus())
  ipcMain.handle('update:check', () => checkForUpdates())
  ipcMain.handle('update:install', () => {
    // quitAndInstall() closes the window on the next tick to apply the update.
    // Flip isQuitting first (only when an install actually starts) so the window
    // 'close' handler quits instead of taking the hide-on-close branch — otherwise
    // the window just hides and the update never installs (#136).
    if (quitAndInstall()) {
      beginQuit()
    }
  })

  ipcMain.handle('shortcut:startRecording', () => {
    isRecordingShortcut = true
  })

  ipcMain.handle('shortcut:stopRecording', () => {
    isRecordingShortcut = false
  })

  ipcMain.handle('terminal:create', (_event, request?: CreateTerminalRequest) => {
    trackEvent('session_started', { oncePerRun: true })
    return terminalManager.createLocal(request)
  })

  ipcMain.handle('terminal:list', () => terminalManager.list())

  ipcMain.handle('sessionState:load', () => sessionStateStore.load())

  ipcMain.handle('sessionState:save', (_event, snapshot: SaveSessionStateRequest) => {
    return sessionStateStore.save(snapshot)
  })

  ipcMain.handle('sessionState:clear', () => sessionStateStore.clear())

  ipcMain.handle('chatHistory:list', () => chatHistoryStore.list())
  ipcMain.handle('chatHistory:get', (_event, id: string) => chatHistoryStore.get(id))
  ipcMain.handle('chatHistory:save', async (_event, chat: SavedChat) => {
    await ensureSecretMaskingSettingsCache()
    const sanitizedChat = await sanitizeSavedChatForStorage(
      chat,
      getScopedSecretMaskingSettings('chat-display'),
      undefined,
      capabilityRegistry.get('masking-rule')
    )
    await chatHistoryStore.save(sanitizedChat)
  })
  ipcMain.handle('chatHistory:delete', (_event, id: string) => chatHistoryStore.delete(id))
  ipcMain.handle('chatHistory:clear', () => chatHistoryStore.clear())

  ipcMain.handle('data:usage', async (): Promise<DataUsageStats> => {
    const userDataPath = app.getPath('userData')
    const storageBytes = (await Promise.all(
      DATA_USAGE_PATHS.map((dataPath) => getPathSize(join(userDataPath, dataPath)))
    )).reduce((total, size) => total + size, 0)
    const [chats, sessionState] = await Promise.all([
      chatHistoryStore.list(),
      sessionStateStore.load()
    ])

    return {
      chatCount: chats.length,
      sessionCount: sessionState?.sessions.length ?? 0,
      storageBytes
    }
  })

  ipcMain.handle('terminal:write', (_event, sessionId: string, data: string) => {
    terminalManager.write(sessionId, data)
  })

  ipcMain.handle('terminal:resize', (_event, sessionId: string, cols: number, rows: number) => {
    terminalManager.resize(sessionId, cols, rows)
  })

  ipcMain.handle('terminal:kill', (_event, sessionId: string) => {
    terminalManager.kill(sessionId)
  })

  ipcMain.handle('ssh:connectProfile', (_event, profile: SSHProfile, request?: CreateTerminalRequest) => {
    trackEvent('session_started', { oncePerRun: true })
    return terminalManager.connectSsh(profile, request)
  })

  ipcMain.handle('ssh:connectCommand', (_event, request: CreateSshCommandRequest) => {
    trackEvent('session_started', { oncePerRun: true })
    return terminalManager.connectSshCommand(request)
  })

  ipcMain.handle('ssh:listProfiles', async () => {
    const config = await configStore.load()
    return configStore.listSshProfiles(config)
  })

  ipcMain.handle('ssh:saveProfile', async (_event, profile: SSHProfileConfig) => {
    return configStore.upsertSshProfile(profile)
  })

  ipcMain.handle('ssh:deleteProfile', async (_event, id: string) => {
    return configStore.deleteSshProfile(id)
  })

  ipcMain.handle('ssh:chooseIdentityFile', async (): Promise<string | undefined> => {
    const result = await dialog.showOpenDialog({
      title: 'Choose SSH Identity File',
      properties: ['openFile', 'showHiddenFiles']
    })
    if (result.canceled || result.filePaths.length === 0) return undefined
    return result.filePaths[0]
  })

  ipcMain.handle('mcp:listServers', () => mcpConfigStore.list())

  ipcMain.handle('mcp:saveServer', (_event, server: unknown) => {
    if (!isMcpServerPayload(server)) {
      throw new Error('Invalid MCP server payload')
    }
    return mcpConfigStore.upsert(server)
  })

  ipcMain.handle('mcp:deleteServer', (_event, id: string) => {
    return mcpConfigStore.delete(id)
  })

  ipcMain.handle('mcp:refreshTools', async (_event, serverId: string) => {
    const server = (await mcpConfigStore.list()).find((candidate) => candidate.id === serverId)
    if (!server) throw new Error('MCP server not found.')
    const tools = await listMcpServerTools(server)
    return mcpConfigStore.saveTools(serverId, tools)
  })

  ipcMain.handle('mcp:setToolEnabled', (_event, serverId: string, toolName: string, enabled: boolean) => {
    return mcpConfigStore.setToolEnabled(serverId, toolName, enabled)
  })

  ipcMain.handle('mcp:discoverExternal', () => discoverExternalMcpServers())

  ipcMain.handle('mcp:importServers', (_event, servers: unknown) => {
    if (!Array.isArray(servers)) {
      throw new Error('Invalid MCP import payload')
    }
    return mcpConfigStore.importDiscovered(servers.filter(isDiscoveredMcpServerPayload))
  })

  ipcMain.handle('llm:saveProvider', async (_event, request: SaveLLMProviderRequest) => {
    if (DEMO_MODE) {
      return demoConfig
    }

    const provider = await prepareProviderRequest(request)
    invalidateProviderProxyAgents(provider.apiKeyRef)
    const config = await configStore.upsertProvider(provider)
    trackEvent('provider_configured', { oncePerRun: true })
    return config
  })

  ipcMain.handle('llm:hasApiKey', async (_event, apiKeyRef: unknown): Promise<boolean> => {
    if (typeof apiKeyRef !== 'string' || !apiKeyRef.trim()) {
      return false
    }
    if (DEMO_MODE) {
      return true
    }

    return Boolean(await getApiKey(apiKeyRef))
  })

  ipcMain.handle('llm:deleteProvider', async (_event, apiKeyRef: string) => {
    await deleteApiKey(apiKeyRef)
    await deleteProxyPasswordIfPresent(buildProxyPasswordRef(apiKeyRef))
    invalidateProviderProxyAgents(apiKeyRef)
    return configStore.deleteProvider(apiKeyRef)
  })

  ipcMain.handle('llm:listModels', async (_event, request: SaveLLMProviderRequest): Promise<ListModelsResult> => {
    if (DEMO_MODE) {
      return {
        models: [
          { id: 'demo-agent', ownedBy: 'Taviraq', supportsMcp: true },
          { id: 'demo-safety', ownedBy: 'Taviraq' }
        ],
        provider: request.provider
      }
    }

    const provider = await prepareProviderRequest(request, {
      deleteDisabledProxyPassword: false,
      saveSecrets: false
    })
    return {
      models: await listModels(provider, {
        apiKey: request.apiKey?.trim() || undefined,
        ...(Object.prototype.hasOwnProperty.call(request, 'proxyPassword')
          ? { proxyPassword: request.proxyPassword }
          : {})
      }),
      provider
    }
  })

  ipcMain.handle('llm:assessCommandRisk', async (_event, request: CommandRiskAssessmentRequest) => {
    await ensureSecretMaskingSettingsCache()
    if (DEMO_MODE) {
      return {
        dangerous: /\brm\s+-rf\b|sudo|chmod\s+-r/i.test(request.command),
        reason: 'Demo safety model: this command can remove files recursively, so it requires explicit confirmation.'
      }
    }

    const sessionId = request.context.session?.id
    const sessionLabel = request.context.session?.label
    const policyRequest = applyTerminalContextPolicy(request)
    const previousContext = sessionId ? secretContextsBySession.get(sessionId) : undefined
    return assessCommandRisk(
      policyRequest,
      getScopedSecretMaskingSettings('provider-payload'),
      previousContext,
      async (context) => {
        if (!sessionId) {
          recordSecretMaskingAuditEvent('command-risk', 'provider-payload', context, sessionLabel)
          return
        }

        await withSessionSecretContextLock(sessionId, () => {
          const latestContext = secretContextsBySession.get(sessionId)
          const newContext = diffSecretMaskContext(context, latestContext)
          if (newContext.bindings.length > 0) {
            secretContextsBySession.set(sessionId, mergeNewSecretContext(latestContext, context, newContext))
          }
          recordSecretMaskingAuditEvent('command-risk', 'provider-payload', newContext, sessionLabel)
        })
      },
      capabilityRegistry
    )
  })

  ipcMain.handle('llm:summarizeConversation', async (_event, request: SummarizeConversationRequest) => {
    await ensureSecretMaskingSettingsCache()
    if (DEMO_MODE) {
      return {
        name: 'Inspect terminal workspace',
        content: 'Inspect the current terminal workspace, run safe read-only commands when useful, and summarize the result.'
      }
    }

    const requestId = request.requestId
    const secretMaskingSettings = getScopedSecretMaskingSettings('provider-payload')
    if (!requestId) {
      return summarizeConversation(
        request,
        undefined,
        secretMaskingSettings,
        (context) => recordSecretMaskingAuditEvent('summary', 'provider-payload', context),
        capabilityRegistry
      )
    }

    const controller = new AbortController()
    summarizeControllers.set(requestId, controller)
    try {
      return await summarizeConversation(
        request,
        controller.signal,
        secretMaskingSettings,
        (context) => recordSecretMaskingAuditEvent('summary', 'provider-payload', context),
        capabilityRegistry
      )
    } finally {
      summarizeControllers.delete(requestId)
    }
  })

  ipcMain.handle('llm:cancelSummarizeConversation', (_event, requestId: string) => {
    summarizeControllers.get(requestId)?.abort()
  })

  ipcMain.handle('llm:cancelChatStream', (_event, requestId: string) => {
    chatStreamControllers.get(requestId)?.abort()
  })

  ipcMain.handle('command:propose', (_event, text: string) => extractCommandProposals(text))

  ipcMain.handle('command:approve', (_event, sessionId: string, command: string) => {
    if (!pendingApprovedCommands.has(sessionId)) {
      pendingApprovedCommands.set(sessionId, new Set())
    }
    pendingApprovedCommands.get(sessionId)!.add(normalizeApprovalKey(command))
  })

  ipcMain.handle('command:runConfirmed', (_event, sessionId: string, command: string) => {
    const approved = pendingApprovedCommands.get(sessionId)
    const resolvedCommand = resolveSecretPlaceholders(command, secretContextsBySession.get(sessionId))
    const approvalKey = normalizeApprovalKey(command)
    if (!approved?.has(approvalKey)) {
      throw new Error('Command was not approved before execution.')
    }
    approved.delete(approvalKey)
    try {
      terminalManager.runConfirmed(sessionId, resolvedCommand, command)
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : 'Unable to resolve local secret placeholders.')
    }
  })

  ipcMain.handle('secret:maskOutput', async (_event, sessionId: string, text: string, source?: SecretMaskingAuditSource) => {
    await ensureSecretMaskingSettingsCache()
    return withSessionSecretContextLock(sessionId, async () => {
      const previousContext = secretContextsBySession.get(sessionId)
      const result = await maskTextForDisplay(
        text,
        getScopedSecretMaskingSettings('chat-display'),
        previousContext,
        undefined,
        capabilityRegistry.get('masking-rule')
      )
      const newContext = diffSecretMaskContext(result.context, previousContext)
      if (newContext.bindings.length > 0) {
        secretContextsBySession.set(sessionId, result.context)
      }
      recordSecretMaskingAuditEvent(source ?? 'terminal-display', 'chat-display', newContext, getSessionLabel(sessionId))
      return result.text
    })
  })

  ipcMain.handle('secret:listAuditEvents', () => secretMaskingAuditEvents)

  ipcMain.handle('secret:clearAuditEvents', () => {
    secretMaskingAuditEvents.splice(0)
  })

  // Prompts
  ipcMain.handle('prompt:list', () => promptStore.list())

  ipcMain.handle('prompt:save', (_event, prompt: PromptTemplate) => {
    return promptStore.save(prompt)
  })

  ipcMain.handle('prompt:delete', (_event, id: string) => {
    return promptStore.delete(id)
  })

  ipcMain.handle('prompt:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Prompt',
      filters: [{ name: 'Markdown', extensions: ['md', 'txt'] }],
      properties: ['openFile', 'multiSelections']
    })
    if (result.canceled || result.filePaths.length === 0) return []
    const imported: PromptTemplate[] = []
    for (const filePath of result.filePaths) {
      const prompt = await promptStore.importFromFile(filePath)
      imported.push(prompt)
    }
    return imported
  })

  ipcMain.handle('commandSnippet:list', () => commandSnippetStore.list())

  ipcMain.handle('commandSnippet:save', (_event, snippet: CommandSnippet) => {
    return commandSnippetStore.save(snippet)
  })

  ipcMain.handle('commandSnippet:delete', (_event, id: string) => {
    return commandSnippetStore.delete(id)
  })

  ipcMain.handle('data:export', async (_event, preferences: ExportData['preferences']) => {
    const config = await configStore.load()
    const prompts = await promptStore.list()
    const commandSnippets = await commandSnippetStore.list()
    const mcpServers = await mcpConfigStore.list()
    const includeKeysResult = await dialog.showMessageBox({
      type: 'question',
      buttons: ['Continue', 'Cancel'],
      cancelId: 1,
      defaultId: 0,
      message: 'Export Taviraq data',
      detail: 'Choose whether this export should include plaintext API keys, proxy passwords, and MCP environment values.',
      checkboxLabel: 'Include secrets in export file',
      checkboxChecked: false
    })

    if (includeKeysResult.response === 1) return

    const apiKeys: Record<string, string> = {}
    const proxyPasswords: Record<string, string> = {}
    if (includeKeysResult.checkboxChecked) {
      for (const provider of config.providers) {
        const apiKey = await getApiKey(provider.apiKeyRef)
        if (apiKey) apiKeys[provider.apiKeyRef] = apiKey
        if (provider.proxyPasswordRef) {
          const proxyPassword = await getProxyPassword(provider.proxyPasswordRef)
          if (proxyPassword) proxyPasswords[provider.proxyPasswordRef] = proxyPassword
        }
      }
    }

    const exportData: ExportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      config: withExportableProxyRefs(config, proxyPasswords),
      ...(Object.keys(apiKeys).length > 0 ? { apiKeys } : {}),
      ...(Object.keys(proxyPasswords).length > 0 ? { proxyPasswords } : {}),
      prompts,
      commandSnippets,
      sshProfiles: config.sshProfiles ?? [],
      mcpServers: withExportableMcpServers(mcpServers, includeKeysResult.checkboxChecked),
      preferences
    }

    const saveResult = await dialog.showSaveDialog({
      title: 'Export Taviraq Data',
      defaultPath: 'taviraq-backup.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })

    if (saveResult.canceled || !saveResult.filePath) return
    await writeFile(saveResult.filePath, JSON.stringify(exportData, null, 2), 'utf8')
  })

  ipcMain.handle('data:import', async (): Promise<ImportResult | undefined> => {
    const openResult = await dialog.showOpenDialog({
      title: 'Import Taviraq Data',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })

    if (openResult.canceled || openResult.filePaths.length === 0) return undefined

    const raw = await readFile(openResult.filePaths[0], 'utf8')
    const data = JSON.parse(raw) as Partial<ExportData>
    if (data.version !== 1) {
      throw new Error('Unsupported import file version')
    }

    const currentConfig = await configStore.load()
    const currentProviderRefs = new Set(currentConfig.providers.map((provider) => provider.apiKeyRef))
    const importableProxyRefs = buildImportableProxyRefs(data.config?.providers ?? [], data.proxyPasswords)
    const importedProviders = importableProxyRefs.providers
    const newProviders = importedProviders.filter((provider) => !currentProviderRefs.has(provider.apiKeyRef))
    const mergedConfig: AppConfig = {
      ...currentConfig,
      secretMasking: data.config?.secretMasking ?? currentConfig.secretMasking,
      chatTools: data.config?.chatTools
        ? normalizeChatToolsSettings(data.config.chatTools)
        : currentConfig.chatTools,
      // Preserve the imported telemetry consent choice (denied/granted) so a
      // restored backup keeps the user's opt-out and doesn't re-prompt. Falls
      // back to this machine's install id when the import lacks one.
      telemetry: data.config?.telemetry
        ? normalizeTelemetrySettings(
            data.config.telemetry,
            () => currentConfig.telemetry?.installId ?? randomUUID()
          )
        : currentConfig.telemetry,
      providers: [...currentConfig.providers, ...newProviders]
    }

    const currentPrompts = await promptStore.list()
    const currentPromptIds = new Set(currentPrompts.map((prompt) => prompt.id))
    const importedPrompts = Array.isArray(data.prompts) ? data.prompts : []
    const newPrompts = importedPrompts.filter((prompt) => !currentPromptIds.has(prompt.id))
    const snippetsAdded = await commandSnippetStore.importMany(
      Array.isArray(data.commandSnippets) ? data.commandSnippets : []
    )
    const currentMcpServers = await mcpConfigStore.list()
    const currentMcpKeys = new Set(currentMcpServers.map(getMcpImportKey))
    const importedMcpServers = Array.isArray(data.mcpServers) ? data.mcpServers : []
    const newMcpServers = importedMcpServers.reduce<McpServerConfig[]>((servers, server) => {
      if (!isMcpServerPayload(server) || typeof server.name !== 'string' || typeof server.command !== 'string') {
        return servers
      }
      const key = getMcpImportKey(server)
      if (currentMcpKeys.has(key)) return servers
      currentMcpKeys.add(key)
      const now = new Date().toISOString()
      servers.push({
        ...server,
        id: randomUUID(),
        createdAt: typeof server.createdAt === 'string' ? server.createdAt : now,
        updatedAt: now
      })
      return servers
    }, [])

    const newProviderRefs = new Set(newProviders.map((provider) => provider.apiKeyRef))
    if (data.apiKeys) {
      for (const [ref, apiKey] of Object.entries(data.apiKeys)) {
        if (newProviderRefs.has(ref)) {
          await saveApiKey(ref, apiKey)
        }
      }
    }
    if (Object.keys(importableProxyRefs.proxyPasswords).length > 0) {
      const newProxyPasswordRefs = new Set(
        newProviders
          .map((provider) => provider.proxyPasswordRef)
          .filter((ref): ref is string => Boolean(ref))
      )
      for (const [ref, password] of Object.entries(importableProxyRefs.proxyPasswords)) {
        if (newProxyPasswordRefs.has(ref)) {
          await saveProxyPassword(ref, password)
        }
      }
    }

    await configStore.save(mergedConfig)
    updateSecretMaskingSettingsCache(mergedConfig)
    setTelemetrySettings(mergedConfig.telemetry)
    broadcastTelemetrySettings(mergedConfig.telemetry)
    if (mergedConfig.telemetry?.enabled) {
      flushPendingEvents()
    } else {
      clearPendingEvents()
    }
    for (const prompt of newPrompts) {
      await promptStore.save(prompt)
    }

    const currentSshProfiles = currentConfig.sshProfiles ?? []
    const currentSshIds = new Set(currentSshProfiles.map((p) => p.id))
    const importedSshProfiles = Array.isArray(data.sshProfiles) ? data.sshProfiles : []
    const newSshProfiles = importedSshProfiles.filter((p) => !currentSshIds.has(p.id))
    for (const profile of newSshProfiles) {
      await configStore.upsertSshProfile(profile)
    }
    if (newMcpServers.length > 0) {
      await mcpConfigStore.saveAll([...currentMcpServers, ...newMcpServers])
    }

    return {
      providersAdded: newProviders.length,
      promptsAdded: newPrompts.length,
      commandSnippetsAdded: snippetsAdded,
      sshProfilesAdded: newSshProfiles.length,
      mcpServersAdded: newMcpServers.length,
      preferences: data.preferences
    }
  })

  ipcMain.on('llm:chatStream', (event, request: ChatStreamRequest) => {
    const controller = new AbortController()
    chatStreamControllers.set(request.requestId, controller)

    if (DEMO_MODE) {
      void sendDemoChatStream(event, request, controller.signal)
        .then(() => {
          if (controller.signal.aborted) return
          event.sender.send('llm:chatStream:event', {
            requestId: request.requestId,
            type: 'done'
          })
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          event.sender.send('llm:chatStream:event', {
            requestId: request.requestId,
            type: 'error',
            message: error instanceof Error ? error.message : String(error)
          })
        })
        .finally(() => {
          chatStreamControllers.delete(request.requestId)
        })
      return
    }

    trackEvent('ai_request_sent', { oncePerRun: true })

    void (async () => {
      try {
        await ensureSecretMaskingSettingsCache()
        const sessionId = request.context.session?.id
        const sessionLabel = request.context.session?.label
        const runStream = async (): Promise<void> => {
          const policyRequest = applyTerminalContextPolicy(request)
          const previousContext = sessionId ? secretContextsBySession.get(sessionId) : undefined
          const mcpServers = await mcpConfigStore.list()
          const result = await streamChatCompletion(policyRequest, (chunk) => {
            if (chunk.type === 'privacy' && typeof chunk.maskedSecrets === 'number') {
              event.sender.send('llm:chatStream:event', {
                requestId: request.requestId,
                type: 'privacy',
                maskedSecrets: chunk.maskedSecrets,
                categories: chunk.categories ?? [],
                source: 'chat-stream',
                scope: 'provider-payload',
                sessionLabel
              })
            }

            if (chunk.type === 'progress' && chunk.stage && typeof chunk.progress === 'number') {
              event.sender.send('llm:chatStream:event', {
                requestId: request.requestId,
                type: 'progress',
                stage: chunk.stage,
                progress: chunk.progress
              })
            }

            if (chunk.type === 'tool' && chunk.status && chunk.serverName && chunk.toolName) {
              event.sender.send('llm:chatStream:event', {
                requestId: request.requestId,
                type: 'tool',
                status: chunk.status,
                serverName: chunk.serverName,
                toolName: chunk.toolName,
                ...(chunk.toolCallId ? { toolCallId: chunk.toolCallId } : {}),
                ...(chunk.content ? { content: chunk.content } : {})
              })
              return
            }

            if (chunk.reasoningContent) {
              event.sender.send('llm:chatStream:event', {
                requestId: request.requestId,
                type: 'reasoning',
                content: chunk.reasoningContent
              })
            }

            if (chunk.content) {
              event.sender.send('llm:chatStream:event', {
                requestId: request.requestId,
                type: 'chunk',
                content: chunk.content
              })
            }
          }, controller.signal, getScopedSecretMaskingSettings('provider-payload'), previousContext, mcpServers, capabilityRegistry)

          if (controller.signal.aborted) return
          const newContext = diffSecretMaskContext(result.secretContext, previousContext)
          if (sessionId && newContext.bindings.length > 0) {
            secretContextsBySession.set(sessionId, result.secretContext)
          }
          recordSecretMaskingAuditEvent('chat-stream', 'provider-payload', newContext, sessionLabel)
          event.sender.send('llm:chatStream:event', {
            requestId: request.requestId,
            type: 'done',
            ...(result.maskedContent ? { maskedContent: result.maskedContent } : {})
          })
          trackEvent('ai_response_received', { oncePerRun: true })
        }

        if (sessionId) {
          await withSessionSecretContextLock(sessionId, runStream)
        } else {
          await runStream()
        }
      } catch (error: unknown) {
        if (controller.signal.aborted) return
        trackEvent('ai_request_failed', { oncePerRun: true, props: { error_class: classifyAiError(error) } })
        event.sender.send('llm:chatStream:event', {
          requestId: request.requestId,
          type: 'error',
          message: error instanceof Error ? error.message : String(error)
        })
      } finally {
        chatStreamControllers.delete(request.requestId)
      }
    })()
  })
}

// Aptabase's initialize() must run before the app is ready (it registers
// privileged schemes and bails out if app.isReady() is already true), so set it
// up here rather than inside whenReady. This only prepares the SDK; events are
// still gated on consent at emit time.
if (!DEMO_MODE) {
  setupTelemetry()
}

void app.whenReady().then(async () => {
  await initializeSecretMaskingModeCache()
  await initializeCapabilities()
  void warmProviderSecrets()
  registerApplicationMenu()
  registerIpc()
  void createWindow()
  initAutoUpdates(() => mainWindow)

  if (!DEMO_MODE) {
    void configStore.initTelemetry().then(({ settings, isFirstRun }) => {
      setTelemetrySettings(settings)
      // createWindow() runs before this async load resolves, so an early
      // session_started may already be buffered as "pending". Reconcile it with
      // the loaded decision: send if opted in, drop if denied, keep if pending.
      if (settings.enabled) {
        flushPendingEvents()
      } else if (settings.consentDecision === 'denied') {
        clearPendingEvents()
      }
      // On a fresh install these are held while consent is pending and replayed
      // once the user opts in (telemetryService buffers pre-consent events).
      if (isFirstRun) {
        trackEvent('app_first_run', { oncePerRun: true })
      }
      trackEvent('app_opened', { oncePerRun: true })
    })
  }

  app.on('activate', () => {
    if (isQuitting) return
    if (BrowserWindow.getAllWindows().length === 0) {
      void createWindow()
    }
  })
})

app.on('before-quit', () => {
  beginQuit()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  disposeAutoUpdates()
})

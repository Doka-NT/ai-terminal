// SPDX-License-Identifier: MPL-2.0
import { access } from 'node:fs/promises'
import { constants } from 'node:fs'
import { spawn } from 'node:child_process'
import { join } from 'node:path'
import type {
  ChatMessage,
  ChatStreamRequest,
  CommandRiskAssessmentRequest,
  SavedChat,
  SecretMaskingMode,
  SecretMaskingSettings,
  SummarizeConversationRequest
} from '@shared/types'
import type { MaskingRuleProvider } from '@main/capabilities'
import {
  BARE_SECRET_MAX_MATCHES,
  CUSTOM_SECRET_PATTERN_MAX_MATCHES,
  CUSTOM_SECRET_SCAN_MAX_TEXT_LENGTH,
  createDefaultSecretMaskingSettings,
  isSafeCustomSecretPatternSource
} from '@shared/secretMaskingConfig'
import {
  DISPLAY_SECRET_LABEL,
  SECRET_PLACEHOLDER_GLOBAL_RE,
  SECRET_PLACEHOLDER_PREFIX,
  SECRET_PLACEHOLDER_RE
} from '@shared/secretPlaceholders'

const GITLEAKS_TIMEOUT_MS = 5_000
const GITLEAKS_UNAVAILABLE_MESSAGE = 'Gitleaks secret scanner is not available.'
const GIT_SHA_RE = /\b(?:[a-f0-9]{40}|[a-f0-9]{64})\b/i

type ProcessWithResourcesPath = NodeJS.Process & {
  resourcesPath?: string
}

export interface SecretFinding {
  ruleId: string
  description?: string
  secret?: string
  match?: string
}

export interface SecretBinding {
  placeholder: string
  value: string
  kind: string
}

export interface SecretMaskContext {
  bindings: SecretBinding[]
  byValue: Map<string, SecretBinding>
  byPlaceholder: Map<string, SecretBinding>
}

export interface MaskedRequest<T> {
  request: T
  context: SecretMaskContext
}

export interface MaskedTextResult {
  text: string
  context: SecretMaskContext
}

export type SecretMaskingInput = SecretMaskingMode | SecretMaskingSettings

export function createSecretMaskContext(): SecretMaskContext {
  return {
    bindings: [],
    byValue: new Map(),
    byPlaceholder: new Map()
  }
}

export function cloneSecretMaskContext(ctx: SecretMaskContext): SecretMaskContext {
  const clone = createSecretMaskContext()
  for (const binding of ctx.bindings) {
    const clonedBinding = { ...binding }
    clone.bindings.push(clonedBinding)
    clone.byValue.set(clonedBinding.value, clonedBinding)
    clone.byPlaceholder.set(clonedBinding.placeholder, clonedBinding)
  }
  return clone
}

export function diffSecretMaskContext(
  context: SecretMaskContext,
  previousContext?: SecretMaskContext
): SecretMaskContext {
  const diff = createSecretMaskContext()
  const previousValues = new Set(previousContext?.bindings.map((binding) => binding.value) ?? [])
  const previousPlaceholders = new Set(previousContext?.bindings.map((binding) => binding.placeholder) ?? [])

  for (const binding of context.bindings) {
    if (previousValues.has(binding.value) || previousPlaceholders.has(binding.placeholder)) continue
    const clonedBinding = { ...binding }
    diff.bindings.push(clonedBinding)
    diff.byValue.set(clonedBinding.value, clonedBinding)
    diff.byPlaceholder.set(clonedBinding.placeholder, clonedBinding)
  }

  return diff
}

export function containsSecretPlaceholder(text: string): boolean {
  return SECRET_PLACEHOLDER_RE.test(text)
}

export function resolveSecretPlaceholders(text: string, ctx?: SecretMaskContext): string {
  if (!containsSecretPlaceholder(text)) return text
  if (!ctx) throw new Error('This command references a local secret that is no longer available.')

  const unresolved = new Set<string>()
  const resolved = text.replace(SECRET_PLACEHOLDER_GLOBAL_RE, (placeholder) => {
    const binding = ctx.byPlaceholder.get(placeholder)
    if (!binding) {
      unresolved.add(placeholder)
      return placeholder
    }
    return binding.value
  })

  if (unresolved.size > 0) {
    throw new Error('This command references a local secret that is no longer available.')
  }

  return resolved
}

export async function maskChatStreamRequest(
  request: ChatStreamRequest,
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  existingContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<MaskedRequest<ChatStreamRequest>> {
  const textParts = [
    ...request.messages.map((message) => message.content),
    request.context.selectedText,
    request.context.terminalOutput ?? ''
  ]
  const context = await createContextFromTexts(textParts, mode, signal, existingContext, maskingProviders)

  return {
    context,
    request: {
      ...request,
      messages: maskMessages(request.messages, context),
      context: {
        ...request.context,
        selectedText: maskText(request.context.selectedText, context),
        terminalOutput: request.context.terminalOutput
          ? maskText(request.context.terminalOutput, context)
          : request.context.terminalOutput,
        maskedSecretCount: context.bindings.length
      }
    }
  }
}

export async function maskCommandRiskAssessmentRequest(
  request: CommandRiskAssessmentRequest,
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  existingContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<MaskedRequest<CommandRiskAssessmentRequest>> {
  const textParts = [
    request.command,
    request.context.selectedText,
    request.context.terminalOutput ?? ''
  ]
  const context = await createContextFromTexts(textParts, mode, signal, existingContext, maskingProviders)

  return {
    context,
    request: {
      ...request,
      command: maskText(request.command, context),
      context: {
        ...request.context,
        selectedText: maskText(request.context.selectedText, context),
        terminalOutput: request.context.terminalOutput
          ? maskText(request.context.terminalOutput, context)
          : request.context.terminalOutput,
        maskedSecretCount: context.bindings.length
      }
    }
  }
}

export async function maskSummarizeConversationRequest(
  request: SummarizeConversationRequest,
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  existingContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<MaskedRequest<SummarizeConversationRequest>> {
  const context = await createContextFromTexts(request.messages.map((message) => message.content), mode, signal, existingContext, maskingProviders)

  return {
    context,
    request: {
      ...request,
      messages: maskMessages(request.messages, context)
    }
  }
}

export async function maskTextForDisplay(
  text: string,
  mode: SecretMaskingInput,
  existingContext?: SecretMaskContext,
  signal?: AbortSignal,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<MaskedTextResult> {
  const context = await createContextFromTexts([text], mode, signal, existingContext, maskingProviders)
  return {
    context,
    text: displaySecretPlaceholders(maskText(text, context))
  }
}

export async function sanitizeSavedChatForStorage(
  chat: SavedChat,
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<SavedChat> {
  const textParts = [
    chat.title,
    ...chat.messages.flatMap((message) => [
      message.content,
      message.command ?? '',
      message.output ?? '',
      message.reasoningContent ?? ''
    ])
  ]
  const context = await createContextFromTexts(textParts, mode, signal, undefined, maskingProviders)
  const redact = (value?: string): string | undefined => (
    value === undefined ? undefined : displaySecretPlaceholders(maskText(value, context))
  )

  return {
    ...chat,
    title: redact(chat.title) || chat.title,
    messages: chat.messages.map((message) => ({
      ...message,
      content: redact(message.content) ?? '',
      command: redact(message.command),
      output: redact(message.output),
      reasoningContent: redact(message.reasoningContent)
    }))
  }
}

export async function createContextFromTexts(
  texts: string[],
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  existingContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<SecretMaskContext> {
  const settings = normalizeSecretMaskingInput(mode)
  if (settings.mode === 'off') return createSecretMaskContext()
  const context = existingContext ? cloneSecretMaskContext(existingContext) : createSecretMaskContext()

  const combined = texts.filter(Boolean).join('\n\n--- taviraq-secret-scan-boundary ---\n\n')
  if (!combined.trim()) return context

  const findings = await scanTextForSecrets(combined, settings, signal, maskingProviders)
  for (const finding of findings) {
    registerFinding(context, finding)
  }

  return context
}

export async function scanTextForSecrets(
  text: string,
  mode: SecretMaskingInput,
  signal?: AbortSignal,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<SecretFinding[]> {
  const settings = normalizeSecretMaskingInput(mode)
  if (settings.mode === 'off') return []

  const supplementalFindings = findSupplementalStrictSecrets(text)
  const customFindings = findCustomPatternSecrets(text, settings)
  const providerFindings = collectProviderSecretFindings(maskingProviders, text, settings)
  const bareEntropyFindings = findBareHighEntropySecrets(text)
  try {
    const gitleaksFindings = await runGitleaks(text, signal)
    return [...customFindings, ...gitleaksFindings, ...supplementalFindings, ...providerFindings, ...bareEntropyFindings]
  } catch (error) {
    if (isGitleaksUnavailableError(error)) {
      return [...customFindings, ...supplementalFindings, ...providerFindings, ...bareEntropyFindings]
    }
    throw error
  }
}

export function collectProviderSecretFindings(
  providers: readonly MaskingRuleProvider[],
  text: string,
  mode: SecretMaskingInput
): SecretFinding[] {
  if (providers.length === 0) return []

  const findings: SecretFinding[] = []
  for (const provider of providers) {
    try {
      findings.push(...provider.findSecrets(text, mode))
    } catch (error) {
      console.warn(`[capabilities] masking-rule provider "${provider.id}" failed`, error)
    }
  }
  return findings
}

export function parseGitleaksReport(output: string): SecretFinding[] {
  const trimmed = output.trim()
  if (!trimmed) return []

  const parsed = JSON.parse(trimmed) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('Gitleaks returned an unreadable report.')
  }

  return parsed.flatMap((item) => {
    if (!item || typeof item !== 'object') return []
    const record = item as Record<string, unknown>
    const ruleId = readString(record, 'RuleID') || 'gitleaks'
    return [{
      ruleId,
      description: readString(record, 'Description'),
      secret: readString(record, 'Secret'),
      match: readString(record, 'Match')
    }]
  })
}

export function addSecretFindingsToContext(context: SecretMaskContext, findings: SecretFinding[]): void {
  for (const finding of findings) {
    registerFinding(context, finding)
  }
}

export function findSupplementalStrictSecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = []

  const namedSecretRe =
    /\b([A-Z0-9_-]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|REFRESH[_-]?TOKEN|AUTH[_-]?TOKEN|TOKEN|SECRET|PASSWORD|PASSWD|PWD|PRIVATE[_-]?KEY)[A-Z0-9_-]*)\b\s*[:=]\s*["']?([^\s"',;`]{16,})["']?/gi
  for (const match of text.matchAll(namedSecretRe)) {
    const value = match[2]
    if (value && looksHighEntropy(value)) {
      findings.push({
        ruleId: `taviraq-${kindFromLabel(match[1])}`,
        description: 'Taviraq contextual secret',
        secret: value,
        match: match[0]
      })
    }
  }

  const authorizationRe = /\bBearer\s+([A-Za-z0-9._~+/=-]{20,})\b/gi
  for (const match of text.matchAll(authorizationRe)) {
    const value = match[1]
    if (value && !isLikelySafeToken(value)) {
      findings.push({
        ruleId: 'taviraq-bearer-token',
        description: 'Taviraq bearer token',
        secret: value,
        match: match[0]
      })
    }
  }

  const credentialUrlRe = /\bhttps?:\/\/[^/\s:@]+:([^/\s@]{8,})@[^/\s]+/gi
  for (const match of text.matchAll(credentialUrlRe)) {
    const value = match[1]
    if (value && !isLikelySafeToken(value)) {
      findings.push({
        ruleId: 'taviraq-url-credential',
        description: 'Taviraq URL credential',
        secret: value,
        match: match[0]
      })
    }
  }

  const oauthAuthorizationCodeRe = /\b4\/[0-9A-Za-z_-]{20,}\b/g
  for (const match of text.matchAll(oauthAuthorizationCodeRe)) {
    findings.push({
      ruleId: 'taviraq-google-oauth-code',
      description: 'Google OAuth authorization code',
      secret: match[0],
      match: match[0]
    })
  }

  const oauthRefreshTokenRe = /\b1\/\/[0-9A-Za-z_-]{20,}\b/g
  for (const match of text.matchAll(oauthRefreshTokenRe)) {
    findings.push({
      ruleId: 'taviraq-google-oauth-refresh-token',
      description: 'Google OAuth refresh token',
      secret: match[0],
      match: match[0]
    })
  }

  return findings
}

const INTEGRITY_HASH_PREFIX_RE = /^sha(?:1|256|384|512)-/i
// Split (not \b-matchAll) on purpose: \b is defined relative to \w, which does not
// include several chars this charset allows (e.g. "/"). Matching with \b would drop a
// leading "/" from an absolute path, defeating isLikelyFilesystemPath() below.
// "=" is deliberately NOT part of the kept charset: unlike the rest of this set, it
// shows up in real text as a KEY=VALUE delimiter, not just inside a token, and keeping
// it would glue an assignment's identifier onto its value into one over-broad match
// (e.g. "API_KEY=abc..." masked whole instead of just "abc..."). Real base64 padding
// is at most the last couple of characters of a secret, so treating "=" as a
// delimiter only costs those trailing characters, not the secret itself.
const BARE_ENTROPY_TOKEN_SPLIT_RE = /[^A-Za-z0-9._~+/-]+/

export function findBareHighEntropySecrets(text: string): SecretFinding[] {
  const findings: SecretFinding[] = []

  for (const value of text.split(BARE_ENTROPY_TOKEN_SPLIT_RE)) {
    if (findings.length >= BARE_SECRET_MAX_MATCHES) break
    if (INTEGRITY_HASH_PREFIX_RE.test(value)) continue
    if (!looksHighEntropy(value)) continue

    findings.push({
      ruleId: 'taviraq-bare-high-entropy',
      description: 'Taviraq bare high-entropy value',
      secret: value,
      match: value
    })
  }

  return findings
}

export function findCustomPatternSecrets(text: string, mode: SecretMaskingInput): SecretFinding[] {
  const settings = normalizeSecretMaskingInput(mode)
  if (settings.mode === 'off') return []

  const findings: SecretFinding[] = []
  const scanText = text.length > CUSTOM_SECRET_SCAN_MAX_TEXT_LENGTH
    ? text.slice(-CUSTOM_SECRET_SCAN_MAX_TEXT_LENGTH)
    : text
  for (const pattern of settings.customPatterns) {
    if (!pattern.enabled) continue
    if (!isSafeCustomSecretPatternSource(pattern.pattern)) continue

    let matcher: RegExp
    try {
      matcher = new RegExp(pattern.pattern, 'g')
    } catch {
      continue
    }

    let matches = 0
    for (const match of scanText.matchAll(matcher)) {
      const secret = match[1] || match[0]
      if (!secret) continue
      findings.push({
        ruleId: `custom-${kindFromLabel(pattern.name)}`,
        description: `Custom pattern: ${pattern.name}`,
        secret,
        match: match[0]
      })
      matches += 1
      if (matches >= CUSTOM_SECRET_PATTERN_MAX_MATCHES || match[0] === '') break
    }
  }

  return findings
}

export function maskText(text: string, ctx: SecretMaskContext): string {
  if (!text || ctx.bindings.length === 0) return text

  const bindings = sortedBindings(ctx).filter((binding) => binding.value.length > 0)
  if (bindings.length === 0) return text

  const byValue = new Map(bindings.map((binding) => [binding.value, binding.placeholder]))
  const pattern = new RegExp(bindings.map((binding) => escapeRegExp(binding.value)).join('|'), 'g')
  return text.replace(pattern, (value) => byValue.get(value) ?? value)
}

export function unmaskText(text: string, ctx: SecretMaskContext): string {
  if (!text || ctx.bindings.length === 0) return text

  return ctx.bindings.reduce(
    (unmasked, binding) => unmasked.split(binding.placeholder).join(binding.value),
    text
  )
}

export function redactSecretPlaceholders(text: string): string {
  return text.replace(SECRET_PLACEHOLDER_GLOBAL_RE, DISPLAY_SECRET_LABEL)
}

// Kept as a semantic alias for UI/storage call sites that want display-safe text.
export function displaySecretPlaceholders(text: string): string {
  return redactSecretPlaceholders(text)
}

export function createStreamingPlaceholderRedactor(): {
  push: (chunk: string) => string
  flush: () => string
} {
  let pending = ''

  return {
    push(chunk: string): string {
      pending += chunk

      const emitLength = safePlaceholderEmitLength(pending)
      if (emitLength <= 0) return ''

      const emit = pending.slice(0, emitLength)
      pending = pending.slice(emitLength)
      return redactSecretPlaceholders(emit)
    },
    flush(): string {
      const output = redactSecretPlaceholders(pending)
      pending = ''
      return output
    }
  }
}

function safePlaceholderEmitLength(text: string): number {
  const lastPrefixIndex = text.lastIndexOf(SECRET_PLACEHOLDER_PREFIX)
  if (lastPrefixIndex !== -1) {
    const candidateTail = text.slice(lastPrefixIndex + SECRET_PLACEHOLDER_PREFIX.length)
    const closeIndex = candidateTail.indexOf(']]')
    if (closeIndex === -1 && /^[A-Z0-9_]*$/.test(candidateTail)) {
      return lastPrefixIndex
    }
  }

  return text.length - trailingPlaceholderPrefixLength(text)
}

function trailingPlaceholderPrefixLength(text: string): number {
  const maxLength = Math.min(SECRET_PLACEHOLDER_PREFIX.length - 1, text.length)
  for (let length = maxLength; length > 0; length -= 1) {
    if (SECRET_PLACEHOLDER_PREFIX.startsWith(text.slice(-length))) {
      return length
    }
  }
  return 0
}

export function createStreamingUnmasker(ctx: SecretMaskContext): {
  push: (chunk: string) => string
  flush: () => string
} {
  if (ctx.bindings.length === 0) {
    return {
      push: (chunk) => chunk,
      flush: () => ''
    }
  }

  let pending = ''
  const maxPlaceholderLength = Math.max(...ctx.bindings.map((binding) => binding.placeholder.length))
  // Keep a little extra overlap beyond the longest placeholder for adjacent punctuation/quotes.
  const keep = maxPlaceholderLength + 8

  return {
    push(chunk: string): string {
      pending += chunk
      if (pending.length <= keep) return ''

      const emit = pending.slice(0, pending.length - keep)
      pending = pending.slice(-keep)
      return unmaskText(emit, ctx)
    },
    flush(): string {
      const output = unmaskText(pending, ctx)
      pending = ''
      return output
    }
  }
}

function maskMessages(messages: ChatMessage[], context: SecretMaskContext): ChatMessage[] {
  if (context.bindings.length === 0) return messages
  return messages.map((message) => ({
    ...message,
    content: maskText(message.content, context)
  }))
}

function registerFinding(context: SecretMaskContext, finding: SecretFinding): void {
  const value = normalizeSecretValue(finding.secret || finding.match || '')
  if (!value || value.length < 8) return
  if (containsSecretPlaceholder(value)) return

  const existing = context.byValue.get(value)
  if (existing) return

  const kind = kindFromLabel(finding.ruleId || finding.description || 'secret')
  const placeholder = `${SECRET_PLACEHOLDER_PREFIX}${context.bindings.length + 1}_${kind}]]`
  const binding = { placeholder, value, kind }
  context.bindings.push(binding)
  context.byValue.set(value, binding)
  context.byPlaceholder.set(placeholder, binding)
}

function normalizeSecretValue(value: string): string {
  return value.trim().replace(/^["']|["']$/g, '')
}

function sortedBindings(context: SecretMaskContext): SecretBinding[] {
  return [...context.bindings].sort((a, b) => b.value.length - a.value.length)
}

function kindFromLabel(label: string): string {
  const normalized = label
    .replace(/^taviraq-/i, '')
    .replace(/^gitleaks-/i, '')
    .replace(/[^a-z0-9]+/gi, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase()

  return normalized || 'SECRET'
}

function looksHighEntropy(value: string): boolean {
  if (value.length < 24) return false
  if (isLikelyFilesystemPath(value)) return false
  if (GIT_SHA_RE.test(value)) return false
  if (/^[0-9a-f-]{32,}$/i.test(value) && !/[g-z]/i.test(value)) return false

  const hasUpper = /[A-Z]/.test(value)
  const hasLower = /[a-z]/.test(value)
  const hasDigit = /[0-9]/.test(value)
  const hasTokenPunctuation = /[._~+/=-]/.test(value)
  return hasDigit && ((hasUpper && hasLower) || hasTokenPunctuation)
}

function isLikelySafeToken(value: string): boolean {
  if (isLikelyFilesystemPath(value)) return true
  if (GIT_SHA_RE.test(value)) return true
  if (/^[0-9]+$/.test(value)) return true
  return false
}

function isLikelyFilesystemPath(value: string): boolean {
  return /^(?:\/|~|\.{1,2}[/\\]|[A-Za-z]:[\\/]|\\\\)/.test(value)
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function normalizeSecretMaskingInput(input: SecretMaskingInput): SecretMaskingSettings {
  if (typeof input === 'string') {
    return {
      ...createDefaultSecretMaskingSettings(),
      mode: input
    }
  }

  return {
    ...createDefaultSecretMaskingSettings(),
    ...input,
    mode: input.mode === 'off' ? 'off' : 'on',
    applyToChatDisplay: input.applyToChatDisplay !== false,
    applyToProviderPayloads: input.applyToProviderPayloads !== false,
    strictTerminalContext: input.strictTerminalContext === true,
    customPatterns: Array.isArray(input.customPatterns) ? input.customPatterns : []
  }
}

async function runGitleaks(input: string, signal?: AbortSignal): Promise<SecretFinding[]> {
  const binaryPath = await resolveGitleaksBinaryPath()
  if (!binaryPath) {
    throw new Error(GITLEAKS_UNAVAILABLE_MESSAGE)
  }

  const output = await runGitleaksProcess(binaryPath, input, signal)
  try {
    return parseGitleaksReport(output)
  } catch (error) {
    throw new Error(`Gitleaks secret scanner returned an unreadable report: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function resolveGitleaksBinaryPath(): Promise<string | undefined> {
  const executableName = process.platform === 'win32' ? 'gitleaks.exe' : 'gitleaks'
  const platformArch = `${process.platform}-${process.arch}`
  const resourcesPath = (process as ProcessWithResourcesPath).resourcesPath
  const candidates = [
    process.env.TAVIRAQ_GITLEAKS_PATH,
    resourcesPath ? join(resourcesPath, 'gitleaks', platformArch, executableName) : undefined,
    join(process.cwd(), 'resources', 'gitleaks', platformArch, executableName)
  ].filter(Boolean) as string[]

  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK)
      return candidate
    } catch {
      // Try the next candidate.
    }
  }

  return undefined
}

function runGitleaksProcess(binaryPath: string, input: string, signal?: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Secret scanning cancelled.'))
      return
    }

    const child = spawn(binaryPath, [
      'stdin',
      '--report-format', 'json',
      '--report-path', '-',
      '--no-banner',
      '--no-color',
      '--exit-code', '0',
      '--log-level', 'error',
      '--timeout', String(Math.ceil(GITLEAKS_TIMEOUT_MS / 1000))
    ], {
      stdio: ['pipe', 'pipe', 'pipe']
    })

    let stdout = ''
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error('Secret scanning timed out; request was not sent.'))
    }, GITLEAKS_TIMEOUT_MS + 500)

    const abort = (): void => {
      child.kill('SIGTERM')
      finish(new Error('Secret scanning cancelled.'))
    }

    const finish = (error?: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      signal?.removeEventListener('abort', abort)
      if (error) {
        reject(error)
      } else {
        resolve(stdout)
      }
    }

    signal?.addEventListener('abort', abort, { once: true })

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => { stdout += chunk })
    child.stderr.on('data', (chunk: string) => { stderr += chunk })
    child.on('error', (error) => finish(error))
    child.on('close', (code) => {
      if (code && code !== 0) {
        finish(new Error(`Gitleaks secret scanner failed with exit code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ''}`))
        return
      }
      finish()
    })

    child.stdin.end(input)
  })
}

function isGitleaksUnavailableError(error: unknown): boolean {
  return error instanceof Error && error.message === GITLEAKS_UNAVAILABLE_MESSAGE
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

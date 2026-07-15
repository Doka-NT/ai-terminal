// SPDX-License-Identifier: MPL-2.0
import type {
  ChatMessage,
  ChatStreamEvent,
  ChatStreamRequest,
  CommandRiskAssessment,
  CommandRiskAssessmentRequest,
  CommandRiskLevel,
  GeneratedPrompt,
  LLMModel,
  LLMProviderConfig,
  McpServerConfig,
  SummarizeConversationRequest
} from '@shared/types'
import { randomUUID } from 'node:crypto'
import { Agent, ProxyAgent, type Dispatcher } from 'undici'
import {
  buildAnthropicUrl,
  buildLmStudioNativeUrl,
  buildOllamaNativeUrl,
  buildProviderUrl,
  getProviderType,
  inferModelSupportsMcp,
  parseAnthropicModelList,
  parseLmStudioNativeModelList,
  parseModelList,
  parseOllamaNativeModelList,
  PROVIDER_DEFAULTS
} from '@main/utils/provider'
import type { CapabilityRegistry, MaskingRuleProvider, SafetyPolicyContribution } from '@main/capabilities'
import { assessProtectedCommandRisk, mergeSafetyAssessments } from '@main/utils/commandRisk'
import { buildAssistantPromptMessages, LANGUAGE_NAMES, mergeAssistantPromptMessages } from '@shared/promptBuilder'
import { parseAnthropicStreamEvent, parseChatCompletionChunk, parseSseEvents, parseSseLines } from '@main/utils/llmProtocol'
import { normalizeHttpProxyUrl } from '@main/utils/proxy'
import {
  addSecretFindingsToContext,
  createStreamingPlaceholderRedactor,
  maskChatStreamRequest,
  maskCommandRiskAssessmentRequest,
  maskSummarizeConversationRequest,
  maskText,
  scanTextForSecrets,
  type SecretMaskContext,
  type SecretMaskingInput
} from '@main/utils/secretMasking'
import { getApiKey, getProxyPassword } from './secretStore'
import { callMcpTool, getEnabledMcpTools, type McpRuntimeTool } from './mcpRuntime'
import { stripAnsi } from '@shared/terminalText'

const COMMAND_RISK_TIMEOUT_MS = 15_000
const ANTHROPIC_API_VERSION = '2023-06-01'
const ANTHROPIC_MAX_TOKENS = 4096
const ANTHROPIC_MODEL_PAGE_LIMIT = 1000
const MAX_PROXY_AGENTS = 16
const MCP_TOOL_RESULT_INSTRUCTION = [
  'MCP tools may return raw JSON, arrays, logs, or other machine-oriented payloads.',
  'Use MCP tool results as evidence to answer the user directly and concisely.',
  'Do not paste raw JSON, full arrays, or unformatted tool payloads unless the user explicitly asks for raw output.',
  'When the user asks about a specific date, status, file, command, or fact, extract only the relevant answer.'
].join(' ')
const insecureTlsAgent = new Agent({ connect: { rejectUnauthorized: false } })
const proxyAgents = new Map<string, ProxyAgent>()

type ProviderRequestInit = RequestInit & {
  dispatcher?: Dispatcher
}

type ParsedMcpToolArgs =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string }

export interface ProviderCredentialOverrides {
  apiKey?: string
  proxyPassword?: string
}

export async function listModels(provider: LLMProviderConfig, credentialOverrides?: ProviderCredentialOverrides): Promise<LLMModel[]> {
  const providerType = getProviderType(provider)
  if (providerType === 'anthropic') {
    return listAnthropicModels(provider, credentialOverrides)
  }

  const url = providerType === 'lmstudio'
    ? buildLmStudioNativeUrl(provider.baseUrl || PROVIDER_DEFAULTS.lmstudio.baseUrl, 'models')
    : providerType === 'ollama'
      ? buildOllamaNativeUrl(provider.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl, 'tags')
      : buildProviderUrl(provider, 'models')
  const response = await fetchProvider(url, await withProviderTransport(provider, {
    headers: await buildHeaders(provider, credentialOverrides?.apiKey)
  }, credentialOverrides), 'Model')

  if (!response.ok) {
    throw new Error(`Model request failed with ${response.status} ${response.statusText}`)
  }

  const payload = await response.json() as unknown
  if (providerType === 'lmstudio') return parseLmStudioNativeModelList(payload)
  if (providerType === 'ollama') return parseOllamaNativeModelList(payload)
  return parseModelList(payload)
}

async function listAnthropicModels(provider: LLMProviderConfig, credentialOverrides?: ProviderCredentialOverrides): Promise<LLMModel[]> {
  const modelsById = new Map<string, LLMModel>()
  let afterId: string | undefined

  while (true) {
    const url = buildAnthropicModelsPageUrl(provider, afterId)
    const response = await fetchProvider(url, await withProviderTransport(provider, {
      headers: await buildHeaders(provider, credentialOverrides?.apiKey)
    }, credentialOverrides), 'Model')

    if (!response.ok) {
      throw new Error(`Model request failed with ${response.status} ${response.statusText}`)
    }

    const payload = await response.json() as unknown
    for (const model of parseAnthropicModelList(payload)) {
      modelsById.set(model.id, model)
    }

    if (!readAnthropicHasMore(payload)) {
      return [...modelsById.values()].sort((a, b) => a.id.localeCompare(b.id))
    }

    afterId = readAnthropicLastId(payload)
    if (!afterId) {
      throw new Error('Anthropic model list response did not include last_id for the next page.')
    }
  }
}

type ChatStreamUpdate = Pick<ChatStreamEvent, 'type'> & {
  content?: string
  reasoningContent?: string
  status?: 'running' | 'done' | 'error'
  serverName?: string
  toolName?: string
  toolCallId?: string
  maskedSecrets?: number
  categories?: string[]
  stage?: 'model_load' | 'prompt_processing'
  progress?: number
}

export interface ChatStreamCompletionResult {
  maskedContent: string
  maskedSecretCount: number
  secretContext: SecretMaskContext
}

export async function streamChatCompletion(
  request: ChatStreamRequest,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  secretMaskingMode: SecretMaskingInput = 'on',
  existingSecretContext?: SecretMaskContext,
  mcpServers: McpServerConfig[] = [],
  capabilityRegistry?: CapabilityRegistry
): Promise<ChatStreamCompletionResult> {
  const maskingProviders = capabilityRegistry?.get('masking-rule') ?? []
  const masked = await maskChatStreamRequest(
    request,
    secretMaskingMode,
    signal,
    existingSecretContext,
    maskingProviders
  )
  const contentRedactor = createStreamingPlaceholderRedactor()
  const reasoningRedactor = createStreamingPlaceholderRedactor()
  let maskedContent = ''

  if (masked.context.bindings.length > 0) {
    onChunk({
      type: 'privacy',
      maskedSecrets: masked.context.bindings.length,
      categories: [...new Set(masked.context.bindings.map((binding) => binding.kind))]
    })
  }

  await streamChatCompletionUnsafe(masked.request, (chunk) => {
    if (chunk.type === 'progress' || chunk.type === 'privacy') {
      onChunk(chunk)
      return
    }

    if (chunk.type === 'tool') {
      onChunk(chunk)
      return
    }

    if (chunk.reasoningContent) {
      const content = reasoningRedactor.push(chunk.reasoningContent)
      if (content) onChunk({ type: 'reasoning', reasoningContent: content })
    }

    if (chunk.content) {
      maskedContent += chunk.content
      const content = contentRedactor.push(chunk.content)
      if (content) onChunk({ type: 'chunk', content })
    }
  }, signal, mcpServers, secretMaskingMode, masked.context, maskingProviders)

  const finalReasoning = reasoningRedactor.flush()
  if (finalReasoning) onChunk({ type: 'reasoning', reasoningContent: finalReasoning })

  const finalContent = contentRedactor.flush()
  if (finalContent) onChunk({ type: 'chunk', content: finalContent })

  return {
    maskedContent,
    maskedSecretCount: masked.context.bindings.length,
    secretContext: masked.context
  }
}

async function streamChatCompletionUnsafe(
  request: ChatStreamRequest,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  mcpServers: McpServerConfig[] = [],
  secretMaskingMode: SecretMaskingInput = 'on',
  secretContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<void> {
  const model = request.provider.selectedModel?.trim()
  if (!model) {
    throw new Error('Select a model before sending a message.')
  }

  const providerType = getProviderType(request.provider)
  const mcpTools = getEnabledMcpTools(mcpServers)

  if (mcpTools.length > 0 && (providerType === 'openai' || providerType === 'anthropic') && inferModelSupportsMcp(model) !== false) {
    return completeChatWithMcpTools(request, model, mcpTools, onChunk, signal, secretMaskingMode, secretContext, maskingProviders)
  }

  if (providerType === 'lmstudio') {
    return streamLmStudioNativeChatCompletion(request, model, onChunk, signal)
  }

  if (providerType === 'ollama') {
    return streamOllamaNativeChatCompletion(request, model, onChunk, signal)
  }

  if (providerType === 'anthropic') {
    return streamAnthropicChatCompletion(request, model, onChunk, signal)
  }

  const url = buildProviderUrl(request.provider, 'chat/completions')
  const response = await fetchProvider(url, await withProviderTransport(request.provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(request.provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: buildMessages(request.messages, request.context)
    }),
    signal
  }))

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('Chat response did not include a readable stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseLines(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      if (event === '[DONE]') {
        return
      }

      const chunk = parseChatCompletionChunk(JSON.parse(event) as unknown)
      if (chunk?.content || chunk?.reasoningContent) {
        onChunk({ type: chunk.content ? 'chunk' : 'reasoning', ...chunk })
      }
    }
  }

  buffer += decoder.decode()
  for (const event of parseFinalSseLines(buffer)) {
    if (event === '[DONE]') {
      return
    }

    const payload = safeParseJson(event)
    if (!payload) continue

    const chunk = parseChatCompletionChunk(payload)
    if (chunk?.content || chunk?.reasoningContent) {
      onChunk({ type: chunk.content ? 'chunk' : 'reasoning', ...chunk })
    }
  }
}

type OpenAIMessage = ChatMessage | {
  role: 'assistant'
  content: string | null
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: unknown } }>
} | {
  role: 'tool'
  tool_call_id: string
  content: string
}

async function completeChatWithMcpTools(
  request: ChatStreamRequest,
  model: string,
  mcpTools: McpRuntimeTool[],
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  secretMaskingMode: SecretMaskingInput = 'on',
  secretContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<void> {
  if (getProviderType(request.provider) === 'anthropic') {
    return completeAnthropicWithMcpTools(request, model, mcpTools, onChunk, signal, secretMaskingMode, secretContext, maskingProviders)
  }
  return completeOpenAIWithMcpTools(request, model, mcpTools, onChunk, signal, secretMaskingMode, secretContext, maskingProviders)
}

async function completeOpenAIWithMcpTools(
  request: ChatStreamRequest,
  model: string,
  mcpTools: McpRuntimeTool[],
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  secretMaskingMode: SecretMaskingInput = 'on',
  secretContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<void> {
  const toolMap = buildMcpToolNameMap(mcpTools)
  const messages: OpenAIMessage[] = buildMessages(request.messages, request.context)
  messages.unshift({ role: 'system', content: MCP_TOOL_RESULT_INSTRUCTION })
  const tools = [...toolMap.entries()].map(([name, entry]) => ({
    type: 'function',
    function: {
      name,
      description: entry.tool.description ?? `${entry.server.name}: ${entry.tool.name}`,
      parameters: normalizeJsonSchema(entry.tool.inputSchema)
    }
  }))

  for (let i = 0; i < 5; i += 1) {
    const response = await fetchProvider(buildProviderUrl(request.provider, 'chat/completions'), await withProviderTransport(request.provider, {
      method: 'POST',
      headers: {
        ...await buildHeaders(request.provider),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, stream: false, messages, tools, tool_choice: 'auto' }),
      signal
    }))
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
    }
    const payload = await response.json() as unknown
    const message = readOpenAIMessage(payload)
    if (!message) return
    const toolCalls = message.tool_calls ?? []
    if (toolCalls.length === 0) {
      if (message.content) onChunk({ type: 'chunk', content: message.content })
      return
    }
    messages.push({ role: 'assistant', content: message.content ?? null, tool_calls: toolCalls })
    for (const call of toolCalls) {
      const entry = toolMap.get(call.function.name)
      const parsedArgs = parseMcpToolArgs(call.function.arguments)
      const content = entry && parsedArgs.ok
        ? await callMcpToolWithTrace(entry, parsedArgs.args, call.id, onChunk, secretMaskingMode, secretContext, maskingProviders, signal)
        : parsedArgs.ok
          ? `Unknown MCP tool: ${call.function.name}`
          : reportMcpToolArgumentError(entry, call.function.name, call.id, parsedArgs.error, onChunk)
      messages.push({ role: 'tool', tool_call_id: call.id, content: formatMcpToolResultForModel(content) })
    }
  }
  onChunk({ type: 'chunk', content: 'MCP tool loop reached the maximum number of tool calls.' })
}

async function completeAnthropicWithMcpTools(
  request: ChatStreamRequest,
  model: string,
  mcpTools: McpRuntimeTool[],
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  secretMaskingMode: SecretMaskingInput = 'on',
  secretContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<void> {
  const toolMap = buildMcpToolNameMap(mcpTools)
  const input = buildAnthropicMessageInput(buildMessages(request.messages, request.context))
  const messages: Array<{ role: 'user' | 'assistant'; content: unknown }> = input.messages
  const system = [input.system, MCP_TOOL_RESULT_INSTRUCTION].filter(Boolean).join('\n\n')
  const tools = [...toolMap.entries()].map(([name, entry]) => ({
    name,
    description: entry.tool.description ?? `${entry.server.name}: ${entry.tool.name}`,
    input_schema: normalizeJsonSchema(entry.tool.inputSchema)
  }))

  for (let i = 0; i < 5; i += 1) {
    const response = await fetchProvider(buildAnthropicUrl(request.provider.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl, 'messages'), await withProviderTransport(request.provider, {
      method: 'POST',
      headers: {
        ...await buildHeaders(request.provider),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ model, max_tokens: ANTHROPIC_MAX_TOKENS, stream: false, ...(system ? { system } : {}), messages, tools }),
      signal
    }), 'Anthropic chat')
    if (!response.ok) {
      const body = await response.text().catch(() => '')
      throw new Error(`Anthropic chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
    }
    const payload = await response.json() as unknown
    const content = readAnthropicContentBlocks(payload)
    const toolUses = content.filter((part) => isRecord(part) && part.type === 'tool_use') as Array<Record<string, unknown>>
    if (toolUses.length === 0) {
      const text = content.map(readAnthropicTextBlock).join('')
      if (text) onChunk({ type: 'chunk', content: text })
      return
    }
    messages.push({ role: 'assistant', content })
    const toolResults = []
    for (const use of toolUses) {
      const id = typeof use.id === 'string' ? use.id : ''
      const name = typeof use.name === 'string' ? use.name : ''
      const entry = toolMap.get(name)
      const input = use.input
      const text = entry && isRecord(input)
        ? await callMcpToolWithTrace(entry, input, id, onChunk, secretMaskingMode, secretContext, maskingProviders, signal)
        : isRecord(input)
          ? `Unknown MCP tool: ${name}`
          : reportMcpToolArgumentError(entry, name, id, 'Invalid MCP tool arguments: expected an object.', onChunk)
      toolResults.push({ type: 'tool_result', tool_use_id: id, content: formatMcpToolResultForModel(text) })
    }
    messages.push({ role: 'user', content: toolResults })
  }
  onChunk({ type: 'chunk', content: 'MCP tool loop reached the maximum number of tool calls.' })
}

async function callMcpToolWithTrace(
  entry: McpRuntimeTool,
  args: Record<string, unknown>,
  toolCallId: string,
  onChunk: (chunk: ChatStreamUpdate) => void,
  secretMaskingMode: SecretMaskingInput,
  secretContext?: SecretMaskContext,
  maskingProviders: readonly MaskingRuleProvider[] = [],
  signal?: AbortSignal
): Promise<string> {
  onChunk({ type: 'tool', status: 'running', serverName: entry.server.name, toolName: entry.tool.name, toolCallId })
  try {
    const content = await callMcpTool(entry.server, entry.tool.name, args, signal)
    const maskedContent = await maskMcpToolContent(content, secretMaskingMode, secretContext, onChunk, signal, maskingProviders)
    onChunk({ type: 'tool', status: 'done', serverName: entry.server.name, toolName: entry.tool.name, toolCallId, content: maskedContent })
    return maskedContent
  } catch (error) {
    const rawMessage = error instanceof Error ? error.message : String(error)
    const message = await maskMcpToolContent(rawMessage, secretMaskingMode, secretContext, onChunk, signal, maskingProviders)
    onChunk({ type: 'tool', status: 'error', serverName: entry.server.name, toolName: entry.tool.name, toolCallId, content: message })
    const maskedError = new Error(message)
    maskedError.name = error instanceof Error ? error.name : 'Error'
    throw maskedError
  }
}

async function maskMcpToolContent(
  content: string,
  secretMaskingMode: SecretMaskingInput,
  secretContext: SecretMaskContext | undefined,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal,
  maskingProviders: readonly MaskingRuleProvider[] = []
): Promise<string> {
  if (!secretContext) return content
  const previousCount = secretContext.bindings.length
  const findings = await scanTextForSecrets(content, secretMaskingMode, signal, maskingProviders)
  addSecretFindingsToContext(secretContext, findings)
  if (secretContext.bindings.length > previousCount) {
    const newBindings = secretContext.bindings.slice(previousCount)
    onChunk({
      type: 'privacy',
      maskedSecrets: secretContext.bindings.length,
      categories: [...new Set(newBindings.map((binding) => binding.kind))]
    })
  }
  return maskText(content, secretContext)
}

function reportMcpToolArgumentError(
  entry: McpRuntimeTool | undefined,
  fallbackName: string,
  toolCallId: string,
  error: string,
  onChunk: (chunk: ChatStreamUpdate) => void
): string {
  onChunk({
    type: 'tool',
    status: 'error',
    serverName: entry?.server.name ?? 'MCP',
    toolName: entry?.tool.name ?? fallbackName,
    toolCallId,
    content: error
  })
  return error
}

function formatMcpToolResultForModel(content: string): string {
  return [
    MCP_TOOL_RESULT_INSTRUCTION,
    'Tool result:',
    content
  ].join('\n\n')
}

async function streamAnthropicChatCompletion(
  request: ChatStreamRequest,
  model: string,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = buildAnthropicUrl(request.provider.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl, 'messages')
  const response = await fetchProvider(url, await withProviderTransport(request.provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(request.provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      stream: true,
      ...buildAnthropicMessageInput(buildMessages(request.messages, request.context))
    }),
    signal
  }), 'Anthropic chat')

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Anthropic chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('Anthropic chat response did not include a readable stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseEvents(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      if (event.event === 'message_stop') {
        return
      }

      const chunk = parseAnthropicStreamEvent(event)
      if (chunk?.content) {
        onChunk({ type: 'chunk', content: chunk.content })
      }
    }
  }

  buffer += decoder.decode()
  for (const event of parseFinalSseEvents(buffer)) {
    if (event.event === 'message_stop') {
      return
    }

    const chunk = parseAnthropicStreamEvent(event)
    if (chunk?.content) {
      onChunk({ type: 'chunk', content: chunk.content })
    }
  }
}

async function streamOllamaNativeChatCompletion(
  request: ChatStreamRequest,
  model: string,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = buildOllamaNativeUrl(request.provider.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl, 'chat')
  const response = await fetchProvider(url, await withProviderTransport(request.provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(request.provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: buildMessages(request.messages, request.context)
    }),
    signal
  }))

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Ollama chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('Ollama chat response did not include a readable stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''

    for (const line of lines) {
      const payload = safeParseJson(line.trim())
      if (!payload) continue

      const content = readOllamaMessageText(payload, 'content')
      const reasoningContent = readOllamaMessageText(payload, 'thinking')
      if (reasoningContent) onChunk({ type: 'reasoning', reasoningContent })
      if (content) onChunk({ type: 'chunk', content })
    }
  }

  buffer += decoder.decode()
  const payload = safeParseJson(buffer.trim())
  if (payload) {
    const content = readOllamaMessageText(payload, 'content')
    const reasoningContent = readOllamaMessageText(payload, 'thinking')
    if (reasoningContent) onChunk({ type: 'reasoning', reasoningContent })
    if (content) onChunk({ type: 'chunk', content })
  }
}

async function streamLmStudioNativeChatCompletion(
  request: ChatStreamRequest,
  model: string,
  onChunk: (chunk: ChatStreamUpdate) => void,
  signal?: AbortSignal
): Promise<void> {
  const url = buildLmStudioNativeUrl(request.provider.baseUrl || PROVIDER_DEFAULTS.lmstudio.baseUrl, 'chat')
  const response = await fetchProvider(url, await withProviderTransport(request.provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(request.provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: true,
      store: false,
      ...buildLmStudioNativeInput(request.messages, request.context)
    }),
    signal
  }))

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`LM Studio chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  if (!response.body) {
    throw new Error('LM Studio chat response did not include a readable stream.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const parsed = parseSseEvents(buffer)
    buffer = parsed.remainder

    for (const event of parsed.events) {
      processLmStudioStreamEvent(event, onChunk)
    }
  }

  buffer += decoder.decode()
  for (const event of parseFinalSseEvents(buffer)) {
    processLmStudioStreamEvent(event, onChunk)
  }
}

function processLmStudioStreamEvent(
  event: { event?: string; data: string },
  onChunk: (chunk: ChatStreamUpdate) => void
): void {
  const payload = safeParseJson(event.data)
  const eventType = typeof payload?.type === 'string' ? payload.type : event.event

  if (eventType === 'message.delta') {
    const content = readString(payload, 'content')
    if (content) onChunk({ type: 'chunk', content })
  } else if (eventType === 'reasoning.delta') {
    const reasoningContent = readString(payload, 'content')
    if (reasoningContent) onChunk({ type: 'reasoning', reasoningContent })
  } else if (eventType === 'prompt_processing.start') {
    onChunk({ type: 'progress', stage: 'prompt_processing', progress: 0 })
  } else if (eventType === 'prompt_processing.progress') {
    onChunk({ type: 'progress', stage: 'prompt_processing', progress: readProgress(payload) })
  } else if (eventType === 'prompt_processing.end') {
    onChunk({ type: 'progress', stage: 'prompt_processing', progress: 1 })
  } else if (eventType === 'model_load.start') {
    onChunk({ type: 'progress', stage: 'model_load', progress: 0 })
  } else if (eventType === 'model_load.progress') {
    onChunk({ type: 'progress', stage: 'model_load', progress: readProgress(payload) })
  } else if (eventType === 'model_load.end') {
    onChunk({ type: 'progress', stage: 'model_load', progress: 1 })
  } else if (eventType === 'error') {
    throw new Error(readLmStudioError(payload))
  }
}

function parseFinalSseLines(buffer: string): string[] {
  if (!buffer.trim()) return []
  return parseSseLines(`${buffer}\n\n`).events
}

function parseFinalSseEvents(buffer: string): Array<{ event?: string; data: string }> {
  if (!buffer.trim()) return []
  return parseSseEvents(`${buffer}\n\n`).events
}

export async function assessCommandRisk(
  request: CommandRiskAssessmentRequest,
  secretMaskingMode: SecretMaskingInput = 'on',
  existingSecretContext?: SecretMaskContext,
  onMaskedContext?: (context: SecretMaskContext) => void | Promise<void>,
  capabilityRegistry?: CapabilityRegistry
): Promise<CommandRiskAssessment> {
  const masked = await maskCommandRiskAssessmentRequest(
    request,
    secretMaskingMode,
    undefined,
    existingSecretContext,
    capabilityRegistry?.get('masking-rule') ?? []
  )
  if (masked.context.bindings.length > 0) {
    await onMaskedContext?.(masked.context)
  }
  const safeRequest = masked.request
  const protectedAssessment = assessProtectedCommandRisk(safeRequest)
  const safetyContributions = collectSafetyPolicyContributions(capabilityRegistry, safeRequest)
  const mergedAssessment = mergeSafetyAssessments(protectedAssessment, safetyContributions)
  if (mergedAssessment) return mergedAssessment

  const model = safeRequest.provider.commandRiskModel?.trim()
  if (!model) {
    throw new Error('Select a command safety model before checking command safety.')
  }

  if (getProviderType(safeRequest.provider) === 'ollama') {
    const response = await postOllamaNativeChat(
      safeRequest.provider,
      model,
      buildCommandRiskMessages(safeRequest),
      { options: { temperature: 0 }, timeoutMs: COMMAND_RISK_TIMEOUT_MS }
    )

    return parseCommandRiskAssessment(extractOllamaMessageContent(response))
  }

  if (getProviderType(safeRequest.provider) === 'anthropic') {
    const response = await postAnthropicMessage(
      safeRequest.provider,
      model,
      buildCommandRiskMessages(safeRequest),
      { temperature: 0, timeoutMs: COMMAND_RISK_TIMEOUT_MS }
    )

    return parseCommandRiskAssessment(extractAnthropicMessageContent(response))
  }

  const response = await fetchWithTimeout(
    buildProviderUrl(safeRequest.provider, 'chat/completions'),
    await withProviderTransport(safeRequest.provider, {
      method: 'POST',
      headers: {
        ...await buildHeaders(safeRequest.provider),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        messages: buildCommandRiskMessages(safeRequest)
      })
    }),
    COMMAND_RISK_TIMEOUT_MS,
    'Command safety check timed out, so the command is treated as risky.'
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Command safety request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  return parseCommandRiskAssessment(extractMessageContent(await response.json()))
}

function collectSafetyPolicyContributions(
  registry: CapabilityRegistry | undefined,
  request: Pick<CommandRiskAssessmentRequest, 'command' | 'context'>
): SafetyPolicyContribution[] {
  if (!registry) return []

  return registry.get('safety-policy').flatMap((provider) => {
    try {
      const contribution = provider.evaluate(request)
      return contribution ? [contribution] : []
    } catch (error) {
      console.warn(`[capabilities] safety-policy provider "${provider.id}" failed`, error)
      return []
    }
  })
}

export async function summarizeConversation(
  request: SummarizeConversationRequest,
  signal?: AbortSignal,
  secretMaskingMode: SecretMaskingInput = 'on',
  onMaskedContext?: (context: SecretMaskContext) => void,
  capabilityRegistry?: CapabilityRegistry
): Promise<GeneratedPrompt> {
  const masked = await maskSummarizeConversationRequest(
    request,
    secretMaskingMode,
    signal,
    undefined,
    capabilityRegistry?.get('masking-rule') ?? []
  )
  if (masked.context.bindings.length > 0) {
    onMaskedContext?.(masked.context)
  }
  const safeRequest = masked.request
  const model = safeRequest.provider.selectedModel?.trim()
  if (!model) {
    throw new Error('No model selected.')
  }

  const languageName = safeRequest.language ? LANGUAGE_NAMES[safeRequest.language] : undefined
  const langInstruction = languageName ? ` Write the prompt in ${languageName}.` : ''

  const conversation = safeRequest.messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
    .join('\n\n')

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: [
        'You are a prompt engineer.',
        'Given a conversation, create a concise reusable user prompt and a short descriptive title for it.',
        'The generated prompt will be inserted into the chat input and sent as a normal user message, not as a system/developer instruction.',
        'Write the prompt so it asks the assistant to do the task now: start with a clear action verb, preserve the user intent, include only the necessary constraints, and avoid persona/setup language such as "You are...".',
        'For terminal assistant workflows, prefer prompts that ask the assistant to inspect, diagnose, explain, fix, or propose commands/results instead of merely acknowledging instructions.',
        masked.context.bindings.length > 0
          ? 'Some values were replaced with opaque local secret placeholders. Do not include those placeholders or their real values in the generated reusable prompt.'
          : undefined,
        `${langInstruction} Return only valid JSON with exactly this shape: {"name":"Prompt title","content":"Prompt text"}. Do not include explanations, headings, quotes around the JSON, or Markdown fences.`
      ].filter(Boolean).join(' ')
    },
    {
      role: 'user',
      content: `Conversation:\n\n${conversation}`
    }
  ]

  let response: Response
  try {
    if (getProviderType(safeRequest.provider) === 'ollama') {
      const payload = await postOllamaNativeChat(
        safeRequest.provider,
        model,
        messages,
        { options: { temperature: 0.3 }, signal }
      )
      const content = extractOllamaMessageContent(payload)
      if (!content.trim()) throw new Error('Empty response from model.')
      return parseGeneratedPrompt(content)
    }

    if (getProviderType(safeRequest.provider) === 'anthropic') {
      const payload = await postAnthropicMessage(
        safeRequest.provider,
        model,
        messages,
        { temperature: 0.3, signal }
      )
      const content = extractAnthropicMessageContent(payload)
      if (!content.trim()) throw new Error('Empty response from model.')
      return parseGeneratedPrompt(content)
    }

    response = await postOpenAICompatibleChatCompletion(
      safeRequest.provider,
      { model, stream: false, temperature: 0.3, messages },
      signal
    )
  } catch (error) {
    if (signal?.aborted) {
      throw new Error('Prompt generation cancelled.')
    }
    throw error
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Summarization request failed with ${response.status}${body ? `: ${body}` : ''}`)
  }

  const content = extractMessageContent(await response.json())
  if (!content.trim()) throw new Error('Empty response from model.')
  return parseGeneratedPrompt(content)
}

async function postOpenAICompatibleChatCompletion(
  provider: LLMProviderConfig,
  body: {
    model: string
    stream: false
    temperature?: number
    messages: ChatMessage[]
  },
  signal?: AbortSignal
): Promise<Response> {
  const url = buildProviderUrl(provider, 'chat/completions')
  const headers = {
    ...await buildHeaders(provider),
    'Content-Type': 'application/json'
  }

  const response = await fetchProvider(url, await withProviderTransport(provider, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal
  }))

  if (body.temperature === undefined || response.ok) return response

  const errorBody = await response.text().catch(() => '')
  if (!isUnsupportedTemperatureError(errorBody)) {
    throw new Error(`Summarization request failed with ${response.status}${errorBody ? `: ${errorBody}` : ''}`)
  }

  const defaultTemperatureBody = { ...body }
  delete defaultTemperatureBody.temperature
  return fetchProvider(url, await withProviderTransport(provider, {
    method: 'POST',
    headers,
    body: JSON.stringify(defaultTemperatureBody),
    signal
  }))
}

function isUnsupportedTemperatureError(body: string): boolean {
  return /temperature/i.test(body) && /unsupported|not support|does not support|only the default/i.test(body)
}

function parseGeneratedPrompt(content: string): GeneratedPrompt {
  const trimmed = content.trim()
  const jsonText = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    const parsed = JSON.parse(jsonText) as Partial<GeneratedPrompt>
    const promptContent = typeof parsed.content === 'string' ? parsed.content.trim() : ''
    const name = typeof parsed.name === 'string' ? parsed.name.trim() : ''

    if (promptContent) {
      return {
        name: name || fallbackPromptName(promptContent),
        content: promptContent
      }
    }
  } catch {
    // Fall through to preserve the generated prompt text if the model ignored JSON.
  }

  return {
    name: fallbackPromptName(trimmed),
    content: trimmed
  }
}

function fallbackPromptName(content: string): string {
  const firstLine = content
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)

  if (!firstLine) return 'Generated prompt'

  return firstLine
    .replace(/^#+\s*/, '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .slice(0, 80)
}

async function fetchWithTimeout(
  url: string,
  init: ProviderRequestInit,
  timeoutMs: number,
  timeoutMessage: string
): Promise<Response> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    })
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(timeoutMessage)
    }

    throw error
  } finally {
    clearTimeout(timeout)
  }
}

async function fetchProvider(url: string, init: RequestInit, label = 'Provider'): Promise<Response> {
  try {
    return await fetch(url, init)
  } catch (error) {
    throw new Error(`${label} request to ${url} failed: ${formatFetchError(error)}`)
  }
}

async function withProviderTransport(
  provider: LLMProviderConfig,
  init: RequestInit,
  credentialOverrides?: ProviderCredentialOverrides
): Promise<ProviderRequestInit> {
  const proxyUrl = provider.proxyUrl?.trim()
  if (!proxyUrl) {
    if (!provider.allowInsecureTls) return init
    return {
      ...init,
      dispatcher: insecureTlsAgent
    }
  }

  return {
    ...init,
    dispatcher: await getProxyAgent(provider, proxyUrl, credentialOverrides?.proxyPassword)
  }
}

async function getProxyAgent(provider: LLMProviderConfig, proxyUrl: string, proxyPasswordOverride?: string): Promise<ProxyAgent> {
  const proxy = normalizeHttpProxyUrl(proxyUrl)
  const token = await buildProxyAuthToken(provider, proxyPasswordOverride)
  const cacheKey = [
    provider.apiKeyRef,
    proxy,
    provider.allowInsecureTls ? 'insecure-target-tls' : 'default-target-tls',
    token ?? ''
  ].join('\0')

  const cached = proxyAgents.get(cacheKey)
  if (cached) {
    proxyAgents.delete(cacheKey)
    proxyAgents.set(cacheKey, cached)
    return cached
  }

  const agent = new ProxyAgent({
    uri: proxy,
    ...(token ? { token } : {}),
    ...(provider.allowInsecureTls ? { requestTls: { rejectUnauthorized: false } } : {})
  })
  rememberProxyAgent(cacheKey, agent)
  return agent
}

function rememberProxyAgent(cacheKey: string, agent: ProxyAgent): void {
  proxyAgents.set(cacheKey, agent)
  if (proxyAgents.size <= MAX_PROXY_AGENTS) return

  const oldest = proxyAgents.entries().next().value
  if (!oldest) return

  const [oldestKey, oldestAgent] = oldest
  proxyAgents.delete(oldestKey)
  void oldestAgent.close().catch(() => undefined)
}

export function invalidateProviderProxyAgents(apiKeyRef: string): void {
  const cacheKeyPrefix = `${apiKeyRef}\0`
  for (const [cacheKey, agent] of proxyAgents) {
    if (!cacheKey.startsWith(cacheKeyPrefix)) continue
    proxyAgents.delete(cacheKey)
    void agent.close().catch(() => undefined)
  }
}

async function buildProxyAuthToken(provider: LLMProviderConfig, proxyPasswordOverride?: string): Promise<string | undefined> {
  const username = provider.proxyUsername?.trim()
  if (!username) return undefined

  const password = proxyPasswordOverride !== undefined
    ? proxyPasswordOverride
    : provider.proxyPasswordRef
      ? await getProxyPassword(provider.proxyPasswordRef)
      : undefined
  return `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}`
}

function buildAnthropicModelsPageUrl(provider: LLMProviderConfig, afterId: string | undefined): string {
  const url = new URL(buildAnthropicUrl(provider.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl, 'models'))
  url.searchParams.set('limit', String(ANTHROPIC_MODEL_PAGE_LIMIT))
  if (afterId) {
    url.searchParams.set('after_id', afterId)
  }

  return url.toString()
}

function readAnthropicHasMore(payload: unknown): boolean {
  if (!payload || typeof payload !== 'object') return false
  return (payload as { has_more?: unknown }).has_more === true
}

function readAnthropicLastId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const lastId = (payload as { last_id?: unknown }).last_id
  return typeof lastId === 'string' && lastId.trim() ? lastId : undefined
}

function formatFetchError(error: unknown): string {
  if (!(error instanceof Error)) return String(error)

  const cause = error.cause
  if (cause && typeof cause === 'object') {
    const code = (cause as { code?: unknown }).code
    const message = (cause as { message?: unknown }).message
    if (typeof code === 'string' && typeof message === 'string') {
      return `${error.message} (${code}: ${message})`
    }
    if (typeof message === 'string') {
      return `${error.message} (${message})`
    }
  }

  return error.message
}

async function postOllamaNativeChat(
  provider: LLMProviderConfig,
  model: string,
  messages: ChatMessage[],
  options?: {
    options?: Record<string, unknown>
    signal?: AbortSignal
    timeoutMs?: number
  }
): Promise<unknown> {
  const url = buildOllamaNativeUrl(provider.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl, 'chat')
  const init = await withProviderTransport(provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: false,
      messages,
      ...(options?.options ? { options: options.options } : {})
    }),
    signal: options?.signal
  })

  const response = options?.timeoutMs
    ? await fetchWithTimeout(url, init, options.timeoutMs, 'Command safety check timed out, so the command is treated as risky.')
    : await fetchProvider(url, init, 'Ollama chat')

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Ollama chat request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  return response.json() as Promise<unknown>
}

async function postAnthropicMessage(
  provider: LLMProviderConfig,
  model: string,
  messages: ChatMessage[],
  options?: {
    temperature?: number
    signal?: AbortSignal
    timeoutMs?: number
  }
): Promise<unknown> {
  const url = buildAnthropicUrl(provider.baseUrl || PROVIDER_DEFAULTS.anthropic.baseUrl, 'messages')
  const init = await withProviderTransport(provider, {
    method: 'POST',
    headers: {
      ...await buildHeaders(provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      max_tokens: ANTHROPIC_MAX_TOKENS,
      stream: false,
      ...(typeof options?.temperature === 'number' ? { temperature: options.temperature } : {}),
      ...buildAnthropicMessageInput(messages)
    }),
    signal: options?.signal
  })

  const response = options?.timeoutMs
    ? await fetchWithTimeout(url, init, options.timeoutMs, 'Command safety check timed out, so the command is treated as risky.')
    : await fetchProvider(url, init, 'Anthropic message')

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Anthropic message request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  return response.json() as Promise<unknown>
}

function buildLmStudioNativeInput(
  messages: ChatMessage[],
  context: ChatStreamRequest['context']
): { system_prompt: string; input: string } {
  const builtMessages = buildMessages(messages, context)
  const systemPrompt = builtMessages
    .filter((message) => message.role === 'system')
    .map((message) => message.content)
    .join('\n\n')

  const transcript = builtMessages
    .filter((message) => message.role !== 'system')
    .map((message) => `${message.role === 'assistant' ? 'Assistant' : 'User'}:\n${message.content}`)
    .join('\n\n')

  return {
    system_prompt: systemPrompt,
    input: transcript || messages.at(-1)?.content || ''
  }
}

function safeParseJson(data: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(data) as unknown
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

function readString(payload: Record<string, unknown> | undefined, key: string): string {
  const value = payload?.[key]
  return typeof value === 'string' ? value : ''
}

function readOllamaMessageText(payload: Record<string, unknown> | undefined, key: 'content' | 'thinking'): string {
  const message = payload?.message
  if (!message || typeof message !== 'object') return ''

  const value = (message as Record<string, unknown>)[key]
  return typeof value === 'string' ? value : ''
}

function extractOllamaMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  return readOllamaMessageText(payload as Record<string, unknown>, 'content')
}

function extractAnthropicMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''

  const content = (payload as { content?: unknown }).content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (!part || typeof part !== 'object') return ''
      const text = (part as { text?: unknown }).text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

function buildMcpToolNameMap(mcpTools: McpRuntimeTool[]): Map<string, McpRuntimeTool> {
  const names = new Map<string, McpRuntimeTool>()
  for (const entry of mcpTools) {
    const base = sanitizeToolName(`${entry.server.name}_${entry.tool.name}`) || sanitizeToolName(entry.tool.name)
    let name = base.slice(0, 64)
    let index = 2
    while (names.has(name)) {
      const suffix = `_${index}`
      name = `${base.slice(0, Math.max(1, 64 - suffix.length))}${suffix}`
      index += 1
    }
    names.set(name, entry)
  }
  return names
}

function sanitizeToolName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '') || 'mcp_tool'
}

function normalizeJsonSchema(schema: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!schema || Object.keys(schema).length === 0) return { type: 'object', properties: {} }
  return schema
}

function parseMcpToolArgs(value: unknown): ParsedMcpToolArgs {
  if (isRecord(value)) return { ok: true, args: value }
  if (typeof value !== 'string') {
    return { ok: false, error: 'Invalid MCP tool arguments: expected an object.' }
  }
  try {
    const parsed = JSON.parse(value) as unknown
    return isRecord(parsed)
      ? { ok: true, args: parsed }
      : { ok: false, error: 'Invalid MCP tool arguments: expected an object.' }
  } catch {
    return { ok: false, error: 'Invalid MCP tool arguments: malformed JSON.' }
  }
}

function readOpenAIMessage(payload: unknown): {
  content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: unknown } }>
} | undefined {
  if (!isRecord(payload) || !Array.isArray(payload.choices)) return undefined
  const first: unknown = payload.choices[0]
  if (!isRecord(first) || !isRecord(first.message)) return undefined
  const message = first.message
  const content = typeof message.content === 'string' ? message.content : undefined
  const toolCalls = Array.isArray(message.tool_calls)
    ? message.tool_calls.flatMap((call): Array<{ id: string; type: 'function'; function: { name: string; arguments: unknown } }> => {
      if (!isRecord(call) || !isRecord(call.function)) return []
      const id = typeof call.id === 'string' ? call.id : randomUUID()
      const name = typeof call.function.name === 'string' ? call.function.name : ''
      if (!name) return []
      return [{
        id,
        type: 'function',
        function: {
          name,
          arguments: call.function.arguments
        }
      }]
    })
    : []
  return { ...(content ? { content } : {}), ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}) }
}

function readAnthropicContentBlocks(payload: unknown): unknown[] {
  if (!isRecord(payload) || !Array.isArray(payload.content)) return []
  return payload.content
}

function readAnthropicTextBlock(part: unknown): string {
  if (!isRecord(part) || part.type !== 'text') return ''
  return typeof part.text === 'string' ? part.text : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function readProgress(payload: Record<string, unknown> | undefined): number {
  const value = payload?.progress
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(Math.max(value, 0), 1)
    : 0
}

function readLmStudioError(payload: Record<string, unknown> | undefined): string {
  const error = payload?.error
  if (error && typeof error === 'object') {
    const message = (error as { message?: unknown }).message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }

  const message = payload?.message
  return typeof message === 'string' && message.trim()
    ? message.trim()
    : 'LM Studio returned a streaming error.'
}

async function buildHeaders(provider: LLMProviderConfig, apiKeyOverride?: string): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...(provider.defaultHeaders ?? {})
  }

  const providerType = getProviderType(provider)
  if (providerType === 'anthropic') {
    headers['anthropic-version'] = headers['anthropic-version'] ?? ANTHROPIC_API_VERSION
  }

  const apiKey = apiKeyOverride?.trim() || await getApiKey(provider.apiKeyRef)
  if (apiKey) {
    if (providerType === 'anthropic') {
      headers['x-api-key'] = apiKey
    } else {
      headers.Authorization = `Bearer ${apiKey}`
    }
  }

  return headers
}

function buildAnthropicMessageInput(messages: ChatMessage[]): {
  system?: string
  messages: Array<{ role: 'user' | 'assistant'; content: string }>
} {
  const system = messages
    .filter((message) => message.role === 'system')
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join('\n\n')

  const anthropicMessages = messages
    .filter((message): message is ChatMessage & { role: 'user' | 'assistant' } => message.role !== 'system')
    .map((message) => ({
      role: message.role,
      content: message.content
    }))
    .filter((message) => message.content.trim())
    .reduce<Array<{ role: 'user' | 'assistant'; content: string }>>((acc, message) => {
      const previous = acc.at(-1)
      if (previous?.role === message.role) {
        previous.content = `${previous.content}\n\n${message.content}`
        return acc
      }

      acc.push(message)
      return acc
    }, [])

  return {
    ...(system ? { system } : {}),
    messages: anthropicMessages
  }
}

function buildCommandRiskMessages(request: CommandRiskAssessmentRequest): ChatMessage[] {
  const context = request.context
  const contextLines = [
    context.session ? `Active session: ${context.session.label} (${context.session.kind}).` : undefined,
    context.session?.cwd ? `Current directory: ${context.session.cwd}.` : undefined,
    context.session?.shell ? `Shell: ${context.session.shell}.` : undefined,
    context.terminalOutput ? `Recent terminal output:\n${stripAnsi(context.terminalOutput).slice(-3000)}` : undefined
  ].filter(Boolean).join('\n')

  const languageName = context.language ? LANGUAGE_NAMES[context.language] : undefined
  const reasonFormat = languageName
    ? `{"dangerous": boolean, "reason": string (MUST be written in ${languageName}), "riskLevel": "warning" | "danger"}`
    : `{"dangerous": boolean, "reason": string, "riskLevel": "warning" | "danger"}`

  return [
    {
      role: 'system',
      content: [
        'You are a shell command safety classifier.',
        'Analyze only the command and terminal context in this request.',
        `Return JSON only, with this exact shape: ${reasonFormat}.`,
        context.maskedSecretCount && context.maskedSecretCount > 0
          ? 'Secret placeholders like [[TAVIRAQ_SECRET_1_TOKEN]] represent local secrets. Mark dangerous true for commands that print, upload, echo, log, commit, or otherwise expose those placeholders.'
          : undefined,
        'Mark dangerous true for commands that can delete, overwrite, move, chmod/chown, install/uninstall, change config, expose secrets, modify remote systems, escalate privileges, kill processes, shutdown/reboot, perform destructive git/package operations, or otherwise cause persistent side effects.',
        'Mark dangerous true with riskLevel "warning" for read-only commands that inspect likely secret or credential locations such as .env files, .ssh keys, token files, kubeconfig, credentials files, /etc/shadow, or searches for passwords/API keys.',
        'Mark dangerous true with riskLevel "danger" for commands that upload, post, copy, or stream local files or command output to another host, including curl/wget uploads, scp, rsync, nc, ncat, or netcat.',
        'Mark dangerous false for clearly harmless inspection commands such as pwd, ls, git status, help/version commands, and cat/grep/find only when the target is not secret-like or sensitive.'
      ].filter(Boolean).join('\n')
    },
    {
      role: 'user',
      content: `${contextLines ? `${contextLines}\n\n` : ''}Command:\n\`\`\`sh\n${request.command}\n\`\`\``
    }
  ]
}

function extractMessageContent(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices)) return ''
  const [first] = choices as unknown[]
  if (!first || typeof first !== 'object') return ''
  const message = (first as { message?: unknown }).message
  if (!message || typeof message !== 'object') return ''
  const content = (message as { content?: unknown }).content
  return typeof content === 'string' ? content : ''
}

function parseCommandRiskAssessment(content: string): CommandRiskAssessment {
  try {
    const json = content.match(/\{[\s\S]*\}/)?.[0]
    if (!json) {
      throw new Error('missing JSON')
    }
    const parsed = JSON.parse(json) as { dangerous?: unknown; reason?: unknown; riskLevel?: unknown }
    const dangerous = parsed.dangerous === false || parsed.dangerous === 'false' ? false : true

    // When the LLM flags a command as dangerous, default to 'danger' so that
    // model-flagged destructive commands (kill, shutdown, etc.) receive the
    // same red countdown UI as hard-coded destructive patterns.
    const riskLevel = parseRiskLevel(parsed.riskLevel) ?? (dangerous ? 'danger' : undefined)

    return {
      dangerous,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : 'The safety classifier did not provide a reason.',
      ...(riskLevel ? { riskLevel } : {})
    }
  } catch {
    return {
      dangerous: true,
      reason: 'The safety classifier returned an unreadable response, so the command is treated as risky.',
      riskLevel: 'danger'
    }
  }
}

function parseRiskLevel(value: unknown): CommandRiskLevel | undefined {
  if (value === 'danger') return 'danger'
  if (value === 'warning') return 'warning'
  return undefined
}

function buildMessages(messages: ChatMessage[], context: ChatStreamRequest['context']): ChatMessage[] {
  const promptMessages = buildAssistantPromptMessages({
    ...context,
    terminalOutput: context.terminalOutput ? stripAnsi(context.terminalOutput) : undefined
  })

  return mergeAssistantPromptMessages(promptMessages, messages)
}

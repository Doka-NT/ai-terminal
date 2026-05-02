import type {
  ChatMessage,
  ChatStreamRequest,
  CommandRiskAssessment,
  CommandRiskAssessmentRequest,
  LLMModel,
  LLMProviderConfig
} from '@shared/types'
import { buildOpenAICompatibleUrl, parseModelList } from '@main/utils/provider'
import { parseChatCompletionChunk, parseSseLines } from '@main/utils/llmProtocol'
import { getApiKey } from './secretStore'

const COMMAND_RISK_TIMEOUT_MS = 15_000

const LANGUAGE_NAMES: Record<string, string> = {
  ru: 'Russian',
  cn: 'Chinese'
}

export async function listModels(provider: LLMProviderConfig): Promise<LLMModel[]> {
  const response = await fetch(buildOpenAICompatibleUrl(provider.baseUrl, 'models'), {
    headers: await buildHeaders(provider)
  })

  if (!response.ok) {
    throw new Error(`Model request failed with ${response.status} ${response.statusText}`)
  }

  return parseModelList(await response.json())
}

export async function streamChatCompletion(
  request: ChatStreamRequest,
  onChunk: (content: string) => void
): Promise<void> {
  const model = request.provider.selectedModel?.trim()
  if (!model) {
    throw new Error('Select a model before sending a message.')
  }

  const response = await fetch(buildOpenAICompatibleUrl(request.provider.baseUrl, 'chat/completions'), {
    method: 'POST',
    headers: {
      ...await buildHeaders(request.provider),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      stream: true,
      messages: buildMessages(request.messages, request.context)
    })
  })

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
      if (chunk?.content) {
        onChunk(chunk.content)
      }
    }
  }
}

export async function assessCommandRisk(request: CommandRiskAssessmentRequest): Promise<CommandRiskAssessment> {
  const model = request.provider.commandRiskModel?.trim()
  if (!model) {
    throw new Error('Select a command safety model before checking command safety.')
  }

  const response = await fetchWithTimeout(
    buildOpenAICompatibleUrl(request.provider.baseUrl, 'chat/completions'),
    {
      method: 'POST',
      headers: {
        ...await buildHeaders(request.provider),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model,
        stream: false,
        temperature: 0,
        messages: buildCommandRiskMessages(request)
      })
    },
    COMMAND_RISK_TIMEOUT_MS,
    'Command safety check timed out, so the command is treated as risky.'
  )

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`Command safety request failed with ${response.status} ${response.statusText}${body ? `: ${body}` : ''}`)
  }

  return parseCommandRiskAssessment(extractMessageContent(await response.json()))
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
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

async function buildHeaders(provider: LLMProviderConfig): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    ...(provider.defaultHeaders ?? {})
  }

  const apiKey = await getApiKey(provider.apiKeyRef)
  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`
  }

  return headers
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
    ? `{"dangerous": boolean, "reason": string (MUST be written in ${languageName})}`
    : `{"dangerous": boolean, "reason": string}`

  return [
    {
      role: 'system',
      content: [
        'You are a shell command safety classifier.',
        'Analyze only the command and terminal context in this request.',
        `Return JSON only, with this exact shape: ${reasonFormat}.`,
        'Mark dangerous true for commands that can delete, overwrite, move, chmod/chown, install/uninstall, change config, expose secrets, modify remote systems, escalate privileges, kill processes, shutdown/reboot, perform destructive git/package operations, or otherwise cause persistent side effects.',
        'Mark dangerous false for read-only inspection commands such as pwd, ls, cat, grep, find, git status, and help/version commands.'
      ].join('\n')
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
    const parsed = JSON.parse(json) as { dangerous?: unknown; reason?: unknown }
    const dangerous = parsed.dangerous === false || parsed.dangerous === 'false' ? false : true
    return {
      dangerous,
      reason: typeof parsed.reason === 'string' && parsed.reason.trim()
        ? parsed.reason.trim()
        : 'The safety classifier did not provide a reason.'
    }
  } catch {
    return {
      dangerous: true,
      reason: 'The safety classifier returned an unreadable response, so the command is treated as risky.'
    }
  }
}

const ANSI_ESCAPE = String.fromCharCode(27)
const ANSI_RE = new RegExp(
  `${ANSI_ESCAPE}\\[[0-9;]*[mGKHFABCDJMPXZ]|${ANSI_ESCAPE}[@-_]|${ANSI_ESCAPE}\\[[0-9;]*[Rn]`,
  'g'
)

function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, '')
}

function buildMessages(messages: ChatMessage[], context: ChatStreamRequest['context']): ChatMessage[] {
  const mode = context.assistMode ?? 'off'
  const languageName = context.language ? LANGUAGE_NAMES[context.language] : undefined
  const languageInstruction = languageName
    ? `Always respond in ${languageName}.`
    : undefined

  const contextLines = [
    'You are an AI assistant embedded in a desktop terminal.',
    'Prefer concise, actionable terminal help.',
    languageInstruction,
    ...buildModeInstructions(mode),
    context.session ? `Active session: ${context.session.label} (${context.session.kind}).` : undefined,
    context.session?.cwd ? `Current directory: ${context.session.cwd}.` : undefined,
    context.selectedText ? `Selected terminal output:\n${context.selectedText}` : undefined,
    context.terminalOutput ? `Recent terminal output:\n${stripAnsi(context.terminalOutput)}` : undefined
  ].filter(Boolean).join('\n')

  return [
    {
      role: 'system',
      content: contextLines
    },
    ...messages
  ]
}

function buildModeInstructions(mode: ChatStreamRequest['context']['assistMode']): string[] {
  if (mode === 'agent') {
    return [
      'Agent mode is enabled. The app can run one command from your response automatically in the active terminal.',
      'When a command is needed, respond with exactly one fenced bash code block and put the command inside it.',
      'The app will send the command output back to you; do not claim success until you see that output.',
      'Avoid destructive commands unless the user explicitly asked for them, and finish with a normal answer when no more commands are needed.'
    ]
  }

  if (mode === 'read') {
    return [
      'Read-only terminal context is enabled.',
      'When suggesting commands, put each command in a fenced bash code block.',
      'Never claim a command was executed unless the user confirmed it.'
    ]
  }

  return [
    'When suggesting commands, put each command in a fenced bash code block.',
    'Never claim a command was executed unless the user confirmed it.'
  ]
}

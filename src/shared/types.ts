export type TerminalSessionKind = 'local' | 'ssh'
export type AssistMode = 'off' | 'read' | 'agent'
export type AppShortcutAction = 'clear-terminal' | 'open-settings' | 'new-tab' | 'close-tab'

export interface TerminalSessionInfo {
  id: string
  kind: TerminalSessionKind
  label: string
  cwd?: string
  shell?: string
  command: string
  createdAt: number
}

export interface CreateTerminalRequest {
  cwd?: string
  cols?: number
  rows?: number
}

export interface SSHProfile {
  name?: string
  host: string
  user?: string
  port?: number
  identityFile?: string
  extraArgs?: string[]
}

export interface LLMProviderConfig {
  name: string
  baseUrl: string
  apiKeyRef: string
  selectedModel?: string
  commandRiskModel?: string
  defaultHeaders?: Record<string, string>
}

export interface SaveLLMProviderRequest {
  provider: LLMProviderConfig
  apiKey?: string
}

export interface LLMModel {
  id: string
  ownedBy?: string
}

export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface TerminalContext {
  selectedText: string
  assistMode?: AssistMode
  terminalOutput?: string
  language?: string
  session?: Pick<TerminalSessionInfo, 'id' | 'kind' | 'label' | 'cwd' | 'shell'>
}

export interface ChatStreamRequest {
  requestId: string
  provider: LLMProviderConfig
  messages: ChatMessage[]
  context: TerminalContext
}

export interface CommandRiskAssessmentRequest {
  provider: LLMProviderConfig
  command: string
  context: TerminalContext
}

export interface CommandRiskAssessment {
  dangerous: boolean
  reason: string
}

export type ChatStreamEvent =
  | { requestId: string; type: 'chunk'; content: string }
  | { requestId: string; type: 'error'; message: string }
  | { requestId: string; type: 'done' }

export interface CommandProposal {
  id: string
  command: string
  explanation: string
}

export interface PromptTemplate {
  id: string
  name: string
  content: string
  createdAt: string
}

export interface AppConfig {
  providers: LLMProviderConfig[]
  activeProviderRef?: string
}

export interface ExportData {
  version: number
  exportedAt: string
  config: AppConfig
  apiKeys?: Record<string, string>
  prompts: PromptTemplate[]
  preferences: {
    textSize?: number
    sidebarWidth?: number
    language?: string
  }
}

export interface ImportResult {
  providersAdded: number
  promptsAdded: number
  preferences?: { textSize?: number; sidebarWidth?: number; language?: string }
}

// SPDX-License-Identifier: MPL-2.0
import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppConfig,
  AppShortcutAction,
  ChatStreamEvent,
  ChatStreamRequest,
  ChatToolsSettings,
  CommandSnippet,
  CommandRiskAssessment,
  CommandRiskAssessmentRequest,
  CommandProposal,
  CreateSshCommandRequest,
  CreateTerminalRequest,
  DataUsageStats,
  DiscoveredMcpServer,
  ExportData,
  GeneratedPrompt,
  ImportResult,
  ListModelsResult,
  McpDiscoveryResult,
  McpImportResult,
  McpServerConfig,
  PromptTemplate,
  SaveLLMProviderRequest,
  SavedChat,
  SavedChatSummary,
  SaveSessionStateRequest,
  SecretMaskingAuditEvent,
  SecretMaskingAuditSource,
  SecretMaskingMode,
  SecretMaskingSettings,
  SessionStateSnapshot,
  SSHProfile,
  SSHProfileConfig,
  SummarizeConversationRequest,
  TelemetrySettings,
  TerminalCommandEvent,
  TerminalSessionInfo,
  UpdateStatus
} from '@shared/types'

const api = {
  app: {
    openExternalUrl: (url: string) => ipcRenderer.invoke('app:openExternalUrl', url) as Promise<void>,
    setWindowOpacity: (opacity: number) => ipcRenderer.invoke('app:setWindowOpacity', opacity) as Promise<void>
  },
  update: {
    getStatus: () => ipcRenderer.invoke('update:getStatus') as Promise<UpdateStatus>,
    check: () => ipcRenderer.invoke('update:check') as Promise<void>,
    install: () => ipcRenderer.invoke('update:install') as Promise<void>,
    onStatus: (callback: (status: UpdateStatus) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, status: UpdateStatus) => callback(status)
      ipcRenderer.on('update:status', listener)
      return () => {
        ipcRenderer.removeListener('update:status', listener)
      }
    }
  },
  shortcuts: {
    onShortcut: (callback: (action: AppShortcutAction) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, action: AppShortcutAction) => callback(action)
      ipcRenderer.on('app:shortcut', listener)
      return () => {
        ipcRenderer.removeListener('app:shortcut', listener)
      }
    },
    setHide: (shortcut: string) => ipcRenderer.invoke('shortcut:setHide', shortcut) as Promise<boolean>,
    startRecording: () => ipcRenderer.invoke('shortcut:startRecording') as Promise<void>,
    stopRecording: () => ipcRenderer.invoke('shortcut:stopRecording') as Promise<void>,
    onRecorded: (callback: (accelerator: string) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, accelerator: string) => callback(accelerator)
      ipcRenderer.on('shortcut:recorded', listener)
      return () => {
        ipcRenderer.removeListener('shortcut:recorded', listener)
      }
    },
    onWindowShow: (callback: () => void) => {
      const listener = () => callback()
      ipcRenderer.on('app:window-show', listener)
      return () => {
        ipcRenderer.removeListener('app:window-show', listener)
      }
    },
    notifyWindowReady: () => ipcRenderer.send('app:window-ready')
  },
  config: {
    load: () => ipcRenderer.invoke('config:load') as Promise<AppConfig>,
    setSecretMaskingMode: (mode: SecretMaskingMode) =>
      ipcRenderer.invoke('config:setSecretMaskingMode', mode) as Promise<AppConfig>,
    setSecretMaskingSettings: (settings: SecretMaskingSettings) =>
      ipcRenderer.invoke('config:setSecretMaskingSettings', settings) as Promise<AppConfig>,
    setChatToolsSettings: (settings: ChatToolsSettings) =>
      ipcRenderer.invoke('config:setChatToolsSettings', settings) as Promise<AppConfig>,
    setTelemetrySettings: (patch: Partial<TelemetrySettings>) =>
      ipcRenderer.invoke('config:setTelemetrySettings', patch) as Promise<AppConfig>,
    getTelemetryRuntimeState: () =>
      ipcRenderer.invoke('telemetry:getRuntimeState') as Promise<{ possible: boolean }>,
    onTelemetryChanged: (callback: (settings: TelemetrySettings) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, settings: TelemetrySettings) => callback(settings)
      ipcRenderer.on('config:telemetryChanged', listener)
      return () => {
        ipcRenderer.removeListener('config:telemetryChanged', listener)
      }
    }
  },
  terminal: {
    create: (request?: CreateTerminalRequest) =>
      ipcRenderer.invoke('terminal:create', request) as Promise<TerminalSessionInfo>,
    list: () => ipcRenderer.invoke('terminal:list') as Promise<TerminalSessionInfo[]>,
    write: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data) as Promise<void>,
    resize: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows) as Promise<void>,
    kill: (sessionId: string) => ipcRenderer.invoke('terminal:kill', sessionId) as Promise<void>,
    onData: (callback: (payload: { sessionId: string; data: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; data: string }) => callback(payload)
      ipcRenderer.on('terminal:data', listener)
      return () => {
        ipcRenderer.removeListener('terminal:data', listener)
      }
    },
    onCommand: (callback: (payload: TerminalCommandEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: TerminalCommandEvent) => callback(payload)
      ipcRenderer.on('terminal:command', listener)
      return () => {
        ipcRenderer.removeListener('terminal:command', listener)
      }
    },
    onExit: (callback: (payload: { sessionId: string; exitCode: number }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; exitCode: number }) => callback(payload)
      ipcRenderer.on('terminal:exit', listener)
      return () => {
        ipcRenderer.removeListener('terminal:exit', listener)
      }
    },
    onCwd: (callback: (payload: { sessionId: string; cwd: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; cwd: string }) => callback(payload)
      ipcRenderer.on('terminal:cwd', listener)
      return () => {
        ipcRenderer.removeListener('terminal:cwd', listener)
      }
    },
    onSession: (callback: (session: TerminalSessionInfo) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, session: TerminalSessionInfo) => callback(session)
      ipcRenderer.on('terminal:session', listener)
      return () => {
        ipcRenderer.removeListener('terminal:session', listener)
      }
    },
    onPrompt: (callback: (payload: { sessionId: string }) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: { sessionId: string }) => callback(payload)
      ipcRenderer.on('terminal:prompt', listener)
      return () => {
        ipcRenderer.removeListener('terminal:prompt', listener)
      }
    }
  },
  sessionState: {
    load: () => ipcRenderer.invoke('sessionState:load') as Promise<SessionStateSnapshot | undefined>,
    save: (snapshot: SaveSessionStateRequest) =>
      ipcRenderer.invoke('sessionState:save', snapshot) as Promise<void>,
    clear: () => ipcRenderer.invoke('sessionState:clear') as Promise<void>
  },
  chatHistory: {
    list: () => ipcRenderer.invoke('chatHistory:list') as Promise<SavedChatSummary[]>,
    get: (id: string) => ipcRenderer.invoke('chatHistory:get', id) as Promise<SavedChat | undefined>,
    save: (chat: SavedChat) => ipcRenderer.invoke('chatHistory:save', chat) as Promise<void>,
    delete: (id: string) => ipcRenderer.invoke('chatHistory:delete', id) as Promise<void>,
    clear: () => ipcRenderer.invoke('chatHistory:clear') as Promise<void>
  },
  ssh: {
    connectProfile: (profile: SSHProfile, request?: CreateTerminalRequest) =>
      ipcRenderer.invoke('ssh:connectProfile', profile, request) as Promise<TerminalSessionInfo>,
    connectCommand: (request: CreateSshCommandRequest) =>
      ipcRenderer.invoke('ssh:connectCommand', request) as Promise<TerminalSessionInfo>,
    listProfiles: () =>
      ipcRenderer.invoke('ssh:listProfiles') as Promise<SSHProfileConfig[]>,
    saveProfile: (profile: SSHProfileConfig) =>
      ipcRenderer.invoke('ssh:saveProfile', profile) as Promise<AppConfig>,
    deleteProfile: (id: string) =>
      ipcRenderer.invoke('ssh:deleteProfile', id) as Promise<AppConfig>,
    chooseIdentityFile: () =>
      ipcRenderer.invoke('ssh:chooseIdentityFile') as Promise<string | undefined>
  },
  mcp: {
    listServers: () => ipcRenderer.invoke('mcp:listServers') as Promise<McpServerConfig[]>,
    saveServer: (server: McpServerConfig) =>
      ipcRenderer.invoke('mcp:saveServer', server) as Promise<McpServerConfig[]>,
    deleteServer: (id: string) => ipcRenderer.invoke('mcp:deleteServer', id) as Promise<McpServerConfig[]>,
    refreshTools: (serverId: string) => ipcRenderer.invoke('mcp:refreshTools', serverId) as Promise<McpServerConfig[]>,
    setToolEnabled: (serverId: string, toolName: string, enabled: boolean) =>
      ipcRenderer.invoke('mcp:setToolEnabled', serverId, toolName, enabled) as Promise<McpServerConfig[]>,
    discoverExternal: () => ipcRenderer.invoke('mcp:discoverExternal') as Promise<McpDiscoveryResult>,
    importServers: (servers: DiscoveredMcpServer[]) =>
      ipcRenderer.invoke('mcp:importServers', servers) as Promise<McpImportResult>
  },
  llm: {
    saveProvider: (request: SaveLLMProviderRequest) =>
      ipcRenderer.invoke('llm:saveProvider', request) as Promise<AppConfig>,
    hasApiKey: (apiKeyRef: string) =>
      ipcRenderer.invoke('llm:hasApiKey', apiKeyRef) as Promise<boolean>,
    deleteProvider: (apiKeyRef: string) =>
      ipcRenderer.invoke('llm:deleteProvider', apiKeyRef) as Promise<AppConfig>,
    listModels: (request: SaveLLMProviderRequest) =>
      ipcRenderer.invoke('llm:listModels', request) as Promise<ListModelsResult>,
    assessCommandRisk: (request: CommandRiskAssessmentRequest) =>
      ipcRenderer.invoke('llm:assessCommandRisk', request) as Promise<CommandRiskAssessment>,
    summarizeConversation: (request: SummarizeConversationRequest) =>
      ipcRenderer.invoke('llm:summarizeConversation', request) as Promise<GeneratedPrompt>,
    cancelSummarizeConversation: (requestId: string) =>
      ipcRenderer.invoke('llm:cancelSummarizeConversation', requestId) as Promise<void>,
    cancelChatStream: (requestId: string) =>
      ipcRenderer.invoke('llm:cancelChatStream', requestId) as Promise<void>,
    chatStream: (request: ChatStreamRequest) => ipcRenderer.send('llm:chatStream', request),
    onChatStreamEvent: (callback: (event: ChatStreamEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: ChatStreamEvent) => callback(payload)
      ipcRenderer.on('llm:chatStream:event', listener)
      return () => {
        ipcRenderer.removeListener('llm:chatStream:event', listener)
      }
    }
  },
  command: {
    propose: (text: string) => ipcRenderer.invoke('command:propose', text) as Promise<CommandProposal[]>,
    approve: (sessionId: string, command: string) =>
      ipcRenderer.invoke('command:approve', sessionId, command) as Promise<void>,
    runConfirmed: (sessionId: string, command: string) =>
      ipcRenderer.invoke('command:runConfirmed', sessionId, command) as Promise<void>
  },
  secret: {
    maskOutput: (sessionId: string, text: string, source?: SecretMaskingAuditSource) =>
      ipcRenderer.invoke('secret:maskOutput', sessionId, text, source) as Promise<string>,
    listAuditEvents: () => ipcRenderer.invoke('secret:listAuditEvents') as Promise<SecretMaskingAuditEvent[]>,
    clearAuditEvents: () => ipcRenderer.invoke('secret:clearAuditEvents') as Promise<void>,
    onAuditEvent: (callback: (event: SecretMaskingAuditEvent) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, payload: SecretMaskingAuditEvent) => callback(payload)
      ipcRenderer.on('secret:auditEvent', listener)
      return () => {
        ipcRenderer.removeListener('secret:auditEvent', listener)
      }
    }
  },
  prompt: {
    list: () => ipcRenderer.invoke('prompt:list') as Promise<PromptTemplate[]>,
    save: (prompt: PromptTemplate) =>
      ipcRenderer.invoke('prompt:save', prompt) as Promise<PromptTemplate>,
    delete: (id: string) => ipcRenderer.invoke('prompt:delete', id) as Promise<void>,
    importFiles: () => ipcRenderer.invoke('prompt:import') as Promise<PromptTemplate[]>
  },
  commandSnippet: {
    list: () => ipcRenderer.invoke('commandSnippet:list') as Promise<CommandSnippet[]>,
    save: (snippet: CommandSnippet) =>
      ipcRenderer.invoke('commandSnippet:save', snippet) as Promise<CommandSnippet>,
    delete: (id: string) => ipcRenderer.invoke('commandSnippet:delete', id) as Promise<void>
  },
  data: {
    usage: () =>
      ipcRenderer.invoke('data:usage') as Promise<DataUsageStats>,
    export: (preferences: ExportData['preferences']) =>
      ipcRenderer.invoke('data:export', preferences) as Promise<void>,
    import: () =>
      ipcRenderer.invoke('data:import') as Promise<ImportResult | undefined>
  }
}

contextBridge.exposeInMainWorld('api', api)

export type DesktopApi = typeof api

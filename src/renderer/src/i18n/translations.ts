// SPDX-License-Identifier: MPL-2.0
export type Language = 'en' | 'ru' | 'cn'

export interface Translations {
  // Settings navigation
  'settings.title': string
  'settings.close': string
  'settings.tab.appearance': string
  'settings.tab.providers': string
  'settings.tab.mcp': string
  'settings.tab.connections': string
  'settings.tab.security': string
  'settings.tab.chatTools': string
  'settings.tab.prompts': string
  'settings.tab.snippets': string
  'settings.tab.data': string
  'settings.search': string
  'settings.search.empty.title': string
  'settings.search.empty.hint': string
  'settings.search.empty.didYouMean': string
  'settings.search.empty.sections': string
  'settings.search.empty.examples': string
  'status.saved': string

  // Appearance tab
  'appearance.title': string
  'appearance.group.typography': string
  'appearance.group.cursor': string
  'appearance.group.terminal': string
  'appearance.group.window': string
  'appearance.fontFamily.label': string
  'appearance.fontFamily.desc': string
  'appearance.fontSize.label': string
  'appearance.fontSize.desc': string
  'appearance.fontSize.applied': string
  'appearance.lineHeight.label': string
  'appearance.lineHeight.desc': string
  'appearance.cursorStyle.label': string
  'appearance.cursorStyle.desc': string
  'appearance.cursorStyle.block': string
  'appearance.cursorStyle.underline': string
  'appearance.cursorStyle.bar': string
  'appearance.cursorBlink.label': string
  'appearance.cursorBlink.desc': string
  'appearance.scrollback.label': string
  'appearance.scrollback.desc': string
  'appearance.windowOpacity.label': string
  'appearance.windowOpacity.desc': string
  'appearance.preview.title': string
  'appearance.preview.command': string
  'appearance.language.label': string
  'appearance.language.desc': string
  'appearance.language.en': string
  'appearance.language.ru': string
  'appearance.language.cn': string
  'appearance.hideShortcut.label': string
  'appearance.hideShortcut.desc': string
  'appearance.hideShortcut.recording': string
  'appearance.hideShortcut.conflict': string
  'appearance.outputContext.label': string
  'appearance.outputContext.desc': string
  'appearance.theme.label': string
  'appearance.theme.desc': string

  // Providers tab
  'providers.title': string
  'providers.type': string
  'providers.type.openai': string
  'providers.type.ollama': string
  'providers.type.lmstudio': string
  'providers.type.anthropic': string
  'providers.name': string
  'providers.baseUrl': string
  'providers.proxyUrl': string
  'providers.proxyUsername': string
  'providers.proxyPassword': string
  'providers.proxyPassword.saved': string
  'providers.proxyPassword.change': string
  'providers.proxyPassword.clear': string
  'providers.proxyPassword.placeholder': string
  'providers.proxyPassword.replacePlaceholder': string
  'providers.proxy.save': string
  'providers.apiKey': string
  'providers.allowInsecureTls': string
  'providers.allowInsecureTls.desc': string
  'providers.apiKey.saved': string
  'providers.apiKey.change': string
  'providers.apiKey.placeholder': string
  'providers.apiKey.replacePlaceholder': string
  'providers.save': string
  'providers.testConnection': string
  'providers.testing': string
  'providers.fetchModels': string
  'providers.addProvider': string
  'providers.deleteProvider': string
  'providers.deleteConfirmTitle': string
  'providers.deleteConfirmMessage': string
  'providers.deleteConfirmBtn': string
  'providers.active': string
  'providers.draft': string
  'providers.unnamed': string
  'providers.chatModel': string
  'providers.safetyModel': string
  'providers.searchChatModel': string
  'providers.searchSafetyModel': string
  'providers.status.active': string
  'providers.status.activeReady': string
  'providers.status.activeLocal': string
  'providers.status.ready': string
  'providers.status.error': string
  'providers.status.noKey': string
  'providers.status.checking': string
  'providers.status.notTested': string
  'providers.status.local': string
  'providers.status.action.noKey': string
  'providers.status.action.select': string
  'providers.status.action.test': string
  'providers.status.action.ready': string
  'providers.status.action.checking': string

  // MCP tab
  'mcp.title': string
  'mcp.servers': string
  'mcp.addServer': string
  'mcp.empty': string
  'mcp.enabled': string
  'mcp.enabled.desc': string
  'mcp.status.enabled': string
  'mcp.status.disabled': string
  'mcp.name': string
  'mcp.command': string
  'mcp.args': string
  'mcp.env': string
  'mcp.save': string
  'mcp.enable': string
  'mcp.disable': string
  'mcp.deleteServer': string
  'mcp.deleteConfirmTitle': string
  'mcp.deleteConfirmMessage': string
  'mcp.deleteConfirmBtn': string
  'mcp.tools.title': string
  'mcp.tools.refresh': string
  'mcp.tools.refreshing': string
  'mcp.tools.refreshed': string
  'mcp.tools.empty': string
  'mcp.discovery.title': string
  'mcp.discovery.desc': string
  'mcp.discovery.scan': string
  'mcp.discovery.scanning': string
  'mcp.importSelected': string
  'mcp.status.required': string
  'mcp.status.saving': string
  'mcp.status.discovering': string
  'mcp.status.noneFound': string
  'mcp.status.selectImport': string
  'mcp.status.importing': string
  'mcp.status.duplicateName': string

  // Connections tab
  'connections.title': string
  'connections.addConnection': string
  'connections.deleteConnection': string
  'connections.deleteConfirmTitle': string
  'connections.deleteConfirmMessage': string
  'connections.deleteConfirmBtn': string
  'connections.save': string
  'connections.connect': string
  'connections.name': string
  'connections.host': string
  'connections.user': string
  'connections.port': string
  'connections.identityFile': string
  'connections.browseIdentityFile': string
  'connections.extraArgs': string
  'connections.unnamed': string
  'connections.noConnections': string
  'connections.emptyCta': string
  'connections.newConnection': string
  'connections.tab.newLocal': string

  // Security tab
  'chatTools.title': string
  'chatTools.taskList.label': string
  'chatTools.taskList.desc': string
  'chatTools.taskList.on': string
  'chatTools.taskList.off': string
  'taskList.title': string
  'taskList.progress': string
'taskList.showSteps': string
  'taskList.hideSteps': string
  'taskList.currentStep': string
  'taskList.showMore': string
  'taskList.showLess': string
  'security.title': string
  'security.secretMasking.label': string
  'security.secretMasking.desc': string
  'security.secretMasking.off': string
  'security.secretMasking.on': string
  'security.secretMasking.onState': string
  'security.secretMasking.offState': string
  'security.secretMasking.noScopesState': string
  'security.secretMasking.onDesc': string
  'security.secretMasking.offDesc': string
  'security.secretMasking.noScopesDesc': string
  'security.secretMasking.warning': string
  'security.secretMasking.noScopesWarning': string
  'security.maskedSecret.inline': string
  'security.summary.categories': string
  'security.summary.scopes': string
  'security.summary.audit': string
  'security.summary.noScopes': string
  'security.scopes.title': string
  'security.scope.providerPayloads': string
  'security.scope.providerPayloads.short': string
  'security.scope.providerPayloads.desc': string
  'security.scope.chatDisplay': string
  'security.scope.chatDisplay.short': string
  'security.scope.chatDisplay.desc': string
  'security.strictMode': string
  'security.strictMode.short': string
  'security.strictMode.desc': string
  'security.patterns.title': string
  'security.category.apiKeys': string
  'security.category.apiKeys.desc': string
  'security.category.tokens': string
  'security.category.tokens.desc': string
  'security.category.passwords': string
  'security.category.passwords.desc': string
  'security.category.aws': string
  'security.category.aws.desc': string
  'security.category.sshMaterial': string
  'security.category.sshMaterial.desc': string
  'security.category.urlCredentials': string
  'security.category.urlCredentials.desc': string
  'security.category.customRegex': string
  'security.category.customRegex.count': string
  'security.category.customRegex.empty': string
  'security.customPatterns.title': string
  'security.customPatterns.name': string
  'security.customPatterns.regex': string
  'security.customPatterns.add': string
  'security.customPatterns.empty': string
  'security.customPatterns.required': string
  'security.customPatterns.invalid': string
  'security.customPatterns.unsafe': string
  'security.customPatterns.enable': string
  'security.customPatterns.disable': string
  'security.audit.title': string
  'security.audit.clear': string
  'security.audit.empty': string
  'security.audit.maskedCount': string
  'security.audit.scope.provider': string
  'security.audit.scope.display': string
  'security.audit.source.chatStream': string
  'security.audit.source.chatDisplay': string
  'security.audit.source.commandRisk': string
  'security.audit.source.summary': string
  'security.audit.source.terminalDisplay': string
  'security.audit.source.chatStorage': string
  'privacy.trustCard.title': string
  'privacy.trustCard.categories': string
  'privacy.trustCard.context': string
  'privacy.trustCard.note': string
  'privacy.trustCard.openSettings': string

  // Prompts tab
  'prompts.title': string
  'prompts.importFromFile': string
  'prompts.addPrompt': string
  'prompts.savePrompt': string
  'prompts.cancel': string
  'prompts.noPrompts': string
  'prompts.namePlaceholder': string
  'prompts.contentPlaceholder': string
  'prompts.edit': string
  'prompts.delete': string
  'prompts.deleteConfirmTitle': string
  'prompts.deleteConfirmMessage': string
  'prompts.deleteConfirmBtn': string
  'prompts.duplicateName': string

  // Command snippets tab
  'snippets.title': string
  'snippets.quickHint': string
  'snippets.addSnippet': string
  'snippets.saveSnippet': string
  'snippets.noSnippets': string
  'snippets.namePlaceholder': string
  'snippets.commandPlaceholder': string
  'snippets.edit': string
  'snippets.delete': string
  'snippets.deleteConfirmTitle': string
  'snippets.deleteConfirmMessage': string
  'snippets.deleteConfirmBtn': string
  'snippets.duplicateName': string

  // Data tab
  'data.title': string
  'data.usage.title': string
  'data.usage.desc': string
  'data.usage.storage': string
  'data.usage.chats': string
  'data.usage.sessions': string
  'data.exportImport.label': string
  'data.exportImport.desc': string
  'data.export': string
  'data.import': string
  'data.restoreSessions.label': string
  'data.restoreSessions.desc': string
  'data.clearSessions.label': string
  'data.clearSessions.desc': string
  'data.clearSessions': string
  'data.clearSessionsConfirmTitle': string
  'data.clearSessionsConfirmMessage': string
  'data.clearSessionsConfirmBtn': string
  'data.clearChatHistory.label': string
  'data.clearChatHistory.desc': string
  'data.clearChatHistory': string
  'data.clearChatHistory.done': string
  'data.clearChatHistoryConfirmTitle': string
  'data.clearChatHistoryConfirmMessage': string
  'data.clearChatHistoryConfirmBtn': string
  'data.dangerZone': string

  // Terminal
  'terminal.sshDisconnected': string
  'terminal.reconnect': string
  'terminal.searchPlaceholder': string
  'terminal.searchNoResults': string
  'terminal.searchPrevious': string
  'terminal.searchNext': string
  'terminal.searchClose': string
  'terminal.blocks.select': string
  'terminal.blocks.deselect': string
  'terminal.blocks.askAi': string
  'terminal.blocks.copyBlock': string
  'terminal.blocks.copyCommand': string
  'terminal.blocks.copyOutput': string
  'terminal.blocks.commandUnavailable': string
  'terminal.blocks.rerunCommand': string
  'terminal.blocks.rerunTitle': string
  'terminal.blocks.rerunBody': string
  'terminal.blocks.rerunConfirm': string
  'terminal.blocks.saveSnippet': string
  'terminal.blocks.clearSelection': string
  'terminal.blocks.sendTitle': string
  'terminal.blocks.sendBody': string
  'terminal.blocks.send': string
  'terminal.blocks.selectedCount': string
  'terminal.blocks.askPrompt': string
  'terminal.blocks.label': string
  'terminal.noActiveSession': string

  // Panel header
  'panel.agent': string
  'panel.agentToggle.enable': string
  'panel.agentToggle.disable': string
  'panel.newChat': string
  'panel.settings': string
  'panel.permission.read': string
  'panel.permission.execute': string
  'panel.permission.pending': string
  'panel.permission.summary': string
  'panel.permission.none': string
  'panel.permission.readOnly': string
  'panel.permission.readExecute': string
  'panel.shell.label': string
  'panel.status.idle': string
  'panel.status.running': string
  'panel.status.waiting': string
  'sidebar.openHandle': string
  'app.terminalToolbar': string
  'app.newTerminal': string
  'app.closeSession': string
  'app.settings': string
  'app.showSidebar': string
  'app.hideSidebar': string
  'chat.runInTerminal': string
  'chat.showFullCommand': string
  'chat.collapseCommand': string
  'chat.copyCode': string
  'chat.copyMessage': string
  'chat.copied': string
  'panel.promptLibrary': string

  // Chat area
  'chat.empty.title': string
  'chat.empty.body': string
  'chat.input.placeholder': string
  'chat.input.tooltip': string
  'chat.composer.context': string
  'chat.composer.maskedSecrets': string
  'chat.composer.mode.agent': string
  'chat.composer.mode.read': string
  'chat.composer.mode.off': string
  'chat.composer.controls': string
  'chat.composer.contextLabel': string
  'chat.composer.maskedLabel': string
  'chat.composer.modeLabel': string
  'model.switch.title': string
  'model.switch.search': string
  'model.switch.all': string
  'model.switch.category': string
  'model.switch.current': string
  'model.switch.choose': string
  'model.switch.loadDescription': string
  'chat.send': string
  'chat.stopAgent': string
  'chat.role.user': string
  'chat.role.assistant': string
  'chat.commandOutput.label': string
  'chat.commandOutput.hiddenLabel': string
  'chat.commandOutput.show': string
  'chat.commandOutput.noOutput': string
  'chat.commandEdited.label': string
  'chat.commandEdited.original': string
  'chat.commandEdited.final': string
  'chat.thinking': string
  'chat.regenerate': string
  'chat.forkFromMessage': string
  'chat.forked': string
  'chat.connectProvider': string
  'chat.saveAsPrompt': string
  'chat.savePrompt.generating': string
  'chat.savePrompt.save': string
  'chat.savePrompt.saving': string
  'chat.savePrompt.saved': string
  'chat.savePrompt.error': string
  'chat.history': string
  'chat.historySearch': string
  'chat.historyEmpty': string
  'chat.historyNoMatch': string
  'chat.historyMessages': string
  'chat.historyDelete': string
  'chat.historyDeleteConfirmTitle': string
  'chat.historyDeleteConfirmMessage': string
  'chat.historyDeleteConfirmBtn': string

  // First-run onboarding
  'onboarding.title': string
  'onboarding.body': string
  'onboarding.provider': string
  'onboarding.apiKey': string
  'onboarding.endpoint': string
  'onboarding.apiKeyPlaceholder': string
  'onboarding.localProviderNote': string
  'onboarding.test': string
  'onboarding.testConnection': string
  'onboarding.apiKeyRequired': string
  'onboarding.model': string
  'onboarding.firstQuestion': string
  'onboarding.firstQuestionPrompt': string

  // Command confirmation dialog
  'confirm.reviewRisky': string
  'confirm.safetyUnavailable': string
  'confirm.review': string
  'confirm.warning': string
  'confirm.command': string
  'confirm.reason': string
  'confirm.agentPaused': string
  'confirm.cancel': string
  'confirm.runCommand': string
  'confirm.runAnyway': string
  'confirm.shortcutHint': string
  'confirm.destructiveWarning': string
  'confirm.confirmCountdown': string
  'confirm.commandApproved': string
  'confirm.commandRejected': string
  'commandRisk.localSecret': string
  'commandRisk.sshContext': string
  'commandRisk.requiresConfirmation': string

  // Status messages (chat inline status)
  'status.checkingSafety': string
  'status.agentStopped.riskyCommand': string
  'status.agentStopped.safetyUnchecked': string
  'status.agentStopped.tenSteps': string
  'status.riskyCommandConfirmed': string
  'status.safetyFailedConfirmed': string
  'status.noSession.agent': string
  'status.noSession.run': string
  'status.disconnected.run': string
  'status.commandAlreadyRunning': string
  'status.modelLoading': string
  'status.promptProcessing': string
  'status.blockPromptQueued': string
  'status.privacyMasked': string

  // Suggestion chips
  'chip.space': string
  'chip.spacePrompt': string
  'chip.processes': string
  'chip.processesPrompt': string
  'chip.lastCommand': string
  'chip.lastCommandPrompt': string
  'chip.selection': string
  'chip.selectionPrompt': string
  'chip.git': string
  'chip.gitPrompt': string
  'chip.docker': string
  'chip.dockerPrompt': string
  'chip.logs': string
  'chip.logsPrompt': string
  'chip.disk': string
  'chip.diskPrompt': string

  // Agentic status strip
  'agent.step': string
  'agent.waiting': string
  'agent.running': string

  // Model combobox
  'model.noMatch': string
  'model.loadFirst': string
  'model.loadModelsFirst': string
  'model.showing': string
  'model.supportsMcp': string

  // Command snippet palette
  'snippetPalette.title': string
  'snippetPalette.search': string
  'snippetPalette.enterInserts': string
  'snippetPalette.metaEnterRuns': string
  'snippetPalette.addSnippet': string
  'snippetPalette.runNow': string
  'snippetPalette.empty': string
  'snippetPalette.emptyCta': string
  'snippetPalette.noMatch': string

  // Unified command palette
  'commandPalette.title': string
  'commandPalette.search': string
  'commandPalette.recent': string
  'commandPalette.all': string
  'commandPalette.commands': string
  'commandPalette.snippets': string
  'commandPalette.prompts': string
  'commandPalette.noMatch': string
  'commandPalette.enterSelects': string
  'commandPalette.action.open': string
  'commandPalette.action.run': string
  'commandPalette.action.insert': string
  'commandPalette.action.select': string
  'commandPalette.escapeCloses': string

  // Prompt palette
  'promptPalette.title': string
  'promptPalette.search': string
  'promptPalette.enterInserts': string
  'promptPalette.addPrompt': string
  'promptPalette.empty': string
  'promptPalette.emptyCta': string
  'promptPalette.noMatch': string

  // Auto-update
  'update.downloading': string
  'update.downloaded': string
  'update.restart': string
  'update.dismiss': string
  'telemetry.consent.title': string
  'telemetry.consent.body': string
  'telemetry.consent.accept': string
  'telemetry.consent.decline': string
  'security.telemetry.label': string
  'security.telemetry.desc': string
  'security.telemetry.on': string
  'security.telemetry.off': string
  'security.telemetry.onState': string
  'security.telemetry.offState': string
  'security.telemetry.inactiveState': string
}

export const en: Translations = {
  'settings.title': 'Settings',
  'settings.close': 'Close settings',
  'settings.tab.appearance': 'Appearance',
  'settings.tab.providers': 'Providers',
  'settings.tab.mcp': 'MCP',
  'settings.tab.connections': 'Connections',
  'settings.tab.security': 'Security',
  'settings.tab.chatTools': 'Chat Tools',
  'settings.tab.prompts': 'Prompts',
  'settings.tab.snippets': 'Snippets',
  'settings.tab.data': 'Data',
  'settings.search': 'Search settings',
  'settings.search.empty.title': 'No results for "{query}"',
  'settings.search.empty.hint': 'Try a nearby section or search for a setting name, shortcut, provider, model, SSH, prompt, snippet, or export.',
  'settings.search.empty.didYouMean': 'Suggested sections',
  'settings.search.empty.sections': 'All settings sections',
  'settings.search.empty.examples': 'Examples: API key, terminal font, SSH host, secret masking, command snippet.',
  'status.saved': 'Saved',

  'appearance.title': 'Appearance',
  'appearance.group.typography': 'Typography',
  'appearance.group.cursor': 'Cursor',
  'appearance.group.terminal': 'Terminal',
  'appearance.group.window': 'Window',
  'appearance.fontFamily.label': 'Terminal font family',
  'appearance.fontFamily.desc': 'Monospace stack used by every terminal session',
  'appearance.fontSize.label': 'Terminal font size',
  'appearance.fontSize.desc': 'Applied to all terminal sessions, 8-32 px',
  'appearance.fontSize.applied': '{value}px applied',
  'appearance.lineHeight.label': 'Line height',
  'appearance.lineHeight.desc': 'Terminal row spacing, 1.0-2.0',
  'appearance.cursorStyle.label': 'Cursor style',
  'appearance.cursorStyle.desc': 'Shape of the active terminal cursor',
  'appearance.cursorStyle.block': 'Block',
  'appearance.cursorStyle.underline': 'Underline',
  'appearance.cursorStyle.bar': 'Bar',
  'appearance.cursorBlink.label': 'Cursor blink',
  'appearance.cursorBlink.desc': 'Animate the active cursor while the terminal is focused',
  'appearance.scrollback.label': 'Scrollback',
  'appearance.scrollback.desc': 'Lines kept in terminal history, 100-100000',
  'appearance.windowOpacity.label': 'Window opacity',
  'appearance.windowOpacity.desc': 'Subtle app window transparency, 90-100%',
  'appearance.preview.title': 'Live preview',
  'appearance.preview.command': 'npm run build',
  'appearance.language.label': 'Language',
  'appearance.language.desc': 'UI language and LLM response language',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',
  'appearance.hideShortcut.label': 'Hide/Show shortcut',
  'appearance.hideShortcut.desc': 'Global shortcut to toggle window visibility',
  'appearance.hideShortcut.recording': 'Press a key combination...',
  'appearance.hideShortcut.conflict': 'Shortcut {shortcut} is used by the system and cannot be assigned',
  'appearance.outputContext.label': 'Output context for AI',
  'appearance.outputContext.desc': 'Recent terminal output sent to the AI. Minimum 1,000 chars',
  'appearance.theme.label': 'Theme',
  'appearance.theme.desc': 'Color scheme for UI and terminal',

  'providers.title': 'Providers',
  'providers.type': 'Provider type',
  'providers.type.openai': 'OpenAI-compatible',
  'providers.type.ollama': 'Ollama',
  'providers.type.lmstudio': 'LM Studio',
  'providers.type.anthropic': 'Anthropic',
  'providers.name': 'Provider name',
  'providers.baseUrl': 'Base URL',
  'providers.proxyUrl': 'HTTP(S) proxy URL',
  'providers.proxyUsername': 'Proxy username',
  'providers.proxyPassword': 'Proxy password',
  'providers.proxyPassword.saved': 'saved in keychain',
  'providers.proxyPassword.change': 'Change',
  'providers.proxyPassword.clear': 'Clear saved proxy password',
  'providers.proxyPassword.placeholder': 'Enter proxy password…',
  'providers.proxyPassword.replacePlaceholder': 'Enter new proxy password…',
  'providers.proxy.save': 'Save proxy',
  'providers.apiKey': 'API key',
  'providers.allowInsecureTls': 'Allow insecure TLS',
  'providers.allowInsecureTls.desc': 'Use only for trusted internal endpoints with self-signed certificates.',
  'providers.apiKey.saved': 'saved in keychain',
  'providers.apiKey.change': 'Change',
  'providers.apiKey.placeholder': 'Enter API key…',
  'providers.apiKey.replacePlaceholder': 'Enter new key to replace…',
  'providers.save': 'Save provider',
  'providers.testConnection': 'Test connection',
  'providers.testing': 'Testing...',
  'providers.fetchModels': 'Fetch models',
  'providers.addProvider': 'Add provider',
  'providers.deleteProvider': 'Delete provider',
  'providers.deleteConfirmTitle': 'Delete provider?',
  'providers.deleteConfirmMessage': 'This provider configuration and its saved keychain secret will be removed.',
  'providers.deleteConfirmBtn': 'Delete',
  'providers.active': 'active',
  'providers.draft': 'new',
  'providers.unnamed': 'Unnamed',
  'providers.chatModel': 'Chat model',
  'providers.safetyModel': 'Command safety model',
  'providers.searchChatModel': 'Search chat model',
  'providers.searchSafetyModel': 'Search safety model',
  'providers.status.active': 'active',
  'providers.status.activeReady': 'active · ready',
  'providers.status.activeLocal': 'active · local',
  'providers.status.ready': 'ready',
  'providers.status.error': 'error',
  'providers.status.noKey': 'no key',
  'providers.status.checking': 'checking',
  'providers.status.notTested': 'not tested',
  'providers.status.local': 'local',
  'providers.status.action.noKey': 'Enter API key',
  'providers.status.action.select': 'Select provider',
  'providers.status.action.test': 'Test connection',
  'providers.status.action.ready': 'Retest connection',
  'providers.status.action.checking': 'Connection check in progress',

  'mcp.title': 'MCP servers',
  'mcp.servers': 'Servers',
  'mcp.addServer': 'Add MCP server',
  'mcp.empty': 'No MCP servers yet.',
  'mcp.enabled': 'Enabled',
  'mcp.enabled.desc': 'Allow this server to be available for MCP-capable models.',
  'mcp.status.enabled': 'Enabled',
  'mcp.status.disabled': 'Disabled',
  'mcp.name': 'Server name',
  'mcp.command': 'Command',
  'mcp.args': 'Arguments',
  'mcp.env': 'Environment',
  'mcp.save': 'Save MCP server',
  'mcp.enable': 'Enable',
  'mcp.disable': 'Disable',
  'mcp.deleteServer': 'Delete MCP server',
  'mcp.deleteConfirmTitle': 'Delete MCP server?',
  'mcp.deleteConfirmMessage': 'This MCP server will be removed from mcp.json.',
  'mcp.deleteConfirmBtn': 'Delete',
  'mcp.tools.title': 'Tools',
  'mcp.tools.refresh': 'Refresh tools',
  'mcp.tools.refreshing': 'Refreshing tools...',
  'mcp.tools.refreshed': 'Found {count} tool(s).',
  'mcp.tools.empty': 'Refresh tools after saving this server, then enable only the tools the assistant may use.',
  'mcp.discovery.title': 'Import from other tools',
  'mcp.discovery.desc': 'Scan known local MCP config paths for Claude, VS Code Copilot, Codex, OpenCode, LM Studio, Ollama bridges, Cursor, and Windsurf only after this request. Found servers are reviewed before import.',
  'mcp.discovery.scan': 'Discover',
  'mcp.discovery.scanning': 'Scanning...',
  'mcp.importSelected': 'Import selected',
  'mcp.status.required': 'Enter a server name and command.',
  'mcp.status.saving': 'Saving MCP server...',
  'mcp.status.discovering': 'Looking for MCP configs...',
  'mcp.status.noneFound': 'No MCP servers found.',
  'mcp.status.selectImport': 'Select at least one server to import.',
  'mcp.status.importing': 'Importing MCP servers...',
  'mcp.status.duplicateName': 'Use a unique MCP server name.',

  'connections.title': 'SSH Connections',
  'connections.addConnection': 'Add connection',
  'connections.deleteConnection': 'Delete connection',
  'connections.deleteConfirmTitle': 'Delete SSH connection?',
  'connections.deleteConfirmMessage': 'This saved SSH connection will be removed.',
  'connections.deleteConfirmBtn': 'Delete',
  'connections.save': 'Save',
  'connections.connect': 'Connect',
  'connections.name': 'Name',
  'connections.host': 'Host',
  'connections.user': 'User',
  'connections.port': 'Port',
  'connections.identityFile': 'Identity file',
  'connections.browseIdentityFile': 'Browse',
  'connections.extraArgs': 'Extra args',
  'connections.unnamed': 'Unnamed',
  'connections.noConnections': 'No SSH connections yet.',
  'connections.emptyCta': 'Add first connection',
  'connections.newConnection': 'New Connection',
  'connections.tab.newLocal': 'New Local Terminal',

  'chatTools.title': 'Chat Tools',
  'chatTools.taskList.label': 'Task list planning',
  'chatTools.taskList.desc': 'When enabled, the assistant drafts a task list for complex multi-step requests and tracks progress as it works through each step. Off by default — agent mode keeps its current behaviour until you turn this on.',
  'chatTools.taskList.on': 'On',
  'chatTools.taskList.off': 'Off',
  'taskList.title': 'Task list',
  'taskList.progress': '{done} of {total} done',
'taskList.showSteps': 'Show steps ({done} of {total})',
  'taskList.hideSteps': 'Hide steps',
  'taskList.currentStep': 'Current step',
  'taskList.showMore': 'Show more',
  'taskList.showLess': 'Show less',
  'security.title': 'Security',
  'security.secretMasking.label': 'Secret masking',
  'security.secretMasking.desc': 'Local scan for chat, terminal context, command checks, and summaries',
  'security.secretMasking.off': 'Off',
  'security.secretMasking.on': 'On',
  'security.secretMasking.onState': 'Protected',
  'security.secretMasking.offState': 'Unprotected',
  'security.secretMasking.noScopesState': 'No active protection',
  'security.secretMasking.onDesc': 'Protection is active for the selected areas.',
  'security.secretMasking.offDesc': 'Secret detection is turned off.',
  'security.secretMasking.noScopesDesc': 'No provider, display, or strict-context protection is enabled.',
  'security.secretMasking.warning': 'Sensitive values may be sent to the provider.',
  'security.secretMasking.noScopesWarning': 'Nothing is protected until at least one area is enabled.',
  'security.maskedSecret.inline': '[secret]',
  'security.summary.categories': 'Active categories',
  'security.summary.scopes': 'Active protection',
  'security.summary.audit': 'Audit events',
  'security.summary.noScopes': 'None',
  'security.scopes.title': 'Masking scope and context policy',
  'security.scope.providerPayloads': 'Provider payloads',
  'security.scope.providerPayloads.short': 'Provider',
  'security.scope.providerPayloads.desc': 'Replace secrets before requests leave this device.',
  'security.scope.chatDisplay': 'Chat display',
  'security.scope.chatDisplay.short': 'Display',
  'security.scope.chatDisplay.desc': 'Hide secrets in chat, command output, and saved history.',
  'security.strictMode': 'Strict terminal context',
  'security.strictMode.short': 'Strict context',
  'security.strictMode.desc': 'Never include selected terminal text or output in provider requests.',
  'security.patterns.title': 'Active detection categories',
  'security.category.apiKeys': 'API keys',
  'security.category.apiKeys.desc': 'OpenAI-style keys, provider keys, and generic API key assignments.',
  'security.category.tokens': 'Tokens',
  'security.category.tokens.desc': 'Bearer, access, refresh, auth, deploy, and webhook tokens.',
  'security.category.passwords': 'Passwords',
  'security.category.passwords.desc': 'Password, passwd, pwd, and secret variable assignments.',
  'security.category.aws': 'AWS keys',
  'security.category.aws.desc': 'AWS access keys and cloud credential shapes detected by Gitleaks.',
  'security.category.sshMaterial': 'SSH material',
  'security.category.sshMaterial.desc': 'Private key material and identity-file secrets.',
  'security.category.urlCredentials': 'URL credentials',
  'security.category.urlCredentials.desc': 'Passwords embedded in HTTP or HTTPS URLs.',
  'security.category.customRegex': 'Custom regexes',
  'security.category.customRegex.count': '{count} enabled custom pattern(s)',
  'security.category.customRegex.empty': 'No custom patterns enabled',
  'security.customPatterns.title': 'Custom masking patterns',
  'security.customPatterns.name': 'Pattern name',
  'security.customPatterns.regex': 'Regex; first capture group is masked when present',
  'security.customPatterns.add': 'Add pattern',
  'security.customPatterns.empty': 'No custom patterns yet.',
  'security.customPatterns.required': 'Enter a pattern name and regex.',
  'security.customPatterns.invalid': 'Regex is not valid.',
  'security.customPatterns.unsafe': 'Regex is too broad or complex for real-time masking.',
  'security.customPatterns.enable': 'Enable pattern',
  'security.customPatterns.disable': 'Disable pattern',
  'security.audit.title': 'Masking audit log',
  'security.audit.clear': 'Clear log',
  'security.audit.empty': 'No masking events yet.',
  'security.audit.maskedCount': '{count} masked',
  'security.audit.scope.provider': 'Provider payload',
  'security.audit.scope.display': 'Chat display',
  'security.audit.source.chatStream': 'Assistant request',
  'security.audit.source.chatDisplay': 'Chat display',
  'security.audit.source.commandRisk': 'Command safety check',
  'security.audit.source.summary': 'Prompt summary',
  'security.audit.source.terminalDisplay': 'Terminal output display',
  'security.audit.source.chatStorage': 'Saved chat',
  'privacy.trustCard.title': 'Privacy masking',
  'privacy.trustCard.categories': 'Masked categories',
  'privacy.trustCard.context': 'Source context',
  'privacy.trustCard.note': 'Values stay hidden. Adjust masking rules in Security if needed.',
  'privacy.trustCard.openSettings': 'Security settings',

  'prompts.title': 'Prompts',
  'prompts.importFromFile': 'Import from file',
  'prompts.addPrompt': 'Add prompt',
  'prompts.savePrompt': 'Save prompt',
  'prompts.cancel': 'Cancel',
  'prompts.noPrompts': 'No prompts yet. Add one below or import a Markdown file.',
  'prompts.namePlaceholder': 'Prompt name',
  'prompts.contentPlaceholder': 'Prompt content…',
  'prompts.edit': 'Edit',
  'prompts.delete': 'Delete',
  'prompts.deleteConfirmTitle': 'Delete prompt?',
  'prompts.deleteConfirmMessage': 'This action cannot be undone.',
  'prompts.deleteConfirmBtn': 'Delete',
  'prompts.duplicateName': 'A prompt with this name already exists.',

  'snippets.title': 'Command Snippets',
  'snippets.quickHint': 'Quick open with ⌘⇧K. Enter inserts, ⌘Enter runs.',
  'snippets.addSnippet': 'Add snippet',
  'snippets.saveSnippet': 'Save snippet',
  'snippets.noSnippets': 'No command snippets yet. Add one below.',
  'snippets.namePlaceholder': 'Snippet name',
  'snippets.commandPlaceholder': 'Terminal command…',
  'snippets.edit': 'Edit',
  'snippets.delete': 'Delete',
  'snippets.deleteConfirmTitle': 'Delete command snippet?',
  'snippets.deleteConfirmMessage': 'This action cannot be undone.',
  'snippets.deleteConfirmBtn': 'Delete',
  'snippets.duplicateName': 'A command snippet with this name already exists.',

  'data.title': 'Data',
  'data.usage.title': 'Local usage',
  'data.usage.desc': 'Stored only on this Mac. Anonymous usage telemetry is off by default and only sent if you opt in (Security & Privacy).',
  'data.usage.storage': 'Storage used',
  'data.usage.chats': 'Saved chats',
  'data.usage.sessions': 'Saved sessions',
  'data.exportImport.label': 'Export / Import',
  'data.exportImport.desc': 'JSON backup with providers, prompts, command snippets and preferences',
  'data.export': 'Export',
  'data.import': 'Import',
  'data.restoreSessions.label': 'Restore tabs and history',
  'data.restoreSessions.desc': 'Reopen tabs with terminal output and assistant history on launch',
  'data.clearSessions.label': 'Saved session state',
  'data.clearSessions.desc': 'Remove stored tabs and scrollback without changing current tabs',
  'data.clearSessions': 'Clear saved state',
  'data.clearSessionsConfirmTitle': 'Clear saved session state?',
  'data.clearSessionsConfirmMessage': 'Stored tabs and scrollback will be removed. Current tabs will stay open.',
  'data.clearSessionsConfirmBtn': 'Clear',
  'data.clearChatHistory.label': 'Chat History',
  'data.clearChatHistory.desc': 'Delete all saved chat conversations',
  'data.clearChatHistory': 'Clear chat history',
  'data.clearChatHistory.done': 'Chat history cleared',
  'data.clearChatHistoryConfirmTitle': 'Clear chat history?',
  'data.clearChatHistoryConfirmMessage': 'All saved chat conversations will be deleted. This action cannot be undone.',
  'data.clearChatHistoryConfirmBtn': 'Clear',
  'data.dangerZone': 'Danger zone',

  'terminal.sshDisconnected': 'SSH session disconnected',
  'terminal.reconnect': 'Reconnect',
  'terminal.searchPlaceholder': 'Search terminal',
  'terminal.searchNoResults': 'No results',
  'terminal.searchPrevious': 'Previous result',
  'terminal.searchNext': 'Next result',
  'terminal.searchClose': 'Close search',
  'terminal.blocks.select': 'Select',
  'terminal.blocks.deselect': 'Deselect',
  'terminal.blocks.askAi': 'Ask AI',
  'terminal.blocks.copyBlock': 'Copy block',
  'terminal.blocks.copyCommand': 'Copy command',
  'terminal.blocks.copyOutput': 'Copy output',
  'terminal.blocks.commandUnavailable': 'Command unavailable',
  'terminal.blocks.rerunCommand': 'Rerun command',
  'terminal.blocks.rerunTitle': 'Rerun selected command?',
  'terminal.blocks.rerunBody': 'This command will be sent to the active terminal session.',
  'terminal.blocks.rerunConfirm': 'Rerun',
  'terminal.blocks.saveSnippet': 'Save snippet',
  'terminal.blocks.clearSelection': 'Clear selection',
  'terminal.blocks.sendTitle': 'Send selected blocks to chat?',
  'terminal.blocks.sendBody': 'Commands and the selected terminal output will be sent to the chat. Check that there are no tokens, keys, passwords, private paths, or other sensitive data.',
  'terminal.blocks.send': 'Send',
  'terminal.blocks.selectedCount': '{count} selected block(s)',
  'terminal.blocks.askPrompt': 'Analyze the selected terminal blocks: explain what ran, what the output means, whether there are errors, and what next steps make sense.',
  'terminal.blocks.label': 'Block {index}',
  'terminal.noActiveSession': 'No active terminal session.',

  'panel.agent': 'Agent',
  'panel.agentToggle.enable': 'Enable agent execution',
  'panel.agentToggle.disable': 'Switch to read-only context',
  'panel.newChat': 'New chat',
  'panel.settings': 'Settings',
  'panel.permission.read': 'Read',
  'panel.permission.execute': 'Execute commands',
  'panel.permission.pending': 'Pending',
  'panel.permission.summary': 'Assistant session and permissions',
  'panel.permission.none': 'No terminal access',
  'panel.permission.readOnly': 'Read terminal context',
  'panel.permission.readExecute': 'Read terminal context and execute commands',
  'panel.shell.label': 'Shell: {shell}',
  'panel.status.idle': 'Idle',
  'panel.status.running': 'Running',
  'panel.status.waiting': 'Waiting',
  'sidebar.openHandle': 'Open assistant (⌘\\)',
  'app.terminalToolbar': 'Terminal toolbar',
  'app.newTerminal': 'New terminal (⌘T)',
  'app.closeSession': 'Close session (⌘W)',
  'app.settings': 'Settings (⌘,)',
  'app.showSidebar': 'Show assistant sidebar (⌘\\)',
  'app.hideSidebar': 'Hide assistant sidebar (⌘\\)',
  'chat.runInTerminal': 'Run in terminal',
  'chat.showFullCommand': 'Show full command',
  'chat.collapseCommand': 'Collapse command',
  'chat.copyCode': 'Copy code',
  'chat.copyMessage': 'Copy message',
  'chat.copied': 'Copied',
  'panel.promptLibrary': 'Prompt library (⌘⇧J)',

  'chat.empty.title': 'Ready to help',
  'chat.empty.body': 'Ask about your terminal, commands, or selected text',
  'chat.input.placeholder': 'Ask about this terminal…',
  'chat.input.tooltip': 'Enter sends. Shift+Enter adds a new line.',
  'chat.composer.context': 'Context ~{count} tokens',
  'chat.composer.maskedSecrets': '{count} masked',
  'chat.composer.mode.agent': 'Agent',
  'chat.composer.mode.read': 'Read',
  'chat.composer.mode.off': 'Off',
  'chat.composer.controls': 'Assistant controls',
  'chat.composer.contextLabel': 'Context',
  'chat.composer.maskedLabel': 'Masked',
  'chat.composer.modeLabel': 'Mode',
  'model.switch.title': 'Switch model',
  'model.switch.search': 'Search models from current provider...',
  'model.switch.all': 'Available models',
  'model.switch.category': 'Model',
  'model.switch.current': 'Current chat model.',
  'model.switch.choose': 'Use this model for the next assistant request.',
  'model.switch.loadDescription': 'Open provider settings or test the current provider to load models.',
  'chat.send': 'Send (Enter)',
  'chat.stopAgent': 'Stop agent',
  'chat.role.user': 'user',
  'chat.role.assistant': 'assistant',
  'chat.commandOutput.label': 'output sent to assistant',
  'chat.commandOutput.hiddenLabel': 'output hidden from assistant',
  'chat.commandOutput.show': 'Show output',
  'chat.commandOutput.noOutput': '(no output)',
  'chat.commandEdited.label': 'command edited before run',
  'chat.commandEdited.original': 'Original',
  'chat.commandEdited.final': 'Run',
  'chat.thinking': 'Thinking',
  'chat.regenerate': 'Regenerate',
  'chat.forkFromMessage': 'Fork from here',
  'chat.forked': 'Forked chat from selected message.',
  'chat.connectProvider': 'Connect provider',
  'chat.saveAsPrompt': 'Save as prompt',
  'chat.savePrompt.generating': 'Generating prompt…',
  'chat.savePrompt.save': 'Save',
  'chat.savePrompt.saving': 'Saving…',
  'chat.savePrompt.saved': 'Saved ✓',
  'chat.savePrompt.error': 'Failed to save',
  'chat.history': 'Chat History',
  'chat.historySearch': 'Search chats…',
  'chat.historyEmpty': 'No saved chats yet',
  'chat.historyNoMatch': 'No chats matching "{query}"',
  'chat.historyMessages': 'messages',
  'chat.historyDelete': 'Delete',
  'chat.historyDeleteConfirmTitle': 'Delete chat?',
  'chat.historyDeleteConfirmMessage': 'This saved chat will be deleted. This action cannot be undone.',
  'chat.historyDeleteConfirmBtn': 'Delete',

  'onboarding.title': 'Activate Taviraq',
  'onboarding.body': 'Connect a provider, pick a model, then ask about the active terminal.',
  'onboarding.provider': 'Choose provider',
  'onboarding.apiKey': 'Add API key',
  'onboarding.endpoint': 'Check local endpoint',
  'onboarding.apiKeyPlaceholder': 'Paste API key stored in Keychain...',
  'onboarding.localProviderNote': 'Local providers can run without an API key. Make sure the server is running.',
  'onboarding.test': 'Test connection',
  'onboarding.testConnection': 'Test and load models',
  'onboarding.apiKeyRequired': 'Enter an API key before testing this provider.',
  'onboarding.model': 'Pick model',
  'onboarding.firstQuestion': 'Ask first question',
  'onboarding.firstQuestionPrompt': 'Explain what is happening in this terminal and suggest the next useful command.',

  'confirm.reviewRisky': 'Review risky command',
  'confirm.safetyUnavailable': 'Safety check unavailable',
  'confirm.review': 'review',
  'confirm.warning': 'warning',
  'confirm.command': 'Command',
  'confirm.reason': 'Reason',
  'confirm.agentPaused': 'Agent is paused until you choose what to do.',
  'confirm.cancel': 'Cancel',
  'confirm.runCommand': 'Run command',
  'confirm.runAnyway': 'Run anyway',
  'confirm.shortcutHint': 'Enter confirms · Esc cancels',
  'confirm.destructiveWarning': 'This command may cause irreversible changes. Please review carefully.',
  'confirm.confirmCountdown': 'Confirm ({seconds}s)',
  'confirm.commandApproved': '⚠️ Command confirmed: {{command}}',
  'confirm.commandRejected': '❌ Command rejected: {{command}}',
  'commandRisk.localSecret': 'This command uses a local secret and must be reviewed before Taviraq resolves it.',
  'commandRisk.sshContext': 'The active session is SSH ({label}), so remote-side effects need explicit review.',
  'commandRisk.requiresConfirmation': 'Taviraq requires confirmation before running it.',

  'status.checkingSafety': 'Checking command safety...',
  'status.agentStopped.riskyCommand': 'Agent stopped before running a risky command.',
  'status.agentStopped.safetyUnchecked': 'Agent stopped because command safety could not be checked.',
  'status.agentStopped.tenSteps': 'Agent stopped after 10 steps.',
  'status.riskyCommandConfirmed': 'Risky command confirmed by user.',
  'status.safetyFailedConfirmed': 'Safety check failed; command confirmed by user.',
  'status.noSession.agent': 'Open a terminal session before starting the agent.',
  'status.noSession.run': 'Open a terminal session before running a command.',
  'status.disconnected.run': 'Reconnect this session before running commands.',
  'status.commandAlreadyRunning': 'A command is already running in this session.',
  'status.modelLoading': 'Loading model {percent}%',
  'status.promptProcessing': 'Processing prompt {percent}%',
  'status.blockPromptQueued': 'Assistant is busy. Block prompt was placed in the input.',
  'status.privacyMasked': '{count} secret(s) masked before sending to LLM.',

  'chip.space': "What's taking space?",
  'chip.spacePrompt': "What's taking the most disk space here?",
  'chip.processes': 'Check running processes',
  'chip.processesPrompt': 'Check the most important running processes.',
  'chip.lastCommand': 'Explain last command',
  'chip.lastCommandPrompt': 'Explain the last terminal command and its output.',
  'chip.selection': 'Explain selected text',
  'chip.selectionPrompt': 'Explain the selected terminal output.',
  'chip.git': 'Show uncommitted changes',
  'chip.gitPrompt': 'Show me the uncommitted changes in this project.',
  'chip.docker': 'Clean up Docker safely',
  'chip.dockerPrompt': 'Find safe Docker cleanup opportunities.',
  'chip.logs': 'Find largest logs',
  'chip.logsPrompt': 'Find the largest log files and suggest safe cleanup.',
  'chip.disk': 'Summarize disk usage',
  'chip.diskPrompt': 'Summarize what is taking the most disk space.',

  'agent.step': 'Step {step} — {state}',
  'agent.waiting': 'waiting for review',
  'agent.running': 'running',

  'model.noMatch': 'No matching models',
  'model.loadFirst': 'Load models to search',
  'model.loadModelsFirst': 'Load models first',
  'model.showing': 'Showing {visible} of {total}',
  'model.supportsMcp': 'Likely supports MCP',

  'snippetPalette.title': 'Command snippets',
  'snippetPalette.search': 'Search command snippets...',
  'snippetPalette.enterInserts': 'Enter inserts',
  'snippetPalette.metaEnterRuns': '⌘Enter runs',
  'snippetPalette.addSnippet': 'Add snippet',
  'snippetPalette.runNow': 'Run now',
  'snippetPalette.empty': 'No command snippets yet.',
  'snippetPalette.emptyCta': 'Add snippet',
  'snippetPalette.noMatch': 'No matching snippets.',

  'commandPalette.title': 'Command palette',
  'commandPalette.search': 'Search actions, tabs, prompts, snippets...',
  'commandPalette.recent': 'Recent',
  'commandPalette.all': 'All actions',
  'commandPalette.commands': 'Commands',
  'commandPalette.snippets': 'Snippets',
  'commandPalette.prompts': 'Prompts',
  'commandPalette.noMatch': 'No matching actions.',
  'commandPalette.enterSelects': 'Enter selects',
  'commandPalette.action.open': 'Opens',
  'commandPalette.action.run': 'Runs',
  'commandPalette.action.insert': 'Inserts',
  'commandPalette.action.select': 'Selects',
  'commandPalette.escapeCloses': 'Esc closes',

  'promptPalette.title': 'Prompts',
  'promptPalette.search': 'Search prompts...',
  'promptPalette.enterInserts': 'Enter inserts',
  'promptPalette.addPrompt': 'Add prompt',
  'promptPalette.empty': 'No prompts yet.',
  'promptPalette.emptyCta': 'Add prompt',
  'promptPalette.noMatch': 'No matching prompts.',

  'update.downloading': 'Downloading update… {percent}%',
  'update.downloaded': 'Update {version} is ready to install.',
  'update.restart': 'Restart',
  'update.dismiss': 'Later',
  'telemetry.consent.title': 'Help improve Taviraq?',
  'telemetry.consent.body': 'Share anonymous, aggregate usage events (like first launch and first AI request) so we can improve onboarding. No terminal content, commands, or personal data is ever collected. Off by default — you can change this anytime in Settings → Security & Privacy.',
  'telemetry.consent.accept': 'Share anonymous usage',
  'telemetry.consent.decline': 'No thanks',
  'security.telemetry.label': 'Anonymous usage telemetry',
  'security.telemetry.desc': 'Opt-in, aggregate activation events only — no terminal content, commands, or personal data. Sent only from signed release builds.',
  'security.telemetry.on': 'Telemetry on',
  'security.telemetry.off': 'Telemetry off',
  'security.telemetry.onState': 'Sharing',
  'security.telemetry.offState': 'Not sharing',
  'security.telemetry.inactiveState': 'On — inactive in this build',
}

export const ru: Translations = {
  'settings.title': 'Настройки',
  'settings.close': 'Закрыть настройки',
  'settings.tab.appearance': 'Внешний вид',
  'settings.tab.providers': 'Провайдеры',
  'settings.tab.mcp': 'MCP',
  'settings.tab.connections': 'Подключения',
  'settings.tab.security': 'Безопасность',
  'settings.tab.chatTools': 'Инструменты чата',
  'settings.tab.prompts': 'Промпты',
  'settings.tab.snippets': 'Сниппеты',
  'settings.tab.data': 'Данные',
  'settings.search': 'Поиск настроек',
  'settings.search.empty.title': 'По запросу «{query}» ничего не найдено',
  'settings.search.empty.hint': 'Попробуйте ближайший раздел или ищите по названию настройки, shortcut, provider, model, SSH, prompt, snippet или export.',
  'settings.search.empty.didYouMean': 'Похожие разделы',
  'settings.search.empty.sections': 'Все разделы настроек',
  'settings.search.empty.examples': 'Примеры: API key, terminal font, SSH host, secret masking, command snippet.',
  'status.saved': 'Сохранено',

  'appearance.title': 'Внешний вид',
  'appearance.group.typography': 'Типографика',
  'appearance.group.cursor': 'Курсор',
  'appearance.group.terminal': 'Терминал',
  'appearance.group.window': 'Окно',
  'appearance.fontFamily.label': 'Шрифт терминала',
  'appearance.fontFamily.desc': 'Моноширинный стек для всех сессий терминала',
  'appearance.fontSize.label': 'Размер шрифта терминала',
  'appearance.fontSize.desc': 'Применяется ко всем сессиям терминала, 8-32 px',
  'appearance.fontSize.applied': 'применено {value}px',
  'appearance.lineHeight.label': 'Высота строки',
  'appearance.lineHeight.desc': 'Интервал строк терминала, 1.0-2.0',
  'appearance.cursorStyle.label': 'Стиль курсора',
  'appearance.cursorStyle.desc': 'Форма активного курсора терминала',
  'appearance.cursorStyle.block': 'Блок',
  'appearance.cursorStyle.underline': 'Подчёркивание',
  'appearance.cursorStyle.bar': 'Черта',
  'appearance.cursorBlink.label': 'Мигание курсора',
  'appearance.cursorBlink.desc': 'Анимировать активный курсор в фокусе терминала',
  'appearance.scrollback.label': 'История вывода',
  'appearance.scrollback.desc': 'Строки, сохраняемые в истории терминала, 100-100000',
  'appearance.windowOpacity.label': 'Прозрачность окна',
  'appearance.windowOpacity.desc': 'Мягкая прозрачность окна приложения, 90-100%',
  'appearance.preview.title': 'Живой предпросмотр',
  'appearance.preview.command': 'npm run build',
  'appearance.language.label': 'Язык',
  'appearance.language.desc': 'Язык интерфейса и ответов ИИ',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',
  'appearance.hideShortcut.label': 'Скрыть/показать окно',
  'appearance.hideShortcut.desc': 'Глобальный шорткат для переключения видимости окна',
  'appearance.hideShortcut.recording': 'Нажмите сочетание клавиш...',
  'appearance.hideShortcut.conflict': 'Шорткат {shortcut} занят системой и не может быть назначен',
  'appearance.outputContext.label': 'Контекст вывода для ИИ',
  'appearance.outputContext.desc': 'Недавний вывод терминала, который увидит ИИ. Минимум 1 000 символов',
  'appearance.theme.label': 'Тема',
  'appearance.theme.desc': 'Цветовая схема интерфейса и терминала',

  'providers.title': 'Провайдеры',
  'providers.type': 'Тип провайдера',
  'providers.type.openai': 'OpenAI-совместимый',
  'providers.type.ollama': 'Ollama',
  'providers.type.lmstudio': 'LM Studio',
  'providers.type.anthropic': 'Anthropic',
  'providers.name': 'Название провайдера',
  'providers.baseUrl': 'Базовый URL',
  'providers.proxyUrl': 'URL HTTP(S)-прокси',
  'providers.proxyUsername': 'Логин прокси',
  'providers.proxyPassword': 'Пароль прокси',
  'providers.proxyPassword.saved': 'сохранён в связке ключей',
  'providers.proxyPassword.change': 'Изменить',
  'providers.proxyPassword.clear': 'Удалить сохранённый пароль прокси',
  'providers.proxyPassword.placeholder': 'Введите пароль прокси…',
  'providers.proxyPassword.replacePlaceholder': 'Введите новый пароль прокси…',
  'providers.proxy.save': 'Сохранить прокси',
  'providers.apiKey': 'API-ключ',
  'providers.allowInsecureTls': 'Разрешить небезопасный TLS',
  'providers.allowInsecureTls.desc': 'Используйте только для доверенных внутренних endpoints с самоподписанными сертификатами.',
  'providers.apiKey.saved': 'сохранён в связке ключей',
  'providers.apiKey.change': 'Изменить',
  'providers.apiKey.placeholder': 'Введите API-ключ…',
  'providers.apiKey.replacePlaceholder': 'Введите новый ключ для замены…',
  'providers.save': 'Сохранить провайдера',
  'providers.testConnection': 'Проверить подключение',
  'providers.testing': 'Проверка...',
  'providers.fetchModels': 'Загрузить модели',
  'providers.addProvider': 'Добавить провайдера',
  'providers.deleteProvider': 'Удалить провайдера',
  'providers.deleteConfirmTitle': 'Удалить провайдера?',
  'providers.deleteConfirmMessage': 'Конфигурация провайдера и сохранённый секрет из keychain будут удалены.',
  'providers.deleteConfirmBtn': 'Удалить',
  'providers.active': 'активный',
  'providers.draft': 'новый',
  'providers.unnamed': 'Без имени',
  'providers.chatModel': 'Модель чата',
  'providers.safetyModel': 'Модель проверки безопасности',
  'providers.searchChatModel': 'Поиск модели чата',
  'providers.searchSafetyModel': 'Поиск модели безопасности',
  'providers.status.active': 'активный',
  'providers.status.activeReady': 'активный · готов',
  'providers.status.activeLocal': 'активный · локальный',
  'providers.status.ready': 'готов',
  'providers.status.error': 'ошибка',
  'providers.status.noKey': 'нет ключа',
  'providers.status.checking': 'проверка',
  'providers.status.notTested': 'не проверен',
  'providers.status.local': 'локальный',
  'providers.status.action.noKey': 'Ввести API-ключ',
  'providers.status.action.select': 'Выбрать провайдера',
  'providers.status.action.test': 'Проверить подключение',
  'providers.status.action.ready': 'Проверить ещё раз',
  'providers.status.action.checking': 'Проверка подключения уже идёт',

  'mcp.title': 'MCP-серверы',
  'mcp.servers': 'Серверы',
  'mcp.addServer': 'Добавить MCP-сервер',
  'mcp.empty': 'MCP-серверов пока нет.',
  'mcp.enabled': 'Включён',
  'mcp.enabled.desc': 'Сервер будет доступен для моделей с поддержкой MCP.',
  'mcp.status.enabled': 'Включён',
  'mcp.status.disabled': 'Выключен',
  'mcp.name': 'Название сервера',
  'mcp.command': 'Команда',
  'mcp.args': 'Аргументы',
  'mcp.env': 'Переменные окружения',
  'mcp.save': 'Сохранить MCP-сервер',
  'mcp.enable': 'Включить',
  'mcp.disable': 'Отключить',
  'mcp.deleteServer': 'Удалить MCP-сервер',
  'mcp.deleteConfirmTitle': 'Удалить MCP-сервер?',
  'mcp.deleteConfirmMessage': 'Этот MCP-сервер будет удалён из mcp.json.',
  'mcp.deleteConfirmBtn': 'Удалить',
  'mcp.tools.title': 'Инструменты',
  'mcp.tools.refresh': 'Обновить инструменты',
  'mcp.tools.refreshing': 'Обновляем инструменты...',
  'mcp.tools.refreshed': 'Найдено инструментов: {count}.',
  'mcp.tools.empty': 'Сохраните сервер, обновите инструменты и включите только те, которые ассистенту можно использовать.',
  'mcp.discovery.title': 'Импорт из других инструментов',
  'mcp.discovery.desc': 'Поиск читает известные локальные MCP-конфиги Claude, VS Code Copilot, Codex, OpenCode, LM Studio, Ollama-bridge, Cursor и Windsurf только после этого запроса. Найденные серверы можно проверить перед импортом.',
  'mcp.discovery.scan': 'Найти',
  'mcp.discovery.scanning': 'Поиск...',
  'mcp.importSelected': 'Импортировать выбранные',
  'mcp.status.required': 'Введите название сервера и команду.',
  'mcp.status.saving': 'Сохраняем MCP-сервер...',
  'mcp.status.discovering': 'Ищем MCP-конфиги...',
  'mcp.status.noneFound': 'MCP-серверы не найдены.',
  'mcp.status.selectImport': 'Выберите хотя бы один сервер для импорта.',
  'mcp.status.importing': 'Импортируем MCP-серверы...',
  'mcp.status.duplicateName': 'Используйте уникальное название MCP-сервера.',

  'connections.title': 'SSH-подключения',
  'connections.addConnection': 'Добавить подключение',
  'connections.deleteConnection': 'Удалить подключение',
  'connections.deleteConfirmTitle': 'Удалить SSH-подключение?',
  'connections.deleteConfirmMessage': 'Сохранённое SSH-подключение будет удалено.',
  'connections.deleteConfirmBtn': 'Удалить',
  'connections.save': 'Сохранить',
  'connections.connect': 'Подключиться',
  'connections.name': 'Имя',
  'connections.host': 'Хост',
  'connections.user': 'Пользователь',
  'connections.port': 'Порт',
  'connections.identityFile': 'Файл ключа',
  'connections.browseIdentityFile': 'Выбрать',
  'connections.extraArgs': 'Доп. аргументы',
  'connections.unnamed': 'Без имени',
  'connections.noConnections': 'Нет SSH-подключений.',
  'connections.emptyCta': 'Добавить первое подключение',
  'connections.newConnection': 'Новое подключение',
  'connections.tab.newLocal': 'Новый локальный терминал',

  'chatTools.title': 'Инструменты чата',
  'chatTools.taskList.label': 'Список задач и планирование',
  'chatTools.taskList.desc': 'Когда включено, ассистент составляет список задач для сложных многошаговых запросов и отмечает прогресс по мере выполнения каждого шага. По умолчанию выключено — агент-режим сохраняет текущее поведение, пока вы не включите эту опцию.',
  'chatTools.taskList.on': 'Вкл',
  'chatTools.taskList.off': 'Выкл',
  'taskList.title': 'Список задач',
  'taskList.progress': 'Готово {done} из {total}',
'taskList.showSteps': 'Показать шаги ({done} из {total})',
  'taskList.hideSteps': 'Свернуть шаги',
  'taskList.currentStep': 'Текущий шаг',
  'taskList.showMore': 'Показать полностью',
  'taskList.showLess': 'Свернуть',
  'security.title': 'Безопасность',
  'security.secretMasking.label': 'Маскирование секретов',
  'security.secretMasking.desc': 'Локальная проверка чата, контекста терминала, команд и саммари',
  'security.secretMasking.off': 'Выкл.',
  'security.secretMasking.on': 'Вкл.',
  'security.secretMasking.onState': 'Защищено',
  'security.secretMasking.offState': 'Не защищено',
  'security.secretMasking.noScopesState': 'Нет активной защиты',
  'security.secretMasking.onDesc': 'Защита включена для выбранных областей.',
  'security.secretMasking.offDesc': 'Определение секретов отключено.',
  'security.secretMasking.noScopesDesc': 'Не включены запросы провайдеру, отображение или строгий контекст.',
  'security.secretMasking.warning': 'Чувствительные данные могут быть отправлены провайдеру.',
  'security.secretMasking.noScopesWarning': 'Ничего не защищено, пока не включена хотя бы одна область.',
  'security.maskedSecret.inline': '[secret]',
  'security.summary.categories': 'Активные категории',
  'security.summary.scopes': 'Активная защита',
  'security.summary.audit': 'События аудита',
  'security.summary.noScopes': 'Нет',
  'security.scopes.title': 'Область маскирования и политика контекста',
  'security.scope.providerPayloads': 'Запросы провайдеру',
  'security.scope.providerPayloads.short': 'Провайдер',
  'security.scope.providerPayloads.desc': 'Заменять секреты до отправки запросов с устройства.',
  'security.scope.chatDisplay': 'Отображение чата',
  'security.scope.chatDisplay.short': 'Экран',
  'security.scope.chatDisplay.desc': 'Скрывать секреты в чате, выводе команд и истории.',
  'security.strictMode': 'Строгий контекст терминала',
  'security.strictMode.short': 'Строгий контекст',
  'security.strictMode.desc': 'Не включать выделенный текст и вывод терминала в запросы провайдеру.',
  'security.patterns.title': 'Активные категории детекции',
  'security.category.apiKeys': 'API-ключи',
  'security.category.apiKeys.desc': 'Ключи провайдеров, OpenAI-формат и переменные API key.',
  'security.category.tokens': 'Токены',
  'security.category.tokens.desc': 'Bearer, access, refresh, auth, deploy и webhook токены.',
  'security.category.passwords': 'Пароли',
  'security.category.passwords.desc': 'Переменные password, passwd, pwd и secret.',
  'security.category.aws': 'AWS-ключи',
  'security.category.aws.desc': 'AWS access keys и облачные секреты, найденные Gitleaks.',
  'security.category.sshMaterial': 'SSH-материалы',
  'security.category.sshMaterial.desc': 'Приватные ключи и секреты identity file.',
  'security.category.urlCredentials': 'Учетные данные в URL',
  'security.category.urlCredentials.desc': 'Пароли внутри HTTP или HTTPS URL.',
  'security.category.customRegex': 'Пользовательские regex',
  'security.category.customRegex.count': '{count} активных пользовательских паттернов',
  'security.category.customRegex.empty': 'Активных паттернов нет',
  'security.customPatterns.title': 'Пользовательские правила маскирования',
  'security.customPatterns.name': 'Название правила',
  'security.customPatterns.regex': 'Regex; первая группа маскируется, если есть',
  'security.customPatterns.add': 'Добавить',
  'security.customPatterns.empty': 'Пользовательских правил пока нет.',
  'security.customPatterns.required': 'Введите название и regex.',
  'security.customPatterns.invalid': 'Regex некорректен.',
  'security.customPatterns.unsafe': 'Regex слишком широкий или сложный для маскирования в реальном времени.',
  'security.customPatterns.enable': 'Включить правило',
  'security.customPatterns.disable': 'Отключить правило',
  'security.audit.title': 'Журнал маскирования',
  'security.audit.clear': 'Очистить',
  'security.audit.empty': 'Событий маскирования пока нет.',
  'security.audit.maskedCount': '{count} скрыто',
  'security.audit.scope.provider': 'Запрос провайдеру',
  'security.audit.scope.display': 'Отображение чата',
  'security.audit.source.chatStream': 'Запрос ассистента',
  'security.audit.source.chatDisplay': 'Отображение чата',
  'security.audit.source.commandRisk': 'Проверка команды',
  'security.audit.source.summary': 'Саммари промпта',
  'security.audit.source.terminalDisplay': 'Вывод терминала',
  'security.audit.source.chatStorage': 'Сохраненный чат',
  'privacy.trustCard.title': 'Маскирование приватных данных',
  'privacy.trustCard.categories': 'Категории',
  'privacy.trustCard.context': 'Источник',
  'privacy.trustCard.note': 'Значения остаются скрытыми. При необходимости настройте правила в разделе безопасности.',
  'privacy.trustCard.openSettings': 'Настройки безопасности',

  'prompts.title': 'Промпты',
  'prompts.importFromFile': 'Импорт из файла',
  'prompts.addPrompt': 'Добавить промпт',
  'prompts.savePrompt': 'Сохранить промпт',
  'prompts.cancel': 'Отмена',
  'prompts.noPrompts': 'Нет промптов. Добавьте или импортируйте файл Markdown.',
  'prompts.namePlaceholder': 'Название промпта',
  'prompts.contentPlaceholder': 'Содержание промпта…',
  'prompts.edit': 'Редактировать',
  'prompts.delete': 'Удалить',
  'prompts.deleteConfirmTitle': 'Удалить промпт?',
  'prompts.deleteConfirmMessage': 'Это действие нельзя отменить.',
  'prompts.deleteConfirmBtn': 'Удалить',
  'prompts.duplicateName': 'Промпт с таким именем уже существует.',

  'snippets.title': 'Сниппеты команд',
  'snippets.quickHint': 'Быстрый вызов: ⌘⇧K. Enter вставляет, ⌘Enter запускает.',
  'snippets.addSnippet': 'Добавить сниппет',
  'snippets.saveSnippet': 'Сохранить сниппет',
  'snippets.noSnippets': 'Сниппетов команд пока нет. Добавьте первый ниже.',
  'snippets.namePlaceholder': 'Название сниппета',
  'snippets.commandPlaceholder': 'Команда терминала…',
  'snippets.edit': 'Редактировать',
  'snippets.delete': 'Удалить',
  'snippets.deleteConfirmTitle': 'Удалить сниппет команды?',
  'snippets.deleteConfirmMessage': 'Это действие нельзя отменить.',
  'snippets.deleteConfirmBtn': 'Удалить',
  'snippets.duplicateName': 'Сниппет команды с таким именем уже существует.',

  'data.title': 'Данные',
  'data.usage.title': 'Локальное использование',
  'data.usage.desc': 'Хранится только на этом Mac. Анонимная телеметрия по умолчанию выключена и отправляется только с вашего согласия (Безопасность и приватность).',
  'data.usage.storage': 'Занято места',
  'data.usage.chats': 'Сохранённые чаты',
  'data.usage.sessions': 'Сохранённые сессии',
  'data.exportImport.label': 'Экспорт / Импорт',
  'data.exportImport.desc': 'JSON-бэкап: провайдеры, промпты, сниппеты команд и настройки',
  'data.export': 'Экспорт',
  'data.import': 'Импорт',
  'data.restoreSessions.label': 'Восстанавливать вкладки и историю',
  'data.restoreSessions.desc': 'Открывать вкладки с выводом терминала и историей ассистента при запуске',
  'data.clearSessions.label': 'Сохранённое состояние сессий',
  'data.clearSessions.desc': 'Удалить сохранённые вкладки и вывод, не меняя текущие вкладки',
  'data.clearSessions': 'Очистить состояние',
  'data.clearSessionsConfirmTitle': 'Очистить сохранённое состояние?',
  'data.clearSessionsConfirmMessage': 'Сохранённые вкладки и вывод будут удалены. Текущие вкладки останутся открытыми.',
  'data.clearSessionsConfirmBtn': 'Очистить',
  'data.clearChatHistory.label': 'История чатов',
  'data.clearChatHistory.desc': 'Удалить все сохранённые разговоры',
  'data.clearChatHistory': 'Очистить историю',
  'data.clearChatHistory.done': 'История чатов очищена',
  'data.clearChatHistoryConfirmTitle': 'Очистить историю чатов?',
  'data.clearChatHistoryConfirmMessage': 'Все сохранённые разговоры будут удалены. Это действие нельзя отменить.',
  'data.clearChatHistoryConfirmBtn': 'Очистить',
  'data.dangerZone': 'Зона опасности',

  'terminal.sshDisconnected': 'SSH-сессия отключена',
  'terminal.reconnect': 'Подключиться',
  'terminal.searchPlaceholder': 'Поиск в терминале',
  'terminal.searchNoResults': 'Нет результатов',
  'terminal.searchPrevious': 'Предыдущее совпадение',
  'terminal.searchNext': 'Следующее совпадение',
  'terminal.searchClose': 'Закрыть поиск',
  'terminal.blocks.select': 'Выбрать',
  'terminal.blocks.deselect': 'Снять',
  'terminal.blocks.askAi': 'Спросить ИИ',
  'terminal.blocks.copyBlock': 'Копировать блок',
  'terminal.blocks.copyCommand': 'Копировать команду',
  'terminal.blocks.copyOutput': 'Копировать вывод',
  'terminal.blocks.commandUnavailable': 'Команда недоступна',
  'terminal.blocks.rerunCommand': 'Запустить снова',
  'terminal.blocks.rerunTitle': 'Запустить выбранную команду снова?',
  'terminal.blocks.rerunBody': 'Команда будет отправлена в активную сессию терминала.',
  'terminal.blocks.rerunConfirm': 'Запустить снова',
  'terminal.blocks.saveSnippet': 'Сохранить сниппет',
  'terminal.blocks.clearSelection': 'Снять выделение',
  'terminal.blocks.sendTitle': 'Отправить выбранные блоки в чат?',
  'terminal.blocks.sendBody': 'В чат попадут команды и весь выбранный вывод терминала. Проверьте, что там нет токенов, ключей, паролей, приватных путей или других чувствительных данных.',
  'terminal.blocks.send': 'Отправить',
  'terminal.blocks.selectedCount': 'Выбрано блоков: {count}',
  'terminal.blocks.askPrompt': 'Разбери выбранные блоки терминала: объясни, что выполнялось, что означает вывод, есть ли ошибки и какие следующие шаги разумны.',
  'terminal.blocks.label': 'Блок {index}',
  'terminal.noActiveSession': 'Нет активной сессии терминала.',

  'panel.agent': 'Агент',
  'panel.agentToggle.enable': 'Включить режим агента',
  'panel.agentToggle.disable': 'Перейти в режим только чтения',
  'panel.newChat': 'Новый чат',
  'panel.settings': 'Настройки',
  'panel.permission.read': 'Чтение',
  'panel.permission.execute': 'Выполняет команды',
  'panel.permission.pending': 'Ожидание',
  'panel.permission.summary': 'Сессия и права ассистента',
  'panel.permission.none': 'Нет доступа к терминалу',
  'panel.permission.readOnly': 'Читает контекст терминала',
  'panel.permission.readExecute': 'Читает контекст терминала и выполняет команды',
  'panel.shell.label': 'Оболочка: {shell}',
  'panel.status.idle': 'Ожидание',
  'panel.status.running': 'Работает',
  'panel.status.waiting': 'Ждёт подтв.',
  'sidebar.openHandle': 'Открыть ассистента (⌘\\)',
  'app.terminalToolbar': 'Панель терминала',
  'app.newTerminal': 'Новый терминал (⌘T)',
  'app.closeSession': 'Закрыть сессию (⌘W)',
  'app.settings': 'Настройки (⌘,)',
  'app.showSidebar': 'Показать ассистента (⌘\\)',
  'app.hideSidebar': 'Скрыть ассистента (⌘\\)',
  'chat.runInTerminal': 'Запустить в терминале',
  'chat.showFullCommand': 'Показать команду целиком',
  'chat.collapseCommand': 'Свернуть команду',
  'chat.copyCode': 'Копировать код',
  'chat.copyMessage': 'Копировать сообщение',
  'chat.copied': 'Скопировано',
  'panel.promptLibrary': 'Библиотека промптов (⌘⇧J)',

  'chat.empty.title': 'Готов помочь',
  'chat.empty.body': 'Спросите о терминале, командах или выделенном тексте',
  'chat.input.placeholder': 'Спросите о терминале…',
  'chat.input.tooltip': 'Enter отправляет. Shift+Enter добавляет новую строку.',
  'chat.composer.context': 'Контекст ~{count} токенов',
  'chat.composer.maskedSecrets': 'Скрыто {count}',
  'chat.composer.mode.agent': 'Агент',
  'chat.composer.mode.read': 'Чтение',
  'chat.composer.mode.off': 'Выкл.',
  'chat.composer.controls': 'Настройки ассистента',
  'chat.composer.contextLabel': 'Контекст',
  'chat.composer.maskedLabel': 'Скрыто',
  'chat.composer.modeLabel': 'Режим',
  'model.switch.title': 'Сменить модель',
  'model.switch.search': 'Поиск моделей текущего провайдера...',
  'model.switch.all': 'Доступные модели',
  'model.switch.category': 'Модель',
  'model.switch.current': 'Текущая модель чата.',
  'model.switch.choose': 'Использовать эту модель для следующего запроса.',
  'model.switch.loadDescription': 'Откройте настройки провайдера или проверьте текущего провайдера, чтобы загрузить модели.',
  'chat.send': 'Отправить (Enter)',
  'chat.stopAgent': 'Остановить агента',
  'chat.role.user': 'пользователь',
  'chat.role.assistant': 'ассистент',
  'chat.commandOutput.label': 'вывод отправлен ассистенту',
  'chat.commandOutput.hiddenLabel': 'вывод скрыт от ассистента',
  'chat.commandOutput.show': 'Показать вывод',
  'chat.commandOutput.noOutput': '(нет вывода)',
  'chat.commandEdited.label': 'команда изменена перед запуском',
  'chat.commandEdited.original': 'Было',
  'chat.commandEdited.final': 'Запуск',
  'chat.thinking': 'Думаю',
  'chat.regenerate': 'Сгенерировать заново',
  'chat.forkFromMessage': 'Форкнуть отсюда',
  'chat.forked': 'Чат форкнут от выбранного сообщения.',
  'chat.connectProvider': 'Подключить провайдера',
  'chat.saveAsPrompt': 'Сохранить как промпт',
  'chat.savePrompt.generating': 'Генерирую промпт…',
  'chat.savePrompt.save': 'Сохранить',
  'chat.savePrompt.saving': 'Сохраняю…',
  'chat.savePrompt.saved': 'Сохранено ✓',
  'chat.savePrompt.error': 'Ошибка сохранения',
  'chat.history': 'История чатов',
  'chat.historySearch': 'Поиск чатов…',
  'chat.historyEmpty': 'Нет сохранённых чатов',
  'chat.historyNoMatch': 'Нет чатов по запросу «{query}»',
  'chat.historyMessages': 'сообщений',
  'chat.historyDelete': 'Удалить',
  'chat.historyDeleteConfirmTitle': 'Удалить чат?',
  'chat.historyDeleteConfirmMessage': 'Сохранённый чат будет удалён. Это действие нельзя отменить.',
  'chat.historyDeleteConfirmBtn': 'Удалить',

  'onboarding.title': 'Активируйте Taviraq',
  'onboarding.body': 'Подключите провайдера, выберите модель и задайте первый вопрос по активному терминалу.',
  'onboarding.provider': 'Выберите провайдера',
  'onboarding.apiKey': 'Добавьте API-ключ',
  'onboarding.endpoint': 'Проверьте локальный endpoint',
  'onboarding.apiKeyPlaceholder': 'Вставьте API-ключ для хранения в Keychain...',
  'onboarding.localProviderNote': 'Локальные провайдеры могут работать без API-ключа. Убедитесь, что сервер запущен.',
  'onboarding.test': 'Проверьте подключение',
  'onboarding.testConnection': 'Проверить и загрузить модели',
  'onboarding.apiKeyRequired': 'Введите API-ключ перед проверкой этого провайдера.',
  'onboarding.model': 'Выберите модель',
  'onboarding.firstQuestion': 'Задать первый вопрос',
  'onboarding.firstQuestionPrompt': 'Объясни, что происходит в этом терминале, и предложи следующую полезную команду.',

  'confirm.reviewRisky': 'Проверьте опасную команду',
  'confirm.safetyUnavailable': 'Проверка безопасности недоступна',
  'confirm.review': 'проверка',
  'confirm.warning': 'предупреждение',
  'confirm.command': 'Команда',
  'confirm.reason': 'Причина',
  'confirm.agentPaused': 'Агент приостановлен до вашего выбора.',
  'confirm.cancel': 'Отмена',
  'confirm.runCommand': 'Выполнить команду',
  'confirm.runAnyway': 'Всё равно выполнить',
  'confirm.shortcutHint': 'Enter подтверждает · Esc отменяет',
  'confirm.destructiveWarning': 'Эта команда может вызвать необратимые изменения. Пожалуйста, внимательно проверьте.',
  'confirm.confirmCountdown': 'Подтвердить ({seconds} с)',
  'confirm.commandApproved': '⚠️ Команда подтверждена: {{command}}',
  'confirm.commandRejected': '❌ Команда отклонена: {{command}}',
  'commandRisk.localSecret': 'Команда содержит локальный секрет. Подтвердите подстановку секрета в команду.',
  'commandRisk.sshContext': 'Активная сессия — SSH ({label}), поэтому удалённые изменения требуют явной проверки.',
  'commandRisk.requiresConfirmation': 'Taviraq требует подтверждения перед выполнением.',

  'status.checkingSafety': 'Проверка безопасности команды...',
  'status.agentStopped.riskyCommand': 'Агент остановлен перед выполнением опасной команды.',
  'status.agentStopped.safetyUnchecked': 'Агент остановлен: не удалось проверить безопасность команды.',
  'status.agentStopped.tenSteps': 'Агент остановлен после 10 шагов.',
  'status.riskyCommandConfirmed': 'Опасная команда подтверждена пользователем.',
  'status.safetyFailedConfirmed': 'Проверка безопасности не выполнена; команда подтверждена.',
  'status.noSession.agent': 'Откройте сессию терминала перед запуском агента.',
  'status.noSession.run': 'Откройте сессию терминала перед выполнением команды.',
  'status.disconnected.run': 'Переподключите эту сессию перед выполнением команд.',
  'status.commandAlreadyRunning': 'В этой сессии уже выполняется команда.',
  'status.modelLoading': 'Загрузка модели {percent}%',
  'status.promptProcessing': 'Обработка промпта {percent}%',
  'status.blockPromptQueued': 'Ассистент занят. Промпт по блоку помещён в поле ввода.',
  'status.privacyMasked': 'Секретов скрыто перед отправкой в LLM: {count}.',

  'chip.space': 'Что занимает место?',
  'chip.spacePrompt': 'Что занимает больше всего места на диске?',
  'chip.processes': 'Проверить процессы',
  'chip.processesPrompt': 'Проверь самые важные запущенные процессы.',
  'chip.lastCommand': 'Объяснить последнюю команду',
  'chip.lastCommandPrompt': 'Объясни последнюю команду терминала и её вывод.',
  'chip.selection': 'Объяснить выделенное',
  'chip.selectionPrompt': 'Объясни выделенный текст терминала.',
  'chip.git': 'Незакоммиченные изменения',
  'chip.gitPrompt': 'Покажи незакоммиченные изменения в этом проекте.',
  'chip.docker': 'Очистить Docker',
  'chip.dockerPrompt': 'Найди безопасные способы очистки Docker.',
  'chip.logs': 'Найти большие логи',
  'chip.logsPrompt': 'Найди самые большие файлы логов и предложи безопасную очистку.',
  'chip.disk': 'Анализ использования диска',
  'chip.diskPrompt': 'Покажи, что занимает больше всего места на диске.',

  'agent.step': 'Шаг {step} — {state}',
  'agent.waiting': 'ожидание проверки',
  'agent.running': 'выполнение',

  'model.noMatch': 'Нет подходящих моделей',
  'model.loadFirst': 'Загрузите модели для поиска',
  'model.loadModelsFirst': 'Сначала загрузите модели',
  'model.showing': 'Показано {visible} из {total}',
  'model.supportsMcp': 'Вероятно поддерживает MCP',

  'snippetPalette.title': 'Сниппеты команд',
  'snippetPalette.search': 'Поиск сниппетов команд...',
  'snippetPalette.enterInserts': 'Enter вставляет',
  'snippetPalette.metaEnterRuns': '⌘Enter запускает',
  'snippetPalette.addSnippet': 'Добавить сниппет',
  'snippetPalette.runNow': 'Запустить сейчас',
  'snippetPalette.empty': 'Сниппетов команд пока нет.',
  'snippetPalette.emptyCta': 'Добавить сниппет',
  'snippetPalette.noMatch': 'Подходящих сниппетов нет.',

  'commandPalette.title': 'Палитра команд',
  'commandPalette.search': 'Поиск действий, вкладок, промптов, сниппетов...',
  'commandPalette.recent': 'Недавние',
  'commandPalette.all': 'Все действия',
  'commandPalette.commands': 'Команды',
  'commandPalette.snippets': 'Сниппеты',
  'commandPalette.prompts': 'Промпты',
  'commandPalette.noMatch': 'Подходящих действий нет.',
  'commandPalette.enterSelects': 'Enter выбирает',
  'commandPalette.action.open': 'Открывает',
  'commandPalette.action.run': 'Запускает',
  'commandPalette.action.insert': 'Вставляет',
  'commandPalette.action.select': 'Выбирает',
  'commandPalette.escapeCloses': 'Esc закрывает',

  'promptPalette.title': 'Промпты',
  'promptPalette.search': 'Поиск промптов...',
  'promptPalette.enterInserts': 'Enter вставляет',
  'promptPalette.addPrompt': 'Добавить промпт',
  'promptPalette.empty': 'Промптов пока нет.',
  'promptPalette.emptyCta': 'Добавить промпт',
  'promptPalette.noMatch': 'Подходящих промптов нет.',

  'update.downloading': 'Загрузка обновления… {percent}%',
  'update.downloaded': 'Обновление {version} готово к установке.',
  'update.restart': 'Перезапустить',
  'update.dismiss': 'Позже',
  'telemetry.consent.title': 'Помочь улучшить Taviraq?',
  'telemetry.consent.body': 'Делитесь анонимными агрегированными событиями использования (например, первый запуск и первый AI-запрос), чтобы мы улучшали онбординг. Содержимое терминала, команды и личные данные никогда не собираются. По умолчанию выключено — изменить можно в любой момент в «Настройки → Безопасность и приватность».',
  'telemetry.consent.accept': 'Делиться анонимно',
  'telemetry.consent.decline': 'Нет, спасибо',
  'security.telemetry.label': 'Анонимная телеметрия использования',
  'security.telemetry.desc': 'Только по согласию: агрегированные события активации — без содержимого терминала, команд и личных данных. Отправляется только из подписанных релизных сборок.',
  'security.telemetry.on': 'Телеметрия включена',
  'security.telemetry.off': 'Телеметрия выключена',
  'security.telemetry.onState': 'Отправляется',
  'security.telemetry.offState': 'Не отправляется',
  'security.telemetry.inactiveState': 'Включено — неактивно в этой сборке',
}

export const cn: Translations = {
  'settings.title': '设置',
  'settings.close': '关闭设置',
  'settings.tab.appearance': '外观',
  'settings.tab.providers': '提供商',
  'settings.tab.mcp': 'MCP',
  'settings.tab.connections': '连接',
  'settings.tab.security': '安全',
  'settings.tab.chatTools': '聊天工具',
  'settings.tab.prompts': '提示词',
  'settings.tab.snippets': '片段',
  'settings.tab.data': '数据',
  'settings.search': '搜索设置',
  'settings.search.empty.title': '没有找到“{query}”的结果',
  'settings.search.empty.hint': '尝试附近的部分，或搜索设置名称、快捷键、提供商、模型、SSH、提示词、片段或导出。',
  'settings.search.empty.didYouMean': '建议的部分',
  'settings.search.empty.sections': '所有设置部分',
  'settings.search.empty.examples': '示例：API key、terminal font、SSH host、secret masking、command snippet。',
  'status.saved': '已保存',

  'appearance.title': '外观',
  'appearance.group.typography': '字体',
  'appearance.group.cursor': '光标',
  'appearance.group.terminal': '终端',
  'appearance.group.window': '窗口',
  'appearance.fontFamily.label': '终端字体',
  'appearance.fontFamily.desc': '用于所有终端会话的等宽字体栈',
  'appearance.fontSize.label': '终端字体大小',
  'appearance.fontSize.desc': '应用于所有终端会话，8-32 px',
  'appearance.fontSize.applied': '已应用 {value}px',
  'appearance.lineHeight.label': '行高',
  'appearance.lineHeight.desc': '终端行间距，1.0-2.0',
  'appearance.cursorStyle.label': '光标样式',
  'appearance.cursorStyle.desc': '活动终端光标的形状',
  'appearance.cursorStyle.block': '方块',
  'appearance.cursorStyle.underline': '下划线',
  'appearance.cursorStyle.bar': '竖线',
  'appearance.cursorBlink.label': '光标闪烁',
  'appearance.cursorBlink.desc': '终端聚焦时让活动光标闪烁',
  'appearance.scrollback.label': '回滚历史',
  'appearance.scrollback.desc': '终端历史中保留的行数，100-100000',
  'appearance.windowOpacity.label': '窗口不透明度',
  'appearance.windowOpacity.desc': '轻微的应用窗口透明度，90-100%',
  'appearance.preview.title': '实时预览',
  'appearance.preview.command': 'npm run build',
  'appearance.language.label': '语言',
  'appearance.language.desc': '界面语言和AI回复语言',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',
  'appearance.hideShortcut.label': '隐藏/显示快捷键',
  'appearance.hideShortcut.desc': '用于切换窗口可见性的全局快捷键',
  'appearance.hideShortcut.recording': '按下快捷键组合...',
  'appearance.hideShortcut.conflict': '快捷键 {shortcut} 已被系统占用，无法分配',
  'appearance.outputContext.label': 'AI输出上下文',
  'appearance.outputContext.desc': '发送给 AI 的最近终端输出。最少 1,000 个字符',
  'appearance.theme.label': '主题',
  'appearance.theme.desc': '界面和终端配色方案',

  'providers.title': '提供商',
  'providers.type': '提供商类型',
  'providers.type.openai': 'OpenAI兼容',
  'providers.type.ollama': 'Ollama',
  'providers.type.lmstudio': 'LM Studio',
  'providers.type.anthropic': 'Anthropic',
  'providers.name': '提供商名称',
  'providers.baseUrl': '基础URL',
  'providers.proxyUrl': 'HTTP(S) 代理 URL',
  'providers.proxyUsername': '代理用户名',
  'providers.proxyPassword': '代理密码',
  'providers.proxyPassword.saved': '已保存到密钥链',
  'providers.proxyPassword.change': '更改',
  'providers.proxyPassword.clear': '清除已保存的代理密码',
  'providers.proxyPassword.placeholder': '输入代理密码…',
  'providers.proxyPassword.replacePlaceholder': '输入新的代理密码…',
  'providers.proxy.save': '保存代理',
  'providers.apiKey': 'API密钥',
  'providers.allowInsecureTls': '允许不安全TLS',
  'providers.allowInsecureTls.desc': '仅用于带有自签名证书的可信内部端点。',
  'providers.apiKey.saved': '已保存到密钥链',
  'providers.apiKey.change': '更改',
  'providers.apiKey.placeholder': '输入API密钥…',
  'providers.apiKey.replacePlaceholder': '输入新密钥以替换…',
  'providers.save': '保存提供商',
  'providers.testConnection': '测试连接',
  'providers.testing': '测试中...',
  'providers.fetchModels': '获取模型',
  'providers.addProvider': '添加提供商',
  'providers.deleteProvider': '删除提供商',
  'providers.deleteConfirmTitle': '删除提供商？',
  'providers.deleteConfirmMessage': '此提供商配置及其保存的钥匙串密钥将被删除。',
  'providers.deleteConfirmBtn': '删除',
  'providers.active': '活跃',
  'providers.draft': '新建',
  'providers.unnamed': '未命名',
  'providers.chatModel': '聊天模型',
  'providers.safetyModel': '命令安全模型',
  'providers.searchChatModel': '搜索聊天模型',
  'providers.searchSafetyModel': '搜索安全模型',
  'providers.status.active': '活跃',
  'providers.status.activeReady': '活跃 · 就绪',
  'providers.status.activeLocal': '活跃 · 本地',
  'providers.status.ready': '就绪',
  'providers.status.error': '错误',
  'providers.status.noKey': '无密钥',
  'providers.status.checking': '检查中',
  'providers.status.notTested': '未测试',
  'providers.status.local': '本地',
  'providers.status.action.noKey': '输入 API 密钥',
  'providers.status.action.select': '选择提供商',
  'providers.status.action.test': '测试连接',
  'providers.status.action.ready': '重新测试连接',
  'providers.status.action.checking': '连接检查正在进行',

  'mcp.title': 'MCP 服务器',
  'mcp.servers': '服务器',
  'mcp.addServer': '添加 MCP 服务器',
  'mcp.empty': '还没有 MCP 服务器。',
  'mcp.enabled': '已启用',
  'mcp.enabled.desc': '让支持 MCP 的模型可以使用此服务器。',
  'mcp.status.enabled': '已启用',
  'mcp.status.disabled': '已停用',
  'mcp.name': '服务器名称',
  'mcp.command': '命令',
  'mcp.args': '参数',
  'mcp.env': '环境变量',
  'mcp.save': '保存 MCP 服务器',
  'mcp.enable': '启用',
  'mcp.disable': '停用',
  'mcp.deleteServer': '删除 MCP 服务器',
  'mcp.deleteConfirmTitle': '删除 MCP 服务器？',
  'mcp.deleteConfirmMessage': '此 MCP 服务器将从 mcp.json 中移除。',
  'mcp.deleteConfirmBtn': '删除',
  'mcp.tools.title': '工具',
  'mcp.tools.refresh': '刷新工具',
  'mcp.tools.refreshing': '正在刷新工具...',
  'mcp.tools.refreshed': '找到 {count} 个工具。',
  'mcp.tools.empty': '保存服务器后刷新工具，然后只启用允许助手使用的工具。',
  'mcp.discovery.title': '从其他工具导入',
  'mcp.discovery.desc': '仅在本次请求后扫描 Claude、VS Code Copilot、Codex、OpenCode、LM Studio、Ollama 桥接器、Cursor 和 Windsurf 的已知本地 MCP 配置。导入前可以先检查找到的服务器。',
  'mcp.discovery.scan': '发现',
  'mcp.discovery.scanning': '扫描中...',
  'mcp.importSelected': '导入所选',
  'mcp.status.required': '请输入服务器名称和命令。',
  'mcp.status.saving': '正在保存 MCP 服务器...',
  'mcp.status.discovering': '正在查找 MCP 配置...',
  'mcp.status.noneFound': '未找到 MCP 服务器。',
  'mcp.status.selectImport': '请至少选择一个要导入的服务器。',
  'mcp.status.importing': '正在导入 MCP 服务器...',
  'mcp.status.duplicateName': '请使用唯一的 MCP 服务器名称。',

  'connections.title': 'SSH 连接',
  'connections.addConnection': '添加连接',
  'connections.deleteConnection': '删除连接',
  'connections.deleteConfirmTitle': '删除 SSH 连接？',
  'connections.deleteConfirmMessage': '此保存的 SSH 连接将被删除。',
  'connections.deleteConfirmBtn': '删除',
  'connections.save': '保存',
  'connections.connect': '连接',
  'connections.name': '名称',
  'connections.host': '主机',
  'connections.user': '用户',
  'connections.port': '端口',
  'connections.identityFile': '密钥文件',
  'connections.browseIdentityFile': '浏览',
  'connections.extraArgs': '额外参数',
  'connections.unnamed': '未命名',
  'connections.noConnections': '暂无 SSH 连接。',
  'connections.emptyCta': '添加第一个连接',
  'connections.newConnection': '新连接',
  'connections.tab.newLocal': '新建本地终端',

  'chatTools.title': '聊天工具',
  'chatTools.taskList.label': '任务列表规划',
  'chatTools.taskList.desc': '启用后，助手会为复杂的多步骤请求草拟任务列表，并在完成每个步骤时跟踪进度。默认关闭——在你开启之前，智能体模式保持当前行为。',
  'chatTools.taskList.on': '开',
  'chatTools.taskList.off': '关',
  'taskList.title': '任务列表',
  'taskList.progress': '已完成 {done} / {total}',
'taskList.showSteps': '显示步骤（{done}/{total}）',
  'taskList.hideSteps': '隐藏步骤',
  'taskList.currentStep': '当前步骤',
  'taskList.showMore': '展开',
  'taskList.showLess': '收起',
  'security.title': '安全',
  'security.secretMasking.label': '密钥遮蔽',
  'security.secretMasking.desc': '本地扫描聊天、终端上下文、命令检查和摘要',
  'security.secretMasking.off': '关闭',
  'security.secretMasking.on': '开启',
  'security.secretMasking.onState': '已保护',
  'security.secretMasking.offState': '未保护',
  'security.secretMasking.noScopesState': '没有活动保护',
  'security.secretMasking.onDesc': '已为所选区域启用保护。',
  'security.secretMasking.offDesc': '密钥检测已关闭。',
  'security.secretMasking.noScopesDesc': '未启用提供商、显示或严格上下文保护。',
  'security.secretMasking.warning': '敏感值可能会发送给提供商。',
  'security.secretMasking.noScopesWarning': '启用至少一个区域之前不会保护任何内容。',
  'security.maskedSecret.inline': '[secret]',
  'security.summary.categories': '启用类别',
  'security.summary.scopes': '活动保护',
  'security.summary.audit': '审计事件',
  'security.summary.noScopes': '无',
  'security.scopes.title': '遮蔽范围和上下文策略',
  'security.scope.providerPayloads': '提供商请求',
  'security.scope.providerPayloads.short': '提供商',
  'security.scope.providerPayloads.desc': '请求离开设备前替换密钥。',
  'security.scope.chatDisplay': '聊天显示',
  'security.scope.chatDisplay.short': '显示',
  'security.scope.chatDisplay.desc': '在聊天、命令输出和历史中隐藏密钥。',
  'security.strictMode': '严格终端上下文',
  'security.strictMode.short': '严格上下文',
  'security.strictMode.desc': '不要把选中的终端文本或输出包含在提供商请求中。',
  'security.patterns.title': '启用的检测类别',
  'security.category.apiKeys': 'API 密钥',
  'security.category.apiKeys.desc': 'OpenAI 风格密钥、提供商密钥和通用 API key 赋值。',
  'security.category.tokens': '令牌',
  'security.category.tokens.desc': 'Bearer、access、refresh、auth、deploy 和 webhook 令牌。',
  'security.category.passwords': '密码',
  'security.category.passwords.desc': 'password、passwd、pwd 和 secret 变量赋值。',
  'security.category.aws': 'AWS 密钥',
  'security.category.aws.desc': 'Gitleaks 检测到的 AWS access keys 和云凭据。',
  'security.category.sshMaterial': 'SSH 材料',
  'security.category.sshMaterial.desc': '私钥材料和 identity file 密钥。',
  'security.category.urlCredentials': 'URL 凭据',
  'security.category.urlCredentials.desc': 'HTTP 或 HTTPS URL 中嵌入的密码。',
  'security.category.customRegex': '自定义正则',
  'security.category.customRegex.count': '{count} 个已启用自定义模式',
  'security.category.customRegex.empty': '没有启用的自定义模式',
  'security.customPatterns.title': '自定义遮蔽模式',
  'security.customPatterns.name': '模式名称',
  'security.customPatterns.regex': '正则；存在第一捕获组时遮蔽该组',
  'security.customPatterns.add': '添加模式',
  'security.customPatterns.empty': '还没有自定义模式。',
  'security.customPatterns.required': '请输入名称和正则。',
  'security.customPatterns.invalid': '正则无效。',
  'security.customPatterns.unsafe': '正则过宽或过于复杂，不能用于实时遮蔽。',
  'security.customPatterns.enable': '启用模式',
  'security.customPatterns.disable': '停用模式',
  'security.audit.title': '遮蔽审计日志',
  'security.audit.clear': '清除日志',
  'security.audit.empty': '还没有遮蔽事件。',
  'security.audit.maskedCount': '已遮蔽 {count}',
  'security.audit.scope.provider': '提供商请求',
  'security.audit.scope.display': '聊天显示',
  'security.audit.source.chatStream': '助手请求',
  'security.audit.source.chatDisplay': '聊天显示',
  'security.audit.source.commandRisk': '命令安全检查',
  'security.audit.source.summary': '提示词摘要',
  'security.audit.source.terminalDisplay': '终端输出显示',
  'security.audit.source.chatStorage': '已保存聊天',
  'privacy.trustCard.title': '隐私遮蔽',
  'privacy.trustCard.categories': '遮蔽类别',
  'privacy.trustCard.context': '来源上下文',
  'privacy.trustCard.note': '值会保持隐藏。可按需在安全设置中调整规则。',
  'privacy.trustCard.openSettings': '安全设置',

  'prompts.title': '提示词',
  'prompts.importFromFile': '从文件导入',
  'prompts.addPrompt': '添加提示词',
  'prompts.savePrompt': '保存提示词',
  'prompts.cancel': '取消',
  'prompts.noPrompts': '还没有提示词。请在下方添加或导入Markdown文件。',
  'prompts.namePlaceholder': '提示词名称',
  'prompts.contentPlaceholder': '提示词内容…',
  'prompts.edit': '编辑',
  'prompts.delete': '删除',
  'prompts.deleteConfirmTitle': '删除提示词？',
  'prompts.deleteConfirmMessage': '此操作无法撤销。',
  'prompts.deleteConfirmBtn': '删除',
  'prompts.duplicateName': '已存在同名提示词。',

  'snippets.title': '命令片段',
  'snippets.quickHint': '使用 ⌘⇧K 快速打开。Enter 插入，⌘Enter 运行。',
  'snippets.addSnippet': '添加片段',
  'snippets.saveSnippet': '保存片段',
  'snippets.noSnippets': '还没有命令片段。请在下方添加。',
  'snippets.namePlaceholder': '片段名称',
  'snippets.commandPlaceholder': '终端命令…',
  'snippets.edit': '编辑',
  'snippets.delete': '删除',
  'snippets.deleteConfirmTitle': '删除命令片段？',
  'snippets.deleteConfirmMessage': '此操作无法撤销。',
  'snippets.deleteConfirmBtn': '删除',
  'snippets.duplicateName': '已存在同名命令片段。',

  'data.title': '数据',
  'data.usage.title': '本地使用情况',
  'data.usage.desc': '仅存储在这台 Mac 上。匿名使用遥测默认关闭，仅在您同意后发送（安全与隐私）。',
  'data.usage.storage': '已用存储',
  'data.usage.chats': '已保存聊天',
  'data.usage.sessions': '已保存会话',
  'data.exportImport.label': '导出 / 导入',
  'data.exportImport.desc': 'JSON 备份，包含提供商、提示词、命令片段和偏好设置',
  'data.export': '导出',
  'data.import': '导入',
  'data.restoreSessions.label': '恢复标签页和历史',
  'data.restoreSessions.desc': '启动时重新打开标签页、终端输出和助手历史',
  'data.clearSessions.label': '已保存的会话状态',
  'data.clearSessions.desc': '删除已保存的标签页和回滚内容，不改变当前标签页',
  'data.clearSessions': '清除保存状态',
  'data.clearSessionsConfirmTitle': '清除保存的会话状态？',
  'data.clearSessionsConfirmMessage': '已保存的标签页和回滚内容将被删除，当前标签页会保持打开。',
  'data.clearSessionsConfirmBtn': '清除',
  'data.clearChatHistory.label': '聊天记录',
  'data.clearChatHistory.desc': '删除所有保存的聊天对话',
  'data.clearChatHistory': '清除聊天记录',
  'data.clearChatHistory.done': '聊天记录已清除',
  'data.clearChatHistoryConfirmTitle': '清除聊天记录？',
  'data.clearChatHistoryConfirmMessage': '所有保存的聊天对话都将被删除。此操作无法撤销。',
  'data.clearChatHistoryConfirmBtn': '清除',
  'data.dangerZone': '危险区域',

  'terminal.sshDisconnected': 'SSH 会话已断开',
  'terminal.reconnect': '重新连接',
  'terminal.searchPlaceholder': '搜索终端',
  'terminal.searchNoResults': '无结果',
  'terminal.searchPrevious': '上一个结果',
  'terminal.searchNext': '下一个结果',
  'terminal.searchClose': '关闭搜索',
  'terminal.blocks.select': '选择',
  'terminal.blocks.deselect': '取消选择',
  'terminal.blocks.askAi': '询问 AI',
  'terminal.blocks.copyBlock': '复制块',
  'terminal.blocks.copyCommand': '复制命令',
  'terminal.blocks.copyOutput': '复制输出',
  'terminal.blocks.commandUnavailable': '命令不可用',
  'terminal.blocks.rerunCommand': '重新运行命令',
  'terminal.blocks.rerunTitle': '重新运行所选命令？',
  'terminal.blocks.rerunBody': '此命令将发送到活动终端会话。',
  'terminal.blocks.rerunConfirm': '重新运行',
  'terminal.blocks.saveSnippet': '保存片段',
  'terminal.blocks.clearSelection': '清除选择',
  'terminal.blocks.sendTitle': '将所选块发送到聊天？',
  'terminal.blocks.sendBody': '命令和所选终端输出将发送到聊天。请确认其中没有令牌、密钥、密码、私有路径或其他敏感数据。',
  'terminal.blocks.send': '发送',
  'terminal.blocks.selectedCount': '已选择 {count} 个块',
  'terminal.blocks.askPrompt': '分析所选终端块：解释执行了什么、输出含义、是否有错误，以及合理的下一步。',
  'terminal.blocks.label': '块 {index}',
  'terminal.noActiveSession': '没有活动的终端会话。',

  'panel.agent': '代理',
  'panel.agentToggle.enable': '启用代理执行',
  'panel.agentToggle.disable': '切换到只读上下文',
  'panel.newChat': '新建聊天',
  'panel.settings': '设置',
  'panel.permission.read': '读取',
  'panel.permission.execute': '执行命令',
  'panel.permission.pending': '待处理',
  'panel.permission.summary': '助手会话和权限',
  'panel.permission.none': '无终端访问权限',
  'panel.permission.readOnly': '读取终端上下文',
  'panel.permission.readExecute': '读取终端上下文并执行命令',
  'panel.shell.label': 'Shell：{shell}',
  'panel.status.idle': '空闲',
  'panel.status.running': '运行中',
  'panel.status.waiting': '等待确认',
  'sidebar.openHandle': '打开助手 (⌘\\)',
  'app.terminalToolbar': '终端工具栏',
  'app.newTerminal': '新建终端 (⌘T)',
  'app.closeSession': '关闭会话 (⌘W)',
  'app.settings': '设置 (⌘,)',
  'app.showSidebar': '显示助手面板 (⌘\\)',
  'app.hideSidebar': '隐藏助手面板 (⌘\\)',
  'chat.runInTerminal': '在终端中运行',
  'chat.showFullCommand': '显示完整命令',
  'chat.collapseCommand': '折叠命令',
  'chat.copyCode': '复制代码',
  'chat.copyMessage': '复制消息',
  'chat.copied': '已复制',
  'panel.promptLibrary': '提示词库 (⌘⇧J)',

  'chat.empty.title': '准备就绪',
  'chat.empty.body': '询问关于终端、命令或选定文本的问题',
  'chat.input.placeholder': '询问关于此终端的问题…',
  'chat.input.tooltip': 'Enter 发送。Shift+Enter 添加新行。',
  'chat.composer.context': '上下文 ~{count} token',
  'chat.composer.maskedSecrets': '已遮蔽 {count}',
  'chat.composer.mode.agent': '代理',
  'chat.composer.mode.read': '只读',
  'chat.composer.mode.off': '关闭',
  'chat.composer.controls': '助手控件',
  'chat.composer.contextLabel': '上下文',
  'chat.composer.maskedLabel': '已遮蔽',
  'chat.composer.modeLabel': '模式',
  'model.switch.title': '切换模型',
  'model.switch.search': '搜索当前提供商的模型...',
  'model.switch.all': '可用模型',
  'model.switch.category': '模型',
  'model.switch.current': '当前聊天模型。',
  'model.switch.choose': '下次助手请求使用此模型。',
  'model.switch.loadDescription': '打开提供商设置或测试当前提供商以加载模型。',
  'chat.send': '发送（Enter）',
  'chat.stopAgent': '停止代理',
  'chat.role.user': '用户',
  'chat.role.assistant': '助手',
  'chat.commandOutput.label': '输出已发送给助手',
  'chat.commandOutput.hiddenLabel': '输出已对助手隐藏',
  'chat.commandOutput.show': '显示输出',
  'chat.commandOutput.noOutput': '（无输出）',
  'chat.commandEdited.label': '命令在运行前已编辑',
  'chat.commandEdited.original': '原命令',
  'chat.commandEdited.final': '运行',
  'chat.thinking': '思考中',
  'chat.regenerate': '重新生成',
  'chat.forkFromMessage': '从此处分叉',
  'chat.forked': '已从所选消息分叉聊天。',
  'chat.connectProvider': '连接提供商',
  'chat.saveAsPrompt': '保存为提示词',
  'chat.savePrompt.generating': '生成提示词中…',
  'chat.savePrompt.save': '保存',
  'chat.savePrompt.saving': '保存中…',
  'chat.savePrompt.saved': '已保存 ✓',
  'chat.savePrompt.error': '保存失败',
  'chat.history': '聊天记录',
  'chat.historySearch': '搜索聊天…',
  'chat.historyEmpty': '暂无保存的聊天',
  'chat.historyNoMatch': '没有匹配“{query}”的聊天',
  'chat.historyMessages': '条消息',
  'chat.historyDelete': '删除',
  'chat.historyDeleteConfirmTitle': '删除聊天？',
  'chat.historyDeleteConfirmMessage': '此保存的聊天将被删除。此操作无法撤销。',
  'chat.historyDeleteConfirmBtn': '删除',

  'onboarding.title': '激活 Taviraq',
  'onboarding.body': '连接提供商，选择模型，然后询问当前终端。',
  'onboarding.provider': '选择提供商',
  'onboarding.apiKey': '添加 API 密钥',
  'onboarding.endpoint': '检查本地端点',
  'onboarding.apiKeyPlaceholder': '粘贴要存入 Keychain 的 API 密钥...',
  'onboarding.localProviderNote': '本地提供商可以不使用 API 密钥。请确保服务器正在运行。',
  'onboarding.test': '测试连接',
  'onboarding.testConnection': '测试并加载模型',
  'onboarding.apiKeyRequired': '测试此提供商前请输入 API 密钥。',
  'onboarding.model': '选择模型',
  'onboarding.firstQuestion': '提出第一个问题',
  'onboarding.firstQuestionPrompt': '解释此终端中正在发生什么，并建议下一个有用的命令。',

  'confirm.reviewRisky': '审查危险命令',
  'confirm.safetyUnavailable': '安全检查不可用',
  'confirm.review': '审查',
  'confirm.warning': '警告',
  'confirm.command': '命令',
  'confirm.reason': '原因',
  'confirm.agentPaused': '代理已暂停，等待您的选择。',
  'confirm.cancel': '取消',
  'confirm.runCommand': '执行命令',
  'confirm.runAnyway': '仍然执行',
  'confirm.shortcutHint': 'Enter 确认 · Esc 取消',
  'confirm.destructiveWarning': '此命令可能导致不可逆的更改，请仔细审查。',
  'confirm.confirmCountdown': '确认 ({seconds}s)',
  'confirm.commandApproved': '⚠️ 命令已确认：{{command}}',
  'confirm.commandRejected': '❌ 命令已拒绝：{{command}}',
  'commandRisk.localSecret': '此命令使用本地密钥，Taviraq 在解析前需要你确认。',
  'commandRisk.sshContext': '当前会话是 SSH ({label})，远程影响需要明确检查。',
  'commandRisk.requiresConfirmation': 'Taviraq 需要确认后才能运行。',

  'status.checkingSafety': '正在检查命令安全性...',
  'status.agentStopped.riskyCommand': '代理在执行危险命令前已停止。',
  'status.agentStopped.safetyUnchecked': '由于无法检查命令安全性，代理已停止。',
  'status.agentStopped.tenSteps': '代理在10步后停止。',
  'status.riskyCommandConfirmed': '用户已确认危险命令。',
  'status.safetyFailedConfirmed': '安全检查失败；命令已由用户确认。',
  'status.noSession.agent': '在启动代理之前，请打开终端会话。',
  'status.noSession.run': '在运行命令之前，请打开终端会话。',
  'status.disconnected.run': '运行命令前请重新连接此会话。',
  'status.commandAlreadyRunning': '此会话中已有命令正在运行。',
  'status.modelLoading': '正在加载模型 {percent}%',
  'status.promptProcessing': '正在处理提示 {percent}%',
  'status.blockPromptQueued': '助手正忙。块提示已放入输入框。',
  'status.privacyMasked': '发送给 LLM 前已遮蔽 {count} 个密钥。',

  'chip.space': '什么占用了空间？',
  'chip.spacePrompt': '这里什么占用了最多磁盘空间？',
  'chip.processes': '检查运行中的进程',
  'chip.processesPrompt': '检查最重要的运行中进程。',
  'chip.lastCommand': '解释上一个命令',
  'chip.lastCommandPrompt': '解释上一个终端命令及其输出。',
  'chip.selection': '解释选定文本',
  'chip.selectionPrompt': '解释选定的终端输出。',
  'chip.git': '显示未提交的更改',
  'chip.gitPrompt': '显示此项目中未提交的更改。',
  'chip.docker': '安全清理Docker',
  'chip.dockerPrompt': '查找安全的Docker清理机会。',
  'chip.logs': '查找最大的日志',
  'chip.logsPrompt': '查找最大的日志文件并建议安全清理。',
  'chip.disk': '汇总磁盘使用情况',
  'chip.diskPrompt': '汇总占用最多磁盘空间的内容。',

  'agent.step': '第 {step} 步 — {state}',
  'agent.waiting': '等待审查',
  'agent.running': '运行中',

  'model.noMatch': '没有匹配的模型',
  'model.loadFirst': '加载模型以搜索',
  'model.loadModelsFirst': '请先加载模型',
  'model.showing': '显示 {visible} / {total}',
  'model.supportsMcp': '可能支持 MCP',

  'snippetPalette.title': '命令片段',
  'snippetPalette.search': '搜索命令片段...',
  'snippetPalette.enterInserts': 'Enter 插入',
  'snippetPalette.metaEnterRuns': '⌘Enter 运行',
  'snippetPalette.addSnippet': '添加片段',
  'snippetPalette.runNow': '立即运行',
  'snippetPalette.empty': '还没有命令片段。',
  'snippetPalette.emptyCta': '添加片段',
  'snippetPalette.noMatch': '没有匹配的片段。',

  'commandPalette.title': '命令面板',
  'commandPalette.search': '搜索操作、标签、提示词、片段...',
  'commandPalette.recent': '最近使用',
  'commandPalette.all': '所有操作',
  'commandPalette.commands': '命令',
  'commandPalette.snippets': '片段',
  'commandPalette.prompts': '提示词',
  'commandPalette.noMatch': '没有匹配的操作。',
  'commandPalette.enterSelects': 'Enter 选择',
  'commandPalette.action.open': '打开',
  'commandPalette.action.run': '运行',
  'commandPalette.action.insert': '插入',
  'commandPalette.action.select': '选择',
  'commandPalette.escapeCloses': 'Esc 关闭',

  'promptPalette.title': '提示词',
  'promptPalette.search': '搜索提示词...',
  'promptPalette.enterInserts': 'Enter 插入',
  'promptPalette.addPrompt': '添加提示词',
  'promptPalette.empty': '还没有提示词。',
  'promptPalette.emptyCta': '添加提示词',
  'promptPalette.noMatch': '没有匹配的提示词。',

  'update.downloading': '正在下载更新… {percent}%',
  'update.downloaded': '更新 {version} 已准备好安装。',
  'update.restart': '重启',
  'update.dismiss': '稍后',
  'telemetry.consent.title': '帮助改进 Taviraq？',
  'telemetry.consent.body': '分享匿名的聚合使用事件（如首次启动和首次 AI 请求），帮助我们改进新手引导。绝不收集终端内容、命令或个人数据。默认关闭——可随时在「设置 → 安全与隐私」中更改。',
  'telemetry.consent.accept': '分享匿名数据',
  'telemetry.consent.decline': '不用了',
  'security.telemetry.label': '匿名使用遥测',
  'security.telemetry.desc': '需明确同意：仅聚合的激活事件——不含终端内容、命令或个人数据。仅从已签名的发布版本发送。',
  'security.telemetry.on': '遥测已开启',
  'security.telemetry.off': '遥测已关闭',
  'security.telemetry.onState': '正在分享',
  'security.telemetry.offState': '未分享',
  'security.telemetry.inactiveState': '已开启 — 此版本中未激活',
}

export const TRANSLATIONS: Record<Language, Translations> = { en, ru, cn }

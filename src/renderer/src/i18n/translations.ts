export type Language = 'en' | 'ru' | 'cn'

export interface Translations {
  // Settings navigation
  'settings.title': string
  'settings.tab.appearance': string
  'settings.tab.providers': string
  'settings.tab.prompts': string
  'settings.tab.data': string

  // Appearance tab
  'appearance.title': string
  'appearance.fontSize.label': string
  'appearance.fontSize.desc': string
  'appearance.fontSize.applied': string
  'appearance.language.label': string
  'appearance.language.desc': string
  'appearance.language.en': string
  'appearance.language.ru': string
  'appearance.language.cn': string

  // Providers tab
  'providers.title': string
  'providers.name': string
  'providers.baseUrl': string
  'providers.apiKey': string
  'providers.apiKey.saved': string
  'providers.apiKey.change': string
  'providers.apiKey.placeholder': string
  'providers.apiKey.replacePlaceholder': string
  'providers.save': string
  'providers.fetchModels': string
  'providers.addProvider': string
  'providers.deleteProvider': string
  'providers.active': string
  'providers.unnamed': string
  'providers.chatModel': string
  'providers.safetyModel': string
  'providers.searchChatModel': string
  'providers.searchSafetyModel': string

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

  // Data tab
  'data.title': string
  'data.exportImport.label': string
  'data.exportImport.desc': string
  'data.export': string
  'data.import': string

  // Panel header
  'panel.agent': string
  'panel.agentToggle.enable': string
  'panel.agentToggle.disable': string
  'panel.clearHistory': string
  'panel.settings': string
  'panel.permission.read': string
  'panel.permission.execute': string
  'panel.permission.pending': string

  // Chat area
  'chat.empty.title': string
  'chat.empty.body': string
  'chat.input.placeholder': string
  'chat.send': string
  'chat.stopAgent': string
  'chat.role.user': string
  'chat.role.assistant': string
  'chat.commandOutput.label': string
  'chat.commandOutput.show': string
  'chat.commandOutput.noOutput': string
  'chat.connectProvider': string

  // Command confirmation dialog
  'confirm.reviewRisky': string
  'confirm.safetyUnavailable': string
  'confirm.review': string
  'confirm.warning': string
  'confirm.reason': string
  'confirm.agentPaused': string
  'confirm.cancel': string
  'confirm.runCommand': string
  'confirm.runAnyway': string

  // Status messages (chat inline status)
  'status.checkingSafety': string
  'status.agentStopped.riskyCommand': string
  'status.agentStopped.safetyUnchecked': string
  'status.agentStopped.tenSteps': string
  'status.riskyCommandConfirmed': string
  'status.safetyFailedConfirmed': string
  'status.noSession.agent': string
  'status.noSession.run': string

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
}

export const en: Translations = {
  'settings.title': 'Settings',
  'settings.tab.appearance': 'Appearance',
  'settings.tab.providers': 'Providers',
  'settings.tab.prompts': 'Prompts',
  'settings.tab.data': 'Data',

  'appearance.title': 'Appearance',
  'appearance.fontSize.label': 'Terminal font size',
  'appearance.fontSize.desc': 'Applied to all terminal sessions',
  'appearance.fontSize.applied': '{value}px applied',
  'appearance.language.label': 'Language',
  'appearance.language.desc': 'UI language and LLM response language',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',

  'providers.title': 'Providers',
  'providers.name': 'Provider name',
  'providers.baseUrl': 'Base URL',
  'providers.apiKey': 'API key',
  'providers.apiKey.saved': 'saved in keychain',
  'providers.apiKey.change': 'Change',
  'providers.apiKey.placeholder': 'Enter API key…',
  'providers.apiKey.replacePlaceholder': 'Enter new key to replace…',
  'providers.save': 'Save provider',
  'providers.fetchModels': 'Fetch models',
  'providers.addProvider': 'Add provider',
  'providers.deleteProvider': 'Delete provider',
  'providers.active': 'active',
  'providers.unnamed': 'Unnamed',
  'providers.chatModel': 'Chat model',
  'providers.safetyModel': 'Command safety model',
  'providers.searchChatModel': 'Search chat model',
  'providers.searchSafetyModel': 'Search safety model',

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

  'data.title': 'Data',
  'data.exportImport.label': 'Export / Import',
  'data.exportImport.desc': 'Providers, prompts and preferences',
  'data.export': 'Export',
  'data.import': 'Import',

  'panel.agent': 'Agent',
  'panel.agentToggle.enable': 'Enable agent execution',
  'panel.agentToggle.disable': 'Switch to read-only context',
  'panel.clearHistory': 'Clear chat history',
  'panel.settings': 'Settings',
  'panel.permission.read': 'Read',
  'panel.permission.execute': 'Execute',
  'panel.permission.pending': 'Pending',

  'chat.empty.title': 'Ready to help',
  'chat.empty.body': 'Ask about your terminal, commands, or selected text',
  'chat.input.placeholder': 'Ask about this terminal…',
  'chat.send': 'Send (Enter)',
  'chat.stopAgent': 'Stop agent',
  'chat.role.user': 'user',
  'chat.role.assistant': 'assistant',
  'chat.commandOutput.label': 'output sent to assistant',
  'chat.commandOutput.show': 'Show output',
  'chat.commandOutput.noOutput': '(no output)',
  'chat.connectProvider': 'Connect provider',

  'confirm.reviewRisky': 'Review risky command',
  'confirm.safetyUnavailable': 'Safety check unavailable',
  'confirm.review': 'review',
  'confirm.warning': 'warning',
  'confirm.reason': 'Reason',
  'confirm.agentPaused': 'Agent is paused until you choose what to do.',
  'confirm.cancel': 'Cancel',
  'confirm.runCommand': 'Run command',
  'confirm.runAnyway': 'Run anyway',

  'status.checkingSafety': 'Checking command safety...',
  'status.agentStopped.riskyCommand': 'Agent stopped before running a risky command.',
  'status.agentStopped.safetyUnchecked': 'Agent stopped because command safety could not be checked.',
  'status.agentStopped.tenSteps': 'Agent stopped after 10 steps.',
  'status.riskyCommandConfirmed': 'Risky command confirmed by user.',
  'status.safetyFailedConfirmed': 'Safety check failed; command confirmed by user.',
  'status.noSession.agent': 'Open a terminal session before starting the agent.',
  'status.noSession.run': 'Open a terminal session before running a command.',

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
}

export const ru: Translations = {
  'settings.title': 'Настройки',
  'settings.tab.appearance': 'Внешний вид',
  'settings.tab.providers': 'Провайдеры',
  'settings.tab.prompts': 'Промпты',
  'settings.tab.data': 'Данные',

  'appearance.title': 'Внешний вид',
  'appearance.fontSize.label': 'Размер шрифта терминала',
  'appearance.fontSize.desc': 'Применяется ко всем сессиям терминала',
  'appearance.fontSize.applied': 'применено {value}px',
  'appearance.language.label': 'Язык',
  'appearance.language.desc': 'Язык интерфейса и ответов ИИ',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',

  'providers.title': 'Провайдеры',
  'providers.name': 'Название провайдера',
  'providers.baseUrl': 'Базовый URL',
  'providers.apiKey': 'API-ключ',
  'providers.apiKey.saved': 'сохранён в связке ключей',
  'providers.apiKey.change': 'Изменить',
  'providers.apiKey.placeholder': 'Введите API-ключ…',
  'providers.apiKey.replacePlaceholder': 'Введите новый ключ для замены…',
  'providers.save': 'Сохранить провайдера',
  'providers.fetchModels': 'Загрузить модели',
  'providers.addProvider': 'Добавить провайдера',
  'providers.deleteProvider': 'Удалить провайдера',
  'providers.active': 'активный',
  'providers.unnamed': 'Без имени',
  'providers.chatModel': 'Модель чата',
  'providers.safetyModel': 'Модель проверки безопасности',
  'providers.searchChatModel': 'Поиск модели чата',
  'providers.searchSafetyModel': 'Поиск модели безопасности',

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

  'data.title': 'Данные',
  'data.exportImport.label': 'Экспорт / Импорт',
  'data.exportImport.desc': 'Провайдеры, промпты и настройки',
  'data.export': 'Экспорт',
  'data.import': 'Импорт',

  'panel.agent': 'Агент',
  'panel.agentToggle.enable': 'Включить режим агента',
  'panel.agentToggle.disable': 'Перейти в режим только чтения',
  'panel.clearHistory': 'Очистить историю чата',
  'panel.settings': 'Настройки',
  'panel.permission.read': 'Чтение',
  'panel.permission.execute': 'Выполнение',
  'panel.permission.pending': 'Ожидание',

  'chat.empty.title': 'Готов помочь',
  'chat.empty.body': 'Спросите о терминале, командах или выделенном тексте',
  'chat.input.placeholder': 'Спросите о терминале…',
  'chat.send': 'Отправить (Enter)',
  'chat.stopAgent': 'Остановить агента',
  'chat.role.user': 'пользователь',
  'chat.role.assistant': 'ассистент',
  'chat.commandOutput.label': 'вывод отправлен ассистенту',
  'chat.commandOutput.show': 'Показать вывод',
  'chat.commandOutput.noOutput': '(нет вывода)',
  'chat.connectProvider': 'Подключить провайдера',

  'confirm.reviewRisky': 'Проверьте опасную команду',
  'confirm.safetyUnavailable': 'Проверка безопасности недоступна',
  'confirm.review': 'проверка',
  'confirm.warning': 'предупреждение',
  'confirm.reason': 'Причина',
  'confirm.agentPaused': 'Агент приостановлен до вашего выбора.',
  'confirm.cancel': 'Отмена',
  'confirm.runCommand': 'Выполнить команду',
  'confirm.runAnyway': 'Всё равно выполнить',

  'status.checkingSafety': 'Проверка безопасности команды...',
  'status.agentStopped.riskyCommand': 'Агент остановлен перед выполнением опасной команды.',
  'status.agentStopped.safetyUnchecked': 'Агент остановлен: не удалось проверить безопасность команды.',
  'status.agentStopped.tenSteps': 'Агент остановлен после 10 шагов.',
  'status.riskyCommandConfirmed': 'Опасная команда подтверждена пользователем.',
  'status.safetyFailedConfirmed': 'Проверка безопасности не выполнена; команда подтверждена.',
  'status.noSession.agent': 'Откройте сессию терминала перед запуском агента.',
  'status.noSession.run': 'Откройте сессию терминала перед выполнением команды.',

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
}

export const cn: Translations = {
  'settings.title': '设置',
  'settings.tab.appearance': '外观',
  'settings.tab.providers': '提供商',
  'settings.tab.prompts': '提示词',
  'settings.tab.data': '数据',

  'appearance.title': '外观',
  'appearance.fontSize.label': '终端字体大小',
  'appearance.fontSize.desc': '应用于所有终端会话',
  'appearance.fontSize.applied': '已应用 {value}px',
  'appearance.language.label': '语言',
  'appearance.language.desc': '界面语言和AI回复语言',
  'appearance.language.en': 'English',
  'appearance.language.ru': 'Русский',
  'appearance.language.cn': '中文',

  'providers.title': '提供商',
  'providers.name': '提供商名称',
  'providers.baseUrl': '基础URL',
  'providers.apiKey': 'API密钥',
  'providers.apiKey.saved': '已保存到密钥链',
  'providers.apiKey.change': '更改',
  'providers.apiKey.placeholder': '输入API密钥…',
  'providers.apiKey.replacePlaceholder': '输入新密钥以替换…',
  'providers.save': '保存提供商',
  'providers.fetchModels': '获取模型',
  'providers.addProvider': '添加提供商',
  'providers.deleteProvider': '删除提供商',
  'providers.active': '活跃',
  'providers.unnamed': '未命名',
  'providers.chatModel': '聊天模型',
  'providers.safetyModel': '命令安全模型',
  'providers.searchChatModel': '搜索聊天模型',
  'providers.searchSafetyModel': '搜索安全模型',

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

  'data.title': '数据',
  'data.exportImport.label': '导出 / 导入',
  'data.exportImport.desc': '提供商、提示词和偏好设置',
  'data.export': '导出',
  'data.import': '导入',

  'panel.agent': '代理',
  'panel.agentToggle.enable': '启用代理执行',
  'panel.agentToggle.disable': '切换到只读上下文',
  'panel.clearHistory': '清除聊天记录',
  'panel.settings': '设置',
  'panel.permission.read': '读取',
  'panel.permission.execute': '执行',
  'panel.permission.pending': '待处理',

  'chat.empty.title': '准备就绪',
  'chat.empty.body': '询问关于终端、命令或选定文本的问题',
  'chat.input.placeholder': '询问关于此终端的问题…',
  'chat.send': '发送（Enter）',
  'chat.stopAgent': '停止代理',
  'chat.role.user': '用户',
  'chat.role.assistant': '助手',
  'chat.commandOutput.label': '输出已发送给助手',
  'chat.commandOutput.show': '显示输出',
  'chat.commandOutput.noOutput': '（无输出）',
  'chat.connectProvider': '连接提供商',

  'confirm.reviewRisky': '审查危险命令',
  'confirm.safetyUnavailable': '安全检查不可用',
  'confirm.review': '审查',
  'confirm.warning': '警告',
  'confirm.reason': '原因',
  'confirm.agentPaused': '代理已暂停，等待您的选择。',
  'confirm.cancel': '取消',
  'confirm.runCommand': '执行命令',
  'confirm.runAnyway': '仍然执行',

  'status.checkingSafety': '正在检查命令安全性...',
  'status.agentStopped.riskyCommand': '代理在执行危险命令前已停止。',
  'status.agentStopped.safetyUnchecked': '由于无法检查命令安全性，代理已停止。',
  'status.agentStopped.tenSteps': '代理在10步后停止。',
  'status.riskyCommandConfirmed': '用户已确认危险命令。',
  'status.safetyFailedConfirmed': '安全检查失败；命令已由用户确认。',
  'status.noSession.agent': '在启动代理之前，请打开终端会话。',
  'status.noSession.run': '在运行命令之前，请打开终端会话。',

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
}

export const TRANSLATIONS: Record<Language, Translations> = { en, ru, cn }

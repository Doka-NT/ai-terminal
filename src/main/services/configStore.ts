import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { AppConfig, LLMProviderConfig } from '@shared/types'

const CONFIG_FILE = 'config.json'

const defaultConfig: AppConfig = {
  providers: [
    {
      name: 'OpenAI Compatible',
      baseUrl: 'https://api.openai.com',
      apiKeyRef: 'openai-compatible-default',
      selectedModel: '',
      commandRiskModel: ''
    }
  ],
  activeProviderRef: 'openai-compatible-default',
  hideShortcut: 'CommandOrControl+Shift+Space'
}

export class ConfigStore {
  private readonly path = join(app.getPath('userData'), CONFIG_FILE)

  async load(): Promise<AppConfig> {
    try {
      const raw = await readFile(this.path, 'utf8')
      return { ...defaultConfig, ...JSON.parse(raw) as AppConfig }
    } catch {
      return defaultConfig
    }
  }

  async save(config: AppConfig): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true })
    await writeFile(this.path, JSON.stringify(config, null, 2), 'utf8')
  }

  async deleteProvider(apiKeyRef: string): Promise<AppConfig> {
    const config = await this.load()
    const providers = config.providers.filter((p) => p.apiKeyRef !== apiKeyRef)
    const activeRef = config.activeProviderRef === apiKeyRef
      ? providers[0]?.apiKeyRef
      : config.activeProviderRef
    const next = { ...config, providers, activeProviderRef: activeRef }
    await this.save(next)
    return next
  }

  async upsertProvider(provider: LLMProviderConfig): Promise<AppConfig> {
    const config = await this.load()
    const existingIndex = config.providers.findIndex((candidate) => candidate.apiKeyRef === provider.apiKeyRef)
    const providers = existingIndex === -1
      ? [...config.providers, provider]
      : config.providers.map((candidate, index) => index === existingIndex ? provider : candidate)

    const next = {
      ...config,
      providers,
      activeProviderRef: provider.apiKeyRef
    }

    await this.save(next)
    return next
  }
}

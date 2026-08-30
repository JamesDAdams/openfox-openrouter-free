import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'

export interface OpenRouterPluginSettings {
  notifyOnNewModelsOnly: boolean
  notifyOnEveryCheck: boolean
  checkOnStartup: boolean
  refreshIntervalMinutes: number
}

export const DEFAULT_SETTINGS: OpenRouterPluginSettings = {
  notifyOnNewModelsOnly: true,
  notifyOnEveryCheck: false,
  checkOnStartup: true,
  refreshIntervalMinutes: 60,
}

export class PluginSettingsStore {
  constructor(private readonly settingsFilePath: string) {}

  async load(): Promise<OpenRouterPluginSettings> {
    try {
      const content = await readFile(this.settingsFilePath, 'utf8')
      const parsed = JSON.parse(content) as Partial<OpenRouterPluginSettings>
      return {
        notifyOnNewModelsOnly:
          typeof parsed.notifyOnNewModelsOnly === 'boolean'
            ? parsed.notifyOnNewModelsOnly
            : DEFAULT_SETTINGS.notifyOnNewModelsOnly,
        notifyOnEveryCheck:
          typeof parsed.notifyOnEveryCheck === 'boolean'
            ? parsed.notifyOnEveryCheck
            : DEFAULT_SETTINGS.notifyOnEveryCheck,
        checkOnStartup:
          typeof parsed.checkOnStartup === 'boolean'
            ? parsed.checkOnStartup
            : DEFAULT_SETTINGS.checkOnStartup,
        refreshIntervalMinutes:
          typeof parsed.refreshIntervalMinutes === 'number' && parsed.refreshIntervalMinutes > 0
            ? parsed.refreshIntervalMinutes
            : DEFAULT_SETTINGS.refreshIntervalMinutes,
      }
    } catch {
      return { ...DEFAULT_SETTINGS }
    }
  }

  async save(values: Record<string, unknown>): Promise<OpenRouterPluginSettings> {
    const existing = await this.load()
    const parsedMinutes = Number(values.refreshIntervalMinutes)
    const updated: OpenRouterPluginSettings = {
      notifyOnNewModelsOnly:
        typeof values.notifyOnNewModelsOnly === 'boolean'
          ? values.notifyOnNewModelsOnly
          : existing.notifyOnNewModelsOnly,
      notifyOnEveryCheck:
        typeof values.notifyOnEveryCheck === 'boolean'
          ? values.notifyOnEveryCheck
          : existing.notifyOnEveryCheck,
      checkOnStartup:
        typeof values.checkOnStartup === 'boolean'
          ? values.checkOnStartup
          : existing.checkOnStartup,
      refreshIntervalMinutes:
        !isNaN(parsedMinutes) && parsedMinutes > 0
          ? parsedMinutes
          : existing.refreshIntervalMinutes,
    }

    await mkdir(dirname(this.settingsFilePath), { recursive: true })
    await writeFile(this.settingsFilePath, JSON.stringify(updated, null, 2), { mode: 0o600 })
    return updated
  }
}

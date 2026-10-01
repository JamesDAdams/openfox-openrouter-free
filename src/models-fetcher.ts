import type { ModelConfig } from 'openfox/provider'
import { DEFAULT_SETTINGS, type OpenRouterPluginSettings } from './settings.js'
import type { PluginNotificationRequest } from './types.js'

export interface OpenRouterModelApiItem {
  id: string
  name?: string
  context_length?: number
  pricing?: {
    prompt?: string | number
    completion?: string | number
  }
  architecture?: {
    input_modalities?: string[]
  }
  supported_parameters?: string[]
}

export interface OpenRouterModelsApiResponse {
  data?: OpenRouterModelApiItem[]
}

export interface OpenRouterFreeModelManagerOptions {
  refreshIntervalMs?: number
  apiEndpoint?: string
  fetcher?: typeof fetch
  notify?: (notification: PluginNotificationRequest) => void
  settings?: OpenRouterPluginSettings
  getDynamicSettings?: () => OpenRouterPluginSettings | undefined
}

export class OpenRouterFreeModelManager {
  private cachedModels: ModelConfig[] = []
  private knownModelIds: Set<string> = new Set()
  private lastDiscoveredModels: string[] = []
  private lastRemovedModels: string[] = []
  private isInitialLoad = true
  private lastFetchTimestamp = 0
  private heartbeatTimer: NodeJS.Timeout | null = null
  private isDestroyed = false
  private readonly customRefreshIntervalMs?: number
  private readonly apiEndpoint: string
  private readonly fetcher: typeof fetch
  private notifier?: (notification: PluginNotificationRequest) => void
  private settings: OpenRouterPluginSettings
  private readonly dynamicSettingsGetter?: () => OpenRouterPluginSettings | undefined

  constructor(options?: OpenRouterFreeModelManagerOptions) {
    this.customRefreshIntervalMs = options?.refreshIntervalMs
    this.apiEndpoint = options?.apiEndpoint ?? 'https://openrouter.ai/api/v1/models'
    this.fetcher = options?.fetcher ?? fetch
    this.notifier = options?.notify
    this.settings = options?.settings ?? { ...DEFAULT_SETTINGS }
    this.dynamicSettingsGetter = options?.getDynamicSettings
  }

  getLastDiscoveredModels(): string[] {
    return [...this.lastDiscoveredModels]
  }

  getLastRemovedModels(): string[] {
    return [...this.lastRemovedModels]
  }

  getRefreshIntervalMs(): number {
    if (this.customRefreshIntervalMs !== undefined) {
      return this.customRefreshIntervalMs
    }
    const current = this.getSettings()
    const minutes = current.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes
    return Math.max(1, minutes) * 60 * 1000
  }

  setNotifier(notify: (notification: PluginNotificationRequest) => void): void {
    this.notifier = notify
  }

  updateSettings(settings: OpenRouterPluginSettings): void {
    this.settings = { ...settings }
  }

  getSettings(): OpenRouterPluginSettings {
    if (this.dynamicSettingsGetter) {
      const dynamic = this.dynamicSettingsGetter()
      if (dynamic) {
        return dynamic
      }
    }
    return { ...this.settings }
  }

  /**
   * Start periodic background refresh using a resilient heartbeat ticker.
   */
  startPeriodicRefresh(checkOnStart?: boolean): void {
    if (this.isDestroyed) return
    this.stopPeriodicRefresh()

    const settings = this.getSettings()
    if (checkOnStart ?? settings.checkOnStartup) {
      this.refreshFreeModels(false, false).catch(() => {})
    }

    // Heartbeat ticker checks every 5 seconds if the refresh interval has elapsed
    this.heartbeatTimer = setInterval(async () => {
      if (this.isDestroyed) return
      const intervalMs = this.getRefreshIntervalMs()
      const now = Date.now()
      if (now - this.lastFetchTimestamp >= intervalMs) {
        this.lastFetchTimestamp = now
        try {
          await this.refreshFreeModels(false, false)
        } catch {}
      }
    }, 5000)

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref()
    }
  }

  /**
   * Stop periodic background refresh.
   */
  stopPeriodicRefresh(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  destroy(): void {
    this.isDestroyed = true
    this.stopPeriodicRefresh()
  }

  /**
   * Returns the list of free models, refreshing from API if cache is empty or expired.
   */
  async getFreeModels(forceRefresh = false, isManual = false): Promise<ModelConfig[]> {
    const now = Date.now()
    if (
      forceRefresh ||
      this.cachedModels.length === 0 ||
      now - this.lastFetchTimestamp >= this.getRefreshIntervalMs()
    ) {
      if (forceRefresh || this.cachedModels.length === 0) {
        await this.refreshFreeModels(forceRefresh, isManual)
      } else {
        this.refreshFreeModels(false, isManual).catch(() => {})
      }
    }
    return this.cachedModels
  }

  /**
   * Fetches latest models from OpenRouter API, filters for free models only,
   * adds new free models, removes retired ones, and sends in-app notifications according to settings.
   */
  async refreshFreeModels(_forceRefresh = false, isManual = false): Promise<ModelConfig[]> {
    const settings = this.getSettings()
    try {
      const res = await this.fetcher(this.apiEndpoint, {
        headers: {
          Accept: 'application/json',
          'User-Agent': 'OpenFox-OpenRouter-Free-Plugin',
        },
        signal: AbortSignal.timeout(5000),
      })

      if (!res.ok) {
        if (isManual && this.notifier) {
          this.notifier({
            title: {
              en: 'OpenRouter Sync Failed',
              fr: 'Échec de synchronisation OpenRouter',
            },
            body: {
              en: `Failed to fetch models from OpenRouter (HTTP ${res.status}).`,
              fr: `Impossible de récupérer les modèles depuis OpenRouter (HTTP ${res.status}).`,
            },
            level: 'error',
          })
        }
        return this.cachedModels
      }

      const body = (await res.json()) as OpenRouterModelsApiResponse
      if (!body?.data || !Array.isArray(body.data)) {
        return this.cachedModels
      }

      const freeModels: ModelConfig[] = []
      const newlyDiscoveredModels: string[] = []

      for (const item of body.data) {
        if (!item.id) continue
        if (!this.isFreeModel(item)) continue

        const supportsVision =
          item.architecture?.input_modalities?.includes('image') ?? false
        const supportsReasoning =
          item.supported_parameters?.includes('reasoning') ||
          item.supported_parameters?.includes('reasoning_effort') ||
          item.supported_parameters?.includes('include_reasoning')

        const modelConfig: ModelConfig = {
          id: item.id,
          name: item.name || item.id,
          contextWindow: item.context_length ?? 128000,
          source: 'backend',
          supportsVision,
          selected: true,
          ...(supportsReasoning ? { reasoningEfforts: ['low', 'medium', 'high'] } : {}),
        }
        freeModels.push(modelConfig)

        if (!this.knownModelIds.has(item.id)) {
          newlyDiscoveredModels.push(modelConfig.name || modelConfig.id)
        }
      }

      const freeModelIds = new Set(freeModels.map((m) => m.id))
      const removedModels: string[] = []
      if (!this.isInitialLoad) {
        for (const id of this.knownModelIds) {
          if (!freeModelIds.has(id)) {
            const oldModel = this.cachedModels.find((m) => m.id === id)
            removedModels.push(oldModel?.name || id)
          }
        }
      }

      const wasInitial = this.isInitialLoad
      this.lastDiscoveredModels = newlyDiscoveredModels
      this.lastRemovedModels = removedModels
      if (freeModels.length > 0 || this.isInitialLoad) {
        this.cachedModels = freeModels
        this.knownModelIds = freeModelIds
      }
      this.lastFetchTimestamp = Date.now()
      this.isInitialLoad = false

      // Notifications logic
      if (this.notifier) {
        const changesEn: string[] = []
        const changesFr: string[] = []

        if (newlyDiscoveredModels.length > 0) {
          changesEn.push(`Added (${newlyDiscoveredModels.length}): ${newlyDiscoveredModels.join(', ')}`)
          changesFr.push(`Ajouté (${newlyDiscoveredModels.length}) : ${newlyDiscoveredModels.join(', ')}`)
        }
        if (removedModels.length > 0) {
          changesEn.push(`Removed (${removedModels.length}): ${removedModels.join(', ')}`)
          changesFr.push(`Supprimé (${removedModels.length}) : ${removedModels.join(', ')}`)
        }

        if (isManual) {
          this.notifier({
            title: {
              en: 'OpenRouter Free Models Synchronized',
              fr: 'Modèles gratuits OpenRouter synchronisés',
            },
            body: {
              en:
                changesEn.length > 0
                  ? `Sync complete: ${freeModels.length} free models available (${changesEn.join(' | ')}).`
                  : `Sync complete: ${freeModels.length} free models are available (no changes).`,
              fr:
                changesFr.length > 0
                  ? `Synchronisation terminée : ${freeModels.length} modèles gratuits disponibles (${changesFr.join(' | ')}).`
                  : `Synchronisation terminée : ${freeModels.length} modèles gratuits disponibles (aucun changement).`,
            },
            level: 'success',
          })
        } else if (
          !wasInitial &&
          changesEn.length > 0 &&
          (settings.notifyOnNewModelsOnly || settings.notifyOnEveryCheck)
        ) {
          this.notifier({
            title: {
              en: 'OpenRouter Free Models Updated',
              fr: 'Modèles gratuits OpenRouter mis à jour',
            },
            body: {
              en: changesEn.join('\n'),
              fr: changesFr.join('\n'),
            },
            level: 'info',
          })
        } else if (settings.notifyOnEveryCheck && (!wasInitial || changesEn.length === 0)) {
          this.notifier({
            title: {
              en: 'OpenRouter Free Models Checked',
              fr: 'Vérification des modèles gratuits OpenRouter terminée',
            },
            body: {
              en: `Check complete: ${freeModels.length} free models available (no changes).`,
              fr: `Vérification terminée : ${freeModels.length} modèles gratuits disponibles (aucun changement).`,
            },
            level: 'info',
          })
        }
      }

      return this.cachedModels
    } catch (err) {
      if (isManual && this.notifier) {
        this.notifier({
          title: {
            en: 'OpenRouter Sync Error',
            fr: 'Erreur de synchronisation OpenRouter',
          },
          body: {
            en: err instanceof Error ? err.message : 'Error syncing models from OpenRouter',
            fr: err instanceof Error ? err.message : 'Erreur lors de la synchronisation des modèles OpenRouter',
          },
          level: 'error',
        })
      }
      return this.cachedModels
    }
  }

  /**
   * Helper to determine if an OpenRouter model item is free.
   * Free models have prompt = 0 and completion = 0, or end with :free or -free.
   */
  isFreeModel(item: OpenRouterModelApiItem): boolean {
    if (item.id && (item.id.endsWith(':free') || item.id.endsWith('-free'))) {
      return true
    }
    if (!item.pricing) return false
    const promptPrice = parseFloat(String(item.pricing.prompt ?? '-1'))
    const completionPrice = parseFloat(String(item.pricing.completion ?? '-1'))

    return promptPrice === 0 && completionPrice === 0
  }

  getCachedModels(): ModelConfig[] {
    return this.cachedModels
  }

  getLastFetchTimestamp(): number {
    return this.lastFetchTimestamp
  }
}

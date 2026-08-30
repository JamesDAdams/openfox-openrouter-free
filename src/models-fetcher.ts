import type { ModelConfig } from 'openfox/provider'
import { DEFAULT_SETTINGS, type OpenRouterPluginSettings } from './settings.js'

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

export const DEFAULT_FREE_MODELS: ModelConfig[] = [
  {
    id: 'meta-llama/llama-3.3-70b-instruct:free',
    name: 'Meta: Llama 3.3 70B Instruct (free)',
    contextWindow: 128000,
    source: 'backend',
    supportsVision: false,
    selected: true,
  },
  {
    id: 'google/gemini-2.0-flash-lite-preview-02-05:free',
    name: 'Google: Gemini Flash Lite 2.0 Experimental (free)',
    contextWindow: 1048576,
    source: 'backend',
    supportsVision: true,
    selected: true,
  },
  {
    id: 'deepseek/deepseek-r1:free',
    name: 'DeepSeek: R1 (free)',
    contextWindow: 16384,
    source: 'backend',
    supportsVision: false,
    selected: true,
    reasoningEfforts: ['low', 'medium', 'high'],
  },
  {
    id: 'qwen/qwen-2.5-coder-32b-instruct:free',
    name: 'Qwen: Qwen 2.5 Coder 32B Instruct (free)',
    contextWindow: 32768,
    source: 'backend',
    supportsVision: false,
    selected: true,
  },
  {
    id: 'mistralai/mistral-7b-instruct:free',
    name: 'Mistral: Mistral 7B Instruct (free)',
    contextWindow: 32768,
    source: 'backend',
    supportsVision: false,
    selected: true,
  },
]

export interface OpenRouterFreeModelManagerOptions {
  refreshIntervalMs?: number
  apiEndpoint?: string
  fetcher?: typeof fetch
  notify?: (notification: { title: string; body: string }) => void
  settings?: OpenRouterPluginSettings
}

export class OpenRouterFreeModelManager {
  private cachedModels: ModelConfig[] = [...DEFAULT_FREE_MODELS]
  private knownModelIds: Set<string> = new Set(DEFAULT_FREE_MODELS.map((m) => m.id))
  private lastDiscoveredModels: string[] = []
  private lastRemovedModels: string[] = []
  private isInitialLoad = true
  private lastFetchTimestamp = 0
  private timer: NodeJS.Timeout | null = null
  private readonly customRefreshIntervalMs?: number
  private readonly apiEndpoint: string
  private readonly fetcher: typeof fetch
  private notifier?: (notification: { title: string; body: string }) => void
  private settings: OpenRouterPluginSettings

  constructor(options?: OpenRouterFreeModelManagerOptions) {
    this.customRefreshIntervalMs = options?.refreshIntervalMs
    this.apiEndpoint = options?.apiEndpoint ?? 'https://openrouter.ai/api/v1/models'
    this.fetcher = options?.fetcher ?? fetch
    this.notifier = options?.notify
    this.settings = options?.settings ?? { ...DEFAULT_SETTINGS }
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
    const minutes = this.settings.refreshIntervalMinutes || DEFAULT_SETTINGS.refreshIntervalMinutes
    return minutes * 60 * 1000
  }

  setNotifier(notify: (notification: { title: string; body: string }) => void): void {
    this.notifier = notify
  }

  updateSettings(settings: OpenRouterPluginSettings): void {
    const previousInterval = this.getRefreshIntervalMs()
    this.settings = { ...settings }
    const newInterval = this.getRefreshIntervalMs()

    if (this.timer && previousInterval !== newInterval) {
      this.stopPeriodicRefresh()
      this.startPeriodicRefresh(false)
    }
  }

  getSettings(): OpenRouterPluginSettings {
    return { ...this.settings }
  }

  /**
   * Start periodic background refresh.
   */
  startPeriodicRefresh(checkOnStart = this.settings.checkOnStartup): void {
    if (this.timer) return

    if (checkOnStart) {
      this.refreshFreeModels(false, false).catch(() => {})
    }

    this.timer = setInterval(() => {
      this.refreshFreeModels(false, false).catch(() => {
        // Ignore background refresh errors; stale cache will remain
      })
    }, this.getRefreshIntervalMs())

    if (this.timer.unref) {
      this.timer.unref()
    }
  }

  /**
   * Stop periodic background refresh.
   */
  stopPeriodicRefresh(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  /**
   * Returns the list of free models, refreshing if cache is expired or empty.
   */
  async getFreeModels(forceRefresh = false, isManual = false): Promise<ModelConfig[]> {
    const now = Date.now()
    if (
      forceRefresh ||
      now - this.lastFetchTimestamp >= this.getRefreshIntervalMs()
    ) {
      if (forceRefresh) {
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
            title: 'OpenRouter Sync Failed',
            body: `Failed to fetch models from OpenRouter (HTTP ${res.status}).`,
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
      if (freeModels.length > 0) {
        this.cachedModels = freeModels
        this.knownModelIds = freeModelIds
      }
      this.lastFetchTimestamp = Date.now()
      this.isInitialLoad = false

      // Notifications logic
      if (this.notifier) {
        const changes: string[] = []
        if (newlyDiscoveredModels.length > 0) {
          changes.push(`Added (${newlyDiscoveredModels.length}): ${newlyDiscoveredModels.join(', ')}`)
        }
        if (removedModels.length > 0) {
          changes.push(`Removed (${removedModels.length}): ${removedModels.join(', ')}`)
        }

        if (isManual) {
          this.notifier({
            title: 'OpenRouter Free Models Synchronized',
            body: changes.length > 0
              ? `Sync complete: ${freeModels.length} free models available (${changes.join(' | ')}).`
              : `Sync complete: ${freeModels.length} free models are available (no changes).`,
          })
        } else if (!wasInitial && changes.length > 0 && (this.settings.notifyOnNewModelsOnly || this.settings.notifyOnEveryCheck)) {
          this.notifier({
            title: 'OpenRouter Free Models Updated',
            body: changes.join('\n'),
          })
        } else if (this.settings.notifyOnEveryCheck && (!wasInitial || changes.length === 0)) {
          this.notifier({
            title: 'OpenRouter Free Models Checked',
            body: `Check complete: ${freeModels.length} free models available (no changes).`,
          })
        }
      }

      return this.cachedModels
    } catch (err) {
      if (isManual && this.notifier) {
        this.notifier({
          title: 'OpenRouter Sync Error',
          body: err instanceof Error ? err.message : 'Error syncing models from OpenRouter',
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

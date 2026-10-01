import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterFreeModelManager, OpenRouterModelApiItem } from '../src/models-fetcher.js'

describe('OpenRouterFreeModelManager', () => {
  let modelManager: OpenRouterFreeModelManager
  let mockFetcher: any
  let mockNotify: any

  beforeEach(() => {
    mockFetcher = vi.fn()
    mockNotify = vi.fn()
    modelManager = new OpenRouterFreeModelManager({
      fetcher: mockFetcher,
      refreshIntervalMs: 3600 * 1000,
      notify: mockNotify,
    })
  })

  afterEach(() => {
    modelManager.stopPeriodicRefresh()
  })

  it('fetches models dynamically and has selected: true on discovered models', async () => {
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 Free' }],
      }),
    })
    const cached = await modelManager.getFreeModels(true)
    expect(cached.length).toBe(1)
    for (const model of cached) {
      expect(model.selected).toBe(true)
    }
  })

  it('filters strictly for free models (pricing 0/0 or :free/-free suffix)', () => {
    const freePricingItem: OpenRouterModelApiItem = {
      id: 'meta-llama/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B',
      pricing: { prompt: '0', completion: '0' },
    }
    const freeSuffixItem: OpenRouterModelApiItem = {
      id: 'meta-llama/llama-3.3-70b-instruct:free',
      name: 'Llama 3.3 70B Free',
    }
    const paidItem: OpenRouterModelApiItem = {
      id: 'openai/gpt-4o',
      name: 'GPT-4o',
      pricing: { prompt: '0.000005', completion: '0.000015' },
    }

    expect(modelManager.isFreeModel(freePricingItem)).toBe(true)
    expect(modelManager.isFreeModel(freeSuffixItem)).toBe(true)
    expect(modelManager.isFreeModel(paidItem)).toBe(false)
  })

  it('does not emit new model notification on initial startup background load, but notifies on subsequent new model discoveries', async () => {
    const initialApiResponse = {
      data: [
        {
          id: 'meta-llama/llama-3.3-70b-instruct:free',
          name: 'Llama 3.3',
        },
      ],
    }

    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => initialApiResponse,
    })

    // First fetch (e.g. at startup)
    await modelManager.getFreeModels(true)
    expect(mockNotify).not.toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'New OpenRouter Free Models Available',
      }),
    )

    // Second fetch: a new model appears
    const secondApiResponse = {
      data: [
        {
          id: 'meta-llama/llama-3.3-70b-instruct:free',
          name: 'Llama 3.3',
        },
        {
          id: 'brand-new-org/super-model:free',
          name: 'Super Model Free',
          context_length: 200000,
          architecture: { input_modalities: ['text', 'image'] },
          supported_parameters: ['reasoning_effort'],
        },
      ],
    }

    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => secondApiResponse,
    })

    const models = await modelManager.getFreeModels(true)
    expect(models.length).toBe(2)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ en: 'OpenRouter Free Models Updated' }),
        body: expect.objectContaining({ en: expect.stringContaining('Super Model Free') }),
      }),
    )
  })

  it('emits only completion notification when notifyOnEveryCheck is enabled', async () => {
    // Initial fetch to clear startup phase
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3' }],
      }),
    })
    await modelManager.getFreeModels(true)
    mockNotify.mockClear()

    modelManager.updateSettings({
      notifyOnNewModelsOnly: false,
      notifyOnEveryCheck: true,
      checkOnStartup: true,
      refreshIntervalMinutes: 60,
    })

    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3' }],
      }),
    })

    await modelManager.getFreeModels(true)

    // Should only have 1 call (completion) and NOT start spam
    expect(mockNotify).toHaveBeenCalledTimes(1)
    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ en: 'OpenRouter Free Models Checked' }),
        body: expect.objectContaining({ en: expect.stringContaining('Check complete: 1 free models available') }),
      }),
    )
  })

  it('respects checkOnStartup = false by skipping immediate fetch', () => {
    mockFetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    modelManager.updateSettings({
      notifyOnNewModelsOnly: true,
      notifyOnEveryCheck: false,
      checkOnStartup: false,
      refreshIntervalMinutes: 60,
    })

    modelManager.startPeriodicRefresh(false)
    expect(mockFetcher).not.toHaveBeenCalled()
  })

  it('notifies when a model is removed', async () => {
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3' },
          { id: 'mistralai/mistral-7b:free', name: 'Mistral 7B' },
        ],
      }),
    })
    await modelManager.getFreeModels(true)
    mockNotify.mockClear()

    // Second fetch: Mistral 7B removed
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [{ id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3' }],
      }),
    })
    await modelManager.getFreeModels(true)

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ en: 'OpenRouter Free Models Updated' }),
        body: expect.objectContaining({ en: expect.stringContaining('Removed (1): Mistral 7B') }),
      }),
    )
  })

  it('notifies on manual sync and includes list of new models if any', async () => {
    mockFetcher.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        data: [
          {
            id: 'meta-llama/llama-3.3-70b-instruct:free',
            name: 'Llama 3.3',
          },
          {
            id: 'brand-new-org/shiny-model:free',
            name: 'Shiny Model',
          },
        ],
      }),
    })

    await modelManager.getFreeModels(true, true)

    expect(mockNotify).toHaveBeenCalledWith(
      expect.objectContaining({
        title: expect.objectContaining({ en: 'OpenRouter Free Models Synchronized' }),
        body: expect.objectContaining({ en: expect.stringContaining('Shiny Model') }),
      }),
    )
  })

  it('periodic timer triggers periodic refresh and updates interval on setting change', async () => {
    vi.useFakeTimers()
    const timerManager = new OpenRouterFreeModelManager({
      fetcher: mockFetcher,
      settings: {
        notifyOnNewModelsOnly: true,
        notifyOnEveryCheck: false,
        checkOnStartup: true,
        refreshIntervalMinutes: 10,
      },
    })

    mockFetcher.mockResolvedValue({
      ok: true,
      json: async () => ({ data: [] }),
    })

    timerManager.startPeriodicRefresh(true)
    expect(mockFetcher).toHaveBeenCalledTimes(1)

    // Advance by 10 minutes
    vi.advanceTimersByTime(10 * 60 * 1000 + 5)
    expect(mockFetcher).toHaveBeenCalledTimes(2)

    // Update settings with 5 minutes
    timerManager.updateSettings({
      notifyOnNewModelsOnly: true,
      notifyOnEveryCheck: false,
      checkOnStartup: true,
      refreshIntervalMinutes: 5,
    })

    vi.advanceTimersByTime(5 * 60 * 1000 + 5)
    expect(mockFetcher).toHaveBeenCalledTimes(3)

    timerManager.stopPeriodicRefresh()
    vi.useRealTimers()
  })
})

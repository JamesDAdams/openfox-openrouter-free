import { join } from 'node:path'
import type { ProviderPluginRegistry, ProviderPreset } from 'openfox/provider'
import { OpenRouterFreeModelManager } from './models-fetcher.js'
import { OpenRouterCredentialStore } from './credentials.js'
import { OpenRouterAuthAdapter } from './auth.js'
import { OpenRouterFreeTransportAdapter } from './transport.js'
import { PluginSettingsStore } from './settings.js'
import './types.js'

export const openRouterFreePreset: ProviderPreset = {
  id: 'openrouter-free',
  name: 'OpenRouter (Free Models)',
  description: 'Use all free models available on OpenRouter with automatic updates.',
  documentationUrl: 'https://openrouter.ai/models?variant=free',
  requiresAuth: true,
  authAdapter: 'openrouter-free-auth',
  transportAdapter: 'openrouter-free-transport',
  defaults: {
    name: 'OpenRouter Free',
    url: 'https://openrouter.ai/api/v1',
    backend: 'openai',
  },
  connectLabel: 'Connect OpenRouter',
  disconnectLabel: 'Disconnect OpenRouter',
  missingPluginMessage: 'Install openfox-openrouter-free to use free OpenRouter models.',
}

export async function register(registry: ProviderPluginRegistry): Promise<void> {
  const storageDir = join(
    registry.runtime.configDirectory,
    'plugins',
    'openfox-openrouter-free',
  )
  const settingsStore = new PluginSettingsStore(
    join(storageDir, 'settings.json'),
  )
  const initialSettings = await settingsStore.load()

  const credentials = new OpenRouterCredentialStore(
    join(storageDir, 'credentials.json'),
  )
  const auth = new OpenRouterAuthAdapter(credentials)
  const modelManager = new OpenRouterFreeModelManager({
    settings: initialSettings,
    notify: (notification) => {
      if (typeof registry.notify === 'function') {
        registry.notify(notification)
      }
    },
  })
  modelManager.startPeriodicRefresh(initialSettings.checkOnStartup)

  const transport = new OpenRouterFreeTransportAdapter(modelManager, auth)

  registry.registerAuth(auth)
  registry.registerTransport(transport)
  registry.registerPreset(openRouterFreePreset)

  if (typeof registry.registerSettings === 'function') {
    registry.registerSettings({
      title: 'OpenRouter Free Models Configuration',
      description: 'Configure notification preferences and periodic synchronization for free OpenRouter models.',
      fields: [
        {
          key: 'checkOnStartup',
          label: 'Check models on OpenFox startup',
          type: 'boolean',
          description: 'Automatically check OpenRouter for new free models when OpenFox starts.',
          defaultValue: true,
        },
        {
          key: 'refreshIntervalMinutes',
          label: 'Check interval (minutes)',
          type: 'number',
          description: 'How often to automatically check OpenRouter for new free models (in minutes).',
          defaultValue: 60,
          required: true,
        },
        {
          key: 'notifyOnNewModelsOnly',
          label: 'Notify only when new models are available or a models was removed',
          type: 'boolean',
          description: 'Receive an in-app notification only when free models are added or removed on OpenRouter.',
          defaultValue: true,
        },
        {
          key: 'notifyOnEveryCheck',
          label: 'Notify on every check',
          type: 'boolean',
          description: 'Receive an in-app notification every time the background batch checks OpenRouter for models.',
          defaultValue: false,
        },
        {
          key: 'manualSync',
          label: '',
          type: 'button',
          buttonLabel: 'Sync Now',
        },
      ],
      async getSettings() {
        return (await settingsStore.load()) as unknown as Record<string, unknown>
      },
      async saveSettings(values: Record<string, unknown>) {
        const updated = await settingsStore.save(values)
        modelManager.updateSettings(updated)
      },
      async executeAction(action: string) {
        if (action === 'manualSync') {
          const models = await modelManager.getFreeModels(true, true)
          const newModels = modelManager.getLastDiscoveredModels()
          const removedModels = modelManager.getLastRemovedModels()
          const changes: string[] = []
          if (newModels.length > 0) changes.push(`${newModels.length} new: ${newModels.join(', ')}`)
          if (removedModels.length > 0) changes.push(`${removedModels.length} removed: ${removedModels.join(', ')}`)

          if (changes.length > 0) {
            return {
              message: `Sync complete: ${models.length} free models are available (${changes.join(' | ')}).`,
            }
          }
          return { message: `Sync complete: ${models.length} free models are available.` }
        }
      },
    })
  }
}

export { OpenRouterFreeModelManager } from './models-fetcher.js'
export { OpenRouterCredentialStore } from './credentials.js'
export { OpenRouterAuthAdapter } from './auth.js'
export { OpenRouterFreeTransportAdapter } from './transport.js'
export { PluginSettingsStore, DEFAULT_SETTINGS, type OpenRouterPluginSettings } from './settings.js'

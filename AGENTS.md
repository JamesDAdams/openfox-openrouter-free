# AGENTS.md — openfox-openrouter-free

Paths relative to `openfox-plugins/openfox-openrouter-free/`.

## Purpose

OpenRouter LLM provider for OpenFox, focused exclusively on free models. Hourly auto-refresh, 1-click OAuth or `OPENROUTER_API_KEY` authentication.

## Stack

- TypeScript, ESM, tsup, vitest 4.x
- peerDep: `openfox >=2.0.56 <3`, devDep: `openfox ^2.0.129`

## Commands

```bash
npm run build      # tsup
npm test           # vitest run --passWithNoTests
npm run typecheck  # tsc --noEmit
```

## Project Map

```
src/
├── index.ts            # Entry point (register, preset)
├── types.ts            # TypeScript types
├── settings.ts         # Provider configuration
├── auth.ts             # OAuth / API key authentication
├── credentials.ts      # Credentials management
├── transport.ts        # HTTP transport layer
└── models-fetcher.ts   # OpenRouterFreeModelManager (models retrieval)
```

## Where to Look What

- **Modify HTTP transport** → `src/transport.ts`
- **Modify authentication** → `src/auth.ts`
- **Modify models retrieval** → `src/models-fetcher.ts`
- **Add a setting** → `src/settings.ts`

## Conventions

- `apiVersion: 2`, capabilities: `presets`, `settings`, `tools`, `hooks`, `rpc`, `notifications`
- ESM build only via tsup
- `openfox` is externalized (provided by host)
- Tests in `tests/` (separate from `src/`)

## Cross-Project Dependencies

**Consumes**: `openfox/provider` (ProviderPluginRegistry, ProviderPreset).

**Consumed by**: OpenFox (loaded as provider plugin).

**Touchpoints**:

- `src/index.ts` (register, preset)
- `src/transport.ts` (OpenRouterFreeTransportAdapter)
- `src/models-fetcher.ts` (OpenRouterFreeModelManager)

## Known Gotchas

- `dist/index.js` is the entry point loaded by OpenFox, not `src/`.
- `credentials.json` must never be committed.
- Automatic hourly refresh of free models.

## Do Not Read / Do Not Touch

- `node_modules/`, `dist/`, `.git/`
- `credentials.json`

## Further Reading

- [README.md](README.md) — overview

---

> After any change affecting structure, a command, a convention, an inter-project contract, or a primary flow, update this file in the same commit. If any information here is inaccurate, fix it.

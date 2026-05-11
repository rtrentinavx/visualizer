# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev      # Vite dev server
npm run build    # tsc -b && vite build  — type errors break the build
npm run lint     # eslint .
npm run preview  # preview production build
vercel --prod    # deploy
```

There is **no test suite**. The only correctness gates are `tsc` (run via `npm run build`) and `eslint`.

Known harmless build warning: `TS2307: Cannot find module '@vercel/node'` in `api/ai/proxy.ts`. The Vercel build succeeds without those types.

## Architecture

This is a single-page React 19 + Vite 8 + Tailwind 4 app that visualizes and edits an Aviatrix Distributed Cloud Firewall policy model. The whole thing is one editable document plus several panels that view/mutate it.

### One model, one source of truth

`DcfPolicyModel` ([src/types/dcf.ts](src/types/dcf.ts)) is the canonical shape — `smartGroups`, `webGroups`, `threatGroups`, `geoGroups`, `policies`, `flows`. `App.tsx` holds it in a single `useState` and passes it (plus a setter) down to every panel. There is no Redux/Zustand/Context for app state — just props.

`DcfTopology` is a deprecated alias kept only for migration; new code uses `DcfPolicyModel`.

**Special SmartGroup IDs** used throughout the evaluator and simulator: `sg-any` (wildcard / matches anything) and `sg-internet` (the internet pseudo-group). Many checks and policy-matching paths key off these literal IDs — don't rename them.

**Policy precedence**: lower `priority` number wins, first match terminates. The evaluator (`policyEvaluator.ts`) and simulator (`policySimulator.ts`) both sort ascending by `priority` and stop at the first match.

### Top-level layout

- [src/App.tsx](src/App.tsx) (~1150 lines) — root container; owns topology state, view mode (`matrix` | `graph` | `traffic` | `simulator`), selected item, all modal flags. Edits flow up via callbacks.
- [src/components/panels/](src/components/panels/) — one file per major view: `PolicyMatrix`, `PolicyGraph`, `TrafficFlowPanel`, `PolicySimulator`, `InspectorPanel`, `EvaluatorPanel`, `AIChatPanel`, `AISettingsPanel`, `ImportPanel`.
- [src/components/modals/](src/components/modals/) — `RecommendationsModal`, `WebGroupPresetModal`, `BestPracticesModal`.
- [src/lib/](src/lib/) — pure logic modules (no React): evaluator, scorer, simulator, importExport, terraformExport, cryptoStorage, upstashSync, achievements, ipUtils.
- [src/lib/ai/](src/lib/ai/) — AI client, prompt builders, provider metadata, safety filters, schemas, settings storage.

### Persistence (three layers, all opt-in upgrades)

1. **In-memory** React state in `App.tsx`.
2. **Encrypted localStorage** via [src/lib/cryptoStorage.ts](src/lib/cryptoStorage.ts) — AES-GCM with a key derived from a **fixed passphrase + fixed salt** (defense against casual inspection, not targeted attack). Loads on mount, autosaves on topology change.
3. **Optional cloud sync** via [src/lib/upstashSync.ts](src/lib/upstashSync.ts) → [api/topology.ts](api/topology.ts) (Vercel Edge function backed by Upstash Redis, 30-day TTL).

### AI integration — always through the proxy

Client code in [src/lib/ai/client.ts](src/lib/ai/client.ts) **never** calls OpenAI/Anthropic/Google/Bedrock/Ollama/LMStudio directly. Every request goes to `/api/ai/proxy` ([api/ai/proxy.ts](api/ai/proxy.ts)) which:

- Rate-limits 30 req/min per IP (Upstash Redis).
- Caps body at 1MB and total message content at 50KB.
- Receives the user's API key in the POST body and forwards it to the provider — keys are never logged or stored server-side.
- Runs prompt-injection scanning client-side (`scanInput`) before the call and output filtering (`filterOutput`) after — see [src/lib/ai/safety.ts](src/lib/ai/safety.ts).

When adding a new provider, you need to (1) add it to the provider list in `src/lib/ai/providers.ts`, (2) wire a `proxy<Name>` function in `api/ai/proxy.ts`, and (3) handle the SSE/JSON streaming shape in `client.ts` `parseSSELine`.

### Policy evaluator

[src/lib/policyEvaluator.ts](src/lib/policyEvaluator.ts) runs 21 independent check functions over a `DcfPolicyModel` and returns an `EvaluationReport` (findings + score + per-category counts). Each `Finding` declares `severity`, `category` (`security`/`naming`/`performance`/`compliance`/`hygiene`), tagged `frameworks` (`Aviatrix BP` / `CIS` / `NIST ZT` / `Best Practice`), and an optional `fixable` flag. `applyAutoFix` in the same file dispatches on finding ID to mutate the topology. **When adding a check**: write a function returning `Finding[]`, call it from `evaluateTopology`, and — if it's fixable — add the corresponding case to `applyAutoFix`.

[src/lib/policyScorer.ts](src/lib/policyScorer.ts) is a separate compliance score (0–100) used in the gauge — distinct from the evaluator's internal score field.

### Simulator constraint

[src/lib/policySimulator.ts](src/lib/policySimulator.ts) resolves an IP to SmartGroups by walking `criteria` and matching CIDRs. **VM-tag criteria cannot be resolved from an IP alone** and are skipped silently — a group with only VM-tag criteria will never match a simulated flow. This is a known design limit, not a bug.

### Environment variables

`VITE_`-prefixed vars are inlined into the client bundle. Anything sensitive (`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `AWS_*`, `UPSTASH_REDIS_REST_*`) must **not** carry the `VITE_` prefix — those stay on the Vercel serverless side. The `.env.example`, `.env.preview`, `.env.prod`, `.env.vercel` files document the expected shape.

### Vercel deployment

[vercel.json](vercel.json) configures bot-protection rewrites and a CSP/HSTS/X-Frame header set. Edit headers there, not in code. The two serverless functions are `api/ai/proxy.ts` (Node runtime) and `api/topology.ts` (Edge runtime) — note the difference; Edge functions can't use Node-only SDKs like `@aws-sdk/client-bedrock-runtime`.

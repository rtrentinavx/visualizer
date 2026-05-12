# AI Use Policy

**Last revised**: 2026-05-11
**Applies to**: DCF Visualizer (this repository) and any deployment of it (Vercel, self-hosted, or otherwise).

This document describes what AI features the application provides, what data each feature sends to which providers, what safety controls are in place, and what limits and user responsibilities apply. It exists so that customers, auditors, and internal users can understand the data flow without reading the source.

---

## 1. Scope

The application embeds optional AI features that the user enables by adding a provider profile in **AI Settings**. With no profile configured, no AI features fire and no data leaves the browser through any AI path.

The AI features currently shipped are:

| Feature | Triggered by | Sends to AI | Returns |
|---|---|---|---|
| AI Chat about policy | "Sparkles" button (header) → free-form chat | Topology summary + user message | Streamed text + optional structured policy suggestion |
| AI Auto-Documentation | "FileText" button (header) | Full topology context | Markdown documentation |
| AI Reachability ("Will my web tier reach Salesforce?") | "Route" button (header) | Group + WebGroup name list + user question | Structured intent JSON (resolved + evaluated locally) |
| AI Policy Search | "FlaskConical" button (header) | Group + WebGroup name list + user question | Structured filter (applied locally) |
| AI Fix (Evaluator) | "AI Fix" button on an evaluator finding | The finding + topology context | Structured fix suggestion |
| AI Explain Policy (Inspector) | "Explain this policy" link in PolicyInspector | The selected policy JSON | Short prose explanation |

All AI calls go through the user-configured provider profile. The application never sends data to a default or backstop AI provider.

---

## 2. What gets sent to the AI provider

The following classes of data are included in AI prompts. Treat this as authoritative — any field below may appear in cleartext in the request body:

- **SmartGroup names** (e.g. `Web Tier`, `Payments-Prod-EU`)
- **SmartGroup criteria** — tag keys, operators, values (e.g. `app-tier=web`, `role=bastion`)
- **Subnet CIDRs** declared in SmartGroup subnet criteria (e.g. `10.0.0.0/16`)
- **WebGroup names** and **FQDN patterns** (e.g. `SaaS Essentials` → `*.salesforce.com, *.office.com`)
- **ThreatGroup names** and categories (e.g. `Malware Intel`, `malware`)
- **GeoGroup names** and **country codes** (e.g. `High-Risk Countries`, `CN, RU, KP, IR`)
- **Every policy's full attributes**: name, priority, source/destination group references, action, protocol, ports, logging flag, decrypt flag, enforcement flag, attached threat/geo/webgroup ids, exclude-group ids
- **Any free-text question** the user types in an AI feature

The data is **not** redacted before transmission. If your topology contains business-sensitive names, hostnames, or CIDR allocations, evaluate whether your chosen provider's data handling is acceptable for that content. The consent modal shown before the first AI call lists these classes again at the point of decision.

## 3. What does NOT get sent

- **API keys** — provider keys are forwarded server-side through the Vercel proxy but are never logged or persisted on our infrastructure. The proxy code path is the only server-side touch; see [api/ai/proxy.ts](api/ai/proxy.ts).
- **TrafficFlow logs** — used only for local Policy Impact Analysis, never sent to AI.
- **Cloud-sync topology snapshots** stored in Upstash (separate optional feature) are not piped to AI; the AI path reads only the in-memory topology.
- **Anything outside the configured topology** — the application sends no telemetry to AI providers beyond the prompt context. Browser identifiers, IPs, and session state are not part of the prompt.
- **Other users' topologies** — each browser session owns its own local topology.

---

## 4. Supported AI providers and data residency

The user chooses which provider receives their data. As of this writing:

| Provider | Default residency | Notes |
|---|---|---|
| **OpenAI** | United States | OpenAI processes API data in the US. Enterprise plans offer additional regions and zero-retention. |
| **Anthropic** | United States | Anthropic processes data in the US by default. EU residency is available on Enterprise plans. |
| **Google (Gemini)** | United States | Gemini API processes data in the US primarily; region depends on your GCP project. |
| **AWS Bedrock** | Configured AWS region | Data is processed in the AWS region set in the profile's `apiBaseUrl` field (e.g. `us-east-1`, `eu-west-1`). |
| **Ollama (local)** | Local — your machine | Calls go directly from the browser to your local Ollama instance. No data leaves your network. |
| **LM Studio (local)** | Local — your machine | Same as Ollama: direct browser-to-localhost, no egress. |
| **Custom OpenAI-compatible** | Unknown (your endpoint) | Data residency is whatever your custom endpoint is. The application can't determine this. |

The application displays residency badges next to each provider in **AI Settings** and in the **data-egress consent modal**. The residency information is best-effort and reflects the providers' general defaults as of the policy's revision date; consult the provider's own documentation for your specific account.

---

## 5. Data-egress consent

Before the first AI call, the user sees a **data-egress consent modal** that:

1. Names the active provider and its residency
2. Lists every data class from Section 2
3. Lists every exclusion from Section 3
4. Requires an explicit "I understand" checkbox before the Continue button enables

The user's acknowledgment is stored as a localStorage flag (`dcf-ai-data-egress-consent`) on that device. It is **not** synchronized with any server and **not** shared across browsers or devices. Each new device prompts again.

The user can **revoke consent** by clearing localStorage for the application or by clicking a Revoke action in AI Settings (when implemented). After revocation, the next AI call re-prompts.

---

## 6. Safety controls

The application ships layered controls. Each is in source as code; this section documents what's enforced where so auditors can read the code and confirm.

### Input pipeline

- **Sanitization** (`src/lib/ai/safety.ts:sanitizeInput`) — strips control characters and collapses excessive newlines before any string is sent.
- **Pattern scan** (`scanInput`) — regex match against known prompt-injection prefixes ("ignore previous instructions", `<system>` tags, `system:` prefixes, etc.). Returns one of: `clean`, `suspicious`, `blocked`. Blocked input causes the AI call to throw before any network request.
- **XML delimiters on user input** (`delimitUserInput`) — used in AI Chat to bracket free-text input with anti-injection markers and a closing instruction.
- **Topology-data delimiters** (`wrapTopologyContext`) — every prompt context that includes topology fields wraps them in `<<<BEGIN_TOPOLOGY_DATA (untrusted)>>>` / `<<<END_TOPOLOGY_DATA>>>` markers with an anti-injection note. Group names like `"Ignore previous instructions"` land inside untrusted-data territory.
- **Content moderation (OpenAI provider only)** — when the active provider is OpenAI, the user's question is sent to OpenAI's free Moderation API before the main call. Flagged content blocks the call. Other providers don't offer an equivalent free endpoint; moderation is a no-op there.

### Output pipeline

- **Pattern filter** (`filterOutput`) — checks AI output for instruction-override patterns (block) and credential-shaped substrings (flag).
- **Credential redaction** (`redactSecrets`) — replaces credential-shaped substrings (`sk-ant-*`, `sk-*`, `AKIA*`, `AIza*`, `ghp_*`, `xox*`, `Bearer + 32+ chars`, 40+ char hex) with `[REDACTED-*]` placeholders before the application renders or applies any AI output. Applied in both non-streaming returns and the streaming-buffer final pass.
- **Schema validation** (Zod) — every AI feature that returns structured output validates against a schema (`PolicySuggestionArraySchema`, `EvaluatorFixSchema`, `ReachabilityIntentSchema`, `PolicySearchFilterSchema`). Outputs that fail validation are surfaced as errors, not rendered.
- **Policy-suggestion validator** (`validatePolicySuggestion`) — final check before the user can apply an AI-suggested policy: blocks injection-shaped policy names ("ignore", "override", "admin", "root", "system") and overly permissive any-to-any allow.

### Transport

- **Rate limit** — 30 requests per minute per IP, enforced by the proxy with Upstash Redis.
- **Body size cap** — request body limited to 1 MB; total user-message content limited to 50 KB. Oversize requests are rejected before reaching the AI provider.
- **TLS** — all provider endpoints are HTTPS.
- **No server-side logging of keys or prompts** — code-reviewed; the proxy receives the key in the POST body, forwards it to the provider, and discards it.

### Architectural controls

- **No agentic loops** — AI suggestions never auto-apply. Every change requires a user click ("Apply", "Fix it for me", etc.).
- **Engine-decides outcomes** — Reachability and Policy Search use the AI only to extract structured intent. The actual verdict / filter is computed by a deterministic engine against the live topology, not by the model.
- **Prompt versioning** — every prompt has a version (`PROMPT_VERSIONS.*`). The version is sent in the request payload for traceability.

---

## 7. Limitations the user must understand

- **Hallucination is possible**. The model may suggest groups or attachments that don't exist; the application instructs the AI to mark inferred values as `[INFERRED]` and to refuse to invent groups, but enforcement is best-effort. Always verify AI suggestions against the actual topology before applying.
- **Prompt injection is partially mitigated, not eliminated**. The pattern-based input scan is bypassable with Unicode tricks, base64, or novel phrasings. If the topology itself is malicious or compromised, do not enable AI features.
- **Credential redaction is pattern-based**. If a provider invents an unusual key shape, it may slip through. Inspect AI output, especially in automated pipelines.
- **Provider terms apply**. Each provider has its own retention, training-data, and acceptable-use policies. The application's controls do not override the provider's. Read the provider's terms before sending sensitive data.
- **Local providers (Ollama, LM Studio) have no built-in safety**. A jailbroken local model can output anything; the output filters and redaction still run, but moderation is not available for local providers.

---

## 8. User responsibilities

By enabling AI features, the user agrees to:

1. **Review AI output** before applying any change. The "Apply" buttons are deliberately user-driven; auto-apply is not a feature.
2. **Choose a provider whose data-handling terms** match the sensitivity of the topology being analyzed.
3. **Not enable AI features on a compromised or untrusted topology**.
4. **Provide an API key the user is authorized to use**.
5. **Acknowledge the data-egress consent** before the first call. The consent text reflects the data classes in Section 2; acknowledgment indicates the user has read and accepted them.

---

## 9. Revoking access / opting out

- **Disable AI**: delete all provider profiles in AI Settings. With no active profile, the AI buttons in the header disappear and no AI calls can be made.
- **Revoke consent**: clear the `dcf-ai-data-egress-consent` localStorage entry. The next AI call re-prompts.
- **Delete the local topology**: the AI features have no separate data store; clearing localStorage removes everything the AI features see.

There is no server-side state to delete for AI features (the proxy is stateless). Any data already sent to a third-party provider falls under that provider's retention policy; see the provider's own data-deletion process.

---

## 10. Audit hooks

For internal audits, the following are inspectable in source:

- All system prompts: [src/lib/ai/prompts.ts](src/lib/ai/prompts.ts), [promptsReachability.ts](src/lib/ai/promptsReachability.ts), [promptsSearch.ts](src/lib/ai/promptsSearch.ts)
- Safety helpers and tests: [src/lib/ai/safety.ts](src/lib/ai/safety.ts), [src/lib/ai/safety.test.ts](src/lib/ai/safety.test.ts)
- The proxy: [api/ai/proxy.ts](api/ai/proxy.ts) and per-provider modules under [api/ai/providers/](api/ai/providers/)
- Consent and gating: [src/lib/aiDataConsent.ts](src/lib/aiDataConsent.ts), [src/components/modals/AIDataConsentModal.tsx](src/components/modals/AIDataConsentModal.tsx), `gateAI` in [src/App.tsx](src/App.tsx)
- Prompt version pinning: `PROMPT_VERSIONS` export in [src/lib/ai/prompts.ts](src/lib/ai/prompts.ts)

## 11. Change history

| Date | What changed |
|---|---|
| 2026-05-11 | Initial publication. P0 Responsible-AI hardening landed: consent modal, topology-data delimiters, credential redaction, `validatePolicySuggestion` wired. |

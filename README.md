# DCF Visualizer

A visual policy design, simulation, and analysis tool for [Aviatrix Distributed Cloud Firewall (DCF)](https://docs.aviatrix.com/documentation/latest/aviatrix-governance-service-dcf/aviatrix-governance-service-dcf-overview.html). Build, evaluate, and simulate micro-segmentation policies across cloud environments without writing a single line of Terraform.

**Live Demo:** [dcf-visualizer.vercel.app](https://dcf-visualizer.vercel.app)

---

## What It Does

Aviatrix DCF uses SmartGroups, WebGroups, ThreatGroups, and GeoGroups to define zero-trust policies between workloads. This tool gives you a visual canvas to design those policies, catch mistakes before they hit production, and simulate traffic flows between real IPs.

### Core Views

| View | Purpose |
|------|---------|
| **Matrix** | Grid of Source → Destination SmartGroups. Click any cell to see or create policies. Diagonal cells are blanked (intra-group traffic). Sticky headers, compact 90px cells. |
| **Graph** | Circular node layout with directed policy edges. Drag nodes to reposition. Lock/unlock layout toggle. "Draw Policy" mode to connect groups with a new policy. |
| **Traffic** | Manual flow logging with add/edit/delete. Import/export JSON/CSV. See which policies allowed or denied historical flows. |
| **Simulator** | What-If traffic tester. Type a source IP and destination IP — the tool resolves them to SmartGroups via CIDR matching, then evaluates all policies to tell you if the traffic is **Allowed** or **Denied**. |

### Policy Editing

Click any policy, group, or matrix cell to open the **Inspector Panel**:

- **SmartGroups** — VM tag criteria (`env=prod`, `app-tier=web`) or subnet CIDRs
- **WebGroups** — FQDN allowlists (`*.salesforce.com`, `*.github.com`)
- **ThreatGroups** — Malware, botnet, phishing, anonymous IP categories
- **GeoGroups** — Country-level blocking (`CN`, `RU`, `KP`, `IR`)
- **Policies** — Source, destination, action (allow/deny), protocol, ports, logging, TLS decryption, threat/geo attachment, webgroup attachment, exclude groups

**Auto-naming** — Click "Auto" to generate human-readable policy names from rule attributes.

**WebGroup Preset Library** — Browse 6 curated presets (SaaS Essentials, Social Media, Streaming, Dev Tools, Gambling Blocklist, Ad Networks). On first load, a recommendations modal lets you pick which to add.

---

## Policy Evaluator

Runs 21 automated checks across **Aviatrix Best Practices**, **CIS Controls**, and **NIST Zero Trust** frameworks.

### Checks by Category

**Security**
- Missing catch-all deny policy
- Overly permissive any→any allow rules
- Conflicting actions on same src/dst/proto/port
- Internet policies without threat/geo filtering
- Overly broad allow (any protocol, any port)
- Learned rules without deny-all fallback
- High-priority broad rules that shadow specific ones
- HTTPS egress without TLS inspection

**Compliance**
- WebGroup rules must target Internet
- TLS decryption should target port 443
- TLS decryption requires TCP protocol
- Deny policies without logging
- Allow policies without logging

**Performance**
- Shadowed policies (lower-priority rules that never match)

**Naming**
- Duplicate policy names
- Duplicate priorities

**Hygiene**
- Unused SmartGroups, WebGroups, ThreatGroups, GeoGroups
- Policies with enforcement disabled
- Self-to-self policies

### Evaluator UI

- **Compliance Score** — Circular gauge (0–100) with letter grade (A/B/C/D/F)
- **Category Filters** — Click Security, Naming, Performance, Compliance, or Hygiene to drill down
- **Framework Badges** — Every finding is tagged with its source standard
- **"Fix it for me"** — One-click auto-fix for 9 common issues:
  - Enable logging
  - Set TLS decrypt to TCP/443
  - Change WebGroup destination to Internet
  - Disable shadowed policies
  - Create catch-all deny
  - Deduplicate names/priorities
- **AI Fix** — Stream a contextual fix suggestion from your configured LLM

---

## AI Integration

Connect an LLM to get contextual help:

- **Explain Policy** — AI analyzes a policy and explains what it does, potential risks, and how it fits the topology
- **AI Fix** — The evaluator sends the finding + topology to the model and streams back a remediation suggestion
- **AI Chat** — Free-form chat about your policy model

**Supported Providers:** OpenAI, Anthropic, Google Gemini, AWS Bedrock, Ollama, LM Studio, Custom OpenAI-compatible endpoints.

Rate-limited serverless proxy via `/api/ai/proxy`.

---

## Import / Export

| Format | In | Out |
|--------|-----|-----|
| **JSON** | ✅ Full topology | ✅ Full topology |
| **Terraform HCL** | ✅ `aviatrix_smart_group`, `aviatrix_dcf_policy_list` resources | ✅ Generated `.tf` file download |
| **CSV** | ✅ Traffic flows | ✅ Traffic flows |

---

## Persistence & Sync

- **Encrypted localStorage** — Topology is AES-GCM encrypted with a device-derived key. No password required.
- **Cloud Sync** — Optional Upstash Redis sync. Save/load your topology across devices.

---

## Tech Stack

- **Frontend:** React 19, Vite 8, TypeScript 6, Tailwind CSS 4
- **State:** React hooks (no external state library)
- **Persistence:** `localStorage` with Web Crypto API encryption
- **AI Proxy:** Vercel Serverless Function (Node.js) with rate limiting
- **Deploy:** Vercel
- **Error Tracking:** Sentry feedback widget

---

## Environment Variables

Copy `.env.example` to `.env` and fill in:

```bash
# AI Proxy (server-side only)
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_API_KEY=...
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_REGION=us-east-1

# Cloud Sync
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...

# Sentry
VITE_SENTRY_DSN=https://...@....ingest.sentry.io/...
```

> **Note:** `VITE_` prefixed variables are embedded in the client bundle. API keys for the proxy should **not** have the `VITE_` prefix — they stay server-side.

---

## Development

```bash
npm install
npm run dev
```

Build for production:

```bash
npm run build
```

Deploy to Vercel:

```bash
vercel --prod
```

---

## Known Issues

- `TS2307: Cannot find module '@vercel/node'` — Harmless type error in `api/ai/proxy.ts` during Vercel builds. The build succeeds; types are not needed at runtime.
- Bundle size warning (>500KB) — Main chunk includes React, Lucide icons, and AI schemas. Code splitting is on the backlog.

---

## License

MIT

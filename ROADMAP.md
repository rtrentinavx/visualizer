# DCF Visualizer Roadmap

## Done

### Core Platform
- [x] 4-tab layout: Matrix, Graph, Traffic, Simulator
- [x] Full editing for SmartGroups, WebGroups, ThreatGroups, GeoGroups, Policies
- [x] Inspector Panel with auto-name generation
- [x] Encrypted localStorage persistence (Web Crypto API)
- [x] Cloud sync via Upstash Redis
- [x] Sentry feedback widget integration
- [x] Dark mode with system preference support

### Policy Design
- [x] **Matrix** — Grid view with sticky headers, diagonal blanking, cell click → policy editor
- [x] **Graph** — Circular node layout with directed edges, drag-and-drop repositioning, lock/unlock toggle, "Draw Policy" connect mode
- [x] **Auto-naming** — Generate names from rule attributes (src, dst, action, protocol, ports, webgroups)

### Policy Evaluator (21 checks)
- [x] Shadowed policy detection
- [x] Missing catch-all deny
- [x] Overly permissive any→any allow
- [x] Conflicting actions
- [x] Internet policies without threat/geo filtering
- [x] Overly broad allow (any protocol, any port)
- [x] Learned rules without deny-all
- [x] High-priority broad rules
- [x] HTTPS egress without TLS inspection
- [x] WebGroup rules must target Internet
- [x] TLS decrypt port/protocol violations
- [x] Deny/allow policies without logging
- [x] Duplicate policy names and priorities
- [x] Unused groups (SmartGroup, WebGroup, ThreatGroup, GeoGroup)
- [x] Self-to-self policies
- [x] Policies with enforcement disabled
- [x] Compliance score (0–100) with grade
- [x] Category filters (Security, Naming, Performance, Compliance, Hygiene)
- [x] Framework badges (Aviatrix BP, CIS, NIST ZT, Best Practice)
- [x] "Fix it for me" auto-fix for 9 common issues

### Simulation
- [x] **Traffic Flow** — Manual add/edit/delete/import/export (JSON/CSV)
- [x] **Policy Simulator** — IP-based What-If testing with CIDR-to-SmartGroup resolution

### Presets & Templates
- [x] WebGroup Preset Library — 6 curated categories with search/filter
- [x] Recommendations modal on fresh load

### AI Integration
- [x] 7 AI providers: OpenAI, Anthropic, Google, Ollama, LM Studio, AWS Bedrock, Custom
- [x] Policy explanation streaming
- [x] AI-powered evaluator fixes
- [x] Free-form AI chat about topology
- [x] Rate limiting on AI proxy

### Import / Export
- [x] Terraform HCL export (`aviatrix_smart_group`, `aviatrix_dcf_policy_list`)
- [x] JSON topology import/export
- [x] CSV traffic flow import/export
- [x] Import from Terraform HCL
- [x] Import from a Terraform project zip — drag-drop or pick a `.zip`, we extract every `.tf` file (skipping `.terraform/` vendored content) locally in the browser via fflate, then pull only Aviatrix DCF resources. Non-DCF resources are silently ignored.

---

## In Progress / Next Up

### Undo / Redo
- [ ] Global action history with `Cmd/Ctrl+Z`
- [ ] Action log sidebar showing recent changes

### Policy Templates
- [ ] Pre-built policy patterns: "Zero Trust Default Deny", "Bastion Access", "Internet Egress with ThreatBlock"
- [ ] One-click add complete policy + required groups

### Mobile Responsiveness
- [ ] Collapse InspectorPanel into a slide-out drawer on tablet/mobile
- [ ] Stack header buttons into a hamburger menu
- [ ] Make Matrix horizontally scrollable with sticky row headers
- [ ] Reduce graph node sizes and label font on small screens
- [ ] Test and fix Simulator form layout on narrow viewports

---

## Backlog

### Data & Integration
- [ ] **Live flow ingestion** — Ingest real NetFlow/sFlow/pcap data to populate flows automatically
- [ ] **Aviatrix Controller API import** — Pull live SmartGroups and policies from a real controller
- [ ] **CSV/Excel import/export** — Bulk policy editing in spreadsheets
- [ ] **Version history / diff view** — Show what changed between saves

### Simulation & Analysis
- [ ] **Batch simulation** — Test multiple flows at once (e.g. from a packet capture)
- [ ] **Path visualization** — Show the exact gateway path a packet would take
- [ ] **Policy impact analysis** — "If I change this policy, what flows are affected?"
- [ ] **Simulator WebGroup support** — Resolve FQDN destinations in What-If tests
- [ ] **Simulator ThreatGroup/GeoGroup support** — Check threat intel and geo blocks

### UX & Polish
- [ ] **Keyboard shortcuts** — `Cmd/Ctrl+K` command palette, arrow keys in matrix
- [ ] **Drag-and-drop policy reordering** — Reorder priorities visually
- [ ] **Onboarding tour** — First-time user guided walkthrough
- [x] **Bundle size optimization** — Code-splitting, lazy load AI schemas (shipped: 500KB → 229KB initial chunk via React.lazy + manualChunks)

### AI Enhancements
- [x] **Policy optimization suggestions** — "This policy can be merged with X" (shipped: 2 new evaluator checks — `redundant-*` info findings, `mergeable-*` with auto-fix that unions ports into the lowest-priority policy)
- [ ] **Natural language search** — "Show me all policies that allow web tier to database"
- [x] **Auto-documentation** — Generate human-readable policy docs from topology (shipped: FileText button in header opens streaming Markdown generation with copy/download)
- [ ] **AI-powered simulator** — "Will my web servers reach Salesforce?"

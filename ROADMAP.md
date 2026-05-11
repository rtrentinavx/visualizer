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
- [x] **Matrix source/destination filters** — independent filters for the row dimension (source) and column dimension (destination), each with its own clear button and a live `rows×cols of N×N` counter. Replaces the single combined filter that narrowed both at once.
- [x] **Graph** — Circular node layout with directed edges, drag-and-drop repositioning, lock/unlock toggle, "Draw Policy" connect mode
- [x] **Auto-naming** — Generate names from rule attributes (src, dst, action, protocol, ports, webgroups)

### Policy Evaluator (23 checks)
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
- [x] "Fix it for me" auto-fix for 10 common issues (including mergeable-policy port-union)
- [x] **Redundant-policy detection** — info finding when a same-action policy is fully covered by a later broader policy
- [x] **Mergeable-policy detection** — info finding + auto-fix when 2+ policies differ only in ports; auto-fix unions ports into the lowest-priority policy

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
- [x] **Live model list fetching** — "Fetch models" button in AI settings pulls the current model list from each provider. Remote providers go through `/api/ai/models`; Ollama and LM Studio are fetched directly from the browser (Vercel functions can't reach localhost). Bedrock returns a curated list pending the separate `@aws-sdk/client-bedrock` SDK.
- [x] **Auto-documentation** — FileText button in header generates a Markdown summary of the topology with copy/download (see AI Enhancements).

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
- [x] Pre-built policy patterns: "Zero Trust Default Deny", "Bastion Access", "Internet Egress with ThreatBlock", "Three-Tier Web Application"
- [x] One-click add complete policy + required groups (dedupes existing groups by name, skips duplicate policies, bumps colliding priorities)

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
- [x] **Policy impact analysis** — "If I change this policy, what flows are affected?" (shipped: collapsible Impact card in PolicyInspector below the score card. Computes before/after diffs across all logged TrafficFlows on every keystroke. Reports outcome flips and match-rule shifts separately.)
- [x] **Simulator WebGroup support** — Optional "Destination FQDN" field in the simulator's Advanced section. The FQDN is glob-matched (case-insensitive, `*` wildcards) against every WebGroup's `fqdns` list. Policies that attach a WebGroup only match when the FQDN resolves to one of them; broad-internet policies (no WebGroup attached) still match.
- [x] **Simulator ThreatGroup/GeoGroup support** — Optional Src/Dst ThreatGroup and Src/Dst GeoGroup dropdowns in Advanced (the simulator can't infer threat or country from an IP). Policies that attach a ThreatGroup or GeoGroup now require the override to be set to match — previously they matched silently regardless, which was incorrect.

### UX & Polish
- [ ] **Keyboard shortcuts** — `Cmd/Ctrl+K` command palette, arrow keys in matrix
- [x] **Drag-and-drop policy reordering** — ListOrdered button in header opens a sortable list of every policy. Drag rows via the grip handle (pointer + keyboard, accessible via @dnd-kit). Apply renumbers to a uniform 10-step ladder starting at priority 100.
- [ ] **Onboarding tour** — First-time user guided walkthrough
- [x] **Bundle size optimization** — Code-splitting, lazy load AI schemas (shipped: 500KB → 229KB initial chunk via React.lazy + manualChunks)
- [x] **Independent matrix filters** — separate source (row) / destination (column) filter inputs

### AI Enhancements
- [x] **Policy optimization suggestions** — "This policy can be merged with X" (shipped: 2 new evaluator checks — `redundant-*` info findings, `mergeable-*` with auto-fix that unions ports into the lowest-priority policy)
- [x] **Natural language search** — "Show me all policies that allow web tier to database" (shipped: FlaskConical button in header opens PolicySearchModal. AI extracts structured filter criteria (src/dst names, actions, protocols, port, hasThreat/Geo/WebGroup flags, decryptOnly, loggingDisabled), engine resolves names + applies AND-semantics filter, results listed with one-click open-in-inspector.)
- [x] **Auto-documentation** — Generate human-readable policy docs from topology (shipped: FileText button in header opens streaming Markdown generation with copy/download)
- [x] **AI-powered simulator** — "Will my web servers reach Salesforce?" (shipped: Route button in header opens ReachabilityModal. AI extracts structured intent (src/dst names, protocol, port), engine resolves names against the live topology and runs first-match-wins evaluation, modal shows verdict + matched policy + AI's assumptions for transparency.)

# DCF Visualizer Roadmap

## Done
- [x] 3-tab layout: Matrix, Graph, Traffic
- [x] Full editing for SmartGroups, WebGroups, ThreatGroups, GeoGroups, Policies
- [x] Terraform export
- [x] Policy Evaluator (shadow detection, missing deny-all, overly permissive, etc.)
- [x] AI integration: Settings, Chat, Evaluator Fixes, Policy Explanation
- [x] 7 AI providers: OpenAI, Anthropic, Google, Ollama, LM Studio, AWS Bedrock, Custom
- [x] Encrypted localStorage persistence
- [x] Cloud sync via Upstash Redis
- [x] Rate limiting on AI proxy
- [x] Import from JSON / Terraform HCL
- [x] Policy Simulator (What-If traffic test)

## In Progress / Next Up

### Mobile Responsiveness
The current 3-column layout breaks on screens smaller than ~1024px.
- [ ] Collapse InspectorPanel into a slide-out drawer on tablet/mobile
- [ ] Stack header buttons into a hamburger menu
- [ ] Make Matrix horizontally scrollable with sticky row headers
- [ ] Reduce graph node sizes and label font on small screens
- [ ] Test and fix Simulator form layout on narrow viewports

## Backlog

### Data & Integration
- [x] **Traffic Flow management** — Manual add/edit/delete/import/export of traffic flows (JSON/CSV)
- [ ] **Live flow ingestion** — Ingest real NetFlow/sFlow/pcap data to populate flows automatically
- [ ] **Aviatrix Controller API import** — Pull live SmartGroups and policies from a real controller
- [ ] **CSV/Excel import/export** — Bulk policy editing in spreadsheets
- [ ] **Version history / diff view** — Show what changed between saves
- [ ] **Auto-save** — Debounced localStorage writes instead of manual persistence

### Simulation & Analysis
- [ ] **Batch simulation** — Test multiple flows at once (e.g. from a packet capture)
- [ ] **Path visualization** — Show the exact gateway path a packet would take
- [ ] **Policy impact analysis** — "If I change this policy, what flows are affected?"

### UX & Polish
- [ ] **Keyboard shortcuts** — `Cmd/Ctrl+K` command palette, arrow keys in matrix
- [ ] **Undo/redo** — Global action history with `Cmd/Ctrl+Z`
- [ ] **Drag-and-drop policy reordering** — Reorder priorities visually
- [ ] **Dark mode refinements** — Better contrast ratios, system preference detection
- [ ] **Onboarding tour** — First-time user guided walkthrough

### AI Enhancements
- [ ] **Policy optimization suggestions** — "This policy can be merged with X"
- [ ] **Natural language search** — "Show me all policies that allow web tier to database"
- [ ] **Auto-documentation** — Generate human-readable policy docs from topology

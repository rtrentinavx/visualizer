import { X, Sparkles } from 'lucide-react';
import { clearTourFlags } from '../../lib/tourDismissal';

interface AboutModalProps {
  onClose: () => void;
  onReplayTour: () => void;
}

export default function AboutModal({ onClose, onReplayTour }: AboutModalProps) {
  const handleReplayTour = () => {
    clearTourFlags();
    onClose();
    onReplayTour();
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">About DCF Visualizer</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 overflow-auto p-4 space-y-4 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <p>
            <strong>DCF Visualizer</strong> is an interactive design and validation tool for Aviatrix Distributed Cloud Firewall (DCF) policies.
            Model SmartGroups, WebGroups, ThreatGroups, GeoGroups, and the policies that govern traffic between them — with real-time scoring and best-practice validation aligned to Aviatrix, CIS, and NIST Zero Trust frameworks.
          </p>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Views</h3>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li><strong>Matrix</strong> — Grid view of SmartGroup → SmartGroup policies with sticky headers and priority-aware rendering</li>
              <li><strong>Graph</strong> — Circular node layout with draggable nodes, lock/unlock layout toggle, and Draw Policy mode</li>
              <li><strong>Traffic</strong> — What-If simulator (enter src/dst IPs, the tool resolves to SmartGroups via CIDR matching) plus the saved-flows log. Save any simulation result as a flow with one click; JSON/CSV import-export.</li>
              <li><strong>AI</strong> — Configure AI providers and profiles for policy explanation, evaluator fixes, reachability, search, and auto-docs</li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Policy Lifecycle</h3>
            <ul className="list-disc list-inside space-y-1 text-xs">
              <li><strong>Create & Edit</strong> — Full policy editor with auto-naming, live score (0-100), and grade (F/D/C/B/A)</li>
              <li><strong>WebGroup Presets</strong> — Browse a curated library of 6 preset categories (SaaS, Social, Streaming, Dev Tools, Gambling, Ads) and add them with one click</li>
              <li><strong>Evaluate</strong> — 21 automated checks across Security, Compliance, Performance, Naming, and Hygiene. Compliance score (0–100), category filters, and framework badges (Aviatrix BP, CIS, NIST ZT)</li>
              <li><strong>Fix it for me</strong> — One-click auto-fix for common issues: enable logging, correct TLS settings, fix WebGroup destinations, disable shadowed policies, deduplicate names/priorities</li>
              <li><strong>AI Assist</strong> — Policy explanation, evaluator fix suggestions, and free-form chat via OpenAI, Anthropic, Google, Ollama, LM Studio, or AWS Bedrock</li>
              <li><strong>Export</strong> — Terraform (Aviatrix provider), CSV flows</li>
              <li><strong>Import</strong> — Terraform HCL paste or project zip upload (aviatrix_smart_group + aviatrix_dcf_policy_list)</li>
            </ul>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Gamification</h3>
            <p className="text-xs">
              Earn achievements as you build: Policy Creator, Deny Master, Specificity King, Zero Shadow, High Performer, and more.
              Track your progress via the medal icon in the header.
            </p>
          </div>
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Security & Privacy</h3>
            <p className="text-xs">
              Topology data is encrypted with AES-GCM in your browser's localStorage. API keys for AI providers are encrypted and never logged.
              Cloud sync (optional) uses Upstash Redis. No data leaves your browser unless you explicitly enable cloud sync or AI features.
            </p>
          </div>
          <div className="pt-2 border-t border-[var(--color-border-subtle)]">
            <button
              onClick={handleReplayTour}
              className="flex items-center gap-1.5 text-xs text-[var(--color-accent-purple)] hover:underline"
            >
              <Sparkles size={12} /> Take the tour
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

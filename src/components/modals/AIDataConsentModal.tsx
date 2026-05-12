import { useState } from 'react';
import { X, ShieldAlert, Check, MapPin } from 'lucide-react';
import type { AIProfile } from '../../lib/ai/types';
import { grantAIDataConsent } from '../../lib/aiDataConsent';
import { getResidency } from '../../lib/ai/residency';

interface AIDataConsentModalProps {
  /** The profile the user is about to use, so we can name the provider. */
  profile: AIProfile | null;
  onCancel: () => void;
  onConfirm: () => void;
}

const PROVIDER_LABEL: Record<string, string> = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google (Gemini)',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  bedrock: 'AWS Bedrock',
  custom: 'a custom endpoint',
};

export default function AIDataConsentModal({ profile, onCancel, onConfirm }: AIDataConsentModalProps) {
  const [acked, setAcked] = useState(false);
  const providerLabel = profile ? (PROVIDER_LABEL[profile.provider] ?? profile.provider) : 'the configured AI provider';
  const residency = profile ? getResidency(profile.provider) : null;
  const isLocal = residency?.local ?? false;

  const handleConfirm = () => {
    if (!acked) return;
    grantAIDataConsent();
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <ShieldAlert size={18} className="text-amber-400" />
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Heads up — data egress</h2>
          </div>
          <button onClick={onCancel} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="p-4 space-y-3 text-xs text-[var(--color-text-secondary)] leading-relaxed">
          <p>
            AI features send your topology to <strong>{providerLabel}</strong>{isLocal ? ' running on your machine' : ''}.
          </p>
          {residency && (
            <div className="flex items-start gap-2 px-2.5 py-2 rounded border" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
              <MapPin size={12} className={residency.local ? 'text-emerald-500 mt-0.5' : 'text-amber-400 mt-0.5'} />
              <div>
                <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Data residency</div>
                <div className="text-[11px] text-[var(--color-text-primary)] mt-0.5">{residency.short}</div>
                <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{residency.long}</div>
              </div>
            </div>
          )}
          <div>
            <p className="font-medium text-[var(--color-text-primary)] mb-1">What gets sent:</p>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>SmartGroup names and tag-based criteria (e.g. <code className="text-[10px] bg-[var(--color-surface-elevated)] px-1 rounded">env=prod</code>)</li>
              <li>Subnet CIDRs from group criteria</li>
              <li>WebGroup names and FQDN patterns (e.g. <code className="text-[10px] bg-[var(--color-surface-elevated)] px-1 rounded">*.salesforce.com</code>)</li>
              <li>ThreatGroup / GeoGroup names and country codes</li>
              <li>Every policy: name, src/dst, action, protocol, ports, logging flags</li>
              <li>Plus any natural-language question you type</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-[var(--color-text-primary)] mb-1">What does NOT get sent:</p>
            <ul className="list-disc list-inside space-y-0.5 pl-1">
              <li>Your API keys (passed through the Vercel proxy, never logged)</li>
              <li>TrafficFlow logs (kept local for impact analysis)</li>
              <li>Anything outside the configured topology</li>
            </ul>
          </div>
          {!isLocal && (
            <p className="text-[10px] text-[var(--color-text-muted)] italic">
              Topology data is not redacted before transmission. If your topology contains business-sensitive
              names or CIDRs, evaluate whether your provider's data-retention terms are acceptable for that data.
            </p>
          )}

          <label className="flex items-start gap-2 mt-3 cursor-pointer">
            <input
              type="checkbox"
              checked={acked}
              onChange={(e) => setAcked(e.target.checked)}
              className="mt-0.5 rounded"
            />
            <span>I understand the data above will be sent to {providerLabel} and I want to proceed.</span>
          </label>

          <p className="text-[10px] text-[var(--color-text-muted)]">
            For the full policy — data classes, safety controls, provider residency, audit hooks — see the{' '}
            <a
              href="https://github.com/rtrentinavx/visualizer/blob/main/AI_USE_POLICY.md"
              target="_blank"
              rel="noreferrer noopener"
              className="text-[var(--color-accent-blue)] hover:underline"
            >
              AI Use Policy
            </a>.
          </p>
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium border"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={!acked}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Check size={13} />
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}

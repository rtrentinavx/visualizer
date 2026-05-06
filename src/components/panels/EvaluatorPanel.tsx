import { useState } from 'react';
import { ShieldAlert, AlertTriangle, Info, X, ArrowRight, Wand2, Loader2, Check, XCircle } from 'lucide-react';
import type { Finding } from '../../lib/policyEvaluator';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat } from '../../lib/ai/client';
import { SYSTEM_PROMPT_AUTO_FIX, buildAutoFixPrompt } from '../../lib/ai/prompts';
import type { DcfPolicyModel } from '../../types/dcf';

interface EvaluatorPanelProps {
  topology: DcfPolicyModel;
  findings: Finding[];
  aiProfile?: AIProfile | null;
  onClose: () => void;
  onSelectPolicy: (policyId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onApplyFix: (finding: Finding, suggestion: string) => void;
}

const severityConfig = {
  error: { icon: ShieldAlert, color: '#ef4444', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Error' },
  warning: { icon: AlertTriangle, color: '#f59e0b', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Warning' },
  info: { icon: Info, color: '#3b82f6', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Info' },
};

export default function EvaluatorPanel({ topology, findings, aiProfile, onClose, onSelectPolicy, onSelectGroup, onApplyFix }: EvaluatorPanelProps) {
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const infos = findings.filter((f) => f.severity === 'info').length;

  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<Record<string, { text: string; loading: boolean }>>({});

  const handleAIFix = async (finding: Finding) => {
    if (!aiProfile) return;
    setFixingId(finding.id);
    setFixResult((prev) => ({ ...prev, [finding.id]: { text: '', loading: true } }));

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_AUTO_FIX };
    const userMsg: AIMessage = { role: 'user', content: buildAutoFixPrompt(topology, finding) };

    let text = '';
    try {
      for await (const chunk of streamChat(aiProfile, [systemMsg, userMsg])) {
        if (chunk.done) break;
        text += chunk.content;
        setFixResult((prev) => ({ ...prev, [finding.id]: { text, loading: true } }));
      }
      setFixResult((prev) => ({ ...prev, [finding.id]: { text, loading: false } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get AI fix';
      setFixResult((prev) => ({ ...prev, [finding.id]: { text: msg, loading: false } }));
    } finally {
      setFixingId(null);
    }
  };

  const dismissFix = (findingId: string) => {
    setFixResult((prev) => {
      const next = { ...prev };
      delete next[findingId];
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <ShieldAlert size={18} className="text-[var(--color-accent-amber)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Evaluator</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {findings.length === 0 ? 'All checks passed' : `${errors} errors · ${warnings} warnings · ${infos} info`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {findings.length === 0 ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-3">
                <ShieldAlert size={24} className="text-green-400" />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">No issues found</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Your policy model follows best practices.</p>
            </div>
          ) : (
            findings.map((finding) => {
              const config = severityConfig[finding.severity];
              const Icon = config.icon;
              const fix = fixResult[finding.id];
              const isFixing = fixingId === finding.id;

              return (
                <div
                  key={finding.id}
                  className={`flex gap-3 p-3 rounded-lg border ${config.bg} ${config.border}`}
                >
                  <Icon size={16} className="shrink-0 mt-0.5" style={{ color: config.color }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-sm font-medium text-[var(--color-text-primary)]">{finding.title}</span>
                    </div>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">{finding.description}</p>

                    {/* AI Fix result */}
                    {fix && (
                      <div className="mt-2 p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-purple)] mb-1">AI Suggestion</div>
                        <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap">{fix.text}</p>
                        <div className="flex gap-2 mt-2">
                          <button
                            onClick={() => { onApplyFix(finding, fix.text); dismissFix(finding.id); }}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-green-500/10 text-green-400 border border-green-500/30 hover:bg-green-500/20 transition-colors"
                          >
                            <Check size={10} /> Apply Fix
                          </button>
                          <button
                            onClick={() => dismissFix(finding.id)}
                            className="flex items-center gap-1 text-[10px] px-2 py-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                          >
                            <XCircle size={10} /> Discard
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Quick actions */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {finding.affectedPolicyIds?.map((id) => (
                        <button
                          key={id}
                          onClick={() => onSelectPolicy(id)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors"
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            borderColor: 'var(--color-border-subtle)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Policy <ArrowRight size={8} />
                        </button>
                      ))}
                      {finding.affectedGroupIds?.map((id) => (
                        <button
                          key={id}
                          onClick={() => onSelectGroup(id)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors"
                          style={{
                            backgroundColor: 'var(--color-surface)',
                            borderColor: 'var(--color-border-subtle)',
                            color: 'var(--color-text-muted)',
                          }}
                        >
                          Group <ArrowRight size={8} />
                        </button>
                      ))}
                      {aiProfile && !fix && (
                        <button
                          onClick={() => handleAIFix(finding)}
                          disabled={isFixing}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--color-accent-purple)/10',
                            borderColor: 'var(--color-accent-purple)/30',
                            color: 'var(--color-accent-purple)',
                          }}
                        >
                          {isFixing ? <Loader2 size={10} className="animate-spin" /> : <Wand2 size={10} />}
                          {isFixing ? 'Thinking...' : 'AI Fix'}
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

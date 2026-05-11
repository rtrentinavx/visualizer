import { useState } from 'react';
import { X, Route, Send, Loader2, ShieldCheck, ShieldX, AlertTriangle, Lightbulb } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { chatCompletion } from '../../lib/ai/client';
import { PROMPT_VERSIONS } from '../../lib/ai/prompts';
import { SYSTEM_PROMPT_REACHABILITY, buildReachabilityPrompt } from '../../lib/ai/promptsReachability';
import { ReachabilityIntentSchema, safeParseAIOutput, type ReachabilityIntent } from '../../lib/ai/schemas';
import { resolveIntent, checkReachability, type ReachabilityVerdict, type ResolvedReachabilityIntent } from '../../lib/reachability';

interface ReachabilityModalProps {
  topology: DcfPolicyModel;
  profile: AIProfile;
  onSelectPolicy: (policyId: string) => void;
  onClose: () => void;
}

type Status = 'idle' | 'asking' | 'done' | 'error';

interface RunResult {
  intent: ReachabilityIntent;
  resolved: ResolvedReachabilityIntent | null;
  resolutionError: string | null;
  verdict: ReachabilityVerdict | null;
}

const EXAMPLE_QUESTIONS = [
  'Can my Web Tier reach the App Tier on port 8443?',
  'Will my web servers reach Salesforce?',
  'Can the Internet reach my Database Tier?',
  'Does anything reach the App Tier over SSH?',
];

export default function ReachabilityModal({ topology, profile, onSelectPolicy, onClose }: ReachabilityModalProps) {
  const [question, setQuestion] = useState('');
  const [status, setStatus] = useState<Status>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<RunResult | null>(null);

  const handleAsk = async () => {
    if (!question.trim()) return;
    setStatus('asking');
    setErrorMsg(null);
    setResult(null);
    try {
      const messages: AIMessage[] = [
        { role: 'system', content: SYSTEM_PROMPT_REACHABILITY },
        { role: 'user', content: buildReachabilityPrompt(topology, question.trim()) },
      ];
      const { content } = await chatCompletion(profile, messages, PROMPT_VERSIONS.reachability);
      const parsed = safeParseAIOutput(ReachabilityIntentSchema, content);
      if (!parsed.success) {
        setErrorMsg(`AI response could not be parsed: ${parsed.error}`);
        setStatus('error');
        return;
      }
      const intent = parsed.data;
      if (!intent.canAnswer) {
        setResult({
          intent,
          resolved: null,
          resolutionError: intent.clarification ?? 'The AI couldn\'t map your question to a reachability check.',
          verdict: null,
        });
        setStatus('done');
        return;
      }
      const resolvedOrError = resolveIntent(topology, intent);
      if ('reason' in resolvedOrError) {
        setResult({
          intent,
          resolved: null,
          resolutionError: `${resolvedOrError.reason} (${resolvedOrError.unresolvedNames.join(', ')})`,
          verdict: null,
        });
        setStatus('done');
        return;
      }
      const verdict = checkReachability(topology, resolvedOrError);
      setResult({ intent, resolved: resolvedOrError, resolutionError: null, verdict });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Reachability check failed');
      setStatus('error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleAsk();
    }
  };

  const verdictColor = result?.verdict
    ? result.verdict.outcome === 'allow' ? '#22c55e'
    : result.verdict.outcome === 'learned' ? '#3b82f6'
    : '#ef4444'
    : '#6b7280';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Route size={18} className="text-[var(--color-accent-purple)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">AI Reachability</h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                Ask in plain English. The AI extracts what you mean; the engine evaluates against your policies.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Question</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Will my web tier reach Salesforce?"
              rows={2}
              className="w-full px-2 py-1.5 rounded text-xs border outline-none resize-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
            <div className="mt-1 flex flex-wrap gap-1">
              {EXAMPLE_QUESTIONS.map((q) => (
                <button
                  key={q}
                  onClick={() => setQuestion(q)}
                  className="text-[9px] px-1.5 py-0.5 rounded border text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:border-[var(--color-accent-blue)]"
                  style={{ borderColor: 'var(--color-border-subtle)' }}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>

          {status === 'error' && errorMsg && (
            <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-red-500/10 border-red-500/30">
              <AlertTriangle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-400">{errorMsg}</p>
            </div>
          )}

          {result && (
            <>
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">AI interpretation</h4>
                <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 space-y-1 text-xs">
                  {result.resolved ? (
                    <>
                      <div className="grid grid-cols-[80px_1fr] gap-x-2 gap-y-0.5 font-mono text-[10px]">
                        <span className="text-[var(--color-text-muted)]">Source</span>
                        <span className="text-[var(--color-text-primary)]">{result.resolved.srcGroup.name}</span>
                        <span className="text-[var(--color-text-muted)]">Destination</span>
                        <span className="text-[var(--color-text-primary)]">
                          {result.resolved.dstWebGroup ? `${result.resolved.dstWebGroup.name} (WebGroup)` : result.resolved.dstGroup?.name ?? 'Internet'}
                        </span>
                        <span className="text-[var(--color-text-muted)]">Protocol</span>
                        <span className="text-[var(--color-text-primary)]">{result.resolved.protocol}{result.resolved.port !== undefined ? ` / ${result.resolved.port}` : ''}</span>
                      </div>
                      {result.intent.assumptions && result.intent.assumptions.length > 0 && (
                        <div className="pt-1 border-t border-[var(--color-border-subtle)]">
                          <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] mb-0.5">
                            <Lightbulb size={10} /> Assumptions
                          </div>
                          <ul className="space-y-0.5 text-[10px] text-[var(--color-text-muted)] pl-3">
                            {result.intent.assumptions.map((a, i) => (
                              <li key={i}>· {a}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-amber-400 flex items-start gap-1.5">
                      <AlertTriangle size={12} className="shrink-0 mt-0.5" />
                      <span>{result.resolutionError}</span>
                    </p>
                  )}
                </div>
              </div>

              {result.verdict && (
                <div className="rounded-lg border overflow-hidden" style={{ borderColor: verdictColor + '40' }}>
                  <div className="flex items-center gap-2 px-3 py-2" style={{ backgroundColor: verdictColor + '15' }}>
                    {result.verdict.outcome === 'allow' ? (
                      <ShieldCheck size={16} style={{ color: verdictColor }} />
                    ) : (
                      <ShieldX size={16} style={{ color: verdictColor }} />
                    )}
                    <span className="text-sm font-semibold uppercase tracking-wider" style={{ color: verdictColor }}>
                      {result.verdict.outcome === 'allow' ? 'Reachable' : result.verdict.outcome === 'implicit-deny' ? 'Implicitly Denied' : 'Blocked'}
                    </span>
                  </div>
                  <div className="px-3 py-2 space-y-2 bg-[var(--color-surface)]">
                    <p className="text-xs text-[var(--color-text-secondary)]">{result.verdict.explanation}</p>
                    {result.verdict.matchedPolicy && (
                      <button
                        onClick={() => onSelectPolicy(result.verdict!.matchedPolicy!.id)}
                        className="inline-flex items-center gap-1.5 text-[10px] text-[var(--color-accent-blue)] hover:underline"
                      >
                        Open "{result.verdict.matchedPolicy.name}" in the inspector →
                      </button>
                    )}
                    {result.verdict.consideredPolicies.length > 1 && (
                      <details className="text-[10px]">
                        <summary className="cursor-pointer text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                          {result.verdict.consideredPolicies.length - 1} other matching polic{result.verdict.consideredPolicies.length - 1 === 1 ? 'y' : 'ies'} (shadowed)
                        </summary>
                        <ul className="mt-1 pl-3 space-y-0.5 font-mono">
                          {result.verdict.consideredPolicies.slice(1).map((p) => (
                            <li key={p.id}>· #{p.priority} {p.action.toUpperCase()} {p.name}</li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
          <span className="text-[10px] text-[var(--color-text-muted)]">Cmd/Ctrl+Enter to submit · Model: {profile.model}</span>
          <button
            onClick={handleAsk}
            disabled={status === 'asking' || !question.trim()}
            className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            {status === 'asking' ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
            {status === 'asking' ? 'Asking…' : 'Ask'}
          </button>
        </div>
      </div>
    </div>
  );
}

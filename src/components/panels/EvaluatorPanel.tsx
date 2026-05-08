import { useState, useMemo } from 'react';
import { ShieldAlert, AlertTriangle, Info, X, ArrowRight, Wand2, Loader2, Wrench, Check, XCircle, Trophy } from 'lucide-react';
import type { Finding, EvaluationReport, FindingCategory, Framework } from '../../lib/policyEvaluator';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat } from '../../lib/ai/client';
import { SYSTEM_PROMPT_AUTO_FIX, buildAutoFixPrompt, PROMPT_VERSIONS } from '../../lib/ai/prompts';
import type { DcfPolicyModel } from '../../types/dcf';
import { EvaluatorFixSchema, safeParseAIOutput } from '../../lib/ai/schemas';

interface EvaluatorPanelProps {
  topology: DcfPolicyModel;
  report: EvaluationReport;
  aiProfile?: AIProfile | null;
  onClose: () => void;
  onSelectPolicy: (policyId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onApplyFix: (finding: Finding, suggestion?: string) => void;
}

const severityConfig = {
  error: { icon: ShieldAlert, color: '#ef4444', bg: 'bg-red-500/10', border: 'border-red-500/30', label: 'Error' },
  warning: { icon: AlertTriangle, color: '#f59e0b', bg: 'bg-amber-500/10', border: 'border-amber-500/30', label: 'Warning' },
  info: { icon: Info, color: '#3b82f6', bg: 'bg-blue-500/10', border: 'border-blue-500/30', label: 'Info' },
};

const categoryLabel: Record<FindingCategory, string> = {
  security: 'Security',
  naming: 'Naming',
  performance: 'Performance',
  compliance: 'Compliance',
  hygiene: 'Hygiene',
};

const frameworkColors: Record<Framework, string> = {
  'Aviatrix BP': '#10b981',
  'CIS': '#f59e0b',
  'NIST ZT': '#3b82f6',
  'Best Practice': '#8b5cf6',
};

function getScoreColor(score: number): string {
  if (score >= 90) return '#22c55e';
  if (score >= 70) return '#f59e0b';
  if (score >= 50) return '#f97316';
  return '#ef4444';
}

function getScoreGrade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export default function EvaluatorPanel({ topology, report, aiProfile, onClose, onSelectPolicy, onSelectGroup, onApplyFix }: EvaluatorPanelProps) {
  const { findings, score, summary, categories } = report;
  const [activeCategory, setActiveCategory] = useState<FindingCategory | 'all'>('all');

  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<Record<string, { text: string; loading: boolean }>>({});

  const filteredFindings = useMemo(() => {
    if (activeCategory === 'all') return findings;
    return findings.filter((f) => f.category === activeCategory);
  }, [findings, activeCategory]);

  const handleAIFix = async (finding: Finding) => {
    if (!aiProfile) return;
    setFixingId(finding.id);
    setFixResult((prev) => ({ ...prev, [finding.id]: { text: '', loading: true } }));

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_AUTO_FIX };
    const userMsg: AIMessage = { role: 'user', content: buildAutoFixPrompt(topology, finding) };

    let text = '';
    try {
      for await (const chunk of streamChat(aiProfile, [systemMsg, userMsg], PROMPT_VERSIONS.autoFix)) {
        if (chunk.done) break;
        text += chunk.content;
        setFixResult((prev) => ({ ...prev, [finding.id]: { text, loading: true } }));
      }
      const validated = safeParseAIOutput(EvaluatorFixSchema, text);
      if (!validated.success) {
        setFixResult((prev) => ({ ...prev, [finding.id]: { text: `AI response format invalid: ${validated.error}`, loading: false } }));
      } else {
        setFixResult((prev) => ({ ...prev, [finding.id]: { text, loading: false } }));
      }
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

  const scoreColor = getScoreColor(score);
  const scoreGrade = getScoreGrade(score);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <ShieldAlert size={18} className="text-[var(--color-accent-amber)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Evaluator</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {summary.total === 0 ? 'All checks passed' : `${summary.errors} errors · ${summary.warnings} warnings · ${summary.infos} info · ${summary.fixable} fixable`}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Score Dashboard */}
        {summary.total > 0 && (
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center gap-4 p-3 rounded-lg border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}>
              <div className="relative flex items-center justify-center w-14 h-14 shrink-0">
                <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke="var(--color-border-subtle)"
                    strokeWidth="3"
                  />
                  <path
                    d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
                    fill="none"
                    stroke={scoreColor}
                    strokeWidth="3"
                    strokeDasharray={`${score}, 100`}
                    strokeLinecap="round"
                  />
                </svg>
                <span className="absolute text-sm font-bold" style={{ color: scoreColor }}>{score}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold text-[var(--color-text-primary)]">Compliance Score</span>
                  <span
                    className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: scoreColor + '20', color: scoreColor }}
                  >
                    {scoreGrade}
                  </span>
                </div>
                <div className="flex flex-wrap gap-2 mt-1.5">
                  {(['security', 'naming', 'performance', 'compliance', 'hygiene'] as FindingCategory[]).map((cat) => (
                    <button
                      key={cat}
                      onClick={() => setActiveCategory(activeCategory === cat ? 'all' : cat)}
                      className="text-[10px] px-2 py-0.5 rounded-full border transition-colors"
                      style={{
                        backgroundColor: activeCategory === cat ? 'var(--color-accent-blue)' : 'var(--color-surface-elevated)',
                        color: activeCategory === cat ? '#fff' : 'var(--color-text-muted)',
                        borderColor: 'var(--color-border-subtle)',
                      }}
                    >
                      {categoryLabel[cat]} ({categories[cat]})
                    </button>
                  ))}
                  {activeCategory !== 'all' && (
                    <button
                      onClick={() => setActiveCategory('all')}
                      className="text-[10px] px-2 py-0.5 rounded-full border text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
                      style={{ borderColor: 'var(--color-border-subtle)' }}
                    >
                      Show all
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {summary.total === 0 ? (
            <div className="text-center py-8">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-green-500/10 mb-3">
                <Trophy size={24} className="text-green-400" />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">No issues found</p>
              <p className="text-xs text-[var(--color-text-muted)] mt-1">Your policy model follows best practices across Aviatrix, CIS, and NIST Zero Trust frameworks.</p>
            </div>
          ) : filteredFindings.length === 0 ? (
            <div className="text-center py-8 text-xs text-[var(--color-text-muted)]">
              No findings in this category. Select another filter.
            </div>
          ) : (
            filteredFindings.map((finding) => {
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold uppercase tracking-wider" style={{ color: config.color }}>
                        {config.label}
                      </span>
                      <span className="text-xs font-medium px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}>
                        {categoryLabel[finding.category]}
                      </span>
                      {finding.frameworks.map((fw) => (
                        <span
                          key={fw}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider"
                          style={{ backgroundColor: frameworkColors[fw] + '15', color: frameworkColors[fw] }}
                        >
                          {fw}
                        </span>
                      ))}
                    </div>
                    <span className="text-sm font-medium text-[var(--color-text-primary)] block mt-1">{finding.title}</span>
                    <p className="text-xs text-[var(--color-text-secondary)] mt-1">{finding.description}</p>
                    {finding.fixable && finding.fixDescription && (
                      <p className="text-[10px] text-[var(--color-accent-blue)] mt-1 font-medium">
                        Suggested fix: {finding.fixDescription}
                      </p>
                    )}

                    {/* AI Fix result */}
                    {fix && (
                      <div className="mt-2 p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-purple)] mb-1">AI Suggestion</div>
                        <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap">{fix.text}</p>
                        <p className="text-[9px] text-[var(--color-text-muted)] mt-1.5">
                          AI-generated fix · Review before applying · [INFERRED] values are not confirmed by your topology.
                        </p>
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
                      {finding.fixable && !fix && (
                        <button
                          onClick={() => onApplyFix(finding)}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors"
                          style={{
                            backgroundColor: 'var(--color-accent-blue)/10',
                            borderColor: 'var(--color-accent-blue)/30',
                            color: 'var(--color-accent-blue)',
                          }}
                        >
                          <Wrench size={10} />
                          Fix it for me
                        </button>
                      )}
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

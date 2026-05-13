import { useState, useMemo } from 'react';
import { ShieldAlert, AlertTriangle, Info, X, ArrowRight, Wand2, Loader2, Wrench, Check, XCircle, Trophy, Scissors } from 'lucide-react';
import type { Finding, EvaluationReport, FindingCategory, Framework } from '../../lib/policyEvaluator';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat } from '../../lib/ai/client';
import { SYSTEM_PROMPT_AUTO_FIX, buildAutoFixPrompt, PROMPT_VERSIONS, SYSTEM_PROMPT_SPLIT_WEBGROUP, buildSplitWebGroupPrompt } from '../../lib/ai/prompts';
import type { DcfPolicyModel } from '../../types/dcf';
import { EvaluatorFixSchema, WebGroupSplitSuggestionSchema, safeParseAIOutput, type WebGroupSplitSuggestion } from '../../lib/ai/schemas';

interface EvaluatorPanelProps {
  topology: DcfPolicyModel;
  report: EvaluationReport;
  aiProfile?: AIProfile | null;
  onClose: () => void;
  onSelectPolicy: (policyId: string) => void;
  onSelectGroup: (groupId: string) => void;
  onApplyFix: (finding: Finding, suggestion?: string) => void;
  /** Iterate through every fixable finding and apply each auto-fix in one shot. */
  onFixAll: () => void;
  /** Materialize an AI-suggested WebGroup split. Called from the wide-webgroup AI suggestion flow. */
  onApplySplit: (webGroupId: string, splits: WebGroupSplitSuggestion['proposedSplits']) => void;
}

interface SplitState {
  loading: boolean;
  error?: string;
  /** Parsed AI suggestion once streaming completes successfully. */
  suggestion?: WebGroupSplitSuggestion;
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

export default function EvaluatorPanel({ topology, report, aiProfile, onClose, onSelectPolicy, onSelectGroup, onApplyFix, onFixAll, onApplySplit }: EvaluatorPanelProps) {
  const { findings, score, summary, categories } = report;
  const [activeCategory, setActiveCategory] = useState<FindingCategory | 'all'>('all');

  const [fixingId, setFixingId] = useState<string | null>(null);
  const [fixResult, setFixResult] = useState<Record<string, { text: string; loading: boolean }>>({});

  /** Per-finding state for the wide-webgroup AI split suggestion flow. */
  const [splitState, setSplitState] = useState<Record<string, SplitState>>({});

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

  /**
   * Stream an AI suggestion for splitting a wide WebGroup. Extracts the
   * affected group id from the finding's affectedGroupIds[0], grabs the
   * group's fqdns + referencing policies, calls the LLM, validates the
   * response against WebGroupSplitSuggestionSchema. The "Apply" button on
   * the rendered suggestion routes back to App.tsx via onApplySplit.
   */
  const handleSuggestSplit = async (finding: Finding) => {
    if (!aiProfile) return;
    const groupId = finding.affectedGroupIds?.[0];
    if (!groupId) return;
    const wg = topology.webGroups.find((g) => g.id === groupId);
    if (!wg) return;

    setSplitState((prev) => ({ ...prev, [finding.id]: { loading: true } }));

    const referencingPolicyNames = topology.policies
      .filter((p) => p.webGroupIds?.includes(groupId))
      .map((p) => p.name);

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_SPLIT_WEBGROUP };
    const userMsg: AIMessage = {
      role: 'user',
      content: buildSplitWebGroupPrompt({ webGroupName: wg.name, fqdns: wg.fqdns, referencingPolicyNames }),
    };

    let text = '';
    try {
      for await (const chunk of streamChat(aiProfile, [systemMsg, userMsg], PROMPT_VERSIONS.splitWebGroup)) {
        if (chunk.done) break;
        text += chunk.content;
      }
      const validated = safeParseAIOutput(WebGroupSplitSuggestionSchema, text);
      if (!validated.success) {
        setSplitState((prev) => ({ ...prev, [finding.id]: { loading: false, error: `AI response invalid: ${validated.error}` } }));
        return;
      }
      setSplitState((prev) => ({ ...prev, [finding.id]: { loading: false, suggestion: validated.data } }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to get AI suggestion';
      setSplitState((prev) => ({ ...prev, [finding.id]: { loading: false, error: msg } }));
    }
  };

  const dismissSplit = (findingId: string) => {
    setSplitState((prev) => {
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
          <div className="flex items-center gap-3 min-w-0">
            <ShieldAlert size={18} className="text-[var(--color-accent-amber)] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Evaluator</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5 truncate">
                {summary.total === 0 ? 'All checks passed' : `${summary.errors} errors · ${summary.warnings} warnings · ${summary.infos} info · ${summary.fixable} fixable`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Fix all button: visible whenever the evaluator has run (i.e. there's
                anything to evaluate). When fixable === 0 it stays in the header as a
                disabled "all clear" indicator rather than disappearing, so users get
                visual confirmation that auto-fixes were applied and the remainder
                needs manual / AI review. */}
            {summary.total > 0 && (
              <button
                onClick={onFixAll}
                disabled={summary.fixable === 0}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors disabled:cursor-default"
                style={summary.fixable > 0
                  ? { backgroundColor: 'var(--color-accent-purple)', color: '#fff' }
                  : { backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}
                title={summary.fixable > 0
                  ? `Apply every auto-fix in one shot (${summary.fixable} fix${summary.fixable === 1 ? '' : 'es'}). Each finding's individual fix still works.`
                  : `All auto-fixable findings have been applied. Remaining findings need manual review or per-finding AI Fix — "Overly Permissive Policy" needs you to choose the right SmartGroups, "Unused Group" needs you to decide whether to remove or attach, etc.`}
              >
                <Wand2 size={13} />
                {summary.fixable > 0 ? `Fix all (${summary.fixable})` : 'All auto-fixes applied'}
              </button>
            )}
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
              <X size={16} />
            </button>
          </div>
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
                  className={`grid grid-cols-[auto_1fr] gap-3 p-3 rounded-lg border ${config.bg} ${config.border}`}
                >
                  {/* Icon column — top-aligned, fixed width for consistency */}
                  <div className="shrink-0 w-4 flex justify-center pt-0.5">
                    <Icon size={16} style={{ color: config.color }} />
                  </div>

                  {/* Content column */}
                  <div className="flex flex-col gap-1.5 min-w-0">
                    {/* Row 1: severity + category + frameworks */}
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="text-[10px] font-bold uppercase tracking-wider leading-none px-1 py-0.5 rounded" style={{ color: config.color, backgroundColor: config.color + '12' }}>
                        {config.label}
                      </span>
                      <span className="text-[10px] font-medium px-1.5 py-0.5 rounded leading-none" style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}>
                        {categoryLabel[finding.category]}
                      </span>
                      {finding.frameworks.map((fw) => (
                        <span
                          key={fw}
                          className="text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wider leading-none"
                          style={{ backgroundColor: frameworkColors[fw] + '15', color: frameworkColors[fw] }}
                        >
                          {fw}
                        </span>
                      ))}
                    </div>

                    {/* Row 2: title */}
                    <span className="text-sm font-medium text-[var(--color-text-primary)] leading-snug">{finding.title}</span>

                    {/* Row 3: description */}
                    <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{finding.description}</p>

                    {/* Row 4: fix hint */}
                    {finding.fixable && finding.fixDescription && (
                      <p className="text-[10px] text-[var(--color-accent-blue)] font-medium leading-relaxed">
                        Suggested fix: {finding.fixDescription}
                      </p>
                    )}

                    {/* Row 5: AI Fix result */}
                    {fix && (
                      <div className="p-2.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-accent-purple)] mb-1">AI Suggestion</div>
                        <p className="text-xs text-[var(--color-text-secondary)] whitespace-pre-wrap leading-relaxed">{fix.text}</p>
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

                    {/* Row 6: action buttons */}
                    <div className="flex flex-wrap gap-2 pt-0.5">
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
                      {aiProfile && !fix && !finding.id.startsWith('wide-webgroup-') && (
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
                      {aiProfile && finding.id.startsWith('wide-webgroup-') && !splitState[finding.id]?.suggestion && (
                        <button
                          onClick={() => handleSuggestSplit(finding)}
                          disabled={splitState[finding.id]?.loading === true}
                          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded border transition-colors disabled:opacity-50"
                          style={{
                            backgroundColor: 'var(--color-accent-purple)/10',
                            borderColor: 'var(--color-accent-purple)/30',
                            color: 'var(--color-accent-purple)',
                          }}
                        >
                          {splitState[finding.id]?.loading ? <Loader2 size={10} className="animate-spin" /> : <Scissors size={10} />}
                          {splitState[finding.id]?.loading ? 'Analyzing…' : 'AI Suggest split'}
                        </button>
                      )}
                    </div>

                    {/* Split-suggestion result card (only for wide-webgroup findings) */}
                    {finding.id.startsWith('wide-webgroup-') && splitState[finding.id] && (
                      <SplitSuggestionCard
                        state={splitState[finding.id]!}
                        onApply={(splits) => {
                          const groupId = finding.affectedGroupIds?.[0];
                          if (!groupId) return;
                          onApplySplit(groupId, splits);
                          dismissSplit(finding.id);
                        }}
                        onDismiss={() => dismissSplit(finding.id)}
                      />
                    )}
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

/**
 * Inline preview of the AI's WebGroup split suggestion. Three states:
 * - loading: spinner (the parent's button already shows this; we just don't
 *   render the card until either suggestion or error lands)
 * - error: red banner with the error message + Dismiss
 * - suggestion: list of proposed subgroups with their FQDN counts + an Apply
 *   button. shouldSplit=false from the AI surfaces as an "AI says keep as-is"
 *   message rather than a misleading "no splits" state.
 */
function SplitSuggestionCard({
  state,
  onApply,
  onDismiss,
}: {
  state: SplitState;
  onApply: (splits: WebGroupSplitSuggestion['proposedSplits']) => void;
  onDismiss: () => void;
}) {
  if (state.loading) return null;

  if (state.error) {
    return (
      <div className="mt-2 p-3 rounded border bg-red-500/10 border-red-500/30 text-[11px] text-red-300 flex items-start gap-2">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <div className="flex-1">{state.error}</div>
        <button onClick={onDismiss} aria-label="Dismiss" className="p-0.5 hover:text-red-200">
          <X size={11} />
        </button>
      </div>
    );
  }

  const s = state.suggestion;
  if (!s) return null;

  if (!s.shouldSplit || !s.proposedSplits || s.proposedSplits.length === 0) {
    return (
      <div className="mt-2 p-3 rounded border bg-[var(--color-surface-elevated)] border-[var(--color-border-subtle)] text-[11px] text-[var(--color-text-secondary)] flex items-start gap-2">
        <Check size={12} className="shrink-0 mt-0.5 text-emerald-500" />
        <div className="flex-1">
          <strong>AI says keep as-is.</strong> {s.reason}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="p-0.5 hover:text-[var(--color-text-primary)]">
          <X size={11} />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2 p-3 rounded border bg-[var(--color-accent-purple)]/5 border-[var(--color-accent-purple)]/30 space-y-2">
      <div className="flex items-start gap-2">
        <Scissors size={12} className="shrink-0 mt-0.5 text-[var(--color-accent-purple)]" />
        <div className="flex-1 text-[11px] text-[var(--color-text-secondary)]">
          <strong>Proposed split into {s.proposedSplits.length} subgroups.</strong> {s.reason}
        </div>
        <button onClick={onDismiss} aria-label="Dismiss" className="p-0.5 hover:text-[var(--color-text-primary)]">
          <X size={11} />
        </button>
      </div>
      <ul className="space-y-1 pl-4">
        {s.proposedSplits.map((sp, i) => (
          <li key={i} className="text-[11px] text-[var(--color-text-secondary)] flex items-center gap-2">
            <span className="font-medium text-[var(--color-text-primary)]">{sp.name}</span>
            <span className="text-[var(--color-text-muted)]">— {sp.fqdns.length} FQDN{sp.fqdns.length === 1 ? '' : 's'}</span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2 pt-1">
        <button
          onClick={() => onApply(s.proposedSplits)}
          className="flex items-center gap-1 text-[10px] px-2.5 py-1 rounded font-medium text-white"
          style={{ backgroundColor: 'var(--color-accent-purple)' }}
        >
          <Check size={11} />
          Apply split
        </button>
      </div>
      <p className="text-[10px] text-[var(--color-text-muted)] pl-1">
        Apply creates the new WebGroups and re-points every policy that referenced the original to attach all new subgroups (same allow/deny behavior preserved). You can then tweak per-subgroup actions afterwards.
      </p>
    </div>
  );
}

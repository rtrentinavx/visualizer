import { useState } from 'react';
import { X, Search, Send, Loader2, AlertTriangle, Lightbulb, ShieldCheck, ShieldX, FileText } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel } from '../../types/dcf';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { chatCompletion } from '../../lib/ai/client';
import { PROMPT_VERSIONS } from '../../lib/ai/prompts';
import { SYSTEM_PROMPT_POLICY_SEARCH, buildPolicySearchPrompt } from '../../lib/ai/promptsSearch';
import { PolicySearchFilterSchema, safeParseAIOutput, type PolicySearchFilter } from '../../lib/ai/schemas';
import { resolveSearchFilter, searchPolicies, type ResolvedPolicySearchFilter } from '../../lib/policySearch';

interface PolicySearchModalProps {
  topology: DcfPolicyModel;
  profile: AIProfile;
  onSelectPolicy: (policyId: string) => void;
  onClose: () => void;
}

type Status = 'idle' | 'asking' | 'done' | 'error';

interface RunResult {
  intent: PolicySearchFilter;
  resolved: ResolvedPolicySearchFilter | null;
  matches: DcfPolicy[];
}

const EXAMPLE_QUESTIONS = [
  'Show me all policies that allow Web Tier to Database Tier',
  'Which deny policies are missing logging?',
  'List all policies that decrypt HTTPS',
  'Find policies with a ThreatGroup attached',
];

function nameOf(topology: DcfPolicyModel, id: string): string {
  return topology.smartGroups.find((g) => g.id === id)?.name ?? id;
}

function PolicyRow({ policy, topology, onClick }: { policy: DcfPolicy; topology: DcfPolicyModel; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left px-2 py-1.5 rounded border hover:bg-[var(--color-surface-elevated)] transition-colors flex items-center gap-2"
      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
    >
      <span className="text-[10px] font-mono text-[var(--color-text-muted)] w-12 shrink-0">#{policy.priority}</span>
      <span className="shrink-0">
        {policy.action === 'allow' ? <ShieldCheck size={12} className="text-green-400" /> : <ShieldX size={12} className="text-red-400" />}
      </span>
      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">{policy.name}</div>
        <div className="text-[10px] text-[var(--color-text-muted)] truncate">
          {nameOf(topology, policy.srcGroupId)} → {nameOf(topology, policy.dstGroupId)} · {policy.protocol}/{policy.ports || 'any'}
          {policy.threatGroup ? ' · threat' : ''}{policy.geoGroup ? ' · geo' : ''}{policy.webGroupIds?.length ? ' · webgroup' : ''}{policy.decrypt ? ' · decrypt' : ''}
        </div>
      </div>
    </button>
  );
}

export default function PolicySearchModal({ topology, profile, onSelectPolicy, onClose }: PolicySearchModalProps) {
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
        { role: 'system', content: SYSTEM_PROMPT_POLICY_SEARCH },
        { role: 'user', content: buildPolicySearchPrompt(topology, question.trim()) },
      ];
      const { content } = await chatCompletion(profile, messages, PROMPT_VERSIONS.policySearch);
      const parsed = safeParseAIOutput(PolicySearchFilterSchema, content);
      if (!parsed.success) {
        setErrorMsg(`AI response could not be parsed: ${parsed.error}`);
        setStatus('error');
        return;
      }
      const intent = parsed.data;
      if (!intent.canAnswer) {
        setResult({ intent, resolved: null, matches: [] });
        setStatus('done');
        return;
      }
      const resolved = resolveSearchFilter(topology, intent);
      const matches = searchPolicies(topology, resolved).sort((a, b) => a.priority - b.priority);
      setResult({ intent, resolved, matches });
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Search failed');
      setStatus('error');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleAsk();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-2xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Search size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Search</h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                Natural-language filter. AI extracts criteria; the engine applies them.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          <div>
            <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Search</label>
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Show me all policies that allow web tier to database"
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
              {result.intent.canAnswer && result.resolved ? (
                <>
                  <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-3 text-xs space-y-1">
                    <div className="flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider font-bold">
                      <Lightbulb size={10} /> Filter applied
                    </div>
                    <ul className="text-[10px] text-[var(--color-text-secondary)] space-y-0.5">
                      {result.resolved.srcGroupId && <li>· source = {nameOf(topology, result.resolved.srcGroupId)}</li>}
                      {result.resolved.dstGroupId && <li>· destination = {nameOf(topology, result.resolved.dstGroupId)}</li>}
                      {result.resolved.dstWebGroupId && <li>· destination WebGroup = {topology.webGroups.find((g) => g.id === result.resolved!.dstWebGroupId)?.name}</li>}
                      {result.resolved.actions && <li>· action ∈ [{result.resolved.actions.join(', ')}]</li>}
                      {result.resolved.protocols && <li>· protocol ∈ [{result.resolved.protocols.join(', ')}]</li>}
                      {result.resolved.containsPort && <li>· port contains {result.resolved.containsPort}</li>}
                      {result.resolved.hasThreatGroup !== undefined && <li>· hasThreatGroup = {String(result.resolved.hasThreatGroup)}</li>}
                      {result.resolved.hasGeoGroup !== undefined && <li>· hasGeoGroup = {String(result.resolved.hasGeoGroup)}</li>}
                      {result.resolved.hasWebGroup !== undefined && <li>· hasWebGroup = {String(result.resolved.hasWebGroup)}</li>}
                      {result.resolved.decryptOnly && <li>· decrypt = true</li>}
                      {result.resolved.loggingDisabled && <li>· logging = false</li>}
                    </ul>
                    {result.resolved.unresolvedNames.length > 0 && (
                      <div className="pt-1 border-t border-[var(--color-border-subtle)] text-[10px] text-amber-400">
                        Unresolved names ignored: {result.resolved.unresolvedNames.join(', ')}
                      </div>
                    )}
                    {result.intent.assumptions && result.intent.assumptions.length > 0 && (
                      <div className="pt-1 border-t border-[var(--color-border-subtle)]">
                        <div className="text-[10px] text-[var(--color-text-muted)] mb-0.5">Assumptions</div>
                        <ul className="text-[10px] text-[var(--color-text-muted)] space-y-0.5 pl-3">
                          {result.intent.assumptions.map((a, i) => <li key={i}>· {a}</li>)}
                        </ul>
                      </div>
                    )}
                  </div>

                  <div>
                    <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1 flex items-center gap-1">
                      <FileText size={11} /> {result.matches.length} match{result.matches.length === 1 ? '' : 'es'}
                    </h4>
                    {result.matches.length === 0 ? (
                      <p className="text-xs text-[var(--color-text-muted)]">No policies match this filter.</p>
                    ) : (
                      <div className="space-y-1">
                        {result.matches.map((p) => (
                          <PolicyRow
                            key={p.id}
                            policy={p}
                            topology={topology}
                            onClick={() => onSelectPolicy(p.id)}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-start gap-2 p-2.5 rounded-lg border bg-amber-500/10 border-amber-500/30">
                  <AlertTriangle size={14} className="text-amber-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-400">{result.intent.clarification ?? 'The AI couldn\'t turn your question into a filter.'}</p>
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
            {status === 'asking' ? 'Searching…' : 'Search'}
          </button>
        </div>
      </div>
    </div>
  );
}

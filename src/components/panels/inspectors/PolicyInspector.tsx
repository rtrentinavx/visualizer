import { useMemo, useState } from 'react';
import { ArrowLeft, ChevronDown, ChevronUp, Loader2, Sparkles, Trophy, Wand2, Activity, ArrowRight, ShieldCheck, ShieldX, X, Plus } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel } from '../../../types/dcf';
import type { AIProfile, AIMessage } from '../../../lib/ai/types';
import { streamChat } from '../../../lib/ai/client';
import { SYSTEM_PROMPT_EXPLAIN, buildExplainPrompt } from '../../../lib/ai/prompts';
import { scorePolicy, type PolicyScore } from '../../../lib/policyScorer';
import { compareImpact, withPolicyChange, type FlowImpact, type FlowOutcome } from '../../../lib/policyImpact';
import { Input, Select, Toggle, MultiSelect, InspectorFooter } from './_shared';

interface ExplanationResult {
  summary: string;
  securityImplications?: string;
  recommendations?: string[];
}

function parseExplanation(raw: string): ExplanationResult | null {
  try {
    const match = raw.match(/```json\s*([\s\S]*?)```/);
    if (match?.[1]) return JSON.parse(match[1]) as ExplanationResult;
  } catch { /* noop */ }
  return null;
}

/** Normalize srcGroupId / dstGroupId to string[] regardless of legacy shape */
function toStringArray(v: unknown, fallback = 'sg-any'): string[] {
  if (Array.isArray(v)) return v.length > 0 ? (v as string[]) : [fallback];
  if (typeof v === 'string' && v.length > 0) return [v];
  return [fallback];
}

interface PolicyInspectorProps {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null;
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

function PolicyScoreCard({ score }: { score: PolicyScore }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: score.color + '40' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2"
        style={{ backgroundColor: score.color + '10' }}
      >
        <div className="flex items-center gap-2">
          <Trophy size={14} style={{ color: score.color }} />
          <span className="text-xs font-semibold" style={{ color: score.color }}>
            Score: {score.total}/100
          </span>
          <span
            className="text-[10px] font-bold px-1.5 py-0.5 rounded"
            style={{ backgroundColor: score.color + '20', color: score.color }}
          >
            {score.grade}
          </span>
        </div>
        {open ? <ChevronUp size={14} style={{ color: score.color }} /> : <ChevronDown size={14} style={{ color: score.color }} />}
      </button>
      {open && (
        <div className="px-3 py-2 space-y-2 bg-[var(--color-surface)]">
          <div className="grid grid-cols-5 gap-1 text-center">
            {[
              { label: 'Name', val: score.naming },
              { label: 'Spec', val: score.specificity },
              { label: 'Sec', val: score.security },
              { label: 'Pri', val: score.priority },
              { label: 'Log', val: score.logging },
            ].map((s) => (
              <div key={s.label} className="space-y-0.5">
                <div className="text-[9px] text-[var(--color-text-muted)]">{s.label}</div>
                <div className="text-[10px] font-semibold" style={{ color: s.val >= 10 ? '#22c55e' : s.val >= 5 ? '#eab308' : '#ef4444' }}>{s.val}</div>
              </div>
            ))}
          </div>
          {score.tips.length > 0 && (
            <div className="space-y-1">
              {score.tips.map((tip, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                  <span className="text-amber-400 shrink-0">•</span>
                  {tip}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActionPill({ action }: { action: FlowOutcome }) {
  if (action === 'allow') return <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-green-500/15 text-green-400"><ShieldCheck size={9} />allow</span>;
  if (action === 'learned') return <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/15 text-blue-400">learned</span>;
  return <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-red-500/15 text-red-400"><ShieldX size={9} />{action === 'implicit-deny' ? 'implicit deny' : 'deny'}</span>;
}

function PolicyImpactCard({ topology, draft, isNew }: { topology: DcfPolicyModel; draft: DcfPolicy; isNew: boolean }) {
  const [open, setOpen] = useState(false);

  const { changed, totalFlows } = useMemo(() => {
    const flows = topology.flows;
    if (flows.length === 0) return { changed: [] as FlowImpact[], totalFlows: 0 };
    const after = withPolicyChange(topology, draft, 'upsert');
    const impact = compareImpact(topology, after, flows);
    const changedOnly = impact.filter((x) => x.outcomeChanged || x.matchChanged);
    return { changed: changedOnly, totalFlows: flows.length };
  }, [topology, draft]);

  if (totalFlows === 0) {
    return (
      <div className="mb-3 rounded-lg border border-[var(--color-border-subtle)] px-3 py-2 text-[10px] text-[var(--color-text-muted)] flex items-center gap-2">
        <Activity size={12} /> No traffic flows logged — add flows in the Traffic view to preview policy impact here.
      </div>
    );
  }

  const outcomeChangedCount = changed.filter((x) => x.outcomeChanged).length;
  const matchOnlyCount = changed.length - outcomeChangedCount;
  const indicatorColor = outcomeChangedCount > 0 ? '#ef4444' : matchOnlyCount > 0 ? '#f59e0b' : '#22c55e';

  return (
    <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: indicatorColor + '40' }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2"
        style={{ backgroundColor: indicatorColor + '10' }}
      >
        <div className="flex items-center gap-2">
          <Activity size={14} style={{ color: indicatorColor }} />
          <span className="text-xs font-semibold" style={{ color: indicatorColor }}>
            {isNew ? 'Adding' : 'Editing'} this policy {changed.length === 0 ? 'changes nothing' : `affects ${changed.length} of ${totalFlows} flow${totalFlows === 1 ? '' : 's'}`}
          </span>
        </div>
        {open ? <ChevronUp size={14} style={{ color: indicatorColor }} /> : <ChevronDown size={14} style={{ color: indicatorColor }} />}
      </button>
      {open && (
        <div className="px-3 py-2 space-y-2 bg-[var(--color-surface)]">
          {changed.length === 0 ? (
            <p className="text-[10px] text-[var(--color-text-muted)]">
              No flow's effective rule changes with these edits. Either no logged flow matches this policy, or another higher-priority rule still wins.
            </p>
          ) : (
            <>
              {outcomeChangedCount > 0 && (
                <div className="text-[10px] text-red-400">
                  <strong>{outcomeChangedCount}</strong> flow{outcomeChangedCount === 1 ? '' : 's'} would have a different allow/deny outcome.
                </div>
              )}
              {matchOnlyCount > 0 && (
                <div className="text-[10px] text-amber-400">
                  <strong>{matchOnlyCount}</strong> flow{matchOnlyCount === 1 ? '' : 's'} would match a different rule but keep the same allow/deny outcome.
                </div>
              )}
              <ul className="space-y-1 max-h-48 overflow-y-auto">
                {changed.map((x) => {
                  const src = topology.smartGroups.find((g) => g.id === x.flow.srcGroupId)?.name ?? x.flow.srcGroupId;
                  const dst = topology.smartGroups.find((g) => g.id === x.flow.dstGroupId)?.name ?? x.flow.dstGroupId;
                  return (
                    <li key={x.flow.id} className="text-[10px] flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[var(--color-text-secondary)]">{src} → {dst}</span>
                      <span className="font-mono text-[var(--color-text-muted)]">{x.flow.protocol}/{x.flow.port}</span>
                      <ActionPill action={x.beforeAction} />
                      <ArrowRight size={10} className="text-[var(--color-text-muted)]" />
                      <ActionPill action={x.afterAction} />
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- GroupMultiPicker: pill list + add-from-dropdown ----------

interface GroupMultiPickerProps {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  onChange: (v: string[]) => void;
}

function GroupMultiPicker({ label, selected, options, onChange }: GroupMultiPickerProps) {
  const [addOpen, setAddOpen] = useState(false);

  const remove = (id: string) => {
    if (selected.length <= 1) return; // enforce minimum 1
    onChange(selected.filter((s) => s !== id));
  };

  const add = (id: string) => {
    if (!selected.includes(id)) onChange([...selected, id]);
    setAddOpen(false);
  };

  const available = options.filter((o) => !selected.includes(o.value));

  const labelFor = (id: string) => options.find((o) => o.value === id)?.label ?? id;

  return (
    <div className="mb-3">
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
        {label}
      </label>

      {/* Pill list */}
      <div className="flex flex-wrap gap-1 mb-1">
        {selected.map((id) => (
          <span
            key={id}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
            style={{
              backgroundColor: 'var(--color-accent-blue)20',
              color: 'var(--color-accent-blue)',
              border: '1px solid var(--color-accent-blue)40',
            }}
          >
            {labelFor(id)}
            {selected.length > 1 && (
              <button
                onClick={() => remove(id)}
                className="opacity-60 hover:opacity-100 transition-opacity"
                title="Remove"
              >
                <X size={9} />
              </button>
            )}
          </span>
        ))}
      </div>

      {/* Add button + dropdown */}
      <div className="relative">
        <button
          onClick={() => setAddOpen((v) => !v)}
          disabled={available.length === 0}
          className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus size={10} /> Add group
        </button>
        {addOpen && available.length > 0 && (
          <div
            className="absolute z-20 mt-1 w-full max-h-40 overflow-y-auto rounded border shadow-lg"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border-subtle)',
            }}
          >
            {available.map((o) => (
              <button
                key={o.value}
                onClick={() => add(o.value)}
                className="w-full text-left px-2 py-1 text-xs hover:bg-[var(--color-button-hover)] transition-colors"
                style={{ color: 'var(--color-text-primary)' }}
              >
                {o.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------- Main inspector ----------

export default function PolicyInspector({ topology, selectedItem, aiProfile, onBack, onSave, onDelete }: PolicyInspectorProps) {
  const isNew = selectedItem.id === '__new__';

  const initialForm = useMemo<Record<string, unknown>>(() => {
    if (isNew) {
      const maxPriority = topology.policies.length > 0
        ? Math.max(...topology.policies.map((p) => p.priority))
        : 0;
      return {
        name: 'New Policy',
        priority: maxPriority + 10,
        srcGroupId: toStringArray(selectedItem.srcId, 'sg-any'),
        dstGroupId: toStringArray(selectedItem.dstId, 'sg-any'),
        action: 'allow',
        protocol: 'tcp',
        logging: false,
      };
    }
    const p = topology.policies.find((x) => x.id === selectedItem.id);
    if (!p) return {};
    // Normalize legacy string shapes to arrays
    return {
      ...p,
      srcGroupId: toStringArray(p.srcGroupId, 'sg-any'),
      dstGroupId: toStringArray(p.dstGroupId, 'sg-any'),
    };
  }, [topology, selectedItem, isNew]);

  const [form, setForm] = useState<Record<string, unknown>>(initialForm);
  const [dirty, setDirty] = useState(true);
  const [explanation, setExplanation] = useState('');
  const [explaining, setExplaining] = useState(false);

  const updateField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const smartGroupOptions = topology.smartGroups.map((g) => ({ value: g.id, label: g.name }));
  const webGroupOptions = topology.webGroups.map((g) => ({ value: g.id, label: g.name }));
  const threatGroupOptions = topology.threatGroups.map((g) => ({ value: g.id, label: g.name }));
  const geoGroupOptions = topology.geoGroups.map((g) => ({ value: g.id, label: g.name }));

  const p = form;

  // Normalized arrays for current form values
  const srcGroupIds = toStringArray(p.srcGroupId, 'sg-any');
  const dstGroupIds = toStringArray(p.dstGroupId, 'sg-any');

  const policyScore: PolicyScore = useMemo(() => {
    const draftPolicy: DcfPolicy = {
      id: selectedItem.id,
      name: String(p.name ?? ''),
      priority: Number(p.priority ?? 100),
      srcGroupId: srcGroupIds,
      dstGroupId: dstGroupIds,
      action: String(p.action ?? 'allow') as 'allow' | 'deny' | 'learned',
      protocol: String(p.protocol ?? 'tcp') as 'tcp' | 'udp' | 'icmp' | 'any',
      ports: p.ports ? String(p.ports) : undefined,
      logging: !!p.logging,
      decrypt: !!p.decrypt,
      threatGroup: p.threatGroup ? String(p.threatGroup) : undefined,
      geoGroup: p.geoGroup ? String(p.geoGroup) : undefined,
      webGroupIds: (p.webGroupIds as string[]) || undefined,
      srcExcludeGroupIds: (p.srcExcludeGroupIds as string[]) || undefined,
      dstExcludeGroupIds: (p.dstExcludeGroupIds as string[]) || undefined,
    };
    return scorePolicy(draftPolicy, topology);
  }, [selectedItem.id, p, topology, srcGroupIds, dstGroupIds]);

  const handleExplain = async () => {
    if (!aiProfile) return;
    setExplaining(true);
    setExplanation('');

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_EXPLAIN };
    const userMsg: AIMessage = { role: 'user', content: buildExplainPrompt(JSON.stringify(form, null, 2)) };

    let text = '';
    try {
      for await (const chunk of streamChat(aiProfile, [systemMsg, userMsg])) {
        if (chunk.done) break;
        text += chunk.content;
        setExplanation(text);
      }
    } catch (err) {
      setExplanation(err instanceof Error ? err.message : 'Failed to explain');
    } finally {
      setExplaining(false);
    }
  };

  const handleAutoName = () => {
    // Use the first group name for each side for a concise label
    const srcLabel = smartGroupOptions.find((o) => o.value === srcGroupIds[0])?.label ?? 'Any';
    const dstLabel = smartGroupOptions.find((o) => o.value === dstGroupIds[0])?.label ?? 'Any';
    const srcSuffix = srcGroupIds.length > 1 ? ` +${srcGroupIds.length - 1}` : '';
    const dstSuffix = dstGroupIds.length > 1 ? ` +${dstGroupIds.length - 1}` : '';
    const action = String(p.action ?? 'allow');
    const proto = String(p.protocol ?? 'tcp').toUpperCase();
    const port = String(p.ports || '').trim();
    let name = `${action === 'allow' ? 'Allow' : 'Deny'} ${srcLabel}${srcSuffix} to ${dstLabel}${dstSuffix}`;
    if (proto !== 'ANY') {
      name += ` ${proto}`;
      if (port && port !== 'any') name += `/${port}`;
    }
    updateField('name', name);
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        <div className="space-y-1">
          <button
            onClick={onBack}
            className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2"
          >
            <ArrowLeft size={12} /> Back to policies
          </button>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
            {isNew ? 'New Policy' : 'Edit Policy'}
          </div>

          <PolicyScoreCard score={policyScore} />

          <PolicyImpactCard
            topology={topology}
            draft={{
              id: isNew ? `__draft_${selectedItem.id}` : selectedItem.id,
              name: String(p.name ?? ''),
              priority: Number(p.priority ?? 100),
              srcGroupId: srcGroupIds,
              dstGroupId: dstGroupIds,
              action: String(p.action ?? 'allow') as 'allow' | 'deny' | 'learned',
              protocol: String(p.protocol ?? 'tcp') as 'tcp' | 'udp' | 'icmp' | 'any',
              ports: p.ports ? String(p.ports) : undefined,
              logging: !!p.logging,
              enforcement: p.enforcement !== false,
              decrypt: !!p.decrypt,
              threatGroup: p.threatGroup ? String(p.threatGroup) : undefined,
              geoGroup: p.geoGroup ? String(p.geoGroup) : undefined,
              webGroupIds: (p.webGroupIds as string[]) || undefined,
              srcExcludeGroupIds: (p.srcExcludeGroupIds as string[]) || undefined,
              dstExcludeGroupIds: (p.dstExcludeGroupIds as string[]) || undefined,
            }}
            isNew={isNew}
          />

          <div className="mb-3">
            <div className="flex items-center justify-between mb-1">
              <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Name</label>
              <button
                onClick={handleAutoName}
                className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
                title="Generate name from rule attributes"
              >
                <Wand2 size={10} /> Auto
              </button>
            </div>
            <input
              type="text"
              value={String(p.name ?? '')}
              onChange={(e) => updateField('name', e.target.value)}
              className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
            />
          </div>

          <Input label="Priority" value={String(p.priority ?? 100)} onChange={(v) => updateField('priority', Number(v))} type="number" />

          <GroupMultiPicker
            label="Source Groups"
            selected={srcGroupIds}
            options={smartGroupOptions}
            onChange={(v) => updateField('srcGroupId', v)}
          />

          <GroupMultiPicker
            label="Destination Groups"
            selected={dstGroupIds}
            options={smartGroupOptions}
            onChange={(v) => updateField('dstGroupId', v)}
          />

          <Select label="Action" value={String(p.action ?? 'allow')} options={[{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }]} onChange={(v) => updateField('action', v)} />
          <Toggle label="Enforcement" checked={p.enforcement !== false} onChange={(v) => updateField('enforcement', v)} />
          <Select label="Protocol" value={String(p.protocol ?? 'tcp')} options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }, { value: 'any', label: 'Any' }]} onChange={(v) => updateField('protocol', v)} />
          <Input label="Ports" value={String(p.ports ?? '')} onChange={(v) => updateField('ports', v)} placeholder="8080,8443 or any" />
          <Toggle label="Logging" checked={!!p.logging} onChange={(v) => updateField('logging', v)} />
          <Toggle label="TLS Decrypt" checked={!!p.decrypt} onChange={(v) => updateField('decrypt', v)} />
          <MultiSelect label="WebGroups" selected={(p.webGroupIds as string[]) || []} options={webGroupOptions} onChange={(v) => updateField('webGroupIds', v)} />
          <Select label="ThreatGroup" value={String(p.threatGroup ?? '')} options={[{ value: '', label: 'None' }, ...threatGroupOptions]} onChange={(v) => updateField('threatGroup', v || undefined)} />
          <Select label="GeoGroup" value={String(p.geoGroup ?? '')} options={[{ value: '', label: 'None' }, ...geoGroupOptions]} onChange={(v) => updateField('geoGroup', v || undefined)} />
          <MultiSelect label="Exclude Source Groups" selected={(p.srcExcludeGroupIds as string[]) || []} options={smartGroupOptions} onChange={(v) => updateField('srcExcludeGroupIds', v)} />
          <MultiSelect label="Exclude Destination Groups" selected={(p.dstExcludeGroupIds as string[]) || []} options={smartGroupOptions} onChange={(v) => updateField('dstExcludeGroupIds', v)} />

          {aiProfile && !isNew && (
            <div className="pt-2">
              <button
                onClick={handleExplain}
                disabled={explaining}
                className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent-purple)] hover:underline disabled:opacity-50"
              >
                {explaining ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                {explaining ? 'Analyzing...' : 'Explain this policy'}
              </button>
              {(explaining || explanation) && (() => {
                const parsed = parseExplanation(explanation);
                if (explaining && !parsed) {
                  return (
                    <div className="mt-2 p-2.5 rounded bg-[var(--color-accent-purple)]/5 border border-[var(--color-accent-purple)]/20 flex items-center gap-2">
                      <Loader2 size={10} className="animate-spin text-[var(--color-accent-purple)] shrink-0" />
                      <span className="text-xs text-[var(--color-text-muted)]">Analyzing policy…</span>
                    </div>
                  );
                }
                if (parsed) {
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="p-2.5 rounded text-xs bg-[var(--color-accent-purple)]/5 border border-[var(--color-accent-purple)]/20 space-y-2">
                        <p className="font-medium text-[var(--color-text-primary)] leading-snug">{parsed.summary}</p>
                        {parsed.securityImplications && (
                          <p className="text-[var(--color-text-secondary)] leading-snug">{parsed.securityImplications}</p>
                        )}
                        {parsed.recommendations && parsed.recommendations.length > 0 && (
                          <ul className="space-y-1">
                            {parsed.recommendations.map((r, i) => (
                              <li key={i} className="flex items-start gap-1.5 text-[var(--color-text-secondary)] leading-snug">
                                <span className="text-[var(--color-accent-purple)] shrink-0 mt-px">→</span>
                                <span>{r}</span>
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                      <p className="text-[9px] text-[var(--color-text-muted)]">
                        AI-generated · [INFERRED] paths are not confirmed by your topology.
                      </p>
                    </div>
                  );
                }
                if (explanation) {
                  return (
                    <div className="mt-2 p-2.5 rounded text-xs text-[var(--color-text-secondary)] bg-[var(--color-accent-purple)]/5 border border-[var(--color-accent-purple)]/20 whitespace-pre-wrap">
                      {explanation}
                    </div>
                  );
                }
                return null;
              })()}
            </div>
          )}
        </div>
      </div>
      <InspectorFooter dirty={dirty} onSave={() => onSave(form)} onDelete={onDelete} />
    </>
  );
}

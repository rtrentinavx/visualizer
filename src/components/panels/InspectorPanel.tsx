import { useState, useMemo } from 'react';
import { X, Trash2, Save, Plus, Minus, Boxes, Globe, ShieldAlert, MapPin, ArrowLeft, ArrowRight, ShieldCheck, ShieldX, Route, Lock, Sparkles, Loader2, Trophy, ChevronDown, ChevronUp } from 'lucide-react';
import type { DcfPolicyModel, SmartGroupCriteria } from '../../types/dcf';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat } from '../../lib/ai/client';
import { SYSTEM_PROMPT_EXPLAIN, buildExplainPrompt } from '../../lib/ai/prompts';
import { scorePolicy, type PolicyScore } from '../../lib/policyScorer';

interface InspectorPanelProps {
  topology: DcfPolicyModel;
  selectedCell: { srcId: string; dstId: string } | null;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string } | null;
  aiProfile?: AIProfile | null;
  onClose: () => void;
  onUpdateItem: (itemType: string, itemId: string, data: Record<string, unknown>) => void;
  onDeleteItem: (itemType: string, itemId: string) => void;
  onCreateItem: (itemType: string, data: Record<string, unknown>) => void;
  onSelectPolicy: (policyId: string | null, srcId?: string, dstId?: string) => void;
}

const Input = ({ label, value, onChange, type = 'text', placeholder = '' }: { label: string; value: string | number; onChange: (v: string) => void; type?: string; placeholder?: string }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors"
      style={{
        backgroundColor: 'var(--color-input-bg)',
        borderColor: 'var(--color-input-border)',
        color: 'var(--color-text-primary)',
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
    />
  </div>
);

const Select = ({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (v: string) => void }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors appearance-none"
      style={{
        backgroundColor: 'var(--color-input-bg)',
        borderColor: 'var(--color-input-border)',
        color: 'var(--color-text-primary)',
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

const Toggle = ({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) => (
  <div className="mb-3 flex items-center justify-between">
    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</label>
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-gray-500'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  </div>
);

const MultiSelect = ({ label, selected, options, onChange }: { label: string; selected: string[]; options: { value: string; label: string }[]; onChange: (v: string[]) => void }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <div className="space-y-1 max-h-28 overflow-y-auto">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={(e) => {
              if (e.target.checked) onChange([...selected, o.value]);
              else onChange(selected.filter((id) => id !== o.value));
            }}
            className="rounded"
          />
          <span className="text-[var(--color-text-secondary)]">{o.label}</span>
        </label>
      ))}
    </div>
  </div>
);

const CriteriaEditor = ({ criteria, onChange }: { criteria: SmartGroupCriteria[]; onChange: (c: SmartGroupCriteria[]) => void }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Match Criteria</label>
    <div className="space-y-1.5">
      {(criteria || []).map((c, i) => (
        <div key={i} className="flex flex-col gap-1 p-1.5 rounded border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-1">
            <select
              value={c.type ?? 'vm'}
              onChange={(e) => {
                const next = [...criteria];
                const type = e.target.value as SmartGroupCriteria['type'];
                next[i] = type === 'vm' ? { type, key: '', operator: 'equals', value: '' } : { type, cidr: '' };
                onChange(next);
              }}
              className="w-28 px-1 py-1 rounded text-[10px] border outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            >
              <option value="vm">VM Tag</option>
              <option value="subnet">Subnet CIDR</option>
            </select>
            <button
              onClick={() => onChange(criteria.filter((_, idx) => idx !== i))}
              className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors ml-auto"
            >
              <Minus size={12} />
            </button>
          </div>
          {c.type === 'vm' ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={c.key ?? ''}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i], key: e.target.value };
                  onChange(next);
                }}
                placeholder="key"
                className="flex-1 min-w-0 px-1.5 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
              <select
                value={c.operator ?? 'equals'}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i], operator: e.target.value as SmartGroupCriteria['operator'] };
                  onChange(next);
                }}
                className="w-20 px-1 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              >
                <option value="equals">=</option>
                <option value="contains">contains</option>
                <option value="startsWith">starts</option>
              </select>
              <input
                type="text"
                value={c.value ?? ''}
                onChange={(e) => {
                  const next = [...criteria];
                  next[i] = { ...next[i], value: e.target.value };
                  onChange(next);
                }}
                placeholder="value"
                className="flex-1 min-w-0 px-1.5 py-1 rounded text-[10px] border outline-none"
                style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
              />
            </div>
          ) : (
            <input
              type="text"
              value={c.cidr ?? ''}
              onChange={(e) => {
                const next = [...criteria];
                next[i] = { ...next[i], cidr: e.target.value };
                onChange(next);
              }}
              placeholder="10.0.0.0/24"
              className="w-full px-1.5 py-1 rounded text-[10px] border outline-none"
              style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
            />
          )}
        </div>
      ))}
      <button
        onClick={() => onChange([...(criteria || []), { type: 'vm', key: '', operator: 'equals', value: '' }])}
        className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
      >
        <Plus size={12} /> Add criterion
      </button>
    </div>
  </div>
);

const StringListEditor = ({ label, items, onChange, placeholder }: { label: string; items: string[]; onChange: (v: string[]) => void; placeholder?: string }) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-2 py-1 rounded text-xs border outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
          />
          <button
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
          >
            <Minus size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ''])}
        className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
      >
        <Plus size={12} /> Add
      </button>
    </div>
  </div>
);

function directionLabel(dir: string) {
  if (dir === 'inbound') return 'in';
  if (dir === 'outbound') return 'out';
  return 'any';
}

// ---------- Item Editor (keyed for fresh state on item change) ----------

interface ItemEditorProps {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null;
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
}

function ItemEditor({ topology, selectedItem, aiProfile, onBack, onSave, onDelete }: ItemEditorProps) {
  const initialForm = useMemo(() => {
    switch (selectedItem.type) {
      case 'policy': {
        if (selectedItem.id === '__new__') {
          const maxPriority = topology.policies.length > 0
            ? Math.max(...topology.policies.map((p) => p.priority))
            : 0;
          return {
            name: 'New Policy',
            priority: maxPriority + 10,
            srcGroupId: selectedItem.srcId || 'sg-any',
            dstGroupId: selectedItem.dstId || 'sg-any',
            action: 'allow',
            direction: 'any',
            protocol: 'tcp',
            logging: false,
          };
        }
        const p = topology.policies.find((x) => x.id === selectedItem.id);
        return p ? { ...p } : {};
      }
      case 'smartGroup': {
        const g = topology.smartGroups.find((x) => x.id === selectedItem.id);
        return g ? { ...g } : {};
      }
      case 'webGroup': {
        const g = topology.webGroups.find((x) => x.id === selectedItem.id);
        return g ? { ...g } : {};
      }
      case 'threatGroup': {
        const g = topology.threatGroups.find((x) => x.id === selectedItem.id);
        return g ? { ...g } : {};
      }
      case 'geoGroup': {
        const g = topology.geoGroups.find((x) => x.id === selectedItem.id);
        return g ? { ...g } : {};
      }
      default:
        return {};
    }
  }, [topology, selectedItem]);

  const [form, setForm] = useState<Record<string, unknown>>(initialForm);
  const [dirty, setDirty] = useState(true);
  const [explanation, setExplanation] = useState('');
  const [explaining, setExplaining] = useState(false);
  const [showScoreDetails, setShowScoreDetails] = useState(false);

  const updateField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const smartGroupOptions = topology.smartGroups.map((g) => ({ value: g.id, label: g.name }));
  const webGroupOptions = topology.webGroups.map((g) => ({ value: g.id, label: g.name }));
  const threatGroupOptions = topology.threatGroups.map((g) => ({ value: g.id, label: g.name }));
  const geoGroupOptions = topology.geoGroups.map((g) => ({ value: g.id, label: g.name }));

  const p = form;
  const isNew = selectedItem.id === '__new__';

  const policyScore: PolicyScore | null = useMemo(() => {
    if (selectedItem.type !== 'policy') return null;
    const draftPolicy = {
      id: selectedItem.id,
      name: String(p.name ?? ''),
      priority: Number(p.priority ?? 100),
      srcGroupId: String(p.srcGroupId ?? 'sg-any'),
      dstGroupId: String(p.dstGroupId ?? 'sg-any'),
      action: String(p.action ?? 'allow') as 'allow' | 'deny' | 'learned',
      direction: String(p.direction ?? 'any') as 'inbound' | 'outbound' | 'any',
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
  }, [selectedItem.type, selectedItem.id, p, topology]);

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

  const renderPolicyForm = () => (
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

      {/* Policy Score */}
      {policyScore && (
        <div className="mb-3 rounded-lg border overflow-hidden" style={{ borderColor: policyScore.color + '40' }}>
          <button
            onClick={() => setShowScoreDetails((v) => !v)}
            className="w-full flex items-center justify-between px-3 py-2"
            style={{ backgroundColor: policyScore.color + '10' }}
          >
            <div className="flex items-center gap-2">
              <Trophy size={14} style={{ color: policyScore.color }} />
              <span className="text-xs font-semibold" style={{ color: policyScore.color }}>
                Score: {policyScore.total}/100
              </span>
              <span
                className="text-[10px] font-bold px-1.5 py-0.5 rounded"
                style={{ backgroundColor: policyScore.color + '20', color: policyScore.color }}
              >
                {policyScore.grade}
              </span>
            </div>
            {showScoreDetails ? <ChevronUp size={14} style={{ color: policyScore.color }} /> : <ChevronDown size={14} style={{ color: policyScore.color }} />}
          </button>
          {showScoreDetails && (
            <div className="px-3 py-2 space-y-2 bg-[var(--color-surface)]">
              <div className="grid grid-cols-5 gap-1 text-center">
                {[
                  { label: 'Name', val: policyScore.naming },
                  { label: 'Spec', val: policyScore.specificity },
                  { label: 'Sec', val: policyScore.security },
                  { label: 'Pri', val: policyScore.priority },
                  { label: 'Log', val: policyScore.logging },
                ].map((s) => (
                  <div key={s.label} className="space-y-0.5">
                    <div className="text-[9px] text-[var(--color-text-muted)]">{s.label}</div>
                    <div className="text-[10px] font-semibold" style={{ color: s.val >= 10 ? '#22c55e' : s.val >= 5 ? '#eab308' : '#ef4444' }}>{s.val}</div>
                  </div>
                ))}
              </div>
              {policyScore.tips.length > 0 && (
                <div className="space-y-1">
                  {policyScore.tips.map((tip, i) => (
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
      )}

      <Input label="Name" value={String(p.name ?? '')} onChange={(v) => updateField('name', v)} />
      <Input label="Priority" value={String(p.priority ?? 100)} onChange={(v) => updateField('priority', Number(v))} type="number" />
      <Select label="Source Group" value={String(p.srcGroupId ?? 'sg-any')} options={smartGroupOptions} onChange={(v) => updateField('srcGroupId', v)} />
      <Select label="Destination Group" value={String(p.dstGroupId ?? 'sg-any')} options={smartGroupOptions} onChange={(v) => updateField('dstGroupId', v)} />
      <Select label="Action" value={String(p.action ?? 'allow')} options={[{ value: 'allow', label: 'Allow' }, { value: 'deny', label: 'Deny' }, { value: 'learned', label: 'Learned' }]} onChange={(v) => updateField('action', v)} />
      <Select label="Direction" value={String(p.direction ?? 'any')} options={[{ value: 'inbound', label: 'Inbound' }, { value: 'outbound', label: 'Outbound' }, { value: 'any', label: 'Any' }]} onChange={(v) => updateField('direction', v)} />
      <Select label="Protocol" value={String(p.protocol ?? 'tcp')} options={[{ value: 'tcp', label: 'TCP' }, { value: 'udp', label: 'UDP' }, { value: 'icmp', label: 'ICMP' }, { value: 'any', label: 'Any' }]} onChange={(v) => updateField('protocol', v)} />
      <Input label="Ports" value={String(p.ports ?? '')} onChange={(v) => updateField('ports', v)} placeholder="8080,8443 or any" />
      <Toggle label="Logging" checked={!!p.logging} onChange={(v) => updateField('logging', v)} />
      <Toggle label="TLS Decrypt" checked={!!p.decrypt} onChange={(v) => updateField('decrypt', v)} />
      <MultiSelect label="WebGroups" selected={(p.webGroupIds as string[]) || []} options={webGroupOptions} onChange={(v) => updateField('webGroupIds', v)} />
      <Select label="ThreatGroup" value={String(p.threatGroup ?? '')} options={[{ value: '', label: 'None' }, ...threatGroupOptions]} onChange={(v) => updateField('threatGroup', v || undefined)} />
      <Select label="GeoGroup" value={String(p.geoGroup ?? '')} options={[{ value: '', label: 'None' }, ...geoGroupOptions]} onChange={(v) => updateField('geoGroup', v || undefined)} />
      <MultiSelect label="Exclude Source Groups" selected={(p.srcExcludeGroupIds as string[]) || []} options={smartGroupOptions} onChange={(v) => updateField('srcExcludeGroupIds', v)} />
      <MultiSelect label="Exclude Destination Groups" selected={(p.dstExcludeGroupIds as string[]) || []} options={smartGroupOptions} onChange={(v) => updateField('dstExcludeGroupIds', v)} />

      {/* AI Explain */}
      {aiProfile && selectedItem.id !== '__new__' && (
        <div className="pt-2">
          <button
            onClick={handleExplain}
            disabled={explaining}
            className="flex items-center gap-1.5 text-[10px] text-[var(--color-accent-purple)] hover:underline disabled:opacity-50"
          >
            {explaining ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
            {explaining ? 'Analyzing...' : 'Explain this policy'}
          </button>
          {explanation && (
            <div className="mt-2 p-2.5 rounded text-xs text-[var(--color-text-secondary)] bg-[var(--color-accent-purple)]/5 border border-[var(--color-accent-purple)]/20">
              {explanation}
            </div>
          )}
        </div>
      )}
    </div>
  );

  const renderSmartGroupForm = () => {
    const g = topology.smartGroups.find((x) => x.id === selectedItem.id);
    if (!g) return null;
    return (
      <div className="space-y-1">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">SmartGroup</div>
        <Input label="Name" value={String(form.name ?? g.name)} onChange={(v) => updateField('name', v)} />
        <div className="mb-3">
          <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Color</label>
          <div className="flex items-center gap-2">
            <input type="color" value={String(form.color ?? g.color)} onChange={(e) => updateField('color', e.target.value)} className="w-8 h-8 rounded cursor-pointer border-0 p-0" />
            <span className="text-xs text-[var(--color-text-muted)] font-mono">{String(form.color ?? g.color)}</span>
          </div>
        </div>
        <Input label="Workload Count" value={String(form.workloadCount ?? g.workloadCount)} onChange={(v) => updateField('workloadCount', Number(v))} type="number" />
        <Select label="Match Type" value={String(form.matchType ?? g.matchType)} options={[{ value: 'any', label: 'Match Any' }, { value: 'all', label: 'Match All' }]} onChange={(v) => updateField('matchType', v)} />
        <CriteriaEditor criteria={(form.criteria as SmartGroupCriteria[]) || g.criteria} onChange={(v) => updateField('criteria', v)} />
      </div>
    );
  };

  const renderWebGroupForm = () => {
    const g = topology.webGroups.find((x) => x.id === selectedItem.id);
    if (!g) return null;
    return (
      <div className="space-y-1">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">WebGroup</div>
        <Input label="Name" value={String(form.name ?? g.name)} onChange={(v) => updateField('name', v)} />
        <StringListEditor label="FQDNs" items={(form.fqdns as string[]) || g.fqdns} onChange={(v) => updateField('fqdns', v)} placeholder="*.example.com" />
      </div>
    );
  };

  const renderThreatGroupForm = () => {
    const g = topology.threatGroups.find((x) => x.id === selectedItem.id);
    if (!g) return null;
    return (
      <div className="space-y-1">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">ThreatGroup</div>
        <Input label="Name" value={String(form.name ?? g.name)} onChange={(v) => updateField('name', v)} />
        <Select label="Category" value={String(form.category ?? g.category)} options={[{ value: 'malware', label: 'Malware' }, { value: 'botnet', label: 'Botnet' }, { value: 'phishing', label: 'Phishing' }, { value: 'anonymous', label: 'Anonymous' }, { value: 'custom', label: 'Custom' }]} onChange={(v) => updateField('category', v)} />
        <Input label="Entry Count" value={String(form.entryCount ?? g.entryCount)} onChange={(v) => updateField('entryCount', Number(v))} type="number" />
      </div>
    );
  };

  const renderGeoGroupForm = () => {
    const g = topology.geoGroups.find((x) => x.id === selectedItem.id);
    if (!g) return null;
    return (
      <div className="space-y-1">
        <button onClick={onBack} className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline mb-2">
          <ArrowLeft size={12} /> Back
        </button>
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">GeoGroup</div>
        <Input label="Name" value={String(form.name ?? g.name)} onChange={(v) => updateField('name', v)} />
        <StringListEditor label="Countries (ISO codes)" items={(form.countries as string[]) || g.countries} onChange={(v) => updateField('countries', v)} placeholder="US" />
      </div>
    );
  };

  const renderForm = () => {
    switch (selectedItem.type) {
      case 'policy': return renderPolicyForm();
      case 'smartGroup': return renderSmartGroupForm();
      case 'webGroup': return renderWebGroupForm();
      case 'threatGroup': return renderThreatGroupForm();
      case 'geoGroup': return renderGeoGroupForm();
      default: return null;
    }
  };

  return (
    <>
      <div className="flex-1 overflow-y-auto p-4">
        {renderForm()}
      </div>
      <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
        <button
          onClick={() => onSave(form)}
          disabled={!dirty}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
          style={{ backgroundColor: 'var(--color-aviatrix)' }}
          onMouseEnter={(e) => dirty && (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix)')}
        >
          <Save size={13} />
          Save
        </button>
        <button
          onClick={onDelete}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
          style={{
            backgroundColor: 'var(--color-surface)',
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-text-secondary)',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
            e.currentTarget.style.color = '#ef4444';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--color-surface)';
            e.currentTarget.style.color = 'var(--color-text-secondary)';
          }}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </>
  );
}

// ---------- Main Inspector Panel ----------

export default function InspectorPanel({ topology, selectedCell, selectedItem, aiProfile, onClose, onUpdateItem, onDeleteItem, onCreateItem, onSelectPolicy }: InspectorPanelProps) {
  const cellPolicies = useMemo(() => {
    if (!selectedCell) return [];
    return topology.policies
      .filter(
        (p) =>
          (p.srcGroupId === selectedCell.srcId || p.srcGroupId === 'sg-any') &&
          (p.dstGroupId === selectedCell.dstId || p.dstGroupId === 'sg-any')
      )
      .sort((a, b) => a.priority - b.priority);
  }, [topology.policies, selectedCell]);

  const srcGroup = topology.smartGroups.find((g) => g.id === selectedCell?.srcId);
  const dstGroup = topology.smartGroups.find((g) => g.id === selectedCell?.dstId);

  const renderCellView = () => (
    <div className="space-y-4">
      {selectedCell && srcGroup && dstGroup && (
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Policies</div>
          <div className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)] mb-3">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: srcGroup.color }} />
              {srcGroup.name}
            </span>
            <ArrowRight size={14} className="text-[var(--color-text-muted)]" />
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: dstGroup.color }} />
              {dstGroup.name}
            </span>
          </div>
          {cellPolicies.length === 0 ? (
            <div className="text-xs text-[var(--color-text-muted)] py-2">
              No policies for this pair. Create one below.
            </div>
          ) : (
            <div className="space-y-1.5">
              {cellPolicies.map((p) => (
                <button
                  key={p.id}
                  onClick={() => onSelectPolicy(p.id)}
                  className="w-full flex items-center gap-2 px-2.5 py-2 rounded text-xs text-left transition-colors"
                  style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border-subtle)' }}
                >
                  {p.action === 'allow' ? (
                    <ShieldCheck size={14} className="text-green-400 shrink-0" />
                  ) : p.action === 'learned' ? (
                    <Route size={14} className="text-[var(--color-accent-purple)] shrink-0" />
                  ) : (
                    <ShieldX size={14} className="text-red-400 shrink-0" />
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5 truncate">
                      <span className="font-medium text-[var(--color-text-primary)] truncate">{p.name}</span>
                      <span className="text-[10px] text-[var(--color-text-muted)] font-mono">#{p.priority}</span>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                      {directionLabel(p.direction)}
                      <span>·</span>
                      {p.protocol}
                      <span>·</span>
                      {p.ports || 'any'}
                      {p.decrypt && <Lock size={9} className="text-[var(--color-accent-purple)]" />}
                    </div>
                  </div>
                  <span className="text-[10px] text-[var(--color-accent-blue)] shrink-0">Edit</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {selectedCell && (
        <button
          onClick={() => onSelectPolicy('__new__', selectedCell?.srcId, selectedCell?.dstId)}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-white transition-colors"
          style={{ backgroundColor: 'var(--color-aviatrix)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix-dark)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix)')}
        >
          <Plus size={13} />
          New Policy
        </button>
      )}
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Groups</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => onCreateItem('smartGroup', {})}
            className="flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <Boxes size={14} /> SmartGroup
          </button>
          <button
            onClick={() => onCreateItem('webGroup', {})}
            className="flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <Globe size={14} /> WebGroup
          </button>
          <button
            onClick={() => onCreateItem('threatGroup', {})}
            className="flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <ShieldAlert size={14} /> ThreatGroup
          </button>
          <button
            onClick={() => onCreateItem('geoGroup', {})}
            className="flex items-center gap-2 px-3 py-2 rounded-md border text-xs transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <MapPin size={14} /> GeoGroup
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Summary</div>
        <div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
          <div className="flex justify-between"><span>SmartGroups</span><span>{topology.smartGroups.length}</span></div>
          <div className="flex justify-between"><span>WebGroups</span><span>{topology.webGroups.length}</span></div>
          <div className="flex justify-between"><span>ThreatGroups</span><span>{topology.threatGroups.length}</span></div>
          <div className="flex justify-between"><span>GeoGroups</span><span>{topology.geoGroups.length}</span></div>
          <div className="flex justify-between"><span>Policies</span><span>{topology.policies.length}</span></div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
          <X size={14} />
        </button>
      </div>
      {selectedItem ? (
        <ItemEditor
          key={`${selectedItem.type}:${selectedItem.id}`}
          topology={topology}
          selectedItem={selectedItem}
          aiProfile={aiProfile}
          onBack={() => onSelectPolicy(null)}
          onSave={(data) => onUpdateItem(selectedItem.type, selectedItem.id, data)}
          onDelete={() => onDeleteItem(selectedItem.type, selectedItem.id)}
        />
      ) : (
        <div className="flex-1 overflow-y-auto p-4">
          {renderCellView()}
        </div>
      )}
    </div>
  );
}

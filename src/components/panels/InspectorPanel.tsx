import { useState, useEffect } from 'react';
import { X, Router, Server, Trash2, Save, Plus, Minus } from 'lucide-react';
import type { DcfTopology, GatewayType, SmartGroupCriteria } from '../../types/dcf';

interface InspectorPanelProps {
  topology: DcfTopology;
  selectedNodeId: string | null;
  selectedNodeType: string | null;
  onClose: () => void;
  onUpdateNode: (nodeId: string, nodeType: string, data: Record<string, unknown>) => void;
  onDeleteNode: (nodeId: string, nodeType: string) => void;
}

const gatewayIcons: Record<GatewayType, typeof Router> = {
  transit: Router,
  spoke: Server,
};

const gatewayTypes: GatewayType[] = ['transit', 'spoke'];

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

export default function InspectorPanel({ topology, selectedNodeId, selectedNodeType, onClose, onUpdateNode, onDeleteNode }: InspectorPanelProps) {
  const [form, setForm] = useState<Record<string, unknown>>({});
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    if (!selectedNodeId || !selectedNodeType) {
      setForm({});
      setDirty(false);
      return;
    }
    let data: Record<string, unknown> = {};
    switch (selectedNodeType) {
      case 'vpc': {
        const v = topology.vpcs.find((x) => x.id === selectedNodeId);
        if (v) data = { name: v.name, cidr: v.cidr, account: v.account };
        break;
      }
      case 'gateway': {
        const g = topology.gateways.find((x) => x.id === selectedNodeId);
        if (g) data = { name: g.name, type: g.type, vpcId: g.vpcId, haEnabled: g.haEnabled, primaryIp: g.primaryIp ?? '', haIp: g.haIp ?? '', asn: g.asn ?? '' };
        break;
      }
      case 'smartGroup': {
        const s = topology.smartGroups.find((x) => x.id === selectedNodeId);
        if (s) data = { name: s.name, color: s.color, workloadCount: s.workloadCount, matchType: s.matchType, criteria: s.criteria };
        break;
      }
    }
    setForm(data);
    setDirty(false);
  }, [selectedNodeId, selectedNodeType, topology]);

  const updateField = (key: string, value: unknown) => {
    setForm((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };

  const handleSave = () => {
    if (!selectedNodeId || !selectedNodeType) return;
    onUpdateNode(selectedNodeId, selectedNodeType, form);
    setDirty(false);
  };

  const handleDelete = () => {
    if (!selectedNodeId || !selectedNodeType) return;
    onDeleteNode(selectedNodeId, selectedNodeType);
  };

  if (!selectedNodeId || !selectedNodeType) {
    return (
      <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
        <div className="p-4 border-b border-[var(--color-border-subtle)]">
          <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        </div>
        <div className="flex-1 flex items-center justify-center p-6 text-center">
          <div className="text-[var(--color-text-muted)] text-sm">
            Select a node on the canvas to edit its configuration
          </div>
        </div>
      </div>
    );
  }

  const renderForm = () => {
    switch (selectedNodeType) {
      case 'vpc': {
        const vpc = topology.vpcs.find((v) => v.id === selectedNodeId);
        if (!vpc) return null;
        return (
          <div className="space-y-1">
            <Input label="Name" value={String(form.name ?? '')} onChange={(v) => updateField('name', v)} />
            <Input label="CIDR" value={String(form.cidr ?? '')} onChange={(v) => updateField('cidr', v)} />
            <Input label="Account" value={String(form.account ?? '')} onChange={(v) => updateField('account', v)} />
            <div className="pt-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Gateways</div>
              <div className="space-y-1.5">
                {topology.gateways
                  .filter((g) => g.vpcId === vpc.id)
                  .map((gw) => {
                    const Icon = gatewayIcons[gw.type];
                    return (
                      <div key={gw.id} className="flex items-center justify-between px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                        <div className="flex items-center gap-2">
                          <Icon size={12} className="text-[var(--color-accent-blue)]" />
                          <span className="text-xs text-[var(--color-text-primary)]">{gw.name}</span>
                        </div>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${gw.haEnabled ? 'bg-green-500/20 text-green-400' : 'bg-amber-500/20 text-amber-400'}`}>
                          {gw.haEnabled ? 'HA' : 'Single'}
                        </span>
                      </div>
                    );
                  })}
                {topology.gateways.filter((g) => g.vpcId === vpc.id).length === 0 && (
                  <div className="text-[10px] text-[var(--color-text-muted)] italic">No gateways assigned</div>
                )}
              </div>
            </div>
          </div>
        );
      }
      case 'gateway': {
        const gw = topology.gateways.find((g) => g.id === selectedNodeId);
        if (!gw) return null;
        return (
          <div className="space-y-1">
            <Input label="Name" value={String(form.name ?? '')} onChange={(v) => updateField('name', v)} />
            <Select
              label="Type"
              value={String(form.type ?? 'spoke')}
              options={gatewayTypes.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
              onChange={(v) => updateField('type', v)}
            />
            <Select
              label="VPC"
              value={String(form.vpcId ?? '')}
              options={topology.vpcs.map((v) => ({ value: v.id, label: v.name }))}
              onChange={(v) => updateField('vpcId', v)}
            />
            <Toggle label="HA Enabled" checked={!!form.haEnabled} onChange={(v) => updateField('haEnabled', v)} />
            <Input label="Primary IP" value={String(form.primaryIp ?? '')} onChange={(v) => updateField('primaryIp', v)} placeholder="10.0.0.1" />
            {!!form.haEnabled && (
              <Input label="HA IP" value={String(form.haIp ?? '')} onChange={(v) => updateField('haIp', v)} placeholder="10.0.0.2" />
            )}
            {form.type === 'transit' && (
              <Input label="ASN" value={String(form.asn ?? '')} onChange={(v) => updateField('asn', v ? Number(v) : undefined)} type="number" placeholder="65001" />
            )}
          </div>
        );
      }
      case 'smartGroup': {
        const sg = topology.smartGroups.find((s) => s.id === selectedNodeId);
        if (!sg) return null;
        const relatedPolicies = topology.policies.filter((p) => p.srcGroupId === sg.id || p.dstGroupId === sg.id);
        return (
          <div className="space-y-1">
            <Input label="Name" value={String(form.name ?? '')} onChange={(v) => updateField('name', v)} />
            <div className="mb-3">
              <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Color</label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={String(form.color ?? '#3b82f6')}
                  onChange={(e) => updateField('color', e.target.value)}
                  className="w-8 h-8 rounded cursor-pointer border-0 p-0"
                />
                <span className="text-xs text-[var(--color-text-muted)] font-mono">{String(form.color ?? '#3b82f6')}</span>
              </div>
            </div>
            <Input label="Workload Count" value={String(form.workloadCount ?? 0)} onChange={(v) => updateField('workloadCount', Number(v))} type="number" />
            <Select
              label="Match Type"
              value={String(form.matchType ?? 'any')}
              options={[
                { value: 'any', label: 'Match Any' },
                { value: 'all', label: 'Match All' },
              ]}
              onChange={(v) => updateField('matchType', v)}
            />
            <CriteriaEditor criteria={(form.criteria as SmartGroupCriteria[]) || []} onChange={(v) => updateField('criteria', v)} />

            <div className="pt-3 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Related Policies ({relatedPolicies.length})</div>
              <div className="space-y-1.5">
                {relatedPolicies.map((p) => (
                  <div key={p.id} className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-[var(--color-text-primary)]">{p.name}</span>
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${p.action === 'allow' ? 'bg-green-500/20 text-green-400' : p.action === 'learned' ? 'bg-[var(--color-accent-purple)]/20 text-[var(--color-accent-purple)]' : 'bg-red-500/20 text-red-400'}`}>
                        {p.action}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                      {p.protocol.toUpperCase()} {p.ports && `:${p.ports}`} • Priority {p.priority}
                    </div>
                  </div>
                ))}
                {relatedPolicies.length === 0 && <div className="text-[10px] text-[var(--color-text-muted)] italic">No related policies</div>}
              </div>
            </div>
          </div>
        );
      }
      default:
        return null;
    }
  };

  return (
    <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {renderForm()}
      </div>
      <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
        <button
          onClick={handleSave}
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
          onClick={handleDelete}
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
    </div>
  );
}

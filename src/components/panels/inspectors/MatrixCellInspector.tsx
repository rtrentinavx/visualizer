import { useMemo, useState } from 'react';
import { ArrowRight, Boxes, Globe, ShieldAlert, MapPin, ShieldCheck, ShieldX, Lock, Plus, Library } from 'lucide-react';
import WebGroupPresetModal from '../../modals/WebGroupPresetModal';
import type { WebGroupPreset } from '../../../data/webGroupPresets';
import type { DcfPolicyModel } from '../../../types/dcf';

interface MatrixCellInspectorProps {
  topology: DcfPolicyModel;
  selectedCell: { srcId: string; dstId: string } | null;
  onCreateItem: (itemType: string, data: Record<string, unknown>) => void;
  onSelectPolicy: (policyId: string | null, srcId?: string, dstId?: string) => void;
}

export default function MatrixCellInspector({ topology, selectedCell, onCreateItem, onSelectPolicy }: MatrixCellInspectorProps) {
  const [showPresetModal, setShowPresetModal] = useState(false);

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

  return (
    <div className="flex-1 overflow-y-auto p-4">
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
                    ) : (
                      <ShieldX size={14} className="text-red-400 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 truncate">
                        <span className="font-medium text-[var(--color-text-primary)] truncate">{p.name}</span>
                        <span className="text-[10px] text-[var(--color-text-muted)] font-mono">#{p.priority}</span>
                      </div>
                      <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
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
          <button
            onClick={() => setShowPresetModal(true)}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md border text-xs transition-colors"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <Library size={13} /> Browse WebGroup Library
          </button>
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
      {showPresetModal && (
        <WebGroupPresetModal
          existingNames={topology.webGroups.map((g) => g.name)}
          onAdd={(preset: WebGroupPreset) => {
            onCreateItem('webGroup', { name: preset.name, fqdns: preset.fqdns });
            setShowPresetModal(false);
          }}
          onClose={() => setShowPresetModal(false)}
        />
      )}
    </div>
  );
}

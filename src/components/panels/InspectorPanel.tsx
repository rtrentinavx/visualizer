import { X } from 'lucide-react';
import type { ComponentType } from 'react';
import type { DcfPolicyModel } from '../../types/dcf';
import type { AIProfile } from '../../lib/ai/types';
import PolicyInspector from './inspectors/PolicyInspector';
import SmartGroupInspector from './inspectors/SmartGroupInspector';
import WebGroupInspector from './inspectors/WebGroupInspector';
import ThreatGroupInspector from './inspectors/ThreatGroupInspector';
import GeoGroupInspector from './inspectors/GeoGroupInspector';
import MatrixCellInspector from './inspectors/MatrixCellInspector';

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

// Dispatch table: maps selectedItem.type to the per-entity inspector component.
// Policy needs aiProfile; the others ignore it.
type InspectorChildProps = {
  topology: DcfPolicyModel;
  selectedItem: { type: string; id: string; srcId?: string; dstId?: string };
  aiProfile?: AIProfile | null;
  onBack: () => void;
  onSave: (data: Record<string, unknown>) => void;
  onDelete: () => void;
};

const INSPECTOR_BY_TYPE: Record<string, ComponentType<InspectorChildProps>> = {
  policy: PolicyInspector,
  smartGroup: SmartGroupInspector,
  webGroup: WebGroupInspector,
  threatGroup: ThreatGroupInspector,
  geoGroup: GeoGroupInspector,
};

export default function InspectorPanel({
  topology,
  selectedCell,
  selectedItem,
  aiProfile,
  onClose,
  onUpdateItem,
  onDeleteItem,
  onCreateItem,
  onSelectPolicy,
}: InspectorPanelProps) {
  let body;
  if (!selectedItem) {
    body = (
      <MatrixCellInspector
        topology={topology}
        selectedCell={selectedCell}
        onCreateItem={onCreateItem}
        onSelectPolicy={onSelectPolicy}
      />
    );
  } else {
    const Child = INSPECTOR_BY_TYPE[selectedItem.type];
    body = Child ? (
      <Child
        key={selectedItem.id}
        topology={topology}
        selectedItem={selectedItem}
        aiProfile={aiProfile}
        onBack={() => onSelectPolicy(null)}
        onSave={(data) => onUpdateItem(selectedItem.type, selectedItem.id, data)}
        onDelete={() => onDeleteItem(selectedItem.type, selectedItem.id)}
      />
    ) : null;
  }

  return (
    <div className="w-80 border-l border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col">
      <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Inspector</h2>
        <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
          <X size={14} />
        </button>
      </div>
      {body}
    </div>
  );
}

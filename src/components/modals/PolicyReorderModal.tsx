import { useMemo, useState } from 'react';
import { X, GripVertical, Check, ListOrdered, ShieldCheck, ShieldX, RotateCcw } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { DcfPolicy, DcfPolicyModel } from '../../types/dcf';
import { reorderPolicies } from '../../lib/reorderPolicies';

interface PolicyReorderModalProps {
  topology: DcfPolicyModel;
  onApply: (newTopology: DcfPolicyModel) => void;
  onClose: () => void;
}

function nameOf(topology: DcfPolicyModel, id: string): string {
  return topology.smartGroups.find((g) => g.id === id)?.name ?? id;
}

function SortableRow({
  id,
  policy,
  topology,
  ladderPriority,
}: {
  id: string;
  policy: DcfPolicy;
  topology: DcfPolicyModel;
  ladderPriority: number;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  const priorityChanged = policy.priority !== ladderPriority;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-2 px-2 py-1.5 rounded border bg-[var(--color-surface)] border-[var(--color-border-subtle)]"
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 -ml-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] touch-none"
        title="Drag to reorder"
        aria-label={`Drag handle for ${policy.name}`}
      >
        <GripVertical size={12} />
      </button>

      <div className="flex items-center gap-1 w-20 shrink-0">
        <span className="text-[10px] font-mono text-[var(--color-text-muted)] line-through opacity-60">
          #{policy.priority}
        </span>
        {priorityChanged && (
          <span className="text-[10px] font-mono font-semibold text-[var(--color-accent-blue)]">
            #{ladderPriority}
          </span>
        )}
      </div>

      <div className="w-5 shrink-0">
        {policy.action === 'allow' ? (
          <ShieldCheck size={12} className="text-green-400" />
        ) : (
          <ShieldX size={12} className="text-red-400" />
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="text-xs font-medium text-[var(--color-text-primary)] truncate">{policy.name}</div>
        <div className="text-[10px] text-[var(--color-text-muted)] truncate">
          {nameOf(topology, policy.srcGroupId)} → {nameOf(topology, policy.dstGroupId)} · {policy.protocol}/{policy.ports || 'any'}
        </div>
      </div>
    </div>
  );
}

export default function PolicyReorderModal({ topology, onApply, onClose }: PolicyReorderModalProps) {
  const initialOrder = useMemo(
    () => [...topology.policies].sort((a, b) => a.priority - b.priority).map((p) => p.id),
    [topology.policies],
  );
  const [order, setOrder] = useState<string[]>(initialOrder);
  const [applied, setApplied] = useState(false);

  const policyById = useMemo(() => {
    const m = new Map<string, DcfPolicy>();
    topology.policies.forEach((p) => m.set(p.id, p));
    return m;
  }, [topology.policies]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    setOrder((items) => {
      const from = items.indexOf(String(active.id));
      const to = items.indexOf(String(over.id));
      if (from < 0 || to < 0) return items;
      return arrayMove(items, from, to);
    });
  };

  const reset = () => setOrder(initialOrder);

  const isDirty = order.some((id, i) => id !== initialOrder[i]);

  const handleApply = () => {
    if (!isDirty) return;
    const next = reorderPolicies(topology, order);
    onApply(next);
    setApplied(true);
    setTimeout(onClose, 400);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <ListOrdered size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Reorder Policies</h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                Drag rows to reorder. Apply renumbers to a 10-step ladder starting at 100.
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {order.length === 0 ? (
            <div className="text-xs text-[var(--color-text-muted)] text-center py-8">
              No policies to reorder.
            </div>
          ) : (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={order} strategy={verticalListSortingStrategy}>
                <div className="space-y-1">
                  {order.map((id, idx) => {
                    const p = policyById.get(id);
                    if (!p) return null;
                    return (
                      <SortableRow
                        key={id}
                        id={id}
                        policy={p}
                        topology={topology}
                        ladderPriority={100 + idx * 10}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
          <button
            onClick={reset}
            disabled={!isDirty}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border disabled:opacity-40"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
          >
            <RotateCcw size={12} />
            Reset
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-xs font-medium border"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
            >
              Cancel
            </button>
            <button
              onClick={handleApply}
              disabled={!isDirty || applied}
              className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Check size={13} />
              {applied ? 'Applied' : 'Apply order'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

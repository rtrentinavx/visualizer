import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import type { DcfPolicyModel } from '../types/dcf';
import { checkAchievements, type Achievement } from '../lib/achievements';

export default function AchievementToaster({ topology }: { topology: DcfPolicyModel }) {
  const [toasts, setToasts] = useState<Achievement[]>([]);

  useEffect(() => {
    const scores = new Map(topology.policies.map((p) => [p.id, 0]));
    const newAchievements = checkAchievements(topology, 0, scores);
    if (newAchievements.length > 0) {
      queueMicrotask(() => {
        setToasts((prev) => [...prev, ...newAchievements]);
      });
    }
  }, [topology]);

  const dismiss = (id: string) => {
    setToasts((prev) => prev.filter((a) => a.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2">
      {toasts.map((ach) => (
        <div
          key={ach.id}
          className="flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg animate-in fade-in slide-in-from-right-4"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
        >
          <span className="text-xl">{ach.icon}</span>
          <div>
            <p className="text-xs font-semibold text-[var(--color-text-primary)]">Achievement Unlocked!</p>
            <p className="text-[10px] text-[var(--color-text-secondary)]">{ach.name}</p>
            <p className="text-[10px] text-[var(--color-text-muted)]">{ach.description}</p>
          </div>
          <button
            onClick={() => dismiss(ach.id)}
            className="ml-2 p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

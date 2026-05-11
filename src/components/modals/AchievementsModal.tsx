import { X, Medal, Trophy } from 'lucide-react';
import { getAllAchievements } from '../../lib/achievements';

export default function AchievementsModal({ onClose }: { onClose: () => void }) {
  const all = getAllAchievements();
  const unlockedCount = all.filter((a) => a.unlockedAt).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-md max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Medal size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Achievements</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {unlockedCount} / {all.length} unlocked
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {all.map((ach) => (
            <div
              key={ach.id}
              className={`flex items-center gap-3 p-3 rounded-lg border ${
                ach.unlockedAt ? 'border-[var(--color-border-subtle)] bg-[var(--color-surface)]' : 'border-[var(--color-border-subtle)] opacity-50'
              }`}
            >
              <span className="text-xl">{ach.icon}</span>
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium ${ach.unlockedAt ? 'text-[var(--color-text-primary)]' : 'text-[var(--color-text-muted)]'}`}>
                  {ach.name}
                </p>
                <p className="text-[10px] text-[var(--color-text-muted)]">{ach.description}</p>
                {ach.unlockedAt && (
                  <p className="text-[9px] text-green-400 mt-0.5">
                    Unlocked {new Date(ach.unlockedAt).toLocaleDateString()}
                  </p>
                )}
              </div>
              {ach.unlockedAt && <Trophy size={14} className="text-[var(--color-accent-blue)] shrink-0" />}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

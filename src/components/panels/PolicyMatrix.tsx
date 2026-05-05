import { useMemo } from 'react';
import { ShieldCheck, ShieldX, Lock, Globe } from 'lucide-react';
import type { DcfTopology } from '../../types/dcf';

interface PolicyMatrixProps {
  topology: DcfTopology;
}

export default function PolicyMatrix({ topology }: PolicyMatrixProps) {
  const { groups, matrix } = useMemo(() => {
    const groups = topology.smartGroups.filter((g) => g.id !== 'sg-internet');
    const matrix: Record<string, Record<string, { action: 'allow' | 'deny'; ports: string; protocol: string } | null>> = {};

    for (const src of groups) {
      matrix[src.id] = {};
      for (const dst of groups) {
        const policy = topology.policies.find(
          (p) =>
            (p.srcGroupId === src.id && p.dstGroupId === dst.id) ||
            (p.srcGroupId === src.id && p.dstGroupId === 'sg-internet' && dst.id === 'sg-internet') ||
            (p.dstGroupId === dst.id && p.srcGroupId === 'sg-internet' && src.id === 'sg-internet')
        );
        if (policy) {
          matrix[src.id][dst.id] = {
            action: policy.action,
            ports: policy.ports || 'any',
            protocol: policy.protocol,
          };
        } else {
          matrix[src.id][dst.id] = null;
        }
      }
    }

    return { groups, matrix };
  }, [topology]);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Matrix</h2>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">SmartGroup to SmartGroup DCF policy overview</p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <div className="inline-block min-w-full">
          <div className="grid gap-1" style={{ gridTemplateColumns: `140px repeat(${groups.length}, minmax(100px, 1fr))` }}>
            {/* Header row */}
            <div className="p-2" />
            {groups.map((g) => (
              <div key={g.id} className="p-2 text-center">
                <div className="flex flex-col items-center gap-1">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: g.color }} />
                  <span className="text-[10px] font-medium text-[var(--color-text-secondary)] leading-tight">{g.name}</span>
                </div>
              </div>
            ))}

            {/* Rows */}
            {groups.map((src) => (
              <>
                <div key={`row-${src.id}`} className="flex items-center gap-2 px-2 py-2">
                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: src.color }} />
                  <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{src.name}</span>
                </div>
                {groups.map((dst) => {
                  const cell = matrix[src.id]?.[dst.id];
                  const isSelf = src.id === dst.id;
                  return (
                    <div
                      key={`${src.id}-${dst.id}`}
                      className={`flex items-center justify-center p-2 rounded border ${
                        cell
                          ? cell.action === 'allow'
                            ? 'bg-green-500/10 border-green-500/30'
                            : 'bg-red-500/10 border-red-500/30'
                          : 'bg-[var(--color-surface)] border-[var(--color-border-subtle)]'
                      }`}
                      title={cell ? `${cell.action.toUpperCase()} ${cell.protocol}/${cell.ports}` : 'No explicit policy'}
                    >
                      {isSelf ? (
                        <span className="text-[10px] text-[var(--color-text-muted)]">—</span>
                      ) : cell ? (
                        <div className="flex flex-col items-center gap-0.5">
                          {cell.action === 'allow' ? (
                            <ShieldCheck size={14} className="text-green-400" />
                          ) : (
                            <ShieldX size={14} className="text-red-400" />
                          )}
                          <span className="text-[9px] font-mono text-[var(--color-text-muted)]">{cell.ports}</span>
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--color-text-muted)] opacity-50">∅</span>
                      )}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>

        {/* Legend */}
        <div className="mt-6 flex flex-wrap items-center gap-4 text-xs text-[var(--color-text-muted)]">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={14} className="text-green-400" />
            <span>Allow</span>
          </div>
          <div className="flex items-center gap-1.5">
            <ShieldX size={14} className="text-red-400" />
            <span>Deny</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Lock size={14} className="text-[var(--color-accent-purple)]" />
            <span>TLS Decrypt</span>
          </div>
          <div className="flex items-center gap-1.5">
            <Globe size={14} className="text-[var(--color-accent-amber)]" />
            <span>Geo / Threat</span>
          </div>
        </div>
      </div>
    </div>
  );
}

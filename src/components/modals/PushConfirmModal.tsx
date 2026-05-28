import { useEffect, useState } from 'react';
import { X, Send, CheckCircle, AlertTriangle, Loader2, Info, ArrowRight, Minus } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel } from '../../types/dcf';
import type { AviatrixConnectionAPI } from '../../lib/aviatrix/types';
import type { PushResult } from '../../../api/aviatrix/push-topology';
import { mapTopology } from '../../lib/aviatrix/mapTopology';

interface PushConfirmModalProps {
  topology: DcfPolicyModel;
  connection: AviatrixConnectionAPI;
  onClose: () => void;
}

type Phase = 'loading' | 'diff' | 'pushing' | 'done';

interface FieldChange {
  field: string;
  from: string;
  to: string;
}

interface PolicyDiff {
  policy: DcfPolicy;
  changes: FieldChange[];
}

// ---------------------------------------------------------------------------
// Diff helpers
// ---------------------------------------------------------------------------

function groupName(id: string, topology: DcfPolicyModel): string {
  return (
    topology.smartGroups.find((g) => g.id === id)?.name ??
    topology.webGroups.find((g) => g.id === id)?.name ??
    id
  );
}

function computeChanges(local: DcfPolicy, ctrl: DcfPolicy, topo: DcfPolicyModel): FieldChange[] {
  const changes: FieldChange[] = [];
  const gn = (id: string) => groupName(id, topo);

  if (local.name !== ctrl.name)
    changes.push({ field: 'name', from: ctrl.name, to: local.name });
  if (local.priority !== ctrl.priority)
    changes.push({ field: 'priority', from: String(ctrl.priority), to: String(local.priority) });
  if (local.action !== ctrl.action)
    changes.push({ field: 'action', from: ctrl.action, to: local.action });
  if (local.protocol !== ctrl.protocol)
    changes.push({ field: 'protocol', from: ctrl.protocol, to: local.protocol });
  if ((local.ports ?? '') !== (ctrl.ports ?? ''))
    changes.push({ field: 'ports', from: ctrl.ports ?? 'any', to: local.ports ?? 'any' });
  if (local.srcGroupId !== ctrl.srcGroupId)
    changes.push({ field: 'src', from: gn(ctrl.srcGroupId), to: gn(local.srcGroupId) });
  if (local.dstGroupId !== ctrl.dstGroupId)
    changes.push({ field: 'dst', from: gn(ctrl.dstGroupId), to: gn(local.dstGroupId) });
  if (!!local.decrypt !== !!ctrl.decrypt)
    changes.push({ field: 'decrypt', from: ctrl.decrypt ? 'on' : 'off', to: local.decrypt ? 'on' : 'off' });
  if (local.logging !== ctrl.logging)
    changes.push({ field: 'logging', from: String(ctrl.logging), to: String(local.logging) });

  return changes;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PushConfirmModal({ topology, connection, onClose }: PushConfirmModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [diffs, setDiffs] = useState<PolicyDiff[]>([]);
  const [unchangedCount, setUnchangedCount] = useState(0);
  const [skippedCount, setSkippedCount] = useState(0);
  const [result, setResult] = useState<PushResult | null>(null);

  // Fetch current controller state on open and compute diff
  useEffect(() => {
    let cancelled = false;

    fetch('/api/aviatrix/topology-api', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        controllerBaseUrl: connection.controllerBaseUrl,
        username: connection.username,
        password: connection.password,
      }),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`Controller returned HTTP ${r.status}`);
        return r.json() as Promise<{ raw: Parameters<typeof mapTopology>[0] }>;
      })
      .then(({ raw }) => {
        if (cancelled) return;
        const { topology: ctrlTopology } = mapTopology(raw);
        const ctrlById = new Map(ctrlTopology.policies.map((p) => [p.id, p]));

        const pushable = topology.policies.filter((p) => p.policyListUuid);
        const changed: PolicyDiff[] = [];
        let unchanged = 0;

        for (const local of pushable) {
          const ctrl = ctrlById.get(local.id);
          if (!ctrl) { unchanged++; continue; } // on controller but not in map (e.g. new on ctrl) — skip
          const changes = computeChanges(local, ctrl, topology);
          if (changes.length > 0) changed.push({ policy: local, changes });
          else unchanged++;
        }

        setDiffs(changed);
        setUnchangedCount(unchanged);
        setSkippedCount(topology.policies.filter((p) => !p.policyListUuid).length);
        setPhase('diff');
      })
      .catch((e) => {
        if (cancelled) return;
        setFetchError(e instanceof Error ? e.message : 'Failed to fetch current controller state');
        setPhase('diff'); // still show the modal, just without a diff
      });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePush = async () => {
    setPhase('pushing');
    try {
      const resp = await fetch('/api/aviatrix/push-topology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controllerBaseUrl: connection.controllerBaseUrl,
          username: connection.username,
          password: connection.password,
          policies: topology.policies,
        }),
      });
      const data = await resp.json() as PushResult;
      setResult(data);
    } catch (e) {
      setResult({
        policyListsPushed: 0,
        policiesUpdated: 0,
        warnings: [],
        errors: [e instanceof Error ? e.message : 'Network error'],
        deployed: false,
      });
    }
    setPhase('done');
  };

  const hasChanges = diffs.length > 0;
  const pushSuccess = phase === 'done' && result && result.errors.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="relative w-full max-w-lg rounded-xl border shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)', maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <Send size={15} className="text-[var(--color-accent-blue)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Push to Controller</h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">

          {/* Controller target */}
          <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-muted)]">
            <Info size={11} className="shrink-0" />
            <span className="truncate">{connection.controllerBaseUrl} · {connection.username}</span>
          </div>

          {/* Loading phase */}
          {phase === 'loading' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 size={22} className="animate-spin text-[var(--color-accent-blue)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">Fetching current controller state…</p>
            </div>
          )}

          {/* Diff phase */}
          {phase === 'diff' && (
            <>
              {fetchError && (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">
                  <AlertTriangle size={13} className="shrink-0 mt-0.5" />
                  <span>Could not fetch controller state ({fetchError}) — diff unavailable. You can still push.</span>
                </div>
              )}

              {!fetchError && !hasChanges && (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">No changes detected</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    All {unchangedCount} {unchangedCount === 1 ? 'policy' : 'policies'} match the controller.
                  </p>
                </div>
              )}

              {hasChanges && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {diffs.length} {diffs.length === 1 ? 'policy' : 'policies'} changed
                    {unchangedCount > 0 && <span className="font-normal normal-case"> · {unchangedCount} unchanged</span>}
                    {skippedCount > 0 && <span className="font-normal normal-case"> · {skippedCount} local-only (skipped)</span>}
                  </p>

                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    {diffs.map((d, i) => (
                      <div
                        key={d.policy.id}
                        className="p-3 space-y-1.5"
                        style={{
                          borderBottom: i < diffs.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                          backgroundColor: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                        }}
                      >
                        <p className="text-xs font-semibold text-[var(--color-text-primary)]">{d.policy.name}</p>
                        <div className="space-y-0.5">
                          {d.changes.map((c) => (
                            <div key={c.field} className="flex items-center gap-1.5 text-[11px]">
                              <span className="text-[var(--color-text-muted)] w-14 shrink-0">{c.field}</span>
                              <span className="font-mono text-red-400 line-through">{c.from}</span>
                              <ArrowRight size={9} className="text-[var(--color-text-muted)] shrink-0" />
                              <span className="font-mono text-green-400">{c.to}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Pushing phase */}
          {phase === 'pushing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-3">
              <Loader2 size={22} className="animate-spin text-[var(--color-accent-blue)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">Pushing changes to controller…</p>
            </div>
          )}

          {/* Done phase */}
          {phase === 'done' && result && (
            <div className="space-y-3">
              {pushSuccess ? (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle size={15} className="text-green-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-medium text-green-400">Push successful</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {result.policiesUpdated} {result.policiesUpdated === 1 ? 'policy' : 'policies'} updated
                      across {result.policyListsPushed} PolicyList{result.policyListsPushed !== 1 ? 's' : ''}.
                      {result.deployed ? ' Deployed.' : ' Deploy step not confirmed.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle size={15} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-400">Push failed</p>
                    {result.errors.map((e, i) => (
                      <p key={i} className="text-xs text-[var(--color-text-muted)]">{e}</p>
                    ))}
                  </div>
                </div>
              )}

              {result.warnings.length > 0 && (
                <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-[10px] font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Warnings</p>
                  {result.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-1.5 text-xs text-[var(--color-text-secondary)]">
                      <Minus size={10} className="shrink-0 mt-0.5 text-[var(--color-text-muted)]" />
                      {w}
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 p-4 border-t shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs rounded-md border text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)] transition-colors"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            {phase === 'done' ? 'Close' : 'Cancel'}
          </button>
          {phase === 'diff' && (
            <button
              onClick={handlePush}
              disabled={!hasChanges && !fetchError}
              className="px-3 py-1.5 text-xs rounded-md font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: 'var(--color-accent-blue)' }}
            >
              {hasChanges
                ? `Push ${diffs.length} ${diffs.length === 1 ? 'change' : 'changes'}`
                : fetchError ? 'Push anyway' : 'Nothing to push'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

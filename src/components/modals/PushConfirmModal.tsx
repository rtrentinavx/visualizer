import { useMemo, useState } from 'react';
import { X, CloudUpload, CheckCircle, AlertTriangle, Loader2, Info } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import type { AviatrixConnectionAPI } from '../../lib/aviatrix/types';
import type { PushResult } from '../../../api/aviatrix/push-topology';

interface PushConfirmModalProps {
  topology: DcfPolicyModel;
  connection: AviatrixConnectionAPI;
  onClose: () => void;
}

type Phase = 'preview' | 'pushing' | 'done';

export default function PushConfirmModal({ topology, connection, onClose }: PushConfirmModalProps) {
  const [phase, setPhase] = useState<Phase>('preview');
  const [result, setResult] = useState<PushResult | null>(null);

  const pushable = useMemo(() => {
    const policies = topology.policies.filter((p) => p.policyListUuid);
    const policyLists = new Set(policies.map((p) => p.policyListUuid!));
    return { policies, policyListCount: policyLists.size };
  }, [topology.policies]);

  const canPush = pushable.policies.length > 0;

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

  const allErrors = result?.errors ?? [];
  const allWarnings = result?.warnings ?? [];
  const success = phase === 'done' && allErrors.length === 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div
        className="relative w-full max-w-md rounded-xl border shadow-2xl flex flex-col"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)', maxHeight: '80vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b shrink-0" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <div className="flex items-center gap-2">
            <CloudUpload size={16} className="text-[var(--color-accent-blue)]" />
            <h2 className="text-sm font-semibold text-[var(--color-text-primary)]">Push to Controller</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
          >
            <X size={14} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">

          {/* Controller target */}
          <div className="flex items-center gap-2 text-xs text-[var(--color-text-muted)]">
            <Info size={12} />
            <span className="truncate">
              {connection.controllerBaseUrl} · {connection.username}
            </span>
          </div>

          {phase === 'preview' && (
            <>
              {canPush ? (
                <div className="rounded-lg border p-3 space-y-2" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">
                    {pushable.policies.length} {pushable.policies.length === 1 ? 'policy' : 'policies'} across{' '}
                    {pushable.policyListCount} PolicyList{pushable.policyListCount !== 1 ? 's' : ''} will be synchronized.
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)]">
                    Only policies originally imported from this controller are eligible. Locally-created policies and
                    policies with multiple source/destination groups are skipped.
                  </p>
                </div>
              ) : (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-sm text-[var(--color-text-secondary)]">
                    No pushable policies found. Import from a live controller first — only policies with a controller
                    origin can be pushed back.
                  </p>
                </div>
              )}
            </>
          )}

          {phase === 'pushing' && (
            <div className="flex flex-col items-center justify-center py-8 gap-3">
              <Loader2 size={24} className="animate-spin text-[var(--color-accent-blue)]" />
              <p className="text-sm text-[var(--color-text-secondary)]">Pushing to controller…</p>
            </div>
          )}

          {phase === 'done' && result && (
            <div className="space-y-3">
              {success ? (
                <div className="flex items-center gap-2 p-3 rounded-lg bg-green-500/10 border border-green-500/20">
                  <CheckCircle size={16} className="text-green-400 shrink-0" />
                  <div>
                    <p className="text-sm font-medium text-green-400">Push successful</p>
                    <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                      {result.policiesUpdated} {result.policiesUpdated === 1 ? 'policy' : 'policies'} updated across{' '}
                      {result.policyListsPushed} PolicyList{result.policyListsPushed !== 1 ? 's' : ''}.
                      {result.deployed ? ' Deployed.' : ' Deploy not confirmed.'}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20">
                  <AlertTriangle size={16} className="text-red-400 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium text-red-400">Push failed</p>
                    {allErrors.map((e, i) => (
                      <p key={i} className="text-xs text-[var(--color-text-muted)]">{e}</p>
                    ))}
                  </div>
                </div>
              )}

              {allWarnings.length > 0 && (
                <div className="rounded-lg border p-3 space-y-1" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">Warnings</p>
                  {allWarnings.map((w, i) => (
                    <p key={i} className="text-xs text-[var(--color-text-secondary)]">{w}</p>
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
          {phase === 'preview' && (
            <button
              onClick={handlePush}
              disabled={!canPush}
              className="px-3 py-1.5 text-xs rounded-md font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: 'var(--color-accent-blue)' }}
            >
              Push to controller
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

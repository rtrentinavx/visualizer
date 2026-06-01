import { useEffect, useState } from 'react';
import { X, Send, CheckCircle, AlertTriangle, Loader2, Info, ArrowRight, Minus, Plus, Edit3, Trash2 } from 'lucide-react';
import type { DcfPolicy, DcfPolicyModel, SmartGroup } from '../../types/dcf';
import type { AviatrixConnectionAPI } from '../../lib/aviatrix/types';
import type { PushResult } from '../../../api/aviatrix/push-topology';
import { mapTopology } from '../../lib/aviatrix/mapTopology';

interface PushConfirmModalProps {
  topology: DcfPolicyModel;
  connection: AviatrixConnectionAPI;
  onClose: () => void;
  onPushed?: (newTopology: DcfPolicyModel) => void;
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
  willSkip?: string;
}

interface SmartGroupDiff {
  group: SmartGroup;
  nameChanged: boolean;
  criteriaChanged: boolean;
}

interface PolicyListMeta {
  uuid: string;
  name: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isControllerUuid(id: string): boolean { return UUID_RE.test(id); }

function serializeCriteria(sg: SmartGroup): string {
  return JSON.stringify(
    [...sg.criteria].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)))
  );
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
  if (JSON.stringify(local.srcGroupId) !== JSON.stringify(ctrl.srcGroupId))
    changes.push({ field: 'src', from: ctrl.srcGroupId.map(gn).join(', '), to: local.srcGroupId.map(gn).join(', ') });
  if (JSON.stringify(local.dstGroupId) !== JSON.stringify(ctrl.dstGroupId))
    changes.push({ field: 'dst', from: ctrl.dstGroupId.map(gn).join(', '), to: local.dstGroupId.map(gn).join(', ') });
  if (!!local.decrypt !== !!ctrl.decrypt)
    changes.push({ field: 'decrypt', from: ctrl.decrypt ? 'on' : 'off', to: local.decrypt ? 'on' : 'off' });
  if (local.logging !== ctrl.logging)
    changes.push({ field: 'logging', from: String(ctrl.logging), to: String(local.logging) });

  return changes;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PushConfirmModal({ topology, connection, onClose, onPushed }: PushConfirmModalProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [fetchError, setFetchError] = useState<string | null>(null);

  // Policy diff state
  const [diffs, setDiffs] = useState<PolicyDiff[]>([]);
  const [unchangedCount, setUnchangedCount] = useState(0);
  const [newPolicies, setNewPolicies] = useState<DcfPolicy[]>([]);
  const [policyLists, setPolicyLists] = useState<PolicyListMeta[]>([]);
  const [targetPolicyListUuid, setTargetPolicyListUuid] = useState<string>('');

  // SmartGroup diff state
  const [changedGroups, setChangedGroups] = useState<SmartGroupDiff[]>([]);
  const [newGroups, setNewGroups] = useState<SmartGroup[]>([]);
  const [deletedGroups, setDeletedGroups] = useState<SmartGroup[]>([]);
  const [ctrlGroupCount, setCtrlGroupCount] = useState(0);

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
        return r.json() as Promise<{ raw: Parameters<typeof mapTopology>[0]; policyLists?: PolicyListMeta[] }>;
      })
      .then(({ raw, policyLists: pl }) => {
        if (cancelled) return;
        const { topology: ctrlTopology } = mapTopology(raw);

        // --- Policy diff ---
        const ctrlById = new Map(ctrlTopology.policies.map((p) => [p.id, p]));
        const pushable = topology.policies.filter((p) => p.policyListUuid);
        const localOnly = topology.policies.filter((p) => !p.policyListUuid);
        const changed: PolicyDiff[] = [];
        let unchanged = 0;

        for (const local of pushable) {
          const ctrl = ctrlById.get(local.id);
          if (!ctrl) { unchanged++; continue; }
          const changes = computeChanges(local, ctrl, topology);
          if (changes.length > 0) {
            const willSkip = local.protocol === 'any' ? "protocol 'any' cannot be written to this controller version" : undefined;
            changed.push({ policy: local, changes, willSkip });
          } else {
            unchanged++;
          }
        }

        // --- SmartGroup diff ---
        const ctrlSgById = new Map(ctrlTopology.smartGroups.map((g) => [g.id, g]));
        const changedSgs: SmartGroupDiff[] = [];
        const newSgs: SmartGroup[] = [];

        for (const local of topology.smartGroups) {
          if (local.id === 'sg-any' || local.id === 'sg-internet') continue;
          if (!isControllerUuid(local.id)) {
            newSgs.push(local);
            continue;
          }
          const ctrl = ctrlSgById.get(local.id);
          if (!ctrl) continue; // UUID not on controller — skip
          const nameChanged = local.name !== ctrl.name;
          const criteriaChanged = serializeCriteria(local) !== serializeCriteria(ctrl);
          if (nameChanged || criteriaChanged) changedSgs.push({ group: local, nameChanged, criteriaChanged });
        }

        // --- Deleted SmartGroups: on controller but missing locally ---
        const localSgIds = new Set(topology.smartGroups.map((g) => g.id));
        const deletedSgs = ctrlTopology.smartGroups.filter(
          (g) => isControllerUuid(g.id) && !localSgIds.has(g.id)
        );

        const lists = pl ?? [];
        setDiffs(changed);
        setUnchangedCount(unchanged);
        setNewPolicies(localOnly);
        setPolicyLists(lists);
        if (lists.length > 0) setTargetPolicyListUuid(lists[0]!.uuid);
        setChangedGroups(changedSgs);
        setNewGroups(newSgs);
        setDeletedGroups(deletedSgs);
        setCtrlGroupCount(ctrlTopology.smartGroups.filter((g) => isControllerUuid(g.id)).length);
        setPhase('diff');
      })
      .catch((e) => {
        if (cancelled) return;
        setFetchError(e instanceof Error ? e.message : 'Failed to fetch current controller state');
        setPhase('diff');
      });

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePush = async () => {
    setPhase('pushing');
    let pushData: PushResult;
    const hasNew = newPolicies.length > 0 && !!targetPolicyListUuid;
    const sgsToPush = [...changedGroups.map((d) => d.group), ...newGroups];
    const sgUuidsToDelete = deletedGroups.map((g) => g.id);
    try {
      const resp = await fetch('/api/aviatrix/push-topology', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controllerBaseUrl: connection.controllerBaseUrl,
          username: connection.username,
          password: connection.password,
          policies: topology.policies,
          ...(hasNew ? { newPolicies, targetPolicyListUuid } : {}),
          ...(sgsToPush.length > 0 ? { smartGroups: sgsToPush } : {}),
          ...(sgUuidsToDelete.length > 0 ? { smartGroupsToDelete: sgUuidsToDelete } : {}),
        }),
      });
      pushData = await resp.json() as PushResult;
    } catch (e) {
      pushData = {
        policyListsPushed: 0,
        policiesUpdated: 0,
        smartGroupsUpdated: 0,
        smartGroupsCreated: 0,
        smartGroupsDeleted: 0,
        warnings: [],
        errors: [e instanceof Error ? e.message : 'Network error'],
        deployed: false,
      };
    }
    setResult(pushData);
    setPhase('done');

    // Re-sync: if push was successful, re-fetch from controller and replace local topology
    if (pushData.errors.length === 0 &&
        (pushData.policyListsPushed > 0 || pushData.smartGroupsUpdated > 0 || pushData.smartGroupsCreated > 0 || pushData.smartGroupsDeleted > 0) &&
        onPushed) {
      try {
        const r = await fetch('/api/aviatrix/topology-api', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            controllerBaseUrl: connection.controllerBaseUrl,
            username: connection.username,
            password: connection.password,
          }),
        });
        if (r.ok) {
          const { raw } = await r.json() as { raw: Parameters<typeof mapTopology>[0] };
          const { topology: freshTopology } = mapTopology(raw);
          onPushed(freshTopology);
        }
      } catch { /* re-sync is best-effort; push already succeeded */ }
    }
  };

  const hasChanges = diffs.length > 0;
  const hasNew = newPolicies.length > 0;
  const hasSgChanges = changedGroups.length > 0 || newGroups.length > 0 || deletedGroups.length > 0;
  const canPush = hasChanges || hasNew || hasSgChanges || !!fetchError;
  const pushSuccess = phase === 'done' && result && result.errors.length === 0;

  const totalChanges = diffs.length + newPolicies.length + changedGroups.length + newGroups.length + deletedGroups.length;

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

              {!fetchError && !hasChanges && !hasNew && !hasSgChanges && (
                <div className="rounded-lg border p-3" style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-surface)' }}>
                  <p className="text-sm font-medium text-[var(--color-text-primary)]">No changes detected</p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-1">
                    All {unchangedCount} {unchangedCount === 1 ? 'policy' : 'policies'} match the controller.
                  </p>
                  <p className="text-xs text-[var(--color-text-muted)] mt-0.5 font-mono">
                    Controller: {ctrlGroupCount} groups · Local: {topology.smartGroups.filter((g) => isControllerUuid(g.id)).length} groups
                  </p>
                </div>
              )}

              {/* Modified policies diff */}
              {hasChanges && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {diffs.length} {diffs.length === 1 ? 'policy' : 'policies'} changed
                    {unchangedCount > 0 && <span className="font-normal normal-case"> · {unchangedCount} unchanged</span>}
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
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-semibold text-[var(--color-text-primary)]">{d.policy.name}</p>
                          {d.willSkip && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 shrink-0">will skip</span>
                          )}
                        </div>
                        {d.willSkip && (
                          <p className="text-[10px] text-amber-400/80">{d.willSkip}</p>
                        )}
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

              {/* New (local-only) policies */}
              {hasNew && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    {newPolicies.length} new {newPolicies.length === 1 ? 'policy' : 'policies'}
                  </p>

                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    {newPolicies.map((p, i) => (
                      <div
                        key={p.id}
                        className="px-3 py-2 flex items-center gap-1.5"
                        style={{
                          borderBottom: i < newPolicies.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                          backgroundColor: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                        }}
                      >
                        <Plus size={10} className="text-green-400 shrink-0" />
                        <span className="text-xs text-[var(--color-text-primary)]">{p.name}</span>
                        {p.protocol === 'any' && (
                          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 border border-amber-500/20 shrink-0">will skip</span>
                        )}
                      </div>
                    ))}
                  </div>

                  {policyLists.length > 0 ? (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-[var(--color-text-muted)] shrink-0">Add to PolicyList:</span>
                      <select
                        value={targetPolicyListUuid}
                        onChange={(e) => setTargetPolicyListUuid(e.target.value)}
                        className="flex-1 text-xs rounded-md border px-2 py-1 min-w-0"
                        style={{
                          backgroundColor: 'var(--color-surface)',
                          borderColor: 'var(--color-border-subtle)',
                          color: 'var(--color-text-primary)',
                        }}
                      >
                        {policyLists.map((pl) => (
                          <option key={pl.uuid} value={pl.uuid}>{pl.name}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-400">
                      No PolicyLists found on controller — new policies cannot be pushed (import topology first).
                    </p>
                  )}
                </div>
              )}

              {/* SmartGroup changes */}
              {(changedGroups.length > 0 || newGroups.length > 0 || deletedGroups.length > 0) && (
                <div className="space-y-2">
                  <p className="text-xs font-semibold text-[var(--color-text-muted)] uppercase tracking-wider">
                    SmartGroups
                    {changedGroups.length > 0 && <span className="font-normal normal-case"> · {changedGroups.length} changed</span>}
                    {newGroups.length > 0 && <span className="font-normal normal-case"> · {newGroups.length} new</span>}
                    {deletedGroups.length > 0 && <span className="font-normal normal-case text-red-400"> · {deletedGroups.length} to delete</span>}
                  </p>

                  <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    {changedGroups.map((d, i) => (
                      <div
                        key={d.group.id}
                        className="px-3 py-2 flex items-center gap-1.5"
                        style={{
                          borderBottom: (i < changedGroups.length - 1 || newGroups.length > 0 || deletedGroups.length > 0) ? '1px solid var(--color-border-subtle)' : undefined,
                          backgroundColor: i % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                        }}
                      >
                        <Edit3 size={10} className="text-blue-400 shrink-0" />
                        <span className="text-xs text-[var(--color-text-primary)]">{d.group.name}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">
                          {[d.nameChanged && 'name', d.criteriaChanged && 'criteria'].filter(Boolean).join(', ')}
                        </span>
                      </div>
                    ))}
                    {newGroups.map((g, i) => (
                      <div
                        key={g.id}
                        className="px-3 py-2 flex items-center gap-1.5"
                        style={{
                          borderBottom: (i < newGroups.length - 1 || deletedGroups.length > 0) ? '1px solid var(--color-border-subtle)' : undefined,
                          backgroundColor: (changedGroups.length + i) % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                        }}
                      >
                        <Plus size={10} className="text-green-400 shrink-0" />
                        <span className="text-xs text-[var(--color-text-primary)]">{g.name}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{g.criteria.length} criteria</span>
                      </div>
                    ))}
                    {deletedGroups.map((g, i) => (
                      <div
                        key={g.id}
                        className="px-3 py-2 flex items-center gap-1.5"
                        style={{
                          borderBottom: i < deletedGroups.length - 1 ? '1px solid var(--color-border-subtle)' : undefined,
                          backgroundColor: (changedGroups.length + newGroups.length + i) % 2 === 0 ? 'var(--color-surface)' : 'var(--color-surface-raised)',
                        }}
                      >
                        <Trash2 size={10} className="text-red-400 shrink-0" />
                        <span className="text-xs text-red-400/80 line-through">{g.name}</span>
                        <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">delete</span>
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
                      {result.policiesUpdated > 0 && `${result.policiesUpdated} ${result.policiesUpdated === 1 ? 'policy' : 'policies'} updated across ${result.policyListsPushed} PolicyList${result.policyListsPushed !== 1 ? 's' : ''}. `}
                      {result.smartGroupsUpdated > 0 && `${result.smartGroupsUpdated} SmartGroup${result.smartGroupsUpdated !== 1 ? 's' : ''} updated. `}
                      {result.smartGroupsCreated > 0 && `${result.smartGroupsCreated} SmartGroup${result.smartGroupsCreated !== 1 ? 's' : ''} created. `}
                      {result.smartGroupsDeleted > 0 && `${result.smartGroupsDeleted} SmartGroup${result.smartGroupsDeleted !== 1 ? 's' : ''} deleted. `}
                      {result.deployed ? 'Deployed.' : 'Deploy step not confirmed.'}
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
              disabled={!canPush}
              className="px-3 py-1.5 text-xs rounded-md font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              style={{ backgroundColor: 'var(--color-accent-blue)' }}
            >
              {totalChanges > 0
                ? `Push ${totalChanges} ${totalChanges === 1 ? 'change' : 'changes'}`
                : fetchError ? 'Push anyway' : 'Nothing to push'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

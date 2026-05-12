import { useState, useMemo, useRef, useEffect } from 'react';
import {
  FlaskConical, ShieldCheck, ShieldX, ShieldAlert, Ban, ChevronDown, ChevronRight, Network, Globe,
  ArrowRightLeft, CheckCircle2, XCircle, Activity, Plus, Trash2, Pencil, Upload, Download,
  AlertTriangle, X, Search,
} from 'lucide-react';
import type { DcfPolicyModel, Protocol, TrafficFlow, PolicyDirection, SmartGroup, WebGroup } from '../../types/dcf';
import { simulateTraffic } from '../../lib/policySimulator';
import type { SimulationRequest, SimulationResult } from '../../lib/policySimulator';
import { isValidIPv4, isValidCidr } from '../../lib/ipUtils';
import {
  downloadFlowsJSON, downloadFlowsCSV, importFlowsJSON, importFlowsCSV,
} from '../../lib/importExport';

// Endpoint: what the user typed/picked for Source or Destination. The simulator
// resolves text → IP/CIDR, or uses a directly-picked group as-is.
type Endpoint =
  | { kind: 'text'; value: string }
  | { kind: 'smartGroup'; id: string }
  | { kind: 'webGroup'; id: string };

function endpointReady(ep: Endpoint): boolean {
  if (ep.kind === 'smartGroup' || ep.kind === 'webGroup') return true;
  return isValidIPv4(ep.value) || isValidCidr(ep.value);
}

function endpointKindError(ep: Endpoint): boolean {
  return ep.kind === 'text' && ep.value !== '' && !isValidIPv4(ep.value) && !isValidCidr(ep.value);
}

function endpointToRequest(ep: Endpoint, side: 'src' | 'dst'): Partial<SimulationRequest> {
  if (ep.kind === 'smartGroup') return side === 'src' ? { srcGroupId: ep.id } : { dstGroupId: ep.id };
  if (ep.kind === 'webGroup') return { dstWebGroupId: ep.id };
  if (isValidIPv4(ep.value)) return side === 'src' ? { srcIp: ep.value } : { dstIp: ep.value };
  if (isValidCidr(ep.value)) return side === 'src' ? { srcCidr: ep.value } : { dstCidr: ep.value };
  return {};
}

interface TrafficSimulatorProps {
  topology: DcfPolicyModel;
  onCreateFlow: (flow: Omit<TrafficFlow, 'id'>) => void;
  onUpdateFlow: (id: string, flow: Partial<TrafficFlow>) => void;
  onDeleteFlow: (id: string) => void;
}

const actionConfig = {
  allow: { icon: ShieldCheck, color: '#22c55e', label: 'ALLOWED' },
  learned: { icon: ShieldAlert, color: '#8b5cf6', label: 'LEARNED' },
  deny: { icon: ShieldX, color: '#ef4444', label: 'DENIED' },
  'implicit-deny': { icon: Ban, color: '#9ca3af', label: 'IMPLICIT DENY' },
};

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatTimestamp(ts: string): string {
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

const emptyManualForm = {
  srcGroupId: '',
  dstGroupId: '',
  protocol: 'tcp' as Protocol,
  port: '',
  bytes: '',
  packets: '',
  allowed: true,
  direction: 'any' as PolicyDirection,
  timestamp: new Date().toISOString().slice(0, 16),
};

export default function TrafficSimulator({
  topology,
  onCreateFlow,
  onUpdateFlow,
  onDeleteFlow,
}: TrafficSimulatorProps) {
  // Simulator form. Source / destination are unified Endpoint values: free
  // text (auto-detected as IP or CIDR) OR a direct SmartGroup / WebGroup pick.
  const [srcEndpoint, setSrcEndpoint] = useState<Endpoint>({ kind: 'text', value: '' });
  const [dstEndpoint, setDstEndpoint] = useState<Endpoint>({ kind: 'text', value: '' });
  const [protocol, setProtocol] = useState<Protocol>('tcp');
  const [port, setPort] = useState('443');
  const [dstFqdn, setDstFqdn] = useState('');
  const [srcThreatGroupId, setSrcThreatGroupId] = useState('');
  const [dstThreatGroupId, setDstThreatGroupId] = useState('');
  const [srcGeoGroupId, setSrcGeoGroupId] = useState('');
  const [dstGeoGroupId, setDstGeoGroupId] = useState('');
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [justSavedFlowId, setJustSavedFlowId] = useState<string | null>(null);

  // Saved flows list
  const [filter, setFilter] = useState('');
  const [importMode, setImportMode] = useState(false);
  const [importText, setImportText] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [manualForm, setManualForm] = useState({ ...emptyManualForm });

  const smartGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of topology.smartGroups) map.set(g.id, g.name);
    return map;
  }, [topology.smartGroups]);

  const smartGroupOptions = topology.smartGroups.filter((g) => g.id !== 'sg-internet');

  const canRun = endpointReady(srcEndpoint) && endpointReady(dstEndpoint) && port !== '';

  const runSimulation = () => {
    if (!canRun) return;
    const portNum = parseInt(port, 10) || 0;
    const res = simulateTraffic(topology, {
      ...endpointToRequest(srcEndpoint, 'src'),
      ...endpointToRequest(dstEndpoint, 'dst'),
      protocol,
      port: portNum,
      dstFqdn: dstFqdn.trim() || undefined,
      srcThreatGroupId: srcThreatGroupId || undefined,
      dstThreatGroupId: dstThreatGroupId || undefined,
      srcGeoGroupId: srcGeoGroupId || undefined,
      dstGeoGroupId: dstGeoGroupId || undefined,
    });
    setResult(res);
    persistResultAsFlow(res, portNum);
  };

  /**
   * Auto-save the simulation result to topology.flows. Dedup rule: if a flow
   * with the same src/dst/protocol/port AND same outcome already exists, bump
   * its timestamp instead of adding a duplicate row. If the outcome flipped
   * (e.g. user edited a policy and re-ran the same test), append a new row so
   * the change is visible in the log.
   */
  const persistResultAsFlow = (res: SimulationResult, portNum: number) => {
    const srcGroupId = srcEndpoint.kind === 'smartGroup'
      ? srcEndpoint.id
      : (res.srcGroups[0] || 'sg-any');
    const dstGroupId = dstEndpoint.kind === 'smartGroup'
      ? dstEndpoint.id
      : dstEndpoint.kind === 'webGroup'
        ? 'sg-internet'
        : (res.dstGroups[0] || 'sg-any');
    const allowed = res.action === 'allow' || res.action === 'learned';
    const timestamp = new Date().toISOString();

    const existing = topology.flows.find((f) =>
      f.srcGroupId === srcGroupId &&
      f.dstGroupId === dstGroupId &&
      f.protocol === protocol &&
      f.port === portNum &&
      f.allowed === allowed
    );

    if (existing) {
      onUpdateFlow(existing.id, { timestamp });
    } else {
      onCreateFlow({
        srcGroupId,
        dstGroupId,
        protocol,
        port: portNum,
        bytes: 0,
        packets: 0,
        allowed,
        direction: 'any',
        timestamp,
      });
    }

    setJustSavedFlowId('saved');
    setTimeout(() => setJustSavedFlowId(null), 1500);
  };

  const hasAdvancedOverrides =
    dstFqdn.trim() !== '' || srcThreatGroupId !== '' || dstThreatGroupId !== '' || srcGeoGroupId !== '' || dstGeoGroupId !== '';

  // Saved flows
  const f = filter.toLowerCase();
  const filteredFlows = topology.flows.filter((flow) => {
    if (!f) return true;
    const srcGroup = topology.smartGroups.find((g) => g.id === flow.srcGroupId);
    const dstGroup = topology.smartGroups.find((g) => g.id === flow.dstGroupId);
    return (
      srcGroup?.name.toLowerCase().includes(f) ||
      dstGroup?.name.toLowerCase().includes(f) ||
      flow.protocol.toLowerCase().includes(f) ||
      String(flow.port).includes(f)
    );
  });

  const allowedCount = filteredFlows.filter((x) => x.allowed).length;
  const deniedCount = filteredFlows.filter((x) => !x.allowed).length;

  const startEditManual = (flow: TrafficFlow) => {
    setEditingId(flow.id);
    setManualForm({
      srcGroupId: flow.srcGroupId,
      dstGroupId: flow.dstGroupId,
      protocol: flow.protocol,
      port: String(flow.port),
      bytes: String(flow.bytes),
      packets: String(flow.packets),
      allowed: flow.allowed,
      direction: flow.direction || 'any',
      timestamp: flow.timestamp.slice(0, 16),
    });
    setManualOpen(true);
  };

  const cancelManual = () => {
    setManualOpen(false);
    setEditingId(null);
    setManualForm({ ...emptyManualForm });
  };

  const submitManual = () => {
    if (!manualForm.srcGroupId || !manualForm.dstGroupId) return;
    const payload = {
      srcGroupId: manualForm.srcGroupId,
      dstGroupId: manualForm.dstGroupId,
      protocol: manualForm.protocol,
      port: Number(manualForm.port) || 0,
      bytes: Number(manualForm.bytes) || 0,
      packets: Number(manualForm.packets) || 0,
      allowed: manualForm.allowed,
      direction: manualForm.direction,
      timestamp: new Date(manualForm.timestamp).toISOString(),
    };
    if (editingId) onUpdateFlow(editingId, payload);
    else onCreateFlow(payload);
    cancelManual();
  };

  const handleImport = () => {
    setImportError(null);
    if (!importText.trim()) return;
    try {
      const flows: TrafficFlow[] = importText.trim().startsWith('[')
        ? importFlowsJSON(importText.trim())
        : importFlowsCSV(importText.trim());
      for (const flow of flows) onCreateFlow(flow);
      setImportText('');
      setImportMode(false);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Import failed');
    }
  };

  const updateManual = <K extends keyof typeof manualForm>(key: K, value: typeof manualForm[K]) => {
    setManualForm((prev) => ({ ...prev, [key]: value }));
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical size={18} className="text-[var(--color-accent-blue)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Traffic Simulator</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Test a hypothetical flow — results are auto-saved to the flow log for impact analysis.</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-3xl mx-auto space-y-6">

          {/* ============= Simulator Form ============= */}
          <div
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Source" hint="Type an IP or CIDR, or pick a SmartGroup.">
                <EndpointCombobox
                  topology={topology}
                  value={srcEndpoint}
                  onChange={setSrcEndpoint}
                  placeholder="10.0.1.5 or 10.0.0.0/16"
                  allowWebGroup={false}
                />
              </Field>

              <Field label="Destination" hint="Type an IP or CIDR, or pick a SmartGroup / WebGroup.">
                <EndpointCombobox
                  topology={topology}
                  value={dstEndpoint}
                  onChange={setDstEndpoint}
                  placeholder="10.0.2.10 or 10.0.0.0/16"
                  allowWebGroup={true}
                />
              </Field>

              <Field label="Protocol">
                <SelectChevron>
                  <select
                    value={protocol}
                    onChange={(e) => setProtocol(e.target.value as Protocol)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  >
                    <option value="tcp">TCP</option>
                    <option value="udp">UDP</option>
                    <option value="icmp">ICMP</option>
                    <option value="any">Any</option>
                  </select>
                </SelectChevron>
              </Field>

              <Field label="Port">
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="443"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                />
              </Field>
            </div>

            <div className="border-t border-[var(--color-border-subtle)] pt-3">
              <button
                type="button"
                onClick={() => setAdvancedOpen((v) => !v)}
                className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
              >
                {advancedOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                Advanced overrides
                {hasAdvancedOverrides && !advancedOpen && (
                  <span className="ml-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-[var(--color-accent-blue)]/15 text-[var(--color-accent-blue)]">active</span>
                )}
              </button>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-1">
                Tell the simulator what the IPs and FQDN <em>should be treated as</em> — needed for matching policies that attach WebGroups, ThreatGroups, or GeoGroups.
              </p>

              {advancedOpen && (
                <div className="mt-2 space-y-2">
                  <Field label="Destination FQDN" hint="Glob-matched against each WebGroup (e.g. *.salesforce.com).">
                    <input
                      type="text"
                      value={dstFqdn}
                      onChange={(e) => setDstFqdn(e.target.value)}
                      placeholder="login.salesforce.com"
                      className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </Field>

                  <div className="grid grid-cols-2 gap-2">
                    <Field label="Src ThreatGroup">
                      <SelectChevron>
                        <select
                          value={srcThreatGroupId}
                          onChange={(e) => setSrcThreatGroupId(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                          style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                        >
                          <option value="">— None —</option>
                          {topology.threatGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} ({g.category})</option>
                          ))}
                        </select>
                      </SelectChevron>
                    </Field>
                    <Field label="Dst ThreatGroup">
                      <SelectChevron>
                        <select
                          value={dstThreatGroupId}
                          onChange={(e) => setDstThreatGroupId(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                          style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                        >
                          <option value="">— None —</option>
                          {topology.threatGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} ({g.category})</option>
                          ))}
                        </select>
                      </SelectChevron>
                    </Field>
                    <Field label="Src GeoGroup">
                      <SelectChevron>
                        <select
                          value={srcGeoGroupId}
                          onChange={(e) => setSrcGeoGroupId(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                          style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                        >
                          <option value="">— None —</option>
                          {topology.geoGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} ({g.countries.slice(0, 3).join(', ')}{g.countries.length > 3 ? '…' : ''})</option>
                          ))}
                        </select>
                      </SelectChevron>
                    </Field>
                    <Field label="Dst GeoGroup">
                      <SelectChevron>
                        <select
                          value={dstGeoGroupId}
                          onChange={(e) => setDstGeoGroupId(e.target.value)}
                          className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                          style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                        >
                          <option value="">— None —</option>
                          {topology.geoGroups.map((g) => (
                            <option key={g.id} value={g.id}>{g.name} ({g.countries.slice(0, 3).join(', ')}{g.countries.length > 3 ? '…' : ''})</option>
                          ))}
                        </select>
                      </SelectChevron>
                    </Field>
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={runSimulation}
              disabled={!canRun}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <FlaskConical size={13} />
              Run Simulation
            </button>
          </div>

          {/* ============= Result ============= */}
          {result && (
            <div
              className="p-4 rounded-xl border space-y-3"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
            >
              <div
                className="flex items-center justify-between gap-3 p-3 rounded-lg"
                style={{ backgroundColor: `${actionConfig[result.action].color}15`, border: `1px solid ${actionConfig[result.action].color}40` }}
              >
                <div className="flex items-center gap-3">
                  {(() => {
                    const Icon = actionConfig[result.action].icon;
                    return <Icon size={20} style={{ color: actionConfig[result.action].color }} />;
                  })()}
                  <p className="text-sm font-semibold" style={{ color: actionConfig[result.action].color }}>
                    {actionConfig[result.action].label}
                  </p>
                </div>
                {justSavedFlowId && (
                  <span
                    className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium"
                    style={{ backgroundColor: 'var(--color-surface-elevated)', color: 'var(--color-text-muted)' }}
                    title="Auto-saved to the flow log below."
                  >
                    <CheckCircle2 size={11} /> Saved to flows
                  </span>
                )}
              </div>

              <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                {result.explanation}
              </div>

              {result.matchedWebGroupIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">FQDN Resolved To</p>
                  <div className="flex flex-wrap gap-1">
                    {result.matchedWebGroupIds.map((id) => {
                      const wg = topology.webGroups.find((g) => g.id === id);
                      return (
                        <span key={id} className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--color-accent-purple)15', color: 'var(--color-accent-purple)' }}>
                          <Globe size={10} /> {wg?.name || id}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Resolved Groups</p>
                <div className="grid grid-cols-2 gap-2">
                  <ResolvedGroupCard label="Source" groupIds={result.srcGroups} smartGroupMap={smartGroupMap} />
                  <ResolvedGroupCard label="Destination" groupIds={result.dstGroups} smartGroupMap={smartGroupMap} />
                </div>
              </div>

              {result.matchedPolicy && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Matched Policy</p>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="text-[var(--color-text-muted)]">Name</div>
                    <div className="text-[var(--color-text-primary)] font-medium">{result.matchedPolicy.name}</div>
                    <div className="text-[var(--color-text-muted)]">Priority</div>
                    <div className="text-[var(--color-text-primary)] font-medium">{result.matchedPolicy.priority}</div>
                    <div className="text-[var(--color-text-muted)]">Action</div>
                    <div className="text-[var(--color-text-primary)] font-medium capitalize">{result.matchedPolicy.action}</div>
                    <div className="text-[var(--color-text-muted)]">Protocol</div>
                    <div className="text-[var(--color-text-primary)] font-medium uppercase">{result.matchedPolicy.protocol}</div>
                    <div className="text-[var(--color-text-muted)]">Ports</div>
                    <div className="text-[var(--color-text-primary)] font-medium">{result.matchedPolicy.ports || 'any'}</div>
                    <div className="text-[var(--color-text-muted)]">Logging</div>
                    <div className="text-[var(--color-text-primary)] font-medium">{result.matchedPolicy.logging ? 'Enabled' : 'Disabled'}</div>
                  </div>
                </div>
              )}

              {result.allCandidates.length > 1 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    Shadowed Policies ({result.allCandidates.length - 1})
                  </p>
                  <div className="space-y-1">
                    {result.allCandidates.slice(1).map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between px-2.5 py-1.5 rounded text-xs border"
                        style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)' }}
                      >
                        <span className="text-[var(--color-text-secondary)]">{p.name}</span>
                        <span className="text-[var(--color-text-muted)]">P{p.priority}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ============= Saved Flows ============= */}
          <div
            className="rounded-xl border overflow-hidden"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="px-4 py-3 border-b border-[var(--color-border-subtle)]">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <Activity size={16} className="text-[var(--color-accent-blue)]" />
                  <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Saved Flows</h3>
                  <span className="text-[10px] text-[var(--color-text-muted)]">
                    {allowedCount} allowed · {deniedCount} denied
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)]" />
                    <input
                      type="text"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                      placeholder="Filter…"
                      className="pl-7 pr-2 py-1 rounded text-xs w-32 border outline-none"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mt-3 flex-wrap">
                <button
                  onClick={() => { setManualOpen(!manualOpen); setImportMode(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors"
                  style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                >
                  <Plus size={12} /> Add manually
                </button>
                <button
                  onClick={() => { setImportMode(!importMode); setManualOpen(false); }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border"
                  style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                >
                  <Upload size={12} /> Import
                </button>
                <button
                  onClick={() => downloadFlowsJSON(topology.flows)}
                  disabled={topology.flows.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border disabled:opacity-40"
                  style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                >
                  <Download size={12} /> JSON
                </button>
                <button
                  onClick={() => downloadFlowsCSV(topology.flows, topology)}
                  disabled={topology.flows.length === 0}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border disabled:opacity-40"
                  style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                >
                  <Download size={12} /> CSV
                </button>
              </div>
            </div>

            {/* Import textarea */}
            {importMode && (
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Import Flows</p>
                  <button onClick={() => setImportMode(false)} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                    <X size={12} />
                  </button>
                </div>
                <p className="text-[10px] text-[var(--color-text-muted)]">Paste a JSON array or CSV (with headers).</p>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  placeholder='[{"srcGroupId":"sg-...","dstGroupId":"sg-...", ...}]'
                  className="w-full h-24 px-2 py-1.5 rounded text-xs border outline-none font-mono resize-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                />
                {importError && (
                  <div className="flex items-center gap-1.5 text-[10px] text-red-400">
                    <AlertTriangle size={11} />
                    {importError}
                  </div>
                )}
                <button
                  onClick={handleImport}
                  className="px-2.5 py-1 rounded text-[11px] font-medium text-white"
                  style={{ backgroundColor: 'var(--color-aviatrix)' }}
                >
                  Import Flows
                </button>
              </div>
            )}

            {/* Manual add/edit form */}
            {manualOpen && (
              <div className="px-4 py-3 border-b border-[var(--color-border-subtle)] space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                    {editingId ? 'Edit Flow' : 'New Flow'}
                  </p>
                  <button onClick={cancelManual} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                    <X size={12} />
                  </button>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <Field label="Source" compact>
                    <SelectChevron>
                      <select
                        value={manualForm.srcGroupId}
                        onChange={(e) => updateManual('srcGroupId', e.target.value)}
                        className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                        style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                      >
                        <option value="">Select…</option>
                        {smartGroupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        <option value="sg-any">Any</option>
                      </select>
                    </SelectChevron>
                  </Field>
                  <Field label="Destination" compact>
                    <SelectChevron>
                      <select
                        value={manualForm.dstGroupId}
                        onChange={(e) => updateManual('dstGroupId', e.target.value)}
                        className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                        style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                      >
                        <option value="">Select…</option>
                        {smartGroupOptions.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                        <option value="sg-any">Any</option>
                      </select>
                    </SelectChevron>
                  </Field>
                  <Field label="Protocol" compact>
                    <SelectChevron>
                      <select
                        value={manualForm.protocol}
                        onChange={(e) => updateManual('protocol', e.target.value as Protocol)}
                        className="w-full px-2 py-1 rounded text-xs border outline-none appearance-none"
                        style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                      >
                        <option value="tcp">TCP</option>
                        <option value="udp">UDP</option>
                        <option value="icmp">ICMP</option>
                        <option value="any">Any</option>
                      </select>
                    </SelectChevron>
                  </Field>
                  <Field label="Port" compact>
                    <input
                      type="number"
                      value={manualForm.port}
                      onChange={(e) => updateManual('port', e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs border outline-none"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </Field>
                  <Field label="Bytes" compact>
                    <input
                      type="number"
                      value={manualForm.bytes}
                      onChange={(e) => updateManual('bytes', e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs border outline-none"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </Field>
                  <Field label="Packets" compact>
                    <input
                      type="number"
                      value={manualForm.packets}
                      onChange={(e) => updateManual('packets', e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs border outline-none"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </Field>
                  <Field label="Timestamp" compact>
                    <input
                      type="datetime-local"
                      value={manualForm.timestamp}
                      onChange={(e) => updateManual('timestamp', e.target.value)}
                      className="w-full px-2 py-1 rounded text-xs border outline-none"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                  </Field>
                  <div className="flex items-end">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={manualForm.allowed}
                        onChange={(e) => updateManual('allowed', e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-xs text-[var(--color-text-secondary)]">Allowed</span>
                    </label>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={submitManual}
                    disabled={!manualForm.srcGroupId || !manualForm.dstGroupId}
                    className="px-2.5 py-1 rounded text-[11px] font-medium text-white disabled:opacity-40"
                    style={{ backgroundColor: 'var(--color-aviatrix)' }}
                  >
                    {editingId ? 'Update Flow' : 'Add Flow'}
                  </button>
                  <button
                    onClick={cancelManual}
                    className="px-2.5 py-1 rounded text-[11px] font-medium text-[var(--color-text-secondary)] border"
                    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {/* Flow list */}
            <div className="p-3 space-y-2">
              {filteredFlows.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-8">
                  <div className="w-10 h-10 rounded-full bg-[var(--color-surface-elevated)] flex items-center justify-center mb-3">
                    <Activity size={18} className="text-[var(--color-text-muted)]" />
                  </div>
                  <p className="text-xs font-medium text-[var(--color-text-secondary)]">No flows yet</p>
                  <p className="text-[11px] text-[var(--color-text-muted)] mt-1 max-w-xs">
                    Run a simulation above — results are saved here automatically. Or use <strong>Add manually</strong> / <strong>Import</strong>.
                  </p>
                </div>
              ) : (
                filteredFlows.map((flow) => (
                  <FlowRow
                    key={flow.id}
                    flow={flow}
                    topology={topology}
                    onEdit={() => startEditManual(flow)}
                    onDelete={() => onDeleteFlow(flow.id)}
                  />
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function Field({ label, hint, error, compact, children }: { label: string; hint?: string; error?: boolean; compact?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className={`block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] ${compact ? 'mb-0.5' : 'mb-1'} ${error ? 'text-red-400' : ''}`}>{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[9px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

function SelectChevron({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative">
      {children}
      <ChevronDown size={11} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
    </div>
  );
}

function ResolvedGroupCard({ label, groupIds, smartGroupMap }: { label: string; groupIds: string[]; smartGroupMap: Map<string, string> }) {
  return (
    <div className="p-2 rounded border" style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)' }}>
      <div className="flex items-center gap-1.5 mb-1">
        <Network size={11} className="text-[var(--color-text-muted)]" />
        <span className="text-[10px] font-medium text-[var(--color-text-muted)]">{label}</span>
      </div>
      <div className="flex flex-wrap gap-1">
        {groupIds.length > 0 ? (
          groupIds.map((id) => (
            <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--color-accent-blue)15', color: 'var(--color-accent-blue)' }}>
              {smartGroupMap.get(id) || id}
            </span>
          ))
        ) : (
          <span className="text-[10px] text-[var(--color-text-muted)] italic">No matching group (sg-any)</span>
        )}
      </div>
    </div>
  );
}

function FlowRow({
  flow, topology, onEdit, onDelete,
}: {
  flow: TrafficFlow;
  topology: DcfPolicyModel;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const srcGroup = topology.smartGroups.find((g) => g.id === flow.srcGroupId);
  const dstGroup = topology.smartGroups.find((g) => g.id === flow.dstGroupId);

  return (
    <div className={`flex items-center gap-3 px-3 py-2.5 rounded border ${flow.allowed ? 'border-green-500/20 bg-green-500/5' : 'border-red-500/20 bg-red-500/5'}`}>
      <div className="flex items-center gap-2 min-w-[120px]">
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: srcGroup?.color || '#666' }} />
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{srcGroup?.name || flow.srcGroupId}</span>
      </div>
      <div className="flex items-center gap-1 text-[var(--color-text-muted)]">
        <ArrowRightLeft size={12} />
        <span className="text-[10px] font-mono uppercase">{flow.protocol}</span>
        <span className="text-[10px] font-mono">:{flow.port}</span>
      </div>
      <div className="flex items-center gap-2 min-w-[120px] justify-end">
        <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{dstGroup?.name || flow.dstGroupId}</span>
        <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: dstGroup?.color || '#666' }} />
      </div>
      <div className="hidden sm:flex items-center gap-1 text-[10px] text-[var(--color-text-muted)] ml-2">
        {formatTimestamp(flow.timestamp)}
      </div>
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right hidden sm:block">
          <div className="text-[10px] text-[var(--color-text-muted)]">{formatBytes(flow.bytes)}</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">{flow.packets} pkts</div>
        </div>
        {flow.allowed ? (
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={16} className="text-red-400 shrink-0" />
        )}
        <div className="flex items-center gap-1">
          <button
            onClick={onEdit}
            className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            title="Edit"
          >
            <Pencil size={12} />
          </button>
          <button
            onClick={onDelete}
            className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
            title="Delete"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// EndpointCombobox — Source / Destination input
// =============================================================================
//
// Lets the user either type a value (IP or CIDR — auto-detected) OR pick a
// SmartGroup / WebGroup from a dropdown. When a group is picked, the input
// flips to "chip" mode showing the group name with an X to revert to text.
// WebGroups are only offered when `allowWebGroup` is true (destination).

function EndpointCombobox({
  topology, value, onChange, placeholder, allowWebGroup,
}: {
  topology: DcfPolicyModel;
  value: Endpoint;
  onChange: (next: Endpoint) => void;
  placeholder: string;
  allowWebGroup: boolean;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Reset query when value flips into a chip; otherwise sync with text value.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external sync: keep the visible input in step with the controlled `value` prop without leaking text-mode state across renders when the parent flips kind.
    if (value.kind === 'text') setQuery(value.value);
    else setQuery('');
  }, [value]);

  useEffect(() => {
    if (!isOpen) return;
    function onClickOut(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, [isOpen]);

  const smartGroups = topology.smartGroups.filter((g) => g.id !== 'sg-internet');
  const webGroups = allowWebGroup ? topology.webGroups : [];

  const q = query.trim().toLowerCase();
  const matchedSmartGroups = q
    ? smartGroups.filter((g) => g.name.toLowerCase().includes(q))
    : smartGroups;
  const matchedWebGroups = q
    ? webGroups.filter((g) => g.name.toLowerCase().includes(q))
    : webGroups;

  const errored = endpointKindError(value);

  const pickSmartGroup = (g: SmartGroup) => {
    onChange({ kind: 'smartGroup', id: g.id });
    setIsOpen(false);
    inputRef.current?.blur();
  };
  const pickWebGroup = (g: WebGroup) => {
    onChange({ kind: 'webGroup', id: g.id });
    setIsOpen(false);
    inputRef.current?.blur();
  };
  const clear = () => {
    onChange({ kind: 'text', value: '' });
    setQuery('');
    inputRef.current?.focus();
  };

  // Chip mode: a SmartGroup or WebGroup is currently picked.
  if (value.kind !== 'text') {
    const isSmart = value.kind === 'smartGroup';
    const smart = isSmart ? topology.smartGroups.find((g) => g.id === value.id) : undefined;
    const web = !isSmart ? topology.webGroups.find((g) => g.id === value.id) : undefined;
    const accent = isSmart ? 'var(--color-accent-blue)' : 'var(--color-accent-purple)';
    return (
      <div
        className="flex items-center gap-2 px-2 py-1.5 rounded text-xs border"
        style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)' }}
      >
        <span
          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium"
          style={{ backgroundColor: `${accent}1f`, color: accent }}
        >
          {isSmart ? <Network size={10} /> : <Globe size={10} />}
          {isSmart ? 'SmartGroup' : 'WebGroup'}
        </span>
        <span className="flex-1 truncate text-[var(--color-text-primary)]">{smart?.name || web?.name || value.id}</span>
        <button
          type="button"
          onClick={clear}
          className="p-0.5 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
          title="Clear"
        >
          <X size={11} />
        </button>
      </div>
    );
  }

  // Text mode: free input + dropdown.
  return (
    <div ref={containerRef} className="relative">
      <div
        className="flex items-center gap-1.5 rounded border px-2 py-1.5"
        style={{
          backgroundColor: 'var(--color-input-bg)',
          borderColor: errored ? '#ef4444' : 'var(--color-input-border)',
        }}
      >
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            const v = e.target.value;
            setQuery(v);
            onChange({ kind: 'text', value: v });
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="flex-1 text-xs bg-transparent outline-none font-mono"
          style={{ color: 'var(--color-text-primary)' }}
          aria-autocomplete="list"
          aria-expanded={isOpen}
          role="combobox"
        />
        <button
          type="button"
          onClick={() => { setIsOpen((v) => !v); inputRef.current?.focus(); }}
          className="p-0.5 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
          title="Pick a group"
        >
          <ChevronDown size={11} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {errored && (
        <p className="text-[10px] text-red-400 mt-0.5">Not a valid IPv4 address or CIDR</p>
      )}

      {isOpen && (
        <div
          className="absolute top-full mt-1 left-0 right-0 z-30 max-h-64 overflow-y-auto rounded border shadow-lg"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          role="listbox"
        >
          <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">SmartGroups</div>
          {matchedSmartGroups.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] italic">No SmartGroups match</div>
          ) : (
            matchedSmartGroups.map((g) => (
              <button
                key={g.id}
                type="button"
                onClick={() => pickSmartGroup(g)}
                className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surface-elevated)]"
                role="option"
              >
                <div className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: g.color }} />
                <span className="flex-1 truncate text-[var(--color-text-primary)]">{g.name}</span>
              </button>
            ))
          )}
          {allowWebGroup && (
            <>
              <div className="px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] border-t border-b border-[var(--color-border-subtle)]">WebGroups</div>
              {matchedWebGroups.length === 0 ? (
                <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] italic">No WebGroups match</div>
              ) : (
                matchedWebGroups.map((g) => (
                  <button
                    key={g.id}
                    type="button"
                    onClick={() => pickWebGroup(g)}
                    className="w-full flex items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-[var(--color-surface-elevated)]"
                    role="option"
                  >
                    <Globe size={10} className="text-[var(--color-accent-purple)] shrink-0" />
                    <span className="flex-1 truncate text-[var(--color-text-primary)]">{g.name}</span>
                    <span className="text-[9px] text-[var(--color-text-muted)] shrink-0">{g.fqdns.length} fqdns</span>
                  </button>
                ))
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

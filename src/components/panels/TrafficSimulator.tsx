import { useState, useMemo } from 'react';
import {
  FlaskConical, ShieldCheck, ShieldX, ShieldAlert, Ban, ChevronDown, ChevronRight, Network, Globe,
  ArrowRightLeft, CheckCircle2, XCircle, Activity, Plus, Trash2, Pencil, Upload, Download,
  AlertTriangle, X, Search, Save,
} from 'lucide-react';
import type { DcfPolicyModel, Protocol, TrafficFlow, PolicyDirection } from '../../types/dcf';
import { simulateTraffic } from '../../lib/policySimulator';
import type { SimulationResult } from '../../lib/policySimulator';
import { isValidIPv4 } from '../../lib/ipUtils';
import {
  downloadFlowsJSON, downloadFlowsCSV, importFlowsJSON, importFlowsCSV,
} from '../../lib/importExport';

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
  // Simulator form
  const [srcIp, setSrcIp] = useState('');
  const [dstIp, setDstIp] = useState('');
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

  const canRun = isValidIPv4(srcIp) && isValidIPv4(dstIp) && port !== '';

  const runSimulation = () => {
    if (!canRun) return;
    const portNum = parseInt(port, 10) || 0;
    const res = simulateTraffic(topology, {
      srcIp,
      dstIp,
      protocol,
      port: portNum,
      dstFqdn: dstFqdn.trim() || undefined,
      srcThreatGroupId: srcThreatGroupId || undefined,
      dstThreatGroupId: dstThreatGroupId || undefined,
      srcGeoGroupId: srcGeoGroupId || undefined,
      dstGeoGroupId: dstGeoGroupId || undefined,
    });
    setResult(res);
    setJustSavedFlowId(null);
  };

  const saveResultAsFlow = () => {
    if (!result) return;
    const srcGroupId = result.srcGroups[0] || 'sg-any';
    const dstGroupId = result.dstGroups[0] || 'sg-any';
    const allowed = result.action === 'allow' || result.action === 'learned';
    const flow: Omit<TrafficFlow, 'id'> = {
      srcGroupId,
      dstGroupId,
      protocol,
      port: parseInt(port, 10) || 0,
      bytes: 0,
      packets: 0,
      allowed,
      direction: 'any',
      timestamp: new Date().toISOString(),
    };
    onCreateFlow(flow);
    // Light-up the "Saved" confirmation. We don't know the assigned id here
    // (App generates it in the dispatch); instead just flash a transient state.
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
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Test a hypothetical flow between two IPs, then save the result as a logged flow for impact analysis.</p>
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
              <Field label="Source IP" error={!!srcIp && !isValidIPv4(srcIp)}>
                <input
                  type="text"
                  value={srcIp}
                  onChange={(e) => setSrcIp(e.target.value)}
                  placeholder="10.0.1.5"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                  style={{
                    backgroundColor: 'var(--color-input-bg)',
                    borderColor: srcIp && !isValidIPv4(srcIp) ? '#ef4444' : 'var(--color-input-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                {srcIp && !isValidIPv4(srcIp) && <p className="text-[10px] text-red-400 mt-0.5">Invalid IPv4 address</p>}
              </Field>

              <Field label="Destination IP" error={!!dstIp && !isValidIPv4(dstIp)}>
                <input
                  type="text"
                  value={dstIp}
                  onChange={(e) => setDstIp(e.target.value)}
                  placeholder="10.0.2.10"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                  style={{
                    backgroundColor: 'var(--color-input-bg)',
                    borderColor: dstIp && !isValidIPv4(dstIp) ? '#ef4444' : 'var(--color-input-border)',
                    color: 'var(--color-text-primary)',
                  }}
                />
                {dstIp && !isValidIPv4(dstIp) && <p className="text-[10px] text-red-400 mt-0.5">Invalid IPv4 address</p>}
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
                <button
                  onClick={saveResultAsFlow}
                  disabled={justSavedFlowId !== null}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium border transition-colors hover:bg-[var(--color-surface-elevated)] disabled:opacity-60"
                  style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
                  title="Save this simulated flow to the logged flows list so it counts in Policy Impact analysis."
                >
                  {justSavedFlowId ? <CheckCircle2 size={12} /> : <Save size={12} />}
                  {justSavedFlowId ? 'Saved' : 'Save as flow'}
                </button>
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
                    Run a simulation above and click <strong>Save as flow</strong>, or use <strong>Add manually</strong> / <strong>Import</strong>.
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

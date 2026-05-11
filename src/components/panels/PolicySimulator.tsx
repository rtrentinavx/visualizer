import { useState, useMemo } from 'react';
import { FlaskConical, ShieldCheck, ShieldX, ShieldAlert, Ban, ChevronDown, ChevronRight, Network, Globe } from 'lucide-react';
import type { DcfPolicyModel, Protocol } from '../../types/dcf';
import { simulateTraffic } from '../../lib/policySimulator';
import type { SimulationResult } from '../../lib/policySimulator';
import { isValidIPv4 } from '../../lib/ipUtils';

interface PolicySimulatorProps {
  topology: DcfPolicyModel;
}

export default function PolicySimulator({ topology }: PolicySimulatorProps) {
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

  const smartGroupMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of topology.smartGroups) {
      map.set(g.id, g.name);
    }
    return map;
  }, [topology.smartGroups]);

  const runSimulation = () => {
    if (!isValidIPv4(srcIp) || !isValidIPv4(dstIp)) return;
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
  };

  const hasAdvancedOverrides =
    dstFqdn.trim() !== '' || srcThreatGroupId !== '' || dstThreatGroupId !== '' || srcGeoGroupId !== '' || dstGeoGroupId !== '';

  const actionConfig = {
    allow: { icon: ShieldCheck, color: '#22c55e', label: 'ALLOWED' },
    learned: { icon: ShieldAlert, color: '#8b5cf6', label: 'LEARNED' },
    deny: { icon: ShieldX, color: '#ef4444', label: 'DENIED' },
    'implicit-deny': { icon: Ban, color: '#9ca3af', label: 'IMPLICIT DENY' },
  };

  const canRun = isValidIPv4(srcIp) && isValidIPv4(dstIp) && port !== '';

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical size={18} className="text-[var(--color-accent-blue)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Simulator</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Enter two IPs to test if traffic is allowed between them</p>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4">
        <div className="max-w-2xl mx-auto space-y-4">
          {/* Input Form */}
          <div
            className="p-4 rounded-xl border space-y-3"
            style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
          >
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* Source IP */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Source IP</label>
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
                {srcIp && !isValidIPv4(srcIp) && (
                  <p className="text-[10px] text-red-400 mt-0.5">Invalid IPv4 address</p>
                )}
              </div>

              {/* Destination IP */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Destination IP</label>
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
                {dstIp && !isValidIPv4(dstIp) && (
                  <p className="text-[10px] text-red-400 mt-0.5">Invalid IPv4 address</p>
                )}
              </div>

              {/* Protocol */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Protocol</label>
                <div className="relative">
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
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
              </div>

              {/* Port */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Port</label>
                <input
                  type="number"
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder="443"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                />
              </div>
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
                  <div>
                    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Destination FQDN</label>
                    <input
                      type="text"
                      value={dstFqdn}
                      onChange={(e) => setDstFqdn(e.target.value)}
                      placeholder="login.salesforce.com"
                      className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                    <p className="text-[9px] text-[var(--color-text-muted)] mt-0.5">
                      Enables matching of WebGroup-attached policies. The FQDN is glob-matched against each WebGroup's patterns (e.g. <code>*.salesforce.com</code>).
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Src ThreatGroup</label>
                      <div className="relative">
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
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Dst ThreatGroup</label>
                      <div className="relative">
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
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Src GeoGroup</label>
                      <div className="relative">
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
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Dst GeoGroup</label>
                      <div className="relative">
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
                        <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                      </div>
                    </div>
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

          {/* Result */}
          {result && (
            <div
              className="p-4 rounded-xl border space-y-3"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)' }}
            >
              {/* Action Banner */}
              <div
                className="flex items-center gap-3 p-3 rounded-lg"
                style={{ backgroundColor: `${actionConfig[result.action].color}15`, border: `1px solid ${actionConfig[result.action].color}40` }}
              >
                {(() => {
                  const Icon = actionConfig[result.action].icon;
                  return <Icon size={20} style={{ color: actionConfig[result.action].color }} />;
                })()}
                <div>
                  <p className="text-sm font-semibold" style={{ color: actionConfig[result.action].color }}>
                    {actionConfig[result.action].label}
                  </p>
                </div>
              </div>

              {/* Explanation */}
              <div className="text-xs text-[var(--color-text-secondary)] leading-relaxed">
                {result.explanation}
              </div>

              {/* Matched WebGroups (when FQDN was provided) */}
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

              {/* Resolved Groups */}
              <div className="space-y-2">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Resolved Groups</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-2 rounded border" style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Network size={11} className="text-[var(--color-text-muted)]" />
                      <span className="text-[10px] font-medium text-[var(--color-text-muted)]">Source</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {result.srcGroups.length > 0 ? (
                        result.srcGroups.map((id) => (
                          <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--color-accent-blue)15', color: 'var(--color-accent-blue)' }}>
                            {smartGroupMap.get(id) || id}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-[var(--color-text-muted)] italic">No matching group (sg-any)</span>
                      )}
                    </div>
                  </div>
                  <div className="p-2 rounded border" style={{ backgroundColor: 'var(--color-surface-elevated)', borderColor: 'var(--color-border-subtle)' }}>
                    <div className="flex items-center gap-1.5 mb-1">
                      <Network size={11} className="text-[var(--color-text-muted)]" />
                      <span className="text-[10px] font-medium text-[var(--color-text-muted)]">Destination</span>
                    </div>
                    <div className="flex flex-wrap gap-1">
                      {result.dstGroups.length > 0 ? (
                        result.dstGroups.map((id) => (
                          <span key={id} className="text-[10px] px-1.5 py-0.5 rounded font-medium" style={{ backgroundColor: 'var(--color-accent-blue)15', color: 'var(--color-accent-blue)' }}>
                            {smartGroupMap.get(id) || id}
                          </span>
                        ))
                      ) : (
                        <span className="text-[10px] text-[var(--color-text-muted)] italic">No matching group (sg-any)</span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* Matched Policy Detail */}
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

              {/* All Candidates */}
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
        </div>
      </div>
    </div>
  );
}

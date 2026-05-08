import { useState, useMemo } from 'react';
import { FlaskConical, ShieldCheck, ShieldX, ShieldAlert, Ban, ChevronDown } from 'lucide-react';
import type { DcfPolicyModel, Protocol } from '../../types/dcf';
import { simulateTraffic } from '../../lib/policySimulator';
import type { SimulationResult } from '../../lib/policySimulator';

interface PolicySimulatorProps {
  topology: DcfPolicyModel;
}

export default function PolicySimulator({ topology }: PolicySimulatorProps) {
  const [srcGroupId, setSrcGroupId] = useState('');
  const [dstGroupId, setDstGroupId] = useState('');
  const [protocol, setProtocol] = useState<Protocol>('tcp');
  const [port, setPort] = useState('443');
  const [result, setResult] = useState<SimulationResult | null>(null);

  const smartGroupOptions = useMemo(
    () => topology.smartGroups.filter((g) => g.id !== 'sg-internet'),
    [topology.smartGroups]
  );

  const runSimulation = () => {
    if (!srcGroupId || !dstGroupId) return;
    const portNum = parseInt(port, 10) || 0;
    const res = simulateTraffic(topology, {
      srcGroupId,
      dstGroupId,
      protocol,
      port: portNum,
    });
    setResult(res);
  };

  const actionConfig = {
    allow: { icon: ShieldCheck, color: '#22c55e', label: 'ALLOWED' },
    learned: { icon: ShieldAlert, color: '#8b5cf6', label: 'LEARNED' },
    deny: { icon: ShieldX, color: '#ef4444', label: 'DENIED' },
    'implicit-deny': { icon: Ban, color: '#9ca3af', label: 'IMPLICIT DENY' },
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between">
        <div className="flex items-center gap-3">
          <FlaskConical size={18} className="text-[var(--color-accent-blue)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Policy Simulator</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">Test a traffic flow against your policy rules</p>
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
              {/* Source */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Source Group</label>
                <div className="relative">
                  <select
                    value={srcGroupId}
                    onChange={(e) => setSrcGroupId(e.target.value)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  >
                    <option value="">Select source...</option>
                    {smartGroupOptions.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                    <option value="sg-any">Any</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
              </div>

              {/* Destination */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Destination Group</label>
                <div className="relative">
                  <select
                    value={dstGroupId}
                    onChange={(e) => setDstGroupId(e.target.value)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  >
                    <option value="">Select destination...</option>
                    {smartGroupOptions.map((g) => (
                      <option key={g.id} value={g.id}>{g.name}</option>
                    ))}
                    <option value="sg-any">Any</option>
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
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

            <button
              onClick={runSimulation}
              disabled={!srcGroupId || !dstGroupId}
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
                  <p className="text-xs text-[var(--color-text-muted)]">{result.explanation}</p>
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

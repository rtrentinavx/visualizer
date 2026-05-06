import { ArrowRightLeft, CheckCircle2, XCircle, Activity } from 'lucide-react';
import type { DcfPolicyModel, TrafficFlow } from '../../types/dcf';

interface TrafficFlowPanelProps {
  topology: DcfPolicyModel;
  filter?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function FlowRow({ flow, topology }: { flow: TrafficFlow; topology: DcfPolicyModel }) {
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
      <div className="ml-auto flex items-center gap-3">
        <div className="text-right">
          <div className="text-[10px] text-[var(--color-text-muted)]">{formatBytes(flow.bytes)}</div>
          <div className="text-[10px] text-[var(--color-text-muted)]">{flow.packets} pkts</div>
        </div>
        {flow.allowed ? (
          <CheckCircle2 size={16} className="text-green-400 shrink-0" />
        ) : (
          <XCircle size={16} className="text-red-400 shrink-0" />
        )}
      </div>
    </div>
  );
}

export default function TrafficFlowPanel({ topology, filter = '' }: TrafficFlowPanelProps) {
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

  const allowedCount = filteredFlows.filter((f) => f.allowed).length;
  const deniedCount = filteredFlows.filter((f) => !f.allowed).length;
  const totalBytes = filteredFlows.reduce((sum, f) => sum + f.bytes, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b border-[var(--color-border-subtle)]">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Traffic Flows</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-1">Recent DCF-evaluated traffic</p>
          </div>
          <Activity size={18} className="text-[var(--color-accent-blue)]" />
        </div>
        <div className="grid grid-cols-3 gap-2 mt-3">
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-green-400">{allowedCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Allowed</div>
          </div>
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-red-400">{deniedCount}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Denied</div>
          </div>
          <div className="px-2 py-1.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)] text-center">
            <div className="text-lg font-bold text-[var(--color-text-primary)]">{formatBytes(totalBytes)}</div>
            <div className="text-[10px] text-[var(--color-text-muted)] uppercase">Total</div>
          </div>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {filteredFlows.length === 0 ? (
          <div className="text-center py-8 text-xs" style={{ color: 'var(--color-text-muted)' }}>
            No traffic flows match your search.
          </div>
        ) : (
          filteredFlows.map((flow) => (
            <FlowRow key={flow.id} flow={flow} topology={topology} />
          ))
        )}
      </div>
    </div>
  );
}

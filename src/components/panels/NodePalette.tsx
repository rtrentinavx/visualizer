import { Cloud, Network, Router, Filter, Globe, Shield, Server, Boxes } from 'lucide-react';

interface PaletteItem {
  type: string;
  label: string;
  icon: typeof Cloud;
  color: string;
  category: string;
}

const items: PaletteItem[] = [
  { type: 'cloudRegion', label: 'Cloud Region', icon: Cloud, color: '#3b82f6', category: 'Infrastructure' },
  { type: 'vpc', label: 'VPC / VNet', icon: Network, color: '#06b6d4', category: 'Infrastructure' },
  { type: 'gateway', label: 'Transit GW', icon: Router, color: '#3b82f6', category: 'Gateway' },
  { type: 'gateway-spoke', label: 'Spoke GW', icon: Server, color: '#06b6d4', category: 'Gateway' },
  { type: 'gateway-dcf', label: 'DCF GW', icon: Filter, color: '#e4002b', category: 'Gateway' },
  { type: 'gateway-egress', label: 'Egress GW', icon: Globe, color: '#f59e0b', category: 'Gateway' },
  { type: 'gateway-edge', label: 'Edge GW', icon: Shield, color: '#8b5cf6', category: 'Gateway' },
  { type: 'smartGroup', label: 'Smart Group', icon: Boxes, color: '#10b981', category: 'Policy' },
];

export default function NodePalette() {
  const onDragStart = (event: React.DragEvent, item: PaletteItem) => {
    event.dataTransfer.setData('application/reactflow', JSON.stringify(item));
    event.dataTransfer.effectAllowed = 'move';
  };

  const categories = Array.from(new Set(items.map((i) => i.category)));

  return (
    <div
      className="w-52 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex flex-col shrink-0 select-none"
      onDragOver={(e) => e.preventDefault()}
    >
      <div className="p-3 border-b border-[var(--color-border-subtle)]">
        <h2 className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Palette</h2>
        <p className="text-[10px] text-[var(--color-text-muted)] mt-1">Drag items onto the canvas</p>
      </div>
      <div className="flex-1 overflow-y-auto p-3 space-y-4">
        {categories.map((cat) => (
          <div key={cat}>
            <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
              {cat}
            </div>
            <div className="space-y-1.5">
              {items
                .filter((i) => i.category === cat)
                .map((item) => {
                  const Icon = item.icon;
                  return (
                    <div
                      key={item.type}
                      draggable
                      onDragStart={(e) => onDragStart(e, item)}
                      className="flex items-center gap-2 px-2.5 py-2 rounded-md cursor-grab active:cursor-grabbing border transition-colors hover:bg-[var(--color-button-hover)]"
                      style={{
                        backgroundColor: 'var(--color-surface)',
                        borderColor: 'var(--color-border-subtle)',
                      }}
                    >
                      <Icon size={14} style={{ color: item.color }} />
                      <span className="text-[11px] font-medium text-[var(--color-text-primary)]">{item.label}</span>
                    </div>
                  );
                })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

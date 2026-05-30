import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  GitGraph,
  Lock,
  Unlock,
  PenLine,
  X,
  Filter,
  Maximize2,
  Eye,
  EyeOff,
  Shield,
} from 'lucide-react';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface GraphState {
  connectMode: boolean;
  connectSource: string | null;
  isolatedNodeId: string | null;
  filterAction: 'all' | 'allow' | 'deny';
  filterHasWebGroup: boolean;
  filterHasThreatGroup: boolean;
  showPostureMode: boolean;
}

export interface GraphToolbarProps {
  state: GraphState;
  onChange: (patch: Partial<GraphState>) => void;
  /** Display name for the currently isolated node (when isolatedNodeId is set). */
  isolatedNodeLabel?: string;
  nodeCount: number;
  edgeCount: number;
  onFitView: () => void;
}

// ---------------------------------------------------------------------------
// Internal primitives (mirrored from AppHeader style, self-contained here)
// ---------------------------------------------------------------------------

function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const [coords, setCoords] = useState<{ left: number; top: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapperRef = useRef<HTMLSpanElement>(null);

  const recompute = () => {
    const el = wrapperRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setCoords({ left: r.left + r.width / 2, top: r.bottom + 6 });
  };

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      recompute();
      setVisible(true);
    }, 350);
  };

  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  };

  useEffect(() => {
    if (!visible) return;
    const onAny = () => hide();
    window.addEventListener('scroll', onAny, true);
    window.addEventListener('resize', onAny);
    return () => {
      window.removeEventListener('scroll', onAny, true);
      window.removeEventListener('resize', onAny);
    };
  }, [visible]);

  return (
    <span
      ref={wrapperRef}
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && coords &&
        createPortal(
          <span
            role="tooltip"
            className="fixed -translate-x-1/2 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap pointer-events-none z-[9999] shadow-lg"
            style={{
              left: coords.left,
              top: coords.top,
              backgroundColor: 'var(--color-text-primary)',
              color: 'var(--color-surface)',
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}

interface ToolbarButtonProps {
  icon: React.ComponentType<{ size?: number }>;
  label: string;
  onClick: () => void;
  active?: boolean;
  activeColor?: string;
  disabled?: boolean;
}

function ToolbarButton({
  icon: Icon,
  label,
  onClick,
  active = false,
  activeColor = 'var(--color-aviatrix)',
  disabled = false,
}: ToolbarButtonProps) {
  const bg = active ? `${activeColor}18` : 'var(--color-surface)';
  const border = active ? `${activeColor}45` : 'var(--color-border-subtle)';
  const color = active ? activeColor : 'var(--color-text-secondary)';

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className="p-1.5 rounded-md border transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        style={{ backgroundColor: bg, borderColor: border, color }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
          e.currentTarget.style.color = activeColor;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = bg;
          e.currentTarget.style.color = color;
        }}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}

function Divider() {
  return (
    <div
      className="h-5 w-px mx-1 self-center"
      style={{ backgroundColor: 'var(--color-border-subtle)' }}
      aria-hidden="true"
    />
  );
}

// ---------------------------------------------------------------------------
// Filter action button group — no external library
// ---------------------------------------------------------------------------

type FilterAction = GraphState['filterAction'];

interface FilterButtonGroupProps {
  value: FilterAction;
  onChange: (v: FilterAction) => void;
}

const FILTER_OPTIONS: { value: FilterAction; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'allow', label: 'Allow' },
  { value: 'deny', label: 'Deny' },
];

function FilterButtonGroup({ value, onChange }: FilterButtonGroupProps) {
  return (
    <div
      className="flex items-center rounded-md border overflow-hidden"
      style={{ borderColor: 'var(--color-border-subtle)' }}
      role="group"
      aria-label="Filter by action"
    >
      {FILTER_OPTIONS.map((opt, idx) => {
        const isActive = value === opt.value;
        const isAllow = opt.value === 'allow';
        const isDeny = opt.value === 'deny';
        const activeColor = isAllow
          ? '#10b981'
          : isDeny
          ? '#ef4444'
          : 'var(--color-accent-blue)';

        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            aria-pressed={isActive}
            className="px-2.5 py-1 text-[11px] font-medium transition-colors leading-none"
            style={{
              backgroundColor: isActive ? `${activeColor}18` : 'var(--color-surface)',
              color: isActive ? activeColor : 'var(--color-text-secondary)',
              borderRight:
                idx < FILTER_OPTIONS.length - 1
                  ? '1px solid var(--color-border-subtle)'
                  : undefined,
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
                e.currentTarget.style.color = 'var(--color-text-primary)';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = isActive
                ? `${activeColor}18`
                : 'var(--color-surface)';
              e.currentTarget.style.color = isActive
                ? activeColor
                : 'var(--color-text-secondary)';
            }}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function GraphToolbar({
  state,
  onChange,
  isolatedNodeLabel,
  nodeCount,
  edgeCount,
  onFitView,
}: GraphToolbarProps) {
  const {
    connectMode,
    filterAction,
    filterHasWebGroup,
    filterHasThreatGroup,
    showPostureMode,
    isolatedNodeId,
  } = state;

  const toggle = (key: keyof GraphState) => () =>
    onChange({ [key]: !state[key as keyof GraphState] } as Partial<GraphState>);

  const clearIsolation = () =>
    onChange({ isolatedNodeId: null });

  const exitConnect = () =>
    onChange({ connectMode: false, connectSource: null });

  const handleDrawPolicy = () => {
    if (connectMode) {
      exitConnect();
    } else {
      onChange({ connectMode: true, connectSource: null });
    }
  };

  return (
    <div
      className="h-12 px-4 flex items-center justify-between gap-x-3 border-b shrink-0"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
      }}
    >
      {/* ── Left: identity ── */}
      <div className="flex items-center gap-2.5 min-w-0 shrink-0">
        <div className="flex items-center gap-1.5 shrink-0">
          <GitGraph size={15} style={{ color: 'var(--color-aviatrix)' }} />
          <span
            className="text-sm font-semibold tracking-tight"
            style={{ color: 'var(--color-text-primary)' }}
          >
            Policy Graph
          </span>
        </div>

        <span
          className="text-[11px] font-normal hidden sm:inline"
          style={{ color: 'var(--color-text-muted)' }}
        >
          {nodeCount} node{nodeCount !== 1 ? 's' : ''} · {edgeCount} edge
          {edgeCount !== 1 ? 's' : ''}
        </span>

        {/* Isolation chip */}
        {isolatedNodeId && (
          <span
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border"
            style={{
              backgroundColor: '#f59e0b18',
              borderColor: '#f59e0b45',
              color: '#f59e0b',
            }}
          >
            <span className="max-w-[120px] truncate">
              Focus:{' '}
              <span className="font-semibold">
                {isolatedNodeLabel ?? isolatedNodeId}
              </span>
            </span>
            <button
              type="button"
              onClick={clearIsolation}
              aria-label="Clear node focus"
              className="inline-flex items-center justify-center rounded-full hover:bg-amber-400/20 transition-colors p-0.5"
              style={{ color: '#f59e0b' }}
            >
              <X size={10} />
            </button>
          </span>
        )}
      </div>

      {/* ── Right: controls ── */}
      <div className="flex items-center gap-x-2 min-w-0">
        {/* Filter: action button group */}
        <div className="flex items-center gap-1.5">
          <Filter
            size={12}
            style={{ color: 'var(--color-text-muted)' }}
            aria-hidden="true"
          />
          <FilterButtonGroup
            value={filterAction}
            onChange={(v) => onChange({ filterAction: v })}
          />
        </div>

        <Divider />

        {/* Filter toggles: WebGroup + ThreatGroup */}
        <div className="flex items-center gap-1">
          <ToolbarButton
            icon={filterHasWebGroup ? Lock : Unlock}
            label={
              filterHasWebGroup
                ? 'Showing WebGroup policies — click to show all'
                : 'Filter to WebGroup policies'
            }
            onClick={toggle('filterHasWebGroup')}
            active={filterHasWebGroup}
            activeColor="var(--color-accent-blue)"
          />
          <ToolbarButton
            icon={Shield}
            label={
              filterHasThreatGroup
                ? 'Showing ThreatGroup policies — click to show all'
                : 'Filter to ThreatGroup policies'
            }
            onClick={toggle('filterHasThreatGroup')}
            active={filterHasThreatGroup}
            activeColor="#8b5cf6"
          />
        </div>

        <Divider />

        {/* Posture mode + Fit view */}
        <div className="flex items-center gap-1">
          <ToolbarButton
            icon={showPostureMode ? Eye : EyeOff}
            label={
              showPostureMode
                ? 'Posture mode on — click to hide risk overlays'
                : 'Enable posture mode — show risk overlays'
            }
            onClick={toggle('showPostureMode')}
            active={showPostureMode}
            activeColor="var(--color-aviatrix)"
          />
          <ToolbarButton
            icon={Maximize2}
            label="Fit graph to viewport"
            onClick={onFitView}
          />
        </div>

        <Divider />

        {/* Draw policy */}
        <ToolbarButton
          icon={connectMode ? X : PenLine}
          label={connectMode ? 'Cancel draw-policy mode' : 'Draw policy — click two nodes to create a rule'}
          onClick={handleDrawPolicy}
          active={connectMode}
          activeColor="var(--color-aviatrix)"
        />
      </div>
    </div>
  );
}

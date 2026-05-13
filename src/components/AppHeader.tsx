import { useRef, useState } from 'react';
import {
  LayoutGrid, Sun, Moon, HelpCircle, BookOpen, FileCode, CloudUpload, CloudDownload,
  Check, Plus, X, GitGraph, ShieldAlert, Bot, Sparkles, FlaskConical, Upload, Trophy, Medal,
  RotateCcw, Lightbulb, FileText, LayoutTemplate, ListOrdered, Route,
} from 'lucide-react';
import type { DcfPolicyModel } from '../types/dcf';
import { scoreTopology } from '../lib/policyScorer';
import { getAllAchievements } from '../lib/achievements';

export type ViewMode = 'matrix' | 'graph' | 'trafficSimulator' | 'aiSettings';

export interface AppHeaderActions {
  openEvaluator: () => void;
  addGroup: () => void;
  resetDemo: () => void;
  clearAll: () => void;
  saveCloud: () => void;
  loadCloud: () => void;
  openImport: () => void;
  openTemplates: () => void;
  openReorderPolicies: () => void;
  openRecommendations: () => void;
  openTerraform: () => void;
  openAIChat: () => void;
  openAutoDocs: () => void;
  openReachability: () => void;
  openPolicySearch: () => void;
  openAchievements: () => void;
  openBestPractices: () => void;
  openAbout: () => void;
}

interface AppHeaderProps {
  topology: DcfPolicyModel;
  viewMode: ViewMode;
  theme: 'light' | 'dark';
  cloudSyncStatus: 'idle' | 'saving' | 'saved' | 'loading' | 'error';
  aiProfileActive: boolean;
  onViewChange: (mode: ViewMode) => void;
  onToggleTheme: () => void;
  actions: AppHeaderActions;
}

// =============================================================================
// Toolbar primitives
// =============================================================================

const ACCENT_COLORS = {
  default: 'var(--color-text-primary)',
  blue: 'var(--color-accent-blue)',
  purple: 'var(--color-accent-purple)',
  amber: '#f59e0b',
  red: '#ef4444',
  green: '#10b981',
} as const;
type Accent = keyof typeof ACCENT_COLORS;

/** Delayed hover tooltip — replaces the browser's native `title=` for a styled, in-app label. */
function Tooltip({ label, children }: { label: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setVisible(true), 350);
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setVisible(false);
  };

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <span
          role="tooltip"
          className="absolute top-full left-1/2 -translate-x-1/2 mt-2 px-2 py-1 rounded text-[10px] font-medium whitespace-nowrap pointer-events-none z-50 shadow-lg"
          style={{
            backgroundColor: 'var(--color-text-primary)',
            color: 'var(--color-surface-raised)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}

interface IconButtonProps {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  accent?: Accent;
  /** When true, render as "always tinted" — the achievement-badge-style emphasis. */
  active?: boolean;
  badge?: number;
  disabled?: boolean;
  dataTour?: string;
  /** Optional override for the icon — used by the cloud-sync state machine to swap the icon glyph. */
  overrideIcon?: React.ReactNode;
}

function IconButton({ icon: Icon, label, onClick, accent = 'default', active = false, badge, disabled, dataTour, overrideIcon }: IconButtonProps) {
  const color = ACCENT_COLORS[accent];
  const baseBg = active ? `${color}15` : 'var(--color-surface)';
  const baseBorder = active ? `${color}40` : 'var(--color-border-subtle)';
  const baseColor = active ? color : 'var(--color-text-secondary)';

  return (
    <Tooltip label={label}>
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        data-tour={dataTour}
        className="relative p-1.5 rounded-md border transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ backgroundColor: baseBg, borderColor: baseBorder, color: baseColor }}
        onMouseEnter={(e) => {
          if (disabled) return;
          e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
          e.currentTarget.style.color = color;
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = baseBg;
          e.currentTarget.style.color = baseColor;
        }}
      >
        {overrideIcon ?? <Icon size={14} />}
        {badge != null && badge > 0 && (
          <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-[var(--color-aviatrix)] text-white text-[8px] flex items-center justify-center font-bold leading-none">
            {badge}
          </span>
        )}
      </button>
    </Tooltip>
  );
}

/** Visual separator between toolbar groups. Slightly more substantial than a hairline so groups read at a glance. */
function GroupDivider() {
  return <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-1 self-center" aria-hidden="true" />;
}

/** Container that gives buttons in the same semantic group tighter spacing than the inter-group gap. */
function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-1">{children}</div>;
}

function tabClass(active: boolean) {
  return `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
    active ? 'bg-[var(--color-aviatrix)] text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
  }`;
}

// =============================================================================
// Component
// =============================================================================

export default function AppHeader({ topology, viewMode, theme, cloudSyncStatus, aiProfileActive, onViewChange, onToggleTheme, actions }: AppHeaderProps) {
  const score = scoreTopology(topology);
  const allAch = getAllAchievements();
  const unlocked = allAch.filter((a) => a.unlockedAt).length;

  const syncBusy = cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading';
  const saveIcon = (() => {
    if (cloudSyncStatus === 'saving') return <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />;
    if (cloudSyncStatus === 'saved') return <Check size={14} />;
    return <CloudUpload size={14} />;
  })();
  const loadIcon = cloudSyncStatus === 'loading'
    ? <span className="w-3.5 h-3.5 border-2 border-current border-t-transparent rounded-full animate-spin" />
    : <CloudDownload size={14} />;
  const saveAccent: Accent = cloudSyncStatus === 'saved' ? 'green' : cloudSyncStatus === 'error' ? 'red' : 'default';
  const saveLabel = cloudSyncStatus === 'saved' ? 'Saved to cloud'
    : cloudSyncStatus === 'error' ? 'Cloud sync failed'
    : cloudSyncStatus === 'saving' ? 'Saving to cloud…'
    : 'Save to cloud';

  return (
    <div className="h-14 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex items-center justify-between px-4 shrink-0 gap-x-3">
      <div className="flex items-center gap-3 min-w-0 shrink-0">
        <div className="flex items-center gap-2 shrink-0">
          <img src="/logo-header.png" alt="DCF Visualizer" className="h-10 w-auto rounded-md" />
          <h1 className="text-lg font-bold text-[var(--color-text-primary)] tracking-wide hidden lg:inline">visualizer</h1>
        </div>
        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-1 shrink-0" />

        <div data-tour="view-tabs" className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5 border border-[var(--color-border-subtle)] shrink-0">
          <button onClick={() => onViewChange('matrix')} className={tabClass(viewMode === 'matrix')} aria-current={viewMode === 'matrix' ? 'page' : undefined}>
            <LayoutGrid size={14} />
            <span className="hidden sm:inline">Matrix</span>
          </button>
          <button onClick={() => onViewChange('graph')} className={tabClass(viewMode === 'graph')} aria-current={viewMode === 'graph' ? 'page' : undefined}>
            <GitGraph size={14} />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button onClick={() => onViewChange('trafficSimulator')} className={tabClass(viewMode === 'trafficSimulator')} aria-current={viewMode === 'trafficSimulator' ? 'page' : undefined}>
            <FlaskConical size={14} />
            <span className="hidden sm:inline">Traffic</span>
          </button>
        </div>

        {score.totalPolicies > 0 && (
          <Tooltip label={`Compliance score · ${score.average}/100 · grade ${score.grade}`}>
            <button
              onClick={actions.openEvaluator}
              className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border transition-colors"
              style={{ backgroundColor: score.color + '15', borderColor: score.color + '40', color: score.color }}
            >
              <Trophy size={12} />
              {score.grade} · {score.average}
            </button>
          </Tooltip>
        )}
      </div>

      <div className="flex items-center gap-x-2 min-w-0 overflow-x-auto">
        {/* Compose — content authoring */}
        <ToolbarGroup>
          <IconButton icon={Plus} label="Add SmartGroup" onClick={actions.addGroup} />
          <IconButton icon={LayoutTemplate} label="Policy templates" onClick={actions.openTemplates} accent="purple" dataTour="templates-btn" />
          <IconButton icon={ListOrdered} label="Reorder policies" onClick={actions.openReorderPolicies} accent="blue" dataTour="reorder-btn" />
        </ToolbarGroup>

        <GroupDivider />

        {/* Data I/O — move topology in / out */}
        <ToolbarGroup>
          <IconButton icon={Upload} label="Import topology" onClick={actions.openImport} />
          <IconButton icon={CloudUpload} overrideIcon={saveIcon} label={saveLabel} onClick={actions.saveCloud} disabled={syncBusy} accent={saveAccent} />
          <IconButton icon={CloudDownload} overrideIcon={loadIcon} label={cloudSyncStatus === 'loading' ? 'Loading from cloud…' : 'Load from cloud'} onClick={actions.loadCloud} disabled={syncBusy} />
          <IconButton icon={FileCode} label="Export as Terraform" onClick={actions.openTerraform} />
        </ToolbarGroup>

        <GroupDivider />

        {/* Analyze — evaluator + AI-driven analysis tools (collapses when no AI profile is active) */}
        <ToolbarGroup>
          <IconButton icon={ShieldAlert} label="Policy evaluator (23 best-practice checks)" onClick={actions.openEvaluator} dataTour="evaluator-btn" />
          {aiProfileActive && (
            <>
              <IconButton icon={Sparkles} label="Ask AI (free-form chat)" onClick={actions.openAIChat} accent="purple" />
              <IconButton icon={Route} label="AI reachability — natural-language What-If" onClick={actions.openReachability} accent="purple" />
              <IconButton icon={FlaskConical} label="AI policy search" onClick={actions.openPolicySearch} accent="blue" />
              <IconButton icon={FileText} label="Auto-generate Markdown documentation" onClick={actions.openAutoDocs} accent="blue" />
            </>
          )}
        </ToolbarGroup>

        <GroupDivider />

        {/* Help — info, learning, gamification */}
        <ToolbarGroup>
          <IconButton icon={Lightbulb} label="WebGroup recommendations" onClick={actions.openRecommendations} accent="amber" />
          <IconButton icon={Medal} label={`Achievements (${unlocked} unlocked)`} onClick={actions.openAchievements} badge={unlocked > 0 ? unlocked : undefined} />
          <IconButton icon={BookOpen} label="Best practices reference" onClick={actions.openBestPractices} accent="blue" />
          <IconButton icon={HelpCircle} label="About & take the tour" onClick={actions.openAbout} dataTour="about-btn" />
        </ToolbarGroup>

        <GroupDivider />

        {/* Danger — destructive actions, isolated to reduce misclicks */}
        <ToolbarGroup>
          <IconButton icon={RotateCcw} label="Reset to starter topology" onClick={actions.resetDemo} accent="blue" />
          <IconButton icon={X} label="Clear all" onClick={actions.clearAll} accent="red" />
        </ToolbarGroup>

        <GroupDivider />

        {/* Corner — Settings: AI configuration + theme. Pinned to the far right. */}
        <ToolbarGroup>
          <IconButton
            icon={Bot}
            label="AI configuration"
            onClick={() => onViewChange('aiSettings')}
            active={viewMode === 'aiSettings'}
            accent="purple"
            dataTour="ai-settings-btn"
          />
          <IconButton
            icon={theme === 'dark' ? Sun : Moon}
            label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            onClick={onToggleTheme}
          />
        </ToolbarGroup>
      </div>
    </div>
  );
}

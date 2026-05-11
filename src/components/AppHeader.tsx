import {
  LayoutGrid, Activity, Sun, Moon, HelpCircle, BookOpen, FileCode, CloudUpload, CloudDownload,
  Check, Plus, X, GitGraph, ShieldAlert, Bot, Sparkles, FlaskConical, Upload, Trophy, Medal,
  RotateCcw, Lightbulb, FileText, LayoutTemplate, ListOrdered, Route,
} from 'lucide-react';
import type { DcfPolicyModel } from '../types/dcf';
import { scoreTopology } from '../lib/policyScorer';
import { getAllAchievements } from '../lib/achievements';

export type ViewMode = 'matrix' | 'graph' | 'traffic' | 'simulator';

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
  exportJSON: () => void;
  openTerraform: () => void;
  openAISettings: () => void;
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

const ICON_BTN_BASE = "p-1.5 rounded-md border transition-colors";
const ICON_BTN_STYLE = { backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' } as const;

function tabClass(active: boolean) {
  return `flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
    active ? 'bg-[var(--color-aviatrix)] text-white' : 'text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-button-hover)]'
  }`;
}

export default function AppHeader({ topology, viewMode, theme, cloudSyncStatus, aiProfileActive, onViewChange, onToggleTheme, actions }: AppHeaderProps) {
  const score = scoreTopology(topology);
  const allAch = getAllAchievements();
  const unlocked = allAch.filter((a) => a.unlockedAt).length;

  const hoverIn = (color: string) => (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
    e.currentTarget.style.color = color;
  };
  const hoverOut = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.currentTarget.style.backgroundColor = 'var(--color-surface)';
    e.currentTarget.style.color = 'var(--color-text-secondary)';
  };

  return (
    <div className="min-h-14 py-2 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] flex items-center justify-between px-4 shrink-0 gap-3">
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img src="/logo-header.png" alt="DCF Visualizer" className="h-14 w-auto rounded-md" />
          <h1 className="text-2xl font-bold text-[var(--color-text-primary)] tracking-wide hidden sm:inline">visualizer</h1>
        </div>
        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-1 shrink-0" />

        <div className="flex items-center gap-1 bg-[var(--color-surface)] rounded-lg p-0.5 border border-[var(--color-border-subtle)] shrink-0">
          <button onClick={() => onViewChange('matrix')} className={tabClass(viewMode === 'matrix')}>
            <LayoutGrid size={14} />
            <span className="hidden sm:inline">Matrix</span>
          </button>
          <button onClick={() => onViewChange('graph')} className={tabClass(viewMode === 'graph')}>
            <GitGraph size={14} />
            <span className="hidden sm:inline">Graph</span>
          </button>
          <button onClick={() => onViewChange('traffic')} className={tabClass(viewMode === 'traffic')}>
            <Activity size={14} />
            <span className="hidden sm:inline">Traffic</span>
          </button>
          <button onClick={() => onViewChange('simulator')} className={tabClass(viewMode === 'simulator')}>
            <FlaskConical size={14} />
            <span className="hidden sm:inline">Simulator</span>
          </button>
        </div>

        {score.totalPolicies > 0 && (
          <button
            onClick={actions.openEvaluator}
            className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md text-[10px] font-bold border transition-colors"
            style={{ backgroundColor: score.color + '15', borderColor: score.color + '40', color: score.color }}
            title="Average policy score. Click to open Evaluator."
          >
            <Trophy size={12} />
            {score.grade} · {score.average}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        <button onClick={actions.addGroup} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Add Group">
          <Plus size={14} />
        </button>

        <button onClick={actions.resetDemo} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-blue)')} onMouseLeave={hoverOut} title="Reset Demo">
          <RotateCcw size={14} />
        </button>

        <button onClick={actions.clearAll} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('#ef4444')} onMouseLeave={hoverOut} title="Clear All">
          <X size={14} />
        </button>

        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

        <button
          onClick={actions.saveCloud}
          disabled={cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading'}
          className={`${ICON_BTN_BASE} disabled:opacity-50 hidden md:flex`}
          style={{ ...ICON_BTN_STYLE, color: cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)' }}
          onMouseEnter={(e) => { if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; } }}
          onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-surface)'; e.currentTarget.style.color = cloudSyncStatus === 'saved' ? '#10b981' : cloudSyncStatus === 'error' ? '#ef4444' : 'var(--color-text-secondary)'; }}
          title={cloudSyncStatus === 'saved' ? 'Saved to cloud' : cloudSyncStatus === 'error' ? 'Sync failed' : 'Save to Cloud'}
        >
          {cloudSyncStatus === 'saving' ? (
            <span className="w-3.5 h-3.5 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
          ) : cloudSyncStatus === 'saved' ? (
            <Check size={14} />
          ) : (
            <CloudUpload size={14} />
          )}
        </button>

        <button
          onClick={actions.loadCloud}
          disabled={cloudSyncStatus === 'saving' || cloudSyncStatus === 'loading'}
          className={`${ICON_BTN_BASE} disabled:opacity-50 hidden md:flex`}
          style={ICON_BTN_STYLE}
          onMouseEnter={(e) => { if (cloudSyncStatus !== 'saving' && cloudSyncStatus !== 'loading') { e.currentTarget.style.backgroundColor = 'var(--color-button-hover)'; e.currentTarget.style.color = 'var(--color-text-primary)'; } }}
          onMouseLeave={hoverOut}
          title="Load from Cloud"
        >
          {cloudSyncStatus === 'loading' ? (
            <span className="w-3.5 h-3.5 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
          ) : (
            <CloudDownload size={14} />
          )}
        </button>

        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

        <button onClick={actions.openImport} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Import Topology">
          <Upload size={14} />
        </button>

        <button onClick={actions.openRecommendations} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('#f59e0b')} onMouseLeave={hoverOut} title="Recommended WebGroups">
          <Lightbulb size={14} />
        </button>

        <button onClick={actions.openTemplates} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-purple)')} onMouseLeave={hoverOut} title="Policy Templates">
          <LayoutTemplate size={14} />
        </button>

        <button onClick={actions.openReorderPolicies} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-blue)')} onMouseLeave={hoverOut} title="Reorder Policies">
          <ListOrdered size={14} />
        </button>

        <button onClick={actions.exportJSON} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Export JSON">
          <FileCode size={14} />
        </button>

        <button onClick={actions.openTerraform} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Export Terraform">
          <FileCode size={14} />
        </button>

        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5 hidden md:block" />

        <button onClick={actions.openEvaluator} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Policy Evaluator">
          <ShieldAlert size={14} />
        </button>

        <button onClick={actions.openAISettings} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="AI Settings">
          <Bot size={14} />
        </button>

        {aiProfileActive && (
          <button onClick={actions.openAIChat} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Ask AI">
            <Sparkles size={14} />
          </button>
        )}

        {aiProfileActive && (
          <button onClick={actions.openAutoDocs} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-blue)')} onMouseLeave={hoverOut} title="Auto-Generate Docs">
            <FileText size={14} />
          </button>
        )}

        {aiProfileActive && (
          <button onClick={actions.openReachability} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-purple)')} onMouseLeave={hoverOut} title="AI Reachability — natural-language What-If">
            <Route size={14} />
          </button>
        )}

        {aiProfileActive && (
          <button onClick={actions.openPolicySearch} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-blue)')} onMouseLeave={hoverOut} title="AI Policy Search — natural-language filter">
            <FlaskConical size={14} />
          </button>
        )}

        <div className="h-5 w-px bg-[var(--color-border-subtle)] mx-0.5" />

        <button onClick={onToggleTheme} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}>
          {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />}
        </button>

        <button onClick={actions.openAchievements} className={`${ICON_BTN_BASE} relative`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="Achievements">
          <Medal size={14} />
          {unlocked > 0 && (
            <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-[var(--color-aviatrix)] text-white text-[8px] flex items-center justify-center font-bold">
              {unlocked}
            </span>
          )}
        </button>

        <button onClick={actions.openBestPractices} className={`${ICON_BTN_BASE} hidden md:flex`} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-accent-blue)')} onMouseLeave={hoverOut} title="Best Practices Reference">
          <BookOpen size={14} />
        </button>

        <button onClick={actions.openAbout} className={ICON_BTN_BASE} style={ICON_BTN_STYLE} onMouseEnter={hoverIn('var(--color-text-primary)')} onMouseLeave={hoverOut} title="About">
          <HelpCircle size={14} />
        </button>
      </div>
    </div>
  );
}

import { useState, useCallback, useEffect, Suspense } from 'react';
import type { DcfPolicy } from './types/dcf';
import { lazyImport } from './lib/lazyImport';

import RecommendationsModal from './components/modals/RecommendationsModal';
import { isRecommendationsDismissed, dismissRecommendations, clearRecommendationsDismissal } from './lib/recommendationsDismissal';
import AboutModal from './components/modals/AboutModal';
import AchievementsModal from './components/modals/AchievementsModal';
import ConfirmModal from './components/modals/ConfirmModal';
import TerraformExportModal from './components/modals/TerraformExportModal';
import AppHeader, { type ViewMode, type AppHeaderActions } from './components/AppHeader';
import AchievementToaster from './components/AchievementToaster';
import Tour from './components/Tour';
import { isTourCompleted, wasTourAutoShown, markTourAutoShown } from './lib/tourDismissal';
import { hasAIDataConsent } from './lib/aiDataConsent';
const AIDataConsentModal = lazyImport(() => import('./components/modals/AIDataConsentModal'));
import PolicyMatrix from './components/panels/PolicyMatrix';
import InspectorPanel from './components/panels/InspectorPanel';
import PolicySimulator from './components/panels/PolicySimulator';
import TrafficFlowPanel from './components/panels/TrafficFlowPanel';

// Lazy-loaded: pull @xyflow/react, AI schemas, HCL parser, and content-heavy
// modals out of the initial bundle. lazyImport wraps React.lazy with a
// one-shot stale-chunk reload so a hashed filename change after a new deploy
// doesn't strand users with an open tab on a 404.
const PolicyGraph = lazyImport(() => import('./components/panels/PolicyGraph'));
const AISettingsPanel = lazyImport(() => import('./components/panels/AISettingsPanel'));
const AIChatPanel = lazyImport(() => import('./components/panels/AIChatPanel'));
const ImportPanel = lazyImport(() => import('./components/panels/ImportPanel'));
const BestPracticesModal = lazyImport(() => import('./components/modals/BestPracticesModal'));
const AutoDocsModal = lazyImport(() => import('./components/modals/AutoDocsModal'));
const ReachabilityModal = lazyImport(() => import('./components/modals/ReachabilityModal'));
const PolicySearchModal = lazyImport(() => import('./components/modals/PolicySearchModal'));
const PolicyTemplatesModal = lazyImport(() => import('./components/modals/PolicyTemplatesModal'));
const PolicyReorderModal = lazyImport(() => import('./components/modals/PolicyReorderModal'));
const EvaluatorPanel = lazyImport(() => import('./components/panels/EvaluatorPanel'));

function PanelLoader() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="w-6 h-6 border-2 border-[var(--color-text-muted)] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

import { saveTopologyToCloud, loadTopologyFromCloud } from './lib/upstashSync';
import { downloadTopologyJSON } from './lib/importExport';
import { evaluateTopology, applyAutoFix, type EvaluationReport } from './lib/policyEvaluator';
import { loadAISettings, saveAISettings, getDefaultAISettings } from './lib/ai/storage';
import type { AISettings } from './lib/ai/types';
import { useTheme } from './lib/useTheme';
import { useTopology } from './lib/useTopology';
import { useModalState } from './lib/useModalState';
import { demoTopology } from './data/demoTopology';

interface SelectedItem {
  type: 'policy' | 'smartGroup' | 'webGroup' | 'threatGroup' | 'geoGroup';
  id: string;
  srcId?: string;
  dstId?: string;
}

interface ConfirmState {
  open: boolean;
  title: string;
  message: string;
  onConfirm: () => void;
}

export default function App() {
  const { theme, toggleTheme } = useTheme();
  const { topology, dispatch, isFreshLoad } = useTopology();
  const modals = useModalState();

  const [viewMode, setViewMode] = useState<ViewMode>('matrix');
  const [selectedCell, setSelectedCell] = useState<{ srcId: string; dstId: string } | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedItem | null>(null);
  const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'saving' | 'saved' | 'loading' | 'error'>('idle');
  const [confirmModal, setConfirmModal] = useState<ConfirmState>({ open: false, title: '', message: '', onConfirm: () => {} });
  const [evaluatorReport, setEvaluatorReport] = useState<EvaluationReport | null>(null);
  const [aiSettings, setAISettings] = useState<AISettings>(getDefaultAISettings);

  // Load AI settings on mount
  useEffect(() => {
    loadAISettings().then((saved) => {
      if (saved) setAISettings(saved);
    }).catch(() => {});
  }, []);

  // Offer recommendations on fresh load (no existing topology + not previously dismissed)
  useEffect(() => {
    if (isFreshLoad && !isRecommendationsDismissed()) {
      modals.open('recommendations');
    }
  }, [isFreshLoad, modals]);

  // Auto-open the onboarding tour once per device, after any blocking modal
  // (recommendations / etc.) has closed.
  useEffect(() => {
    if (!isTourCompleted() && !wasTourAutoShown() && modals.active === null) {
      const t = setTimeout(() => {
        markTourAutoShown();
        modals.open('tour');
      }, 1200);
      return () => clearTimeout(t);
    }
  }, [modals]);

  const handleViewChange = (mode: ViewMode) => {
    setViewMode(mode);
    setSelectedCell(null);
    setSelectedItem(null);
  };

  const handleOpenEvaluator = useCallback(() => {
    setEvaluatorReport(evaluateTopology(topology));
  }, [topology]);

  const handleSelectCell = useCallback((srcId: string, dstId: string) => {
    setSelectedCell({ srcId, dstId });
    setSelectedItem(null);
  }, []);

  const handleSelectPolicy = useCallback((policyId: string | null, srcId?: string, dstId?: string) => {
    if (policyId) {
      setSelectedItem({ type: 'policy', id: policyId, srcId, dstId });
    } else {
      setSelectedItem(null);
    }
  }, []);

  const handleUpdateItem = useCallback((itemType: string, itemId: string, data: Record<string, unknown>) => {
    dispatch({ type: 'updateItem', itemType: itemType as 'policy', itemId, data });
  }, [dispatch]);

  const handleDeleteItem = useCallback((itemType: string, itemId: string) => {
    dispatch({ type: 'deleteItem', itemType: itemType as 'policy', itemId });
    setSelectedItem(null);
  }, [dispatch]);

  const handleCreateItem = useCallback((itemType: string, data: Record<string, unknown>) => {
    const id = `${itemType}-${Date.now()}`;
    dispatch({ type: 'createItem', itemType: itemType as 'smartGroup', id, data });
    setSelectedCell(null);
    setSelectedItem({ type: itemType as SelectedItem['type'], id });
  }, [dispatch]);

  const handleSaveToCloud = useCallback(async () => {
    setCloudSyncStatus('saving');
    try {
      await saveTopologyToCloud(topology);
      setCloudSyncStatus('saved');
      setTimeout(() => setCloudSyncStatus('idle'), 2000);
    } catch {
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus('idle'), 3000);
    }
  }, [topology]);

  const handleLoadFromCloud = useCallback(async () => {
    setCloudSyncStatus('loading');
    try {
      const saved = await loadTopologyFromCloud();
      if (saved) {
        dispatch({ type: 'replace', topology: saved });
        setSelectedItem(null);
      }
      setCloudSyncStatus('idle');
    } catch {
      setCloudSyncStatus('error');
      setTimeout(() => setCloudSyncStatus('idle'), 3000);
    }
  }, [dispatch]);

  const handleClearAll = useCallback(() => {
    setConfirmModal({
      open: true,
      title: 'Clear All',
      message: 'This will remove all groups and policies. This action cannot be undone.',
      onConfirm: () => {
        dispatch({ type: 'clearAll' });
        setSelectedItem(null);
        setConfirmModal((prev) => ({ ...prev, open: false }));
      },
    });
  }, [dispatch]);

  // Pending AI action: when the user clicks an AI button without having granted
  // data-egress consent, we stash the action here and open the consent modal.
  // The modal's onConfirm pops the action and runs it.
  const [pendingAIAction, setPendingAIAction] = useState<(() => void) | null>(null);
  const gateAI = useCallback((action: () => void) => () => {
    if (hasAIDataConsent()) { action(); return; }
    setPendingAIAction(() => action);
    modals.open('aiDataConsent');
  }, [modals]);

  const handleResetDemo = useCallback(() => {
    setConfirmModal({
      open: true,
      title: 'Reset Demo',
      message: 'This will restore the full demo topology with sample groups, policies, and WebGroup presets. Your current data will be replaced.',
      onConfirm: () => {
        dispatch({ type: 'replace', topology: structuredClone(demoTopology) });
        setSelectedItem(null);
        setSelectedCell(null);
        clearRecommendationsDismissal();
        modals.open('recommendations');
        setConfirmModal((prev) => ({ ...prev, open: false }));
      },
    });
  }, [dispatch, modals]);

  const headerActions: AppHeaderActions = {
    openEvaluator: handleOpenEvaluator,
    addGroup: () => handleCreateItem('smartGroup', {}),
    resetDemo: handleResetDemo,
    clearAll: handleClearAll,
    saveCloud: handleSaveToCloud,
    loadCloud: handleLoadFromCloud,
    openImport: () => modals.open('import'),
    openTemplates: () => modals.open('policyTemplates'),
    openReorderPolicies: () => modals.open('reorderPolicies'),
    openRecommendations: () => modals.open('recommendations'),
    exportJSON: () => downloadTopologyJSON(topology),
    openTerraform: () => modals.open('terraformExport'),
    openAISettings: () => modals.open('aiSettings'),
    openAIChat: gateAI(() => modals.open('aiChat')),
    openAutoDocs: gateAI(() => modals.open('autoDocs')),
    openReachability: gateAI(() => modals.open('reachability')),
    openPolicySearch: gateAI(() => modals.open('policySearch')),
    openAchievements: () => modals.open('achievements'),
    openBestPractices: () => modals.open('bestPractices'),
    openAbout: () => modals.open('about'),
  };

  const activeAIProfile = aiSettings.profiles?.find((p) => p.id === aiSettings.activeProfileId);

  return (
    <div className="flex h-full w-full">
      <div className="flex-1 flex flex-col min-w-0">
        <AppHeader
          topology={topology}
          viewMode={viewMode}
          theme={theme}
          cloudSyncStatus={cloudSyncStatus}
          aiProfileActive={!!aiSettings.activeProfileId}
          onViewChange={handleViewChange}
          onToggleTheme={toggleTheme}
          actions={headerActions}
        />

        <div className="flex-1 overflow-hidden">
          {viewMode === 'matrix' ? (
            <PolicyMatrix
              topology={topology}
              selectedCell={selectedCell}
              onSelectCell={handleSelectCell}
              onSelectGroup={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
              onSelectPolicy={handleSelectPolicy}
            />
          ) : viewMode === 'graph' ? (
            <Suspense fallback={<PanelLoader />}>
              <PolicyGraph
                topology={topology}
                onSelectNode={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
                onSelectPolicy={(policyId) => setSelectedItem({ type: 'policy', id: policyId })}
                onCreatePolicy={(srcId, dstId) => {
                  setSelectedCell({ srcId, dstId });
                  setSelectedItem({ type: 'policy', id: '__new__', srcId, dstId });
                }}
                onSelectGroup={(groupId) => setSelectedItem({ type: 'smartGroup', id: groupId })}
              />
            </Suspense>
          ) : viewMode === 'simulator' ? (
            <PolicySimulator topology={topology} />
          ) : (
            <TrafficFlowPanel
              topology={topology}
              onCreateFlow={(flow) => dispatch({ type: 'addFlow', flow: { ...flow, id: `flow-${Date.now()}` } })}
              onUpdateFlow={(id, data) => dispatch({ type: 'updateFlow', id, data })}
              onDeleteFlow={(id) => dispatch({ type: 'deleteFlow', id })}
            />
          )}
        </div>
      </div>

      <InspectorPanel
        topology={topology}
        selectedCell={selectedCell}
        selectedItem={selectedItem}
        aiProfile={activeAIProfile}
        onClose={() => {
          setSelectedCell(null);
          setSelectedItem(null);
        }}
        onUpdateItem={handleUpdateItem}
        onDeleteItem={handleDeleteItem}
        onCreateItem={handleCreateItem}
        onSelectPolicy={handleSelectPolicy}
      />

      {modals.isOpen('terraformExport') && (
        <TerraformExportModal topology={topology} onClose={modals.close} />
      )}

      {modals.isOpen('bestPractices') && (
        <Suspense fallback={null}>
          <BestPracticesModal onClose={modals.close} />
        </Suspense>
      )}

      {modals.isOpen('about') && (
        <AboutModal onClose={modals.close} onReplayTour={() => modals.open('tour')} />
      )}

      {confirmModal.open && (
        <ConfirmModal
          title={confirmModal.title}
          message={confirmModal.message}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal((prev) => ({ ...prev, open: false }))}
        />
      )}

      {evaluatorReport && (
        <Suspense fallback={null}>
        <EvaluatorPanel
          topology={topology}
          report={evaluatorReport}
          aiProfile={activeAIProfile}
          onClose={() => setEvaluatorReport(null)}
          onSelectPolicy={(policyId) => {
            setEvaluatorReport(null);
            setSelectedItem({ type: 'policy', id: policyId });
          }}
          onSelectGroup={(groupId) => {
            setEvaluatorReport(null);
            setSelectedItem({ type: 'smartGroup', id: groupId });
          }}
          onApplyFix={(finding) => {
            const fixed = applyAutoFix(topology, finding);
            if (fixed) {
              dispatch({ type: 'replace', topology: fixed });
              setEvaluatorReport(evaluateTopology(fixed));
            } else if (finding.affectedPolicyIds?.[0]) {
              setEvaluatorReport(null);
              setSelectedItem({ type: 'policy', id: finding.affectedPolicyIds[0] });
            } else if (finding.affectedGroupIds?.[0]) {
              setEvaluatorReport(null);
              setSelectedItem({ type: 'smartGroup', id: finding.affectedGroupIds[0] });
            }
          }}
        />
        </Suspense>
      )}

      {modals.isOpen('aiDataConsent') && (
        <Suspense fallback={null}>
          <AIDataConsentModal
            profile={activeAIProfile ?? null}
            onCancel={() => {
              setPendingAIAction(null);
              modals.close();
            }}
            onConfirm={() => {
              modals.close();
              const action = pendingAIAction;
              setPendingAIAction(null);
              if (action) action();
            }}
          />
        </Suspense>
      )}

      {modals.isOpen('aiSettings') && (
        <Suspense fallback={null}>
          <AISettingsPanel
            settings={aiSettings}
            onSave={(settings) => {
              setAISettings(settings);
              saveAISettings(settings).catch(() => {});
              modals.close();
            }}
            onClose={modals.close}
          />
        </Suspense>
      )}

      {modals.isOpen('aiChat') && activeAIProfile && (
        <Suspense fallback={null}>
        <AIChatPanel
          topology={topology}
          profile={activeAIProfile}
          onClose={modals.close}
          onApplyPolicy={(data) => {
            const srcName = String(data.srcGroupName || '');
            const dstName = String(data.dstGroupName || '');
            const srcGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === srcName.toLowerCase());
            const dstGroup = topology.smartGroups.find((g) => g.name.toLowerCase() === dstName.toLowerCase());

            if (!srcGroup || !dstGroup) {
              alert(`Groups not found: ${srcName} → ${dstName}. Create them first.`);
              return;
            }

            const newPolicy: DcfPolicy = {
              id: `pol-${Date.now()}`,
              name: String(data.name || 'AI Policy'),
              priority: Number(data.priority) || 100,
              srcGroupId: srcGroup.id,
              dstGroupId: dstGroup.id,
              action: (String(data.action || 'allow') as 'allow' | 'deny' | 'learned'),
              protocol: (String(data.protocol || 'tcp') as 'tcp' | 'udp' | 'icmp' | 'any'),
              ports: data.ports ? String(data.ports) : undefined,
              logging: Boolean(data.logging),
              decrypt: Boolean(data.decrypt),
            };

            dispatch({ type: 'replace', topology: { ...topology, policies: [...topology.policies, newPolicy] } });
            modals.close();
            setSelectedItem({ type: 'policy', id: newPolicy.id });
          }}
        />
        </Suspense>
      )}

      {modals.isOpen('import') && (
        <Suspense fallback={null}>
          <ImportPanel
            onImport={(imported) => dispatch({ type: 'replace', topology: imported })}
            onClose={modals.close}
          />
        </Suspense>
      )}

      {modals.isOpen('policyTemplates') && (
        <Suspense fallback={null}>
          <PolicyTemplatesModal
            topology={topology}
            onApply={(newTopology) => dispatch({ type: 'replace', topology: newTopology })}
            onClose={modals.close}
          />
        </Suspense>
      )}

      {modals.isOpen('reorderPolicies') && (
        <Suspense fallback={null}>
          <PolicyReorderModal
            topology={topology}
            aiProfile={hasAIDataConsent() ? activeAIProfile : null}
            onApply={(newTopology) => dispatch({ type: 'replace', topology: newTopology })}
            onClose={modals.close}
          />
        </Suspense>
      )}

      {modals.isOpen('autoDocs') && activeAIProfile && (
        <Suspense fallback={null}>
          <AutoDocsModal topology={topology} profile={activeAIProfile} onClose={modals.close} />
        </Suspense>
      )}

      {modals.isOpen('reachability') && activeAIProfile && (
        <Suspense fallback={null}>
          <ReachabilityModal
            topology={topology}
            profile={activeAIProfile}
            onSelectPolicy={(policyId) => {
              modals.close();
              setSelectedItem({ type: 'policy', id: policyId });
            }}
            onClose={modals.close}
          />
        </Suspense>
      )}

      {modals.isOpen('policySearch') && activeAIProfile && (
        <Suspense fallback={null}>
          <PolicySearchModal
            topology={topology}
            profile={activeAIProfile}
            onSelectPolicy={(policyId) => {
              modals.close();
              setSelectedItem({ type: 'policy', id: policyId });
            }}
            onClose={modals.close}
          />
        </Suspense>
      )}

      <AchievementToaster topology={topology} />

      {modals.isOpen('tour') && (
        <Tour
          aiProfileActive={!!aiSettings.activeProfileId}
          onClose={modals.close}
        />
      )}

      {modals.isOpen('recommendations') && (
        <RecommendationsModal
          existingNames={topology.webGroups.map((g) => g.name)}
          onAccept={(presets) => {
            dispatch({
              type: 'appendWebGroups',
              webGroups: presets.map((p) => ({
                id: `wg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                name: p.name,
                fqdns: p.fqdns,
              })),
            });
            dismissRecommendations();
            modals.close();
          }}
          onDismiss={() => {
            dismissRecommendations();
            modals.close();
          }}
        />
      )}

      {modals.isOpen('achievements') && (
        <AchievementsModal onClose={modals.close} />
      )}
    </div>
  );
}

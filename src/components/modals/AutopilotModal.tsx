import { useMemo, useState } from 'react';
import { X, Wand2, Sparkles, Loader2, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import type { AIProfile } from '../../lib/ai/types';
import {
  proposeAutopilotPlan,
  applyAutopilotCards,
  type AutopilotCard,
  type AutopilotCardCategory,
} from '../../lib/autopilot';
import { proposeAutopilotAICards } from '../../lib/autopilotAI';
import { diffTopologies } from '../../lib/topologyDiff';
import { TopologyDiffSections, DiffTotalsBadges } from '../diff/TopologyDiffView';

interface AutopilotModalProps {
  topology: DcfPolicyModel;
  /** Optional — when null, the "Get AI suggestions" button is hidden. */
  aiProfile: AIProfile | null;
  /** Apply the proposed-topology (after selected cards) to the live app state. */
  onApply: (next: DcfPolicyModel) => void;
  onClose: () => void;
}

/**
 * AutopilotModal — one-click topology optimization.
 *
 * Layout: two-pane modal. Left = list of toggleable "cards" (fix, reorder,
 * dedupe, normalize, AI). Right = live diff between the current topology and
 * "current with the selected cards applied". Apply button at the top runs a
 * single `{type:'replace'}` against the working set.
 *
 * AI is opt-in even with a profile present — the user clicks "Get AI
 * suggestions" to trigger the augmentation pass. Each AI suggestion lands as
 * a `defaultEnabled: false` card the user can review before checking.
 */
export default function AutopilotModal({ topology, aiProfile, onApply, onClose }: AutopilotModalProps) {
  // Deterministic cards are computed synchronously on mount — they don't need
  // network and run in <10ms even on a thousand-policy topology.
  const initialPlan = useMemo(() => proposeAutopilotPlan(topology), [topology]);
  const [cards, setCards] = useState<AutopilotCard[]>(initialPlan.cards);
  const [enabledIds, setEnabledIds] = useState<Set<string>>(
    () => new Set(initialPlan.cards.filter((c) => c.defaultEnabled).map((c) => c.id)),
  );
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiRequested, setAiRequested] = useState(false);

  const proposed = useMemo(
    () => applyAutopilotCards(topology, cards, enabledIds),
    [topology, cards, enabledIds],
  );
  const diff = useMemo(() => diffTopologies(topology, proposed), [topology, proposed]);

  const toggle = (id: string) => {
    setEnabledIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const enableAll = () => setEnabledIds(new Set(cards.map((c) => c.id)));
  const disableAll = () => setEnabledIds(new Set());

  const requestAI = async () => {
    if (!aiProfile) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const aiCards = await proposeAutopilotAICards(topology, aiProfile);
      setCards((prev) => {
        // Dedup by id in case the user clicks twice somehow — keeps the AI
        // cards merged in stable order at the end of the list.
        const existing = new Set(prev.map((c) => c.id));
        const fresh = aiCards.filter((c) => !existing.has(c.id));
        return [...prev, ...fresh];
      });
      setAiRequested(true);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'AI augmentation failed');
    } finally {
      setAiLoading(false);
    }
  };

  const grouped = useMemo(() => groupByCategory(cards), [cards]);
  const enabledCount = enabledIds.size;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-5xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Wand2 size={18} className="text-[var(--color-accent-purple)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Autopilot</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {cards.length} suggested change{cards.length === 1 ? '' : 's'} · {enabledCount} selected
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { onApply(proposed); onClose(); }}
              disabled={enabledCount === 0 || diff.isEmpty}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <CheckCircle2 size={14} />
              Apply
            </button>
            <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 flex min-h-0">
          {/* Left pane — card list */}
          <div
            className="w-96 shrink-0 border-r flex flex-col"
            style={{ borderColor: 'var(--color-border-subtle)' }}
          >
            <div
              className="px-3 py-2 border-b flex items-center justify-between text-[10px] text-[var(--color-text-muted)]"
              style={{ borderColor: 'var(--color-border-subtle)' }}
            >
              <span>{enabledCount} of {cards.length} cards on</span>
              <div className="flex items-center gap-1">
                <button onClick={enableAll} className="hover:text-[var(--color-text-primary)]">All</button>
                <span>·</span>
                <button onClick={disableAll} className="hover:text-[var(--color-text-primary)]">None</button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {cards.length === 0 ? (
                <div className="p-4 text-xs text-[var(--color-text-muted)]">
                  Your topology already looks clean — no deterministic changes needed.
                  {aiProfile && !aiRequested && ' Try AI suggestions for semantic refactors.'}
                </div>
              ) : (
                Object.entries(grouped).map(([category, items]) => (
                  <CategorySection
                    key={category}
                    category={category as AutopilotCardCategory}
                    cards={items}
                    enabledIds={enabledIds}
                    onToggle={toggle}
                  />
                ))
              )}
            </div>

            {aiProfile && (
              <div
                className="p-3 border-t"
                style={{ borderColor: 'var(--color-border-subtle)' }}
              >
                <button
                  onClick={requestAI}
                  disabled={aiLoading}
                  className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50"
                  style={{
                    backgroundColor: 'var(--color-surface)',
                    borderColor: 'var(--color-accent-purple)',
                    color: 'var(--color-accent-purple)',
                  }}
                >
                  {aiLoading ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                  {aiLoading
                    ? 'Asking AI…'
                    : aiRequested
                      ? 'Re-run AI suggestions'
                      : 'Get AI suggestions'}
                </button>
                {aiError && (
                  <p className="mt-2 text-[10px] text-red-400 flex items-start gap-1">
                    <AlertTriangle size={11} className="shrink-0 mt-0.5" /> {aiError}
                  </p>
                )}
              </div>
            )}
          </div>

          {/* Right pane — live diff */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {diff.isEmpty ? (
              <div className="text-xs text-[var(--color-text-muted)] py-6 text-center">
                {cards.length === 0
                  ? 'Nothing to optimize.'
                  : 'No changes selected. Check one or more cards to preview the diff.'}
              </div>
            ) : (
              <>
                <DiffTotalsBadges diff={diff} />
                <TopologyDiffSections diff={diff} />
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// =============================================================================
// Card list
// =============================================================================

const CATEGORY_LABELS: Record<AutopilotCardCategory, string> = {
  fix: 'Fixes',
  reorder: 'Reorder',
  dedupe: 'Dedupe',
  normalize: 'Normalize',
  ai: 'AI suggestions',
};

const CATEGORY_ORDER: AutopilotCardCategory[] = ['fix', 'reorder', 'dedupe', 'normalize', 'ai'];

function groupByCategory(cards: AutopilotCard[]): Partial<Record<AutopilotCardCategory, AutopilotCard[]>> {
  const out: Partial<Record<AutopilotCardCategory, AutopilotCard[]>> = {};
  for (const c of cards) {
    if (!out[c.category]) out[c.category] = [];
    out[c.category]!.push(c);
  }
  // Iteration order from category-keyed maps follows insertion order;
  // re-build in the canonical order so the section headers always read the
  // same way.
  const ordered: Partial<Record<AutopilotCardCategory, AutopilotCard[]>> = {};
  for (const cat of CATEGORY_ORDER) if (out[cat]) ordered[cat] = out[cat];
  return ordered;
}

function CategorySection({
  category,
  cards,
  enabledIds,
  onToggle,
}: {
  category: AutopilotCardCategory;
  cards: AutopilotCard[];
  enabledIds: Set<string>;
  onToggle: (id: string) => void;
}) {
  return (
    <div>
      <div
        className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-wider border-b"
        style={{
          backgroundColor: 'var(--color-surface)',
          color: 'var(--color-text-secondary)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        {CATEGORY_LABELS[category]} ({cards.length})
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {cards.map((card) => {
          const enabled = enabledIds.has(card.id);
          return (
            <li key={card.id}>
              <label className="flex items-start gap-2 px-3 py-2.5 cursor-pointer hover:bg-[var(--color-surface-elevated)] transition-colors">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={() => onToggle(card.id)}
                  className="mt-0.5 shrink-0 accent-[var(--color-aviatrix)]"
                />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium text-[var(--color-text-primary)]">{card.title}</p>
                  <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{card.description}</p>
                </div>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

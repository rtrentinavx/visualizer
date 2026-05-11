import { useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import { X, ArrowLeft, ArrowRight, Sparkles } from 'lucide-react';
import { markTourCompleted } from '../lib/tourDismissal';

interface TourStep {
  id: string;
  /** `data-tour` attribute value of the target element. Omit for a centered step. */
  target?: string;
  title: string;
  body: string;
  /** Show this step only when the predicate returns true. */
  showIf?: () => boolean;
}

interface TourProps {
  aiProfileActive: boolean;
  onClose: () => void;
}

const PADDING = 8;
const TOOLTIP_W = 320;
const TOOLTIP_GAP = 12;

function getSteps(aiProfileActive: boolean): TourStep[] {
  return [
    {
      id: 'welcome',
      title: 'Welcome to DCF Visualizer',
      body: 'A visual designer for Aviatrix Distributed Cloud Firewall policies. The whole topology is editable — SmartGroups, WebGroups, ThreatGroups, GeoGroups, and the policies that govern traffic between them. A quick 30-second tour?',
    },
    {
      id: 'views',
      target: 'view-tabs',
      title: 'Four lenses',
      body: 'Matrix shows policies as a grid of source→destination cells. Graph lays groups out as a force-directed network. Traffic logs concrete flows. Simulator answers "would this IP-to-IP traffic be allowed?" — all over the same model.',
    },
    {
      id: 'templates',
      target: 'templates-btn',
      title: 'Start from a template',
      body: 'Four pre-built patterns get you running: Zero Trust Default Deny, Bastion Access, Internet Egress with ThreatBlock, and Three-Tier Web Application. Existing groups are reused by name; duplicate policies are skipped.',
    },
    {
      id: 'evaluator',
      target: 'evaluator-btn',
      title: '23 automated checks',
      body: 'The Evaluator runs every policy against Aviatrix Best Practices, CIS, and NIST Zero Trust. Each finding shows which framework flagged it; ten common issues have one-click auto-fixes.',
    },
    {
      id: 'ai',
      target: 'ai-settings-btn',
      title: aiProfileActive ? 'AI assist is on' : 'Connect an AI provider',
      body: aiProfileActive
        ? 'You\'ve got an AI profile configured. The Sparkles, Route, FileText, and Search buttons let you ask reachability questions, generate Markdown docs, search policies, and have a free-form chat about your topology.'
        : 'Add a profile (OpenAI, Anthropic, Google, Ollama, LM Studio, AWS Bedrock, or a custom OpenAI-compatible endpoint) to unlock natural-language reachability, auto-documentation, policy search, and free-form chat.',
    },
    {
      id: 'reorder',
      target: 'reorder-btn',
      title: 'Reorder by drag',
      body: 'Open the policy reorder modal to drag rules into priority order. Priorities renumber to a uniform 10-step ladder so there\'s always room for inserts.',
    },
    {
      id: 'help',
      target: 'about-btn',
      title: 'Replay this tour any time',
      body: 'The About icon (?) has a "Take the tour" link if you want this walkthrough again. The Best Practices reference (book icon) has a deeper writeup of the Aviatrix rules.',
    },
  ];
}

export default function Tour({ aiProfileActive, onClose }: TourProps) {
  const allSteps = useMemo(() => getSteps(aiProfileActive), [aiProfileActive]);
  const steps = useMemo(() => allSteps.filter((s) => !s.showIf || s.showIf()), [allSteps]);
  const [stepIdx, setStepIdx] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);

  const step = steps[stepIdx];

  const recomputeRect = useCallback(() => {
    if (!step?.target) { setRect(null); return; }
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [step]);

  // DOM measurement: useLayoutEffect is the canonical hook for "measure layout
  // and re-render with the result". `set-state-in-effect` is over-strict here —
  // we genuinely cannot derive the target's rect; we must measure it.
  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    recomputeRect();
  }, [recomputeRect]);

  // Event subscriptions: keep rect in sync as the page reflows. setState here
  // fires from event handlers, not the effect body — the rule is satisfied.
  useEffect(() => {
    window.addEventListener('resize', recomputeRect);
    window.addEventListener('scroll', recomputeRect, true);
    return () => {
      window.removeEventListener('resize', recomputeRect);
      window.removeEventListener('scroll', recomputeRect, true);
    };
  }, [recomputeRect]);

  const complete = useCallback(() => {
    markTourCompleted();
    onClose();
  }, [onClose]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') complete();
      if (e.key === 'ArrowRight' || e.key === 'Enter') {
        if (stepIdx < steps.length - 1) setStepIdx((i) => i + 1);
        else complete();
      }
      if (e.key === 'ArrowLeft' && stepIdx > 0) setStepIdx((i) => i - 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [stepIdx, steps.length, complete]);

  if (!step) return null;

  // Position the tooltip near the target, or centered if no target.
  const tooltipStyle: React.CSSProperties = (() => {
    if (!rect) {
      return { left: '50%', top: '50%', transform: 'translate(-50%, -50%)' };
    }
    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    // Prefer below; fall back above if not enough room.
    const spaceBelow = viewportH - rect.bottom;
    const placeBelow = spaceBelow >= 180 || rect.top < 180;
    const top = placeBelow ? rect.bottom + TOOLTIP_GAP : rect.top - TOOLTIP_GAP;
    const transformY = placeBelow ? 'translateY(0)' : 'translateY(-100%)';
    // Horizontally, anchor to the target's left edge but keep within viewport.
    let left = rect.left;
    if (left + TOOLTIP_W > viewportW - 16) left = viewportW - TOOLTIP_W - 16;
    if (left < 16) left = 16;
    return { left, top, transform: transformY, width: TOOLTIP_W };
  })();

  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      {/* Dark overlay with a cutout around the target */}
      <svg className="absolute inset-0 w-full h-full pointer-events-auto" onClick={complete}>
        <defs>
          <mask id="tour-mask">
            <rect x={0} y={0} width="100%" height="100%" fill="white" />
            {rect && (
              <rect
                x={rect.left - PADDING}
                y={rect.top - PADDING}
                width={rect.width + PADDING * 2}
                height={rect.height + PADDING * 2}
                rx={8}
                ry={8}
                fill="black"
              />
            )}
          </mask>
        </defs>
        <rect x={0} y={0} width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)" />
        {rect && (
          <rect
            x={rect.left - PADDING}
            y={rect.top - PADDING}
            width={rect.width + PADDING * 2}
            height={rect.height + PADDING * 2}
            rx={8}
            ry={8}
            fill="none"
            stroke="var(--color-accent-blue, #3b82f6)"
            strokeWidth={2}
            strokeDasharray="6 4"
            pointerEvents="none"
          />
        )}
      </svg>

      {/* Tooltip card */}
      <div
        className="absolute rounded-xl border shadow-2xl pointer-events-auto"
        style={{
          ...tooltipStyle,
          backgroundColor: 'var(--color-surface-raised)',
          borderColor: 'var(--color-border-subtle)',
        }}
      >
        <div className="flex items-center justify-between px-4 pt-3">
          <div className="flex items-center gap-2">
            <Sparkles size={14} className="text-[var(--color-accent-purple)]" />
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
              Step {stepIdx + 1} of {steps.length}
            </span>
          </div>
          <button onClick={complete} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]" title="Skip tour">
            <X size={12} />
          </button>
        </div>
        <div className="px-4 py-3">
          <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-1">{step.title}</h3>
          <p className="text-xs text-[var(--color-text-secondary)] leading-relaxed">{step.body}</p>
        </div>
        <div className="px-4 pb-3 flex items-center justify-between border-t border-[var(--color-border-subtle)] pt-3">
          <button
            onClick={() => stepIdx > 0 && setStepIdx((i) => i - 1)}
            disabled={stepIdx === 0}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] disabled:opacity-30"
          >
            <ArrowLeft size={11} /> Back
          </button>
          <div className="flex items-center gap-1">
            {steps.map((_, i) => (
              <span
                key={i}
                className={`w-1.5 h-1.5 rounded-full ${i === stepIdx ? 'bg-[var(--color-accent-blue)]' : 'bg-[var(--color-border-subtle)]'}`}
              />
            ))}
          </div>
          {stepIdx === steps.length - 1 ? (
            <button
              onClick={complete}
              className="flex items-center gap-1 px-3 py-1 rounded text-[10px] font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              Done
            </button>
          ) : (
            <button
              onClick={() => setStepIdx((i) => i + 1)}
              className="flex items-center gap-1 px-3 py-1 rounded text-[10px] font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              Next <ArrowRight size={11} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

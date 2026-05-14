import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';
import { evaluateTopology, applyAutoFix, type Finding } from './policyEvaluator';

/**
 * Autopilot — one-click topology optimization.
 *
 * Phase 1 is the deterministic engine: given a topology, produce a list of
 * independently-toggleable "cards", each of which knows how to mutate the
 * topology to apply its single change. The UI shows the cards alongside a
 * live diff of "the topology with the currently-checked cards applied"; the
 * user toggles cards in/out and clicks Apply once.
 *
 * Cards are pure: `mutate(t)` returns a new topology, never mutates the
 * argument. `applyAutopilotCards` runs them in array order — fixes first,
 * then reorder, then dedupe, then normalize. Order matters because some
 * cards reduce the work later cards need to do (e.g. a fix that disables a
 * shadowed policy makes the renumber card cleaner).
 *
 * The AI augmentation pass (Phase 2) appends additional cards to the same
 * list — the UI doesn't need to distinguish them beyond the `category` tag.
 */

export type AutopilotCardCategory = 'fix' | 'reorder' | 'dedupe' | 'normalize' | 'ai';

export interface AutopilotCard {
  id: string;
  category: AutopilotCardCategory;
  title: string;
  description: string;
  /** Whether this card is checked by default in the UI. */
  defaultEnabled: boolean;
  /** Pure mutator. Returns a new DcfPolicyModel with the card applied. */
  mutate: (t: DcfPolicyModel) => DcfPolicyModel;
}

export interface AutopilotProposal {
  cards: AutopilotCard[];
}

/**
 * Produce an Autopilot proposal for a topology. Pure / deterministic — same
 * topology in, same proposal out (same card IDs, same ordering). AI cards
 * (Phase 2) are appended by a separate function.
 */
export function proposeAutopilotPlan(topology: DcfPolicyModel): AutopilotProposal {
  const cards: AutopilotCard[] = [];

  // 1. Fix cards — one per fixable evaluator finding. The evaluator already
  //    knows how to undo each one; we just wrap each finding as a card.
  const report = evaluateTopology(topology);
  for (const finding of report.findings) {
    if (!finding.fixable) continue;
    cards.push(fixCard(finding));
  }

  // 2. Renumber card — one card that resets policy priorities to a 10-step
  //    ladder (10, 20, 30…) in their current evaluation order. Only proposed
  //    when the existing priorities aren't already on the ladder.
  const renumber = renumberCard(topology);
  if (renumber) cards.push(renumber);

  // 3. Dedupe cards — one per exact-duplicate policy. The lower-priority
  //    duplicate is the one removed; the description names the rule that
  //    "wins" so the user can see why the dropped one would never fire.
  for (const card of dedupeCards(topology)) cards.push(card);

  // 4. Normalize names — one card that trims whitespace and collapses runs
  //    of spaces in policy/group names. Only proposed if any name is dirty.
  const norm = normalizeNamesCard(topology);
  if (norm) cards.push(norm);

  return { cards };
}

/**
 * Apply every card whose id is in `enabledIds`, in the order the cards were
 * proposed. Returns a new topology; the input is untouched.
 */
export function applyAutopilotCards(
  topology: DcfPolicyModel,
  cards: AutopilotCard[],
  enabledIds: ReadonlySet<string>,
): DcfPolicyModel {
  let next = topology;
  for (const card of cards) {
    if (!enabledIds.has(card.id)) continue;
    next = card.mutate(next);
  }
  return next;
}

// =============================================================================
// Card builders
// =============================================================================

function fixCard(finding: Finding): AutopilotCard {
  return {
    id: `fix-${finding.id}`,
    category: 'fix',
    title: finding.title,
    description: finding.fixDescription ?? finding.description,
    defaultEnabled: true,
    // applyAutoFix returns null when the finding has no auto-fix (shouldn't
    // happen here because we filter on `fixable`, but if a future finding
    // sets fixable without a handler, we fall back to a no-op).
    mutate: (t) => applyAutoFix(t, finding) ?? t,
  };
}

function renumberCard(topology: DcfPolicyModel): AutopilotCard | null {
  if (topology.policies.length === 0) return null;
  const sorted = [...topology.policies].sort((a, b) => a.priority - b.priority);
  const alreadyClean = sorted.every((p, i) => p.priority === (i + 1) * 10);
  if (alreadyClean) return null;
  return {
    id: 'reorder-ladder',
    category: 'reorder',
    title: 'Renumber priorities to a 10-step ladder',
    description: `Renumber the ${topology.policies.length} polic${topology.policies.length === 1 ? 'y' : 'ies'} to 10, 20, 30… in their current evaluation order. Keeps the same priority ordering but leaves room for inserts between rules.`,
    defaultEnabled: true,
    mutate: (t) => {
      const ordered = [...t.policies].sort((a, b) => a.priority - b.priority);
      return { ...t, policies: ordered.map((p, i) => ({ ...p, priority: (i + 1) * 10 })) };
    },
  };
}

interface Duplicate { keep: DcfPolicy; drop: DcfPolicy }

function dedupeCards(topology: DcfPolicyModel): AutopilotCard[] {
  const dups = findDuplicatePolicies(topology.policies);
  return dups.map(({ keep, drop }) => ({
    id: `dedupe-${drop.id}`,
    category: 'dedupe',
    title: `Remove duplicate policy "${drop.name}"`,
    description: `"${drop.name}" (priority ${drop.priority}) is functionally identical to "${keep.name}" (priority ${keep.priority}) — same src, dst, protocol, ports, action, and inspection attachments. The higher-priority rule wins, so the duplicate never fires.`,
    defaultEnabled: true,
    mutate: (t) => ({ ...t, policies: t.policies.filter((p) => p.id !== drop.id) }),
  }));
}

function normalizeNamesCard(topology: DcfPolicyModel): AutopilotCard | null {
  const dirtyCount = countDirtyNames(topology);
  if (dirtyCount === 0) return null;
  return {
    id: 'normalize-names',
    category: 'normalize',
    title: `Clean up ${dirtyCount} dirty name${dirtyCount === 1 ? '' : 's'}`,
    description: 'Trim leading/trailing whitespace and collapse multiple spaces in policy and group names. No behavior change — purely cosmetic.',
    defaultEnabled: true,
    mutate: (t) => ({
      ...t,
      policies: t.policies.map((p) => ({ ...p, name: cleanName(p.name) })),
      smartGroups: t.smartGroups.map((g) => ({ ...g, name: cleanName(g.name) })),
      webGroups: t.webGroups.map((g) => ({ ...g, name: cleanName(g.name) })),
      threatGroups: t.threatGroups.map((g) => ({ ...g, name: cleanName(g.name) })),
      geoGroups: t.geoGroups.map((g) => ({ ...g, name: cleanName(g.name) })),
    }),
  };
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Find pairs of policies where the *lower-priority* one is an exact duplicate
 * of a higher-priority one — same src/dst/protocol/ports/action plus the
 * three inspection-attachment fields (webGroupIds, threatGroup, geoGroup) so
 * we don't flag two policies that look the same at L4 but differ at L7.
 */
function findDuplicatePolicies(policies: DcfPolicy[]): Duplicate[] {
  const sorted = [...policies].sort((a, b) => a.priority - b.priority);
  const seen = new Map<string, DcfPolicy>();
  const dups: Duplicate[] = [];
  for (const p of sorted) {
    const key = policyKey(p);
    const existing = seen.get(key);
    if (existing) dups.push({ keep: existing, drop: p });
    else seen.set(key, p);
  }
  return dups;
}

function policyKey(p: DcfPolicy): string {
  return JSON.stringify([
    p.srcGroupId,
    p.dstGroupId,
    p.protocol,
    p.ports ?? null,
    p.action,
    (p.webGroupIds ?? []).slice().sort(),
    p.threatGroup ?? null,
    p.geoGroup ?? null,
    (p.srcExcludeGroupIds ?? []).slice().sort(),
    (p.dstExcludeGroupIds ?? []).slice().sort(),
  ]);
}

function isDirty(name: string): boolean {
  return name !== name.trim() || /\s{2,}/.test(name);
}

function countDirtyNames(t: DcfPolicyModel): number {
  let n = 0;
  for (const p of t.policies) if (isDirty(p.name)) n++;
  for (const g of t.smartGroups) if (isDirty(g.name)) n++;
  for (const g of t.webGroups) if (isDirty(g.name)) n++;
  for (const g of t.threatGroups) if (isDirty(g.name)) n++;
  for (const g of t.geoGroups) if (isDirty(g.name)) n++;
  return n;
}

function cleanName(name: string): string {
  return name.trim().replace(/\s+/g, ' ');
}

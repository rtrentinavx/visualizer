import { describe, it, expect } from 'vitest';
import { proposeAutopilotPlan, applyAutopilotCards } from './autopilot';
import { evaluateTopology } from './policyEvaluator';
import type { DcfPolicyModel, DcfPolicy } from '../types/dcf';

function blank(): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
    ],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

function pol(overrides: Partial<DcfPolicy> & { id: string }): DcfPolicy {
  return {
    name: overrides.id,
    priority: 100,
    srcGroupId: 'sg-any',
    dstGroupId: 'sg-any',
    action: 'allow',
    protocol: 'tcp',
    logging: true,
    ...overrides,
  };
}

describe('proposeAutopilotPlan — deterministic engine', () => {
  it('proposes zero cards for an empty topology', () => {
    const plan = proposeAutopilotPlan(blank());
    expect(plan.cards).toEqual([]);
  });

  it('emits a fix card for each fixable evaluator finding', () => {
    // A deny rule without logging is a known `fixable` finding ("Deny Policy
    // Without Logging" → enable logging on the rule).
    const t = blank();
    t.policies.push(pol({ id: 'pol-1', name: 'Deny Bad', action: 'deny', logging: false, priority: 100 }));
    const plan = proposeAutopilotPlan(t);
    const fixCards = plan.cards.filter((c) => c.category === 'fix');
    expect(fixCards.length).toBeGreaterThan(0);
    expect(fixCards.some((c) => c.id.startsWith('fix-missing-log-'))).toBe(true);
  });

  it('applying a fix card removes the corresponding finding', () => {
    const t = blank();
    t.policies.push(pol({ id: 'pol-1', name: 'Deny Bad', action: 'deny', logging: false, priority: 100 }));
    const plan = proposeAutopilotPlan(t);
    const fixCard = plan.cards.find((c) => c.id === 'fix-missing-log-pol-1');
    expect(fixCard).toBeDefined();
    const next = fixCard!.mutate(t);
    // Re-evaluate the resulting topology — the missing-log finding should be gone.
    const report = evaluateTopology(next);
    expect(report.findings.some((f) => f.id === 'missing-log-pol-1')).toBe(false);
  });

  it('emits a renumber card when priorities are not on a 10-step ladder', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 47 }));
    t.policies.push(pol({ id: 'p2', priority: 1234, srcGroupId: 'sg-internet' }));
    const plan = proposeAutopilotPlan(t);
    const reorder = plan.cards.find((c) => c.id === 'reorder-ladder');
    expect(reorder).toBeDefined();
    const next = reorder!.mutate(t);
    const priorities = next.policies.map((p) => p.priority).sort((a, b) => a - b);
    expect(priorities).toEqual([10, 20]);
  });

  it('does NOT emit a renumber card when priorities are already a clean ladder', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 10 }));
    t.policies.push(pol({ id: 'p2', priority: 20, srcGroupId: 'sg-internet' }));
    const plan = proposeAutopilotPlan(t);
    expect(plan.cards.find((c) => c.id === 'reorder-ladder')).toBeUndefined();
  });

  it('renumbering preserves the existing evaluation order (sorts by priority asc)', () => {
    const t = blank();
    // Three policies, scrambled priority order — final positions should be
    // p1 (priority 5) → 10, p2 (priority 100) → 20, p3 (priority 500) → 30.
    t.policies.push(pol({ id: 'p2', priority: 100, srcGroupId: 'sg-internet' }));
    t.policies.push(pol({ id: 'p3', priority: 500 }));
    t.policies.push(pol({ id: 'p1', priority: 5 }));
    const card = proposeAutopilotPlan(t).cards.find((c) => c.id === 'reorder-ladder')!;
    const next = card.mutate(t);
    expect(next.policies.find((p) => p.id === 'p1')!.priority).toBe(10);
    expect(next.policies.find((p) => p.id === 'p2')!.priority).toBe(20);
    expect(next.policies.find((p) => p.id === 'p3')!.priority).toBe(30);
  });

  it('emits a dedupe card per exact-duplicate policy (lower-priority duplicate is dropped)', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', name: 'Allow A', priority: 100 }));
    t.policies.push(pol({ id: 'p2', name: 'Allow A copy', priority: 200 })); // same key, lower priority
    t.policies.push(pol({ id: 'p3', name: 'Allow B', priority: 300, srcGroupId: 'sg-internet' }));
    const plan = proposeAutopilotPlan(t);
    const dedupeCards = plan.cards.filter((c) => c.category === 'dedupe');
    expect(dedupeCards).toHaveLength(1);
    expect(dedupeCards[0]!.id).toBe('dedupe-p2');
    const next = dedupeCards[0]!.mutate(t);
    expect(next.policies.map((p) => p.id).sort()).toEqual(['p1', 'p3']);
  });

  it('does NOT dedupe policies that match at L4 but differ at L7 attachments', () => {
    const t = blank();
    // Same src/dst/proto/ports/action, different webGroupIds → distinct rules
    // at L7, must keep both.
    t.policies.push(pol({ id: 'p1', srcGroupId: 'sg-any', dstGroupId: 'sg-internet', webGroupIds: ['wg-1'], priority: 100 }));
    t.policies.push(pol({ id: 'p2', srcGroupId: 'sg-any', dstGroupId: 'sg-internet', webGroupIds: ['wg-2'], priority: 200 }));
    const plan = proposeAutopilotPlan(t);
    expect(plan.cards.filter((c) => c.category === 'dedupe')).toHaveLength(0);
  });

  it('emits a single normalize card when names have whitespace problems', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', name: '  spaced  out  ' }));
    t.smartGroups.push({ id: 'sg-x', name: 'Two  spaces', color: '#fff', criteria: [], matchType: 'any' });
    const plan = proposeAutopilotPlan(t);
    const norm = plan.cards.find((c) => c.id === 'normalize-names');
    expect(norm).toBeDefined();
    expect(norm!.title).toMatch(/2 dirty names/);
    const next = norm!.mutate(t);
    expect(next.policies[0]!.name).toBe('spaced out');
    expect(next.smartGroups.find((g) => g.id === 'sg-x')!.name).toBe('Two spaces');
  });

  it('does NOT emit a normalize card when all names are already clean', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', name: 'clean name' }));
    const plan = proposeAutopilotPlan(t);
    expect(plan.cards.find((c) => c.id === 'normalize-names')).toBeUndefined();
  });

  it('is deterministic — same input produces the same card IDs in the same order', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', name: 'Deny X', action: 'deny', logging: false, priority: 47 }));
    t.policies.push(pol({ id: 'p2', name: '  dirty  ' }));
    const a = proposeAutopilotPlan(t);
    const b = proposeAutopilotPlan(t);
    expect(a.cards.map((c) => c.id)).toEqual(b.cards.map((c) => c.id));
  });
});

describe('applyAutopilotCards — selective apply', () => {
  it('returns the original topology when nothing is enabled', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 47, name: '  scruffy  ' }));
    const plan = proposeAutopilotPlan(t);
    const next = applyAutopilotCards(t, plan.cards, new Set());
    expect(next).toBe(t); // same reference — zero mutations applied
  });

  it('applies every card when all ids are enabled', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 47, name: '  scruffy  ', action: 'deny', logging: false }));
    const plan = proposeAutopilotPlan(t);
    const all = new Set(plan.cards.map((c) => c.id));
    const next = applyAutopilotCards(t, plan.cards, all);
    // Priority renumbered → 10. Name trimmed. Logging on.
    expect(next.policies[0]!.priority).toBe(10);
    expect(next.policies[0]!.name).toBe('scruffy');
    expect(next.policies[0]!.logging).toBe(true);
  });

  it('skips cards whose ids are not in the enabled set', () => {
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 47, name: '  scruffy  ', action: 'deny', logging: false }));
    const plan = proposeAutopilotPlan(t);
    // Enable only the renumber card; leave fix + normalize off.
    const onlyRenumber = new Set(['reorder-ladder']);
    const next = applyAutopilotCards(t, plan.cards, onlyRenumber);
    expect(next.policies[0]!.priority).toBe(10);   // renumber applied
    expect(next.policies[0]!.logging).toBe(false); // fix not applied
    expect(next.policies[0]!.name).toBe('  scruffy  '); // normalize not applied
  });

  it('is order-stable — cards apply in proposal order regardless of Set iteration order', () => {
    // The Set iteration order in JS is insertion order, but we want to be sure
    // applyAutopilotCards always uses the cards-array order, not the Set order.
    const t = blank();
    t.policies.push(pol({ id: 'p1', priority: 100, name: '  spaced  ' }));
    t.policies.push(pol({ id: 'p2', priority: 200, name: '  spaced  also  ', srcGroupId: 'sg-internet' }));
    const plan = proposeAutopilotPlan(t);
    const enabled = new Set(['normalize-names', 'reorder-ladder']); // reversed order
    const next = applyAutopilotCards(t, plan.cards, enabled);
    expect(next.policies.find((p) => p.id === 'p1')!.priority).toBe(10);
    expect(next.policies.find((p) => p.id === 'p1')!.name).toBe('spaced');
  });
});

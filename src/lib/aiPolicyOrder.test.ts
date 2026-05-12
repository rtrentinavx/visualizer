import { describe, it, expect } from 'vitest';
import type { DcfPolicy, DcfPolicyModel } from '../types/dcf';
import { _internals } from './aiPolicyOrder';
import { buildReorderPrompt } from './ai/promptsOrder';

const { validateOrderedIds } = _internals;

function policy(id: string, priority = 100): DcfPolicy {
  return {
    id, name: id, priority,
    srcGroupId: 'sg-any', dstGroupId: 'sg-any',
    action: 'allow', protocol: 'tcp', logging: true,
  };
}

function topologyWith(policies: DcfPolicy[]): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
    ],
    webGroups: [],
    threatGroups: [],
    geoGroups: [],
    policies,
    flows: [],
  };
}

describe('validateOrderedIds', () => {
  it('accepts a complete permutation of the topology ids', () => {
    const t = topologyWith([policy('a'), policy('b'), policy('c')]);
    expect(validateOrderedIds(['c', 'a', 'b'], t)).toBeNull();
  });

  it('rejects a missing id', () => {
    const t = topologyWith([policy('a'), policy('b'), policy('c')]);
    const err = validateOrderedIds(['a', 'b'], t);
    expect(err).toMatch(/^Reviewer returned 2 ids; topology has 3/);
  });

  it('rejects an extra (hallucinated) id', () => {
    const t = topologyWith([policy('a'), policy('b')]);
    const err = validateOrderedIds(['a', 'b', 'ghost'], t);
    expect(err).toMatch(/^Reviewer returned 3 ids; topology has 2/);
  });

  it('rejects duplicates even when the count matches', () => {
    const t = topologyWith([policy('a'), policy('b'), policy('c')]);
    const err = validateOrderedIds(['a', 'a', 'b'], t);
    expect(err).toMatch(/duplicate ids/);
  });

  it('rejects a same-count list with one swapped id', () => {
    // The function reports the issue from whichever side it sees first
    // (omission of "c", here) — both phrasings are valid rejections.
    const t = topologyWith([policy('a'), policy('b'), policy('c')]);
    const err = validateOrderedIds(['a', 'b', 'ghost'], t);
    expect(err).toMatch(/omitted policy id "c"|invented policy id "ghost"/);
  });

  it('an empty topology accepts an empty order', () => {
    const t = topologyWith([]);
    expect(validateOrderedIds([], t)).toBeNull();
  });
});

describe('buildReorderPrompt', () => {
  it('lists policies in current ascending-priority order with full attributes', () => {
    const t = topologyWith([
      policy('a', 200),
      policy('b', 100),
    ]);
    const out = buildReorderPrompt(t);
    // Policy "b" (priority 100) should appear before policy "a" (priority 200)
    // in the prompt text, regardless of insertion order.
    const ai = out.indexOf('id=a');
    const bi = out.indexOf('id=b');
    expect(bi).toBeGreaterThan(-1);
    expect(ai).toBeGreaterThan(bi);
  });

  it('wraps the topology context in untrusted-data delimiters', () => {
    const out = buildReorderPrompt(topologyWith([policy('p1')]));
    expect(out).toContain('<<<BEGIN_TOPOLOGY_DATA');
    expect(out).toContain('<<<END_TOPOLOGY_DATA>>>');
  });

  it('omits empty optional attributes from the per-policy line', () => {
    const out = buildReorderPrompt(topologyWith([policy('p1')]));
    expect(out).toContain('id=p1');
    expect(out).not.toContain('threatGroup=');
    expect(out).not.toContain('geoGroup=');
    expect(out).not.toContain('webGroups=');
  });
});

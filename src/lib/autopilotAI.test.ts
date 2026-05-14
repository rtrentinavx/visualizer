import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DcfPolicyModel } from '../types/dcf';
import type { AIProfile } from './ai/types';

// Mock the streaming AI client. The mock returns an async iterable whose
// chunks are whatever the test wants the model to "say" — including invalid
// JSON, refusals, and well-formed split suggestions.
const streamMock = vi.fn();
vi.mock('./ai/client', () => ({
  streamChat: (...args: unknown[]) => streamMock(...args),
}));

import { proposeAutopilotAICards, WIDE_WEBGROUP_THRESHOLD } from './autopilotAI';

function topologyWithWideWebGroup(fqdnCount = WIDE_WEBGROUP_THRESHOLD + 5): DcfPolicyModel {
  const fqdns = Array.from({ length: fqdnCount }, (_, i) => `*.host${i}.example.com`);
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
    ],
    webGroups: [{ id: 'wg-wide', name: 'Wide', fqdns }],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

function profile(): AIProfile {
  return {
    id: 'p1',
    name: 'test',
    provider: 'openai',
    model: 'gpt-4o-mini',
    apiKey: 'sk-test',
    temperature: 0,
  };
}

/**
 * Make streamChat yield a single chunk of `text`, then signal done. The
 * autopilotAI client iterates chunks until `done` is true, so a single chunk
 * is the simplest valid stream.
 */
function makeStream(text: string) {
  return async function* () {
    yield { content: text, done: false };
    yield { content: '', done: true };
  };
}

describe('proposeAutopilotAICards', () => {
  beforeEach(() => streamMock.mockReset());

  it('returns no cards when no WebGroup is wide enough', async () => {
    // Group with only THRESHOLD fqdns (not over) → skipped without ever calling AI.
    const t = topologyWithWideWebGroup(WIDE_WEBGROUP_THRESHOLD);
    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards).toEqual([]);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('emits an AI split card when the AI says the group should split', async () => {
    const t = topologyWithWideWebGroup();
    const fqdns = t.webGroups[0]!.fqdns;
    const payload = JSON.stringify({
      shouldSplit: true,
      reason: 'Two distinct vendor families',
      proposedSplits: [
        { name: 'Even hosts', fqdns: fqdns.filter((_, i) => i % 2 === 0) },
        { name: 'Odd hosts', fqdns: fqdns.filter((_, i) => i % 2 === 1) },
      ],
    });
    streamMock.mockImplementation(makeStream(payload));

    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards).toHaveLength(1);
    expect(cards[0]!.id).toBe('ai-split-wg-wide');
    expect(cards[0]!.category).toBe('ai');
    expect(cards[0]!.defaultEnabled).toBe(false);
    expect(cards[0]!.title).toMatch(/Split WebGroup "Wide" into 2 subgroups/);
  });

  it('drops the card when the AI says shouldSplit:false', async () => {
    const t = topologyWithWideWebGroup();
    streamMock.mockImplementation(
      makeStream(JSON.stringify({ shouldSplit: false, reason: 'Coherent vendor list' })),
    );
    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards).toEqual([]);
  });

  it('drops the card when the AI returns invalid JSON', async () => {
    const t = topologyWithWideWebGroup();
    streamMock.mockImplementation(makeStream('not json at all'));
    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards).toEqual([]);
  });

  it('drops the card when fewer than 2 splits are proposed', async () => {
    const t = topologyWithWideWebGroup();
    const fqdns = t.webGroups[0]!.fqdns;
    streamMock.mockImplementation(
      makeStream(JSON.stringify({
        shouldSplit: true,
        reason: 'only one bucket',
        proposedSplits: [{ name: 'Just one', fqdns }],
      })),
    );
    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards).toEqual([]);
  });

  it('swallows per-group errors so one bad call does not blank the pass', async () => {
    // Topology with two wide groups; first stream throws, second succeeds.
    const t = topologyWithWideWebGroup();
    t.webGroups.push({
      id: 'wg-2',
      name: 'Second',
      fqdns: Array.from({ length: WIDE_WEBGROUP_THRESHOLD + 2 }, (_, i) => `b${i}.example.com`),
    });
    const goodFqdns = t.webGroups[1]!.fqdns;
    streamMock
      .mockImplementationOnce(() => { throw new Error('boom'); })
      .mockImplementationOnce(makeStream(JSON.stringify({
        shouldSplit: true,
        reason: 'second OK',
        proposedSplits: [
          { name: 'A', fqdns: goodFqdns.slice(0, 3) },
          { name: 'B', fqdns: goodFqdns.slice(3) },
        ],
      })));
    const cards = await proposeAutopilotAICards(t, profile());
    expect(cards.map((c) => c.id)).toEqual(['ai-split-wg-2']);
  });

  it('honors the shouldSkip predicate', async () => {
    const t = topologyWithWideWebGroup();
    const cards = await proposeAutopilotAICards(t, profile(), {
      shouldSkip: (wg) => wg.id === 'wg-wide',
    });
    expect(cards).toEqual([]);
    expect(streamMock).not.toHaveBeenCalled();
  });

  it('applying the card actually splits the WebGroup in the resulting topology', async () => {
    const t = topologyWithWideWebGroup();
    const fqdns = t.webGroups[0]!.fqdns;
    streamMock.mockImplementation(
      makeStream(JSON.stringify({
        shouldSplit: true,
        reason: 'two buckets',
        proposedSplits: [
          { name: 'Bucket A', fqdns: fqdns.slice(0, 4) },
          { name: 'Bucket B', fqdns: fqdns.slice(4) },
        ],
      })),
    );
    const [card] = await proposeAutopilotAICards(t, profile());
    const next = card!.mutate(t);
    // Original wg-wide gone; two new WebGroups present.
    expect(next.webGroups.find((g) => g.id === 'wg-wide')).toBeUndefined();
    expect(next.webGroups.map((g) => g.name).sort()).toEqual(['Bucket A', 'Bucket B']);
  });
});

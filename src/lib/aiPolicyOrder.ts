import type { DcfPolicyModel } from '../types/dcf';
import type { AIProfile } from './ai/types';
import { chatCompletion } from './ai/client';
import { PolicyOrderSuggestionSchema, safeParseAIOutput } from './ai/schemas';
import { SYSTEM_PROMPT_REORDER, buildReorderPrompt } from './ai/promptsOrder';
import { PROMPT_VERSIONS } from './ai/prompts';

export interface AIPolicyOrderResult {
  ok: boolean;
  orderedIds?: string[];
  rationale?: string[];
  assumptions?: string[];
  error?: string;
}

/**
 * Validate that the AI's returned `orderedIds` is exactly the set of policy ids
 * in the topology — no additions, no omissions, no duplicates. Returns an error
 * message on mismatch, otherwise null. The caller must enforce this before
 * applying; the AI can hallucinate ids or drop them.
 */
function validateOrderedIds(orderedIds: string[], topology: DcfPolicyModel): string | null {
  const expected = new Set(topology.policies.map((p) => p.id));
  const received = new Set(orderedIds);
  if (received.size !== orderedIds.length) {
    return `Reviewer returned duplicate ids in orderedIds (length ${orderedIds.length}, unique ${received.size}).`;
  }
  if (received.size !== expected.size) {
    return `Reviewer returned ${received.size} ids; topology has ${expected.size}. Rejecting.`;
  }
  for (const id of expected) {
    if (!received.has(id)) return `Reviewer omitted policy id "${id}". Rejecting.`;
  }
  for (const id of received) {
    if (!expected.has(id)) return `Reviewer invented policy id "${id}". Rejecting.`;
  }
  return null;
}

export async function suggestPolicyOrder(profile: AIProfile, topology: DcfPolicyModel): Promise<AIPolicyOrderResult> {
  if (topology.policies.length === 0) {
    return { ok: true, orderedIds: [], rationale: ['No policies to reorder.'] };
  }
  try {
    const { content } = await chatCompletion(
      profile,
      [
        { role: 'system', content: SYSTEM_PROMPT_REORDER },
        { role: 'user', content: buildReorderPrompt(topology) },
      ],
      PROMPT_VERSIONS.reorder,
    );
    const parsed = safeParseAIOutput(PolicyOrderSuggestionSchema, content);
    if (!parsed.success) {
      return { ok: false, error: `Reviewer response could not be parsed: ${parsed.error}` };
    }
    const setError = validateOrderedIds(parsed.data.orderedIds, topology);
    if (setError) return { ok: false, error: setError };
    return {
      ok: true,
      orderedIds: parsed.data.orderedIds,
      rationale: parsed.data.rationale,
      assumptions: parsed.data.assumptions,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Reviewer call failed' };
  }
}

// Exported for testability.
export const _internals = { validateOrderedIds };

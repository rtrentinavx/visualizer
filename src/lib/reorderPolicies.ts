import type { DcfPolicyModel } from '../types/dcf';

const MIN_GAP = 10;

/**
 * Reassign policy priorities according to the user-provided order using a
 * minimal-perturbation strategy: each policy keeps its original priority value
 * when it is already ≥ (previous priority + MIN_GAP). Only policies that
 * would violate the strictly-ascending invariant are bumped — to exactly
 * (previous + MIN_GAP). This preserves Aviatrix band numbers (100s, 1000s,
 * 8000s…) instead of collapsing everything to a flat 10-step ladder.
 *
 * Policies absent from `orderedIds` are appended after the last ordered policy
 * using the same keep-or-bump rule (defensive; shouldn't normally occur).
 *
 * Pure function — does not mutate the input topology.
 */
export function reorderPolicies(topology: DcfPolicyModel, orderedIds: string[]): DcfPolicyModel {
  const byId = new Map(topology.policies.map((p) => [p.id, p]));
  const result: DcfPolicyModel['policies'] = [];
  let prev = 0;

  for (const id of orderedIds) {
    const p = byId.get(id);
    if (!p) continue;
    byId.delete(id);
    const priority = p.priority >= prev + MIN_GAP ? p.priority : prev + MIN_GAP;
    result.push({ ...p, priority });
    prev = priority;
  }

  // Tail: any policy not in orderedIds gets appended in original array order.
  byId.forEach((p) => {
    const priority = p.priority >= prev + MIN_GAP ? p.priority : prev + MIN_GAP;
    result.push({ ...p, priority });
    prev = priority;
  });

  return { ...topology, policies: result };
}

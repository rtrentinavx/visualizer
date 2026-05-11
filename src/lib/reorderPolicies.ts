import type { DcfPolicyModel } from '../types/dcf';

const PRIORITY_BASE = 100;
const PRIORITY_STEP = 10;

/**
 * Reassign policy priorities according to the user-provided order, using a
 * uniform 10-step ladder starting at 100. Policies in `orderedIds` keep their
 * other fields unchanged; only priority is rewritten. Policies absent from
 * `orderedIds` are appended at the end of the ladder (defensive; shouldn't
 * normally happen because the modal builds the order from the full list).
 *
 * Pure function — does not mutate the input topology.
 */
export function reorderPolicies(topology: DcfPolicyModel, orderedIds: string[]): DcfPolicyModel {
  const byId = new Map(topology.policies.map((p) => [p.id, p]));
  const result: DcfPolicyModel['policies'] = [];

  let index = 0;
  for (const id of orderedIds) {
    const p = byId.get(id);
    if (!p) continue;
    result.push({ ...p, priority: PRIORITY_BASE + index * PRIORITY_STEP });
    byId.delete(id);
    index += 1;
  }
  // Tail: any policy not in orderedIds gets appended in original order.
  byId.forEach((p) => {
    result.push({ ...p, priority: PRIORITY_BASE + index * PRIORITY_STEP });
    index += 1;
  });

  return { ...topology, policies: result };
}

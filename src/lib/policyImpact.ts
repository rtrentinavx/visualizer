import type { DcfPolicyModel, DcfPolicy, TrafficFlow } from '../types/dcf';

export type FlowOutcome = 'allow' | 'deny' | 'learned' | 'implicit-deny';

export interface FlowEvaluation {
  action: FlowOutcome;
  policyId: string | null;
}

/**
 * Evaluate which existing policy would match a given TrafficFlow, using the
 * same first-match-wins semantics as the IP-based simulator. Flows already
 * carry resolved src/dst SmartGroup ids, so we skip the IP-resolution step.
 *
 * Policies with `enforcement === false` are excluded (mirrors the runtime).
 */
export function evaluateFlow(topology: DcfPolicyModel, flow: TrafficFlow): FlowEvaluation {
  const srcGroupIds = [flow.srcGroupId, 'sg-any'];
  const dstGroupIds = [flow.dstGroupId, 'sg-any'];

  const candidates = topology.policies.filter((p) => {
    if (p.enforcement === false) return false;
    if (!srcGroupIds.includes(p.srcGroupId)) return false;
    if (!dstGroupIds.includes(p.dstGroupId)) return false;
    if (!(p.protocol === flow.protocol || p.protocol === 'any')) return false;
    if (p.ports && p.ports !== 'any') {
      const policyPorts = p.ports.split(',').map((s) => s.trim());
      if (!policyPorts.includes(String(flow.port))) return false;
    }
    if (p.srcExcludeGroupIds && p.srcExcludeGroupIds.some((eg) => srcGroupIds.includes(eg))) return false;
    if (p.dstExcludeGroupIds && p.dstExcludeGroupIds.some((eg) => dstGroupIds.includes(eg))) return false;
    return true;
  });

  const sorted = [...candidates].sort((a, b) => a.priority - b.priority);
  const winner = sorted[0];
  if (!winner) return { action: 'implicit-deny', policyId: null };
  return { action: winner.action, policyId: winner.id };
}

export interface FlowImpact {
  flow: TrafficFlow;
  beforeAction: FlowOutcome;
  afterAction: FlowOutcome;
  beforePolicyId: string | null;
  afterPolicyId: string | null;
  /** True when before/after produce a different action. */
  outcomeChanged: boolean;
  /** True when the same policy no longer matches (or a different one starts matching). */
  matchChanged: boolean;
}

/**
 * Run every flow through both `before` and `after` topologies and report the
 * differences. The two topologies should share the same flow list (only the
 * policy ruleset differs). Used by the PolicyInspector to preview the effect
 * of pending edits.
 */
export function compareImpact(
  before: DcfPolicyModel,
  after: DcfPolicyModel,
  flows: TrafficFlow[],
): FlowImpact[] {
  return flows.map((flow) => {
    const b = evaluateFlow(before, flow);
    const a = evaluateFlow(after, flow);
    return {
      flow,
      beforeAction: b.action,
      afterAction: a.action,
      beforePolicyId: b.policyId,
      afterPolicyId: a.policyId,
      outcomeChanged: b.action !== a.action,
      matchChanged: b.policyId !== a.policyId,
    };
  });
}

/**
 * Build the post-edit topology used as the `after` argument to compareImpact.
 * - mode='upsert' inserts the draft policy (replacing by id if present).
 * - mode='delete' removes the policy with the given id.
 */
export function withPolicyChange(
  topology: DcfPolicyModel,
  policy: DcfPolicy,
  mode: 'upsert' | 'delete',
): DcfPolicyModel {
  if (mode === 'delete') {
    return { ...topology, policies: topology.policies.filter((p) => p.id !== policy.id) };
  }
  const exists = topology.policies.some((p) => p.id === policy.id);
  return {
    ...topology,
    policies: exists
      ? topology.policies.map((p) => (p.id === policy.id ? policy : p))
      : [...topology.policies, policy],
  };
}

import type { DcfPolicyModel } from '../../types/dcf';
import type { Finding } from '../policyEvaluator';

export const SYSTEM_PROMPT_POLICY_GENERATION = `You are an expert Aviatrix Distributed Cloud Firewall (DCF) policy designer.
Your job is to help users create DCF policies from natural language descriptions.

Available actions: allow, deny, learned.
Directions: inbound, outbound, any.
Protocols: tcp, udp, icmp, any.

When the user describes a policy, respond with a structured JSON object:
{
  "name": "Human-readable policy name",
  "action": "allow|deny|learned",
  "direction": "inbound|outbound|any",
  "protocol": "tcp|udp|icmp|any",
  "ports": "8080,8443 or any",
  "srcGroupName": "Source group name (or 'Any')",
  "dstGroupName": "Destination group name (or 'Any')",
  "logging": true|false,
  "decrypt": true|false,
  "explanation": "Brief explanation of why this policy makes sense"
}

Rules:
- Only include fields that are relevant. If ports aren't mentioned, use "any".
- If the user mentions a group that doesn't exist yet, suggest creating it.
- Be conservative: prefer narrower rules over broad ones.
- HTTPS traffic should use TCP port 443.
- SSH should use TCP port 22.
- Database traffic (PostgreSQL, MySQL) should use TCP port 5432 or 3306.`;

export const SYSTEM_PROMPT_AUTO_FIX = `You are an expert Aviatrix DCF security auditor.
You are given a policy model issue and must suggest a specific fix.

Respond with a structured JSON object:
{
  "fixDescription": "What to change",
  "suggestedPolicy": { /* updated policy fields */ },
  "explanation": "Why this fix resolves the issue"
}

Only suggest changes that are safe and follow the principle of least privilege.`;

export const SYSTEM_PROMPT_EXPLAIN = `You are a network security expert explaining Aviatrix DCF policies to a non-technical audience.
Explain what the policy does, what traffic it affects, and any potential risks or gaps.
Keep it concise (2-3 sentences max).`;

export function buildContextPrompt(topology: DcfPolicyModel): string {
  const groups = topology.smartGroups.map((g) => `- ${g.name} (${g.workloadCount} workloads)`).join('\n');
  const policies = topology.policies.map((p) => {
    const src = topology.smartGroups.find((g) => g.id === p.srcGroupId)?.name || p.srcGroupId;
    const dst = topology.smartGroups.find((g) => g.id === p.dstGroupId)?.name || p.dstGroupId;
    return `- ${p.name}: ${src} → ${dst} | ${p.action} | ${p.protocol}/${p.ports || 'any'} | priority ${p.priority}`;
  }).join('\n');

  return `Current policy model context:\n\nSmartGroups:\n${groups || '(none)'}\n\nPolicies:\n${policies || '(none)'}`;
}

export function buildPolicyGenerationPrompt(topology: DcfPolicyModel, userRequest: string): string {
  return `${buildContextPrompt(topology)}\n\nUser request: ${userRequest}`;
}

export function buildAutoFixPrompt(topology: DcfPolicyModel, finding: Finding): string {
  return `${buildContextPrompt(topology)}\n\nIssue: ${finding.title}\n${finding.description}\n\nSuggest a fix.`;
}

export function buildExplainPrompt(policyJson: string): string {
  return `Explain this DCF policy in plain English:\n\n${policyJson}`;
}

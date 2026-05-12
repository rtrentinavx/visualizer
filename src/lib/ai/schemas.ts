import { z } from 'zod';

/**
 * Zod schemas for validating AI-generated policy suggestions.
 * Using Zod (already installed) for runtime output validation instead of custom parsing.
 */

export const PolicySuggestionSchema = z.object({
  name: z.string().min(1).max(100).describe('Descriptive policy name'),
  srcGroupName: z.string().min(1).describe('Source SmartGroup name'),
  dstGroupName: z.string().min(1).describe('Destination SmartGroup name'),
  action: z.enum(['allow', 'deny']).describe('Policy action'),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).optional().default('tcp'),
  ports: z.string().optional().describe('Comma-separated ports or "any"'),
  logging: z.boolean().optional().default(true),
  decrypt: z.boolean().optional().default(false),
  explanation: z.string().optional().describe('Why this policy is recommended'),
});

export const PolicySuggestionArraySchema = z.object({
  suggestions: z.array(PolicySuggestionSchema).min(1).max(10),
});

export const PolicyExplanationSchema = z.object({
  summary: z.string().min(10).describe('One-line summary of what the policy does'),
  securityImplications: z.string().optional().describe('Security implications of this policy'),
  recommendations: z.array(z.string()).optional().describe('List of improvement recommendations'),
});

export const EvaluatorFixSchema = z.object({
  fixDescription: z.string().min(10).describe('Description of the proposed fix'),
  action: z.enum(['modify', 'delete', 'create']).describe('Type of fix'),
  policyData: PolicySuggestionSchema.optional().describe('New or modified policy data'),
});

/**
 * AI-extracted intent from a natural-language reachability question.
 * The engine resolves names against the live topology; the AI just extracts.
 */
export const ReachabilityIntentSchema = z.object({
  canAnswer: z.boolean().describe('false if the question is too vague or out of scope'),
  clarification: z.string().optional().describe('If canAnswer is false, what should the user provide?'),
  srcGroupName: z.string().optional().describe('Name of the source SmartGroup, exactly as listed in the topology. Use "Any" if the user did not specify a source.'),
  dstGroupName: z.string().optional().describe('Name of the destination SmartGroup, exactly as listed. Omit if the destination is a WebGroup (SaaS) or just generic internet.'),
  dstWebGroupName: z.string().optional().describe('Name of the destination WebGroup, exactly as listed. Use this for SaaS, FQDN-based destinations (e.g. Salesforce → SaaS Essentials if that WebGroup contains salesforce.com).'),
  isInternet: z.boolean().optional().describe('True when the destination is generic internet (no specific group or webgroup).'),
  protocol: z.enum(['tcp', 'udp', 'icmp', 'any']).optional().describe('Network protocol. Infer from context (HTTPS → tcp, DNS → udp).'),
  port: z.number().optional().describe('Destination port. Infer if obvious (HTTPS → 443, SSH → 22, DNS → 53).'),
  assumptions: z.array(z.string()).optional().describe('What you inferred vs. what was explicit. Mark each inferred value: e.g. "Salesforce uses HTTPS over TCP/443 [INFERRED]".'),
});

export type ReachabilityIntent = z.infer<typeof ReachabilityIntentSchema>;

/**
 * AI-extracted filter from a natural-language policy-search question.
 * The engine applies the filter; the AI doesn't return policy ids.
 */
export const PolicySearchFilterSchema = z.object({
  canAnswer: z.boolean().describe('false if the question can\'t be turned into a filter'),
  clarification: z.string().optional().describe('If canAnswer is false, what should the user provide?'),
  srcGroupName: z.string().optional().describe('Exact SmartGroup name from the topology (or "Any"). Filter matches this name OR sg-any.'),
  dstGroupName: z.string().optional().describe('Exact destination SmartGroup name.'),
  dstWebGroupName: z.string().optional().describe('Exact WebGroup name if the user is asking about SaaS/FQDN destinations.'),
  actions: z.array(z.enum(['allow', 'deny', 'learned'])).optional().describe('Restrict to these action types.'),
  protocols: z.array(z.enum(['tcp', 'udp', 'icmp', 'any'])).optional().describe('Restrict to these protocols.'),
  containsPort: z.string().optional().describe('A single port string the policy must include (e.g. "443").'),
  hasThreatGroup: z.boolean().optional().describe('True → only policies with a ThreatGroup attached.'),
  hasGeoGroup: z.boolean().optional().describe('True → only policies with a GeoGroup attached.'),
  hasWebGroup: z.boolean().optional().describe('True → only policies with at least one WebGroup attached.'),
  decryptOnly: z.boolean().optional().describe('True → only TLS-decrypting policies.'),
  loggingDisabled: z.boolean().optional().describe('True → only policies with logging:false.'),
  assumptions: z.array(z.string()).optional(),
});

export type PolicySearchFilter = z.infer<typeof PolicySearchFilterSchema>;

/**
 * LLM-as-judge verdict on an AI-generated policy suggestion. A second AI call
 * with this schema runs against every AI suggestion before the user can apply
 * it. Fails closed: an unparseable verdict is treated as `safe: false`.
 */
export const JudgeVerdictSchema = z.object({
  safe: z.boolean().describe('false = block the user from applying this policy'),
  reason: z.string().min(1).describe('One-line summary of why the policy is safe or unsafe'),
  concerns: z.array(z.string()).optional().describe('Specific issues found (e.g. "references non-existent group X")'),
});

export type JudgeVerdict = z.infer<typeof JudgeVerdictSchema>;

/**
 * AI suggestion for the priority order of every policy in the topology.
 * The engine takes `orderedIds`, validates that the set matches the topology,
 * and renumbers via the existing 10-step ladder in `reorderPolicies`.
 */
export const PolicyOrderSuggestionSchema = z.object({
  orderedIds: z.array(z.string().min(1)).min(1).describe('Every policy id from the topology, sorted from highest-precedence (first-match) to lowest.'),
  rationale: z.array(z.string()).optional().describe('Short bullet points explaining the rearrangement.'),
  assumptions: z.array(z.string()).optional().describe('Anything the model inferred rather than read directly from the topology.'),
});

export type PolicyOrderSuggestion = z.infer<typeof PolicyOrderSuggestionSchema>;

export type PolicySuggestion = z.infer<typeof PolicySuggestionSchema>;
export type PolicySuggestionArray = z.infer<typeof PolicySuggestionArraySchema>;
export type PolicyExplanation = z.infer<typeof PolicyExplanationSchema>;
export type EvaluatorFix = z.infer<typeof EvaluatorFixSchema>;

/**
 * Safely parse AI JSON output against a Zod schema.
 * Returns { success: true, data } or { success: false, error }.
 */
export function safeParseAIOutput<T>(schema: z.ZodSchema<T>, raw: string): { success: true; data: T } | { success: false; error: string } {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = raw.match(/```json\s*([\s\S]*?)\s*```/);
    const cleaned = jsonMatch?.[1]?.trim() ?? raw.trim();
    const parsed = JSON.parse(cleaned);
    const result = schema.safeParse(parsed);
    if (result.success) {
      return { success: true, data: result.data };
    }
    return { success: false, error: result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ') };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : 'Invalid JSON from AI' };
  }
}

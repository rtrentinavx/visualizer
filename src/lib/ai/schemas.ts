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
    const cleaned = jsonMatch ? jsonMatch[1].trim() : raw.trim();
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

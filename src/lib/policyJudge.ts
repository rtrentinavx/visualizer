import type { DcfPolicyModel } from '../types/dcf';
import type { AIProfile } from './ai/types';
import { chatCompletion } from './ai/client';
import { JudgeVerdictSchema, safeParseAIOutput, type JudgeVerdict } from './ai/schemas';
import { SYSTEM_PROMPT_JUDGE, buildJudgePrompt } from './ai/promptsJudge';
import { PROMPT_VERSIONS } from './ai/prompts';

/**
 * Run an LLM-as-judge review on an AI-generated policy suggestion before the
 * user can apply it. Uses the same provider profile (cheap secondary call;
 * we don't require a separate judge profile). Fails closed — any error, any
 * unparseable response, any consent-missing condition produces `safe: false`
 * with a reason the UI can show.
 *
 * This is a defense-in-depth layer on top of the deterministic
 * `validatePolicySuggestion` check; the deterministic check still runs first.
 */
export async function judgePolicySuggestion(
  profile: AIProfile,
  suggestion: Record<string, unknown>,
  topology: DcfPolicyModel,
): Promise<JudgeVerdict> {
  try {
    const { content } = await chatCompletion(
      profile,
      [
        { role: 'system', content: SYSTEM_PROMPT_JUDGE },
        { role: 'user', content: buildJudgePrompt(suggestion, topology) },
      ],
      PROMPT_VERSIONS.judge,
    );
    const parsed = safeParseAIOutput(JudgeVerdictSchema, content);
    if (!parsed.success) {
      return {
        safe: false,
        reason: `Reviewer response could not be parsed — failing closed.`,
        concerns: [parsed.error],
      };
    }
    return parsed.data;
  } catch (err) {
    return {
      safe: false,
      reason: 'Reviewer call failed — failing closed.',
      concerns: [err instanceof Error ? err.message : String(err)],
    };
  }
}

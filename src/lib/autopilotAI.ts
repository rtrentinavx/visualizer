import type { DcfPolicyModel, WebGroup } from '../types/dcf';
import type { AIProfile, AIMessage } from './ai/types';
import { streamChat } from './ai/client';
import {
  SYSTEM_PROMPT_SPLIT_WEBGROUP,
  buildSplitWebGroupPrompt,
  PROMPT_VERSIONS,
} from './ai/prompts';
import { WebGroupSplitSuggestionSchema, safeParseAIOutput } from './ai/schemas';
import { applyWebGroupSplit } from './policyEvaluator';
import type { AutopilotCard } from './autopilot';

/**
 * Autopilot — AI augmentation pass (Phase 2).
 *
 * The deterministic engine (autopilot.ts) covers the changes we can derive
 * from the model alone: evaluator fixes, priority renumbering, exact-duplicate
 * pruning, name normalization. The AI pass adds suggestions that need
 * semantic judgment — currently: WebGroup splits for overly-broad groups.
 *
 * Each AI card is `defaultEnabled: false` — AI judgments need a human nod.
 * The card model is the same as the deterministic engine; the UI doesn't
 * have to distinguish AI cards beyond the `category: 'ai'` tag.
 *
 * Network shape: serial calls through `/api/ai/proxy` (the only client-side
 * AI path). The proxy rate-limits 30 req/min per IP, so we don't parallelize
 * — a topology with 5 wide WebGroups burns 5 of that budget already.
 */

/**
 * FQDN count above which a WebGroup is wide enough to ask the AI whether it
 * should split. Matches the evaluator's "wide-webgroup" check threshold.
 */
export const WIDE_WEBGROUP_THRESHOLD = 10;

export interface AutopilotAIOptions {
  /**
   * Predicate to skip individual WebGroups — e.g. ones the user has already
   * declined to split in this session. Optional; default skips nothing.
   */
  shouldSkip?: (wg: WebGroup) => boolean;
}

/**
 * Ask the AI for additional Autopilot cards. Returns the new cards only; the
 * caller appends them to the deterministic proposal. Throws on no AI profile;
 * individual per-card AI failures are swallowed so one bad call doesn't blank
 * the whole pass.
 */
export async function proposeAutopilotAICards(
  topology: DcfPolicyModel,
  profile: AIProfile,
  options: AutopilotAIOptions = {},
): Promise<AutopilotCard[]> {
  const cards: AutopilotCard[] = [];

  const wideGroups = topology.webGroups.filter(
    (wg) => wg.fqdns.length > WIDE_WEBGROUP_THRESHOLD && !(options.shouldSkip?.(wg) ?? false),
  );

  // Serial — see file header for rate-limit rationale.
  for (const wg of wideGroups) {
    const card = await buildSplitCard(topology, wg, profile);
    if (card) cards.push(card);
  }

  return cards;
}

async function buildSplitCard(
  topology: DcfPolicyModel,
  wg: WebGroup,
  profile: AIProfile,
): Promise<AutopilotCard | null> {
  const referencingPolicyNames = topology.policies
    .filter((p) => p.webGroupIds?.includes(wg.id))
    .map((p) => p.name);

  const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_SPLIT_WEBGROUP };
  const userMsg: AIMessage = {
    role: 'user',
    content: buildSplitWebGroupPrompt({
      webGroupName: wg.name,
      fqdns: wg.fqdns,
      referencingPolicyNames,
    }),
  };

  let text = '';
  try {
    for await (const chunk of streamChat(profile, [systemMsg, userMsg], PROMPT_VERSIONS.splitWebGroup)) {
      if (chunk.done) break;
      text += chunk.content;
    }
  } catch {
    return null;
  }

  const validated = safeParseAIOutput(WebGroupSplitSuggestionSchema, text);
  if (!validated.success) return null;
  const suggestion = validated.data;
  if (
    !suggestion.shouldSplit ||
    !suggestion.proposedSplits ||
    suggestion.proposedSplits.length < 2
  ) {
    return null;
  }

  // Snapshot the suggestion so the card's mutate function can run later
  // without re-querying the AI. The proposed splits are validated against the
  // original group's fqdn set inside applyWebGroupSplit — that's where the
  // anti-hallucination guard lives.
  const splits = suggestion.proposedSplits;
  const splitNames = splits.map((s) => s.name).join(', ');

  return {
    id: `ai-split-${wg.id}`,
    category: 'ai',
    title: `Split WebGroup "${wg.name}" into ${splits.length} subgroups`,
    description: `${suggestion.reason} Proposed splits: ${splitNames}.`,
    defaultEnabled: false,
    mutate: (t) => {
      const result = applyWebGroupSplit(t, wg.id, splits);
      return result?.topology ?? t;
    },
  };
}

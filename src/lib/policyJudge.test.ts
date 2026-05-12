import { describe, it, expect } from 'vitest';
import type { DcfPolicyModel } from '../types/dcf';
import { JudgeVerdictSchema, safeParseAIOutput } from './ai/schemas';
import { buildJudgePrompt } from './ai/promptsJudge';

// The full `judgePolicySuggestion` wrapper is a thin chatCompletion call —
// testing it end-to-end would require mocking fetch + Vercel proxy. The
// interesting surface is the schema parsing (which decides safe vs unsafe
// from the LLM's response) and the prompt builder (which controls what the
// reviewer model sees). Both are unit-testable.

function topology(): DcfPolicyModel {
  return {
    smartGroups: [
      { id: 'sg-any', name: 'Any', color: '#9ca3af', criteria: [], matchType: 'any' },
      { id: 'sg-internet', name: 'Internet', color: '#ef4444', criteria: [], matchType: 'any' },
      { id: 'sg-web', name: 'Web Tier', color: '#3b82f6', criteria: [], matchType: 'any' },
      { id: 'sg-db', name: 'Database', color: '#f59e0b', criteria: [], matchType: 'any' },
    ],
    webGroups: [{ id: 'wg-saas', name: 'SaaS Essentials', fqdns: ['*.salesforce.com'] }],
    threatGroups: [],
    geoGroups: [],
    policies: [],
    flows: [],
  };
}

describe('JudgeVerdictSchema', () => {
  it('parses a valid safe verdict', () => {
    const raw = '```json\n{ "safe": true, "reason": "Specific src + dst with logging." }\n```';
    const r = safeParseAIOutput(JudgeVerdictSchema, raw);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.safe).toBe(true);
      expect(r.data.reason).toContain('logging');
    }
  });

  it('parses a valid unsafe verdict with concerns', () => {
    const raw = '```json\n{ "safe": false, "reason": "Allow any to any.", "concerns": ["Source is Any", "Destination is Any"] }\n```';
    const r = safeParseAIOutput(JudgeVerdictSchema, raw);
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.safe).toBe(false);
      expect(r.data.concerns).toHaveLength(2);
    }
  });

  it('rejects malformed responses (missing required field)', () => {
    const raw = '```json\n{ "safe": true }\n```';
    const r = safeParseAIOutput(JudgeVerdictSchema, raw);
    expect(r.success).toBe(false);
    // The caller (judgePolicySuggestion) converts this to `safe: false` —
    // fail closed.
  });

  it('rejects empty-reason responses', () => {
    const raw = '```json\n{ "safe": true, "reason": "" }\n```';
    const r = safeParseAIOutput(JudgeVerdictSchema, raw);
    expect(r.success).toBe(false);
  });
});

describe('buildJudgePrompt', () => {
  it('lists only real group names (skips sg-any and sg-internet)', () => {
    const out = buildJudgePrompt({ name: 'Allow Web to DB', action: 'allow' }, topology());
    expect(out).toContain('Web Tier');
    expect(out).toContain('Database');
    // The reviewer should never see "Any" listed as a real group name —
    // it's a special token.
    expect(out).not.toMatch(/SmartGroup names in topology: .*\bAny\b/);
  });

  it('wraps the topology context in untrusted-data delimiters', () => {
    const out = buildJudgePrompt({ name: 'X', action: 'deny' }, topology());
    expect(out).toContain('<<<BEGIN_TOPOLOGY_DATA');
    expect(out).toContain('<<<END_TOPOLOGY_DATA>>>');
  });

  it('serializes the suggestion as JSON inside the prompt', () => {
    const out = buildJudgePrompt({ name: 'My Policy', action: 'allow', ports: '443' }, topology());
    expect(out).toContain('"name": "My Policy"');
    expect(out).toContain('"ports": "443"');
  });
});

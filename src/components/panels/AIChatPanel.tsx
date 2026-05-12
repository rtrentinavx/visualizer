import { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Check, Loader2, AlertCircle, Sparkles, ThumbsUp, ThumbsDown, ShieldAlert } from 'lucide-react';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat, postProcessAIOutput } from '../../lib/ai/client';
import { SYSTEM_PROMPT_POLICY_GENERATION, buildPolicyGenerationPrompt, PROMPT_VERSIONS } from '../../lib/ai/prompts';
import { sanitizeInput, delimitUserInput, scanInput, validatePolicySuggestion } from '../../lib/ai/safety';
import { PolicySuggestionArraySchema, safeParseAIOutput } from '../../lib/ai/schemas';
import { judgePolicySuggestion } from '../../lib/policyJudge';
import type { DcfPolicyModel } from '../../types/dcf';

interface AIChatPanelProps {
  topology: DcfPolicyModel;
  profile: AIProfile;
  onClose: () => void;
  onApplyPolicy: (policyData: Record<string, unknown>) => void;
}

type JudgeStatus = 'pending' | 'safe' | 'unsafe';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  parsed?: Record<string, unknown> | null;
  error?: boolean;
  safetyWarning?: string;
  feedback?: 'up' | 'down' | null;
  /** LLM-as-judge verdict on a parsed policy suggestion. */
  judgeStatus?: JudgeStatus;
  judgeReason?: string;
  judgeConcerns?: string[];
}

export default function AIChatPanel({ topology, profile, onClose, onApplyPolicy }: AIChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [abortController, setAbortController] = useState<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isStreaming]);

  const handleSend = async () => {
    if (!input.trim() || isStreaming) return;

    const rawText = input.trim();
    const userText = sanitizeInput(rawText);
    setInput('');

    // Safety scan
    const scan = scanInput(userText);
    const safetyWarning = scan.status !== 'clean' ? scan.reason : undefined;

    const userMsg: ChatMessage = { role: 'user', content: userText, safetyWarning };
    setMessages((prev) => [...prev, userMsg]);

    // Block if injection detected
    if (scan.status === 'blocked') {
      setMessages((prev) => [...prev, {
        role: 'assistant',
        content: 'I cannot process this request. It contains patterns that may be attempting to override my instructions. Please describe your DCF policy need in plain language.',
        error: true,
      }]);
      return;
    }

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_POLICY_GENERATION };
    const delimitedUserInput = delimitUserInput(userText);
    const contextMsg: AIMessage = { role: 'user', content: buildPolicyGenerationPrompt(topology, delimitedUserInput) };

    setIsStreaming(true);
    const controller = new AbortController();
    setAbortController(controller);

    let fullContent = '';

    try {
      for await (const chunk of streamChat(profile, [systemMsg, contextMsg], PROMPT_VERSIONS.policyGeneration, controller.signal)) {
        if (chunk.done) break;
        fullContent += chunk.content;
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.role === 'assistant' && !last.parsed) {
            const next = [...prev];
            next[next.length - 1] = { ...last, content: fullContent };
            return next;
          }
          return [...prev, { role: 'assistant', content: fullContent }];
        });
      }

      // Output content filtering
      const filtered = postProcessAIOutput(fullContent);
      if (!filtered.ok) {
        setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${filtered.reason}`, error: true }]);
        return;
      }

      // Validate with Zod schema
      const validated = safeParseAIOutput(PolicySuggestionArraySchema, fullContent);
      let parsed: Record<string, unknown> | null = null;
      if (validated.success && validated.data.suggestions.length > 0) {
        parsed = validated.data.suggestions[0] as Record<string, unknown>;
      }

      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last) next[next.length - 1] = { ...last, parsed, judgeStatus: parsed ? 'pending' : undefined };
        return next;
      });

      // LLM-as-judge: defense-in-depth review of the AI's policy suggestion
      // before the user can apply it. Fails closed (unsafe) on any error.
      if (parsed) {
        const suggestion = parsed;
        judgePolicySuggestion(profile, suggestion, topology).then((verdict) => {
          setMessages((prev) => prev.map((m) => {
            if (m.parsed !== suggestion) return m;
            return {
              ...m,
              judgeStatus: verdict.safe ? 'safe' : 'unsafe',
              judgeReason: verdict.reason,
              judgeConcerns: verdict.concerns,
            };
          }));
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      setMessages((prev) => [...prev, { role: 'assistant', content: `Error: ${msg}`, error: true }]);
    } finally {
      setIsStreaming(false);
      setAbortController(null);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleApply = (msg: ChatMessage) => {
    if (!msg.parsed) return;
    // Layer 1: deterministic validator (validatePolicySuggestion).
    const safety = validatePolicySuggestion(msg.parsed);
    if (!safety.safe) {
      setMessages((prev) => {
        const next = [...prev];
        const idx = next.indexOf(msg);
        if (idx !== -1) {
          next[idx] = { ...msg, safetyWarning: `Safety check blocked this policy: ${safety.reason}` };
        }
        return next;
      });
      return;
    }
    // Layer 2: LLM-as-judge. Pending/unsafe both block — the button is
    // disabled in the UI, but we double-check here defensively.
    if (msg.judgeStatus !== 'safe') return;
    onApplyPolicy(msg.parsed);
  };

  const handleCancel = () => {
    abortController?.abort();
    setIsStreaming(false);
    setAbortController(null);
  };

  const handleFeedback = (index: number, feedback: 'up' | 'down') => {
    setMessages((prev) => {
      const next = [...prev];
      const target = next[index];
      if (target) next[index] = { ...target, feedback };
      return next;
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg h-[80vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Sparkles size={18} className="text-[var(--color-accent-purple)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">AI Policy Assistant</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {profile.name} · {profile.model} · Prompt v{PROMPT_VERSIONS.policyGeneration}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Safety Banner */}
        <div className="px-4 py-2 border-b border-[var(--color-border-subtle)] bg-amber-500/5 flex items-start gap-2">
          <ShieldAlert size={14} className="text-amber-400 shrink-0 mt-0.5" />
          <p className="text-[10px] text-amber-400 leading-relaxed">
            AI-generated policies should be reviewed before deployment. The AI does not have access to your live infrastructure.
            Never deploy allow-any-to-any rules in production.
          </p>
        </div>

        {/* Chat Area */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
          {messages.length === 0 && (
            <div className="text-center py-8 space-y-3">
              <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[var(--color-accent-purple)]/10">
                <Sparkles size={24} className="text-[var(--color-accent-purple)]" />
              </div>
              <p className="text-sm text-[var(--color-text-secondary)]">Describe a policy in plain English</p>
              <div className="space-y-1.5">
                {[
                  'Allow web tier to reach app tier on port 8080',
                  'Deny all traffic from the internet to the database',
                  'Allow monitoring to pull metrics from all groups on port 9100',
                ].map((example) => (
                  <button
                    key={example}
                    onClick={() => { setInput(example); }}
                    className="block w-full text-left px-3 py-2 rounded text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface)] transition-colors border border-transparent hover:border-[var(--color-border-subtle)]"
                  >
                    "{example}"
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((msg, i) => (
            <div key={i} className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
              <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 ${
                msg.role === 'user'
                  ? 'bg-[var(--color-accent-blue)]'
                  : msg.error
                  ? 'bg-red-500/20'
                  : 'bg-[var(--color-accent-purple)]/20'
              }`}>
                {msg.role === 'user' ? (
                  <User size={14} className="text-white" />
                ) : msg.error ? (
                  <AlertCircle size={14} className="text-red-400" />
                ) : (
                  <Bot size={14} className="text-[var(--color-accent-purple)]" />
                )}
              </div>

              <div className={`flex-1 min-w-0 ${msg.role === 'user' ? 'text-right' : ''}`}>
                {/* Safety warning for suspicious input */}
                {msg.safetyWarning && (
                  <div className="mb-1 text-[10px] text-amber-400">
                    ⚠️ {msg.safetyWarning}
                  </div>
                )}

                <div
                  className={`inline-block text-xs rounded-lg px-3 py-2 whitespace-pre-wrap ${
                    msg.role === 'user'
                      ? 'bg-[var(--color-accent-blue)] text-white text-left'
                      : msg.error
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-[var(--color-surface)] text-[var(--color-text-secondary)] border border-[var(--color-border-subtle)]'
                  }`}
                >
                  {msg.content}
                </div>

                {/* Parsed policy preview */}
                {msg.role === 'assistant' && msg.parsed && (
                  <div className="mt-2 p-3 rounded-lg border bg-[var(--color-surface)]" style={{ borderColor: 'var(--color-border-subtle)' }}>
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">Suggested Policy</div>
                    <div className="space-y-1 text-xs text-[var(--color-text-secondary)]">
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Name</span><span>{String(msg.parsed.name || '—')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Action</span><span className="capitalize">{String(msg.parsed.action || '—')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Direction</span><span className="capitalize">{String(msg.parsed.direction || '—')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Protocol</span><span className="uppercase">{String(msg.parsed.protocol || '—')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Ports</span><span>{String(msg.parsed.ports || 'any')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Source</span><span>{String(msg.parsed.srcGroupName || '—')}</span></div>
                      <div className="flex justify-between"><span className="text-[var(--color-text-muted)]">Destination</span><span>{String(msg.parsed.dstGroupName || '—')}</span></div>
                    </div>
                    {/* LLM-as-judge verdict — gates Apply */}
                    {msg.judgeStatus === 'pending' && (
                      <div className="mt-3 flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                        <Loader2 size={11} className="animate-spin" />
                        Reviewer is checking this policy…
                      </div>
                    )}
                    {msg.judgeStatus === 'safe' && (
                      <div className="mt-3 flex items-start gap-1.5 text-[10px] text-emerald-500">
                        <ShieldAlert size={11} className="mt-0.5 shrink-0" />
                        <div>
                          <div className="font-semibold">Reviewer approved</div>
                          {msg.judgeReason && <div className="text-[var(--color-text-muted)]">{msg.judgeReason}</div>}
                        </div>
                      </div>
                    )}
                    {msg.judgeStatus === 'unsafe' && (
                      <div className="mt-3 flex items-start gap-1.5 text-[10px] text-red-400">
                        <ShieldAlert size={11} className="mt-0.5 shrink-0" />
                        <div>
                          <div className="font-semibold">Reviewer rejected</div>
                          <div>{msg.judgeReason}</div>
                          {msg.judgeConcerns && msg.judgeConcerns.length > 0 && (
                            <ul className="mt-1 list-disc list-inside text-[var(--color-text-muted)]">
                              {msg.judgeConcerns.map((c, j) => <li key={j}>{c}</li>)}
                            </ul>
                          )}
                        </div>
                      </div>
                    )}

                    <button
                      onClick={() => handleApply(msg)}
                      disabled={msg.judgeStatus !== 'safe'}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                      style={{ backgroundColor: 'var(--color-aviatrix)' }}
                      title={msg.judgeStatus !== 'safe' ? 'Reviewer must approve before applying' : 'Apply this policy'}
                    >
                      <Check size={12} />
                      {msg.judgeStatus === 'pending' ? 'Reviewing…' : msg.judgeStatus === 'unsafe' ? 'Blocked by reviewer' : 'Apply Policy'}
                    </button>
                    <p className="text-[9px] text-[var(--color-text-muted)] mt-2 text-center">
                      AI-generated suggestion · Two-layer review (deterministic + LLM-as-judge) · Values marked [INFERRED] are not from your topology
                    </p>
                  </div>
                )}

                {/* Feedback buttons */}
                {msg.role === 'assistant' && !msg.error && !isStreaming && (
                  <div className="mt-1 flex items-center gap-1">
                    {msg.parsed ? (
                      <span className="text-[10px] text-green-400">✓ Validated</span>
                    ) : (
                      <span className="text-[10px] text-[var(--color-text-muted)]">Could not parse</span>
                    )}
                    <button
                      onClick={() => handleFeedback(i, 'up')}
                      className={`p-1 rounded transition-colors ${msg.feedback === 'up' ? 'text-green-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                    >
                      <ThumbsUp size={12} />
                    </button>
                    <button
                      onClick={() => handleFeedback(i, 'down')}
                      className={`p-1 rounded transition-colors ${msg.feedback === 'down' ? 'text-red-400' : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'}`}
                    >
                      <ThumbsDown size={12} />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}

          {isStreaming && messages[messages.length - 1]?.role === 'assistant' && (
            <div className="flex gap-3">
              <div className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 bg-[var(--color-accent-purple)]/20">
                <Loader2 size={14} className="text-[var(--color-accent-purple)] animate-spin" />
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--color-text-muted)]">Thinking...</span>
                <button onClick={handleCancel} className="text-[10px] text-red-400 hover:underline">
                  Cancel
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Input */}
        <div className="p-3 border-t border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Describe a policy..."
              disabled={isStreaming}
              className="flex-1 px-3 py-2 rounded-md text-xs border outline-none transition-colors disabled:opacity-50"
              style={{
                backgroundColor: 'var(--color-input-bg)',
                borderColor: 'var(--color-input-border)',
                color: 'var(--color-text-primary)',
              }}
            />
            <button
              onClick={handleSend}
              disabled={!input.trim() || isStreaming}
              className="p-2 rounded-md text-white transition-colors disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Send size={14} />
            </button>
          </div>
          <p className="text-[10px] text-[var(--color-text-muted)] mt-1.5 text-center">
            Input is scanned for prompt injection. Responses are validated against a schema and filtered for harmful content.
          </p>
        </div>
      </div>
    </div>
  );
}

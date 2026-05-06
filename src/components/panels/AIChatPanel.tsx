import { useState, useRef, useEffect } from 'react';
import { X, Send, Bot, User, Check, Loader2, AlertCircle, Sparkles } from 'lucide-react';
import type { AIProfile, AIMessage } from '../../lib/ai/types';
import { streamChat } from '../../lib/ai/client';
import { SYSTEM_PROMPT_POLICY_GENERATION, buildPolicyGenerationPrompt } from '../../lib/ai/prompts';
import type { DcfPolicyModel } from '../../types/dcf';

interface AIChatPanelProps {
  topology: DcfPolicyModel;
  profile: AIProfile;
  onClose: () => void;
  onApplyPolicy: (policyData: Record<string, unknown>) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  parsed?: Record<string, unknown> | null;
  error?: boolean;
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

    const userText = input.trim();
    setInput('');

    const userMsg: ChatMessage = { role: 'user', content: userText };
    setMessages((prev) => [...prev, userMsg]);

    const systemMsg: AIMessage = { role: 'system', content: SYSTEM_PROMPT_POLICY_GENERATION };
    const contextMsg: AIMessage = { role: 'user', content: buildPolicyGenerationPrompt(topology, userText) };

    setIsStreaming(true);
    const controller = new AbortController();
    setAbortController(controller);

    let fullContent = '';

    try {
      for await (const chunk of streamChat(profile, [systemMsg, contextMsg], controller.signal)) {
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

      // Try to parse JSON from the full response
      const parsed = tryParsePolicyJSON(fullContent);
      setMessages((prev) => {
        const next = [...prev];
        next[next.length - 1] = { ...next[next.length - 1], parsed };
        return next;
      });
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
    onApplyPolicy(msg.parsed);
  };

  const handleCancel = () => {
    abortController?.abort();
    setIsStreaming(false);
    setAbortController(null);
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
                {profile.name} · {profile.model}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
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
                    <button
                      onClick={() => handleApply(msg)}
                      className="mt-3 w-full flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
                      style={{ backgroundColor: 'var(--color-aviatrix)' }}
                    >
                      <Check size={12} />
                      Apply Policy
                    </button>
                  </div>
                )}

                {msg.role === 'assistant' && !msg.parsed && !msg.error && !isStreaming && (
                  <div className="mt-1 text-[10px] text-[var(--color-text-muted)]">
                    Could not parse response. Try rephrasing your request.
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
            AI-generated policies should be reviewed before applying.
          </p>
        </div>
      </div>
    </div>
  );
}

function tryParsePolicyJSON(text: string): Record<string, unknown> | null {
  // Try to extract JSON from markdown code blocks
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonText = codeBlockMatch ? codeBlockMatch[1].trim() : text.trim();

  try {
    const parsed = JSON.parse(jsonText);
    if (typeof parsed === 'object' && parsed !== null) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Try finding JSON between curly braces
    const braceMatch = text.match(/\{[\s\S]*\}/);
    if (braceMatch) {
      try {
        const parsed = JSON.parse(braceMatch[0]);
        if (typeof parsed === 'object' && parsed !== null) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        // ignore
      }
    }
  }
  return null;
}

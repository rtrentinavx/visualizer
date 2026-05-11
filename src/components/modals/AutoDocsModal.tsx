import { useEffect, useRef, useState } from 'react';
import { X, Copy, Download, StopCircle, FileText } from 'lucide-react';
import type { DcfPolicyModel } from '../../types/dcf';
import type { AIProfile } from '../../lib/ai/types';
import { streamChat, postProcessAIOutput } from '../../lib/ai/client';
import { SYSTEM_PROMPT_AUTO_DOCS, buildAutoDocsPrompt, PROMPT_VERSIONS } from '../../lib/ai/prompts';

interface AutoDocsModalProps {
  topology: DcfPolicyModel;
  profile: AIProfile;
  onClose: () => void;
}

type Status = 'streaming' | 'done' | 'error' | 'blocked';

export default function AutoDocsModal({ topology, profile, onClose }: AutoDocsModalProps) {
  const [content, setContent] = useState('');
  const [status, setStatus] = useState<Status>('streaming');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const ac = new AbortController();
    abortRef.current = ac;
    let buffer = '';
    (async () => {
      try {
        const stream = streamChat(
          profile,
          [
            { role: 'system', content: SYSTEM_PROMPT_AUTO_DOCS },
            { role: 'user', content: buildAutoDocsPrompt(topology) },
          ],
          PROMPT_VERSIONS.autoDocs,
          ac.signal,
        );
        for await (const chunk of stream) {
          if (chunk.content) {
            buffer += chunk.content;
            setContent(buffer);
          }
          if (chunk.done) break;
        }
        const finalCheck = postProcessAIOutput(buffer);
        if (!finalCheck.ok) {
          setStatus('blocked');
          setErrorMsg(finalCheck.reason);
        } else {
          setStatus('done');
        }
      } catch (err) {
        if (ac.signal.aborted) return; // user cancelled — leave content as-is
        setStatus('error');
        setErrorMsg(err instanceof Error ? err.message : 'Generation failed');
      }
    })();
    return () => ac.abort();
  }, [profile, topology]);

  const finalContent = content.replace('{TIMESTAMP}', new Date().toISOString());

  const handleCopy = () => {
    navigator.clipboard.writeText(finalContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => {});
  };

  const handleDownload = () => {
    const blob = new Blob([finalContent], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `dcf-topology-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleCancel = () => {
    abortRef.current?.abort();
    setStatus('done');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-3xl max-h-[85vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <FileText size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Auto-Generated Docs</h2>
              <p className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                {status === 'streaming' ? `Generating from ${topology.policies.length} policies…` :
                  status === 'done' ? `${finalContent.length.toLocaleString()} characters` :
                  status === 'blocked' ? 'Output blocked by safety filter' :
                  'Generation failed'}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]">
            <X size={14} />
          </button>
        </div>

        <div className="flex-1 overflow-auto p-4">
          {errorMsg && (
            <div className="mb-3 px-3 py-2 rounded text-xs border" style={{ borderColor: '#ef4444', color: '#ef4444', backgroundColor: '#ef444415' }}>
              {errorMsg}
            </div>
          )}
          <pre className="text-xs font-mono whitespace-pre-wrap break-words" style={{ color: 'var(--color-text-secondary)' }}>
            {finalContent || (status === 'streaming' ? 'Waiting for first token…' : '')}
          </pre>
        </div>

        <div className="p-4 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
          {status === 'streaming' ? (
            <button
              onClick={handleCancel}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
              style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
            >
              <StopCircle size={13} />
              Stop
            </button>
          ) : (
            <>
              <button
                onClick={handleCopy}
                disabled={!finalContent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}
              >
                <Copy size={13} />
                {copied ? 'Copied' : 'Copy'}
              </button>
              <button
                onClick={handleDownload}
                disabled={!finalContent}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
              >
                <Download size={13} />
                Download .md
              </button>
            </>
          )}
          <span className="text-[10px] text-[var(--color-text-muted)] ml-auto">
            Model: {profile.model}
          </span>
        </div>
      </div>
    </div>
  );
}

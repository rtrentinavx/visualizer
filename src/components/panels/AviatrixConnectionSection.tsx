import { useEffect, useState } from 'react';
import { Plug, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, X, ExternalLink } from 'lucide-react';
import type { AviatrixConnection, AviatrixSettings } from '../../lib/aviatrix/types';
import {
  loadAviatrixSettings,
  saveAviatrixSettings,
  getDefaultAviatrixSettings,
  getActiveConnection,
  getConnectionStatus,
  clearConnectionTokens,
} from '../../lib/aviatrix/storage';
import { initiateConnect } from '../../lib/aviatrix/oauth';

/**
 * Aviatrix Live Connection — embedded section in the AI Settings panel.
 * MVP scope:
 * - Single-connection model (multi-connection support deferred).
 * - Create / edit / connect / disconnect / delete.
 * - Status badge reflecting token state.
 *
 * Loads its own state from encrypted localStorage on mount; doesn't take
 * props from AISettingsPanel so it can be moved into its own view later
 * without rewiring.
 */
export default function AviatrixConnectionSection() {
  const [settings, setSettings] = useState<AviatrixSettings>(getDefaultAviatrixSettings);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<AviatrixConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadAviatrixSettings()
      .then((s) => { if (s) setSettings(s); })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const active = getActiveConnection(settings);
  const status = getConnectionStatus(active);

  const persist = async (next: AviatrixSettings) => {
    setSettings(next);
    await saveAviatrixSettings(next).catch(() => {});
  };

  const startNew = () => {
    setEditing({
      id: `aviatrix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name: 'Aviatrix Controller',
      mcpBaseUrl: '',
      authEndpoint: '',
      tokenEndpoint: '',
      clientId: '',
      scope: 'mcp:read',
    });
    setError(null);
  };

  const startEdit = (c: AviatrixConnection) => {
    setEditing({ ...c });
    setError(null);
  };

  const cancelEdit = () => {
    setEditing(null);
    setError(null);
  };

  const saveEditing = async () => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.mcpBaseUrl.trim() || !editing.authEndpoint.trim() || !editing.tokenEndpoint.trim() || !editing.clientId.trim()) {
      setError('Name, MCP base URL, auth endpoint, token endpoint, and client ID are required.');
      return;
    }
    const exists = settings.connections.some((c) => c.id === editing.id);
    const next: AviatrixSettings = {
      activeConnectionId: settings.activeConnectionId ?? editing.id,
      connections: exists
        ? settings.connections.map((c) => (c.id === editing.id ? editing : c))
        : [...settings.connections, editing],
    };
    await persist(next);
    setEditing(null);
  };

  const handleConnect = async (c: AviatrixConnection) => {
    setConnecting(true);
    setError(null);
    try {
      // Make sure the latest connection state is committed before we navigate
      // away — otherwise on return the handoff lookup wouldn't find the
      // current OAuth client config.
      await persist({ ...settings, activeConnectionId: c.id });
      await initiateConnect(c); // navigates away; this promise won't resolve.
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async (c: AviatrixConnection) => {
    const cleared = clearConnectionTokens(c);
    await persist({
      ...settings,
      connections: settings.connections.map((cc) => (cc.id === c.id ? cleared : cc)),
    });
  };

  const handleDelete = async (id: string) => {
    const next: AviatrixSettings = {
      activeConnectionId: settings.activeConnectionId === id ? null : settings.activeConnectionId,
      connections: settings.connections.filter((c) => c.id !== id),
    };
    await persist(next);
  };

  const updateField = <K extends keyof AviatrixConnection>(key: K, value: AviatrixConnection[K]) => {
    setEditing((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  if (!loaded) return null;

  return (
    <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 space-y-3">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-[var(--color-accent-purple)]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Aviatrix Live Connection</h3>
        </div>
        {!editing && (
          <button
            onClick={startNew}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            <Plus size={11} /> {settings.connections.length === 0 ? 'Configure' : 'New connection'}
          </button>
        )}
      </header>

      <p className="text-[10px] text-[var(--color-text-muted)]">
        Read SmartGroups, WebGroups, ThreatGroups, GeoGroups, and policies directly from your Aviatrix Controller via its MCP server.
        OAuth PKCE flow — your Controller must register
        {' '}
        <code className="px-1 rounded bg-[var(--color-surface-elevated)]">{typeof window !== 'undefined' ? `${window.location.origin}/auth/aviatrix/callback.html` : '/auth/aviatrix/callback.html'}</code>
        {' '}
        as an allowed redirect URI.
        {' '}
        <a
          href="https://github.com/rtrentinavx/visualizer/blob/main/AVIATRIX_LIVE_SETUP.md"
          target="_blank"
          rel="noreferrer noopener"
          className="text-[var(--color-accent-blue)] hover:underline"
        >
          Setup guide →
        </a>
      </p>

      {error && (
        <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/30 text-[11px] text-red-300">
          <AlertTriangle size={12} className="shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {editing ? (
        <ConnectionForm
          editing={editing}
          onChange={updateField}
          onSave={saveEditing}
          onCancel={cancelEdit}
        />
      ) : settings.connections.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-muted)] italic">No connection configured.</p>
      ) : (
        <div className="space-y-2">
          {settings.connections.map((c) => {
            const cActive = c.id === settings.activeConnectionId;
            const cStatus = cActive ? status : 'disconnected';
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-2.5 rounded border ${
                  cActive ? 'border-[var(--color-accent-purple)] bg-[var(--color-accent-purple)]/5' : 'border-[var(--color-border-subtle)]'
                }`}
              >
                <Plug size={14} className="text-[var(--color-text-muted)]" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
                    {c.name}
                    <StatusBadge status={cStatus} />
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] truncate">{c.mcpBaseUrl}</div>
                </div>
                <div className="flex items-center gap-1">
                  {cStatus === 'connected' ? (
                    <button
                      onClick={() => handleDisconnect(c)}
                      className="px-2 py-1 rounded text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]"
                    >
                      Disconnect
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(c)}
                      disabled={connecting}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white disabled:opacity-50"
                      style={{ backgroundColor: 'var(--color-accent-purple)' }}
                    >
                      {connecting ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                      {cStatus === 'expired' ? 'Reconnect' : 'Connect'}
                    </button>
                  )}
                  <button
                    onClick={() => startEdit(c)}
                    className="px-2 py-1 rounded text-[10px] border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(c.id)}
                    className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400"
                    aria-label="Delete connection"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function StatusBadge({ status }: { status: 'connected' | 'disconnected' | 'expired' }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 size={9} /> Connected
      </span>
    );
  }
  if (status === 'expired') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-500/15 text-amber-400">
        <AlertTriangle size={9} /> Expired
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400">
      Disconnected
    </span>
  );
}

function ConnectionForm({
  editing,
  onChange,
  onSave,
  onCancel,
}: {
  editing: AviatrixConnection;
  onChange: <K extends keyof AviatrixConnection>(key: K, value: AviatrixConnection[K]) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inputCls = 'w-full px-2 py-1.5 rounded text-xs border outline-none font-mono';
  const inputStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };
  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Connection details</h4>
        <button onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]" aria-label="Cancel">
          <X size={12} />
        </button>
      </div>
      <Field label="Name">
        <input type="text" value={editing.name} onChange={(e) => onChange('name', e.target.value)} className={inputCls} style={inputStyle} placeholder="Customer Prod Controller" />
      </Field>
      <Field label="MCP base URL" hint="The MCP server endpoint on the Controller.">
        <input type="text" value={editing.mcpBaseUrl} onChange={(e) => onChange('mcpBaseUrl', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/mcp" />
      </Field>
      <Field label="OAuth authorize endpoint">
        <input type="text" value={editing.authEndpoint} onChange={(e) => onChange('authEndpoint', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/oauth/authorize" />
      </Field>
      <Field label="OAuth token endpoint">
        <input type="text" value={editing.tokenEndpoint} onChange={(e) => onChange('tokenEndpoint', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/oauth/token" />
      </Field>
      <Field label="Client ID">
        <input type="text" value={editing.clientId} onChange={(e) => onChange('clientId', e.target.value)} className={inputCls} style={inputStyle} placeholder="dcf-visualizer" />
      </Field>
      <Field label="Scope (optional)">
        <input type="text" value={editing.scope ?? ''} onChange={(e) => onChange('scope', e.target.value)} className={inputCls} style={inputStyle} placeholder="mcp:read" />
      </Field>
      <div className="flex gap-2 pt-1">
        <button onClick={onSave} className="px-3 py-1.5 rounded text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-aviatrix)' }}>Save</button>
        <button onClick={onCancel} className="px-3 py-1.5 rounded text-xs font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]">Cancel</button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
      {children}
      {hint && <p className="mt-0.5 text-[9px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

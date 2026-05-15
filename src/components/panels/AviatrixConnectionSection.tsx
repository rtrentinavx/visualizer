import { useEffect, useState } from 'react';
import { Plug, Plus, Trash2, Loader2, CheckCircle2, AlertTriangle, X, ExternalLink, FlaskConical } from 'lucide-react';
import type { AviatrixConnection, AviatrixConnectionMCP, AviatrixConnectionAPI, AviatrixSettings } from '../../lib/aviatrix/types';
import {
  loadAviatrixSettings,
  saveAviatrixSettings,
  getDefaultAviatrixSettings,
  getActiveConnection,
  getConnectionStatus,
  clearConnectionTokens,
  isApiConnection,
} from '../../lib/aviatrix/storage';
import { initiateConnect } from '../../lib/aviatrix/oauth';

export default function AviatrixConnectionSection() {
  const [settings, setSettings] = useState<AviatrixSettings>(getDefaultAviatrixSettings);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState<AviatrixConnection | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ id: string; ok: boolean; msg: string } | null>(null);
  const [egressIp, setEgressIp] = useState<string | null>(null);

  useEffect(() => {
    loadAviatrixSettings()
      .then((s) => { if (s) setSettings(s); })
      .catch(() => {})
      .finally(() => setLoaded(true));
    fetch('/api/egress-ip')
      .then((r) => r.ok ? r.json() : null)
      .then((d) => { if (d && typeof (d as { ip?: string }).ip === 'string') setEgressIp((d as { ip: string }).ip); })
      .catch(() => {});
  }, []);

  const active = getActiveConnection(settings);
  const status = getConnectionStatus(active);
  // Prefer the egress IP reported by the topology-api proxy itself (same Vercel region as the
  // actual controller calls). Fall back to the section-level fetch for MCP connections.
  const displayEgressIp = (active && isApiConnection(active) && active.egressIp) ? active.egressIp : egressIp;

  const persist = async (next: AviatrixSettings) => {
    setSettings(next);
    await saveAviatrixSettings(next).catch(() => {});
  };

  const startNew = (type: 'mcp' | 'api' = 'mcp') => {
    const id = `aviatrix-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    if (type === 'api') {
      setEditing({ id, name: 'Aviatrix Controller', connectionType: 'api', controllerBaseUrl: '', username: '', password: '' });
    } else {
      setEditing({ id, name: 'Aviatrix Controller', connectionType: 'mcp', mcpBaseUrl: '', authEndpoint: '', tokenEndpoint: '', clientId: '', scope: 'mcp:read' });
    }
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
    if (isApiConnection(editing)) {
      if (!editing.name.trim() || !editing.controllerBaseUrl.trim() || !editing.username.trim() || !editing.password.trim()) {
        setError('Name, Controller URL, username, and password are required.');
        return;
      }
    } else {
      if (!editing.name.trim() || !editing.mcpBaseUrl.trim() || !editing.authEndpoint.trim() || !editing.tokenEndpoint.trim() || !editing.clientId.trim()) {
        setError('Name, MCP base URL, auth endpoint, token endpoint, and client ID are required.');
        return;
      }
    }
    // Reset connectedAt for API connections on save — credentials may have changed,
    // so any prior successful test is no longer evidence of a working connection.
    const toSave: AviatrixConnection = isApiConnection(editing)
      ? { ...editing, connectedAt: undefined }
      : editing;
    const exists = settings.connections.some((c) => c.id === toSave.id);
    const next: AviatrixSettings = {
      activeConnectionId: settings.activeConnectionId ?? toSave.id,
      connections: exists
        ? settings.connections.map((c) => (c.id === toSave.id ? toSave : c))
        : [...settings.connections, toSave],
    };
    await persist(next);
    setEditing(null);
  };

  const handleConnect = async (c: AviatrixConnectionMCP) => {
    setConnecting(true);
    setError(null);
    try {
      await persist({ ...settings, activeConnectionId: c.id });
      await initiateConnect(c); // navigates away
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connect failed.');
      setConnecting(false);
    }
  };

  const handleDisconnect = async (c: AviatrixConnectionMCP) => {
    const cleared = clearConnectionTokens(c);
    await persist({
      ...settings,
      connections: settings.connections.map((cc) => (cc.id === c.id ? cleared : cc)),
    });
  };

  const handleTestApi = async (c: AviatrixConnectionAPI) => {
    setTestingId(c.id);
    setTestResult(null);
    setError(null);
    try {
      const r = await fetch('/api/aviatrix/topology-api', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          controllerBaseUrl: c.controllerBaseUrl,
          username: c.username,
          password: c.password,
          testOnly: true,
        }),
      });
      const data = await r.json() as { apiVersion?: string; egressIp?: string; error?: string };
      if (!r.ok) throw new Error(data.error ?? `HTTP ${r.status}`);
      // Test passed — mark connectedAt + persist the proxy's egress IP so we can show the correct allow-list IP.
      const updated: AviatrixConnectionAPI = { ...c, connectedAt: Date.now(), egressIp: data.egressIp ?? c.egressIp };
      await persist({
        ...settings,
        activeConnectionId: settings.activeConnectionId ?? c.id,
        connections: settings.connections.map((cc) => (cc.id === c.id ? updated : cc)),
      });
      if (data.egressIp) setEgressIp(data.egressIp);
      setTestResult({ id: c.id, ok: true, msg: `Connected via ${data.apiVersion ?? 'API'}` });
    } catch (e) {
      // Test failed — clear connectedAt so status reverts to 'configured'.
      const reset: AviatrixConnectionAPI = { ...c, connectedAt: undefined };
      await persist({
        ...settings,
        connections: settings.connections.map((cc) => (cc.id === c.id ? reset : cc)),
      });
      setTestResult({ id: c.id, ok: false, msg: e instanceof Error ? e.message : 'Test failed' });
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async (id: string) => {
    const next: AviatrixSettings = {
      activeConnectionId: settings.activeConnectionId === id ? null : settings.activeConnectionId,
      connections: settings.connections.filter((c) => c.id !== id),
    };
    await persist(next);
  };

  if (!loaded) return null;

  return (
    <section className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 space-y-3 h-full">
      <header className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Plug size={14} className="text-[var(--color-accent-purple)]" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Aviatrix Live Connection</h3>
        </div>
        {!editing && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => startNew('mcp')}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]"
            >
              <Plus size={11} /> MCP
            </button>
            <button
              onClick={() => startNew('api')}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white"
              style={{ backgroundColor: 'var(--color-aviatrix)' }}
            >
              <Plus size={11} /> REST API
            </button>
          </div>
        )}
      </header>

      <p className="text-[10px] text-[var(--color-text-muted)]">
        Fetch SmartGroups, WebGroups, ThreatGroups, GeoGroups, and policies directly from your Aviatrix Controller.
        Choose <strong>MCP</strong> (OAuth PKCE) or <strong>REST API</strong> (username + password, no redirect required).
        {' '}Your Controller's security group must allow inbound HTTPS from our proxy:{' '}
        {displayEgressIp
          ? <code className="px-1 rounded bg-[var(--color-surface-elevated)] font-mono select-all">{displayEgressIp}</code>
          : <span className="opacity-50">run Test to see the exact IP</span>}
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
          onEditing={setEditing}
          onSave={saveEditing}
          onCancel={cancelEdit}
        />
      ) : settings.connections.length === 0 ? (
        <p className="text-[11px] text-[var(--color-text-muted)] italic">No connection configured. Add an MCP or REST API connection above.</p>
      ) : (
        <div className="space-y-2">
          {settings.connections.map((c) => {
            const cActive = c.id === settings.activeConnectionId;
            const cStatus = cActive ? status : getConnectionStatus(c);
            const tr = testResult?.id === c.id ? testResult : null;
            return (
              <div
                key={c.id}
                className={`flex items-center gap-3 p-2.5 rounded border ${
                  cActive ? 'border-[var(--color-accent-purple)] bg-[var(--color-accent-purple)]/5' : 'border-[var(--color-border-subtle)]'
                }`}
              >
                <Plug size={14} className="text-[var(--color-text-muted)] shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-medium text-[var(--color-text-primary)] truncate flex items-center gap-1.5">
                    {c.name}
                    <TypeBadge type={c.connectionType} />
                    <StatusBadge status={cStatus} />
                  </div>
                  <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                    {isApiConnection(c) ? c.controllerBaseUrl : c.mcpBaseUrl}
                  </div>
                  {tr && (
                    <div className={`text-[10px] mt-0.5 ${tr.ok ? 'text-emerald-400' : 'text-red-400'}`}>{tr.msg}</div>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  {isApiConnection(c) ? (
                    <button
                      onClick={() => handleTestApi(c)}
                      disabled={testingId === c.id}
                      className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)] disabled:opacity-50"
                    >
                      {testingId === c.id ? <Loader2 size={10} className="animate-spin" /> : <FlaskConical size={10} />}
                      Test
                    </button>
                  ) : (
                    cStatus === 'connected' ? (
                      <button
                        onClick={() => handleDisconnect(c as AviatrixConnectionMCP)}
                        className="px-2 py-1 rounded text-[10px] font-medium border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-elevated)]"
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(c as AviatrixConnectionMCP)}
                        disabled={connecting}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white disabled:opacity-50"
                        style={{ backgroundColor: 'var(--color-accent-purple)' }}
                      >
                        {connecting ? <Loader2 size={10} className="animate-spin" /> : <ExternalLink size={10} />}
                        {cStatus === 'expired' ? 'Reconnect' : 'Connect'}
                      </button>
                    )
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

// =============================================================================
// Badges
// =============================================================================

function TypeBadge({ type }: { type: 'mcp' | 'api' }) {
  return (
    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-500/15 text-slate-400">
      {type === 'api' ? 'REST API' : 'MCP'}
    </span>
  );
}

function StatusBadge({ status }: { status: 'connected' | 'configured' | 'disconnected' | 'expired' }) {
  if (status === 'connected') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-500/15 text-emerald-400">
        <CheckCircle2 size={9} /> Connected
      </span>
    );
  }
  if (status === 'configured') {
    return (
      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-blue-500/15 text-blue-400">
        Configured
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

// =============================================================================
// Connection form
// =============================================================================

function ConnectionForm({
  editing,
  onEditing,
  onSave,
  onCancel,
}: {
  editing: AviatrixConnection;
  onEditing: React.Dispatch<React.SetStateAction<AviatrixConnection | null>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  const inputCls = 'w-full px-2 py-1.5 rounded text-xs border outline-none font-mono';
  const inputStyle = { backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' };

  const switchType = (type: 'mcp' | 'api') => {
    if (type === editing.connectionType) return;
    if (type === 'api') {
      onEditing({ id: editing.id, name: editing.name, connectionType: 'api', controllerBaseUrl: '', username: '', password: '' });
    } else {
      onEditing({ id: editing.id, name: editing.name, connectionType: 'mcp', mcpBaseUrl: '', authEndpoint: '', tokenEndpoint: '', clientId: '', scope: 'mcp:read' });
    }
  };

  const set = (key: string, value: string) => onEditing((prev) => prev ? { ...prev, [key]: value } as AviatrixConnection : prev);

  return (
    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)] p-3 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-secondary)]">Connection details</h4>
        <button onClick={onCancel} className="text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]" aria-label="Cancel">
          <X size={12} />
        </button>
      </div>

      {/* Type selector */}
      <div className="flex gap-1 p-0.5 rounded bg-[var(--color-surface)] border border-[var(--color-border-subtle)]">
        {(['mcp', 'api'] as const).map((t) => (
          <button
            key={t}
            onClick={() => switchType(t)}
            className={`flex-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${
              editing.connectionType === t
                ? 'text-white'
                : 'text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]'
            }`}
            style={editing.connectionType === t ? { backgroundColor: 'var(--color-aviatrix)' } : {}}
          >
            {t === 'mcp' ? 'MCP (OAuth PKCE)' : 'Direct REST API'}
          </button>
        ))}
      </div>

      <Field label="Name">
        <input type="text" value={editing.name} onChange={(e) => set('name', e.target.value)} className={inputCls} style={inputStyle} placeholder="Customer Prod Controller" />
      </Field>

      {isApiConnection(editing) ? (
        <>
          <Field label="Controller URL" hint="Base URL of the Controller (no trailing slash).">
            <input type="text" value={editing.controllerBaseUrl} onChange={(e) => set('controllerBaseUrl', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com" />
          </Field>
          <Field label="Username">
            <input type="text" value={editing.username} onChange={(e) => set('username', e.target.value)} className={inputCls} style={inputStyle} placeholder="admin" autoComplete="username" />
          </Field>
          <Field label="Password" hint="Stored encrypted locally. Sent to our proxy on each fetch; never logged.">
            <input type="password" value={editing.password} onChange={(e) => set('password', e.target.value)} className={inputCls} style={inputStyle} autoComplete="current-password" />
          </Field>
        </>
      ) : (
        <>
          <Field label="MCP base URL" hint="The MCP server endpoint on the Controller.">
            <input type="text" value={(editing as AviatrixConnectionMCP).mcpBaseUrl} onChange={(e) => set('mcpBaseUrl', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/mcp" />
          </Field>
          <Field label="OAuth authorize endpoint">
            <input type="text" value={(editing as AviatrixConnectionMCP).authEndpoint} onChange={(e) => set('authEndpoint', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/oauth/authorize" />
          </Field>
          <Field label="OAuth token endpoint">
            <input type="text" value={(editing as AviatrixConnectionMCP).tokenEndpoint} onChange={(e) => set('tokenEndpoint', e.target.value)} className={inputCls} style={inputStyle} placeholder="https://controller.example.com/oauth/token" />
          </Field>
          <Field label="Client ID">
            <input type="text" value={(editing as AviatrixConnectionMCP).clientId} onChange={(e) => set('clientId', e.target.value)} className={inputCls} style={inputStyle} placeholder="dcf-visualizer" />
          </Field>
          <Field label="Scope (optional)">
            <input type="text" value={(editing as AviatrixConnectionMCP).scope ?? ''} onChange={(e) => set('scope', e.target.value)} className={inputCls} style={inputStyle} placeholder="mcp:read" />
          </Field>
          <p className="text-[9px] text-[var(--color-text-muted)]">
            Your Controller must register{' '}
            <code className="px-1 rounded bg-[var(--color-surface-elevated)] text-[9px]">{typeof window !== 'undefined' ? `${window.location.origin}/auth/aviatrix/callback.html` : '/auth/aviatrix/callback.html'}</code>
            {' '}as an allowed OAuth redirect URI.
          </p>
        </>
      )}

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

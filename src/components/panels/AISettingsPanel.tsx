import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus, Trash2, Check, AlertTriangle, Bot, ChevronDown, ShieldCheck, RefreshCw, Search, MapPin, X, Eye, EyeOff,
} from 'lucide-react';
import type { AIProfile, AISettings, AIProvider } from '../../lib/ai/types';
import { providerConfigs, getProviderConfig } from '../../lib/ai/providers';
import { fetchModels, type ModelInfo } from '../../lib/ai/client';
import { getResidency } from '../../lib/ai/residency';
import AviatrixConnectionSection from './AviatrixConnectionSection';

interface AISettingsPanelProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
}

function generateId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

// =============================================================================
// Subcomponents
// =============================================================================

function SectionHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="mb-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{title}</div>
      {hint && <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">{hint}</div>}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[10px] text-[var(--color-text-muted)]">{hint}</p>}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  backgroundColor: 'var(--color-input-bg)',
  borderColor: 'var(--color-input-border)',
  color: 'var(--color-text-primary)',
};

/** Combobox replacing the old dropdown+text-input dual control for the model picker. */
function ModelCombobox({
  value, onChange, options, onFetch, fetching, fetchedCount, fetchError,
}: {
  value: string;
  onChange: (v: string) => void;
  options: string[];
  onFetch: () => void;
  fetching: boolean;
  fetchedCount: number | null;
  fetchError: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    if (!value) return options;
    const lower = value.toLowerCase();
    return options.filter((o) => o.toLowerCase().includes(lower));
  }, [options, value]);

  useEffect(() => {
    if (!open) return;
    function onClickOut(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onClickOut);
    return () => document.removeEventListener('mousedown', onClickOut);
  }, [open]);

  const pick = (v: string) => {
    onChange(v);
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setOpen(true); setHighlight((i) => Math.min(i + 1, filtered.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter') {
      if (open && filtered[highlight]) { e.preventDefault(); pick(filtered[highlight]!); }
    } else if (e.key === 'Escape') setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative">
      <div className="flex items-center gap-1 rounded border px-2 py-1.5" style={inputStyle}>
        <Search size={12} className="text-[var(--color-text-muted)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => { onChange(e.target.value); setOpen(true); setHighlight(0); }}
          onFocus={() => { setOpen(true); setHighlight(0); }}
          onKeyDown={onKeyDown}
          placeholder="Type or pick a model"
          className="flex-1 text-xs bg-transparent outline-none font-mono"
          style={{ color: 'var(--color-text-primary)' }}
          aria-autocomplete="list"
          aria-expanded={open}
          role="combobox"
        />
        <button
          type="button"
          onClick={() => { setOpen((v) => !v); inputRef.current?.focus(); }}
          className="p-0.5 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]"
          aria-label="Show all models"
        >
          <ChevronDown size={12} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-between">
        <button
          type="button"
          onClick={onFetch}
          disabled={fetching}
          className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline disabled:opacity-50"
        >
          <RefreshCw size={10} className={fetching ? 'animate-spin' : ''} />
          {fetching ? 'Fetching…' : fetchedCount != null ? `Refresh (${fetchedCount} live)` : 'Fetch live models'}
        </button>
        {fetchError && <span className="text-[10px] text-red-400 truncate ml-2">{fetchError}</span>}
      </div>

      {open && (
        <div
          className="absolute top-full mt-1 left-0 right-0 z-20 max-h-56 overflow-y-auto rounded border shadow-lg"
          style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
          role="listbox"
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-1.5 text-[10px] text-[var(--color-text-muted)] italic">
              No matches — press <kbd className="px-1 rounded bg-[var(--color-surface-elevated)]">Enter</kbd> to keep "{value}" as a custom model id.
            </div>
          ) : (
            filtered.map((m, i) => (
              <button
                key={m}
                type="button"
                onMouseEnter={() => setHighlight(i)}
                onClick={() => pick(m)}
                className={`w-full text-left px-2 py-1.5 text-xs font-mono transition-colors ${i === highlight ? 'bg-[var(--color-surface-elevated)]' : ''}`}
                role="option"
                aria-selected={i === highlight}
              >
                {m}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// Main component — top-level view (not a modal)
// =============================================================================

export default function AISettingsPanel({ settings, onSave }: AISettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState<AISettings>({ ...settings });
  const [editingProfile, setEditingProfile] = useState<AIProfile | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  // Cache fetched models by (provider, baseUrl). When the user switches either,
  // the cache silently becomes invalid for the current profile — no effect
  // needed, just key comparison on render.
  const [modelCache, setModelCache] = useState<{ key: string; models: ModelInfo[]; error: string | null } | null>(null);
  const [fetchingModels, setFetchingModels] = useState(false);

  // Keep local settings in sync if the parent's settings prop changes (e.g. on
  // initial load after decrypt). We DON'T overwrite once the user starts editing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- external sync: localStorage decrypt may complete after mount, and parent re-emits the same object on every save which would otherwise loop forever without a guard.
    if (!editingProfile) setLocalSettings({ ...settings });
  }, [settings, editingProfile]);

  const activeProfile = localSettings.profiles.find((p) => p.id === localSettings.activeProfileId);
  const providerConfig = editingProfile ? getProviderConfig(editingProfile.provider) : undefined;
  const profileKey = editingProfile ? `${editingProfile.provider}|${editingProfile.apiBaseUrl ?? ''}` : '';
  const fetchedModels = modelCache?.key === profileKey ? modelCache.models : null;
  const fetchError = modelCache?.key === profileKey ? modelCache.error : null;

  const needsKey = editingProfile && editingProfile.provider !== 'ollama' && editingProfile.provider !== 'lmstudio';
  const needsBaseUrl = !!editingProfile && (
    editingProfile.provider === 'ollama' ||
    editingProfile.provider === 'lmstudio' ||
    editingProfile.provider === 'bedrock' ||
    editingProfile.provider === 'custom'
  );

  const startNewProfile = () => {
    const defaultProvider: AIProvider = 'openai';
    const config = providerConfigs[defaultProvider]!;
    setEditingProfile({
      id: generateId(),
      name: 'New profile',
      provider: defaultProvider,
      model: config.defaultModel,
      apiKey: '',
      temperature: config.defaultTemperature,
    });
    setShowKey(false);
  };

  const startEditProfile = (profile: AIProfile) => {
    setEditingProfile({ ...profile });
    setShowKey(false);
    setConfirmDelete(null);
  };

  const cancelEdit = () => {
    setEditingProfile(null);
    setModelCache(null);
  };

  /** Commit the editing profile to the parent in one step. No two-stage "save profile then save settings" anymore. */
  const saveProfile = () => {
    if (!editingProfile) return;
    if (!editingProfile.name.trim() || (needsKey && !editingProfile.apiKey.trim())) return;

    setLocalSettings((prev) => {
      const exists = prev.profiles.find((p) => p.id === editingProfile.id);
      const profiles = exists
        ? prev.profiles.map((p) => (p.id === editingProfile.id ? editingProfile : p))
        : [...prev.profiles, editingProfile];
      const next: AISettings = {
        ...prev,
        profiles,
        activeProfileId: prev.activeProfileId || editingProfile.id,
      };
      // Persist immediately — the parent owns the AISettings storage round-trip.
      onSave(next);
      return next;
    });
    setEditingProfile(null);
    setModelCache(null);
  };

  const deleteProfile = (id: string) => {
    setLocalSettings((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== id);
      const next: AISettings = {
        ...prev,
        profiles,
        activeProfileId: prev.activeProfileId === id ? (profiles[0]?.id || null) : prev.activeProfileId,
      };
      onSave(next);
      return next;
    });
    setConfirmDelete(null);
    if (editingProfile?.id === id) cancelEdit();
  };

  const activateProfile = (id: string) => {
    setLocalSettings((prev) => {
      const next: AISettings = { ...prev, activeProfileId: id };
      onSave(next);
      return next;
    });
  };

  const setConsent = (consentGiven: boolean) => {
    setLocalSettings((prev) => {
      const next = { ...prev, consentGiven };
      onSave(next);
      return next;
    });
  };

  const updateEditingField = <K extends keyof AIProfile>(field: K, value: AIProfile[K]) => {
    setEditingProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      if (field === 'provider') {
        const config = getProviderConfig(value as string);
        if (config) {
          next.model = config.defaultModel;
          next.temperature = config.defaultTemperature;
        }
      }
      return next;
    });
  };

  const handleFetchModels = async () => {
    if (!editingProfile) return;
    setFetchingModels(true);
    setModelCache({ key: profileKey, models: [], error: null });
    try {
      const models = await fetchModels(editingProfile);
      if (models.length === 0) {
        setModelCache({ key: profileKey, models: [], error: 'No models returned by the provider.' });
      } else {
        setModelCache({ key: profileKey, models, error: null });
      }
    } catch (err) {
      setModelCache({ key: profileKey, models: [], error: err instanceof Error ? err.message : 'Failed to fetch models' });
    } finally {
      setFetchingModels(false);
    }
  };

  const modelOptions: string[] = (() => {
    if (fetchedModels && fetchedModels.length > 0) return fetchedModels.map((m) => m.id);
    if (providerConfig && providerConfig.models.length > 0) return providerConfig.models;
    return editingProfile?.model ? [editingProfile.model] : [];
  })();

  const canSaveEditing = !!editingProfile && editingProfile.name.trim() && (!needsKey || editingProfile.apiKey.trim());

  // ===========================================================================

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="p-4 border-b border-[var(--color-border-subtle)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <Bot size={20} className="text-[var(--color-accent-blue)]" />
          <div>
            <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">Settings</h2>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              {localSettings.profiles.length} profile{localSettings.profiles.length !== 1 ? 's' : ''}
              {activeProfile ? ` · Active: ${activeProfile.name}` : ' · No active profile'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 text-[10px] text-emerald-500" title="Active safety controls">
          <ShieldCheck size={12} />
          <span className="hidden sm:inline">Input scan · output redaction · consent · prompt versioning</span>
        </div>
      </header>

      <div className="flex-1 p-4 max-w-5xl mx-auto w-full space-y-4 min-h-0 overflow-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Consent banner — only shown until the user acknowledges. */}
        {!localSettings.consentGiven && (
          <div className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/30 flex gap-3">
            <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
            <div className="text-xs text-[var(--color-text-secondary)] space-y-1">
              <p>
                API keys are stored locally in this browser with AES-GCM encryption and forwarded server-side through the
                Vercel edge proxy, never logged. Topology data (group names, FQDNs, CIDRs, policy attributes) is sent to
                whichever provider you configure when AI features are used — see the{' '}
                <a href="https://github.com/rtrentinavx/visualizer/blob/main/AI_USE_POLICY.md" target="_blank" rel="noreferrer noopener" className="text-[var(--color-accent-blue)] hover:underline">
                  AI Use Policy
                </a>.
              </p>
              <label className="flex items-center gap-2 mt-1 cursor-pointer">
                <input type="checkbox" checked={localSettings.consentGiven} onChange={(e) => setConsent(e.target.checked)} className="rounded" />
                I understand and consent to local key storage and topology data egress.
              </label>
            </div>
          </div>
        )}

        {/* Two-column on wide screens: AI profiles on the left, Aviatrix on the right.
            When editing a profile, the form takes the AI column; the Aviatrix column stays
            mounted on the right so users can still configure it. Both cards use h-full so
            they stretch to match the tallest sibling — equal-height cards on every viewport. */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
        {editingProfile ? (
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 space-y-5 h-full">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-primary)]">
                {localSettings.profiles.find((p) => p.id === editingProfile.id) ? 'Edit profile' : 'New profile'}
              </h3>
              <button onClick={cancelEdit} className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]">
                Discard changes
              </button>
            </div>

            {/* --- Section 1: Identity --- */}
            <section className="space-y-3">
              <SectionHeader title="1. Identity" hint="A label you'll see in the AI tools, plus which provider this profile uses." />

              <Field label="Profile name">
                <input
                  type="text"
                  value={editingProfile.name}
                  onChange={(e) => updateEditingField('name', e.target.value)}
                  placeholder="Work · OpenAI"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none"
                  style={inputStyle}
                />
              </Field>

              <Field label="Provider">
                <div className="relative">
                  <select
                    value={editingProfile.provider}
                    onChange={(e) => updateEditingField('provider', e.target.value as AIProvider)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={inputStyle}
                  >
                    {Object.values(providerConfigs).map((c) => (
                      <option key={c.id} value={c.id}>{c.name} — {getResidency(c.id).short}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
                {(() => {
                  const r = getResidency(editingProfile.provider);
                  return (
                    <div className={`mt-1.5 flex items-start gap-1.5 text-[10px] ${r.local ? 'text-emerald-500' : 'text-amber-400'}`}>
                      <MapPin size={11} className="mt-0.5 shrink-0" />
                      <span>Data residency: {r.long}</span>
                    </div>
                  );
                })()}
              </Field>
            </section>

            {/* --- Section 2: Credentials --- */}
            <section className="space-y-3 pt-4 border-t border-[var(--color-border-subtle)]">
              <SectionHeader
                title="2. Credentials"
                hint={editingProfile.provider === 'ollama' || editingProfile.provider === 'lmstudio'
                  ? 'Local models don\'t need a key. Set the base URL where your runtime listens.'
                  : 'Your provider key. Encrypted at rest in this browser; forwarded through the proxy, never logged.'}
              />

              <Field label="API key">
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={editingProfile.apiKey}
                    onChange={(e) => updateEditingField('apiKey', e.target.value)}
                    placeholder={
                      editingProfile.provider === 'ollama' || editingProfile.provider === 'lmstudio' ? 'Optional for local models'
                      : editingProfile.provider === 'bedrock' ? 'Bedrock API key (Bearer token)'
                      : editingProfile.provider === 'anthropic' ? 'sk-ant-…'
                      : 'sk-…'
                    }
                    className="flex-1 px-2 py-1.5 rounded text-xs border outline-none font-mono"
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setShowKey((v) => !v)} className="px-2 py-1.5 rounded text-[10px] border flex items-center gap-1" style={{ ...inputStyle, color: 'var(--color-text-muted)' }} aria-label={showKey ? 'Hide key' : 'Show key'}>
                    {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
                  </button>
                </div>
              </Field>

              {needsBaseUrl && (
                <Field
                  label={editingProfile.provider === 'bedrock' ? 'AWS Region' : 'Base URL'}
                  hint={editingProfile.provider === 'bedrock' ? 'The AWS region where Bedrock runs (data residency follows this).' : undefined}
                >
                  <input
                    type="text"
                    value={editingProfile.apiBaseUrl || providerConfig?.defaultBaseUrl || ''}
                    onChange={(e) => updateEditingField('apiBaseUrl', e.target.value)}
                    placeholder={
                      editingProfile.provider === 'bedrock' ? 'us-east-1'
                      : editingProfile.provider === 'lmstudio' ? 'http://localhost:1234'
                      : editingProfile.provider === 'ollama' ? 'http://localhost:11434'
                      : 'https://api.example.com'
                    }
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                    style={inputStyle}
                  />
                </Field>
              )}
            </section>

            {/* --- Section 3: Model & behavior --- */}
            <section className="space-y-3 pt-4 border-t border-[var(--color-border-subtle)]">
              <SectionHeader title="3. Model & behavior" hint="Pick a model — type to search, or click Fetch live models to query the provider." />

              <Field label="Model">
                <ModelCombobox
                  value={editingProfile.model}
                  onChange={(v) => updateEditingField('model', v)}
                  options={modelOptions}
                  onFetch={handleFetchModels}
                  fetching={fetchingModels}
                  fetchedCount={fetchedModels ? fetchedModels.length : null}
                  fetchError={fetchError}
                />
              </Field>

              <Field
                label={`Temperature · ${editingProfile.temperature.toFixed(1)}`}
                hint="0.0 = deterministic (recommended for policy work). 1.0 = creative."
              >
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={editingProfile.temperature}
                  onChange={(e) => updateEditingField('temperature', Number(e.target.value))}
                  className="w-full"
                />
              </Field>
            </section>

            {/* --- Footer actions --- */}
            <div className="pt-4 border-t border-[var(--color-border-subtle)] flex items-center justify-end gap-2">
              <button onClick={cancelEdit} className="px-3 py-1.5 rounded-md text-xs font-medium border" style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-secondary)' }}>
                Cancel
              </button>
              <button
                onClick={saveProfile}
                disabled={!canSaveEditing}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-md text-xs font-medium text-white disabled:opacity-40 disabled:cursor-not-allowed"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
                title={canSaveEditing ? undefined : 'Fill in the name and required credentials first.'}
              >
                <Check size={13} />
                Save profile
              </button>
            </div>
          </div>
        ) : (
          // ============ Profile list ============
          <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface)] p-4 space-y-3 h-full">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Profiles</h3>
              <button onClick={startNewProfile} className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium text-white" style={{ backgroundColor: 'var(--color-aviatrix)' }}>
                <Plus size={11} /> New profile
              </button>
            </div>

            {localSettings.profiles.length === 0 ? (
              <div className="text-center py-10 px-4">
                <Bot size={28} className="mx-auto text-[var(--color-text-muted)] mb-2" />
                <p className="text-sm font-medium text-[var(--color-text-secondary)]">No AI profiles yet</p>
                <p className="text-xs text-[var(--color-text-muted)] mt-1 mb-4 max-w-md mx-auto">
                  Add a profile to unlock AI Chat, Reachability, Auto-docs, Policy Search, and AI-suggested reorder.
                </p>
                <button onClick={startNewProfile} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium text-white" style={{ backgroundColor: 'var(--color-aviatrix)' }}>
                  <Plus size={12} /> Create your first profile
                </button>
              </div>
            ) : (
              <div className="space-y-2">
                {localSettings.profiles.map((profile) => {
                  const isActive = localSettings.activeProfileId === profile.id;
                  const isConfirming = confirmDelete === profile.id;
                  const r = getResidency(profile.provider);
                  return (
                    <div
                      key={profile.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        isActive ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5' : 'border-[var(--color-border-subtle)] bg-[var(--color-surface-raised)]'
                      }`}
                    >
                      <button
                        onClick={() => activateProfile(profile.id)}
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isActive ? 'border-[var(--color-accent-blue)]' : 'border-[var(--color-border-subtle)] hover:border-[var(--color-text-muted)]'
                        }`}
                        title={isActive ? 'Active profile' : 'Activate this profile'}
                      >
                        {isActive && <div className="w-2 h-2 rounded-full bg-[var(--color-accent-blue)]" />}
                      </button>

                      <button onClick={() => startEditProfile(profile)} className="flex-1 min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{profile.name}</span>
                          {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]">Active</span>}
                        </div>
                        <div className="text-[10px] text-[var(--color-text-muted)] mt-0.5">
                          {providerConfigs[profile.provider]?.name} · {profile.model} · T={profile.temperature}
                        </div>
                        <div className="text-[9px] text-[var(--color-text-muted)] mt-0.5 flex items-center gap-1">
                          <span className={`inline-block w-1.5 h-1.5 rounded-full ${r.local ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                          Residency: {r.short}
                        </div>
                      </button>

                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button onClick={() => deleteProfile(profile.id)} className="px-2 py-1 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/30">
                            Confirm
                          </button>
                          <button onClick={() => setConfirmDelete(null)} className="px-2 py-1 rounded text-[10px] text-[var(--color-text-muted)]">
                            <X size={11} />
                          </button>
                        </div>
                      ) : (
                        <button onClick={() => setConfirmDelete(profile.id)} className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400" aria-label="Delete profile">
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

          <AviatrixConnectionSection />
        </div>
      </div>
    </div>
  );
}

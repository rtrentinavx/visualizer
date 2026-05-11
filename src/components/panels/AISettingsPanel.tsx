import { useState } from 'react';
import { X, Plus, Trash2, Check, AlertTriangle, Bot, ChevronDown, ShieldCheck } from 'lucide-react';
import type { AIProfile, AISettings, AIProvider } from '../../lib/ai/types';
import { providerConfigs, getProviderConfig } from '../../lib/ai/providers';

interface AISettingsPanelProps {
  settings: AISettings;
  onSave: (settings: AISettings) => void;
  onClose: () => void;
}

function generateId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

export default function AISettingsPanel({ settings, onSave, onClose }: AISettingsPanelProps) {
  const [localSettings, setLocalSettings] = useState<AISettings>({ ...settings });
  const [editingProfile, setEditingProfile] = useState<AIProfile | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const isEditing = !!editingProfile;
  const activeProfile = localSettings.profiles.find((p) => p.id === localSettings.activeProfileId);

  const providerConfig = editingProfile ? getProviderConfig(editingProfile.provider) : undefined;

  const startNewProfile = () => {
    const defaultProvider = 'openai';
    const config = providerConfigs[defaultProvider]!;
    setEditingProfile({
      id: generateId(),
      name: 'New Profile',
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

  const saveEditingProfile = () => {
    if (!editingProfile) return;
    if (!editingProfile.name.trim() || !editingProfile.apiKey.trim()) return;

    setLocalSettings((prev) => {
      const exists = prev.profiles.find((p) => p.id === editingProfile.id);
      const profiles = exists
        ? prev.profiles.map((p) => (p.id === editingProfile.id ? editingProfile : p))
        : [...prev.profiles, editingProfile];
      return {
        ...prev,
        profiles,
        activeProfileId: prev.activeProfileId || editingProfile.id,
      };
    });
    setEditingProfile(null);
  };

  const deleteProfile = (id: string) => {
    setLocalSettings((prev) => {
      const profiles = prev.profiles.filter((p) => p.id !== id);
      return {
        ...prev,
        profiles,
        activeProfileId: prev.activeProfileId === id ? (profiles[0]?.id || null) : prev.activeProfileId,
      };
    });
    setConfirmDelete(null);
    if (editingProfile?.id === id) setEditingProfile(null);
  };

  const activateProfile = (id: string) => {
    setLocalSettings((prev) => ({ ...prev, activeProfileId: id }));
  };

  const updateEditingField = <K extends keyof AIProfile>(field: K, value: AIProfile[K]) => {
    setEditingProfile((prev) => {
      if (!prev) return prev;
      const next = { ...prev, [field]: value };
      // Auto-update model when provider changes
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

  const needsKey = editingProfile && editingProfile.provider !== 'ollama' && editingProfile.provider !== 'lmstudio';
  const needsSecret = editingProfile && editingProfile.provider === 'bedrock';
  const canSaveEditing = editingProfile && editingProfile.name.trim() && (!needsKey || editingProfile.apiKey.trim()) && (!needsSecret || (editingProfile.apiSecret || '').trim());

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-lg max-h-[90vh] flex flex-col rounded-xl border shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-[var(--color-border-subtle)]">
          <div className="flex items-center gap-3">
            <Bot size={18} className="text-[var(--color-accent-blue)]" />
            <div>
              <h2 className="text-sm font-semibold text-[var(--color-text-secondary)] uppercase tracking-wider">AI Settings</h2>
              <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                {localSettings.profiles.length} profile{localSettings.profiles.length !== 1 ? 's' : ''}
                {activeProfile ? ` · Active: ${activeProfile.name}` : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] transition-colors">
            <X size={16} />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {/* Consent Banner */}
          {!localSettings.consentGiven && (
            <div className="p-3 rounded-lg border bg-amber-500/10 border-amber-500/30 flex gap-3">
              <AlertTriangle size={16} className="text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-[var(--color-text-secondary)]">
                  API keys are stored <strong>locally in this browser</strong> using AES-GCM encryption.
                  They are never logged on our servers, but they do pass through the Vercel edge proxy.
                </p>
                <label className="flex items-center gap-2 mt-2 text-xs text-[var(--color-text-secondary)] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localSettings.consentGiven}
                    onChange={(e) => setLocalSettings((prev) => ({ ...prev, consentGiven: e.target.checked }))}
                    className="rounded"
                  />
                  I understand and consent to local key storage
                </label>
              </div>
            </div>
          )}

          {isEditing ? (
            /* Edit Profile Form */
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">
                  {localSettings.profiles.find((p) => p.id === editingProfile.id) ? 'Edit Profile' : 'New Profile'}
                </h3>
                <button
                  onClick={() => setEditingProfile(null)}
                  className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
                >
                  Cancel
                </button>
              </div>

              {/* Profile Name */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Profile Name</label>
                <input
                  type="text"
                  value={editingProfile.name}
                  onChange={(e) => updateEditingField('name', e.target.value)}
                  placeholder="Work OpenAI"
                  className="w-full px-2 py-1.5 rounded text-xs border outline-none"
                  style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                />
              </div>

              {/* Provider */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Provider</label>
                <div className="relative">
                  <select
                    value={editingProfile.provider}
                    onChange={(e) => updateEditingField('provider', e.target.value as AIProvider)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  >
                    {Object.values(providerConfigs).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
              </div>

              {/* Model */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Model</label>
                <div className="relative">
                  <select
                    value={editingProfile.model}
                    onChange={(e) => updateEditingField('model', e.target.value)}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none appearance-none"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  >
                    {providerConfig?.models.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    )) || <option value={editingProfile.model}>{editingProfile.model}</option>}
                  </select>
                  <ChevronDown size={12} className="absolute right-2 top-1/2 -translate-y-1/2 text-[var(--color-text-muted)] pointer-events-none" />
                </div>
              </div>

              {/* API Key */}
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">API Key</label>
                <div className="flex gap-2">
                  <input
                    type={showKey ? 'text' : 'password'}
                    value={editingProfile.apiKey}
                    onChange={(e) => updateEditingField('apiKey', e.target.value)}
                    placeholder={editingProfile.provider === 'ollama' || editingProfile.provider === 'lmstudio' ? 'Optional for local models' : editingProfile.provider === 'bedrock' ? 'AKIA...' : 'sk-...'}
                    className="flex-1 px-2 py-1.5 rounded text-xs border outline-none font-mono"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  />
                  <button
                    onClick={() => setShowKey((v) => !v)}
                    className="px-2 py-1 rounded text-[10px] border"
                    style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                  >
                    {showKey ? 'Hide' : 'Show'}
                  </button>
                </div>
              </div>

              {/* Secret Access Key (Bedrock) */}
              {editingProfile.provider === 'bedrock' && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">Secret Access Key</label>
                  <div className="flex gap-2">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={editingProfile.apiSecret || ''}
                      onChange={(e) => updateEditingField('apiSecret', e.target.value)}
                      placeholder='...'
                      className="flex-1 px-2 py-1.5 rounded text-xs border outline-none font-mono"
                      style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                    />
                    <button
                      onClick={() => setShowKey((v) => !v)}
                      className="px-2 py-1 rounded text-[10px] border"
                      style={{ backgroundColor: 'var(--color-surface)', borderColor: 'var(--color-border-subtle)', color: 'var(--color-text-muted)' }}
                    >
                      {showKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>
              )}

              {/* Base URL / Region */}
              {(editingProfile.provider === 'ollama' || editingProfile.provider === 'lmstudio' || editingProfile.provider === 'bedrock' || editingProfile.provider === 'custom') && (
                <div>
                  <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">
                    {editingProfile.provider === 'bedrock' ? 'AWS Region' : 'Base URL'}
                  </label>
                  <input
                    type="text"
                    value={editingProfile.apiBaseUrl || providerConfig?.defaultBaseUrl || ''}
                    onChange={(e) => updateEditingField('apiBaseUrl', e.target.value)}
                    placeholder={editingProfile.provider === 'bedrock' ? 'us-east-1' : editingProfile.provider === 'lmstudio' ? 'http://localhost:1234' : 'http://localhost:11434'}
                    className="w-full px-2 py-1.5 rounded text-xs border outline-none font-mono"
                    style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
                  />
                </div>
              )}

              {/* Temperature */}
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Temperature</label>
                  <span className="text-[10px] font-mono text-[var(--color-text-muted)]">{editingProfile.temperature.toFixed(1)}</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.1"
                  value={editingProfile.temperature}
                  onChange={(e) => updateEditingField('temperature', Number(e.target.value))}
                  className="w-full"
                />
                <div className="flex justify-between text-[9px] text-[var(--color-text-muted)] mt-1">
                  <span>Deterministic (0.0)</span>
                  <span>Recommended: 0.2</span>
                  <span>Creative (1.0)</span>
                </div>
              </div>

              {/* Save */}
              <button
                onClick={saveEditingProfile}
                disabled={!canSaveEditing}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
                style={{ backgroundColor: 'var(--color-aviatrix)' }}
              >
                <Check size={13} />
                Save Profile
              </button>
            </div>
          ) : (
            /* Profile List */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--color-text-muted)]">Profiles</h3>
                <button
                  onClick={startNewProfile}
                  className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
                >
                  <Plus size={12} /> New Profile
                </button>
              </div>

              {localSettings.profiles.length === 0 ? (
                <div className="text-center py-6 text-xs text-[var(--color-text-muted)]">
                  No profiles yet. Create one to enable AI features.
                </div>
              ) : (
                localSettings.profiles.map((profile) => {
                  const isActive = localSettings.activeProfileId === profile.id;
                  const isConfirming = confirmDelete === profile.id;

                  return (
                    <div
                      key={profile.id}
                      className={`flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                        isActive ? 'border-[var(--color-accent-blue)] bg-[var(--color-accent-blue)]/5' : 'border-[var(--color-border-subtle)]'
                      }`}
                    >
                      <button
                        onClick={() => activateProfile(profile.id)}
                        className={`w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0 ${
                          isActive ? 'border-[var(--color-accent-blue)]' : 'border-[var(--color-border-subtle)]'
                        }`}
                      >
                        {isActive && <div className="w-2 h-2 rounded-full bg-[var(--color-accent-blue)]" />}
                      </button>

                      <div className="flex-1 min-w-0" onClick={() => startEditProfile(profile)}>
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-[var(--color-text-primary)] truncate">{profile.name}</span>
                          {isActive && <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--color-accent-blue)]/10 text-[var(--color-accent-blue)]">Active</span>}
                        </div>
                        <div className="text-[10px] text-[var(--color-text-muted)]">
                          {providerConfigs[profile.provider]?.name} · {profile.model} · T={profile.temperature}
                        </div>
                      </div>

                      {isConfirming ? (
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => deleteProfile(profile.id)}
                            className="px-2 py-1 rounded text-[10px] bg-red-500/10 text-red-400 border border-red-500/30"
                          >
                            Confirm
                          </button>
                          <button
                            onClick={() => setConfirmDelete(null)}
                            className="px-2 py-1 rounded text-[10px] text-[var(--color-text-muted)]"
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(profile.id)}
                          className="p-1 rounded hover:bg-red-500/10 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
                        >
                          <Trash2 size={12} />
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <p className="text-[10px] text-[var(--color-text-muted)]">
              Keys stored encrypted locally. Pass through edge proxy.
            </p>
            <div className="flex items-center gap-1 text-[10px] text-emerald-500">
              <ShieldCheck size={10} />
              <span>Input scanning · XML delimiters · Output validation · Prompt versioning</span>
            </div>
          </div>
          <button
            onClick={() => onSave(localSettings)}
            className="px-4 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}

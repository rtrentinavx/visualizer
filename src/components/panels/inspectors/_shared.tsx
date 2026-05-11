import { Save, Trash2, Plus, Minus } from 'lucide-react';

// ---------- Atomic form controls shared across inspectors ----------

export const Input = ({
  label,
  value,
  onChange,
  type = 'text',
  placeholder = '',
}: {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
}) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors"
      style={{
        backgroundColor: 'var(--color-input-bg)',
        borderColor: 'var(--color-input-border)',
        color: 'var(--color-text-primary)',
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
    />
  </div>
);

export const Select = ({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (v: string) => void;
}) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 rounded text-xs border outline-none transition-colors appearance-none"
      style={{
        backgroundColor: 'var(--color-input-bg)',
        borderColor: 'var(--color-input-border)',
        color: 'var(--color-text-primary)',
      }}
      onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-focus)')}
      onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--color-input-border)')}
    >
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  </div>
);

export const Toggle = ({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) => (
  <div className="mb-3 flex items-center justify-between">
    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)]">{label}</label>
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-8 h-4 rounded-full transition-colors ${checked ? 'bg-green-500' : 'bg-gray-500'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform ${checked ? 'translate-x-4' : 'translate-x-0'}`}
      />
    </button>
  </div>
);

export const MultiSelect = ({
  label,
  selected,
  options,
  onChange,
}: {
  label: string;
  selected: string[];
  options: { value: string; label: string }[];
  onChange: (v: string[]) => void;
}) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <div className="space-y-1 max-h-28 overflow-y-auto">
      {options.map((o) => (
        <label key={o.value} className="flex items-center gap-2 text-xs cursor-pointer">
          <input
            type="checkbox"
            checked={selected.includes(o.value)}
            onChange={(e) => {
              if (e.target.checked) onChange([...selected, o.value]);
              else onChange(selected.filter((id) => id !== o.value));
            }}
            className="rounded"
          />
          <span className="text-[var(--color-text-secondary)]">{o.label}</span>
        </label>
      ))}
    </div>
  </div>
);

export const StringListEditor = ({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
}) => (
  <div className="mb-3">
    <label className="block text-[10px] font-bold uppercase tracking-wider text-[var(--color-text-muted)] mb-1">{label}</label>
    <div className="space-y-1">
      {items.map((item, i) => (
        <div key={i} className="flex items-center gap-1">
          <input
            type="text"
            value={item}
            onChange={(e) => {
              const next = [...items];
              next[i] = e.target.value;
              onChange(next);
            }}
            placeholder={placeholder}
            className="flex-1 min-w-0 px-2 py-1 rounded text-xs border outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', borderColor: 'var(--color-input-border)', color: 'var(--color-text-primary)' }}
          />
          <button
            onClick={() => onChange(items.filter((_, idx) => idx !== i))}
            className="p-1 rounded hover:bg-red-500/20 text-[var(--color-text-muted)] hover:text-red-400 transition-colors"
          >
            <Minus size={12} />
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...items, ''])}
        className="flex items-center gap-1 text-[10px] text-[var(--color-accent-blue)] hover:underline"
      >
        <Plus size={12} /> Add
      </button>
    </div>
  </div>
);

// ---------- Footer (Save / Delete buttons) ----------

export const InspectorFooter = ({
  dirty,
  onSave,
  onDelete,
}: {
  dirty: boolean;
  onSave: () => void;
  onDelete: () => void;
}) => (
  <div className="p-3 border-t border-[var(--color-border-subtle)] flex items-center gap-2">
    <button
      onClick={onSave}
      disabled={!dirty}
      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-40"
      style={{ backgroundColor: 'var(--color-aviatrix)' }}
      onMouseEnter={(e) => dirty && (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix-dark)')}
      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--color-aviatrix)')}
    >
      <Save size={13} />
      Save
    </button>
    <button
      onClick={onDelete}
      className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
      style={{
        backgroundColor: 'var(--color-surface)',
        borderColor: 'var(--color-border-subtle)',
        color: 'var(--color-text-secondary)',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-button-hover)';
        e.currentTarget.style.color = '#ef4444';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.backgroundColor = 'var(--color-surface)';
        e.currentTarget.style.color = 'var(--color-text-secondary)';
      }}
    >
      <Trash2 size={13} />
    </button>
  </div>
);


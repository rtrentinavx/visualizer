interface ConfirmModalProps {
  title: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ConfirmModal({ title, message, onConfirm, onCancel }: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className="w-full max-w-sm rounded-xl border shadow-2xl p-5"
        style={{ backgroundColor: 'var(--color-surface-raised)', borderColor: 'var(--color-border-subtle)' }}
      >
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)] mb-2">{title}</h3>
        <p className="text-xs text-[var(--color-text-secondary)] mb-4">{message}</p>
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors"
            style={{
              backgroundColor: 'var(--color-surface)',
              borderColor: 'var(--color-border-subtle)',
              color: 'var(--color-text-secondary)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-3 py-1.5 rounded-md text-xs font-medium text-white transition-colors"
            style={{ backgroundColor: 'var(--color-aviatrix)' }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

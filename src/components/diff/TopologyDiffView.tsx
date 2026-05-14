import type { TopologyDiff, FieldChange, EntityDiffSection } from '../../lib/topologyDiff';

/**
 * Rendering primitives for `TopologyDiff` — shared by HistoryModal (compare two
 * snapshots) and AutopilotModal (preview "current + selected cards" vs current).
 *
 * The diff data shape is identical in both cases — added/removed/modified per
 * entity type — so the renderer is too. Keeping it here avoids drift between
 * the two views.
 */

interface NamedEntity {
  id: string;
  name?: string;
}

function entityLabel(e: NamedEntity): string {
  return e.name ? `${e.name} (${e.id})` : e.id;
}

function stringifyValue(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v === 'object') {
    const s = JSON.stringify(v);
    return s.length > 80 ? s.slice(0, 77) + '…' : s;
  }
  return String(v);
}

export function DiffTotalsBadges({ diff }: { diff: TopologyDiff }) {
  return (
    <div className="flex items-center gap-2 text-[10px] font-semibold">
      <span className="px-2 py-0.5 rounded bg-green-500/15 text-green-400">+{diff.totals.added} added</span>
      <span className="px-2 py-0.5 rounded bg-red-500/15 text-red-400">−{diff.totals.removed} removed</span>
      <span className="px-2 py-0.5 rounded bg-blue-500/15 text-blue-400">~{diff.totals.modified} modified</span>
    </div>
  );
}

export function DiffSection({
  label,
  added,
  removed,
  modified,
}: {
  label: string;
  added: NamedEntity[];
  removed: NamedEntity[];
  modified: Array<{ entity: NamedEntity; changes?: Record<string, FieldChange> }>;
}) {
  return (
    <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--color-border-subtle)' }}>
      <div
        className="px-3 py-2 text-[10px] font-semibold uppercase tracking-wider"
        style={{ backgroundColor: 'var(--color-surface)', color: 'var(--color-text-secondary)' }}
      >
        {label}
      </div>
      <ul className="divide-y" style={{ borderColor: 'var(--color-border-subtle)' }}>
        {added.map((e) => (
          <li key={`+${e.id}`} className="px-3 py-2 flex items-start gap-2">
            <span className="text-[10px] font-bold text-green-400 shrink-0 mt-0.5">+</span>
            <span className="text-xs text-[var(--color-text-primary)] break-all">{entityLabel(e)}</span>
          </li>
        ))}
        {removed.map((e) => (
          <li key={`-${e.id}`} className="px-3 py-2 flex items-start gap-2">
            <span className="text-[10px] font-bold text-red-400 shrink-0 mt-0.5">−</span>
            <span className="text-xs text-[var(--color-text-primary)] break-all">{entityLabel(e)}</span>
          </li>
        ))}
        {modified.map((m) => (
          <li key={`~${m.entity.id}`} className="px-3 py-2">
            <div className="flex items-start gap-2 mb-1.5">
              <span className="text-[10px] font-bold text-blue-400 shrink-0 mt-0.5">~</span>
              <span className="text-xs text-[var(--color-text-primary)] break-all">{entityLabel(m.entity)}</span>
            </div>
            {m.changes && (
              <ul className="ml-4 space-y-0.5">
                {Object.entries(m.changes).map(([field, change]) => (
                  <li key={field} className="text-[10px] text-[var(--color-text-muted)] font-mono break-all">
                    <span className="text-[var(--color-text-secondary)]">{field}:</span>{' '}
                    <span className="text-red-400">{stringifyValue(change.from)}</span>{' '}
                    <span className="text-[var(--color-text-muted)]">→</span>{' '}
                    <span className="text-green-400">{stringifyValue(change.to)}</span>
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render every non-empty section of a TopologyDiff in canonical order. */
export function TopologyDiffSections({ diff }: { diff: TopologyDiff }) {
  const sections: Array<{ label: string; section: EntityDiffSection<NamedEntity> }> = [
    { label: 'SmartGroups', section: diff.smartGroups },
    { label: 'WebGroups', section: diff.webGroups },
    { label: 'ThreatGroups', section: diff.threatGroups },
    { label: 'GeoGroups', section: diff.geoGroups },
    { label: 'Policies', section: diff.policies },
  ];
  return (
    <>
      {sections.map(({ label, section }) => {
        const total = section.added.length + section.removed.length + section.modified.length;
        if (total === 0) return null;
        return (
          <DiffSection
            key={label}
            label={label}
            added={section.added}
            removed={section.removed}
            modified={section.modified}
          />
        );
      })}
    </>
  );
}

import { memo } from 'react';
import type { DcfPolicy } from '../../types/dcf';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SEGMENT_HEIGHT = 4;
const SEGMENT_WIDTH = 20;
const GLYPH_SIZE = 10;
const GLYPH_GAP = 3;
const PADDING = 4;

const ACTION_COLOR: Record<string, string> = {
  allow: '#22c55e',
  deny: '#ef4444',
  learned: '#f59e0b',
};

// Collapsed dimensions
const STRIP_HEIGHT = (policies: DcfPolicy[]) => policies.length * SEGMENT_HEIGHT;
const COLLAPSED_W = SEGMENT_WIDTH + PADDING * 2;
const COLLAPSED_H = (policies: DcfPolicy[], hasGlyphs: boolean) =>
  STRIP_HEIGHT(policies) + PADDING * 2 + (hasGlyphs ? GLYPH_SIZE + GLYPH_GAP : 0);

// Expanded dimensions
const EXPANDED_W = 120;
const EXPANDED_SEGMENT_H = 16;
const EXPANDED_H = (policies: DcfPolicy[], hasGlyphs: boolean) =>
  policies.length * (EXPANDED_SEGMENT_H + 2) + PADDING * 2 + (hasGlyphs ? GLYPH_SIZE + GLYPH_GAP + 4 : 0);

// ---------------------------------------------------------------------------
// Glyph icons (pure SVG paths, no external dep needed here)
// ---------------------------------------------------------------------------

interface GlyphProps {
  x: number;
  y: number;
  title: string;
  color: string;
}

/** Lock icon — WebGroup (L7) */
function LockGlyph({ x, y, title }: GlyphProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{title}</title>
      {/* shackle */}
      <path
        d="M2 5 V3.5 A2 2 0 0 1 6 3.5 V5"
        fill="none"
        stroke="#60a5fa"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      {/* body */}
      <rect x={0.5} y={4.5} width={7} height={5} rx={1} fill="#60a5fa" />
    </g>
  );
}

/** Shield icon — ThreatGroup */
function ShieldGlyph({ x, y, title }: GlyphProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{title}</title>
      <path
        d="M4 1 L7.5 2.5 V5.5 C7.5 7.5 4 9.5 4 9.5 C4 9.5 0.5 7.5 0.5 5.5 V2.5 Z"
        fill="#f97316"
      />
    </g>
  );
}

/** Globe icon — GeoGroup */
function GlobeGlyph({ x, y, title }: GlyphProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{title}</title>
      <circle cx={4} cy={5} r={3.5} fill="none" stroke="#a78bfa" strokeWidth={1.2} />
      <ellipse cx={4} cy={5} rx={1.8} ry={3.5} fill="none" stroke="#a78bfa" strokeWidth={1} />
      <line x1={0.5} y1={5} x2={7.5} y2={5} stroke="#a78bfa" strokeWidth={1} />
    </g>
  );
}

/** Eye-off icon — no logging */
function EyeOffGlyph({ x, y, title }: GlyphProps) {
  return (
    <g transform={`translate(${x},${y})`}>
      <title>{title}</title>
      {/* crossed-out eye */}
      <path
        d="M1 2 C2 4.5 6 7 7.5 5.5"
        fill="none"
        stroke="#9ca3af"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <path
        d="M0.5 5 C2 2 6 0.5 7.5 3"
        fill="none"
        stroke="#9ca3af"
        strokeWidth={1.2}
        strokeLinecap="round"
      />
      <line x1={1} y1={1} x2={7.5} y2={8} stroke="#9ca3af" strokeWidth={1.2} strokeLinecap="round" />
    </g>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface EdgeLabelProps {
  policies: DcfPolicy[];
  x: number;
  y: number;
  isHovered: boolean;
  onClick: () => void;
}

// ---------------------------------------------------------------------------
// EdgeLabel
// ---------------------------------------------------------------------------

function EdgeLabel({ policies, x, y, isHovered, onClick }: EdgeLabelProps) {
  if (policies.length === 0) return null;

  const allUnenforced = policies.every((p) => p.enforcement === false);
  const hasWebGroup = policies.some((p) => Array.isArray(p.webGroupIds) && p.webGroupIds.length > 0);
  const hasThreatGroup = policies.some((p) => !!p.threatGroup);
  const hasGeoGroup = policies.some((p) => !!p.geoGroup);
  const hasNoLogging = policies.some((p) => p.logging === false);
  const hasGlyphs = hasWebGroup || hasThreatGroup || hasGeoGroup || hasNoLogging;

  const opacity = allUnenforced ? 0.4 : 1;

  // -------------------------------------------------------------------------
  // Collapsed rendering (pure SVG — no foreignObject needed for the strip)
  // -------------------------------------------------------------------------
  if (!isHovered) {
    const w = COLLAPSED_W;
    const h = COLLAPSED_H(policies, hasGlyphs);
    const ox = x - w / 2;
    const oy = y - h / 2;

    const segX = PADDING;

    // Build glyph row
    let glyphX = PADDING;
    const glyphY = PADDING + STRIP_HEIGHT(policies) + GLYPH_GAP;
    const glyphs: React.ReactNode[] = [];
    if (hasWebGroup) {
      glyphs.push(<LockGlyph key="lock" x={glyphX} y={glyphY} title="WebGroup (L7)" color="#60a5fa" />);
      glyphX += GLYPH_SIZE + GLYPH_GAP;
    }
    if (hasThreatGroup) {
      glyphs.push(<ShieldGlyph key="shield" x={glyphX} y={glyphY} title="ThreatGroup" color="#f97316" />);
      glyphX += GLYPH_SIZE + GLYPH_GAP;
    }
    if (hasGeoGroup) {
      glyphs.push(<GlobeGlyph key="globe" x={glyphX} y={glyphY} title="GeoGroup" color="#a78bfa" />);
      glyphX += GLYPH_SIZE + GLYPH_GAP;
    }
    if (hasNoLogging) {
      glyphs.push(<EyeOffGlyph key="eyeoff" x={glyphX} y={glyphY} title="Logging disabled" color="#9ca3af" />);
    }

    return (
      <g
        transform={`translate(${ox},${oy})`}
        style={{ opacity, cursor: 'pointer' }}
        onClick={(e) => { e.stopPropagation(); onClick(); }}
      >
        {/* Background */}
        <rect
          x={0}
          y={0}
          width={w}
          height={h}
          rx={4}
          ry={4}
          fill="rgba(15,23,42,0.85)"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={1}
        />

        {/* Priority strip segments */}
        {policies.map((policy, idx) => (
          <rect
            key={policy.id}
            x={segX}
            y={PADDING + idx * SEGMENT_HEIGHT}
            width={SEGMENT_WIDTH}
            height={SEGMENT_HEIGHT - 1}
            rx={1}
            ry={1}
            fill={ACTION_COLOR[policy.action] ?? '#6b7280'}
          />
        ))}

        {/* Glyph row */}
        {hasGlyphs && glyphs}
      </g>
    );
  }

  // -------------------------------------------------------------------------
  // Expanded rendering (foreignObject for HTML text)
  // -------------------------------------------------------------------------
  const w = EXPANDED_W;
  const h = EXPANDED_H(policies, hasGlyphs);
  const ox = x - w / 2;
  const oy = y - h / 2;

  // Glyph row for expanded view — rendered via foreignObject inline
  const glyphLabels: { icon: string; label: string; color: string }[] = [];
  if (hasWebGroup) glyphLabels.push({ icon: '🔒', label: 'WebGroup', color: '#60a5fa' });
  if (hasThreatGroup) glyphLabels.push({ icon: '🛡', label: 'Threat', color: '#f97316' });
  if (hasGeoGroup) glyphLabels.push({ icon: '🌐', label: 'Geo', color: '#a78bfa' });
  if (hasNoLogging) glyphLabels.push({ icon: '🚫', label: 'No Log', color: '#9ca3af' });

  return (
    <g
      transform={`translate(${ox},${oy})`}
      style={{ opacity, cursor: 'pointer' }}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
    >
      {/* Background */}
      <rect
        x={0}
        y={0}
        width={w}
        height={h}
        rx={6}
        ry={6}
        fill="rgba(15,23,42,0.95)"
        stroke="rgba(255,255,255,0.12)"
        strokeWidth={1}
      />

      {/* Expanded foreignObject for HTML rendering */}
      <foreignObject x={0} y={0} width={w} height={h}>
        <div
          // @ts-expect-error — xmlns is required for SVG foreignObject HTML embedding
          xmlns="http://www.w3.org/1999/xhtml"
          style={{
            width: w,
            height: h,
            padding: PADDING,
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
          }}
        >
          {/* Policy rows */}
          {policies.map((policy, idx) => (
            <div
              key={policy.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                height: EXPANDED_SEGMENT_H,
              }}
            >
              {/* Color segment */}
              <div
                style={{
                  width: SEGMENT_WIDTH,
                  height: SEGMENT_HEIGHT,
                  borderRadius: 1,
                  flexShrink: 0,
                  background: ACTION_COLOR[policy.action] ?? '#6b7280',
                }}
              />
              {/* Priority badge */}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 700,
                  color: 'rgba(255,255,255,0.45)',
                  flexShrink: 0,
                  minWidth: 20,
                  textAlign: 'right',
                }}
              >
                {policy.priority}
              </span>
              {/* Policy name */}
              <span
                style={{
                  fontSize: 9,
                  fontWeight: idx === 0 ? 600 : 400,
                  color: idx === 0 ? '#f1f5f9' : 'rgba(255,255,255,0.55)',
                  overflow: 'hidden',
                  whiteSpace: 'nowrap',
                  textOverflow: 'ellipsis',
                  flex: 1,
                }}
                title={policy.name}
              >
                {policy.name}
              </span>
            </div>
          ))}

          {/* Enrichment glyph row */}
          {hasGlyphs && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                marginTop: 4,
                paddingTop: 4,
                borderTop: '1px solid rgba(255,255,255,0.08)',
              }}
            >
              {glyphLabels.map(({ icon, label, color }) => (
                <span
                  key={label}
                  title={label}
                  style={{
                    fontSize: 8,
                    color,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 2,
                    fontFamily: 'ui-sans-serif, system-ui, sans-serif',
                  }}
                >
                  <span style={{ fontSize: 9 }}>{icon}</span>
                  {label}
                </span>
              ))}
            </div>
          )}
        </div>
      </foreignObject>
    </g>
  );
}

export default memo(EdgeLabel);

import { memo } from 'react';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';
import { Globe, Asterisk, Tag, Network } from 'lucide-react';
import type { SmartGroup } from '../../types/dcf';

export interface GroupNodeData extends Record<string, unknown> {
  group: SmartGroup;
  inboundCount: number;
  outboundCount: number;
  isIsolated: boolean;
  isFocused: boolean;
  isSpecial: boolean;
  riskLevel: 'none' | 'warn' | 'critical';
}

export type GroupNodeType = Node<GroupNodeData, 'group'>;

function getGroupIcon(group: SmartGroup, isSpecial: boolean) {
  const id = group.id;

  if (id === 'sg-internet') {
    return <Globe size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />;
  }

  if (id === 'sg-any' || isSpecial) {
    return <Asterisk size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />;
  }

  const hasVm = group.criteria.some((c) => c.type === 'vm');
  const hasCidr = group.criteria.some((c) => c.type === 'subnet' && c.cidr);

  if (hasVm) {
    return <Tag size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />;
  }

  if (hasCidr) {
    return <Network size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />;
  }

  return <Tag size={13} className="shrink-0" style={{ color: 'var(--color-text-secondary)' }} />;
}

function truncate(name: string, max: number): string {
  if (name.length <= max) return name;
  return name.slice(0, max - 1) + '…';
}

function GroupNode({ data }: NodeProps<GroupNodeType>) {
  const { group, inboundCount, outboundCount, isIsolated, isFocused, isSpecial, riskLevel } = data;

  const isDimmed = isIsolated && !isFocused;

  const borderColor =
    riskLevel === 'critical'
      ? 'var(--color-accent-red)'
      : riskLevel === 'warn'
        ? 'var(--color-accent-amber)'
        : 'var(--color-border-subtle)';

  const borderWidth = riskLevel !== 'none' ? '2px' : '1px';
  const borderStyle = isSpecial ? 'dashed' : 'solid';

  const showInbound = inboundCount > 0;
  const showOutbound = outboundCount > 0;

  const displayName = truncate(group.name, 18);

  return (
    <div
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'stretch',
        overflow: 'hidden',
        userSelect: 'none',
        width: 160,
        height: 56,
        borderRadius: 8,
        background: 'var(--color-surface-elevated)',
        border: `${borderWidth} ${borderStyle} ${borderColor}`,
        opacity: isDimmed ? 0.25 : 1,
        transition: 'opacity 0.2s ease, border-color 0.15s ease',
        boxShadow: isFocused
          ? '0 0 0 2px var(--color-accent-blue)'
          : '0 1px 4px rgba(0,0,0,0.35)',
      }}
    >
      {/* Left color accent strip */}
      <div
        style={{
          width: 4,
          flexShrink: 0,
          borderRadius: '6px 0 0 6px',
          background: group.color || 'var(--color-accent-blue)',
        }}
      />

      {/* Main content area */}
      <div
        style={{
          display: 'flex',
          flex: 1,
          alignItems: 'center',
          gap: 6,
          paddingLeft: 8,
          paddingRight: 8,
          minWidth: 0,
        }}
      >
        {/* Type glyph */}
        {getGroupIcon(group, isSpecial)}

        {/* Group name */}
        <span
          title={group.name}
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 11,
            fontWeight: 500,
            lineHeight: 1.3,
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            color: 'var(--color-text-primary)',
          }}
        >
          {displayName}
        </span>

        {/* Traffic count pills */}
        {(showInbound || showOutbound) && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexShrink: 0 }}>
            {showInbound && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: '2px 4px',
                  borderRadius: 9999,
                  background: 'rgba(16,185,129,0.18)',
                  color: 'var(--color-accent-green)',
                  border: '1px solid rgba(16,185,129,0.3)',
                }}
              >
                ↓{inboundCount}
              </span>
            )}
            {showOutbound && (
              <span
                style={{
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: 1,
                  padding: '2px 4px',
                  borderRadius: 9999,
                  background: 'rgba(59,130,246,0.18)',
                  color: 'var(--color-accent-blue)',
                  border: '1px solid rgba(59,130,246,0.3)',
                }}
              >
                ↑{outboundCount}
              </span>
            )}
          </div>
        )}
      </div>

      {/* React Flow handles */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 8,
          height: 8,
          left: -4,
          background: 'var(--color-surface-elevated)',
          border: '2px solid var(--color-border-subtle)',
        }}
      />
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 8,
          height: 8,
          right: -4,
          background: 'var(--color-surface-elevated)',
          border: '2px solid var(--color-border-subtle)',
        }}
      />
    </div>
  );
}

export default memo(GroupNode);

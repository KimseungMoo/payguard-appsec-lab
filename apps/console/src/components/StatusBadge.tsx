import React from 'react';
import type { TrafficEvent } from '../App';

export interface BadgeMeta {
  label: string;
  color: string;
  bg: string;
  dotColor: string;
}

export function getEventBadgeMeta(ev: TrafficEvent): BadgeMeta {
  if (ev.wafAction === 'FALSE_POSITIVE') {
    return {
      label: `FP BLOCK ${ev.statusCode}`,
      color: '#fbbf24',
      bg: 'rgba(245, 158, 11, 0.14)',
      dotColor: '#f59e0b',
    };
  }
  if (ev.appAction === 'EXPLOITED') {
    return {
      label: `EXPLOITED ${ev.statusCode}`,
      color: '#fda4af',
      bg: 'rgba(244, 63, 94, 0.16)',
      dotColor: '#f43f5e',
    };
  }
  if (ev.appAction === 'BLOCKED_GUARD' || ev.wafAction === 'BLOCKED') {
    return {
      label: `BLOCKED ${ev.statusCode}`,
      color: '#38bdf8',
      bg: 'rgba(56, 189, 248, 0.15)',
      dotColor: '#38bdf8',
    };
  }
  return {
    label: `NORMAL ${ev.statusCode}`,
    color: '#34d399',
    bg: 'rgba(16, 185, 129, 0.14)',
    dotColor: '#10b981',
  };
}

/** Fixed-width status pill (128px border-box) so streaming rows never shift or overlap URLs. */
export function StatusBadge({ event }: { event: TrafficEvent }) {
  const meta = getEventBadgeMeta(event);
  return (
    <span
      style={{
        boxSizing: 'border-box',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 6,
        width: 128,
        minWidth: 128,
        flexShrink: 0,
        padding: '3px 8px',
        borderRadius: 5,
        background: meta.bg,
        color: meta.color,
        fontFamily: "'JetBrains Mono', ui-monospace, SFMono-Regular, Menlo, monospace",
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.02em',
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          background: meta.dotColor,
          flexShrink: 0,
        }}
      />
      {meta.label}
    </span>
  );
}

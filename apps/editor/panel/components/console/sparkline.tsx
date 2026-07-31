'use client';

import { useId } from 'react';

/**
 * Small trend line for the metric cards.
 *
 * `dtDash` draws the stroke on first paint. The key is the point count, so the
 * animation replays when a series is first filled but not on every 4 s tick —
 * a line that redraws itself every poll reads as a glitch, not as motion.
 */
export function Sparkline({
  values,
  width = 132,
  height = 30,
  tone = 'brand',
}: {
  values: number[];
  width?: number;
  height?: number;
  tone?: 'brand' | 'muted';
}) {
  const gradientId = useId();

  if (values.length < 2) {
    return (
      <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden className="block">
        <line
          x1={0}
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--dt-input)"
          strokeWidth={1.5}
          strokeLinecap="round"
        />
      </svg>
    );
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  // A flat series has zero span; without the guard every point lands on NaN.
  const span = max - min || 1;
  const step = width / (values.length - 1);

  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - 2 - ((value - min) / span) * (height - 4);
    return [x, y] as const;
  });

  const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const stroke = tone === 'brand' ? 'var(--dt-brand)' : 'var(--dt-muted-fg)';

  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} aria-hidden className="block">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        key={values.length}
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ strokeDasharray: 220, animation: 'dtDash 0.9s ease forwards' }}
      />
    </svg>
  );
}

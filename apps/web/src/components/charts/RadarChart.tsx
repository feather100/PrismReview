import React from 'react';

export interface RadarDatum {
  name: string;
  value: number; // 0-100
  max?: number;
}

interface Props {
  data: RadarDatum[];
  size?: number;
  color?: string;
  fillOpacity?: number;
}

/**
 * Pure-SVG radar/spider chart. Zero external dependencies so we don't pull in
 * recharts. Draws N axes + a single polygon for `data` aligned by index.
 */
export default function RadarChart({
  data,
  size = 240,
  color = '#6366f1',
  fillOpacity = 0.2,
}: Props) {
  const n = data.length;
  const cx = size / 2;
  const cy = size / 2;
  const radius = (size / 2) * 0.78;
  const axisStep = (Math.PI * 2) / n;

  const pointAt = (i: number, ratio: number) => {
    const angle = axisStep * i - Math.PI / 2;
    return [cx + Math.cos(angle) * radius * ratio, cy + Math.sin(angle) * radius * ratio];
  };

  // Concentric grid rings at 25 / 50 / 75 / 100 %.
  const rings = [0.25, 0.5, 0.75, 1].map((r) =>
    Array.from({ length: n })
      .map((_, i) => pointAt(i, r).join(','))
      .join(' '),
  );

  const valuePoints = data.map((d, i) => pointAt(i, Math.min(100, Math.max(0, d.value)) / 100));
  const polygon = valuePoints.map((p) => p.join(',')).join(' ');

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Radar chart"
    >
      {rings.map((pts, i) => (
        <polygon
          key={i}
          points={pts}
          fill="none"
          stroke="#e2e8f0"
          strokeWidth={1}
        />
      ))}

      {/* Axes */}
      {data.map((_, i) => {
        const [x, y] = pointAt(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e2e8f0" strokeWidth={1} />;
      })}

      {/* Value polygon */}
      <polygon
        points={polygon}
        fill={color}
        fillOpacity={fillOpacity}
        stroke={color}
        strokeWidth={2}
      />

      {/* Points */}
      {valuePoints.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={3} fill={color} />
      ))}

      {/* Labels */}
      {data.map((d, i) => {
        const [x, y] = pointAt(i, 1.18);
        return (
          <text
            key={i}
            x={x}
            y={y}
            fontSize={11}
            textAnchor="middle"
            dominantBaseline="middle"
            fill="#475569"
          >
            {d.name}
          </text>
        );
      })}
    </svg>
  );
}

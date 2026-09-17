import { useEffect, useRef, useState } from "react";

const PAD_TOP = 20;
const PAD_BOTTOM = 26;
const PAD_LEFT = 8;
const PAD_RIGHT = 8;

const TrendChart = ({ points, color, formatValue = (v) => v, emptyLabel = "No data available", height = 170 }) => {
  const HEIGHT = height;
  const [hovered, setHovered] = useState(null);
  const [width, setWidth] = useState(600);
  const containerRef = useRef(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (w) setWidth(w);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const total = points.reduce((sum, p) => sum + p.value, 0);

  if (!points.length || total === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center" style={{ minHeight: HEIGHT }}>
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mb-3" style={{ background: "#F3F8FB", color: "#94A3B8" }}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3v18h18" />
            <path d="M7 14l3-3 3 2 4-5" />
          </svg>
        </div>
        <p className="text-sm font-medium" style={{ color: "#334155" }}>{emptyLabel}</p>
      </div>
    );
  }

  const plotWidth = width - PAD_LEFT - PAD_RIGHT;
  const plotHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const stepX = points.length > 1 ? plotWidth / (points.length - 1) : 0;

  const coords = points.map((p, i) => ({
    ...p,
    x: PAD_LEFT + stepX * i,
    y: PAD_TOP + plotHeight - (p.value / maxValue) * plotHeight,
  }));

  // Catmull-Rom-derived cubic bezier through each point, for a smooth curve
  // instead of straight segments — hover targets/tooltips stay anchored to
  // the original data points regardless.
  const smoothPath = (pts) => {
    if (pts.length < 2) return pts.length ? `M ${pts[0].x} ${pts[0].y}` : "";
    const smoothing = 0.18;
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 1; i < pts.length; i++) {
      const p0 = pts[i - 1];
      const p1 = pts[i];
      const prev = pts[i - 2] || p0;
      const next = pts[i + 1] || p1;
      const cp1x = p0.x + (p1.x - prev.x) * smoothing;
      const cp1y = p0.y + (p1.y - prev.y) * smoothing;
      const cp2x = p1.x - (next.x - p0.x) * smoothing;
      const cp2y = p1.y - (next.y - p0.y) * smoothing;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p1.x} ${p1.y}`;
    }
    return d;
  };

  const linePath = smoothPath(coords);
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${PAD_TOP + plotHeight} L ${coords[0].x} ${PAD_TOP + plotHeight} Z`;
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const gradientId = `trend-gradient-${color.replace("#", "")}`;
  const hoveredPoint = hovered !== null ? coords[hovered] : null;
  const tooltipX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x, 55), width - 55) : 0;

  return (
    <div ref={containerRef}>
      <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} style={{ width: "100%", height: `${HEIGHT}px`, display: "block" }}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity="0.22" />
            <stop offset="100%" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>

        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={PAD_LEFT} x2={width - PAD_RIGHT} y1={PAD_TOP + plotHeight * f} y2={PAD_TOP + plotHeight * f} stroke="#EDF3F8" strokeWidth="1" />
        ))}

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path d={linePath} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

        {coords.map((c, i) => (
          <g key={c.date} onMouseEnter={() => setHovered(i)} onMouseLeave={() => setHovered(null)} style={{ cursor: "pointer" }}>
            <rect x={c.x - stepX / 2} y={PAD_TOP} width={Math.max(stepX, 1)} height={plotHeight} fill="transparent" />
            <circle cx={c.x} cy={c.y} r={hovered === i ? 5 : 3} fill="#fff" stroke={color} strokeWidth="2" />
            {i % labelEvery === 0 && (
              <text x={c.x} y={HEIGHT - 10} textAnchor="middle" fontSize="11" fontWeight="600" fill="#94A3B8">
                {c.label}
              </text>
            )}
          </g>
        ))}

        {hoveredPoint && (
          <g pointerEvents="none">
            <line x1={hoveredPoint.x} x2={hoveredPoint.x} y1={PAD_TOP} y2={PAD_TOP + plotHeight} stroke={color} strokeWidth="1" strokeDasharray="3 3" opacity="0.4" />
            <rect x={tooltipX - 55} y={PAD_TOP - 6} width="110" height="34" rx="8" fill="#0f172a" />
            <text x={tooltipX} y={PAD_TOP + 10} textAnchor="middle" fontSize="11" fontWeight="700" fill="#fff">
              {formatValue(hoveredPoint.value)}
            </text>
            <text x={tooltipX} y={PAD_TOP + 22} textAnchor="middle" fontSize="10" fill="#cbd5e1">
              {hoveredPoint.label}
            </text>
          </g>
        )}
      </svg>
    </div>
  );
};

export default TrendChart;

// A small chart that keeps drawing itself while the agent works: bars grow,
// a line runs across them, and a dot lands at its end. The animations live
// in index.css, and stay still for visitors who turned off motion.

const BARS = [
  { x: 10, height: 18 },
  { x: 32, height: 28 },
  { x: 54, height: 22 },
  { x: 76, height: 40 },
  { x: 98, height: 32 },
];

export function DrawingChart() {
  return (
    <svg
      viewBox="0 0 120 64"
      className="h-20 w-36 text-primary"
      aria-hidden
      focusable="false"
    >
      <line
        x1="4"
        y1="60"
        x2="116"
        y2="60"
        className="stroke-border"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      {BARS.map(({ x, height }, index) => (
        <rect
          key={x}
          x={x}
          y={58 - height}
          width="12"
          height={height}
          rx="2"
          // Light, so the line stands out. As fill-opacity, since the
          // animation sets opacity.
          fillOpacity={0.18}
          className="drawing-chart-bar fill-current"
          style={{ animationDelay: `${String(index * 90)}ms` }}
        />
      ))}
      <polyline
        points="16,46 38,36 60,42 82,18 104,26"
        pathLength={1}
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="drawing-chart-line"
      />
      <circle
        cx="104"
        cy="26"
        r="3.5"
        className="drawing-chart-dot fill-current"
      />
    </svg>
  );
}

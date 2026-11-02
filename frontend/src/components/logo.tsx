// The bars, left to right: where each is, and how high it reaches. They all
// stand on the same ground.
const BARS = [
  { x: 4, top: 18 },
  { x: 8, top: 14 },
  { x: 12, top: 16 },
  { x: 16, top: 14 },
  { x: 20, top: 10 },
];

/**
 * DashGen's mark: bars with a line running over them and a dot at its end,
 * like the charts it draws. It draws itself once as the page opens, with the
 * watchlist's mini charts' motions (index.css), then stays still. Hidden from
 * screen readers, since the name beside it says it all.
 */
export function Logo({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      focusable="false"
    >
      {BARS.map(({ x, top }, index) => (
        <line
          key={x}
          x1={x}
          y1={top}
          x2={x}
          y2={21}
          className="logo-bar"
          // Left to right, one after another.
          style={{ animationDelay: `${String(index * 60)}ms` }}
        />
      ))}
      <polyline
        points="2,15 9,8 13,12 21,3.5"
        // As 1, so the animation can draw it from 0 to 1, whatever its length.
        pathLength={1}
        className="logo-line"
      />
      <circle
        cx="21"
        cy="3.5"
        r="1.75"
        fill="currentColor"
        stroke="none"
        className="logo-dot"
      />
    </svg>
  );
}

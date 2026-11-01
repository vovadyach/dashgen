import type { Chart } from "@dashgen/contracts";

const WIDTH = 96;
const HEIGHT = 32;
const PAD = 4;

interface Props {
  chart: Chart;
  /** The series the card's number comes from, drawn when it's over time. */
  series: Chart["series"][number];
  /** Which drawing this is: a new number draws the chart again, from the start. */
  drawing?: number;
  /** The line's end dot, in its series' color. The page's accent by default. */
  dot?: string;
}

/**
 * A pinned chart in miniature: a series over time as a line ending in a
 * dot, services side by side as bars, or a pie as a ring, the largest in
 * color. It draws itself once as it appears, with the animations in
 * index.css. Hidden from screen readers, since the card's title and number
 * say what it shows.
 */
export function Sparkline({ chart, series, drawing = 0, dot }: Props) {
  const sideBySide = chart.type === "pie" || chart.x === "category";
  const values = sideBySide
    ? chart.series.flatMap((s) => s.points.map((point) => point.y))
    : series.points.map((point) => point.y);
  // Loops, not Math.min(...values): too many arguments in one call throws.
  const low = sideBySide
    ? 0
    : values.reduce((a, b) => Math.min(a, b), Infinity);
  const high = values.reduce((a, b) => Math.max(a, b), -Infinity);
  // From the bottom up. A flat series sits in the middle.
  const y = (value: number) =>
    high === low
      ? HEIGHT / 2
      : HEIGHT - PAD - ((value - low) / (high - low)) * (HEIGHT - 2 * PAD);
  return (
    <svg
      viewBox={`0 0 ${String(WIDTH)} ${String(HEIGHT)}`}
      className="h-8 w-24 shrink-0 overflow-visible"
      aria-hidden
      focusable="false"
    >
      {/* A new key makes new elements, whose animations start over. */}
      <g key={drawing}>
        {chart.type === "pie" ? (
          <Ring values={values} high={high} />
        ) : sideBySide ? (
          <Bars values={values} high={high} y={y} />
        ) : (
          <Line values={values} y={y} dot={dot} />
        )}
      </g>
    </svg>
  );
}

function Line({
  values,
  y,
  dot,
}: {
  values: number[];
  y: (value: number) => number;
  dot?: string;
}) {
  const step = (WIDTH - 2 * PAD) / Math.max(values.length - 1, 1);
  const points = values.map((value, index) => ({
    x: PAD + index * step,
    y: y(value),
  }));
  const last = points.at(-1);
  return (
    <>
      <polyline
        points={points
          .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
          .join(" ")}
        // As 1, so the animation can draw it from 0 to 1, whatever its length.
        pathLength={1}
        fill="none"
        className="sparkline-line stroke-muted-foreground"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {last && (
        <circle
          cx={last.x}
          cy={last.y}
          r="3"
          className="sparkline-dot fill-primary"
          style={dot ? { fill: dot } : undefined}
        />
      )}
    </>
  );
}

function Bars({
  values,
  high,
  y,
}: {
  values: number[];
  high: number;
  y: (value: number) => number;
}) {
  const band = (WIDTH - 2 * PAD) / values.length;
  const width = Math.min(band * 0.6, 12);
  return values.map((value, index) => (
    <rect
      key={index}
      x={PAD + index * band + (band - width) / 2}
      y={y(value)}
      width={width}
      height={Math.max(HEIGHT - PAD - y(value), 1)}
      rx="1.5"
      className={
        value === high
          ? "sparkline-bar fill-primary"
          : "sparkline-bar fill-muted-foreground opacity-40"
      }
      // Left to right, one after another.
      style={{ animationDelay: `${String(index * 60)}ms` }}
    />
  ));
}

// The ring sits at the right end, where a line ends in its dot.
const RING = { x: WIDTH - HEIGHT / 2, y: HEIGHT / 2, radius: 11, width: 6 };
// How long the whole ring takes to draw, slice after slice, in ms.
const SWEEP = 900;
// The gap in the card's color after each slice, as a share of the ring.
const GAP = 0.02;

function Ring({ values, high }: { values: number[]; high: number }) {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const shares = values.map((value) => value / total);
  const starts = shares.map((_, index) =>
    shares.slice(0, index).reduce((a, b) => a + b, 0),
  );
  return (
    // Turned a quarter back, so the first slice starts at 12 o'clock.
    <g transform={`rotate(-90 ${String(RING.x)} ${String(RING.y)})`}>
      {shares.map((share, index) => {
        // A slice alone needs no gap.
        const length = shares.length > 1 ? share - GAP : share;
        const start = starts[index] ?? 0;
        if (length <= 0) return null;
        return (
          <circle
            key={index}
            cx={RING.x}
            cy={RING.y}
            r={RING.radius}
            fill="none"
            strokeWidth={RING.width}
            // As 1, so a slice's length and place on the ring are its share.
            pathLength={1}
            strokeDasharray={`${length.toFixed(4)} 1`}
            strokeDashoffset={(-start).toFixed(4)}
            className={
              values[index] === high
                ? "sparkline-slice stroke-primary"
                : "sparkline-slice stroke-muted-foreground opacity-40"
            }
            // Each starts where the one before ends, so the ring draws in
            // one sweep.
            style={{
              animationDelay: `${String(Math.round(start * SWEEP))}ms`,
              animationDuration: `${String(Math.max(Math.round(share * SWEEP), 1))}ms`,
            }}
          />
        );
      })}
    </g>
  );
}

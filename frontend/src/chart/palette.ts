/**
 * The charts' colors in each theme. The series colors go in this order, one
 * slot per series, never skipping one: the order keeps neighboring series
 * apart for color-blind readers, on both surfaces. The neutrals are the
 * cards' colors too (src/index.css), so a chart sits on its card seamlessly.
 */
export const PALETTE = {
  light: {
    series: [
      "#2a78d6",
      "#eb6834",
      "#1baf7a",
      "#eda100",
      "#e87ba4",
      "#008300",
      "#6250d6",
      "#e34948",
    ],
    surface: "#fcfcfb",
    text: "#0b0b0b",
    subtleText: "#52514e",
    grid: "#e1e0d9",
    axis: "#c3c2b7",
  },
  dark: {
    series: [
      "#3987e5",
      "#d95926",
      "#199e70",
      "#c98500",
      "#d55181",
      "#008300",
      "#9085e9",
      "#e66767",
    ],
    surface: "#1a1a19",
    text: "#f0efec",
    subtleText: "#c3c2b7",
    grid: "#2c2c2a",
    axis: "#383835",
  },
} as const;

export type Mode = keyof typeof PALETTE;
export type Colors = (typeof PALETTE)[Mode];

/** The color for the nth series. Charts have at most 8 series, one per service. */
export const seriesColor = (colors: Colors, index: number): string =>
  colors.series[index % colors.series.length] ?? colors.series[0];

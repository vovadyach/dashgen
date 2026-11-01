import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown instead of the chart when it can't load or draw. */
  fallback: ReactNode;
}

/**
 * Keeps the page when the chart fails, like when its code doesn't download:
 * without this, React empties the whole page. React catches such errors
 * only in a class component.
 */
export class ChartBoundary extends Component<Props, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

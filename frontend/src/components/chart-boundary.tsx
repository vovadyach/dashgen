import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Shown instead of the chart when it can't load or draw. */
  fallback: ReactNode;
  /**
   * A new value, like the next chart, clears the failure, so a chart that
   * failed to draw doesn't stop the ones after it. Code that failed to
   * download fails again, since React keeps that failure: the fallback asks
   * for a reload.
   */
  resetKey?: unknown;
}

interface State {
  failed: boolean;
  resetKey: unknown;
}

/**
 * Keeps the page when the chart fails, like when its code doesn't download:
 * without this, React empties the whole page. React catches such errors
 * only in a class component.
 */
export class ChartBoundary extends Component<Props, State> {
  override state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  override render() {
    return this.state.failed ? this.props.fallback : this.props.children;
  }
}

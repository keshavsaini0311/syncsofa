import { Component, type ErrorInfo, type ReactNode } from 'react';

type Props = { children: ReactNode };
type State = { failed: boolean };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[syncsofa] render crashed', error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="home">
        <h1>🛋️ syncsofa</h1>
        <p>Something broke on this page. Reloading usually fixes it.</p>
        <button className="primary" onClick={() => location.reload()}>
          Reload
        </button>
      </div>
    );
  }
}

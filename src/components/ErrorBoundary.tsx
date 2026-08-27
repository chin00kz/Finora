import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught error in React tree:', error, errorInfo);
  }

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-background text-foreground flex flex-col justify-center items-center p-6">
          <div className="max-w-md w-full bg-card border border-border rounded-2xl p-6 shadow-lg space-y-4">
            <div className="flex items-center gap-3 text-red-500">
              <AlertTriangle size={28} />
              <h2 className="text-lg font-medium">Application Error</h2>
            </div>
            
            <p className="text-sm text-muted-foreground">
              Something went wrong while rendering.
            </p>

            <div className="bg-muted p-3 rounded-xl overflow-auto max-h-48 text-xs font-mono text-red-400 space-y-1">
              <p className="font-semibold">{this.state.error?.name}: {this.state.error?.message}</p>
            </div>

            <button
              onClick={this.handleReload}
              className="w-full flex items-center justify-center gap-2 py-3 bg-accent text-accent-foreground rounded-xl text-sm font-medium active:scale-95 transition-transform"
            >
              <RefreshCw size={16} />
              Reload Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

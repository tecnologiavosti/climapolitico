import { Component, ReactNode } from "react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { AlertCircle, RotateCcw } from "lucide-react";

interface Props {
  children: ReactNode;
  /** Display name used to namespace this boundary in logs. */
  routeName?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/**
 * Per-route error boundary. Crashes inside one lazy route page no longer
 * take down the whole dashboard — sidebar, header and other routes stay alive.
 */
export class RouteErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(`💥 [RouteError:${this.props.routeName ?? "unknown"}]`, error, info);
  }

  reset = () => this.setState({ hasError: false, error: null });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="p-6">
        <Alert variant="destructive" className="max-w-2xl mx-auto">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Algo deu errado nesta página</AlertTitle>
          <AlertDescription className="mt-2 space-y-3">
            <p className="text-sm">
              {this.state.error?.message || "Erro inesperado ao renderizar esta tela."}
            </p>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={this.reset}>
                <RotateCcw className="mr-2 h-4 w-4" />
                Tentar novamente
              </Button>
              <Button size="sm" variant="default" onClick={() => window.location.reload()}>
                Recarregar
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      </div>
    );
  }
}

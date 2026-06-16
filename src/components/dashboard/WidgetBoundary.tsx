import {
  Component,
  ReactNode,
  createContext,
  useContext,
  useCallback,
  useState,
} from "react";
import { AlertTriangle } from "lucide-react";

type Status = "ok" | "fail";
type Ctx = {
  statuses: Record<string, Status>;
  report: (name: string, status: Status) => void;
};

const WidgetStatusContext = createContext<Ctx | null>(null);

export function WidgetStatusProvider({ children }: { children: ReactNode }) {
  const [statuses, setStatuses] = useState<Record<string, Status>>({});
  const report = useCallback((name: string, status: Status) => {
    setStatuses((prev) => (prev[name] === status ? prev : { ...prev, [name]: status }));
  }, []);
  return (
    <WidgetStatusContext.Provider value={{ statuses, report }}>
      {children}
    </WidgetStatusContext.Provider>
  );
}

export function useWidgetStatuses() {
  return useContext(WidgetStatusContext)?.statuses ?? {};
}

interface InnerProps {
  name: string;
  report: (name: string, status: Status) => void;
  children: ReactNode;
}

class InnerBoundary extends Component<InnerProps, { hasError: boolean }> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidMount() {
    if (!this.state.hasError) this.props.report(this.props.name, "ok");
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[Analytics]", {
      widget: this.props.name,
      error: error?.message ?? String(error),
      stack: error?.stack,
      info,
    });
    this.props.report(this.props.name, "fail");
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 border border-dashed rounded-lg bg-muted/30 text-sm text-muted-foreground flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span>Não foi possível carregar este bloco de analytics.</span>
        </div>
      );
    }
    return this.props.children;
  }
}

export function WidgetBoundary({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  const ctx = useContext(WidgetStatusContext);
  const report = ctx?.report ?? (() => {});
  return (
    <InnerBoundary name={name} report={report}>
      {children}
    </InnerBoundary>
  );
}

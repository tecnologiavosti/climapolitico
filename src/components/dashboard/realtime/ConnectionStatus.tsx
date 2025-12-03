import { Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface ConnectionStatusProps {
  isConnected: boolean;
}

export const ConnectionStatus = ({ isConnected }: ConnectionStatusProps) => {
  return (
    <div className={cn(
      "flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-all duration-300",
      isConnected 
        ? "bg-green-500/10 text-green-600 dark:text-green-400" 
        : "bg-red-500/10 text-red-600 dark:text-red-400"
    )}>
      {isConnected ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
          </span>
          <Wifi className="h-4 w-4" />
          <span>Ao Vivo</span>
        </>
      ) : (
        <>
          <WifiOff className="h-4 w-4" />
          <span>Desconectado</span>
        </>
      )}
    </div>
  );
};

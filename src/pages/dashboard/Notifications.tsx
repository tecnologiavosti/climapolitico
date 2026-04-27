import { useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, CheckCheck, Trash2, AlertTriangle, TrendingUp, Info, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { formatDistanceToNow } from "date-fns";
import { ptBR } from "date-fns/locale";
import { useAuth } from "@/hooks/useAuth";
import { HelpTooltip } from "@/components/ui/help-tooltip";

interface Notification {
  id: string;
  title: string;
  message: string;
  type: string;
  severity: string;
  is_read: boolean;
  created_at: string;
  candidate_id: string | null;
  metadata: any;
}

const severityConfig: Record<string, { icon: any; className: string; label: string }> = {
  success: { icon: CheckCircle2, className: "text-green-600", label: "Positivo" },
  warning: { icon: AlertTriangle, className: "text-amber-500", label: "Atenção" },
  error:   { icon: AlertTriangle, className: "text-red-600",   label: "Crítico" },
  info:    { icon: Info,          className: "text-blue-500",  label: "Info" },
};

export default function Notifications() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: notifications, isLoading } = useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: async (): Promise<Notification[]> => {
      const { data, error } = await supabase
        .from('notifications')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      return (data || []) as Notification[];
    },
    enabled: !!user,
  });

  // Realtime subscription
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel('notifications-feed')
      .on('postgres_changes',
        { event: '*', schema: 'public', table: 'notifications', filter: `user_id=eq.${user.id}` },
        () => qc.invalidateQueries({ queryKey: ['notifications', user.id] })
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, qc]);

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('notifications').update({ is_read: true }).eq('is_read', false);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['notifications', user?.id] });
      toast.success("Todas marcadas como lidas");
    },
  });

  const removeOne = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('notifications').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications', user?.id] }),
  });

  const unreadCount = notifications?.filter(n => !n.is_read).length || 0;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <HelpTooltip text="Avisos importantes pra você: mudanças no sentimento, novos comentários e novidades do sistema.">
        <h1 className="text-3xl font-bold flex items-center gap-2">
            <Bell className="h-8 w-8 text-primary" />
            Notificações
            {unreadCount > 0 && <Badge variant="destructive">{unreadCount} não lidas</Badge>}
          </h1>
      </HelpTooltip>
          <p className="text-muted-foreground mt-1">
            Alertas em tempo real sobre alterações nos seus candidatos e na plataforma.
          </p>
        </div>
        {unreadCount > 0 && (
          <Button variant="outline" onClick={() => markAllRead.mutate()} disabled={markAllRead.isPending}>
            <CheckCheck className="mr-2 h-4 w-4" />
            Marcar tudo como lido
          </Button>
        )}
      </div>

      {isLoading && (
        <Card><CardContent className="py-12 text-center text-muted-foreground">Carregando...</CardContent></Card>
      )}

      {!isLoading && (!notifications || notifications.length === 0) && (
        <Card>
          <CardContent className="py-16 text-center">
            <Bell className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
            <h3 className="text-lg font-semibold mb-2">Nenhuma notificação</h3>
            <p className="text-muted-foreground max-w-md mx-auto">
              Você receberá alertas aqui quando houver mudanças no sentimento, score, menções ou novidades da plataforma.
            </p>
          </CardContent>
        </Card>
      )}

      <div className="space-y-3">
        {notifications?.map(n => {
          const cfg = severityConfig[n.severity] || severityConfig.info;
          const Icon = cfg.icon;
          return (
            <Card key={n.id} className={!n.is_read ? "border-primary/40 bg-primary/5" : ""}>
              <CardContent className="pt-4 pb-4">
                <div className="flex gap-4">
                  <div className={`shrink-0 mt-1 ${cfg.className}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="font-semibold">{n.title}</h3>
                      {!n.is_read && <Badge variant="default" className="text-[10px] py-0">NOVO</Badge>}
                      <Badge variant="outline" className="text-[10px] py-0">{cfg.label}</Badge>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">{n.message}</p>
                    <p className="text-xs text-muted-foreground mt-2">
                      {formatDistanceToNow(new Date(n.created_at), { addSuffix: true, locale: ptBR })}
                    </p>
                  </div>
                  <div className="flex flex-col gap-1">
                    {!n.is_read && (
                      <Button size="icon" variant="ghost" onClick={() => markRead.mutate(n.id)} title="Marcar como lida">
                        <Check className="h-4 w-4" />
                      </Button>
                    )}
                    <Button size="icon" variant="ghost" onClick={() => removeOne.mutate(n.id)} title="Excluir">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

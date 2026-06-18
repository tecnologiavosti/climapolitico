import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { AdminRoute } from "@/components/admin/AdminRoute";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { useAdminAudit } from "@/hooks/useAdminAudit";
import { Trash2, ShieldOff } from "lucide-react";

function BannedUsers() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-banned-users"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, email, ban_reason, banned_at")
        .eq("is_banned", true)
        .order("banned_at", { ascending: false });
      return data ?? [];
    },
  });
  if (isLoading) return <Skeleton className="h-32" />;
  return (
    <Table>
      <TableHeader><TableRow><TableHead>Usuário</TableHead><TableHead>Email</TableHead><TableHead>Motivo</TableHead><TableHead>Quando</TableHead></TableRow></TableHeader>
      <TableBody>
        {(data ?? []).map((u: any) => (
          <TableRow key={u.id}>
            <TableCell>{u.full_name ?? "—"}</TableCell>
            <TableCell>{u.email ?? "—"}</TableCell>
            <TableCell>{u.ban_reason ?? "—"}</TableCell>
            <TableCell>{u.banned_at ? new Date(u.banned_at).toLocaleString("pt-BR") : "—"}</TableCell>
          </TableRow>
        ))}
        {!data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum banimento.</TableCell></TableRow>}
      </TableBody>
    </Table>
  );
}

function IpBans() {
  const qc = useQueryClient();
  const { log: audit } = useAdminAudit();
  const [ip, setIp] = useState("");
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-ip-bans"],
    queryFn: async () => {
      const { data } = await supabase.from("ip_bans").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  async function add() {
    if (!ip) return toast.error("IP obrigatório");
    const { error } = await supabase.from("ip_bans").insert({ ip_address: ip, reason });
    if (error) return toast.error(error.message);
    toast.success("IP banido");
    await audit("ip_banned", "ip", ip, { reason });
    setIp(""); setReason("");
    qc.invalidateQueries({ queryKey: ["admin-ip-bans"] });
  }
  async function remove(id: string, ipAddr: string) {
    const { error } = await supabase.from("ip_bans").delete().eq("id", id);
    if (error) return toast.error(error.message);
    await audit("ip_unbanned", "ip", ipAddr);
    qc.invalidateQueries({ queryKey: ["admin-ip-bans"] });
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="Endereço IP" value={ip} onChange={(e) => setIp(e.target.value)} className="max-w-xs" />
        <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-sm" />
        <Button onClick={add}><ShieldOff className="h-4 w-4 mr-2" /> Banir IP</Button>
      </div>
      {isLoading ? <Skeleton className="h-32" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>IP</TableHead><TableHead>Motivo</TableHead><TableHead>Quando</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((b: any) => (
              <TableRow key={b.id}>
                <TableCell className="font-mono">{b.ip_address}</TableCell>
                <TableCell>{b.reason ?? "—"}</TableCell>
                <TableCell>{new Date(b.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(b.id, b.ip_address)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum IP banido.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function BlockedEmails() {
  const qc = useQueryClient();
  const { log: audit } = useAdminAudit();
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const { data, isLoading } = useQuery({
    queryKey: ["admin-blocked-emails"],
    queryFn: async () => {
      const { data } = await supabase.from("blocked_emails").select("*").order("created_at", { ascending: false });
      return data ?? [];
    },
  });
  async function add() {
    if (!email) return toast.error("Email obrigatório");
    const { error } = await supabase.from("blocked_emails").insert({ email: email.toLowerCase(), reason });
    if (error) return toast.error(error.message);
    toast.success("Email bloqueado");
    await audit("email_blocked", "email", email, { reason });
    setEmail(""); setReason("");
    qc.invalidateQueries({ queryKey: ["admin-blocked-emails"] });
  }
  async function remove(id: string, em: string) {
    await supabase.from("blocked_emails").delete().eq("id", id);
    await audit("email_unblocked", "email", em);
    qc.invalidateQueries({ queryKey: ["admin-blocked-emails"] });
  }
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input placeholder="email@exemplo.com" value={email} onChange={(e) => setEmail(e.target.value)} className="max-w-sm" />
        <Input placeholder="Motivo" value={reason} onChange={(e) => setReason(e.target.value)} className="max-w-sm" />
        <Button onClick={add}>Bloquear</Button>
      </div>
      {isLoading ? <Skeleton className="h-32" /> : (
        <Table>
          <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>Motivo</TableHead><TableHead>Quando</TableHead><TableHead /></TableRow></TableHeader>
          <TableBody>
            {(data ?? []).map((b: any) => (
              <TableRow key={b.id}>
                <TableCell>{b.email}</TableCell>
                <TableCell>{b.reason ?? "—"}</TableCell>
                <TableCell>{new Date(b.created_at).toLocaleString("pt-BR")}</TableCell>
                <TableCell className="text-right"><Button size="sm" variant="ghost" onClick={() => remove(b.id, b.email)}><Trash2 className="h-4 w-4 text-destructive" /></Button></TableCell>
              </TableRow>
            ))}
            {!data?.length && <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Nenhum email bloqueado.</TableCell></TableRow>}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

function LoginAttempts() {
  const { data, isLoading } = useQuery({
    queryKey: ["admin-login-attempts"],
    queryFn: async () => {
      const { data } = await supabase
        .from("login_attempts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      return data ?? [];
    },
  });
  if (isLoading) return <Skeleton className="h-64" />;
  const failed = (data ?? []).filter((a: any) => !a.success).length;
  return (
    <div className="space-y-3">
      <div className="text-sm text-muted-foreground">Últimas 200 tentativas. <Badge variant="destructive">{failed} falhas</Badge></div>
      <Table>
        <TableHeader><TableRow><TableHead>Email</TableHead><TableHead>IP</TableHead><TableHead>Resultado</TableHead><TableHead>Motivo</TableHead><TableHead>Quando</TableHead></TableRow></TableHeader>
        <TableBody>
          {(data ?? []).map((a: any) => (
            <TableRow key={a.id}>
              <TableCell>{a.email ?? "—"}</TableCell>
              <TableCell className="font-mono text-xs">{a.ip_address ?? "—"}</TableCell>
              <TableCell>{a.success ? <Badge>OK</Badge> : <Badge variant="destructive">Falha</Badge>}</TableCell>
              <TableCell className="text-xs">{a.failure_reason ?? "—"}</TableCell>
              <TableCell className="text-xs">{new Date(a.created_at).toLocaleString("pt-BR")}</TableCell>
            </TableRow>
          ))}
          {!data?.length && <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">Nenhuma tentativa registrada.</TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
  );
}

function Inner() {
  return (
    <div className="space-y-4 p-6">
      <div>
        <h1 className="text-3xl font-bold">Segurança</h1>
        <p className="text-muted-foreground">Ferramentas de proteção e monitoramento de acesso.</p>
      </div>
      <Tabs defaultValue="banned">
        <TabsList>
          <TabsTrigger value="banned">Usuários banidos</TabsTrigger>
          <TabsTrigger value="ip">IPs bloqueados</TabsTrigger>
          <TabsTrigger value="email">Emails bloqueados</TabsTrigger>
          <TabsTrigger value="attempts">Tentativas de login</TabsTrigger>
        </TabsList>
        <TabsContent value="banned"><Card><CardHeader><CardTitle>Usuários banidos</CardTitle></CardHeader><CardContent><BannedUsers /></CardContent></Card></TabsContent>
        <TabsContent value="ip"><Card><CardHeader><CardTitle>Bloquear IP</CardTitle></CardHeader><CardContent><IpBans /></CardContent></Card></TabsContent>
        <TabsContent value="email"><Card><CardHeader><CardTitle>Bloquear emails</CardTitle></CardHeader><CardContent><BlockedEmails /></CardContent></Card></TabsContent>
        <TabsContent value="attempts"><Card><CardHeader><CardTitle>Tentativas de login</CardTitle></CardHeader><CardContent><LoginAttempts /></CardContent></Card></TabsContent>
      </Tabs>
    </div>
  );
}

export default function AdminSecurity() { return <AdminRoute><Inner /></AdminRoute>; }

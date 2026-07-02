import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { toast } from "sonner";
import { useTheme } from "next-themes";
import { Loader2, User, Settings as SettingsIcon, Shield, CreditCard, Camera, Eye, EyeOff, KeyRound, Mail } from "lucide-react";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { TrialCountdown } from "@/components/TrialCountdown";
import { getTrialStart, getDaysLeft, TRIAL_DURATION_MS } from "@/lib/trial";

export default function Settings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { theme, setTheme } = useTheme();

  // ----- PROFILE -----
  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ["profile", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .maybeSingle();
      if (error) throw error;
      // Auto-create profile if missing
      if (!data) {
        const { data: created, error: createErr } = await supabase
          .from("profiles")
          .insert({ id: user.id, full_name: user.user_metadata?.full_name || "" })
          .select()
          .single();
        if (createErr) throw createErr;
        return created;
      }
      return data;
    },
    enabled: !!user,
  });

  const { data: subscription } = useQuery({
    queryKey: ["subscription", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data } = await supabase
        .from("subscriptions")
        .select("*")
        .eq("user_id", user.id)
        .maybeSingle();
      return data;
    },
    enabled: !!user,
  });

  const { data: candidates } = useQuery({
    queryKey: ["my-candidates-count", user?.id],
    queryFn: async () => {
      if (!user) return [];
      const { data } = await supabase
        .from("candidates")
        .select("id, full_name, party")
        .eq("user_id", user.id);
      return data || [];
    },
    enabled: !!user,
  });

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [organization, setOrganization] = useState("");
  const [roleTitle, setRoleTitle] = useState("");

  const [language, setLanguage] = useState("pt-BR");
  const [party, setParty] = useState("");
  const [partyVisible, setPartyVisible] = useState(true);
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const [otpDialogOpen, setOtpDialogOpen] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [devCode, setDevCode] = useState<string | null>(null);

  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || "");
      setPhone(profile.phone || "");
      setOrganization(profile.organization || "");
      setRoleTitle(profile.role_title || "");
      setLanguage(profile.language || "pt-BR");
      setParty(profile.party || "");
      setPartyVisible(profile.party_visible ?? true);
      setTwoFactorEnabled(profile.two_factor_enabled ?? false);
    }
  }, [profile]);

  const saveProfileMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({
          full_name: fullName,
          phone: phone || null,
          organization: organization || null,
          role_title: roleTitle || null,
        })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Perfil atualizado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const savePreferencesMutation = useMutation({
    mutationFn: async () => {
      if (!user) throw new Error("Não autenticado");
      const { error } = await supabase
        .from("profiles")
        .update({
          language,
          theme: theme === "dark" ? "dark" : "light",
          party: party || null,
          party_visible: partyVisible,
        })
        .eq("id", user.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Preferências salvas!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const uploadAvatarMutation = useMutation({
    mutationFn: async (file: File) => {
      if (!user) throw new Error("Não autenticado");
      const ext = file.name.split(".").pop();
      const path = `${user.id}/avatar.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("avatars")
        .upload(path, file, { upsert: true });
      if (uploadErr) throw uploadErr;
      const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${publicUrl}?t=${Date.now()}`;
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", user.id);
      if (updateErr) throw updateErr;
      return url;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success("Foto atualizada!");
    },
    onError: (e: Error) => toast.error("Erro ao enviar foto: " + e.message),
  });

  const changePasswordMutation = useMutation({
    mutationFn: async () => {
      if (newPassword.length < 8) throw new Error("Senha deve ter no mínimo 8 caracteres");
      if (newPassword !== confirmPassword) throw new Error("As senhas não coincidem");
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Senha alterada com sucesso!");
      setNewPassword("");
      setConfirmPassword("");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const send2faMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("send-2fa-code");
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      setDevCode(data?.devCode || null);
      setOtpDialogOpen(true);
      toast.success(data?.message || "Código enviado");
    },
    onError: (e: Error) => toast.error("Erro ao enviar código: " + e.message),
  });

  const verify2faMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("verify-2fa-code", {
        body: { code: otpCode },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Código inválido");

      const newValue = !twoFactorEnabled;
      const { error: updateErr } = await supabase
        .from("profiles")
        .update({ two_factor_enabled: newValue })
        .eq("id", user!.id);
      if (updateErr) throw updateErr;
      return newValue;
    },
    onSuccess: (newValue) => {
      setTwoFactorEnabled(newValue);
      setOtpDialogOpen(false);
      setOtpCode("");
      setDevCode(null);
      queryClient.invalidateQueries({ queryKey: ["profile"] });
      toast.success(newValue ? "2FA ativado!" : "2FA desativado!");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const handleAvatarChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Imagem muito grande. Máximo 2MB.");
      return;
    }
    uploadAvatarMutation.mutate(file);
  };

  const initials = (fullName || user?.email || "?")
    .split(" ")
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  if (profileLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <HelpTooltip text="Mexa no seu perfil, troque a senha, ajuste o tema e configure suas preferências.">
        <h1 className="text-3xl font-bold flex items-center gap-2">
          <SettingsIcon className="h-8 w-8 text-primary" />
          Configurações
        </h1>
      </HelpTooltip>
        <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-muted-foreground">
            Gerencie seu perfil, preferências, segurança e assinatura
          </p>
          <TrialCountdown />
        </div>
      </div>

      <Tabs defaultValue="profile" className="space-y-4">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="profile">
            <User className="h-4 w-4 mr-2" /> Perfil
          </TabsTrigger>
          <TabsTrigger value="preferences">
            <SettingsIcon className="h-4 w-4 mr-2" /> Preferências
          </TabsTrigger>
          <TabsTrigger value="privacy">
            <Shield className="h-4 w-4 mr-2" /> Privacidade
          </TabsTrigger>
          <TabsTrigger value="subscription">
            <CreditCard className="h-4 w-4 mr-2" /> Assinatura
          </TabsTrigger>
        </TabsList>

        {/* ========== PROFILE TAB ========== */}
        <TabsContent value="profile" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Foto de perfil</CardTitle>
              <CardDescription>Sua foto será exibida na plataforma</CardDescription>
            </CardHeader>
            <CardContent className="flex items-center gap-6">
              <Avatar className="h-24 w-24">
                <AvatarImage src={profile?.avatar_url || undefined} />
                <AvatarFallback className="text-2xl">{initials}</AvatarFallback>
              </Avatar>
              <div className="space-y-2">
                <Label htmlFor="avatar-upload" className="cursor-pointer">
                  <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:opacity-90 transition">
                    {uploadAvatarMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Camera className="h-4 w-4" />
                    )}
                    Alterar foto
                  </div>
                  <input
                    id="avatar-upload"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleAvatarChange}
                    disabled={uploadAvatarMutation.isPending}
                  />
                </Label>
                <p className="text-xs text-muted-foreground">JPG ou PNG. Máximo 2MB.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dados pessoais</CardTitle>
              <CardDescription>Atualize suas informações de contato</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>Nome completo</Label>
                  <Input value={fullName} onChange={(e) => setFullName(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <Label>E-mail</Label>
                  <Input value={user?.email || ""} disabled />
                  <p className="text-xs text-muted-foreground">
                    Para alterar o e-mail, entre em contato com o suporte.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Telefone</Label>
                  <Input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(11) 99999-9999" />
                </div>
                <div className="space-y-2">
                  <Label>Organização</Label>
                  <Input value={organization} onChange={(e) => setOrganization(e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Cargo</Label>
                  <Input value={roleTitle} onChange={(e) => setRoleTitle(e.target.value)} placeholder="Ex: Diretor de campanha" />
                </div>
              </div>
              <Button onClick={() => saveProfileMutation.mutate()} disabled={saveProfileMutation.isPending}>
                {saveProfileMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Salvar alterações
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Meus candidatos</CardTitle>
              <CardDescription>
                Candidatos que você está monitorando ({candidates?.length || 0})
              </CardDescription>
            </CardHeader>
            <CardContent>
              {candidates && candidates.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {candidates.map((c) => (
                    <Badge key={c.id} variant="secondary" className="text-sm py-1 px-3">
                      {c.full_name} {c.party && `(${c.party})`}
                    </Badge>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Nenhum candidato adicionado. Vá ao Catálogo de Candidatos para começar.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== PREFERENCES TAB ========== */}
        <TabsContent value="preferences" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Idioma</CardTitle>
              <CardDescription>Idioma da interface</CardDescription>
            </CardHeader>
            <CardContent>
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="max-w-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="pt-BR">Português (Brasil)</SelectItem>
                </SelectContent>
              </Select>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Partido do candidato</CardTitle>
              <CardDescription>
                Informe o partido principal que você representa. Você pode optar por mantê-lo invisível na plataforma.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Partido</Label>
                <Input
                  value={party}
                  onChange={(e) => setParty(e.target.value)}
                  placeholder="Ex: PL, PT, PSDB"
                />
              </div>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label className="flex items-center gap-2">
                    {partyVisible ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
                    Partido visível na plataforma
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Quando desativado, seu partido fica oculto em listagens e relatórios públicos.
                  </p>
                </div>
                <Switch checked={partyVisible} onCheckedChange={setPartyVisible} />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Aparência</CardTitle>
              <CardDescription>Escolha como a plataforma deve aparecer</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Modo escuro</Label>
                  <p className="text-xs text-muted-foreground">
                    Reduz o brilho e melhora a leitura em ambientes com pouca luz.
                  </p>
                </div>
                <Switch
                  checked={theme === "dark"}
                  onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")}
                />
              </div>
            </CardContent>
          </Card>

          <Button onClick={() => savePreferencesMutation.mutate()} disabled={savePreferencesMutation.isPending}>
            {savePreferencesMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Salvar preferências
          </Button>
        </TabsContent>

        {/* ========== PRIVACY TAB ========== */}
        <TabsContent value="privacy" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <KeyRound className="h-5 w-5" />
                Alterar senha
              </CardTitle>
              <CardDescription>Use uma senha forte com no mínimo 8 caracteres</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Nova senha</Label>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Confirmar nova senha</Label>
                <Input
                  type={showPassword ? "text" : "password"}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
              <Button
                onClick={() => changePasswordMutation.mutate()}
                disabled={changePasswordMutation.isPending || !newPassword || !confirmPassword}
              >
                {changePasswordMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Alterar senha
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Autenticação de dois fatores (2FA) por e-mail
              </CardTitle>
              <CardDescription>
                Receba um código de verificação por e-mail ao fazer login. Adiciona uma camada extra de segurança.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    Status:{" "}
                    <Badge variant={twoFactorEnabled ? "default" : "outline"}>
                      {twoFactorEnabled ? "Ativado" : "Desativado"}
                    </Badge>
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {twoFactorEnabled
                      ? "Você receberá um código por e-mail ao fazer login."
                      : "Ative para reforçar a segurança da sua conta."}
                  </p>
                </div>
                <Button
                  variant={twoFactorEnabled ? "outline" : "default"}
                  onClick={() => send2faMutation.mutate()}
                  disabled={send2faMutation.isPending}
                >
                  {send2faMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                  {twoFactorEnabled ? "Desativar 2FA" : "Ativar 2FA"}
                </Button>
              </div>

              {otpDialogOpen && (
                <div className="border rounded-lg p-4 space-y-4 bg-muted/30">
                  <div>
                    <p className="font-medium">Digite o código de 6 dígitos enviado para seu e-mail</p>
                    {devCode && (
                      <p className="text-sm text-warning mt-2">
                        ⚠️ E-mail não configurado ainda. Código de teste:{" "}
                        <span className="font-mono font-bold">{devCode}</span>
                      </p>
                    )}
                  </div>
                  <InputOTP maxLength={6} value={otpCode} onChange={setOtpCode}>
                    <InputOTPGroup>
                      {[0, 1, 2, 3, 4, 5].map((i) => (
                        <InputOTPSlot key={i} index={i} />
                      ))}
                    </InputOTPGroup>
                  </InputOTP>
                  <div className="flex gap-2">
                    <Button
                      onClick={() => verify2faMutation.mutate()}
                      disabled={otpCode.length !== 6 || verify2faMutation.isPending}
                    >
                      {verify2faMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Confirmar
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => {
                        setOtpDialogOpen(false);
                        setOtpCode("");
                        setDevCode(null);
                      }}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========== SUBSCRIPTION TAB ========== */}
        <TabsContent value="subscription" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Plano atual</CardTitle>
              <CardDescription>Informações da sua assinatura</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {subscription ? (
                <>
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-2xl font-bold capitalize">{subscription.tier}</p>
                      <Badge variant={subscription.status === "active" ? "default" : "destructive"}>
                        {subscription.status}
                      </Badge>
                    </div>
                  </div>
                  <Separator />
                  {isUnlimitedSubscription(subscription) ? (
                    <div className="rounded-lg border border-amber-400/60 bg-gradient-to-r from-amber-500/10 to-yellow-500/10 px-4 py-3 text-amber-600 dark:text-amber-400">
                      <p className="text-sm font-semibold">
                        👑 {String(subscription.tier).toLowerCase() === "vip" ? "Plano VIP" : "Plano Vitalício"} — acesso ilimitado
                      </p>
                      <p className="text-xs text-muted-foreground">Candidatos, análises e ferramentas sem limite.</p>
                    </div>
                  ) : (
                    <div className="grid gap-3 md:grid-cols-2 text-sm">
                      <div>
                        <p className="text-muted-foreground">Candidatos disponíveis</p>
                        <p className="text-lg font-semibold">
                          {candidates?.length || 0} / {subscription.max_candidates}
                        </p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Análises este mês</p>
                        <p className="text-lg font-semibold">
                          {subscription.updates_used_this_month} / {subscription.max_updates_per_month}
                        </p>
                      </div>
                    </div>
                  )}
                  <div className="grid gap-3 md:grid-cols-2 text-sm">
                    {(() => {
                      const trialStart = user ? getTrialStart(user.id) : null;
                      const daysLeft = user ? getDaysLeft(user.id) : null;
                      const onTrial = !!trialStart && (daysLeft ?? 0) > 0;
                      const start = onTrial
                        ? new Date(trialStart as number)
                        : new Date(subscription.current_period_start);
                      const end = onTrial
                        ? new Date((trialStart as number) + TRIAL_DURATION_MS)
                        : new Date(subscription.current_period_end);
                      const label = onTrial
                        ? "Período de teste (7 dias)"
                        : "Período atual";
                      return (
                        <div>
                          <p className="text-muted-foreground">{label}</p>
                          <p className="font-medium">
                            {start.toLocaleDateString("pt-BR")} — {end.toLocaleDateString("pt-BR")}
                          </p>
                          {onTrial && (
                            <p className="text-xs text-muted-foreground mt-1">
                              {daysLeft} {daysLeft === 1 ? "dia restante" : "dias restantes"}
                            </p>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                </>
              ) : (
                <p className="text-muted-foreground">Nenhuma assinatura ativa.</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

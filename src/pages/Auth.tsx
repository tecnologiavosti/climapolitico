import { useState, useEffect, useRef } from "react";
import { useNavigate, Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logoAsset from "@/assets/clima-politico-logo.jpg.asset.json";
import { z } from "zod";
import { consumeTrialAfterLogin, getTrialStart, queueTrialCelebration, startTrial } from "@/lib/trial";

import { PasswordChecklist, isPasswordValid } from "@/components/auth/PasswordChecklist";

const emailSchema = z.string().email("Email inválido");
const fullNameSchema = z.string().min(2, "Nome deve ter no mínimo 2 caracteres");
const getAuthOrigin = () => {
  if (typeof window === "undefined") return "";
  return window.location.origin;
};

const Auth = () => {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");

  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [signupFullName, setSignupFullName] = useState("");
  const [signupOrganization, setSignupOrganization] = useState("");

  // 2FA state
  const [twoFAOpen, setTwoFAOpen] = useState(false);
  const [twoFACode, setTwoFACode] = useState("");
  const [twoFAAttempts, setTwoFAAttempts] = useState(0);
  const [twoFAVerifying, setTwoFAVerifying] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const twoFAOpenRef = useRef(false);
  twoFAOpenRef.current = twoFAOpen;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = setTimeout(() => setResendCooldown((s) => s - 1), 1000);
    return () => clearTimeout(t);
  }, [resendCooldown]);

  // Reset loading on mount and when page is restored from bfcache (voltar após cancelar OAuth)
  useEffect(() => {
    setLoading(false);
    const onPageShow = () => setLoading(false);
    const onFocus = () => setLoading(false);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("focus", onFocus);
    return () => {
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  useEffect(() => {
    if (!user || authLoading) return;
    if (twoFAOpenRef.current) return; // aguardando verificação 2FA

    if (consumeTrialAfterLogin() && !getTrialStart(user.id)) {
      const startedAt = startTrial(user.id);
      if (startedAt) {
        queueTrialCelebration(user.id);
        toast({ title: "Teste gratuito ativado!", description: "Parabéns pelos seus 7 dias no Clima Político." });
        navigate("/dashboard/settings");
        return;
      }
      toast({
        title: "Teste gratuito indisponível",
        description: "Este dispositivo já ativou um teste gratuito.",
        variant: "destructive",
      });
    }

    navigate("/dashboard");
  }, [user, authLoading, navigate, toast, twoFAOpen]);

  const trigger2FA = async () => {
    const { error } = await supabase.functions.invoke("send-2fa-code");
    if (error) {
      toast({ title: "Erro ao enviar código", description: error.message, variant: "destructive" });
      await supabase.auth.signOut();
      setTwoFAOpen(false);
      return false;
    }
    setResendCooldown(30);
    return true;
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      emailSchema.parse(loginEmail);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Erro de validação", description: error.issues[0].message, variant: "destructive" });
      }
      return;
    }
    if (!loginPassword) {
      toast({ title: "Erro de validação", description: "Informe sua senha", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { data: signInData, error } = await supabase.auth.signInWithPassword({ email: loginEmail, password: loginPassword });
    if (error) {
      toast({
        title: "Erro ao fazer login",
        description: error.message === "Invalid login credentials" ? "Email ou senha incorretos" : error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }

    // Verifica se 2FA está ativado para este usuário
    const uid = signInData.user?.id;
    if (uid) {
      const { data: profile } = await supabase
        .from("profiles")
        .select("two_factor_enabled")
        .eq("id", uid)
        .maybeSingle();
      if (profile?.two_factor_enabled) {
        setTwoFAOpen(true);
        setTwoFACode("");
        setTwoFAAttempts(0);
        await trigger2FA();
        setLoading(false);
        toast({ title: "Verificação necessária", description: "Enviamos um código para seu e-mail." });
        return;
      }
    }

    toast({ title: "Bem-vindo ao Clima Político", description: "Redirecionando..." });
    setLoading(false);
  };

  const handle2FAVerify = async () => {
    if (twoFACode.length !== 6) return;
    setTwoFAVerifying(true);
    const { data, error } = await supabase.functions.invoke("verify-2fa-code", {
      body: { code: twoFACode },
    });
    setTwoFAVerifying(false);
    if (error || !data?.success) {
      const nextAttempts = twoFAAttempts + 1;
      setTwoFAAttempts(nextAttempts);
      const msg = data?.error || error?.message || "Código inválido";
      if (nextAttempts >= 5) {
        toast({ title: "Muitas tentativas", description: "Sessão encerrada por segurança.", variant: "destructive" });
        await supabase.auth.signOut();
        setTwoFAOpen(false);
      } else {
        toast({ title: "Código incorreto", description: `${msg} (${5 - nextAttempts} tentativas restantes)`, variant: "destructive" });
      }
      setTwoFACode("");
      return;
    }
    setTwoFAOpen(false);
    setTwoFACode("");
    toast({ title: "Verificado!", description: "Redirecionando..." });
    navigate("/dashboard");
  };

  const handle2FAResend = async () => {
    if (resendCooldown > 0) return;
    const ok = await trigger2FA();
    if (ok) toast({ title: "Novo código enviado", description: "Verifique seu e-mail." });
  };

  const handle2FACancel = async () => {
    await supabase.auth.signOut();
    setTwoFAOpen(false);
    setTwoFACode("");
    setTwoFAAttempts(0);
  };


  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      fullNameSchema.parse(signupFullName);
      emailSchema.parse(signupEmail);
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Erro de validação", description: error.issues[0].message, variant: "destructive" });
      }
      return;
    }
    if (!isPasswordValid(signupPassword)) {
      toast({
        title: "Senha não atende aos requisitos",
        description: "Verifique a lista de requisitos abaixo do campo Senha.",
        variant: "destructive",
      });
      return;
    }
    setLoading(true);
    const redirectUrl = `${getAuthOrigin()}/`;
    const { error } = await supabase.auth.signUp({
      email: signupEmail,
      password: signupPassword,
      options: { emailRedirectTo: redirectUrl, data: { full_name: signupFullName, organization: signupOrganization } },
    });
    if (error) {
      toast({
        title: "Erro ao criar conta",
        description: error.message === "User already registered" ? "Este email já está cadastrado" : error.message,
        variant: "destructive",
      });
      setLoading(false);
      return;
    }
    // Auto-confirm está ativado no backend — entramos direto sem confirmação por email.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: signupEmail,
      password: signupPassword,
    });
    if (signInError) {
      toast({ title: "Conta criada!", description: "Faça login para continuar." });
    } else {
      toast({ title: "Bem-vindo ao Clima Político", description: "Sua conta foi criada com sucesso!" });
    }
    setSignupEmail(""); setSignupPassword(""); setSignupFullName(""); setSignupOrganization("");
    setLoading(false);
  };

  const handleGoogle = async () => {
    setLoading(true);
    // Failsafe: nunca deixar o botão preso em "Entrando..."
    const failsafe = window.setTimeout(() => setLoading(false), 15000);
    // Se o usuário voltar para a aba (popup fechado / cancelado), resetar
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        setLoading(false);
      }
    };
    document.addEventListener("visibilitychange", onVisible, { once: true });
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo: `${getAuthOrigin()}/` },
      });
      if (error) {
        const msg = error.message?.toLowerCase() ?? "";
        if (!msg.includes("popup") && !msg.includes("closed") && !msg.includes("cancel")) {
          toast({ title: "Erro Google", description: error.message, variant: "destructive" });
        }
      }
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message.toLowerCase() : "";
      if (!msg.includes("popup") && !msg.includes("closed") && !msg.includes("cancel")) {
        toast({ title: "Erro Google", description: e instanceof Error ? e.message : "Falha", variant: "destructive" });
      }
    } finally {
      window.clearTimeout(failsafe);
      document.removeEventListener("visibilitychange", onVisible);
      setLoading(false);
    }
  };


  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    try { emailSchema.parse(forgotEmail); }
    catch (error) {
      if (error instanceof z.ZodError) {
        toast({ title: "Email inválido", description: error.issues[0].message, variant: "destructive" });
      }
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(forgotEmail, {
      redirectTo: `${getAuthOrigin()}/reset-password`,
    });
    setLoading(false);
    if (error) {
      toast({ title: "Erro", description: error.message, variant: "destructive" });
    } else {
      toast({ title: "Enviamos um email", description: "Verifique sua caixa de entrada para redefinir a senha." });
      setForgotOpen(false);
      setForgotEmail("");
    }
  };

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--gradient-auth)" }}>
      <Card className="w-full max-w-md p-8 space-y-6 shadow-2xl border-white/20 backdrop-blur-sm">
        <div className="text-center space-y-3">
          <div className="flex justify-center mb-2">
            <div className="relative">
              <div className="absolute inset-0 rounded-full blur-2xl bg-primary-glow/40" aria-hidden />
              <img
                src={logoAsset.url}
                alt="Clima Político"
                className="relative h-24 w-24 rounded-full object-cover ring-4 ring-white/70 shadow-xl"
              />
            </div>
          </div>
          <h1 className="text-3xl font-bold bg-gradient-primary bg-clip-text text-transparent">Clima Político</h1>
          <p className="text-muted-foreground">Análise política inteligente com IA</p>
        </div>


        {twoFAOpen ? (
          <div className="space-y-4">
            <div className="text-center space-y-1">
              <h2 className="text-lg font-semibold">Verificação em duas etapas</h2>
              <p className="text-sm text-muted-foreground">
                Digite o código de 6 dígitos enviado para seu e-mail.
              </p>
            </div>
            <div className="flex justify-center">
              <InputOTP maxLength={6} value={twoFACode} onChange={setTwoFACode} autoFocus>
                <InputOTPGroup>
                  {[0, 1, 2, 3, 4, 5].map((i) => (
                    <InputOTPSlot key={i} index={i} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
            </div>
            <Button
              className="w-full bg-gradient-primary"
              onClick={handle2FAVerify}
              disabled={twoFACode.length !== 6 || twoFAVerifying}
            >
              {twoFAVerifying ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Verificando...</> : "Confirmar"}
            </Button>
            <div className="flex items-center justify-between text-sm">
              <button
                type="button"
                onClick={handle2FAResend}
                disabled={resendCooldown > 0}
                className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
              >
                {resendCooldown > 0 ? `Reenviar em ${resendCooldown}s` : "Reenviar código"}
              </button>
              <button type="button" onClick={handle2FACancel} className="text-muted-foreground hover:text-foreground">
                Cancelar
              </button>
            </div>
          </div>
        ) : forgotOpen ? (
          <form onSubmit={handleForgot} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Seu email cadastrado</Label>
              <Input id="forgot-email" type="email" placeholder="seu@email.com"
                value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} required disabled={loading} />
            </div>
            <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
              {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Enviando...</> : "Enviar link de redefinição"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={() => setForgotOpen(false)} disabled={loading}>
              Voltar
            </Button>
          </form>
        ) : (
        <Tabs defaultValue="login" className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="login">Entrar</TabsTrigger>
            <TabsTrigger value="signup">Criar Conta</TabsTrigger>
          </TabsList>

          <TabsContent value="login">
            <form onSubmit={handleLogin} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login-email">Email</Label>
                <Input id="login-email" type="email" placeholder="seu@email.com"
                  value={loginEmail} onChange={(e) => setLoginEmail(e.target.value)} required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password">Senha</Label>
                <Input id="login-password" type="password" placeholder="••••••••"
                  value={loginPassword} onChange={(e) => setLoginPassword(e.target.value)} required disabled={loading} />
              </div>
              <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Entrando...</> : "Entrar"}
              </Button>
              <button type="button" onClick={() => setForgotOpen(true)}
                className="text-sm text-muted-foreground hover:text-primary w-full text-center">
                Esqueci minha senha
              </button>
            </form>
          </TabsContent>

          <TabsContent value="signup">
            <form onSubmit={handleSignup} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="signup-name">Nome Completo</Label>
                <Input id="signup-name" type="text" placeholder="João Silva"
                  value={signupFullName} onChange={(e) => setSignupFullName(e.target.value)} required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-organization">Organização/Partido (opcional)</Label>
                <Input id="signup-organization" type="text" placeholder="Nome da organização"
                  value={signupOrganization} onChange={(e) => setSignupOrganization(e.target.value)} disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-email">Email</Label>
                <Input id="signup-email" type="email" placeholder="seu@email.com"
                  value={signupEmail} onChange={(e) => setSignupEmail(e.target.value)} required disabled={loading} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="signup-password">Senha</Label>
                <Input id="signup-password" type="password" placeholder="••••••••"
                  value={signupPassword} onChange={(e) => setSignupPassword(e.target.value)} required disabled={loading} />
                <PasswordChecklist password={signupPassword} />
              </div>
              <Button type="submit" className="w-full bg-gradient-primary" disabled={loading}>
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Criando...</> : "Criar Conta"}
              </Button>
            </form>
          </TabsContent>
        </Tabs>
        )}

        {!forgotOpen && !twoFAOpen && (
          <>
            <div className="relative">
              <div className="absolute inset-0 flex items-center"><span className="w-full border-t" /></div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">ou</span>
              </div>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleGoogle} disabled={loading}>
              <svg className="mr-2 h-4 w-4" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84C6.71 7.31 9.14 5.38 12 5.38z"/></svg>
              Continuar com Google
            </Button>
          </>
        )}

        <div className="text-center text-sm text-muted-foreground">
          <Link to="/" className="hover:text-primary transition-colors">← Voltar para Home</Link>
        </div>
      </Card>
    </div>
  );
};

export default Auth;

import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2, BarChart3, Eye, EyeOff } from "lucide-react";
import { z } from "zod";

const passwordSchema = z
  .string()
  .min(8, "Senha deve ter no mínimo 8 caracteres")
  .regex(/[A-Z]/, "Inclua ao menos 1 letra maiúscula")
  .regex(/[a-z]/, "Inclua ao menos 1 letra minúscula")
  .regex(/[0-9]/, "Inclua ao menos 1 número");

const passwordStrength = (pwd: string) => {
  let score = 0;
  if (pwd.length >= 8) score++;
  if (pwd.length >= 12) score++;
  if (/[A-Z]/.test(pwd)) score++;
  if (/[0-9]/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return Math.min(score, 4);
};

type RecoveryStatus = "checking" | "valid" | "invalid";

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [recoveryStatus, setRecoveryStatus] = useState<RecoveryStatus>("checking");
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    let mounted = true;

    const { data: authListener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && mounted) {
        setRecoveryStatus("valid");
      }
    });

    const confirmRecoverySession = async () => {
      try {
        // 1) Hash fragment: #access_token=...&type=recovery
        const hash = window.location.hash.startsWith("#")
          ? window.location.hash.slice(1)
          : window.location.hash;
        const hashParams = new URLSearchParams(hash);
        const type = hashParams.get("type");
        const accessToken = hashParams.get("access_token");
        const refreshToken = hashParams.get("refresh_token");

        if (type === "recovery" && accessToken && refreshToken) {
          const { error } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken,
          });
          if (mounted) setRecoveryStatus(error ? "invalid" : "valid");
          // clean hash
          window.history.replaceState(null, "", window.location.pathname);
          return;
        }

        // 2) PKCE query param: ?code=...
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (mounted) setRecoveryStatus(error ? "invalid" : "valid");
          url.searchParams.delete("code");
          window.history.replaceState(null, "", url.pathname);
          return;
        }

        // 3) Fallback: existing session (evento PASSWORD_RECOVERY já pode ter disparado)
        const { data } = await supabase.auth.getSession();
        if (mounted) setRecoveryStatus(data.session ? "valid" : "invalid");
      } catch {
        if (mounted) setRecoveryStatus("invalid");
      }
    };

    confirmRecoverySession();

    return () => {
      mounted = false;
      authListener.subscription.unsubscribe();
    };
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      passwordSchema.parse(password);
    } catch (err) {
      if (err instanceof z.ZodError) {
        toast({ title: "Senha fraca", description: err.issues[0].message, variant: "destructive" });
      }
      return;
    }
    if (password !== confirmPassword) {
      toast({ title: "Senhas não coincidem", description: "Confirme sua nova senha corretamente.", variant: "destructive" });
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao atualizar senha", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Senha redefinida com sucesso!", description: "Faça login com sua nova senha." });
    await supabase.auth.signOut();
    setTimeout(() => navigate("/auth"), 800);
  };

  const strength = passwordStrength(password);
  const strengthColors = ["bg-destructive", "bg-destructive", "bg-warning", "bg-warning", "bg-success"];
  const strengthLabels = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];

  if (recoveryStatus === "checking") {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (recoveryStatus === "invalid") {
    return (
      <div className="min-h-screen bg-gradient-secondary flex items-center justify-center p-4">
        <Card className="w-full max-w-md p-8 space-y-6 text-center">
          <h1 className="text-2xl font-bold">Link de recuperação inválido ou expirado</h1>
          <p className="text-sm text-muted-foreground">
            Solicite um novo e-mail de redefinição para continuar.
          </p>
          <div className="flex flex-col gap-2">
            <Button
              className="w-full bg-gradient-primary"
              onClick={() => navigate("/auth?forgot=password", { replace: true })}
            >
              Solicitar novo link
            </Button>
            <Button
              variant="outline"
              className="w-full"
              onClick={async () => {
                await supabase.auth.signOut();
                navigate("/auth");
              }}
            >
              Voltar ao Login
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-secondary flex items-center justify-center p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        <div className="text-center space-y-2">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-gradient-primary rounded-lg">
              <BarChart3 className="h-8 w-8 text-white" />
            </div>
          </div>
          <h1 className="text-2xl font-bold">Redefinir senha</h1>
          <p className="text-sm text-muted-foreground">Defina uma nova senha forte para sua conta.</p>
        </div>

        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="new-password">Nova senha</Label>
            <div className="relative">
              <Input
                id="new-password"
                type={show ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                required
                autoFocus
              />
              <button
                type="button"
                aria-label={show ? "Ocultar senha" : "Mostrar senha"}
                onClick={() => setShow((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground"
              >
                {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {password && (
              <div className="space-y-1">
                <div className="flex gap-1" aria-hidden>
                  {[0, 1, 2, 3].map((i) => (
                    <div
                      key={i}
                      className={`h-1 flex-1 rounded ${i < strength ? strengthColors[strength] : "bg-muted"}`}
                    />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground">Força: {strengthLabels[strength]}</p>
              </div>
            )}
          </div>
          <div className="space-y-2">
            <Label htmlFor="confirm-password">Confirmar nova senha</Label>
            <Input
              id="confirm-password"
              type={show ? "text" : "password"}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              required
            />
          </div>
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading || strength < 2}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</> : "Redefinir senha"}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;

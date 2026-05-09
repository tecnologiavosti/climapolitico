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

const ResetPassword = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [validSession, setValidSession] = useState(false);
  const [password, setPassword] = useState("");
  const [show, setShow] = useState(false);

  useEffect(() => {
    // Supabase popula a sessão do hash quando type=recovery
    const hash = window.location.hash;
    if (!hash.includes("type=recovery") && !hash.includes("access_token")) {
      toast({ title: "Link inválido ou expirado", description: "Solicite um novo email de redefinição.", variant: "destructive" });
      navigate("/auth");
      return;
    }
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setValidSession(true);
      else {
        toast({ title: "Sessão de recuperação inválida", variant: "destructive" });
        navigate("/auth");
      }
    });
  }, [navigate, toast]);

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
    setLoading(true);
    const { error } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (error) {
      toast({ title: "Erro ao atualizar senha", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Senha redefinida com sucesso!", description: "Redirecionando..." });
    setTimeout(() => navigate("/dashboard"), 800);
  };

  const strength = passwordStrength(password);
  const strengthColors = ["bg-destructive", "bg-destructive", "bg-warning", "bg-warning", "bg-success"];
  const strengthLabels = ["Muito fraca", "Fraca", "Razoável", "Boa", "Forte"];

  if (!validSession) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
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
          <Button type="submit" className="w-full bg-gradient-primary" disabled={loading || strength < 2}>
            {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Salvando...</> : "Redefinir senha"}
          </Button>
        </form>
      </Card>
    </div>
  );
};

export default ResetPassword;

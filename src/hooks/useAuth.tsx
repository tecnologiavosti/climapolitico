import { createContext, useContext, useEffect, useState, ReactNode, useRef } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useNavigate } from "react-router-dom";
import { toast } from "@/hooks/use-toast";

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  session: null,
  loading: true,
  signOut: async () => {},
});

const SESSION_KEY = "cp_active_session_id";

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return context;
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // Força logout quando outra sessão assume o usuário
  const forceLogoutAsKicked = async () => {
    localStorage.removeItem(SESSION_KEY);
    await supabase.auth.signOut();
    toast({
      title: "Sessão encerrada",
      description: "Sua conta foi acessada em outro dispositivo. Apenas uma sessão é permitida por vez.",
      variant: "destructive",
    });
    navigate("/auth");
  };

  // Reclama essa sessão como a única ativa do usuário
  const claimSession = async (userId: string) => {
    let sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      sid = crypto.randomUUID();
      localStorage.setItem(SESSION_KEY, sid);
    }
    await supabase
      .from("profiles")
      .update({ active_session_id: sid })
      .eq("id", userId);
    return sid;
  };

  // Confirma se a sessão local ainda é a ativa no servidor
  const verifySession = async (userId: string) => {
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) {
      await forceLogoutAsKicked();
      return false;
    }
    const { data } = await supabase
      .from("profiles")
      .select("active_session_id")
      .eq("id", userId)
      .maybeSingle();
    if (data && data.active_session_id && data.active_session_id !== sid) {
      await forceLogoutAsKicked();
      return false;
    }
    return true;
  };

  // Escuta mudanças no perfil em tempo real
  const subscribeToProfile = (userId: string) => {
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    const channel = supabase
      .channel(`profile-session-${userId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${userId}`,
        },
        (payload) => {
          const newSid = (payload.new as any)?.active_session_id;
          const localSid = localStorage.getItem(SESSION_KEY);
          if (newSid && localSid && newSid !== localSid) {
            forceLogoutAsKicked();
          }
        }
      )
      .subscribe();
    channelRef.current = channel;
  };

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, newSession) => {
        if (event === "TOKEN_REFRESHED" && !newSession) {
          await supabase.auth.signOut();
          navigate("/auth");
          return;
        }

        setSession(newSession);
        setUser(newSession?.user ?? null);
        setLoading(false);

        if (event === "SIGNED_OUT") {
          localStorage.removeItem(SESSION_KEY);
          if (channelRef.current) {
            supabase.removeChannel(channelRef.current);
            channelRef.current = null;
          }
        }
        // Sessões concorrentes em outros dispositivos são permitidas:
        // não forçamos mais logout quando outra aba/dispositivo entra.
      }
    );

    supabase.auth.getSession().then(({ data: { session: s }, error }) => {
      if (error) {
        setLoading(false);
        return;
      }
      setSession(s);
      setUser(s?.user ?? null);
      setLoading(false);
    });

    return () => {
      subscription.unsubscribe();
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [navigate]);


  const signOut = async () => {
    localStorage.removeItem(SESSION_KEY);
    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
      channelRef.current = null;
    }
    await supabase.auth.signOut();
    navigate("/auth");
  };

  return (
    <AuthContext.Provider value={{ user, session, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
};

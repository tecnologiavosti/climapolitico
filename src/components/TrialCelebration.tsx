import { useEffect, useState } from "react";
import { Gift, PartyPopper, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useAuth } from "@/hooks/useAuth";
import { clearTrialCelebration, shouldShowTrialCelebration } from "@/lib/trial";

export function TrialCelebration() {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!user) return;
    setOpen(shouldShowTrialCelebration(user.id));
  }, [user]);

  const close = () => {
    if (user) clearTrialCelebration(user.id);
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (!nextOpen ? close() : setOpen(true))}>
      <DialogContent className="max-w-sm overflow-hidden border-primary/30 bg-background p-0 text-center sm:max-w-md">
        <div className="relative px-6 pb-6 pt-8 sm:px-8 sm:pb-8">
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-primary opacity-15" />
          <div className="relative mx-auto mb-5 flex h-28 w-28 items-center justify-center">
            <div className="absolute h-24 w-24 animate-ping rounded-full bg-primary/20" />
            <div className="absolute left-1 top-5 rotate-[-18deg] rounded-full bg-accent/20 p-2">
              <Sparkles className="h-5 w-5 text-accent" />
            </div>
            <div className="absolute right-0 top-2 rotate-12 rounded-full bg-primary/15 p-2">
              <PartyPopper className="h-5 w-5 text-primary" />
            </div>
            <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-primary shadow-xl">
              <Gift className="h-11 w-11 animate-bounce text-primary-foreground" />
            </div>
          </div>

          <DialogHeader className="space-y-3 text-center">
            <DialogTitle className="text-2xl font-bold sm:text-3xl">Parabéns!</DialogTitle>
            <DialogDescription className="text-base leading-relaxed text-muted-foreground">
              Seu teste gratuito de 7 dias foi ativado no Clima Político.
            </DialogDescription>
          </DialogHeader>

          <Button onClick={close} className="mt-6 w-full bg-gradient-primary hover-glow">
            Começar agora
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
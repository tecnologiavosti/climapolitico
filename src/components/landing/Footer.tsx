import { Link } from "react-router-dom";
import { Mail, MessageCircle, Globe } from "lucide-react";
import logoAsset from "@/assets/clima-politico-logo.jpg.asset.json";

export const Footer = () => {
  return (
    <footer className="border-t border-border/50 bg-card/30 backdrop-blur-sm mt-20">
      <div className="container mx-auto px-4 py-12">
        <div className="grid gap-8 md:grid-cols-4">
          <div className="md:col-span-2 space-y-3">
            <div className="flex items-center gap-3">
              <img src={logoAsset.url} alt="Clima Político" className="h-10 w-10 rounded-full object-cover ring-2 ring-border" />
              <h3 className="text-xl font-bold gradient-text">Clima Político</h3>
            </div>
            <p className="text-sm text-muted-foreground max-w-md">
              Inteligência política em tempo real. Monitore candidatos, analise
              sentimentos e antecipe tendências com IA.
            </p>
          </div>


          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Produto</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a href="#features" className="hover:text-primary transition-colors">
                  Recursos
                </a>
              </li>
              <li>
                <a href="#pricing" className="hover:text-primary transition-colors">
                  Planos
                </a>
              </li>
              <li>
                <Link to="/auth" className="hover:text-primary transition-colors">
                  Entrar
                </Link>
              </li>
            </ul>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Contato</h4>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li>
                <a
                  href="https://wa.me/556198117985"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-primary transition-colors"
                >
                  <MessageCircle className="h-4 w-4" />
                  WhatsApp: (61) 9811-7985
                </a>
              </li>
              <li>
                <a
                  href="mailto:contato@climapolitico.com.br"
                  className="flex items-center gap-2 hover:text-primary transition-colors"
                >
                  <Mail className="h-4 w-4" />
                  contato@climapolitico.com.br
                </a>
              </li>
              <li>
                <a
                  href="https://climapolitico.com.br"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-primary transition-colors"
                >
                  <Globe className="h-4 w-4" />
                  climapolitico.com.br
                </a>
              </li>
            </ul>
          </div>
        </div>

        <div className="mt-10 pt-6 border-t border-border/50 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-muted-foreground">
          <p>© {new Date().getFullYear()} Clima Político. Todos os direitos reservados.</p>
          <p className="opacity-75">Atualização 1.0.0</p>
        </div>
      </div>
    </footer>
  );
};

export default Footer;

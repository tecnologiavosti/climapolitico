import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Plus, Search, TrendingUp, TrendingDown, Eye, MoreVertical } from "lucide-react";

const candidatesData = [
  {
    id: 1,
    name: "João Silva",
    party: "PSDB",
    mentions: 1250,
    sentiment: 68,
    trend: "up",
    followers: "125K",
    status: "active",
  },
  {
    id: 2,
    name: "Maria Santos",
    party: "PT",
    mentions: 980,
    sentiment: 45,
    trend: "down",
    followers: "98K",
    status: "active",
  },
  {
    id: 3,
    name: "Carlos Oliveira",
    party: "PSL",
    mentions: 750,
    sentiment: 72,
    trend: "up",
    followers: "87K",
    status: "active",
  },
  {
    id: 4,
    name: "Ana Costa",
    party: "PDT",
    mentions: 620,
    sentiment: 38,
    trend: "down",
    followers: "65K",
    status: "monitoring",
  },
];

export default function Candidates() {
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    fullName: "",
    region: "",
    socialMedia: "",
  });

  const filteredCandidates = candidatesData.filter((candidate) =>
    candidate.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    candidate.party.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    console.log("Novo candidato:", formData);
    // Aqui você pode adicionar a lógica para salvar no banco de dados
    setDialogOpen(false);
    setFormData({ fullName: "", region: "", socialMedia: "" });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h2 className="text-3xl font-bold">Candidatos</h2>
          <p className="text-muted-foreground">Gerencie e monitore candidatos políticos</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button className="bg-gradient-primary">
              <Plus className="mr-2 h-4 w-4" />
              Adicionar Candidato
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[500px]">
            <DialogHeader>
              <DialogTitle>Adicionar Novo Político</DialogTitle>
              <DialogDescription>
                Insira as informações do político que deseja monitorar
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4 mt-4">
              <div className="space-y-2">
                <Label htmlFor="fullName">Nome Completo *</Label>
                <Input
                  id="fullName"
                  placeholder="Ex: João Silva"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="region">Região / Estado</Label>
                <Input
                  id="region"
                  placeholder="Ex: São Paulo, Rio de Janeiro"
                  value={formData.region}
                  onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="socialMedia">Link de Rede Social</Label>
                <Input
                  id="socialMedia"
                  placeholder="Ex: https://twitter.com/usuario, https://instagram.com/usuario"
                  value={formData.socialMedia}
                  onChange={(e) => setFormData({ ...formData, socialMedia: e.target.value })}
                />
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" className="bg-gradient-primary">
                  Adicionar
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <Card className="p-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome ou partido..."
            className="pl-10"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </Card>

      {/* Candidates Table */}
      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Candidato</TableHead>
              <TableHead>Partido</TableHead>
              <TableHead>Menções</TableHead>
              <TableHead>Sentimento</TableHead>
              <TableHead>Tendência</TableHead>
              <TableHead>Seguidores</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Ações</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredCandidates.map((candidate) => (
              <TableRow key={candidate.id}>
                <TableCell className="font-medium">{candidate.name}</TableCell>
                <TableCell>
                  <Badge variant="outline">{candidate.party}</Badge>
                </TableCell>
                <TableCell>{candidate.mentions.toLocaleString()}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <div className="w-full max-w-[100px] bg-muted rounded-full h-2">
                      <div
                        className={`h-full rounded-full ${
                          candidate.sentiment >= 60
                            ? "bg-success"
                            : candidate.sentiment >= 40
                            ? "bg-warning"
                            : "bg-destructive"
                        }`}
                        style={{ width: `${candidate.sentiment}%` }}
                      />
                    </div>
                    <span className="text-sm">{candidate.sentiment}%</span>
                  </div>
                </TableCell>
                <TableCell>
                  {candidate.trend === "up" ? (
                    <TrendingUp className="h-4 w-4 text-success" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-destructive" />
                  )}
                </TableCell>
                <TableCell>{candidate.followers}</TableCell>
                <TableCell>
                  <Badge
                    className={
                      candidate.status === "active"
                        ? "bg-success"
                        : "bg-warning"
                    }
                  >
                    {candidate.status === "active" ? "Ativo" : "Monitorando"}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Button variant="ghost" size="sm">
                    <Eye className="h-4 w-4 mr-2" />
                    Ver Detalhes
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      {/* Empty State */}
      {filteredCandidates.length === 0 && (
        <Card className="p-12 text-center">
          <p className="text-muted-foreground mb-4">
            Nenhum candidato encontrado com esse critério de busca
          </p>
          <Button variant="outline" onClick={() => setSearchTerm("")}>
            Limpar Busca
          </Button>
        </Card>
      )}
    </div>
  );
}

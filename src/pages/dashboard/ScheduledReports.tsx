import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Calendar, Pause, Play, Trash2, Mail } from "lucide-react";

interface ScheduledReport {
  id: string;
  name: string;
  candidate_id: string;
  template_id: string | null;
  frequency: string;
  export_format: string;
  recipients: string[];
  next_run_at: string;
  last_run_at: string | null;
  is_active: boolean;
  created_at: string;
}

export default function ScheduledReports() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    candidateId: '',
    templateId: '',
    frequency: 'weekly',
    exportFormat: 'pdf',
    recipients: '',
  });

  // Query scheduled reports
  const { data: scheduledReports, isLoading } = useQuery({
    queryKey: ['scheduled-reports', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('scheduled_reports')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ScheduledReport[];
    },
    enabled: !!user,
  });

  // Query candidates
  const { data: candidates } = useQuery({
    queryKey: ['candidates-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('candidates')
        .select('id, full_name')
        .eq('user_id', user?.id)
        .order('full_name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Query templates
  const { data: templates } = useQuery({
    queryKey: ['report-templates-list', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_templates')
        .select('id, name')
        .eq('user_id', user?.id)
        .order('name');

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
  });

  // Create scheduled report mutation
  const createMutation = useMutation({
    mutationFn: async (report: any) => {
      const recipientsList = report.recipients
        .split(',')
        .map((email: string) => email.trim())
        .filter((email: string) => email);

      const nextRun = calculateNextRun(report.frequency);

      const { data, error } = await supabase
        .from('scheduled_reports')
        .insert({
          user_id: user?.id,
          candidate_id: report.candidateId,
          template_id: report.templateId || null,
          name: report.name,
          frequency: report.frequency,
          export_format: report.exportFormat,
          recipients: recipientsList,
          next_run_at: nextRun,
          is_active: true,
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] });
      toast.success('Relatório agendado com sucesso!');
      setIsDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast.error('Erro ao agendar relatório');
    },
  });

  // Toggle active mutation
  const toggleActiveMutation = useMutation({
    mutationFn: async ({ id, isActive }: { id: string; isActive: boolean }) => {
      const { error } = await supabase
        .from('scheduled_reports')
        .update({ is_active: isActive })
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] });
      toast.success('Status atualizado com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao atualizar status');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('scheduled_reports')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['scheduled-reports'] });
      toast.success('Relatório excluído com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir relatório');
    },
  });

  const calculateNextRun = (frequency: string): string => {
    const now = new Date();
    switch (frequency) {
      case 'daily':
        now.setDate(now.getDate() + 1);
        break;
      case 'weekly':
        now.setDate(now.getDate() + 7);
        break;
      case 'monthly':
        now.setMonth(now.getMonth() + 1);
        break;
    }
    return now.toISOString();
  };

  const resetForm = () => {
    setFormData({
      name: '',
      candidateId: '',
      templateId: '',
      frequency: 'weekly',
      exportFormat: 'pdf',
      recipients: '',
    });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createMutation.mutate(formData);
  };

  const getFrequencyLabel = (frequency: string) => {
    const labels: Record<string, string> = {
      daily: 'Diário',
      weekly: 'Semanal',
      monthly: 'Mensal',
    };
    return labels[frequency] || frequency;
  };

  const getFormatLabel = (format: string) => {
    const labels: Record<string, string> = {
      pdf: 'PDF',
      excel: 'Excel',
      json: 'JSON',
      all: 'Todos os formatos',
    };
    return labels[format] || format;
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Relatórios Agendados</h1>
          <p className="text-muted-foreground">
            Configure a geração automática de relatórios
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Agendamento
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Agendar Novo Relatório</DialogTitle>
              <DialogDescription>
                Configure a geração e envio automático de relatórios
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Agendamento</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Relatório Semanal - Candidato X"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="candidate">Candidato</Label>
                  <Select
                    value={formData.candidateId}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, candidateId: value }))}
                    required
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Selecione um candidato" />
                    </SelectTrigger>
                    <SelectContent>
                      {candidates?.map(candidate => (
                        <SelectItem key={candidate.id} value={candidate.id}>
                          {candidate.full_name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="template">Template (Opcional)</Label>
                  <Select
                    value={formData.templateId}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, templateId: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Template padrão" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="">Template padrão</SelectItem>
                      {templates?.map(template => (
                        <SelectItem key={template.id} value={template.id}>
                          {template.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="frequency">Frequência</Label>
                  <Select
                    value={formData.frequency}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, frequency: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="daily">Diário</SelectItem>
                      <SelectItem value="weekly">Semanal</SelectItem>
                      <SelectItem value="monthly">Mensal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="format">Formato</Label>
                  <Select
                    value={formData.exportFormat}
                    onValueChange={(value) => setFormData(prev => ({ ...prev, exportFormat: value }))}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pdf">PDF</SelectItem>
                      <SelectItem value="excel">Excel</SelectItem>
                      <SelectItem value="json">JSON</SelectItem>
                      <SelectItem value="all">Todos os formatos</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="recipients">E-mails para Envio (separados por vírgula)</Label>
                <Input
                  id="recipients"
                  value={formData.recipients}
                  onChange={(e) => setFormData(prev => ({ ...prev, recipients: e.target.value }))}
                  placeholder="email1@example.com, email2@example.com"
                />
                <p className="text-xs text-muted-foreground">
                  Deixe em branco para apenas gerar o relatório sem enviar
                </p>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending}>
                  Agendar Relatório
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-1/2" />
                <div className="h-4 bg-muted rounded w-3/4 mt-2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : scheduledReports && scheduledReports.length > 0 ? (
        <div className="grid gap-4">
          {scheduledReports.map((report) => (
            <Card key={report.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Calendar className="h-5 w-5 text-primary" />
                      <CardTitle>{report.name}</CardTitle>
                      <Badge variant={report.is_active ? 'default' : 'secondary'}>
                        {report.is_active ? 'Ativo' : 'Pausado'}
                      </Badge>
                    </div>
                    <CardDescription className="mt-2">
                      Frequência: {getFrequencyLabel(report.frequency)} • Formato: {getFormatLabel(report.export_format)}
                    </CardDescription>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => toggleActiveMutation.mutate({
                        id: report.id,
                        isActive: !report.is_active
                      })}
                    >
                      {report.is_active ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (confirm('Tem certeza que deseja excluir este agendamento?')) {
                          deleteMutation.mutate(report.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Próxima execução:</p>
                    <p className="font-medium">
                      {new Date(report.next_run_at).toLocaleString()}
                    </p>
                  </div>
                  {report.last_run_at && (
                    <div>
                      <p className="text-muted-foreground">Última execução:</p>
                      <p className="font-medium">
                        {new Date(report.last_run_at).toLocaleString()}
                      </p>
                    </div>
                  )}
                  {report.recipients.length > 0 && (
                    <div className="col-span-2">
                      <p className="text-muted-foreground mb-1">
                        <Mail className="h-4 w-4 inline mr-1" />
                        Destinatários:
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {report.recipients.map((email, idx) => (
                          <Badge key={idx} variant="outline" className="text-xs">
                            {email}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <Calendar className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              Nenhum relatório agendado ainda
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Agendar Primeiro Relatório
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

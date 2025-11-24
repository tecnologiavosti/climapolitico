import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Plus, Edit, Trash2, FileText } from "lucide-react";

interface ReportTemplate {
  id: string;
  name: string;
  description: string;
  template_type: string;
  sections: string[];
  styling: any;
  is_default: boolean;
  created_at: string;
}

export function ReportTemplates() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<ReportTemplate | null>(null);

  const [formData, setFormData] = useState({
    name: '',
    description: '',
    sections: ['origin', 'quantitative', 'qualitative', 'geographic'],
    includeCharts: true,
    primaryColor: '#4f46e5',
    fontSize: 12,
  });

  // Query templates
  const { data: templates, isLoading } = useQuery({
    queryKey: ['report-templates', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('report_templates')
        .select('*')
        .eq('user_id', user?.id)
        .order('created_at', { ascending: false });

      if (error) throw error;
      return data as ReportTemplate[];
    },
    enabled: !!user,
  });

  // Create template mutation
  const createMutation = useMutation({
    mutationFn: async (template: any) => {
      const { data, error } = await supabase
        .from('report_templates')
        .insert({
          user_id: user?.id,
          name: template.name,
          description: template.description,
          template_type: 'traceability',
          sections: template.sections,
          styling: {
            primaryColor: template.primaryColor,
            fontSize: template.fontSize,
            includeCharts: template.includeCharts,
          },
        })
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      toast.success('Template criado com sucesso!');
      setIsDialogOpen(false);
      resetForm();
    },
    onError: () => {
      toast.error('Erro ao criar template');
    },
  });

  // Update template mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id, template }: { id: string; template: any }) => {
      const { data, error } = await supabase
        .from('report_templates')
        .update({
          name: template.name,
          description: template.description,
          sections: template.sections,
          styling: {
            primaryColor: template.primaryColor,
            fontSize: template.fontSize,
            includeCharts: template.includeCharts,
          },
        })
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      toast.success('Template atualizado com sucesso!');
      setIsDialogOpen(false);
      setEditingTemplate(null);
      resetForm();
    },
    onError: () => {
      toast.error('Erro ao atualizar template');
    },
  });

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('report_templates')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['report-templates'] });
      toast.success('Template excluído com sucesso!');
    },
    onError: () => {
      toast.error('Erro ao excluir template');
    },
  });

  const resetForm = () => {
    setFormData({
      name: '',
      description: '',
      sections: ['origin', 'quantitative', 'qualitative', 'geographic'],
      includeCharts: true,
      primaryColor: '#4f46e5',
      fontSize: 12,
    });
  };

  const handleEdit = (template: ReportTemplate) => {
    setEditingTemplate(template);
    setFormData({
      name: template.name,
      description: template.description || '',
      sections: template.sections,
      includeCharts: template.styling?.includeCharts ?? true,
      primaryColor: template.styling?.primaryColor || '#4f46e5',
      fontSize: template.styling?.fontSize || 12,
    });
    setIsDialogOpen(true);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (editingTemplate) {
      updateMutation.mutate({ id: editingTemplate.id, template: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const handleSectionToggle = (section: string) => {
    setFormData(prev => ({
      ...prev,
      sections: prev.sections.includes(section)
        ? prev.sections.filter(s => s !== section)
        : [...prev.sections, section]
    }));
  };

  const sectionOptions = [
    { value: 'origin', label: 'Origem dos Dados' },
    { value: 'quantitative', label: 'Métricas Quantitativas' },
    { value: 'qualitative', label: 'Análise Qualitativa' },
    { value: 'geographic', label: 'Distribuição Geográfica' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold">Templates de Relatório</h2>
          <p className="text-muted-foreground">
            Crie e gerencie templates personalizados para seus relatórios
          </p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={(open) => {
          setIsDialogOpen(open);
          if (!open) {
            setEditingTemplate(null);
            resetForm();
          }
        }}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Novo Template
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>
                {editingTemplate ? 'Editar Template' : 'Criar Novo Template'}
              </DialogTitle>
              <DialogDescription>
                Configure as seções e estilos do seu relatório personalizado
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Nome do Template</Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Ex: Relatório Executivo"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="description">Descrição</Label>
                <Textarea
                  id="description"
                  value={formData.description}
                  onChange={(e) => setFormData(prev => ({ ...prev, description: e.target.value }))}
                  placeholder="Descreva o propósito deste template..."
                  rows={3}
                />
              </div>

              <div className="space-y-2">
                <Label>Seções do Relatório</Label>
                <div className="grid grid-cols-2 gap-3">
                  {sectionOptions.map((option) => (
                    <div key={option.value} className="flex items-center space-x-2">
                      <Switch
                        id={option.value}
                        checked={formData.sections.includes(option.value)}
                        onCheckedChange={() => handleSectionToggle(option.value)}
                      />
                      <Label htmlFor={option.value} className="cursor-pointer">
                        {option.label}
                      </Label>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="primaryColor">Cor Primária</Label>
                  <Input
                    id="primaryColor"
                    type="color"
                    value={formData.primaryColor}
                    onChange={(e) => setFormData(prev => ({ ...prev, primaryColor: e.target.value }))}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fontSize">Tamanho da Fonte</Label>
                  <Input
                    id="fontSize"
                    type="number"
                    min="10"
                    max="16"
                    value={formData.fontSize}
                    onChange={(e) => setFormData(prev => ({ ...prev, fontSize: parseInt(e.target.value) }))}
                  />
                </div>
              </div>

              <div className="flex items-center space-x-2">
                <Switch
                  id="includeCharts"
                  checked={formData.includeCharts}
                  onCheckedChange={(checked) => setFormData(prev => ({ ...prev, includeCharts: checked }))}
                />
                <Label htmlFor="includeCharts" className="cursor-pointer">
                  Incluir gráficos no PDF
                </Label>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancelar
                </Button>
                <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                  {editingTemplate ? 'Atualizar' : 'Criar'} Template
                </Button>
              </div>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse">
              <CardHeader>
                <div className="h-6 bg-muted rounded w-3/4" />
                <div className="h-4 bg-muted rounded w-full mt-2" />
              </CardHeader>
            </Card>
          ))}
        </div>
      ) : templates && templates.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {templates.map((template) => (
            <Card key={template.id}>
              <CardHeader>
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <FileText className="h-5 w-5 text-primary" />
                    <CardTitle className="text-lg">{template.name}</CardTitle>
                  </div>
                  {template.is_default && (
                    <Badge variant="secondary">Padrão</Badge>
                  )}
                </div>
                <CardDescription>{template.description || 'Sem descrição'}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div>
                    <p className="text-sm font-medium mb-2">Seções incluídas:</p>
                    <div className="flex flex-wrap gap-1">
                      {template.sections.map((section) => (
                        <Badge key={section} variant="outline" className="text-xs">
                          {sectionOptions.find(s => s.value === section)?.label || section}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleEdit(template)}
                      className="flex-1"
                    >
                      <Edit className="h-4 w-4 mr-1" />
                      Editar
                    </Button>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() => {
                        if (confirm('Tem certeza que deseja excluir este template?')) {
                          deleteMutation.mutate(template.id);
                        }
                      }}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground mb-4">
              Nenhum template criado ainda
            </p>
            <Button onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4 mr-2" />
              Criar Primeiro Template
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

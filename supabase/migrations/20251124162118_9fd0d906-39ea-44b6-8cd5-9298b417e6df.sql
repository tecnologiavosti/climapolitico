-- Create report_templates table for custom report templates
CREATE TABLE IF NOT EXISTS public.report_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  template_type TEXT NOT NULL DEFAULT 'traceability',
  sections JSONB NOT NULL DEFAULT '[]'::jsonb,
  styling JSONB DEFAULT '{}'::jsonb,
  is_default BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create scheduled_reports table for automated report generation
CREATE TABLE IF NOT EXISTS public.scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  candidate_id UUID REFERENCES public.candidates(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.report_templates(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  frequency TEXT NOT NULL, -- 'daily', 'weekly', 'monthly'
  export_format TEXT NOT NULL, -- 'pdf', 'excel', 'json', 'all'
  recipients JSONB DEFAULT '[]'::jsonb,
  next_run_at TIMESTAMP WITH TIME ZONE,
  last_run_at TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.report_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for report_templates
CREATE POLICY "Users can view their own templates"
  ON public.report_templates
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own templates"
  ON public.report_templates
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own templates"
  ON public.report_templates
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own templates"
  ON public.report_templates
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all templates"
  ON public.report_templates
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- RLS Policies for scheduled_reports
CREATE POLICY "Users can view their own scheduled reports"
  ON public.scheduled_reports
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own scheduled reports"
  ON public.scheduled_reports
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own scheduled reports"
  ON public.scheduled_reports
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own scheduled reports"
  ON public.scheduled_reports
  FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all scheduled reports"
  ON public.scheduled_reports
  FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- Triggers for updated_at
CREATE TRIGGER update_report_templates_updated_at
  BEFORE UPDATE ON public.report_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER update_scheduled_reports_updated_at
  BEFORE UPDATE ON public.scheduled_reports
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Indexes
CREATE INDEX idx_report_templates_user_id ON public.report_templates(user_id);
CREATE INDEX idx_scheduled_reports_user_id ON public.scheduled_reports(user_id);
CREATE INDEX idx_scheduled_reports_next_run ON public.scheduled_reports(next_run_at) WHERE is_active = true;
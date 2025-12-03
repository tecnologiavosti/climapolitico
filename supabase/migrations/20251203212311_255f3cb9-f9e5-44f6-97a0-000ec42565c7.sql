-- Remover políticas RLS permissivas da tabela unique_profiles
DROP POLICY IF EXISTS "System can insert unique profiles" ON public.unique_profiles;
DROP POLICY IF EXISTS "System can update unique profiles" ON public.unique_profiles;

-- Revogar permissões INSERT/UPDATE do role authenticated
-- Edge functions usam service_role que ignora RLS, então não precisam dessas permissões
REVOKE INSERT, UPDATE, DELETE ON public.unique_profiles FROM authenticated;

-- Manter apenas SELECT para usuários autenticados (já existe política de leitura)
-- A política "Users can view unique profiles from their analyses" já existe e é adequada
-- A política "Admins can view all unique profiles" já existe e é adequada

-- Criar política para permitir INSERT/UPDATE apenas via service_role (edge functions)
-- Nota: service_role ignora RLS, então não precisa de política específica
-- Mas vamos criar uma política restritiva caso alguém tente via client

-- Política: Negar INSERT para authenticated (redundante com REVOKE, mas defesa em profundidade)
CREATE POLICY "Deny direct insert from authenticated" 
ON public.unique_profiles 
FOR INSERT 
TO authenticated
WITH CHECK (false);

-- Política: Negar UPDATE para authenticated
CREATE POLICY "Deny direct update from authenticated" 
ON public.unique_profiles 
FOR UPDATE 
TO authenticated
USING (false)
WITH CHECK (false);
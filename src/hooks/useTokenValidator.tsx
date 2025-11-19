import { supabase } from '@/integrations/supabase/client';

export const useTokenValidator = () => {
  const validateToken = async (): Promise<boolean> => {
    try {
      console.log('🔐 Validating token on server...');
      
      // Validate token on server - this actually checks with Supabase
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        console.error('🔒 Token validation failed:', error?.message);
        
        // Try to refresh once
        console.log('🔄 Attempting token refresh...');
        const { error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError) {
          console.error('❌ Refresh failed, forcing logout:', refreshError.message);
          await supabase.auth.signOut();
          window.location.href = '/auth';
          return false;
        }
        
        // Re-validate after refresh
        const { data: { user: refreshedUser }, error: revalidateError } = await supabase.auth.getUser();
        
        if (revalidateError || !refreshedUser) {
          console.error('❌ Token still invalid after refresh');
          await supabase.auth.signOut();
          window.location.href = '/auth';
          return false;
        }
        
        console.log('✅ Token refreshed and validated successfully');
        return true;
      }
      
      console.log('✅ Token is valid');
      return true;
    } catch (e) {
      console.error('💥 Token validation exception:', e);
      await supabase.auth.signOut();
      window.location.href = '/auth';
      return false;
    }
  };
  
  return { validateToken };
};

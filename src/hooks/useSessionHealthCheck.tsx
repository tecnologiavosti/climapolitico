import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

export const useSessionHealthCheck = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    const checkSession = async () => {
      // Use getUser() for server-side validation (not just localStorage check)
      const { data: { user }, error } = await supabase.auth.getUser();
      
      if (error || !user) {
        console.error('🔒 Invalid session detected during health check:', error?.message);
        
        // Try refresh once
        const { error: refreshError } = await supabase.auth.refreshSession();
        
        if (refreshError) {
          console.error('❌ Health check refresh failed, forcing logout');
          await supabase.auth.signOut();
          navigate('/auth');
          return;
        }
        
        console.log('✅ Session refreshed during health check');
      }
    };
    
    // Check on mount
    checkSession();
    
    // Check every 2 minutes (more frequent)
    const interval = setInterval(checkSession, 2 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [navigate]);
};

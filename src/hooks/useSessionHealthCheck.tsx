import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useNavigate } from 'react-router-dom';

export const useSessionHealthCheck = () => {
  const navigate = useNavigate();
  
  useEffect(() => {
    const checkSession = async () => {
      const { data: { session }, error } = await supabase.auth.getSession();
      
      if (error || !session) {
        console.error('🔒 Invalid session detected during health check');
        await supabase.auth.signOut();
        navigate('/auth');
      }
    };
    
    // Check on mount
    checkSession();
    
    // Check every 5 minutes
    const interval = setInterval(checkSession, 5 * 60 * 1000);
    
    return () => clearInterval(interval);
  }, [navigate]);
};

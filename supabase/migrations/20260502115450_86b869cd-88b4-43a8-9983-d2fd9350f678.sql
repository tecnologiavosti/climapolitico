
REVOKE EXECUTE ON FUNCTION public.should_skip_collector(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.record_collector_call(text, integer, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.should_skip_collector(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_collector_call(text, integer, boolean) TO authenticated, service_role;

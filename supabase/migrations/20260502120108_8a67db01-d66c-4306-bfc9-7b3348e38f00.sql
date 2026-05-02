-- Fix 1: Add UPDATE policy for speech_analyses
CREATE POLICY "Users can update their own speech analyses"
ON public.speech_analyses
FOR UPDATE
USING (auth.uid() = user_id)
WITH CHECK (auth.uid() = user_id);

-- Fix 2: Restrict Realtime broadcast/presence channel access via realtime.messages RLS
-- Note: postgres_changes already respects table RLS. This adds defense-in-depth for Broadcast/Presence.
ALTER TABLE realtime.messages ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to subscribe/broadcast only to topics that include their auth.uid()
DROP POLICY IF EXISTS "Authenticated users can access own-scoped realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated users can access own-scoped realtime topics"
ON realtime.messages
FOR SELECT
TO authenticated
USING (
  -- Allow postgres_changes system topics (these are still gated by table RLS),
  -- and require Broadcast/Presence topics to contain the user's UID.
  (realtime.topic() LIKE 'realtime:%')
  OR (realtime.topic() LIKE '%' || auth.uid()::text || '%')
);

DROP POLICY IF EXISTS "Authenticated users can write own-scoped realtime topics" ON realtime.messages;
CREATE POLICY "Authenticated users can write own-scoped realtime topics"
ON realtime.messages
FOR INSERT
TO authenticated
WITH CHECK (
  (realtime.topic() LIKE 'realtime:%')
  OR (realtime.topic() LIKE '%' || auth.uid()::text || '%')
);
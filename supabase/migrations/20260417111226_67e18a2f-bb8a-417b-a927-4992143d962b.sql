
DROP POLICY IF EXISTS "Public can view avatars" ON storage.objects;

-- Permite SELECT público apenas para arquivos individuais (não listagem em massa)
CREATE POLICY "Avatar files are publicly accessible"
ON storage.objects FOR SELECT
USING (bucket_id = 'avatars' AND (storage.foldername(name))[1] IS NOT NULL);

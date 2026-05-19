import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const { secret, oldEmail, newEmail, newPassword } = await req.json();
  if (secret !== "run-once-3hf83") return new Response("nope", { status: 403 });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const { data: list, error: le } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (le) return new Response(JSON.stringify({ error: le.message }), { status: 500 });
  const user = list.users.find((u) => u.email?.toLowerCase() === oldEmail.toLowerCase());
  if (!user) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    email: newEmail,
    password: newPassword,
    email_confirm: true,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, id: data.user.id, email: data.user.email }));
});

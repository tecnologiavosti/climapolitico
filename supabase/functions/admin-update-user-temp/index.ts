import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req) => {
  const body = await req.json();
  if (body.secret !== "run-once-3hf83") return new Response("nope", { status: 403 });
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
  const action = body.action || "update";

  if (action === "create" || action === "reset_and_clone") {
    const { email, password, sourceEmail } = body;
    if (action === "reset_and_clone") {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
      if (!existing) return new Response(JSON.stringify({ error: "target not found" }), { status: 404 });
      await admin.auth.admin.updateUserById(existing.id, { password, email_confirm: true });
      const newUserId2 = existing.id;
      const { data: list2 } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const src = list2.users.find((x) => x.email?.toLowerCase() === sourceEmail.toLowerCase());
      const sourceUserId2 = src?.id ?? null;
      if (!sourceUserId2) return new Response(JSON.stringify({ error: "source not found" }), { status: 404 });
      const { data: cands } = await admin.from("candidates").select("*").eq("user_id", sourceUserId2);
      const idMap: Record<string, string> = {};
      const newCands = (cands ?? []).map((c: any) => {
        const newId = crypto.randomUUID(); idMap[c.id] = newId;
        return (() => { const { created_at, updated_at, ...rest } = c; return { ...rest, id: newId, user_id: newUserId2 }; })();
      });
      if (newCands.length) {
        const { error } = await admin.from("candidates").insert(newCands);
        if (error) return new Response(JSON.stringify({ step: "insert candidates", error: error.message }), { status: 500 });
      }
      const { data: mc } = await admin.from("candidate_metrics_cache").select("*").eq("user_id", sourceUserId2);
      const newMc = (mc ?? []).filter((m: any) => idMap[m.candidate_id]).map((m: any) => {
        const { created_at, updated_at, id, ...rest } = m;
        return { ...rest, id: crypto.randomUUID(), user_id: newUserId2, candidate_id: idMap[m.candidate_id] };
      });
      if (newMc.length) {
        const { error } = await admin.from("candidate_metrics_cache").insert(newMc);
        if (error) return new Response(JSON.stringify({ step: "insert metrics", error: error.message }), { status: 500 });
      }
      let from2 = 0, batchSize2 = 1000, totalInserted2 = 0;
      while (true) {
        const { data: si, error } = await admin
          .from("social_interactions").select("*").eq("user_id", sourceUserId2)
          .range(from2, from2 + batchSize2 - 1);
        if (error) return new Response(JSON.stringify({ step: "select si", error: error.message }), { status: 500 });
        if (!si || si.length === 0) break;
        const newSi = si.filter((s: any) => idMap[s.candidate_id]).map((s: any) => {
          const { created_at, id, ...rest } = s;
          return { ...rest, id: crypto.randomUUID(), user_id: newUserId2, candidate_id: idMap[s.candidate_id], analysis_id: null };
        });
        if (newSi.length) {
          const { error: ie } = await admin.from("social_interactions").insert(newSi);
          if (ie) return new Response(JSON.stringify({ step: "insert si", inserted_so_far: totalInserted2, error: ie.message }), { status: 500 });
          totalInserted2 += newSi.length;
        }
        if (si.length < batchSize2) break;
        from2 += batchSize2;
      }
      return new Response(JSON.stringify({ ok: true, newUserId: newUserId2, sourceUserId: sourceUserId2, cloned: { candidates: newCands.length, metrics_cache: newMc.length, social_interactions: totalInserted2 } }));
    }
    // Create user with confirmed email
    const { data: created, error: cerr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (cerr) return new Response(JSON.stringify({ error: cerr.message }), { status: 500 });
    const newUserId = created.user.id;

    // Find source user
    let sourceUserId: string | null = null;
    if (sourceEmail) {
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = list.users.find((x) => x.email?.toLowerCase() === sourceEmail.toLowerCase());
      sourceUserId = u?.id ?? null;
    }

    const cloned: Record<string, number> = {};
    if (sourceUserId) {
      // Clone candidates with new ids, then clone metrics_cache + social_interactions
      const { data: cands, error: ce } = await admin.from("candidates").select("*").eq("user_id", sourceUserId);
      if (ce) return new Response(JSON.stringify({ step: "candidates", error: ce.message }), { status: 500 });
      const idMap: Record<string, string> = {};
      const newCands = (cands ?? []).map((c: any) => {
        const newId = crypto.randomUUID();
        idMap[c.id] = newId;
        return (() => { const { created_at, updated_at, ...rest } = c; return { ...rest, id: newId, user_id: newUserId }; })();
      });
      if (newCands.length) {
        const { error } = await admin.from("candidates").insert(newCands);
        if (error) return new Response(JSON.stringify({ step: "insert candidates", error: error.message }), { status: 500 });
      }
      cloned.candidates = newCands.length;

      // metrics cache
      const { data: mc } = await admin.from("candidate_metrics_cache").select("*").eq("user_id", sourceUserId);
      const newMc = (mc ?? []).filter((m: any) => idMap[m.candidate_id]).map((m: any) => ({
        ...m, id: crypto.randomUUID(), user_id: newUserId, candidate_id: idMap[m.candidate_id],
        created_at: undefined, updated_at: undefined,
      }));
      if (newMc.length) {
        const { error } = await admin.from("candidate_metrics_cache").insert(newMc);
        if (error) return new Response(JSON.stringify({ step: "insert metrics", error: error.message }), { status: 500 });
      }
      cloned.metrics_cache = newMc.length;

      // social_interactions in batches
      let from = 0, batchSize = 1000, totalInserted = 0;
      while (true) {
        const { data: si, error } = await admin
          .from("social_interactions").select("*").eq("user_id", sourceUserId)
          .range(from, from + batchSize - 1);
        if (error) return new Response(JSON.stringify({ step: "select si", error: error.message }), { status: 500 });
        if (!si || si.length === 0) break;
        const newSi = si.filter((s: any) => idMap[s.candidate_id]).map((s: any) => ({
          ...s, id: crypto.randomUUID(), user_id: newUserId, candidate_id: idMap[s.candidate_id],
          analysis_id: null, created_at: undefined,
        }));
        if (newSi.length) {
          const { error: ie } = await admin.from("social_interactions").insert(newSi);
          if (ie) return new Response(JSON.stringify({ step: "insert si", error: ie.message }), { status: 500 });
          totalInserted += newSi.length;
        }
        if (si.length < batchSize) break;
        from += batchSize;
      }
      cloned.social_interactions = totalInserted;
    }

    return new Response(JSON.stringify({ ok: true, newUserId, sourceUserId, cloned }));
  }

  // update action (existing)
  const { oldEmail, newEmail, newPassword } = body;
  const { data: list, error: le } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if (le) return new Response(JSON.stringify({ error: le.message }), { status: 500 });
  const user = list.users.find((u) => u.email?.toLowerCase() === oldEmail.toLowerCase());
  if (!user) return new Response(JSON.stringify({ error: "not found" }), { status: 404 });
  const { data, error } = await admin.auth.admin.updateUserById(user.id, {
    email: newEmail, password: newPassword, email_confirm: true,
  });
  if (error) return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true, id: data.user.id, email: data.user.email }));
});

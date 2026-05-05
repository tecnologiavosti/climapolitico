// Shared JWT verification helper for edge functions.
// Uses SUPABASE_SERVICE_ROLE_KEY per project rule.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

export interface AuthResult {
  userId: string;
  email?: string;
  token: string;
}

export class UnauthorizedError extends Error {
  status = 401;
  constructor(message = "Unauthorized") {
    super(message);
  }
}

/**
 * Verifies the JWT in the Authorization header and returns the user's id.
 * Throws UnauthorizedError when the token is missing or invalid.
 */
export async function verifyJwt(req: Request): Promise<AuthResult> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Missing bearer token");
  }
  const token = authHeader.slice(7).trim();
  if (!token) throw new UnauthorizedError("Empty token");

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) {
    throw new UnauthorizedError(error?.message || "Invalid token");
  }
  return { userId: data.user.id, email: data.user.email ?? undefined, token };
}

/** Convenience: returns null instead of throwing — use when caller wants to branch. */
export async function tryVerifyJwt(req: Request): Promise<AuthResult | null> {
  try {
    return await verifyJwt(req);
  } catch {
    return null;
  }
}

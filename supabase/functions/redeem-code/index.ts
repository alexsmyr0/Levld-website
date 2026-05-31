import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Called by the iOS app at launch with the user's JWT in the Authorization header
// and a JSON body of { code, email }. Deploy WITH jwt verification (default) so the
// platform rejects unauthenticated calls before this code runs.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "missing authorization" }, 401);

  // Resolve the caller from their JWT.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await userClient.auth.getUser();
  if (userErr || !user) return json({ error: "invalid session" }, 401);

  let payload: { code?: unknown; email?: unknown };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }
  const code = typeof payload.code === "string" ? payload.code.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  if (!code || !email) return json({ error: "code and email are required" }, 400);

  // Service-role client bypasses RLS. The triple WHERE (code + email + status='issued')
  // is the brute-force defense AND the double-redeem guard: a single atomic UPDATE that
  // matches zero rows if the code is wrong, the email doesn't match the purchase, or it
  // was already redeemed/revoked.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data, error } = await admin
    .from("early_access_codes")
    .update({
      status: "redeemed",
      redeemed_at: new Date().toISOString(),
      redeemed_by_user_id: user.id,
    })
    .eq("code", code)
    .eq("email", email)
    .eq("status", "issued")
    .select()
    .single();

  if (error || !data) {
    // PGRST116 = no rows matched. Keep the message generic so we don't leak which of
    // code/email/status failed (helps against probing).
    return json({ error: "invalid or already-redeemed code" }, 400);
  }

  // TODO(app-launch): upsert a lifetime entitlement for user.id into the entitlements
  // table once the app's auth/entitlement schema lands, then key the paywall off it.
  return json({ redeemed: true, user_id: user.id });
});

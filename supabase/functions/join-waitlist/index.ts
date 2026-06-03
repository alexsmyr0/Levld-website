import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Public waitlist signup. Called straight from the static marketing site, so it
// must run WITHOUT jwt verification — deploy with `--no-verify-jwt`
// (and see [functions.join-waitlist] in config.toml). It runs as service_role
// internally (bypasses RLS) and is the ONLY writer for waitlist rows.
//
// Flow: validate + normalize email -> issue (or re-issue) a single 50%-off code
// per email -> email it via Resend. One code per email is enforced by the DB
// unique index on lower(email); this function makes the experience idempotent
// (a repeat submit re-sends the SAME code) and rate-limits the re-send so the
// endpoint can't be used to bomb someone's inbox.

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;

// Only the legit reason to resubmit is "I lost my email" — nobody needs a fresh
// send within minutes. Inside this window we accept the request (return ok) but
// do NOT re-send the email, so a resubmit loop can't spam an inbox.
const RESEND_COOLDOWN_MINUTES = 60;

// Browsers send a CORS preflight. Allow the marketing origins only.
const ALLOWED_ORIGINS = new Set([
  "https://levld.app",
  "https://www.levld.app",
  "http://localhost:3000",
  "http://127.0.0.1:3000",
]);

function corsHeaders(origin: string | null) {
  const allow = origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://levld.app";
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type",
    "Vary": "Origin",
  };
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function gen6() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

async function sendCodeEmail(to: string, code: string, firstName: string) {
  const hi = firstName ? `Hi ${firstName},` : "Hi,";
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Levld <support@levld.app>",
      to,
      subject: "You're on the Levld waitlist — your 50% off code",
      html: `<h2>You're on the list.</h2>
        <p>${hi}</p>
        <p>Thanks for joining the Levld waitlist. Here's your <b>50% off</b> code for launch day:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>Keep this email. When Levld launches, enter this code with
           <b>this same email address</b> to take 50% off your subscription.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`email failed: ${await res.text()}`);
}

// Insert a new waitlist row, retrying on a code collision (23505 on the code
// unique index). Returns null if the email already exists (23505 on the email
// unique index) so the caller can fall back to the re-send path.
async function insertNewCode(row: Record<string, unknown>) {
  for (let i = 0; i < 6; i++) {
    const code = gen6();
    const { data, error } = await admin
      .from("early_access_codes")
      .insert({ ...row, code, offer_type: "waitlist_50", status: "issued" })
      .select()
      .single();
    if (!error) return data;
    if (error.code !== "23505") throw error;
    // Email already on the list -> not a code collision; hand back to re-send path.
    if (error.message.includes("email")) return null;
    // else: code collision, loop and try another code.
  }
  throw new Error("could not generate a unique code");
}

Deno.serve(async (req) => {
  const origin = req.headers.get("Origin");
  const cors = corsHeaders(origin);
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...cors, "Content-Type": "application/json" },
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid body" }, 400);
  }

  // Honeypot: a hidden field real users never see. Bots fill it. If set, act
  // successful but do nothing — don't tip off the bot, don't send an email.
  if (typeof payload.company === "string" && payload.company.trim() !== "") {
    return json({ ok: true });
  }

  const firstName = typeof payload.firstName === "string" ? payload.firstName.trim() : "";
  const lastName = typeof payload.lastName === "string" ? payload.lastName.trim() : "";
  const phone = typeof payload.phone === "string" ? payload.phone.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";

  if (!firstName || !email) return json({ error: "first name and email are required" }, 400);
  if (!EMAIL_RE.test(email)) return json({ error: "please enter a valid email address" }, 400);

  try {
    // Is this email already on the list?
    const { data: existing, error: lookupErr } = await admin
      .from("early_access_codes")
      .select("code, updated_at")
      .eq("email", email)
      .maybeSingle();
    if (lookupErr) throw lookupErr;

    if (existing) {
      // Cooldown: re-send the SAME code, but not more than once per window.
      const last = new Date(existing.updated_at as string).getTime();
      const ageMs = Date.now() - last;
      if (ageMs < RESEND_COOLDOWN_MINUTES * 60_000) {
        // Recently sent — accept silently without another email.
        return json({ ok: true, alreadyJoined: true });
      }
      await admin
        .from("early_access_codes")
        .update({ updated_at: new Date().toISOString() })
        .eq("email", email);
      await sendCodeEmail(email, existing.code as string, firstName);
      return json({ ok: true, alreadyJoined: true });
    }

    // New signup.
    const created = await insertNewCode({ email, first_name: firstName, last_name: lastName, phone });
    if (!created) {
      // Lost a race: the row was created between our lookup and insert. Treat as
      // already-joined; the winning request sent the email.
      return json({ ok: true, alreadyJoined: true });
    }
    await sendCodeEmail(email, created.code as string, firstName);
    return json({ ok: true });
  } catch (err) {
    console.error("join-waitlist failed:", err);
    return json({ error: "something went wrong, please try again" }, 500);
  }
});

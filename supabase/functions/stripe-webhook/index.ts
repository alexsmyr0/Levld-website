import Stripe from "https://esm.sh/stripe@14?target=denonext";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const stripe = new Stripe(Deno.env.get("STRIPE_SECRET_KEY")!, { apiVersion: "2024-06-20" });
const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET")!;
const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, // bypasses RLS
);

function gen6() { return Math.floor(100000 + Math.random() * 900000).toString(); }

async function insertUniqueCode(row: Record<string, unknown>) {
  for (let i = 0; i < 6; i++) {
    const code = gen6();
    const { data, error } = await supabase
      .from("early_access_codes").insert({ ...row, code }).select().single();
    if (!error) return data;
    if (error.code !== "23505") throw error;
    if (error.message.includes("stripe_session_id")) return null; // already issued
  }
  throw new Error("could not generate a unique code");
}

async function sendEmail(to: string, code: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: "Levld <support@levld.app>",
      to, subject: "Your Levld lifetime access code",
      html: `<h2>You're in. For life.</h2>
        <p>Thanks for backing Levld early. Your lifetime access code:</p>
        <p style="font-size:32px;font-weight:700;letter-spacing:4px">${code}</p>
        <p>Keep this email. When the app launches, enter this code with
           <b>this same email address</b> to unlock Levld free, forever — no subscription.</p>`,
    }),
  });
  if (!res.ok) throw new Error(`email failed: ${await res.text()}`);
}

Deno.serve(async (req) => {
  const sig = req.headers.get("stripe-signature");
  if (!sig) return new Response("no signature", { status: 400 });
  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, sig, webhookSecret);
  } catch (err) {
    return new Response(`bad signature: ${err.message}`, { status: 400 });
  }
  if (event.type === "checkout.session.completed") {
    const s = event.data.object as Stripe.Checkout.Session;
    const email = s.customer_details?.email ?? s.customer_email;
    if (!email) return new Response("no email", { status: 400 });
    try {
      const data = await insertUniqueCode({
        email, stripe_session_id: s.id,
        stripe_customer_id: typeof s.customer === "string" ? s.customer : null,
        amount_paid_cents: s.amount_total, currency: s.currency ?? "usd", status: "issued",
      });
      if (data) await sendEmail(email, data.code as string);
    } catch (err) {
      // Log full detail to function logs (dashboard), return 500 so Stripe retries.
      console.error("checkout.session.completed handling failed:", err);
      return new Response("processing error", { status: 500 });
    }
  }
  return new Response(JSON.stringify({ received: true }), { headers: { "Content-Type": "application/json" } });
});

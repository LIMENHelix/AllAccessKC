// /api/email-test.ts
//
// Sends a single test email via Resend to verify the integration without
// running the full auto-post pipeline. Public — no auth required.
//
// On success: 200 + JSON { ok: true, id: "<resend-msg-id>", to: "...", from: "..." }
// On failure: 500 + JSON { ok: false, error: "..." } — most common causes:
//   - RESEND_API_KEY not set (set in Vercel env vars)
//   - Sender domain not verified on Resend (add SPF + DKIM DNS records)
//   - Resend rate limit (free tier: 100 emails/day, 3,000/month)
//
// Hit: https://allaccesskc.com/api/email-test

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { sendNotificationEmail } from "./_shared.js";

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const now = new Date().toISOString();
  const to = process.env.NOTIFY_EMAIL || "info@allaccesskc.com";
  const from = process.env.EMAIL_FROM || "All Access KC <noreply@allaccesskc.com>";

  const html = `<!doctype html><html><body style="margin:0;background:#f7f1e3;font-family:Georgia,serif;color:#1a1d2a;">
<div style="max-width:560px;margin:0 auto;padding:32px 24px;">
  <div style="font-size:0.7rem;letter-spacing:4px;color:#8b6914;text-transform:uppercase;font-weight:600;margin-bottom:12px;">ALL ACCESS KC · EMAIL TEST</div>
  <h1 style="font-size:1.4rem;font-weight:300;color:#1a1d2a;margin:0 0 16px 0;">Resend integration working.</h1>
  <p style="font-size:0.95rem;color:#3d4053;line-height:1.6;margin:0 0 18px 0;">If you're reading this, your AllAccessKC site can successfully send transactional email via Resend. The daily auto-post will now arrive in this inbox.</p>
  <div style="background:#fbf6e8;border-left:3px solid #8b6914;padding:14px 18px;font-size:0.82rem;color:#646774;line-height:1.6;">
    <div><strong>Sent at:</strong> ${now}</div>
    <div><strong>From:</strong> ${from}</div>
    <div><strong>To:</strong> ${to}</div>
    <div><strong>Triggered by:</strong> /api/email-test (manual)</div>
  </div>
</div></body></html>`;

  const result = await sendNotificationEmail({
    subject: `[All Access KC] Email integration test — ${now}`,
    html,
  });

  res.status(result.sent ? 200 : 500).json({
    ok: result.sent,
    sentAt: now,
    from,
    to,
    resendMessageId: result.id || null,
    error: result.error || null,
  });
}

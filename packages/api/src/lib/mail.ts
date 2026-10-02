// Transactional email. Production path: Resend (RESEND_API_KEY).
// Without a key, mail is logged server-side so the flow stays testable
// in development. The forgot-password endpoint never reveals whether
// an address exists, so logging the link in dev is safe enough there.

import { config } from "../config.js";

export interface OutgoingMail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

async function sendViaResend(mail: OutgoingMail): Promise<void> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.resendApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: config.mailFrom,
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend rejected the email (${res.status}): ${body.slice(0, 200)}`);
  }
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  if (!config.isProd) outbox.push(mail);
  if (config.resendApiKey) {
    await sendViaResend(mail);
    return;
  }
  // Dev fallback: log so the link is retrievable without an email provider.
  console.log(
    `[mail:dev] to=${mail.to} subject=${mail.subject}\n${mail.text}`,
  );
}

/** Test seam: mail recorded outside production, drained between assertions. */
const outbox: OutgoingMail[] = [];
export function takeOutbox(): OutgoingMail[] {
  return outbox.splice(0, outbox.length);
}

export function passwordResetMail(to: string, resetUrl: string, ttlMinutes: number): OutgoingMail {
  const text = [
    "Someone requested a password reset for your Curvelo account.",
    "",
    `Reset your password here (valid for ${ttlMinutes} minutes, one-time use):`,
    resetUrl,
    "",
    "If you didn't request this, you can ignore this email — your password stays the same.",
  ].join("\n");
  return {
    to,
    subject: "Reset your Curvelo password",
    text,
    html: `<p>Someone requested a password reset for your Curvelo account.</p>
<p><a href="${resetUrl}">Reset your password</a> (valid for ${ttlMinutes} minutes, one-time use).</p>
<p>If you didn't request this, you can ignore this email — your password stays the same.</p>`,
  };
}

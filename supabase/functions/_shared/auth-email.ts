export const EMAIL_BRAND = "Clima Político";
export const EMAIL_FROM = "Clima Político <no-reply@climapolitico.com.br>";

type SendAuthEmailParams = {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
};

export async function sendAuthEmail({ to, subject, html, text }: SendAuthEmailParams) {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) {
    throw new Error("RESEND_API_KEY não configurada");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: EMAIL_FROM,
      to: Array.isArray(to) ? to : [to],
      subject,
      html,
      ...(text ? { text } : {}),
    }),
  });

  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Resend error ${response.status}: ${body}`);
  }

  return body;
}
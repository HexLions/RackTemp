import fs from "fs";
import path from "path";

type GraphConfig = {
  graphTenantId: string | null;
  graphClientId: string | null;
  graphClientSecret: string | null;
  graphSenderEmail: string | null;
};

async function getAccessToken(cfg: GraphConfig): Promise<string> {
  const res = await fetch(`https://login.microsoftonline.com/${cfg.graphTenantId}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: cfg.graphClientId!,
      client_secret: cfg.graphClientSecret!,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph token request failed (${res.status}): ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as { access_token: string };
  return json.access_token;
}

// Sends mail as cfg.graphSenderEmail via the Microsoft Graph API (OAuth2
// client-credentials flow), the replacement for SMTP basic auth that
// Microsoft is retiring on Exchange Online / Outlook.com. The app
// registration needs the Mail.Send *application* permission, granted admin
// consent, scoped to graphSenderEmail's mailbox.
export async function sendGraphMail(
  cfg: GraphConfig,
  to: string,
  subject: string,
  text: string,
  attachments?: { filename: string; path: string }[]
) {
  if (!cfg.graphTenantId || !cfg.graphClientId || !cfg.graphClientSecret || !cfg.graphSenderEmail) {
    return false;
  }

  const accessToken = await getAccessToken(cfg);

  const graphAttachments = (attachments ?? []).map((a) => ({
    "@odata.type": "#microsoft.graph.fileAttachment",
    name: path.basename(a.filename),
    contentBytes: fs.readFileSync(a.path).toString("base64"),
  }));

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(cfg.graphSenderEmail)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: "Text", content: text },
          toRecipients: [{ emailAddress: { address: to } }],
          attachments: graphAttachments.length ? graphAttachments : undefined,
        },
      }),
    }
  );

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Graph sendMail failed (${res.status}): ${body.slice(0, 300)}`);
  }
  return true;
}

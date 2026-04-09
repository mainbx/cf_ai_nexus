import { Env } from '../types';
import { summarize } from '../lib/agent';
import { upsertVector } from '../lib/embeddings';
import { getSetting } from './settings';

const GMAIL_SCOPES = 'https://www.googleapis.com/auth/gmail.readonly';

interface GmailTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export async function handleGmail(request: Request, env: Env, path: string): Promise<Response> {
  const GOOGLE_CLIENT_ID = await getSetting(env, 'GOOGLE_CLIENT_ID');
  const GOOGLE_CLIENT_SECRET = await getSetting(env, 'GOOGLE_CLIENT_SECRET');
  const REDIRECT_URI = new URL('/api/gmail/callback', request.url).toString();

  // GET /api/gmail/auth — start OAuth flow
  if (path === '/api/gmail/auth' && request.method === 'GET') {
    if (!GOOGLE_CLIENT_ID) {
      return Response.json({ error: 'Gmail integration not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.' }, { status: 400 });
    }

    const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', GMAIL_SCOPES);
    authUrl.searchParams.set('access_type', 'offline');
    authUrl.searchParams.set('prompt', 'consent');

    return Response.redirect(authUrl.toString(), 302);
  }

  // GET /api/gmail/callback — handle OAuth callback
  if (path === '/api/gmail/callback' && request.method === 'GET') {
    const url = new URL(request.url);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      return new Response(`<html><body><h2>Gmail authorization denied</h2><p>${error}</p><script>window.close()</script></body></html>`, {
        headers: { 'Content-Type': 'text/html' },
      });
    }

    if (!code) {
      return Response.json({ error: 'No authorization code received' }, { status: 400 });
    }

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens: GmailTokens = await tokenRes.json() as GmailTokens;

    if (!tokens.access_token) {
      return Response.json({ error: 'Failed to get access token' }, { status: 500 });
    }

    // Pass token back to opener safely via JSON-encoded postMessage
    const safeToken = JSON.stringify(tokens.access_token);
    const origin = new URL(request.url).origin;
    return new Response(`<!DOCTYPE html>
<html><body>
<h2>Gmail connected!</h2>
<p>You can close this window.</p>
<script>
  if (window.opener) {
    window.opener.postMessage({ type: 'gmail_auth', access_token: ${safeToken} }, '${origin}');
  }
  setTimeout(function() { window.close(); }, 2000);
</script>
</body></html>`, { headers: { 'Content-Type': 'text/html' } });
  }

  // POST /api/gmail/import — import emails using provided access token
  if (path === '/api/gmail/import' && request.method === 'POST') {
    let body: any;
    try { body = await request.json(); } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }
    const { access_token, max_results = 10, query = '' } = body;

    if (!access_token) {
      return Response.json({ error: 'access_token required' }, { status: 400 });
    }

    // Fetch email list from Gmail API
    const searchQuery = query || 'in:inbox';
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max_results}&q=${encodeURIComponent(searchQuery)}`,
      { headers: { Authorization: `Bearer ${access_token}` } }
    );

    if (!listRes.ok) {
      const err = await listRes.text();
      return Response.json({ error: 'Failed to fetch emails', details: err }, { status: 500 });
    }

    const listData: any = await listRes.json();
    const messageIds = (listData.messages || []).map((m: any) => m.id);

    if (messageIds.length === 0) {
      return Response.json({ imported: 0, message: 'No emails found' });
    }

    // Fetch emails in parallel (batches of 5)
    const emails: { subject: string; from: string; date: string; body: string; id: string }[] = [];
    for (let i = 0; i < messageIds.length; i += 5) {
      const batch = messageIds.slice(i, i + 5);
      const results = await Promise.all(
        batch.map(async (msgId: string) => {
          const msgRes = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages/${msgId}?format=full`,
            { headers: { Authorization: `Bearer ${access_token}` } }
          );
          if (!msgRes.ok) return null;
          const msgData: any = await msgRes.json();
          return {
            id: msgId,
            subject: msgData.payload?.headers?.find((h: any) => h.name === 'Subject')?.value || 'No Subject',
            from: msgData.payload?.headers?.find((h: any) => h.name === 'From')?.value || 'Unknown',
            date: msgData.payload?.headers?.find((h: any) => h.name === 'Date')?.value || '',
            body: extractEmailBody(msgData.payload).slice(0, 1500),
          };
        })
      );
      emails.push(...results.filter(Boolean) as typeof emails);
    }

    // Store emails directly in D1 + get a single summary from small model
    let imported = 0;
    for (const email of emails) {
      const entryId = crypto.randomUUID();
      const content = JSON.stringify({
        from: email.from,
        subject: email.subject,
        body: email.body,
        date: email.date,
      });

      await env.DB.prepare(
        'INSERT INTO entries (id, type, title, content, tags, source) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(entryId, 'email', email.subject, content, 'gmail,imported', 'gmail').run();

      // Embed for search (without full body to save tokens)
      const searchText = `${email.subject} ${email.from} ${email.body.slice(0, 500)}`.slice(0, 2000);
      try {
        await upsertVector(env, entryId, searchText, { type: 'email', title: email.subject });
      } catch { /* Vectorize may not be available locally */ }

      imported++;
    }

    // Use small model to generate a brief summary of what was imported
    let summaryText = `Imported ${imported} emails.`;
    if (imported > 0) {
      try {
        const emailList = emails.map(e => `- "${e.subject}" from ${e.from}`).join('\n');
        const anthropicKey = await getSetting(env, 'ANTHROPIC_API_KEY');
        summaryText = await summarize(
          env,
          `Summarize these ${imported} imported emails in 2-3 sentences:\n${emailList}`,
          undefined,
          anthropicKey
        );
      } catch { /* If summary fails, use the default text */ }
    }

    return Response.json({
      imported,
      response: summaryText,
    });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

function extractEmailBody(payload: any): string {
  if (payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      if (part.parts) {
        return extractEmailBody(part);
      }
    }
  }
  return payload.snippet || '';
}

function decodeBase64Url(data: string): string {
  const base64 = data.replace(/-/g, '+').replace(/_/g, '/');
  try {
    return atob(base64);
  } catch {
    return '';
  }
}

import { Env } from '../types';

export async function handleSettings(request: Request, env: Env, path: string): Promise<Response> {
  // GET /api/settings — get all settings (mask secret values)
  if (path === '/api/settings' && request.method === 'GET') {
    const result = await env.DB.prepare('SELECT key, value FROM settings').all<{ key: string; value: string }>();

    const settings: Record<string, string> = {};
    for (const row of result.results) {
      // Mask secret values — only show last 4 chars
      if (row.key.includes('API_KEY') || row.key.includes('SECRET')) {
        settings[row.key] = row.value ? '••••••••' + row.value.slice(-4) : '';
      } else {
        settings[row.key] = row.value;
      }
    }

    return Response.json(settings);
  }

  // PUT /api/settings — update a setting
  if (path === '/api/settings' && request.method === 'PUT') {
    let body: any;
    try { body = await request.json(); } catch {
      return Response.json({ error: 'Invalid JSON' }, { status: 400 });
    }

    const { key, value } = body;
    if (!key || typeof key !== 'string') {
      return Response.json({ error: 'key is required' }, { status: 400 });
    }

    // Only allow known settings
    const allowedKeys = ['ANTHROPIC_API_KEY', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'];
    if (!allowedKeys.includes(key)) {
      return Response.json({ error: `Unknown setting: ${key}` }, { status: 400 });
    }

    await env.DB.prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    ).bind(key, value || '').run();

    return Response.json({ success: true, key });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

// Helper: get a setting value from D1, falling back to env var
export async function getSetting(env: Env, key: string): Promise<string> {
  try {
    const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
      .bind(key).first<{ value: string }>();
    if (row?.value) return row.value;
  } catch { /* table might not exist yet */ }

  // Fall back to env vars / secrets
  if (key === 'ANTHROPIC_API_KEY') return env.ANTHROPIC_API_KEY || '';
  if (key === 'GOOGLE_CLIENT_ID') return env.GOOGLE_CLIENT_ID || '';
  if (key === 'GOOGLE_CLIENT_SECRET') return env.GOOGLE_CLIENT_SECRET || '';
  return '';
}

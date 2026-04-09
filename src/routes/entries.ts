import { Env, WikiEntry } from '../types';
import { upsertVector, deleteVector } from '../lib/embeddings';

export async function handleEntries(request: Request, env: Env, path: string): Promise<Response> {
  // GET /api/entries
  if (request.method === 'GET' && path === '/api/entries') {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const search = url.searchParams.get('search');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    let query = 'SELECT * FROM entries';
    const params: any[] = [];

    if (type) {
      query += ' WHERE type = ?';
      params.push(type);
    }
    if (search) {
      const whereOrAnd = type ? ' AND' : ' WHERE';
      query += `${whereOrAnd} (title LIKE ? OR content LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all<WikiEntry>();
    return Response.json(result.results);
  }

  // GET /api/entries/:id
  const idMatch = path.match(/^\/api\/entries\/(.+)$/);
  if (request.method === 'GET' && idMatch) {
    const entry = await env.DB.prepare('SELECT * FROM entries WHERE id = ?')
      .bind(idMatch[1])
      .first<WikiEntry>();
    if (!entry) return Response.json({ error: 'Not found' }, { status: 404 });
    return Response.json(entry);
  }

  // POST /api/entries (manual create)
  if (request.method === 'POST' && path === '/api/entries') {
    const body: any = await request.json();
    const id = crypto.randomUUID();
    const { type, title, content, tags } = body;

    if (!type || !title || !content) {
      return Response.json({ error: 'type, title, content required' }, { status: 400 });
    }

    await env.DB.prepare(
      'INSERT INTO entries (id, type, title, content, tags, source) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(id, type, title, typeof content === 'string' ? content : JSON.stringify(content), tags || null, 'manual')
      .run();

    // Build search text — strip base64 file data, limit length
    let searchContent = typeof content === 'string' ? content : JSON.stringify(content);
    try {
      const parsed = JSON.parse(searchContent);
      delete parsed.fileData;
      searchContent = JSON.stringify(parsed);
    } catch { /* use as-is */ }
    const searchText = `${title} ${type} ${tags || ''} ${searchContent}`.slice(0, 2000);
    await upsertVector(env, id, searchText, { type, title });

    return Response.json({ id, type, title }, { status: 201 });
  }

  // PUT /api/entries/:id
  if (request.method === 'PUT' && idMatch) {
    const body: any = await request.json();
    const id = idMatch[1];

    const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

    const updates: string[] = [];
    const values: any[] = [];

    if (body.title) { updates.push('title = ?'); values.push(body.title); }
    if (body.content) { updates.push('content = ?'); values.push(typeof body.content === 'string' ? body.content : JSON.stringify(body.content)); }
    if (body.tags !== undefined) { updates.push('tags = ?'); values.push(body.tags); }
    if (body.type) { updates.push('type = ?'); values.push(body.type); }
    updates.push("updated_at = datetime('now')");
    values.push(id);

    if (updates.length > 1) {
      await env.DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`)
        .bind(...values)
        .run();

      const updated = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
      if (updated) {
        const searchText = `${updated.title} ${updated.type} ${updated.tags || ''} ${updated.content}`;
        await upsertVector(env, id, searchText, { type: updated.type, title: updated.title });
      }
    }

    return Response.json({ success: true, id });
  }

  // DELETE /api/entries/:id
  if (request.method === 'DELETE' && idMatch) {
    const id = idMatch[1];
    const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

    await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
    await deleteVector(env, id);

    return Response.json({ success: true, deleted: existing.title });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

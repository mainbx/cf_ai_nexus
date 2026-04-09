import { Env, WikiEntry } from '../types';
import { searchVectors, upsertVector, deleteVector } from '../lib/embeddings';
import { runAgent } from '../lib/agent';

// REST API endpoint for external access
// Exposes the wiki as a tool that other AIs or clients can query

export async function handleMcp(request: Request, env: Env, path: string): Promise<Response> {
  // GET /mcp — service discovery / info
  if (path === '/mcp' && request.method === 'GET') {
    return Response.json({
      name: 'nexus-wiki',
      version: '1.0.0',
      description: 'Personal knowledge base / wiki. Search, read, and manage entries including contacts, notes, emails, bookmarks, and more.',
      endpoints: {
        search: { method: 'POST', path: '/mcp/search', description: 'Semantic search across all wiki entries' },
        entries: { method: 'GET', path: '/mcp/entries', description: 'List entries, optionally filtered by type' },
        entry: { method: 'GET', path: '/mcp/entries/:id', description: 'Get a single entry by ID' },
        create: { method: 'POST', path: '/mcp/entries', description: 'Create a new wiki entry' },
        update: { method: 'PUT', path: '/mcp/entries/:id', description: 'Update an existing entry' },
        delete: { method: 'DELETE', path: '/mcp/entries/:id', description: 'Delete an entry' },
        types: { method: 'GET', path: '/mcp/types', description: 'List all entry types and counts' },
        ask: { method: 'POST', path: '/mcp/ask', description: 'Ask a question — AI searches wiki and responds' },
      },
    });
  }

  // GET /mcp/types — list all entry types with counts
  if (path === '/mcp/types' && request.method === 'GET') {
    const result = await env.DB.prepare(
      'SELECT type, COUNT(*) as count FROM entries GROUP BY type ORDER BY count DESC'
    ).all();
    return Response.json(result.results);
  }

  // POST /mcp/search — semantic search
  if (path === '/mcp/search' && request.method === 'POST') {
    const body: any = await request.json();
    const { query, type, limit = 10 } = body;

    if (!query) {
      return Response.json({ error: 'query is required' }, { status: 400 });
    }

    const filter = type ? { type } : undefined;
    const matches = await searchVectors(env, query, limit, filter);

    if (!matches || matches.length === 0) {
      return Response.json({ results: [] });
    }

    const ids = matches.map((m) => m.id);
    const placeholders = ids.map(() => '?').join(',');
    const entries = await env.DB.prepare(`SELECT * FROM entries WHERE id IN (${placeholders})`)
      .bind(...ids)
      .all<WikiEntry>();

    const results = entries.results.map((entry) => {
      let parsedContent;
      try { parsedContent = JSON.parse(entry.content); } catch { parsedContent = entry.content; }
      return {
        id: entry.id,
        type: entry.type,
        title: entry.title,
        content: parsedContent,
        tags: entry.tags,
        score: matches.find((m) => m.id === entry.id)?.score,
        created_at: entry.created_at,
      };
    });

    return Response.json({ results });
  }

  // GET /mcp/entries — list entries
  if (path === '/mcp/entries' && request.method === 'GET') {
    const url = new URL(request.url);
    const type = url.searchParams.get('type');
    const limit = parseInt(url.searchParams.get('limit') || '50');

    let query = 'SELECT * FROM entries';
    const params: any[] = [];
    if (type) { query += ' WHERE type = ?'; params.push(type); }
    query += ' ORDER BY created_at DESC LIMIT ?';
    params.push(limit);

    const result = await env.DB.prepare(query).bind(...params).all<WikiEntry>();
    const entries = result.results.map((e) => {
      let parsedContent;
      try { parsedContent = JSON.parse(e.content); } catch { parsedContent = e.content; }
      return { ...e, content: parsedContent };
    });

    return Response.json({ entries, total: entries.length });
  }

  // POST /mcp/entries — create entry
  if (path === '/mcp/entries' && request.method === 'POST') {
    const body: any = await request.json();
    const { type, title, content, tags } = body;

    if (!type || !title || !content) {
      return Response.json({ error: 'type, title, content required' }, { status: 400 });
    }

    const id = crypto.randomUUID();
    const contentStr = typeof content === 'string' ? content : JSON.stringify(content);

    await env.DB.prepare(
      'INSERT INTO entries (id, type, title, content, tags, source) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(id, type, title, contentStr, tags || null, 'mcp').run();

    await upsertVector(env, id, `${title} ${type} ${tags || ''} ${contentStr}`, { type, title });

    return Response.json({ id, type, title }, { status: 201 });
  }

  // GET /mcp/entries/:id
  const idMatch = path.match(/^\/mcp\/entries\/(.+)$/);
  if (idMatch && request.method === 'GET') {
    const entry = await env.DB.prepare('SELECT * FROM entries WHERE id = ?')
      .bind(idMatch[1]).first<WikiEntry>();
    if (!entry) return Response.json({ error: 'Not found' }, { status: 404 });

    let parsedContent;
    try { parsedContent = JSON.parse(entry.content); } catch { parsedContent = entry.content; }
    return Response.json({ ...entry, content: parsedContent });
  }

  // PUT /mcp/entries/:id
  if (idMatch && request.method === 'PUT') {
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

    await env.DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

    return Response.json({ success: true, id });
  }

  // DELETE /mcp/entries/:id
  if (idMatch && request.method === 'DELETE') {
    const id = idMatch[1];
    const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
    if (!existing) return Response.json({ error: 'Not found' }, { status: 404 });

    await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
    await deleteVector(env, id);

    return Response.json({ success: true, deleted: existing.title });
  }

  // POST /mcp/ask — ask a question, AI responds using wiki context
  if (path === '/mcp/ask' && request.method === 'POST') {
    const body: any = await request.json();
    const { question } = body;

    if (!question) {
      return Response.json({ error: 'question is required' }, { status: 400 });
    }

    const { response, toolCalls } = await runAgent(env, question, []);

    return Response.json({ answer: response, tool_calls: toolCalls });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

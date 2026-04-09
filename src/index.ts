import { Env } from './types';
import { handleEntries } from './routes/entries';
import { handleChat } from './routes/chat';
import { handleGmail } from './routes/gmail';
import { handleMcp } from './routes/mcp';
import { handleDiary } from './routes/diary';
import { handleSettings } from './routes/settings';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    try {
      // Counts endpoint — lightweight, used by frontend sidebar
      if (path === '/api/counts' && request.method === 'GET') {
        const result = await env.DB.prepare(
          'SELECT type, COUNT(*) as count FROM entries GROUP BY type'
        ).all<{ type: string; count: number }>();
        return addCors(Response.json(result.results));
      }

      // API routes
      if (path.startsWith('/api/entries')) {
        return addCors(await handleEntries(request, env, path));
      }
      if (path.startsWith('/api/chat')) {
        return addCors(await handleChat(request, env));
      }
      if (path.startsWith('/api/gmail')) {
        return addCors(await handleGmail(request, env, path));
      }
      if (path.startsWith('/api/settings')) {
        return addCors(await handleSettings(request, env, path));
      }
      if (path.startsWith('/api/diary')) {
        return addCors(await handleDiary(request, env, path));
      }
      if (path.startsWith('/api/conversations')) {
        return addCors(await handleConversations(request, env, path));
      }
      // REST API for external access
      if (path.startsWith('/mcp')) {
        return addCors(await handleMcp(request, env, path));
      }

      // Static assets handled by [assets] in wrangler.toml
      return new Response('Not Found', { status: 404 });
    } catch (err: any) {
      console.error('Error:', err);
      return addCors(Response.json({ error: err.message || 'Internal error' }, { status: 500 }));
    }
  },
};

async function handleConversations(request: Request, env: Env, path: string): Promise<Response> {
  if (request.method === 'GET') {
    // GET /api/conversations
    if (path === '/api/conversations') {
      const result = await env.DB.prepare(
        'SELECT * FROM conversations ORDER BY created_at DESC LIMIT 50'
      ).all();
      return Response.json(result.results);
    }

    // GET /api/conversations/:id
    const match = path.match(/^\/api\/conversations\/(.+)$/);
    if (match) {
      const messages = await env.DB.prepare(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at ASC'
      ).bind(match[1]).all();
      return Response.json(messages.results);
    }
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

function corsHeaders(): HeadersInit {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function addCors(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

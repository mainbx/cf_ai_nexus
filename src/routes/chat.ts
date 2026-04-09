import { Env } from '../types';
import { runAgent, buildSystemPrompt } from '../lib/agent';
import { getSetting } from './settings';

export async function handleChat(request: Request, env: Env): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { message, conversation_id, user_profile } = body;

  if (!message || typeof message !== 'string') {
    return Response.json({ error: 'message is required and must be a string' }, { status: 400 });
  }

  // Get API key from settings (D1) or env fallback
  const apiKey = await getSetting(env, 'ANTHROPIC_API_KEY');
  if (!apiKey) {
    return Response.json({
      error: 'Anthropic API key not configured. Go to Settings to add it.',
    }, { status: 400 });
  }

  let convId = conversation_id;
  if (!convId) {
    convId = crypto.randomUUID();
    await env.DB.prepare('INSERT INTO conversations (id, title) VALUES (?, ?)')
      .bind(convId, message.slice(0, 100))
      .run();
  }

  const conversationHistory: any[] = [];
  const systemPrompt = buildSystemPrompt(user_profile || null);
  const { response, toolCalls } = await runAgent(env, message, conversationHistory, { systemPrompt, apiKey });

  await env.DB.prepare(
    'INSERT INTO messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), convId, 'user', message).run();

  await env.DB.prepare(
    'INSERT INTO messages (id, conversation_id, role, content, tool_calls) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), convId, 'assistant', response, toolCalls.length > 0 ? JSON.stringify(toolCalls) : null).run();

  return Response.json({ conversation_id: convId, response, tool_calls: toolCalls });
}

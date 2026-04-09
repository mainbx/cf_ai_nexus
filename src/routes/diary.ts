import { Env, WikiEntry } from '../types';
import { summarize } from '../lib/agent';
import { upsertVector } from '../lib/embeddings';
import { getSetting } from './settings';

export async function handleDiary(request: Request, env: Env, path: string): Promise<Response> {
  // GET /api/diary — list diary entries (most recent first)
  if (path === '/api/diary' && request.method === 'GET') {
    const url = new URL(request.url);
    const limit = parseInt(url.searchParams.get('limit') || '30');

    const result = await env.DB.prepare(
      'SELECT * FROM entries WHERE type = ? ORDER BY created_at DESC LIMIT ?'
    ).bind('diary', limit).all<WikiEntry>();

    return Response.json(result.results);
  }

  // POST /api/diary/generate — AI generates today's diary summary
  if (path === '/api/diary/generate' && request.method === 'POST') {
    const body: any = await request.json();
    const date = body.date || new Date().toISOString().split('T')[0]; // YYYY-MM-DD

    // Get all entries created today (any type)
    const todayStart = `${date} 00:00:00`;
    const todayEnd = `${date} 23:59:59`;

    const todayEntries = await env.DB.prepare(
      `SELECT * FROM entries WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC`
    ).bind(todayStart, todayEnd).all<WikiEntry>();

    // Get today's conversations
    const todayMessages = await env.DB.prepare(
      `SELECT role, content FROM messages WHERE created_at BETWEEN ? AND ? ORDER BY created_at ASC LIMIT 50`
    ).bind(todayStart, todayEnd).all<{ role: string; content: string }>();

    // Check if diary entry already exists for today
    const existingDiary = await env.DB.prepare(
      `SELECT * FROM entries WHERE type = 'diary' AND title LIKE ?`
    ).bind(`%${date}%`).first<WikiEntry>();

    // Build context for the AI
    let context = `Date: ${date}\n\n`;

    if (todayEntries.results.length > 0) {
      context += `=== Entries added today (${todayEntries.results.length}) ===\n`;
      for (const entry of todayEntries.results) {
        context += `- [${entry.type}] ${entry.title}: ${entry.content.slice(0, 200)}\n`;
      }
      context += '\n';
    }

    if (todayMessages.results.length > 0) {
      context += `=== Conversations today (${todayMessages.results.length} messages) ===\n`;
      for (const msg of todayMessages.results.slice(-20)) { // Last 20 messages
        context += `${msg.role}: ${msg.content.slice(0, 150)}\n`;
      }
    }

    if (todayEntries.results.length === 0 && todayMessages.results.length === 0) {
      return Response.json({
        response: 'No activity found for today. Add some entries or chat with the AI first!',
        generated: false,
      });
    }

    // Use small model for diary — much cheaper than full agent
    const diaryPrompt = `Write a personal diary entry for ${date} based on this activity. Write in first person, be reflective. Include a mood and highlights.

Respond in this exact JSON format:
{"body":"...", "mood":"productive|relaxed|excited|reflective|busy|tired", "highlights":"highlight1, highlight2, highlight3"}

Activity:\n${context}`;

    const anthropicKey = await getSetting(env, 'ANTHROPIC_API_KEY');
    const diaryJson = await summarize(env, diaryPrompt, 'You write concise personal diary entries. Always respond with valid JSON only, no extra text.', anthropicKey);

    let diaryContent: { body: string; mood: string; highlights: string; date?: string };
    try {
      diaryContent = JSON.parse(diaryJson);
    } catch {
      diaryContent = { body: diaryJson, mood: 'productive', highlights: '' };
    }
    diaryContent.date = date;

    const title = `Diary: ${date}`;
    const contentStr = JSON.stringify(diaryContent);

    if (existingDiary) {
      // Update existing
      await env.DB.prepare("UPDATE entries SET content = ?, updated_at = datetime('now') WHERE id = ?")
        .bind(contentStr, existingDiary.id).run();
    } else {
      // Create new
      const id = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO entries (id, type, title, content, tags, source) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(id, 'diary', title, contentStr, 'diary,daily-summary', 'ai').run();

      try {
        await upsertVector(env, id, `${title} ${diaryContent.body.slice(0, 500)}`, { type: 'diary', title });
      } catch { /* Vectorize may not be available locally */ }
    }

    return Response.json({
      response: diaryContent.body,
      generated: true,
      date,
      mood: diaryContent.mood,
      entries_count: todayEntries.results.length,
      messages_count: todayMessages.results.length,
    });
  }

  // GET /api/diary/streak — get diary writing streak and stats
  if (path === '/api/diary/streak' && request.method === 'GET') {
    const diaries = await env.DB.prepare(
      `SELECT title, created_at FROM entries WHERE type = 'diary' ORDER BY created_at DESC LIMIT 365`
    ).all<{ title: string; created_at: string }>();

    // Calculate streak
    let streak = 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const diaryDates = new Set(
      diaries.results.map((d) => {
        const date = new Date(d.created_at + 'Z');
        return date.toISOString().split('T')[0];
      })
    );

    for (let i = 0; i < 365; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const dateStr = checkDate.toISOString().split('T')[0];

      if (diaryDates.has(dateStr)) {
        streak++;
      } else if (i > 0) {
        // Allow today to be missing (day isn't over yet)
        break;
      }
    }

    // Activity stats for last 7 days
    const weekAgo = new Date(today);
    weekAgo.setDate(weekAgo.getDate() - 7);
    const weekEntries = await env.DB.prepare(
      `SELECT type, COUNT(*) as count FROM entries WHERE created_at >= ? GROUP BY type`
    ).bind(weekAgo.toISOString()).all<{ type: string; count: number }>();

    return Response.json({
      streak,
      total_diaries: diaries.results.length,
      diary_dates: Array.from(diaryDates).slice(0, 30),
      week_activity: weekEntries.results,
    });
  }

  return Response.json({ error: 'Not found' }, { status: 404 });
}

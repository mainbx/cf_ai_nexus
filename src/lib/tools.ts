import { Env, WikiEntry } from '../types';
import { upsertVector, searchVectors, deleteVector } from './embeddings';

// Tool definitions for Claude API
export const TOOL_DEFINITIONS = [
  {
    name: 'create_entry',
    description:
      'Create a new entry in the personal wiki. Use this to add contacts, notes, bookmarks, emails, ideas, or any other type of information. The content field should be a JSON string with type-specific fields. For contacts: {"name","email","phone","company","notes"}. For notes: {"body"}. For bookmarks: {"url","description"}. For emails: {"from","subject","body","date"}. For ideas: {"body","status"}.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: {
          type: 'string',
          description: 'Entry type: contact, note, email, bookmark, idea, or any custom type',
        },
        title: {
          type: 'string',
          description: 'Short descriptive title for the entry',
        },
        content: {
          type: 'string',
          description: 'JSON string with structured data for this entry type',
        },
        tags: {
          type: 'string',
          description: 'Comma-separated tags for categorization',
        },
      },
      required: ['type', 'title', 'content'],
    },
  },
  {
    name: 'update_entry',
    description:
      'Update an existing wiki entry by ID. Only provide the fields you want to change. Search for the entry first if you do not know its ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The entry ID to update' },
        title: { type: 'string', description: 'New title (optional)' },
        content: { type: 'string', description: 'New content JSON string (optional)' },
        tags: { type: 'string', description: 'New tags (optional)' },
        type: { type: 'string', description: 'New type (optional)' },
      },
      required: ['id'],
    },
  },
  {
    name: 'delete_entry',
    description: 'Delete a wiki entry by ID. This is permanent. Search for the entry first to confirm the correct ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string', description: 'The entry ID to delete' },
      },
      required: ['id'],
    },
  },
  {
    name: 'search_entries',
    description:
      'Semantic search across all wiki entries. Returns the most relevant entries matching the query. Use this to find information, answer questions, or look up entries before updating/deleting them.',
    input_schema: {
      type: 'object' as const,
      properties: {
        query: { type: 'string', description: 'Search query in natural language' },
        type: { type: 'string', description: 'Filter by entry type (optional)' },
        limit: { type: 'number', description: 'Max results to return (default 5)' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_entries',
    description:
      'List recent wiki entries, optionally filtered by type. Use this to see what is in the wiki or browse entries.',
    input_schema: {
      type: 'object' as const,
      properties: {
        type: { type: 'string', description: 'Filter by entry type (optional)' },
        limit: { type: 'number', description: 'Max entries to return (default 10)' },
      },
      required: [],
    },
  },
];

function generateId(): string {
  return crypto.randomUUID();
}

// Tool executors
export async function executeTool(
  env: Env,
  toolName: string,
  input: Record<string, any>
): Promise<string> {
  switch (toolName) {
    case 'create_entry':
      return await createEntry(env, input);
    case 'update_entry':
      return await updateEntry(env, input);
    case 'delete_entry':
      return await deleteEntry(env, input);
    case 'search_entries':
      return await searchEntries(env, input);
    case 'list_entries':
      return await listEntries(env, input);
    default:
      return JSON.stringify({ error: `Unknown tool: ${toolName}` });
  }
}

async function createEntry(env: Env, input: Record<string, any>): Promise<string> {
  const id = generateId();
  const { type, title, content, tags } = input;

  await env.DB.prepare(
    'INSERT INTO entries (id, type, title, content, tags, source) VALUES (?, ?, ?, ?, ?, ?)'
  )
    .bind(id, type, title, content, tags || null, 'ai')
    .run();

  // Embed for semantic search — strip base64 file data, limit length
  let searchContent = content;
  try {
    const parsed = JSON.parse(content);
    delete parsed.fileData; // Never embed raw file data
    searchContent = JSON.stringify(parsed);
  } catch { /* content is plain text, use as-is */ }
  const searchText = `${title} ${type} ${tags || ''} ${searchContent}`.slice(0, 2000);
  await upsertVector(env, id, searchText, { type, title });

  return JSON.stringify({ success: true, id, title, type });
}

async function updateEntry(env: Env, input: Record<string, any>): Promise<string> {
  const { id, ...fields } = input;

  const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
  if (!existing) {
    return JSON.stringify({ error: 'Entry not found' });
  }

  const updates: string[] = [];
  const values: any[] = [];

  if (fields.title) { updates.push('title = ?'); values.push(fields.title); }
  if (fields.content) { updates.push('content = ?'); values.push(fields.content); }
  if (fields.tags !== undefined) { updates.push('tags = ?'); values.push(fields.tags); }
  if (fields.type) { updates.push('type = ?'); values.push(fields.type); }
  updates.push("updated_at = datetime('now')");
  values.push(id);

  await env.DB.prepare(`UPDATE entries SET ${updates.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  // Re-embed
  const updated = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
  if (updated) {
    const searchText = `${updated.title} ${updated.type} ${updated.tags || ''} ${updated.content}`;
    await upsertVector(env, id, searchText, { type: updated.type, title: updated.title });
  }

  return JSON.stringify({ success: true, id, updated_fields: Object.keys(fields) });
}

async function deleteEntry(env: Env, input: Record<string, any>): Promise<string> {
  const { id } = input;

  const existing = await env.DB.prepare('SELECT * FROM entries WHERE id = ?').bind(id).first<WikiEntry>();
  if (!existing) {
    return JSON.stringify({ error: 'Entry not found' });
  }

  await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(id).run();
  await deleteVector(env, id);

  return JSON.stringify({ success: true, deleted: existing.title });
}

async function searchEntries(env: Env, input: Record<string, any>): Promise<string> {
  const { query, type, limit = 5 } = input;
  const filter = type ? { type } : undefined;
  const matches = await searchVectors(env, query, limit, filter);

  if (!matches || matches.length === 0) {
    return JSON.stringify({ results: [], message: 'No matching entries found' });
  }

  // Fetch full entries from D1
  const ids = matches.map((m) => m.id);
  const placeholders = ids.map(() => '?').join(',');
  const entries = await env.DB.prepare(`SELECT * FROM entries WHERE id IN (${placeholders})`)
    .bind(...ids)
    .all<WikiEntry>();

  const results = entries.results.map((entry) => ({
    ...entry,
    score: matches.find((m) => m.id === entry.id)?.score,
  }));

  return JSON.stringify({ results });
}

async function listEntries(env: Env, input: Record<string, any>): Promise<string> {
  const { type, limit = 10 } = input;

  let query = 'SELECT * FROM entries';
  const params: any[] = [];

  if (type) {
    query += ' WHERE type = ?';
    params.push(type);
  }

  query += ' ORDER BY created_at DESC LIMIT ?';
  params.push(limit);

  const result = await env.DB.prepare(query).bind(...params).all<WikiEntry>();
  return JSON.stringify({ entries: result.results, total: result.results.length });
}

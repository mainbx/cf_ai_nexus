export interface Env {
  AI: Ai;
  DB: D1Database;
  VECTORIZE?: Vectorize;
  ANTHROPIC_API_KEY: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
}

export interface WikiEntry {
  id: string;
  type: string;
  title: string;
  content: string;
  tags: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Conversation {
  id: string;
  title: string | null;
  created_at: string;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: string;
  content: string;
  tool_calls: string | null;
  created_at: string;
}

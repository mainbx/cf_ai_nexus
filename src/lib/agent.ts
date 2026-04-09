import { Env } from '../types';
import { TOOL_DEFINITIONS, executeTool } from './tools';

const BASE_SYSTEM_PROMPT = `You are Nexus, an AI assistant that manages the user's personal wiki/knowledge base. You have tools to create, update, delete, search, and list entries in their wiki.

Your capabilities:
- When the user pastes raw data (contacts, notes, etc.), parse it and create structured wiki entries
- When the user asks questions, search the wiki and answer based on stored knowledge
- When the user asks to organize, edit, or delete entries, use the appropriate tools
- You can create entries of any type: contact, note, email, bookmark, idea, place, diary, or custom types

Entry content formats (JSON strings):
- Contact: {"name","email","phone","company","notes"}
- Note: {"body","category"}
- Bookmark: {"url","description"}
- Email: {"from","subject","body","date"}
- Place: {"address","city","country","description","coordinates"}
- Diary: {"body","mood","highlights","date"} — personal journal entries. Write in first person, be reflective and personal. Include mood (e.g. "productive", "relaxed", "excited"), and highlights as a comma-separated list of key moments.
- Idea: {"body","status"}

When the user pastes a large blob of data:
1. Parse it carefully to identify individual items
2. Create a separate entry for each item
3. Use appropriate types and extract all available fields
4. Report what you created

When asked to write a diary or journal entry:
- Write in first person, warm and reflective tone
- Summarize key activities, thoughts, and feelings
- Include a mood assessment
- Highlight important moments or decisions
- Tag with "diary" and the date

Always be helpful, concise, and proactive about organizing information.`;

interface ClaudeMessage {
  role: string;
  content: any;
}

interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, any>;
}

export function buildSystemPrompt(userProfile?: { name?: string; location?: string; occupation?: string } | null): string {
  let prompt = BASE_SYSTEM_PROMPT;
  if (userProfile?.name) {
    prompt += `\n\nThe user's name is ${userProfile.name}.`;
    if (userProfile.location) prompt += ` They are based in ${userProfile.location}.`;
    if (userProfile.occupation) prompt += ` They work as a ${userProfile.occupation}.`;
    prompt += ' Use this context to personalize responses.';
  }
  return prompt;
}

// Main model for complex tool-use agent tasks
const MAIN_MODEL = 'claude-sonnet-4-20250514';
// Smaller model for simple summarization (diary, email analysis)
const SMALL_MODEL = 'claude-haiku-4-20250414';

export async function runAgent(
  env: Env,
  userMessage: string,
  conversationHistory: ClaudeMessage[],
  options?: { model?: string; systemPrompt?: string; apiKey?: string }
): Promise<{ response: string; toolCalls: any[] }> {
  const messages: ClaudeMessage[] = [
    ...conversationHistory,
    { role: 'user', content: userMessage },
  ];

  const model = options?.model || MAIN_MODEL;
  const systemPrompt = options?.systemPrompt || BASE_SYSTEM_PROMPT;
  const apiKey = options?.apiKey || env.ANTHROPIC_API_KEY;
  const allToolCalls: any[] = [];
  let finalResponse = '';
  let iterations = 0;
  const MAX_ITERATIONS = 10;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const apiResponse = await callClaude(apiKey, messages, model, systemPrompt);

    // Collect text and tool_use blocks
    const textBlocks: string[] = [];
    const toolUseBlocks: ToolUseBlock[] = [];

    for (const block of apiResponse.content) {
      if (block.type === 'text') {
        textBlocks.push(block.text);
      } else if (block.type === 'tool_use') {
        toolUseBlocks.push(block);
      }
    }

    // Add assistant response to conversation (keep full content blocks for proper multi-turn)
    messages.push({ role: 'assistant', content: apiResponse.content });

    // If no tool calls, we're done — Claude gave a final text response
    if (toolUseBlocks.length === 0) {
      finalResponse = textBlocks.join('\n');
      break;
    }

    // Execute tool calls and build tool_result messages
    const toolResults: any[] = [];
    for (const toolUse of toolUseBlocks) {
      let result: string;
      try {
        result = await executeTool(env, toolUse.name, toolUse.input);
      } catch (err: any) {
        result = JSON.stringify({ error: err.message || 'Tool execution failed' });
      }

      let parsedResult: any;
      try {
        parsedResult = JSON.parse(result);
      } catch {
        parsedResult = { raw: result };
      }

      allToolCalls.push({
        tool: toolUse.name,
        input: toolUse.input,
        result: parsedResult,
      });

      toolResults.push({
        type: 'tool_result',
        tool_use_id: toolUse.id,
        content: result,
      });
    }

    // Send tool results back to Claude — ALWAYS continue the loop
    // so Claude can process the results and give a final response
    messages.push({ role: 'user', content: toolResults });
  }

  return { response: finalResponse, toolCalls: allToolCalls };
}

// Lightweight summarization — uses smaller model, no tools
export async function summarize(
  env: Env,
  prompt: string,
  systemPrompt?: string,
  apiKey?: string
): Promise<string> {
  const key = apiKey || env.ANTHROPIC_API_KEY;
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': key,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: SMALL_MODEL,
      max_tokens: 1024,
      system: systemPrompt || 'You are a concise summarizer. Be brief and direct.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  const data: any = await response.json();
  const text = data.content?.find((b: any) => b.type === 'text')?.text || '';
  return text;
}

async function callClaude(apiKey: string, messages: ClaudeMessage[], model: string, systemPrompt: string): Promise<any> {
  if (!apiKey) throw new Error('Anthropic API key not configured. Go to Settings to add it.');
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      tools: TOOL_DEFINITIONS,
      messages,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Claude API error ${response.status}: ${errorText}`);
  }

  return response.json();
}

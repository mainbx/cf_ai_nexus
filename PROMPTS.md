# AI Prompts Used During Development

This document tracks the AI-assisted prompts used while building cf_ai_nexus. I used **Claude Code** (Anthropic's AI coding tool) to accelerate implementation of my designs and ideas.

## Project Concept & Design Decisions

The idea for Nexus came from a problem I kept running into — every AI assistant I've used has no context about me. It doesn't know my contacts, my schedule, my documents, or anything personal. So when I ask it to help with something, it's starting from zero every time.

I wanted to build a personal knowledge base that an AI agent actually has access to — my contacts, notes, emails, documents, everything — so it can act as a real personal assistant. Not just a chatbot, but an agent that knows who John is when I say "email John," that can look up my doctor's address, or reference a document I stored last week. The wiki is the AI's memory.

Key decisions I made early on:
- **Claude API over Llama 3.3** — I researched Anthropic's managed agents architecture and realized Claude's native tool use would make the agent pattern much cleaner than trying to parse tool calls from Llama's output. Workers AI is still used for embeddings.
- **Agent with tools, not a chatbot** — The AI has real CRUD tools to manage the database. It can create, edit, delete, and search entries on your behalf. This makes it a personal agent, not just a Q&A bot.
- **Self-wiki as AI memory** — By storing personal info in a structured database, the AI always has context. Contacts, notes, emails, documents — all searchable and accessible to the agent when it needs to help you.
- **Multi-page layout** — Dedicated pages for contacts, notes, emails, vault, diary — like having different sections of your brain organized.
- **In-app configuration** — API keys configurable through the Settings UI. No CLI or config files needed — the app should be fully self-contained.

## Prompts & How I Used AI

### Architecture & API Research

I used Claude Code to research Cloudflare's APIs (Workers AI, Vectorize, D1) and the Claude API tool-use patterns before writing any code. This saved time reading docs and gave me working TypeScript examples to build from.

**Example prompt:** "Research how to use Cloudflare Workers AI with Llama 3.3 and embedding models — how to configure wrangler.toml, request/response formats"

I also had it pull the Anthropic managed agents blog post to understand best practices:
**Prompt:** "Check these resources for ideas: https://www.anthropic.com/engineering/managed-agents"

### Implementation

Once I had the architecture figured out, I directed Claude Code to build each component:

**Agent engine:** "Build an agent loop — Claude API call with tools, tool execution, result loop. Tools: create_entry, update_entry, delete_entry, search_entries, list_entries."

**Frontend design:** "Should be like a personal wiki with different pages for contacts, places, etc. Sidebar navigation, multi-page layout."

**Smart paste:** "Users should be able to just copy and paste randomly a large blob of contacts and the agent can format and add them to the wiki correctly."

**Daily diary:** "Add a diary feature — AI that summarizes important things of the day and makes daily notes."

**Vault:** "Add document storage for important files — limit to PNG, JPG, HEIC, PDF. Description box should be fixed size, no resize."

**MCP endpoint:** "On top of the chat, should have ability to endpoint that can be used by external AIs."

**Settings page:** "Make the Anthropic API and Gmail secrets something you have to edit in a config page — users shouldn't need .dev.vars."

### Quality & Code Review

I ran a comprehensive audit to catch bugs before submission:

**Prompt:** "Scan for bugs, errors, bad engineering, bad implementation, or dumb ideas"

This caught several critical issues I fixed:
- Agent loop was breaking when Claude returned tool calls (the most common case)
- Vault was embedding base64 file data into the vector database (wasteful)
- Counts were loading all entries client-side instead of using SQL aggregation
- Gmail OAuth had a potential XSS vulnerability
- Dead code from removed features was still in the codebase

I also added cost optimization — using Claude Haiku (smaller/cheaper model) for diary summaries and email analysis instead of running the full agent for everything.

## Agent System Prompt

The core system prompt that defines how the AI manages the wiki:

```
You are Nexus, an AI assistant that manages the user's personal wiki/knowledge base.
You have tools to create, update, delete, search, and list entries in their wiki.

Your capabilities:
- When the user pastes raw data (contacts, notes, etc.), parse it and create structured wiki entries
- When the user asks questions, search the wiki and answer based on stored knowledge
- When the user asks to organize, edit, or delete entries, use the appropriate tools

Entry content formats (JSON strings):
- Contact: {"name","email","phone","company","notes"}
- Note: {"body","category"}
- Bookmark: {"url","description"}
- Email: {"from","subject","body","date"}
- Place: {"address","city","country","description"}
- Diary: {"body","mood","highlights","date"}

When the user pastes a large blob of data:
1. Parse it carefully to identify individual items
2. Create a separate entry for each item
3. Use appropriate types and extract all available fields
4. Report what you created
```

## Tool Definitions

Five tools available to the AI agent:

1. **create_entry** — Add new wiki entries with type, title, structured content, and tags
2. **update_entry** — Edit existing entries by ID
3. **delete_entry** — Remove entries by ID
4. **search_entries** — Semantic search via Vectorize embeddings
5. **list_entries** — Browse entries with optional type/limit filter

## Development Process

1. **Research** — Studied Cloudflare APIs, Anthropic tool-use patterns, managed agents architecture
2. **Design** — Decided on personal wiki concept, Claude API for agent, multi-page SPA layout
3. **Build** — Used Claude Code to implement backend (Workers + D1 + AI) and frontend (vanilla JS SPA)
4. **Iterate** — Added features based on what I wanted: diary, vault, Gmail import, onboarding, settings
5. **Quality** — Ran code audit, fixed critical bugs, optimized API costs with model selection
6. **Deploy** — Set up Cloudflare resources (D1, Workers AI), deployed to production
7. **Document** — Wrote README with setup instructions and this PROMPTS.md

AI-assisted coding was used throughout, with my direction on what to build, how it should work, and architectural decisions.

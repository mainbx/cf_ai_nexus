# cf_ai_nexus — AI-Powered Personal Wiki

A personal knowledge base that gives your AI agent context about your life. Store your contacts, notes, emails, documents, and more — so when you ask the AI to help, it actually knows who you are, who your contacts are, and what you're working on. The AI agent has tools to create, edit, search, and organize your data, acting as a true personal assistant with memory.

**Live demo:** https://cf-ai-nexus.mainmailbx.workers.dev

## Features

- **AI Agent with Tool Use** — Claude API with native function calling. The AI can create, edit, delete, and search wiki entries on your behalf.
- **Smart Paste** — Dump a blob of contacts, notes, or any unstructured text. The AI parses and creates properly formatted entries automatically.
- **Multi-Page Wiki** — Dedicated pages for Contacts, Notes, Emails, Bookmarks, Ideas, Places, Diary, and Vault.
- **Daily Diary** — AI-generated daily summaries of your activity with mood tracking, streak counting, and highlights.
- **Document Vault** — Store and organize important documents (ID, financial, medical, legal, education). Accepts PNG, JPG, HEIC, and PDF files.
- **Gmail Integration** — OAuth2 flow to import emails. In-app walkthrough guides you through Google Cloud setup. Emails imported in parallel with AI-generated summaries.
- **REST API** — External AIs or tools can access your wiki via REST endpoints at `/mcp` — search, read, create, update entries programmatically.
- **In-App Settings** — Configure API keys (Anthropic, Gmail) directly through the Settings page. No CLI or config files needed.
- **Onboarding Flow** — First-time setup collects your name, preferences, and interests to personalize the AI experience.
- **Semantic Search** — Entries embedded via Workers AI (`bge-base-en-v1.5`) and stored in Vectorize for natural language search (when configured).

## Architecture

```
┌──────────────────────────────────────────────────┐
│              Cloudflare Worker                    │
│  ┌─────────┐  ┌──────────┐  ┌───────────────┐   │
│  │ Chat API│  │Entries API│  │  REST API     │   │
│  │ /api/*  │  │ /api/*   │  │  /mcp/*       │   │
│  └────┬────┘  └─────┬────┘  └───────┬───────┘   │
│       │             │               │            │
│  ┌────▼─────────────▼───────────────▼────────┐   │
│  │           Agent Engine                     │   │
│  │  Claude API (tool use) ←→ Tool Executors   │   │
│  │  Claude Haiku (diary/email summaries)      │   │
│  └────┬──────────┬─────────────┬─────────────┘   │
│       │          │             │                  │
│  ┌────▼──┐  ┌───▼────┐  ┌────▼──────┐           │
│  │  D1   │  │Vectorize│  │Workers AI │           │
│  │SQLite │  │ Vectors │  │Embeddings │           │
│  └───────┘  └────────┘  └───────────┘           │
│                                                  │
│  Static Assets (HTML/CSS/JS) served by Worker    │
└──────────────────────────────────────────────────┘
```

### Cloudflare Services Used

| Service | Purpose |
|---------|---------|
| **Workers** | Backend API, routing, agent orchestration |
| **Workers AI** | Text embeddings (`@cf/baai/bge-base-en-v1.5`) for semantic search |
| **Claude API** | External LLM — Sonnet for tool-use agent, Haiku for summaries |
| **D1** | SQLite database for wiki entries, conversations, messages, settings |
| **Vectorize** | Vector similarity search across wiki content (optional) |
| **Assets** | Frontend SPA hosting |

### AI Agent Tool-Use Flow

```
User: "here's my contacts: John Smith john@gmail.com 555-1234,
       Jane Doe jane@work.com 555-5678"

→ Worker receives message
→ Reads API key from D1 settings (or env fallback)
→ Calls Claude API with tools: [create_entry, search_entries, ...]
→ Claude returns: tool_use(create_entry, {type:"contact", title:"John Smith", ...})
                  tool_use(create_entry, {type:"contact", title:"Jane Doe", ...})
→ Worker executes each tool against D1 + Vectorize
→ Sends tool_result back to Claude
→ Claude responds: "I've added 2 contacts: John Smith and Jane Doe"
```

## Setup & Running

### Prerequisites

- Node.js 18+
- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/install-and-update/)
- Cloudflare account (free tier works)
- Anthropic API key ([console.anthropic.com](https://console.anthropic.com))

### 1. Clone and install

```bash
git clone https://github.com/axm0/cf_ai_nexus.git
cd cf_ai_nexus
npm install
```

### 2. Create Cloudflare resources

```bash
# Create D1 database
npx wrangler d1 create nexus-db
# Copy the database_id into wrangler.toml

# Run database migrations
npx wrangler d1 execute nexus-db --local --file=schema.sql

# (Optional) Create Vectorize index for semantic search
npx wrangler vectorize create nexus-embeddings --dimensions=768 --metric=cosine
```

### 3. Run locally

```bash
# Create .dev.vars with your API key (for local dev only)
echo "ANTHROPIC_API_KEY=sk-ant-..." > .dev.vars

npm run dev
# Opens at http://localhost:8787
```

### 4. Deploy

```bash
# Run migrations on remote DB
npx wrangler d1 execute nexus-db --remote --file=schema.sql

# Deploy
npm run deploy
```

### 5. Configure API keys

After deploying, open your app URL and go to **Settings** in the sidebar. Enter your:
- **Anthropic API Key** — required for AI features
- **Google Client ID / Secret** — optional, for Gmail import

No CLI needed for key management — everything is configurable through the app UI. Keys are stored in D1.

## REST API

External AIs or tools can access your wiki via the `/mcp` REST API:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/mcp` | GET | Service discovery — lists all endpoints |
| `/mcp/search` | POST | Semantic search: `{"query": "John's email"}` |
| `/mcp/entries` | GET | List entries: `?type=contact&limit=10` |
| `/mcp/entries/:id` | GET | Get single entry |
| `/mcp/entries` | POST | Create entry: `{"type", "title", "content"}` |
| `/mcp/entries/:id` | PUT | Update entry |
| `/mcp/entries/:id` | DELETE | Delete entry |
| `/mcp/types` | GET | List entry types with counts |
| `/mcp/ask` | POST | Ask AI a question: `{"question": "..."}` |

The app includes an **API / MCP** info page (sidebar) with full documentation and curl examples.

## Project Structure

```
cf_ai_nexus/
  src/
    index.ts              — Worker entry + router
    types.ts              — TypeScript interfaces
    routes/
      chat.ts             — AI agent chat endpoint
      entries.ts          — Wiki CRUD endpoints
      diary.ts            — Daily diary generation + stats
      gmail.ts            — Gmail OAuth + email import
      mcp.ts              — REST API for external access
      settings.ts         — In-app settings management
    lib/
      agent.ts            — Claude API agent loop + tool execution
      tools.ts            — Tool definitions + D1/Vectorize executors
      embeddings.ts       — Workers AI embedding helpers
  frontend/
    index.html            — SPA with sidebar navigation + onboarding
    app.js                — Main app logic
    style.css             — Dark theme styling
  schema.sql              — D1 database schema
  wrangler.toml           — Cloudflare bindings configuration
  package.json
  PROMPTS.md              — AI prompts used during development
```

## Gmail Integration (Optional)

The app includes a step-by-step walkthrough (sidebar > Gmail Import) that guides you through:

1. Creating a Google Cloud project
2. Enabling the Gmail API
3. Configuring OAuth consent screen (testing mode)
4. Creating OAuth credentials with redirect URI
5. Entering credentials in Settings
6. Connecting and importing emails

Emails are imported in parallel (batches of 5) and stored as wiki entries with AI-generated summaries using Claude Haiku.

## License

MIT

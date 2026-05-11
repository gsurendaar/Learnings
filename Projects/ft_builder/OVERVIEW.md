# FT Builder — Functional Test Builder

## About
AI-powered platform for generating, executing, reviewing, and auto-fixing Cypress functional tests. Uses a multi-agent LangGraph pipeline to analyze source code, generate comprehensive test suites, run them with real-time progress streaming, and automatically fix failures.

## Purpose
Automate the creation and maintenance of Cypress functional tests for React applications. Reduces manual test writing effort by analyzing component code and generating tests with proper automation IDs, assertions, and best practices.

## Features
- AI-powered Cypress test generation from source code components
- Test case suggestions with priority levels (P0/P1/P2)
- Compliance validation against testing best practices
- Real-time test execution with SSE progress streaming
- Auto-fix failing tests via LLM-powered debugging
- Multi-agent orchestration (Supervisor, Generator, Compliance agents)
- Agent trace visualization with token usage and cost estimates
- Git integration: push generated tests to branches, create PRs
- Test run history and analytics tracking
- Monaco editor for manual test fixes
- Local and remote repository support

## Tech Stack
- **Frontend:** React 19, Next.js 15 (App Router)
- **UI Library:** Ant Design 5, Monaco Editor
- **Language:** TypeScript 5
- **AI/LLM:** Anthropic Claude SDK, LangChain, LangGraph
- **Database:** SQLite (better-sqlite3) for test data, MySQL for analytics
- **GitHub Integration:** Octokit REST
- **Real-time:** Server-Sent Events (SSE)
- **Build Tool:** Turbopack

## How to Run
```bash
# Copy environment config
cp .env.example .env.local
# Fill in: ANTHROPIC_API_KEY, GITHUB_TOKEN

# Install dependencies
npm install

# Start development server (port 3211)
npm run dev

# Production build
npm run build && npm start
```

## Environment Variables
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | LLM API key for test generation and fixing |
| `ANTHROPIC_BASE_URL` | LLM API endpoint |
| `ANTHROPIC_MODEL` | Default model (e.g., claude-sonnet-4.5) |
| `GITHUB_TOKEN` | GitHub PAT for repo access |
| `GITHUB_BASE_URL` | GitHub API base |
| `GITHUB_OWNER` | Default repo owner |
| `GITHUB_REPO` | Default repo name |
| `DB_HOST/USER/PASSWORD/NAME/PORT` | MySQL connection (optional, for analytics) |
| `PORT` | App port (default: 3211) |

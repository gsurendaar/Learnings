# Review SparkX — Code Review

## About
AI-powered code review platform that analyzes pull requests and commits, providing detailed quality scores, best practice assessments, and actionable suggestions. Reviews can be posted directly as GitHub PR comments.

## Purpose
Automate code review for PRs and commits using LLM analysis to deliver consistent, thorough, four-dimensional quality scoring — covering code quality, best practices, maintainability, and impact analysis.

## Features
- PR and commit review with AI-powered analysis
- Four-dimensional scoring: Code Quality, Best Practices, Maintainability, Impact Analysis
- Multi-model support (Claude Opus/Sonnet/Haiku, GPT-4, custom endpoints)
- Custom review instructions per analysis
- Post review summaries directly to GitHub PRs as comments
- Persistent report storage (JSON) with search and filter
- Review tracking and history via MySQL database
- Dark/light theme support with 4 theme options

## Tech Stack
- **Frontend:** React 19, Next.js 15 (App Router)
- **UI Library:** Ant Design 5
- **Language:** TypeScript 5
- **Database:** MySQL (via mysql2)
- **GitHub Integration:** Octokit REST
- **LLM Integration:** Raw HTTP to Claude API / OpenAI-compatible endpoints
- **Build Tool:** Turbopack

## How to Run
```bash
# Copy environment config
cp .env.example .env.local
# Fill in: ANTHROPIC_API_KEY, GITHUB_TOKEN, DB_HOST/USER/PASSWORD/NAME

# Install dependencies
npm install

# Start development server (port 3210)
npm run dev

# Production build
npm run build && npm start
```

## Environment Variables
| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | LLM API key for code analysis |
| `ANTHROPIC_BASE_URL` | LLM API endpoint (defaults to Anthropic) |
| `GITHUB_TOKEN` | GitHub PAT for PR/commit access |
| `GITHUB_BASE_URL` | GitHub API base (github.com or enterprise) |
| `GITHUB_OWNER` | Default repo owner |
| `GITHUB_REPO` | Default repo name |
| `DB_HOST/USER/PASSWORD/NAME/PORT` | MySQL connection |
| `PORT` | App port (default: 3210) |

# FT Builder — Technical Documentation

## Architecture
Multi-agent Next.js 15 application with a LangGraph pipeline orchestrating test generation, execution, and auto-fixing. The frontend uses React 19 with Ant Design 5 and communicates with server-side API routes via REST and SSE streaming.

```
Browser ←SSE→ Next.js API Routes → LangGraph Pipeline
                    ↓                      ↓
              GitHub API           Agent Orchestration
                    ↓              ┌───────┼───────┐
              Clone/Push       Supervisor  Generator  Compliance
                    ↓                      ↓
              SQLite DB            LLM API (Claude)
```

## Folder Structure
```
ft_builder/
├── src/
│   ├── app/
│   │   ├── layout.tsx                        # Root layout with providers
│   │   ├── page.tsx                          # Home page with feature cards
│   │   ├── globals.css                       # CSS variables
│   │   ├── api/
│   │   │   └── ft-runner/                    # 29 API endpoints
│   │   │       ├── trigger/route.ts          # Start test run
│   │   │       ├── stream/route.ts           # SSE real-time events
│   │   │       ├── generate/route.ts         # Start test generation
│   │   │       ├── generate/status/route.ts  # Poll generation status
│   │   │       ├── suggestions/route.ts      # Test case suggestions
│   │   │       ├── results/route.ts          # Test results
│   │   │       ├── fix/route.ts              # Auto-fix failing tests
│   │   │       ├── create-pr/route.ts        # Create GitHub PR
│   │   │       ├── ensure-repo/route.ts      # Clone/setup repo
│   │   │       ├── browse-repo/route.ts      # Browse repo files
│   │   │       ├── traces/route.ts           # Agent trace data
│   │   │       └── ... (18 more endpoints)
│   │   ├── features/
│   │   │   ├── layout.tsx
│   │   │   ├── ft-runner/
│   │   │   │   ├── page.tsx                  # FT Runner UI
│   │   │   │   ├── layout.tsx
│   │   │   │   └── components/
│   │   │   │       ├── RepoSelector.tsx
│   │   │   │       ├── TestTreeSelector.tsx
│   │   │   │       ├── RunConfigPanel.tsx
│   │   │   │       ├── RunProgress.tsx
│   │   │   │       ├── RunResults.tsx
│   │   │   │       ├── FixEditor.tsx
│   │   │   │       ├── FolderPickerModal.tsx
│   │   │   │       ├── RunHistory.tsx
│   │   │   │       └── ScreenshotGallery.tsx
│   │   │   └── auto-ft-builder/
│   │   │       └── page.tsx
│   │   └── ftbuilder/
│   │       ├── page.tsx                      # Main FT Builder (accordion)
│   │       ├── layout.tsx
│   │       ├── initialize/page.tsx           # Credential setup
│   │       ├── [sessionId]/page.tsx          # Session workspace
│   │       └── components/
│   │           ├── CreateFTPanel.tsx          # Step 1: Generate tests
│   │           ├── RunFTPanel.tsx             # Step 2: Execute tests
│   │           ├── ReviewFTPanel.tsx          # Step 3: Review & push
│   │           ├── AgentTracesPanel.tsx       # Step 4: Agent traces
│   │           └── SuggestionsTable.tsx       # Suggestion review
│   ├── components/                            # Shared UI components
│   │   ├── ModernHeader.tsx
│   │   ├── SubHeader.tsx
│   │   ├── ThemeProvider.tsx
│   │   ├── InitializationContext.tsx
│   │   ├── UserContext.tsx
│   │   ├── CredentialGate.tsx
│   │   ├── AgentTracesPanel.tsx              # Shared traces viewer
│   │   └── ... (FeatureCard, ModernCard, StatsCard)
│   ├── config/
│   │   ├── features.ts                       # Feature registry (FT only)
│   │   ├── env.ts, access.ts, app.ts
│   ├── hooks/
│   │   ├── useUser.ts
│   │   ├── useSSE.ts                         # SSE streaming hook
│   │   └── useSessionState.ts                # Session persistence
│   ├── lib/
│   │   ├── database.ts                       # MySQL pool
│   │   └── ftDatabase.ts                     # SQLite for FT data
│   ├── services/
│   │   ├── ftGenerator.ts                    # Test code generation
│   │   ├── ftRunner.ts                       # Test execution orchestration
│   │   ├── ftFixer.ts                        # Auto-fix via LLM
│   │   ├── ftComplianceValidator.ts          # Best practice validation
│   │   ├── ftSuggestions.ts                  # Test case suggestions
│   │   ├── ftSetup.ts                        # Repo setup/cloning
│   │   ├── ftWorker.ts                       # Parallel worker management
│   │   ├── ftGraph.ts                        # LangGraph state machine
│   │   ├── github.ts                         # GitHub API client
│   │   ├── agents/
│   │   │   ├── BaseAgent.ts
│   │   │   ├── GeneratorAgent.ts
│   │   │   └── SupervisorAgent.ts
│   │   └── langgraph/
│   │       ├── llm.ts                        # LLM client initialization
│   │       └── prompts/
│   │           ├── ftGeneration.ts
│   │           ├── ftSuggestions.ts
│   │           ├── ftCompliance.ts
│   │           ├── ftSupervisor.ts
│   │           ├── ftTriage.ts
│   │           ├── fixGeneration.ts
│   │           ├── setupAgent.ts
│   │           ├── supervisorAgent.ts
│   │           └── controllerAgent.ts
│   └── types/
│       ├── ft.ts                             # FT types and constants
│       ├── git.ts
│       └── database.ts
├── data/
│   └── ft-knowledge-base/                    # Reference test patterns
│       ├── FUNCTIONAL_TESTING_GUIDE.md
│       ├── p0-p1-use-cases.md
│       └── golden-suite/                     # Example Cypress tests
├── public/
├── database/schema.sql
├── scripts/run-ft.sh
├── package.json
├── next.config.ts
├── tsconfig.json
└── .env.example
```

## Key Components

### Multi-Agent Pipeline
- **SupervisorAgent** — Analyzes test failures, decides on fix strategy (test issue vs app bug), coordinates retries
- **GeneratorAgent** — Generates Cypress test code from component analysis using LLM prompts and golden-suite examples
- **ComplianceValidator** — Validates generated tests against standards (automation IDs, error handling, assertions)
- **ftGraph** — LangGraph state machine orchestrating the Generate → Run → Fix pipeline

### FT Builder UI (Accordion Panels)
1. **CreateFTPanel** — Select component folders, get AI suggestions, generate tests
2. **RunFTPanel** — Execute tests with real-time SSE streaming, agent status tracking
3. **ReviewFTPanel** — Review generated files, select branch, push to Git / create PR
4. **AgentTracesPanel** — View LLM call traces, token usage, latency, cost estimates

## State Management
- **React Context API** — UserProvider, InitializationProvider, ThemeProvider
- **useSessionState** — Persists panel state to sessionStorage (keyed by sessionId)
- **useSSE** — Manages SSE connection for real-time test execution updates
- **In-memory** — ftRunner service maintains active runs in memory

## API Integration
29 API routes under `/api/ft-runner/`:
- **Execution:** trigger, stream (SSE), status, cancel, results
- **Generation:** generate, generate/status, suggestions
- **Repository:** repos, branches, ensure-repo, local-branches, local-tree
- **Files:** file, browse-repo, browse-folders, list-subfolders, artifacts, tree
- **Git:** create-pr, upload-project
- **Utilities:** cleanup, confirm, history, analytics, traces, clones, chat-smith, fix

## Database
- **SQLite** (`data/ft-runner.db`) — Test runs, sessions, results, artifacts, traces, analytics
- **MySQL** (optional) — Analytics and cross-user tracking

## Styling
Ant Design 5 with custom theme system (Corporate, Modern, Ocean, Dark themes).
Monaco Editor for code viewing and manual test fixes.

## Deployment
```bash
npm run build    # Next.js production build
npm start        # Starts on port 3211
```
Requires Anthropic API key and GitHub PAT. SQLite database auto-creates on first run.

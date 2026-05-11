# Review SparkX — Technical Documentation

## Architecture
Next.js 15 App Router application with server-side API routes that invoke the `SparkxReviewService` for LLM-powered code analysis. The frontend uses React 19 with Ant Design 5 components, managed through context providers for authentication, credentials, and theming.

```
Browser → Next.js API Routes → SparkxReviewService → LLM API (Claude/GPT)
                                       ↓
                              GitHub API (Octokit)
                                       ↓
                              MySQL (review tracking)
```

## Folder Structure
```
codereview/
├── src/
│   ├── app/
│   │   ├── layout.tsx                     # Root layout with providers
│   │   ├── page.tsx                       # Home page with feature card
│   │   ├── globals.css                    # CSS variables
│   │   ├── api/
│   │   │   └── review-sparkx/
│   │   │       ├── route.ts               # Main review endpoint (POST)
│   │   │       ├── initialize/route.ts    # Credential validation
│   │   │       ├── pull/route.ts          # Git pull from upstream
│   │   │       ├── models/route.ts        # Available LLM models
│   │   │       ├── tracking/route.ts      # Review tracking (GET/POST)
│   │   │       ├── reports/route.ts       # List saved reports
│   │   │       ├── reports/[fileName]/route.ts  # Get specific report
│   │   │       └── post-to-github/route.ts      # Post review to PR
│   │   └── features/
│   │       ├── layout.tsx                 # Features layout wrapper
│   │       └── review-sparkx/
│   │           ├── page.tsx               # Main review UI
│   │           ├── initialize/page.tsx    # Credential setup
│   │           └── reports/page.tsx       # Reports viewer
│   ├── components/
│   │   ├── ModernHeader.tsx               # Navigation header
│   │   ├── SubHeader.tsx                  # Page title + breadcrumbs
│   │   ├── ThemeProvider.tsx              # Theme context (4 themes)
│   │   ├── InitializationContext.tsx      # Credential management
│   │   ├── UserContext.tsx                # SAML user context
│   │   ├── CredentialGate.tsx             # Credential entry modal
│   │   ├── FeatureCard.tsx                # Feature showcase card
│   │   ├── ModernCard.tsx                 # Themed card wrapper
│   │   └── StatsCard.tsx                  # Metric display card
│   ├── config/
│   │   ├── features.ts                    # Feature registry
│   │   ├── env.ts                         # Environment config
│   │   ├── access.ts                      # User access control
│   │   └── app.ts                         # App-level config
│   ├── hooks/
│   │   └── useUser.ts                     # User info hook
│   ├── lib/
│   │   └── database.ts                    # MySQL connection pool
│   ├── services/
│   │   ├── sparkxReview.ts                # Core review service (1,473 lines)
│   │   └── github.ts                      # GitHub API client
│   └── types/
│       ├── git.ts                         # Git/GitHub types
│       └── database.ts                    # DB types
├── public/                                # Static assets (SVGs)
├── database/
│   └── schema.sql                         # MySQL schema
├── package.json
├── next.config.ts
├── tsconfig.json
└── .env.example
```

## Key Components
- **SparkxReviewService** (`src/services/sparkxReview.ts`) — Core orchestration: fetches PR/commit data from GitHub, reads local repo files for context, calls LLM for analysis, parses responses, saves reports, and posts to GitHub
- **ModernHeader** — Sticky navigation with feature links, theme selector, user menu, and settings modal for credential management
- **InitializationContext** — Manages LLM API key and GitHub PAT in localStorage, validates via API
- **CredentialGate** — Blocks app access until credentials are provided

## State Management
- **React Context API** with three providers (wrapped in root layout):
  1. `UserProvider` — SAML-authenticated user identity
  2. `InitializationProvider` — LLM + GitHub credentials (localStorage)
  3. `ThemeProvider` — Theme selection (localStorage)
- **Component state** — Review form inputs, loading states, results display

## API Integration
8 API routes under `/api/review-sparkx/`:
- `POST /api/review-sparkx` — Run a review (PR number or commit SHA)
- `POST /api/review-sparkx/initialize` — Validate and store credentials
- `POST /api/review-sparkx/pull` — Git pull sparkxnodeweb repo
- `GET /api/review-sparkx/models` — Fetch available LLM models
- `GET/POST /api/review-sparkx/tracking` — Review tracking history
- `GET /api/review-sparkx/reports` — List all saved report files
- `GET /api/review-sparkx/reports/[fileName]` — Get specific report
- `POST /api/review-sparkx/post-to-github` — Post review as PR comment

## Styling
Ant Design 5 with custom theme system supporting 4 themes:
- Corporate (blue), Modern (purple), Ocean (cyan), Dark
- Theme persisted to localStorage, applied via ConfigProvider

## Database
MySQL for review tracking (`review_tracking` table):
- Fields: username, pr_number, commit_id, model_name, review_score, files_scanned, report_location, submission_date

## Deployment
```bash
npm run build    # Next.js production build
npm start        # Starts on port 3210
```
Requires MySQL database and valid LLM API key + GitHub PAT.

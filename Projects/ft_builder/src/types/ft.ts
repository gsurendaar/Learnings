// FT Management System Types

// ============= Create FT Types =============
export interface ComponentFolder {
  name: string;
  path: string;
  componentCount: number;
  subFolders?: ComponentFolder[];
  icon?: string;
}

export interface FTGenerationConfig {
  sourcePath: string;
  outputFolder: string;
  testType: 'unit' | 'e2e' | 'integration';
  includeFixtures: boolean;
  templateType: 'basic' | 'comprehensive';
}

export interface GenerationResult {
  success: boolean;
  generatedFiles: string[];
  outputPath: string;
  errors?: string[];
  warnings?: string[];
  timestamp: Date;
}

export interface GenerateRequest {
  filePath?: string;
  selectedFolders?: string[];
  outputFolderName: string;
  options?: {
    overwrite?: boolean;
    includeFixtures?: boolean;
    templateType?: 'basic' | 'comprehensive';
  };
}

// ============= FT Suggestions Types =============
export type SuggestionPriority = 'P0' | 'P1' | 'P2';
export type SuggestionTenant = 'PayPal' | 'Venmo' | 'Both';

export type SuggestionType = 'single' | 'composite';

export interface FTSuggestion {
  id: string;
  title: string;
  description: string;
  priority: SuggestionPriority;
  tenant: SuggestionTenant;
  category: string;
  sourceFile: string;
  specFileName: string;
  selected: boolean;
  exists?: boolean;
  type?: SuggestionType;
  compositeSources?: string[];
}

export interface ManualUseCase {
  id: string;
  description: string;
}

export interface SuggestionsRequest {
  selectedFolders: string[];
  manualPaths: string[];
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel?: string;
  githubToken?: string;
}

export interface SuggestionsResponse {
  suggestions: FTSuggestion[];
  sourceFiles: string[];
  totalSourceFiles: number;
}

// ============= FT Compliance Types =============
export type ComplianceSeverity = 'error' | 'warning' | 'info';

export interface ComplianceCheck {
  rule: string;
  passed: boolean;
  severity: ComplianceSeverity;
  message: string;
}

export interface ComplianceResult {
  testPath: string;
  passed: boolean;
  score: number;
  checks: ComplianceCheck[];
}

// ============= Run FT Types =============
export interface FTTreeNode {
  key: string;
  title: string;
  path: string;
  isFolder: boolean;
  children?: FTTreeNode[];
  testCount?: number;
  lastRun?: Date;
  lastStatus?: 'passed' | 'failed' | 'pending' | 'not_run';
  duration?: number;
}

export interface RunConfig {
  testFiles: string[];
  runMode: 'headless' | 'headed';
  browser: 'chrome' | 'firefox' | 'electron' | 'edge';
  parallel?: boolean;
  record?: boolean;
  retries?: number;
}

export interface RetryAttempt {
  attempt: number;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  error?: string;
  duration: number;
}

export interface TestResult {
  file: string;
  testName: string;
  status: 'passed' | 'failed' | 'skipped' | 'pending';
  duration: number;
  error?: string;
  screenshots?: string[];
  video?: string;
  attempts?: number;
  retryAttempts?: RetryAttempt[];
}

export interface RunResult {
  jobId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  totalTests: number;
  passed: number;
  failed: number;
  skipped: number;
  pending: number;
  duration: number;
  startTime: Date;
  endTime?: Date;
  results: TestResult[];
  browser: string;
  runMode: string;
}

export interface RunRequest {
  testFiles: string[];
  options?: {
    headed?: boolean;
    browser?: string;
    retries?: number;
  };
}

// ============= Review FT Types =============
export interface ReviewableFT {
  path: string;
  fileName: string;
  status: 'new' | 'modified' | 'unchanged' | 'deleted';
  lastModified: Date;
  lastRunStatus?: 'passed' | 'failed' | 'not_run';
  diff?: string;
  additions?: number;
  deletions?: number;
  size?: number;
}

export interface Branch {
  name: string;
  isRemote: boolean;
  isCurrent: boolean;
  lastCommit: string;
  lastCommitMessage?: string;
  updatedAt: Date;
  author?: string;
}

export interface PushResult {
  success: boolean;
  commitSha?: string;
  branch: string;
  filesCommitted: number;
  error?: string;
  prUrl?: string;
}

export interface PushRequest {
  files: string[];
  branch: string;
  commitMessage: string;
  createPR?: boolean;
  prTitle?: string;
  prDescription?: string;
}

// ============= Common Types =============
export interface FTStats {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  pendingTests: number;
  coverage?: number;
  lastRunDate?: Date;
  avgDuration?: number;
}

export interface ConsoleFolder {
  name: string;
  path: string;
  description: string;
  componentsCount: number;
  existingTests: number;
}

export const CONSOLE_FOLDERS: ConsoleFolder[] = [
  { name: 'account', path: 'components/console/account', description: 'Account management components', componentsCount: 12, existingTests: 3 },
  { name: 'case', path: 'components/console/case', description: 'Case handling components', componentsCount: 18, existingTests: 5 },
  { name: 'customer-journey', path: 'components/console/customer-journey', description: 'Customer journey tracking', componentsCount: 8, existingTests: 2 },
  { name: 'Escalations', path: 'components/console/Escalations', description: 'Escalation management', componentsCount: 6, existingTests: 1 },
  { name: 'followups', path: 'components/console/followups', description: 'Follow-up tracking', componentsCount: 10, existingTests: 4 },
  { name: 'home', path: 'components/console/home', description: 'Home page components', componentsCount: 15, existingTests: 6 },
  { name: 'quick-tools', path: 'components/console/quick-tools', description: 'Quick access utilities', componentsCount: 9, existingTests: 2 },
  { name: 'workflows', path: 'components/console/workflows', description: 'Workflow management', componentsCount: 14, existingTests: 3 },
];


export const CYPRESS_E2E_FOLDERS = [
  'home',
  'home/accountsearch',
  'home/escalation-search',
  'home/follow-ups',
  'non-workflows',
  'quick-tools',
  'workflows',
];

export const BROWSERS = [
  { value: 'chrome', label: 'Chrome', icon: '🌐' },
  { value: 'firefox', label: 'Firefox', icon: '🦊' },
  { value: 'electron', label: 'Electron', icon: '⚡' },
  { value: 'edge', label: 'Edge', icon: '🔷' },
];

export const RUN_MODES = [
  { value: 'headless', label: 'Headless', description: 'Run without browser UI (faster)' },
  { value: 'headed', label: 'Headed', description: 'Run with browser UI (for debugging)' },
];

// ============= Remote FT Runner Types =============

export interface FTRunConfig {
  owner: string;
  repo: string;
  branch: string;
  specPattern: string;
  testFiles: string[];
  browser: string;
  retries: number;
  runMode: 'headless' | 'headed';
  workerCount: number;  // 1 = sequential, 2-4 = parallel workers
  triggeredBy: string;
  githubToken: string;
  skipSetup?: boolean;        // true = reuse existing clone, skip clone/install
  existingWorkDir?: string;   // path to existing clone directory when skipSetup=true
  fixMode?: 'execute-only' | 'auto-fix' | 'manual-fix';
  maxFixAttempts?: number;        // max LLM fix loop iterations (default 10 run-only, 3 generate-validate)
  maxComplianceFixes?: number;    // max compliance fix attempts (default 2)
  userId?: string;                // PayPal user ID for per-user clone isolation
  keepServerAlive?: boolean;      // keep dev server alive in pool after run (default false)
  // LLM credentials for auto-fix (optional — fix node skips if absent)
  llmApiKey?: string;
  llmBaseUrl?: string;
  llmModel?: string;
}

export interface FTRunStep {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  duration?: number;
  error?: string;
}

export interface FTRunStatus {
  runId: string;
  status: 'queued' | 'cloning' | 'installing' | 'starting' | 'running' | 'completed' | 'failed';
  currentStep?: string;
  startedAt: string;
  elapsed: number;
  steps: FTRunStep[];
  conclusion?: 'success' | 'failure' | 'cancelled';
}

export type SSEEventType =
  | 'step:start'
  | 'step:complete'
  | 'step:error'
  | 'test:pass'
  | 'test:fail'
  | 'test:results'
  | 'test:summary'
  | 'run:start'
  | 'run:complete'
  | 'run:results'
  | 'run:error'
  | 'run:not_found'
  | 'connected'
  | 'log'
  // Supervisor ↔ Generator agent communication events
  | 'supervisor:analyzing'      // Supervisor starts analyzing test failures
  | 'supervisor:failure'        // Details of a specific test failure
  | 'supervisor:requesting-fix' // Supervisor asks Generator to fix a test
  | 'supervisor:summary'        // Iteration summary with pass/fail counts
  | 'generator:fixing'          // Generator is regenerating a failing test
  | 'generator:fixed'           // Generator finished fixing a test
  | 'generator:progress'        // Generator progress during initial generation
  | 'gen:complete'
  // Fix events
  | 'fix:start'
  | 'fix:analyzing'
  | 'fix:applied'
  | 'fix:complete'
  | 'fix:error'
  | 'fix:user-confirm'
  | 'fix:manual-required'
  // Multi-agent parallel execution events
  | 'agent:start'           // Agent begins for a specific file
  | 'agent:test-running'    // Cypress test executing
  | 'agent:test-passed'     // Test passed
  | 'agent:test-failed'     // Test failed
  | 'agent:compliance'      // Compliance check result
  | 'agent:fixing'          // Analyzing + applying fix
  | 'agent:retry'           // Starting retry attempt
  | 'agent:done'            // Agent finished (pass or max retries)
  | 'agent:summary';        // Supervisor aggregate counts

export interface SSEEvent {
  type: SSEEventType;
  timestamp: number;
  step?: string;
  duration?: number;
  file?: string;
  testName?: string;
  error?: string;
  message?: string;
  conclusion?: 'success' | 'failure';
  total?: number;
  passed?: number;
  failed?: number;
  // Agent-specific fields
  running?: number;
  retryCount?: number;
  complianceScore?: number;
  currentAction?: string;
  agentStatus?: AgentFileStatus;
}

// ============= Multi-Agent Execution Types =============

export type AgentFileStatusType = 'queued' | 'running' | 'passed' | 'failed';

export interface AgentFileStatus {
  file: string;
  status: AgentFileStatusType;
  currentAction: string;
  retryCount: number;
  complianceScore: number | null;
  error?: string;
  failureReason?: string;
}

export interface MultiAgentRunRequest {
  testFiles: string[];
  browser: string;
  runMode: 'headless' | 'headed';
  retries: number;
  maxRetries: number;
}

// ============= Fix Types =============

export interface FixDiagnosis {
  issueType: 'test' | 'missing-testid' | 'app-logic';
  failedFile: string;
  errorMessage: string;
  suggestedFixes?: Array<{ filePath: string; newContent: string }>;
  diagnosticInfo: string;
  screenshot?: string;
}

export interface GitTreeItem {
  path: string;
  mode: string;
  type: 'blob' | 'tree';
  sha: string;
  size?: number;
}

export interface FTRunRecord {
  id: number;
  run_id: string;
  owner: string;
  repo: string;
  branch: string;
  spec_pattern: string;
  browser: string;
  retries: number;
  triggered_by: string;
  status: string;
  conclusion: string | null;
  total_specs: number;
  passed_specs: number;
  failed_specs: number;
  duration_ms: number;
  artifacts_dir: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export const SPEC_SUITES: Record<string, { label: string; pattern: string; description: string }> = {
  'lla': { label: 'LLA - All', pattern: 'cypress/e2e/workflows/low-level-authentication/**/*.cy.ts', description: 'All low-level authentication tests' },
  'lla-regular': { label: 'LLA - Regular', pattern: 'cypress/e2e/workflows/low-level-authentication/regular-lla-verification/*.cy.ts', description: 'Regular LLA verification' },
  'lla-pda': { label: 'LLA - PDA', pattern: 'cypress/e2e/workflows/low-level-authentication/pda-case-creation/*.cy.ts', description: 'PDA case creation' },
  'payment-decline': { label: 'Payment Decline', pattern: 'cypress/e2e/workflows/payment-decline/**/*.cy.ts', description: 'Payment decline workflow tests' },
  'intent-selection': { label: 'Intent Selection', pattern: 'cypress/e2e/workflows/intent-selection/**/*.cy.ts', description: 'Intent selection tests' },
  'disputes': { label: 'Disputes', pattern: 'cypress/e2e/workflows/disputes/**/*.cy.ts', description: 'Disputes workflow tests' },
  'manage-address': { label: 'Manage Address', pattern: 'cypress/e2e/workflows/manage-address/**/*.cy.ts', description: 'Manage address tests' },
  'all': { label: 'All Tests', pattern: 'cypress/e2e/workflows/**/*.cy.ts', description: 'All workflow tests' },
};

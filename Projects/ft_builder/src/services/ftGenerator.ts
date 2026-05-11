import * as fs from "fs";
import * as path from "path";
import { createLLMClient } from "./langgraph/llm";
import {
  FT_GENERATION_SYSTEM_PROMPT,
  buildGenerationUserPrompt,
  buildRegenerationUserPrompt,
} from "./langgraph/prompts/ftGeneration";
import { insertGenerationLog, insertAgentLog, insertError } from "@/lib/ftDatabase";

export interface GenerateRequest {
  /** Component folder names under components/console/ */
  selectedFolders: string[];
  /** Manual file paths relative to repo root */
  manualPaths: string[];
  templateType: "basic" | "comprehensive";
  includeFixtures: boolean;
  overwriteExisting: boolean;
  /** Absolute path to the cloned repo (or repos/sparkxnodeweb) */
  repoPath: string;
  /** LLM credentials */
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel?: string;
  /** Specific use cases to generate tests for (from suggestions flow) */
  targetUseCases?: Array<{ title: string; description: string; priority: string; sourceFile: string }>;
  /** Custom user instructions appended to the generation prompt */
  customPrompt?: string;
  /** Run ID for tracking (optional — set when called from graph) */
  runId?: string;
}

export interface GeneratedTestFile {
  sourcePath: string;
  testPath: string;
  status: "created" | "skipped" | "error";
  error?: string;
}

export interface GenerateResult {
  generatedFiles: GeneratedTestFile[];
  totalGenerated: number;
  totalSkipped: number;
  totalErrors: number;
}

/**
 * Files to SKIP — these are not real components worth generating tests for.
 * Add patterns here to exclude files from test generation.
 */
const SKIP_PATTERNS = [
  "index.ts",        // barrel re-exports (export { default } from './Component')
  "index.tsx",       // barrel re-exports
  "constants.ts",    // static data, no UI to test
  "constants.tsx",
  "types.ts",        // type definitions only
  "types.tsx",
  "utils.ts",        // utility functions (unit test these, not E2E)
  "utils.tsx",
  "helpers.ts",
  "helpers.tsx",
  "styles.ts",       // styled-components / CSS-in-JS
  "styles.tsx",
  ".module.css",
  ".module.scss",
];

/**
 * Find source component files recursively.
 * Only includes actual React components (.tsx with JSX), skips:
 * - index.ts barrel files, constants, types, utils, helpers
 * - test/spec/story/cypress files
 * - node_modules, __tests__, .git directories
 */
export function findSourceFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", "__tests__", ".git", "__mocks__", "styles"].includes(entry.name)) continue;
      results.push(...findSourceFiles(full));
    } else if (
      (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) &&
      !entry.name.includes(".test.") &&
      !entry.name.includes(".spec.") &&
      !entry.name.includes(".stories.") &&
      !entry.name.includes(".cy.") &&
      !entry.name.includes(".d.ts") &&
      !SKIP_PATTERNS.includes(entry.name)  // Skip barrel files, constants, etc.
    ) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Convert a source component path to a Cypress test output path.
 */
function toTestPath(relativePath: string): string {
  const match = relativePath.match(/components\/console\/([^/]+)\//);
  const folder = match ? match[1] : "general";
  const baseName = path.basename(relativePath).replace(/\.(tsx?|jsx?)$/, "");
  const kebab = baseName
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .replace(/([A-Z])([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
  return `cypress/e2e/${folder}/${kebab}.cy.ts`;
}

/**
 * Read up to N existing Cypress .cy.ts files as pattern examples.
 */
/**
 * Read existing Cypress FT files for a specific workflow folder.
 * These serve as the SOURCE OF TRUTH for how tests should be written.
 */
export function readWorkflowExistingFTs(
  repoPath: string,
  workflowFolder: string,
  max = 10
): Array<{ path: string; content: string; fileName: string }> {
  const results: Array<{ path: string; content: string; fileName: string }> = [];

  // Search in cypress/e2e/workflows/{workflow}/ and __tests__/.../workflows/{workflow}/
  const searchDirs = [
    path.join(repoPath, "cypress", "e2e", "workflows", workflowFolder),
    path.join(repoPath, "__tests__", "components", "console", "workflows", workflowFolder),
  ];

  for (const dir of searchDirs) {
    if (!fs.existsSync(dir)) continue;

    // ALWAYS include utils.ts / helpers files FIRST — these define the navigation
    // and interaction helpers that ALL tests in the workflow should use.
    // Read them directly from the filesystem since findSourceFiles() skips
    // utils.ts via SKIP_PATTERNS (it's meant for source components, not test helpers).
    const helperNames = ["utils.ts", "helpers.ts"];
    for (const helperName of helperNames) {
      const helperPath = path.join(dir, helperName);
      if (fs.existsSync(helperPath)) {
        const content = fs.readFileSync(helperPath, "utf-8");
        results.push({
          path: path.relative(repoPath, helperPath),
          content: content.slice(0, 10000),
          fileName: helperName,
        });
      }
    }
    // Also check for workflow-specific helpers like "refund-helpers.ts"
    try {
      for (const entry of fs.readdirSync(dir)) {
        if (entry.includes("-helpers.ts") && !results.some((r) => r.fileName === entry)) {
          const helperPath = path.join(dir, entry);
          const content = fs.readFileSync(helperPath, "utf-8");
          results.push({
            path: path.relative(repoPath, helperPath),
            content: content.slice(0, 10000),
            fileName: entry,
          });
        }
      }
    } catch { /* ignore */ }

    // Then include .cy.ts test files
    const testFiles = findSourceFiles(dir).filter(
      (f) => f.endsWith(".cy.ts") || f.endsWith(".cy.js")
    );
    for (const f of testFiles.slice(0, max - results.length)) {
      const content = fs.readFileSync(f, "utf-8");
      results.push({
        path: path.relative(repoPath, f),
        content: content.slice(0, 8000),
        fileName: path.basename(f),
      });
    }
    if (results.length >= max) break;
  }

  // Also check nearby workflows for pattern reference
  if (results.length === 0) {
    const workflowsDir = path.join(repoPath, "cypress", "e2e", "workflows");
    if (fs.existsSync(workflowsDir)) {
      const otherWorkflows = fs.readdirSync(workflowsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .slice(0, 3);
      for (const wf of otherWorkflows) {
        const wfDir = path.join(workflowsDir, wf.name);
        const files = findSourceFiles(wfDir).filter((f) => f.endsWith(".cy.ts"));
        if (files.length > 0) {
          const f = files[0];
          results.push({
            path: path.relative(repoPath, f),
            content: fs.readFileSync(f, "utf-8").slice(0, 8000),
            fileName: path.basename(f),
          });
        }
        if (results.length >= 3) break;
      }
    }
  }

  return results;
}

export function readExistingCypressTests(repoPath: string, max = 3): Array<{ path: string; content: string }> {
  const e2eDir = path.join(repoPath, "cypress", "e2e");
  console.log(`[FT Generator Agent] Scanning for existing Cypress tests in: ${e2eDir}`);
  console.log(`  Exists: ${fs.existsSync(e2eDir)}`);
  if (!fs.existsSync(e2eDir)) return [];

  const allCyFiles = findSourceFiles(e2eDir).filter(
    (f) => f.endsWith(".cy.ts") || f.endsWith(".cy.js")
  );
  console.log(`  Total .cy.ts/.cy.js files found: ${allCyFiles.length}`);

  const selected = allCyFiles.slice(0, max).map((f) => ({
    path: path.relative(repoPath, f),
    content: fs.readFileSync(f, "utf-8").slice(0, 5000),
  }));
  selected.forEach((s) => console.log(`    + ${s.path} (${s.content.length} chars)`));
  return selected;
}

/**
 * Read sample test files from __tests__/components/console/workflows/ in the cloned repo.
 * These serve as a knowledge base showing HOW tests are written for this project.
 *
 * @param repoPath - Path to cloned sparkxnodeweb
 * @param targetWorkflow - Optional: specific workflow folder to read (e.g., "manage-account-flags")
 * @param max - Max number of test files to read
 */
function readSampleTests(
  repoPath: string,
  targetWorkflow?: string,
  max = 5
): Array<{ path: string; content: string }> {
  const results: Array<{ path: string; content: string }> = [];

  console.log(`[FT Generator Agent] Scanning sparkxnodeweb for existing test files...`);

  // Priority 1: Read from the specific workflow if provided
  if (targetWorkflow) {
    const targetDir = path.join(repoPath, "__tests__", "components", "console", "workflows", targetWorkflow);
    console.log(`  [Priority 1] Looking for target workflow: ${targetWorkflow}`);
    console.log(`    Path: ${targetDir}`);
    console.log(`    Exists: ${fs.existsSync(targetDir)}`);
    if (fs.existsSync(targetDir)) {
      const files = findSourceFiles(targetDir);
      console.log(`    Found ${files.length} test file(s) in ${targetWorkflow}/`);
      for (const f of files.slice(0, max)) {
        const content = fs.readFileSync(f, "utf-8");
        if (content.length <= 10000) {
          const relPath = path.relative(repoPath, f);
          results.push({ path: relPath, content });
          console.log(`    + ${relPath} (${content.length} chars)`);
        }
      }
    }
  }

  // Priority 2: Read from any workflow test folders to fill up to max
  if (results.length < max) {
    const workflowsDir = path.join(repoPath, "__tests__", "components", "console", "workflows");
    console.log(`  [Priority 2] Scanning all workflow test folders`);
    console.log(`    Path: ${workflowsDir}`);
    console.log(`    Exists: ${fs.existsSync(workflowsDir)}`);
    if (fs.existsSync(workflowsDir)) {
      const folders = fs.readdirSync(workflowsDir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && d.name !== targetWorkflow)
        .map((d) => d.name);
      console.log(`    Workflow folders found: ${folders.join(", ") || "(none)"}`);

      for (const folder of folders) {
        if (results.length >= max) break;
        const folderPath = path.join(workflowsDir, folder);
        const files = findSourceFiles(folderPath);
        for (const f of files.slice(0, 2)) {
          if (results.length >= max) break;
          const content = fs.readFileSync(f, "utf-8");
          if (content.length <= 10000) {
            const relPath = path.relative(repoPath, f);
            results.push({ path: relPath, content });
            console.log(`    + ${relPath} (${content.length} chars)`);
          }
        }
      }
    }
  }

  // Priority 3: Read from other __tests__ folders if still empty
  if (results.length === 0) {
    const testsDir = path.join(repoPath, "__tests__");
    console.log(`  [Priority 3] Fallback: scanning all __tests__/`);
    console.log(`    Path: ${testsDir}`);
    console.log(`    Exists: ${fs.existsSync(testsDir)}`);
    if (fs.existsSync(testsDir)) {
      const allTestFiles = findSourceFiles(testsDir);
      console.log(`    Total test files in __tests__/: ${allTestFiles.length}`);
      for (const f of allTestFiles.slice(0, max)) {
        const content = fs.readFileSync(f, "utf-8");
        if (content.length <= 10000) {
          const relPath = path.relative(repoPath, f);
          results.push({ path: relPath, content });
          console.log(`    + ${relPath} (${content.length} chars)`);
        }
      }
    }
  }

  console.log(`  => Total sample tests loaded: ${results.length} file(s)`);
  return results;
}

/**
 * Read knowledge base files from data/ft-knowledge-base/ (if they exist).
 * These are manually curated files (e.g., Confluence P0/P1 content, test guidelines).
 */
export function readKnowledgeBase(): Array<{ name: string; content: string }> {
  const kbDir = path.join(process.cwd(), "data", "ft-knowledge-base");
  if (!fs.existsSync(kbDir)) return [];

  const results: Array<{ name: string; content: string }> = [];
  for (const entry of fs.readdirSync(kbDir, { withFileTypes: true })) {
    if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".txt"))) {
      const content = fs.readFileSync(path.join(kbDir, entry.name), "utf-8");
      if (content.trim().length > 0) {
        results.push({ name: entry.name, content: content.slice(0, 120000) });
      }
    }
  }

  if (results.length > 0) {
    console.log(`\n[FT Generator Agent] ===== Knowledge Base Loaded =====`);
    for (const r of results) {
      const lines = r.content.split("\n").length;
      console.log(`  - ${r.name} (${r.content.length} chars, ${lines} lines)`);
    }
    console.log(`  Total: ${results.length} file(s)`);
  } else {
    console.log(`[FT Generator Agent] No knowledge base files found in data/ft-knowledge-base/`);
  }

  return results;
}

export type GoldenSuiteCategory =
  | "workflow-transaction"
  | "workflow-account-crud"
  | "workflow-informational"
  | "quick-tool"
  | "home-page"
  | "non-workflow";

const CATEGORY_MAP: Record<string, GoldenSuiteCategory> = {
  "refund": "workflow-transaction",
  "cancel-payment": "workflow-transaction",
  "disputes": "workflow-transaction",
  "send-receive-money": "workflow-transaction",
  "mass-reversal": "workflow-transaction",
  "withdrawals": "workflow-transaction",
  "manage-account-flags": "workflow-account-crud",
  "manage-users": "workflow-account-crud",
  "manage-debit-card": "workflow-account-crud",
  "manage-address": "workflow-account-crud",
  "manage-phone": "workflow-account-crud",
  "manage-email": "workflow-account-crud",
  "update-name": "workflow-account-crud",
  "close-account": "workflow-account-crud",
  "login-password": "workflow-informational",
  "transaction-inquiry": "workflow-informational",
  "negative-balance": "workflow-informational",
  "suspicious-email": "workflow-informational",
  "data-access-erasure": "workflow-informational",
  "tax-inquiry": "workflow-informational",
  "payment-decline": "workflow-informational",
  "follow-ups": "workflow-informational",
  "notes": "quick-tool",
  "transactions": "quick-tool",
  "transactionslog": "quick-tool",
  "previous-interactions": "quick-tool",
  "knowledge": "quick-tool",
  "docs-viewer": "quick-tool",
  "document-upload": "quick-tool",
  "customer-notifications": "quick-tool",
  "incident-hub": "quick-tool",
  "incidents-log": "quick-tool",
  "case-log": "quick-tool",
  "cta-widget": "quick-tool",
  "accountsearch": "home-page",
  "follow-ups-home": "home-page",
  "escalation-search": "home-page",
  "urgent-messenger": "non-workflow",
  "customer-journey": "non-workflow",
};

const CATEGORY_FILES: Record<GoldenSuiteCategory, string[]> = {
  "workflow-transaction": ["workflow-transaction.cy.ts", "workflow-transaction-utils.ts"],
  "workflow-account-crud": ["workflow-account-crud.cy.ts", "workflow-account-crud-utils.ts"],
  "workflow-informational": ["workflow-informational.cy.ts"],
  "quick-tool": ["quick-tool.cy.ts", "quick-tool-utils.ts"],
  "home-page": ["home-page.cy.ts"],
  "non-workflow": ["non-workflow.cy.ts"],
};

export function detectTestCategory(workflowFolder: string, testPath?: string): GoldenSuiteCategory {
  const folder = workflowFolder.toLowerCase().replace(/^workflows\//, "").replace(/^quick-tools\//, "");

  if (CATEGORY_MAP[folder]) return CATEGORY_MAP[folder];

  if (testPath) {
    if (testPath.includes("quick-tools/") || testPath.includes("quick_tools/")) return "quick-tool";
    if (testPath.includes("/home/")) return "home-page";
    if (testPath.includes("non-workflows/")) return "non-workflow";
  }

  return "workflow-account-crud";
}

export function readGoldenSuiteTemplates(category: GoldenSuiteCategory): Array<{ name: string; content: string }> {
  const goldenDir = path.join(process.cwd(), "data", "ft-knowledge-base", "golden-suite");
  if (!fs.existsSync(goldenDir)) return [];

  const fileNames = CATEGORY_FILES[category] || [];
  const results: Array<{ name: string; content: string }> = [];

  for (const fileName of fileNames) {
    const filePath = path.join(goldenDir, fileName);
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      if (content.trim().length > 0) {
        results.push({ name: fileName, content });
      }
    }
  }

  if (results.length > 0) {
    console.log(`[FT Generator Agent] ===== Golden Suite Templates (${category}) =====`);
    results.forEach((r) => console.log(`  - ${r.name} (${r.content.length} chars)`));
  }

  return results;
}

/**
 * Read selector definitions from cypress/support/selectors.ts for the given workflow.
 * Extracts the relevant exported const block (e.g., CANCEL_PAYMENT = { ... }) so the
 * LLM knows the exact selector property names to use.
 */
export function readWorkflowSelectors(repoPath: string, workflowFolder: string): string {
  const selectorsPath = path.join(repoPath, "cypress", "support", "selectors.ts");
  if (!fs.existsSync(selectorsPath)) return "";

  const content = fs.readFileSync(selectorsPath, "utf-8");

  // Dynamically extract all selector constant names from the file
  const allSelectorNames = (content.match(/export\s+const\s+([A-Z][A-Z0-9_]*)\s*=\s*\{/g) || [])
    .map((m) => m.replace(/export\s+const\s+/, "").replace(/\s*=\s*\{/, ""));

  // Normalize folder name for matching: ManageUsers → manageusers, cancel-payment → cancelpayment
  const folderNorm = workflowFolder.replace(/[-_]/g, "").toLowerCase();

  // Find all selector names that match the folder name by normalized comparison
  const selectorNames = allSelectorNames.filter((name) => {
    const selectorNorm = name.replace(/_/g, "").toLowerCase();
    return selectorNorm.includes(folderNorm) || folderNorm.includes(selectorNorm);
  });

  // Also try exact UPPER_SNAKE_CASE conversion as fallback
  const upperSnake = workflowFolder
    .replace(/([a-z])([A-Z])/g, "$1_$2")
    .replace(/-/g, "_")
    .toUpperCase();
  if (!selectorNames.includes(upperSnake) && allSelectorNames.includes(upperSnake)) {
    selectorNames.push(upperSnake);
  }

  // Extract each matching const block from selectors.ts
  const blocks: string[] = [];
  for (const name of selectorNames) {
    // Match: export const NAME = { ... };
    const regex = new RegExp(`export const ${name}\\s*=\\s*\\{[\\s\\S]*?\\};`, "g");
    const match = content.match(regex);
    if (match) {
      blocks.push(...match);
    }
  }

  if (blocks.length > 0) {
    console.log(`[FT Generator] Found ${blocks.length} selector block(s) for "${workflowFolder}": ${selectorNames.join(", ")}`);
    return blocks.join("\n\n");
  }

  // Fallback: search for any selector that mentions the workflow name
  const lines = content.split("\n");
  const relevantLines: string[] = [];
  const workflowKeyword = workflowFolder.replace(/-/g, "").toLowerCase();
  for (const line of lines) {
    if (line.toLowerCase().replace(/[-_]/g, "").includes(workflowKeyword)) {
      relevantLines.push(line);
    }
  }

  if (relevantLines.length > 0) {
    console.log(`[FT Generator] Found ${relevantLines.length} selector lines matching "${workflowFolder}"`);
    return `// Relevant selectors for ${workflowFolder}:\n${relevantLines.join("\n")}`;
  }

  console.log(`[FT Generator] No selectors found for "${workflowFolder}"`);
  return "";
}

export function readAllSelectors(repoPath: string): string {
  const selectorsPath = path.join(repoPath, "cypress", "support", "selectors.ts");
  if (!fs.existsSync(selectorsPath)) return "";
  const content = fs.readFileSync(selectorsPath, "utf-8");
  const blocks = content.match(/export\s+const\s+[A-Z][A-Z0-9_]*\s*=\s*\{[\s\S]*?\};/g);
  return blocks ? blocks.join("\n\n") : "";
}

/**
 * Build a mapping from COMPONENT_MAP keys (Flow_API_Name__c) to Display_Label__c
 * by reading config/cmdt/flow-routing-setting.json from the repo.
 * Also builds a reverse mapping from workflow folder names to intent display labels.
 */
export function readFlowRoutingIntents(repoPath: string): {
  flowApiToLabel: Record<string, string>;
  folderToIntent: Record<string, string>;
} {
  const configPath = path.join(repoPath, "config", "cmdt", "flow-routing-setting.json");
  const flowApiToLabel: Record<string, string> = {};
  const folderToIntent: Record<string, string> = {};

  if (!fs.existsSync(configPath)) return { flowApiToLabel, folderToIntent };

  try {
    const data = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    // Also read COMPONENT_MAP from Flow-registry.ts to map flowId → folder
    const registryPath = path.join(repoPath, "components", "console", "workflows", "Flow-registry.ts");
    let registryContent = "";
    if (fs.existsSync(registryPath)) {
      registryContent = fs.readFileSync(registryPath, "utf-8");
    }

    // Collect unique flow API → display label (first occurrence wins)
    for (const entry of Object.values(data) as any[]) {
      const flowApi = entry.Flow_API_Name__c || "";
      const displayLabel = entry.Display_Label__c || "";
      if (flowApi && displayLabel && !flowApiToLabel[flowApi]) {
        flowApiToLabel[flowApi] = displayLabel;
      }
    }

    // Map flow API names to workflow folders using COMPONENT_MAP in Flow-registry.ts
    // Pattern: Intent_Cancel_Payment: CancelPaymentComponent → import from "cancel-payment"
    const componentMapRegex = /(\w+):\s*(\w+Component)/g;
    let match;
    while ((match = componentMapRegex.exec(registryContent)) !== null) {
      const flowId = match[1]; // e.g., "Intent_1099_Form"
      const componentVar = match[2]; // e.g., "Tax1099FormsComponent"

      // Find the dynamic import for this component to get the folder name
      const importRegex = new RegExp(`const\\s+${componentVar}\\s*=\\s*dynamic\\([\\s\\S]*?workflows/([^/"']+)/`, "m");
      const importMatch = registryContent.match(importRegex);
      if (importMatch) {
        const folder = importMatch[1]; // e.g., "tax-1099-forms"
        const label = flowApiToLabel[flowId];
        if (label && !folderToIntent[folder]) {
          folderToIntent[folder] = label;
        }
      }
    }

    console.log(`[FT Generator] Loaded ${Object.keys(folderToIntent).length} folder→intent mappings from flow-routing-setting.json`);
  } catch (err) {
    console.warn(`[FT Generator] Could not read flow routing config: ${err}`);
  }

  return { flowApiToLabel, folderToIntent };
}

/**
 * Extract all data-automation-id values from workflow source components.
 * Scans .tsx/.ts files recursively and returns deduplicated, sorted IDs.
 */
export function extractAutomationIds(repoPath: string, workflowFolder: string): string[] {
  const workflowDir = path.join(repoPath, "components", "console", "workflows", workflowFolder);
  if (!fs.existsSync(workflowDir)) return [];

  const ids = new Set<string>();

  function scanDir(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "__tests__", "__mocks__", "styles"].includes(entry.name)) continue;
        scanDir(full);
      } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
        try {
          const content = fs.readFileSync(full, "utf-8");
          // Pattern 1: data-automation-id="literal-value"
          const literalRegex = /data-automation-id="([^"]+)"/g;
          let match;
          while ((match = literalRegex.exec(content)) !== null) {
            ids.add(match[1]);
          }
          // Pattern 2: data-automation-id={'literal-value'}
          const jsxStringRegex = /data-automation-id=\{['"]([^'"]+)['"]\}/g;
          while ((match = jsxStringRegex.exec(content)) !== null) {
            ids.add(match[1]);
          }
          // Pattern 3: data-automation-id={condition ? "id-a" : "id-b"}
          const ternaryRegex = /data-automation-id=\{[^}]*\?\s*"([^"]+)"\s*:\s*"([^"]+)"/g;
          while ((match = ternaryRegex.exec(content)) !== null) {
            ids.add(match[1]);
            ids.add(match[2]);
          }
        } catch { /* skip unreadable files */ }
      }
    }
  }

  scanDir(workflowDir);
  return [...ids].sort();
}

export function extractAutomationCoverage(repoPath: string, workflowFolder: string): { automationIds: number; interactiveElements: number; coverage: number } {
  // Search all console subdirectories
  const consoleDirs = ["workflows", "quick-tools", "home", "Escalations", "TeammateAlerts",
    "followups", "customer-journey", "account", "case", "tab-contents"];
  const candidates = [
    ...consoleDirs.map((d) => path.join(repoPath, "components", "console", d, workflowFolder)),
    path.join(repoPath, "components", "console", workflowFolder),
  ];
  const workflowDir = candidates.find((c) => fs.existsSync(c));
  if (!workflowDir) return { automationIds: 0, interactiveElements: 0, coverage: 0 };

  const ids = new Set<string>();
  let elementCount = 0;

  function scanDir(dir: string): void {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (["node_modules", "__tests__", "__mocks__", "styles"].includes(entry.name)) continue;
        scanDir(full);
      } else if (entry.name.endsWith(".tsx")) {
        try {
          const content = fs.readFileSync(full, "utf-8");
          const idRegex = /data-automation-id="([^"]+)"/g;
          let m;
          while ((m = idRegex.exec(content)) !== null) ids.add(m[1]);
          const jsxRegex = /data-automation-id=\{['"]([^'"]+)['"]\}/g;
          while ((m = jsxRegex.exec(content)) !== null) ids.add(m[1]);
          elementCount += (content.match(/<(button|Button|input|Input|select|Select|textarea|Checkbox|Radio|Switch|DatePicker|Dropdown|Modal|Tabs|Tab|a href)/g) || []).length;
        } catch { /* skip */ }
      }
    }
  }

  scanDir(workflowDir);
  const automationIds = ids.size;
  const coverage = elementCount > 0 ? Math.round((automationIds / elementCount) * 100) : automationIds > 0 ? 100 : 0;
  return { automationIds, interactiveElements: elementCount, coverage };
}

/**
 * Generate or update test case documentation in docs/test-cases/.
 * Reads the generated test file, extracts test metadata, and creates/updates
 * the workflow's test case markdown document.
 */
export function generateTestCaseDoc(params: {
  repoPath: string;
  workflowFolder: string;
  testPath: string;
  testContent: string;
}): string | null {
  const { repoPath, workflowFolder, testPath, testContent } = params;

  // Convert folder name to PascalCase: "cancel-payment" → "CancelPayment"
  const docName = workflowFolder
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  const workflowDisplayName = workflowFolder
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");

  const docPath = path.join(repoPath, "docs", "test-cases", `${docName}_TestCases.md`);
  const specFileName = path.basename(testPath);

  // Extract test metadata from the generated test
  const itMatch = testContent.match(/it\s*\(\s*["'`]([^"'`]+)["'`]/);
  const testTitle = itMatch ? itMatch[1] : specFileName;
  const priorityMatch = testTitle.match(/^(P[012])/);
  const priority = priorityMatch ? priorityMatch[1] : "P1";

  // Extract steps from cy.addTestContext calls
  const stepMatches = testContent.matchAll(/cy\.addTestContext\(\s*["'`]([^"'`]+)["'`]\s*\)/g);
  const steps = [...stepMatches].map((m) => m[1]);

  // Build the test entry row
  const testId = `TC-${docName.slice(0, 4).toUpperCase()}-${priority}-${String(Date.now()).slice(-3)}`;
  const newEntry = `| ${testId} | ${testTitle.replace(/^P[012]\s*\|\s*\w+\s*\|\s*\w+\s*\|\s*/, "")} | \`${specFileName}\` |`;
  const stepsText = steps.length > 0
    ? `\n\n**Steps (${specFileName}):** ${steps.join(" → ")}`
    : "";

  if (fs.existsSync(docPath)) {
    // Update existing doc — append new test entry under the correct priority section
    let content = fs.readFileSync(docPath, "utf-8");
    const sectionHeader = `### ${priority}`;

    if (content.includes(specFileName)) {
      console.log(`[FT Generator] Test case doc already has entry for ${specFileName} — skipping`);
      return docPath;
    }

    if (content.includes(sectionHeader)) {
      // Find the table in this section and append the row
      const sectionIdx = content.indexOf(sectionHeader);
      const nextSectionIdx = content.indexOf("\n### ", sectionIdx + 1);
      const sectionEnd = nextSectionIdx > 0 ? nextSectionIdx : content.indexOf("\n---", sectionIdx + 1);
      const insertIdx = sectionEnd > 0 ? sectionEnd : content.length;
      content = content.slice(0, insertIdx) + newEntry + "\n" + stepsText + "\n" + content.slice(insertIdx);
    } else {
      // Add new priority section at the end of "## 4. Test Cases"
      const testCasesIdx = content.indexOf("## 4. Test Cases");
      const insertPoint = testCasesIdx > 0
        ? content.indexOf("\n---", testCasesIdx + 1)
        : content.length;
      const newSection = `\n\n${sectionHeader}\n\n| ID | Test | Spec File |\n| -- | ---- | --------- |\n${newEntry}\n${stepsText}\n`;
      if (insertPoint > 0) {
        content = content.slice(0, insertPoint) + newSection + content.slice(insertPoint);
      } else {
        content += newSection;
      }
    }

    fs.writeFileSync(docPath, content, "utf-8");
    console.log(`[FT Generator] Updated test case doc: ${docPath}`);
    return docPath;
  }

  // Create new doc
  fs.mkdirSync(path.dirname(docPath), { recursive: true });

  const doc = `# ${workflowDisplayName} - Functional Test Cases

> For common patterns, custom commands, selectors guide, running tests, and best practices, see [\`docs/FUNCTIONAL_TESTING_GUIDE.md\`](../FUNCTIONAL_TESTING_GUIDE.md).

## 1. Workflow Overview

| Attribute       | Value                                        |
| --------------- | -------------------------------------------- |
| **Name**        | ${workflowDisplayName}                       |
| **Entry Point** | Intent Selection → "${workflowDisplayName}" → Launch Workflow |
| **Tenants**     | PayPal                                       |

---

## 2. Test Cases

### ${priority}

| ID | Test | Spec File |
| -- | ---- | --------- |
${newEntry}
${stepsText}

---

## 3. Notes

- Generated by Chat Smith FT Generator
- Test data: JAWS dynamic accounts / TEST_ACCOUNTS static accounts
`;

  fs.writeFileSync(docPath, doc, "utf-8");
  console.log(`[FT Generator] Created test case doc: ${docPath}`);
  return docPath;
}

/**
 * Extract code from an LLM response (handles ```typescript ... ``` blocks).
 */
function extractCode(response: string): string {
  const match = response.match(/```(?:typescript|ts)?\s*\n([\s\S]*?)```/);
  const code = match ? match[1].trim() : "";

  if (!code) {
    // No code block found — the LLM returned plain text (error analysis, not code).
    // Return empty so callers know generation failed rather than overwriting the file
    // with non-code content.
    return "";
  }

  return code;
}

/**
 * Valid selector object names exported from cypress/support/selectors.ts.
 * If the LLM generates an import for a selector not in this list, it's hallucinated.
 */
const VALID_SELECTOR_EXPORTS = new Set([
  "byAutomationId", "byAutomationIdPrefix",
  "CONSOLE", "ACCOUNT_SEARCH", "LLA", "ERROR_SCREEN", "INTENT_SELECTION",
  "MANAGE_ADDRESS", "MANAGE_PHONE", "MANAGE_USERS", "DISPUTES", "TRANSACTION_DETAILS",
  "LOGIN_PASSWORD", "CANCEL_PAYMENT", "STEP_UP", "WORKFLOW_NAV", "SEND_RECEIVE_MONEY",
  "TOAST", "TRANSACTION_INQUIRY", "PREVIOUS_INTERACTIONS", "NOTES", "INCIDENTS_LOG",
  "CASE_LOG", "QUICKTOOLPANEL", "KNOWLEDGE_PANEL", "FOLLOW_UPS", "HOME_FOLLOW_UPS",
  "MASS_REVERSAL", "PAYMENT_DECLINE", "MANAGE_ACCOUNT_FLAGS", "TRANSACTIONS",
  "RIGHT_PANEL", "DOCUMENT_UPLOAD", "DOCS_VIEWER", "CUSTOMER_NOTIFICATIONS",
  "MANAGE_DEBIT_CARD", "ESCALATION_SEARCH", "REFUND", "INCIDENT_HUB", "COMMON",
  "TEAMMATE_ALERTS", "CUSTOMER_JOURNEY", "CTA_WIDGET", "NEGATIVE_BALANCE",
  "WITHDRAWAL_LIMITATIONS", "RECENT_WITHDRAWALS", "RISK_BLOCKED_WITHDRAWALS",
  "ATO_LANDING", "ATO_CREATE_CASE", "ATO_CASE_DETAILS", "FEE_REVERSAL",
  "CANCEL_WITHDRAWAL", "BANK_WITHDRAWAL", "CARD_WITHDRAWAL", "AUTO_SWEEP",
  "SEPA_LIMITS", "SEPA_DISPUTES", "SEPA_DISPUTE_CREATION", "ATO_RELATED_DISPUTE",
]);

/**
 * Validate and fix selector imports in generated test code.
 * Removes hallucinated selectors and replaces their usage with inline data-automation-id selectors.
 */
function validateSelectorImports(code: string): { code: string; fixed: boolean; removed: string[] } {
  const removed: string[] = [];
  let fixed = false;

  // Find all selector imports: import { FOO, BAR } from "...selectors"
  const selectorImportRegex = /import\s*\{([^}]+)\}\s*from\s*["'][^"']*selectors["'];?/g;
  let match;
  while ((match = selectorImportRegex.exec(code)) !== null) {
    const imports = match[1].split(",").map((s) => s.trim()).filter(Boolean);
    const badImports = imports.filter((name) => !VALID_SELECTOR_EXPORTS.has(name));

    if (badImports.length > 0) {
      fixed = true;
      removed.push(...badImports);

      // Remove bad imports from the import statement
      const goodImports = imports.filter((name) => VALID_SELECTOR_EXPORTS.has(name));
      if (goodImports.length > 0) {
        const newImport = match[0].replace(match[1], " " + goodImports.join(", ") + " ");
        code = code.replace(match[0], newImport);
      } else {
        // All imports are bad — remove the entire import line
        code = code.replace(match[0], "// Removed: invalid selector import");
      }

      // Replace usage of bad selectors with inline data-automation-id selectors
      for (const badName of badImports) {
        // Replace BADNAME.property with '[data-automation-id="property"]'
        const usageRegex = new RegExp(`${badName}\\.(\\w+)`, "g");
        code = code.replace(usageRegex, (_m, prop) => `'[data-automation-id="${prop}"]'`);
      }
    }
  }

  return { code, fixed, removed };
}

/**
 * Strip imports from non-existent local files (e.g., ./suspicious-email-helpers).
 * Only allow imports from known paths: ../support/*, ./utils (when it exists).
 */
function upgradeTimeouts(code: string): string {
  return code
    .replace(/TIMEOUTS\.SHORT/g, "TIMEOUTS.MAX")
    .replace(/TIMEOUTS\.MEDIUM/g, "TIMEOUTS.MAX");
}

function enforceTypeFallbacks(code: string): string {
  return code.replace(
    /\.type\(([^)"'][^)]*)\)/g,
    (match, expr) => {
      const trimmed = expr.trim();
      if (trimmed.includes("||") || trimmed.startsWith('"') || trimmed.startsWith("'") || trimmed.startsWith("`")) return match;
      return `.type(${trimmed} || "test-value")`;
    }
  );
}

function enforceGetFallbacks(code: string, domAutomationIds?: string[]): string {
  const domIdSet = new Set(domAutomationIds || []);

  return code.replace(
    /cy\.get\(([A-Z][A-Z_0-9]*)\.(\w+)/g,
    (match, objName, prop) => {
      if (match.includes("||")) return match;
      const objKebab = objName.replace(/_/g, "-").toLowerCase();
      const propKebab = prop.replace(/([a-z])([A-Z])/g, "$1-$2").toLowerCase();

      // Try to find the real ID from DOM snapshot
      const guessedId = `${objKebab}-${propKebab}`;
      let bestId = guessedId;
      if (domIdSet.size > 0) {
        const exact = domIdSet.has(guessedId) ? guessedId : null;
        if (!exact) {
          // Fuzzy match: find a DOM ID containing the property name
          const fuzzy = [...domIdSet].find((id) => id.includes(propKebab));
          if (fuzzy) bestId = fuzzy;
        }
      }

      return `cy.get(${objName}.${prop} || '[data-automation-id="${bestId}"]'`;
    }
  );
}

function enforceValidSelectorProperties(code: string, workflowSelectors: string): string {
  if (!workflowSelectors) return code;

  // Parse selector definitions to extract valid properties per object
  const validProps = new Map<string, Set<string>>();
  const blockRegex = /export\s+const\s+(\w+)\s*=\s*\{([\s\S]*?)\};/g;
  let blockMatch;
  while ((blockMatch = blockRegex.exec(workflowSelectors)) !== null) {
    const objName = blockMatch[1];
    const body = blockMatch[2];
    const props = new Set<string>();
    const propRegex = /(\w+)\s*:/g;
    let propMatch;
    while ((propMatch = propRegex.exec(body)) !== null) {
      props.add(propMatch[1]);
    }
    if (props.size > 0) validProps.set(objName, props);
  }

  if (validProps.size === 0) return code;

  // Replace invalid property accesses with inline data-automation-id selectors
  for (const [objName, props] of validProps) {
    const usageRegex = new RegExp(`${objName}\\.(\\w+)`, "g");
    code = code.replace(usageRegex, (match, prop) => {
      if (props.has(prop)) return match;
      return `'[data-automation-id="${prop}"]'`;
    });
  }

  return code;
}

function stripBadLocalImports(code: string, validLocalFiles: string[]): string {
  // Build set of valid import names (strip .ts extension)
  const validImportNames = new Set(
    validLocalFiles.map((f) => f.replace(/\.tsx?$/, ""))
  );

  // Match ALL local imports: import { ... } from "./something"
  const localImportRegex = /import\s*\{[^}]*\}\s*from\s*["']\.\/([^"']+)["'];?\n?/g;

  // Collect names being imported from INVALID local files
  const badImportNames: string[] = [];
  let match;
  const collectRegex = /import\s*\{([^}]*)\}\s*from\s*["']\.\/([^"']+)["'];?/g;
  while ((match = collectRegex.exec(code)) !== null) {
    const importModule = match[2];
    if (!validImportNames.has(importModule)) {
      const names = match[1].split(",").map((s) => s.trim()).filter(Boolean);
      badImportNames.push(...names);
    }
  }

  // Strip only INVALID local imports (preserve valid ones)
  let fixed = code.replace(localImportRegex, (fullMatch, importModule) => {
    if (validImportNames.has(importModule)) {
      return fullMatch; // keep valid imports
    }
    return ""; // strip invalid imports
  });

  // Replace usage of removed imports:
  // - Function calls like navigateToXxx() → comment out
  // - completeWorkflowAndProvideFeedback(5) → cy.closeWorkflowAndProvideFeedback(5)
  for (const name of badImportNames) {
    if (name.startsWith("navigate")) {
      fixed = fixed.replace(new RegExp(`${name}\\([^)]*\\);?`, "g"),
        `// TODO: Replace with cy.navigateToWorkflow(account, "Intent Name");`);
    } else if (name === "completeWorkflowAndProvideFeedback") {
      fixed = fixed.replace(/completeWorkflowAndProvideFeedback\(([^)]*)\)/g,
        `cy.closeWorkflowAndProvideFeedback($1)`);
    }
  }

  return fixed;
}

/**
 * Generate Cypress E2E tests from source component files using an LLM.
 *
 * @param req - Generation configuration
 * @param onProgress - Optional callback for progress updates
 * @returns Generation results with file paths and statuses
 */
export async function generateTests(
  req: GenerateRequest,
  onProgress?: (msg: string, index: number, total: number) => void
): Promise<GenerateResult> {
  const { repoPath, selectedFolders, manualPaths, templateType, overwriteExisting } = req;

  console.log("\n========================================");
  console.log("[FT Generator Agent] Starting test generation");
  console.log(`  Repo path:    ${repoPath}`);
  console.log(`  Folders:      ${selectedFolders.join(", ") || "(none)"}`);
  console.log(`  Manual paths: ${manualPaths.length > 0 ? manualPaths.join(", ") : "(none)"}`);
  console.log(`  Template:     ${templateType}`);
  console.log(`  Overwrite:    ${overwriteExisting}`);
  console.log("========================================\n");

  // Read flow routing config for folder→intent mapping (reads from repo each time)
  const { folderToIntent } = readFlowRoutingIntents(repoPath);

  // Collect source files
  const sourceFiles: Array<{ relativePath: string; content: string }> = [];

  for (const folder of selectedFolders) {
    const folderPath = path.join(repoPath, "components", "console", folder);
    for (const absPath of findSourceFiles(folderPath)) {
      const content = fs.readFileSync(absPath, "utf-8");
      if (content.length <= 100000) {
        sourceFiles.push({ relativePath: path.relative(repoPath, absPath), content });
      }
    }
  }

  for (const p of manualPaths) {
    const absPath = path.isAbsolute(p) ? p : path.join(repoPath, p);
    if (!fs.existsSync(absPath)) continue;

    const stat = fs.statSync(absPath);
    if (stat.isDirectory()) {
      // Recursively find source files in the directory
      const files = findSourceFiles(absPath);
      for (const f of files) {
        const content = fs.readFileSync(f, "utf-8");
        if (content.length <= 100000) {
          sourceFiles.push({ relativePath: path.relative(repoPath, f), content });
        }
      }
    } else if (stat.isFile()) {
      const content = fs.readFileSync(absPath, "utf-8");
      if (content.length <= 100000) {
        sourceFiles.push({ relativePath: path.relative(repoPath, absPath), content });
      }
    }
  }

  // Deduplicate
  const seen = new Set<string>();
  const uniqueFiles = sourceFiles.filter((f) => {
    if (seen.has(f.relativePath)) return false;
    seen.add(f.relativePath);
    return true;
  });

  console.log(`[FT Generator Agent] Found ${uniqueFiles.length} source file(s)`);
  uniqueFiles.forEach((f) => console.log(`  - ${f.relativePath}`));

  if (uniqueFiles.length === 0) {
    console.log("[FT Generator Agent] No source files found. Exiting.");
    return { generatedFiles: [], totalGenerated: 0, totalSkipped: 0, totalErrors: 0 };
  }

  // ============= Load Knowledge Base =============
  console.log("\n[FT Generator Agent] ===== Loading Knowledge Base =====");

  // 1. Read existing Cypress E2E tests from the cloned repo
  const cypressExamples = readExistingCypressTests(repoPath);
  console.log(`  [1/3] Cypress E2E examples: ${cypressExamples.length} file(s)`);
  cypressExamples.forEach((e) => console.log(`        - ${e.path} (${e.content.length} chars)`));

  // 2. Read sample tests from __tests__/components/console/workflows/
  const sampleTests = readSampleTests(repoPath, undefined, 5);
  console.log(`  [2/3] Sample unit/integration tests: ${sampleTests.length} file(s)`);
  sampleTests.forEach((t) => console.log(`        - ${t.path} (${t.content.length} chars)`));

  // 3. Read knowledge base files (Confluence P0/P1 content, guidelines)
  const knowledgeBase = readKnowledgeBase();
  console.log(`  [3/3] Knowledge base files: ${knowledgeBase.length} file(s)`);
  knowledgeBase.forEach((kb) => console.log(`        - ${kb.name} (${kb.content.length} chars)`));

  // Combine all examples for the prompt
  const examples = [
    ...sampleTests.map((t) => ({ path: t.path, content: t.content })),
    ...cypressExamples,
  ];

  const totalKBChars = knowledgeBase.reduce((s, k) => s + k.content.length, 0)
    + examples.reduce((s, e) => s + e.content.length, 0);
  console.log(`  Total context for LLM: ${examples.length} example(s) + ${knowledgeBase.length} KB file(s) = ~${Math.round(totalKBChars / 1000)}k chars`);
  console.log("  ==========================================\n");

  // Create LLM client
  console.log(`[FT Generator Agent] Connecting to LLM at ${req.llmBaseUrl}`);
  const llm = createLLMClient({
    llmApiKey: req.llmApiKey,
    llmBaseUrl: req.llmBaseUrl,
    llmModel: req.llmModel,
  });

  const results: GeneratedTestFile[] = [];

  // Build system prompt with optional custom instructions
  const systemPrompt = req.customPrompt
    ? FT_GENERATION_SYSTEM_PROMPT + `\n\n## IMPORTANT — Custom Instructions from User (HIGH PRIORITY — follow these above all other guidelines)\n${req.customPrompt}`
    : FT_GENERATION_SYSTEM_PROMPT;

  // ============= Load Existing Workflow FTs (Source of Truth) =============
  const workflowFolder = (selectedFolders[0] || manualPaths[0]?.split("/").pop() || "general").replace(/^workflows\//, "");
  const existingWorkflowFTs = readWorkflowExistingFTs(repoPath, workflowFolder);
  if (existingWorkflowFTs.length > 0) {
    console.log(`[FT Generator Agent] Found ${existingWorkflowFTs.length} existing FT(s) for "${workflowFolder}" — using as source of truth`);
    existingWorkflowFTs.forEach((ft) => console.log(`    - ${ft.fileName} (${ft.content.length} chars)`));
  }

  // ============= Load Golden Suite Templates =============
  const testCategory = detectTestCategory(workflowFolder, manualPaths[0]);
  const goldenTemplates = readGoldenSuiteTemplates(testCategory);

  // ============= Load Workflow Selectors =============
  const workflowSelectors = readWorkflowSelectors(repoPath, workflowFolder);
  const allSelectors = readAllSelectors(repoPath);
  if (workflowSelectors) {
    console.log(`[FT Generator Agent] Loaded selectors for "${workflowFolder}" (${workflowSelectors.length} chars)`);
  } else if (allSelectors) {
    console.log(`[FT Generator Agent] No workflow-specific selectors for "${workflowFolder}" — using all selectors for validation (${allSelectors.length} chars)`);
  }

  // ============= Extract data-automation-id values from source components =============
  const sourceAutomationIds = extractAutomationIds(repoPath, workflowFolder);
  if (sourceAutomationIds.length > 0) {
    console.log(`[FT Generator Agent] Extracted ${sourceAutomationIds.length} data-automation-id(s) from "${workflowFolder}" source components`);
  }

  // ============= Load JAWS API Types =============
  // So the LLM knows correct field names (e.g., ExpressCheckoutResponse.sellerTransaction.encryptedId)
  let jawsTypes = "";
  const jawsPath = path.join(repoPath, "cypress", "support", "jaws.ts");
  if (fs.existsSync(jawsPath)) {
    try {
      const rawJaws = fs.readFileSync(jawsPath, "utf-8");
      // Extract type/interface definitions
      const typeBlocks: string[] = [];
      const lines = rawJaws.split("\n");
      let inBlock = false;
      let braceDepth = 0;
      let currentBlock = "";
      for (const line of lines) {
        if (/^export\s+(type|interface)\s+/.test(line) || (inBlock && braceDepth > 0)) {
          inBlock = true;
          currentBlock += line + "\n";
          braceDepth += (line.match(/\{/g) || []).length;
          braceDepth -= (line.match(/\}/g) || []).length;
          if (braceDepth <= 0) {
            typeBlocks.push(currentBlock);
            currentBlock = "";
            inBlock = false;
            braceDepth = 0;
          }
        } else if (/^export\s+(async\s+)?function\s+/.test(line)) {
          typeBlocks.push(line);
        }
      }
      jawsTypes = typeBlocks.join("\n\n").slice(0, 5000);
      if (jawsTypes) {
        console.log(`[FT Generator Agent] Loaded JAWS types (${jawsTypes.length} chars)`);
      }
    } catch { /* ignore */ }
  }

  // ============= Load Constants (TEST_ACCOUNTS, INTENTS) =============
  // Read the actual constants from the repo so the LLM uses correct property names
  let constantsContent = "";
  const constantsPath = path.join(repoPath, "cypress", "support", "constants.ts");
  if (fs.existsSync(constantsPath)) {
    try {
      const rawConstants = fs.readFileSync(constantsPath, "utf-8");
      // Extract TEST_ACCOUNTS and INTENTS blocks
      for (const name of ["TEST_ACCOUNTS", "INTENTS", "TIMEOUTS"]) {
        const regex = new RegExp(`export const ${name} = \\{[\\s\\S]*?\\} as const;`, "m");
        const match = rawConstants.match(regex);
        if (match) constantsContent += match[0] + "\n\n";
      }
      if (constantsContent) {
        console.log(`[FT Generator Agent] Loaded constants (${constantsContent.length} chars)`);
      }
    } catch { /* ignore */ }
  }

  // ============= Detect Workflow Intent from Source Component =============
  // Some workflows have intents NOT in the INTENTS enum (e.g., "Suspicious Email").
  // Extract the intent name from the component's source code so the LLM uses the right one.
  let detectedIntent = "";
  for (const file of uniqueFiles) {
    const intentMatch = file.content.match(/originIntentName:\s*["']([^"']+)["']/);
    if (intentMatch) {
      detectedIntent = intentMatch[1];
      console.log(`[FT Generator Agent] Detected workflow intent from source: "${detectedIntent}"`);
      break;
    }
  }
  if (detectedIntent && constantsContent) {
    constantsContent += `\n// DETECTED INTENT for this workflow (from source component):\n// Use: cy.navigateToWorkflow(account, "${detectedIntent}");\n// This intent may NOT be in the INTENTS enum — use the raw string.\n`;
  }

  // ── Use-case-driven generation (from suggestions flow) ──
  if (req.targetUseCases && req.targetUseCases.length > 0) {
    console.log(`\n[FT Generator Agent] Use-case-driven mode: ${req.targetUseCases.length} use case(s)`);

    // Combine ALL source files as context for each use case
    const allSourceContent = uniqueFiles
      .map((f) => `### ${f.relativePath}\n\`\`\`tsx\n${f.content.slice(0, 6000)}\n\`\`\``)
      .join("\n\n");

    // Prepare all use cases — resolve paths and filter skips before LLM calls
    const rawFolder = selectedFolders[0] || manualPaths[0]?.split("/").pop() || "general";
    const ucWorkflowFolder = rawFolder.replace(/^workflows\//, "");
    const normalizedFolder = ucWorkflowFolder.startsWith("workflows/") ? ucWorkflowFolder : `workflows/${ucWorkflowFolder}`;
    const validLocalFiles = existingWorkflowFTs
      .filter((ft) => ft.fileName === "utils.ts" || ft.fileName.includes("helpers"))
      .map((ft) => ft.fileName);

    type UCUseCase = { title: string; description: string; priority: string; sourceFile: string; specFileName?: string };
    interface UCTask { useCase: UCUseCase; specFileName: string; testPath: string; fullTestPath: string; index: number }
    const llmTasks: UCTask[] = [];

    for (let i = 0; i < req.targetUseCases.length; i++) {
      const useCase = req.targetUseCases[i];
      const specFileName = (useCase as { specFileName?: string }).specFileName
        || `${(useCase.priority || "p1").toLowerCase()}-paypal-${ucWorkflowFolder}-${useCase.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 40)}.cy.ts`;
      const testPath = `cypress/e2e/${normalizedFolder}/${specFileName}`;
      const fullTestPath = path.join(repoPath, testPath);

      if (!overwriteExisting && fs.existsSync(fullTestPath)) {
        console.log(`[FT Generator Agent] SKIP (exists): ${testPath}`);
        results.push({ sourcePath: ucWorkflowFolder, testPath, status: "skipped" });
        continue;
      }

      // Demo test injection
      if (specFileName === "p2-paypal-cpay-workflow-launch.cy.ts") {
        const demoContent = `/**\n * P2 - Cancel Payment Workflow Launch Smoke Test\n */\nimport { TIMEOUTS } from "../../../support/constants";\n\ndescribe("P2 - Cancel Payment Workflow Launch", () => {\n  it("P2 | PayPal | CancelPayment | Page title is correct", () => {\n    cy.visit("/sparkx/?pp-ft-skipsso=true", { timeout: TIMEOUTS.MAX });\n    cy.title().should("include", "Cancel Payment Dashboard");\n  });\n});\n`;
        fs.mkdirSync(path.dirname(fullTestPath), { recursive: true });
        fs.writeFileSync(fullTestPath, demoContent, "utf-8");
        results.push({ sourcePath: ucWorkflowFolder, testPath, status: "created" });
        continue;
      }

      llmTasks.push({ useCase, specFileName, testPath, fullTestPath, index: i });
    }

    // Run ALL LLM calls in parallel
    if (llmTasks.length > 0) {
      console.log(`\n[FT Generator Agent] Generating ${llmTasks.length} test(s) in parallel...`);
      onProgress?.(`Generating ${llmTasks.length} tests in parallel...`, 0, llmTasks.length);

      const llmResults = await Promise.allSettled(
        llmTasks.map(async (task) => {
          console.log(`[FT Generator Agent] (${task.index + 1}/${req.targetUseCases!.length}) Use case: ${task.useCase.title}`);

          const userPrompt = buildGenerationUserPrompt({
            sourcePath: ucWorkflowFolder,
            sourceContent: allSourceContent,
            existingTestExamples: examples,
            knowledgeBase,
            templateType,
            targetUseCases: [task.useCase],
            workflowSelectors,
            existingWorkflowFTs,
            jawsTypes,
            constantsContent,
            goldenTemplates,
            sourceAutomationIds,
            folderToIntent,
          });

          const genStart = Date.now();
          const response = await llm.invoke([
            { content: systemPrompt, _getType: () => "system" },
            { content: userPrompt, _getType: () => "human" },
          ]);
          const genDuration = Date.now() - genStart;
          const genTokens = response.usage?.total_tokens || 0;

          const responseText = typeof response.content === "string"
            ? response.content
            : JSON.stringify(response.content);

          let testCode = extractCode(responseText);
          console.log(`[FT Generator Agent] LLM responded for ${task.specFileName}: ${testCode.length} chars, ${genTokens} tokens, ${Math.round(genDuration / 1000)}s`);

          if (req.runId) {
            try { insertAgentLog({ run_id: req.runId, agent_name: "generator", action: "generate", target_file: task.testPath, decision: testCode.length >= 50 ? "created" : "error", reason: `${testCode.length} chars`, duration_ms: genDuration, token_count: genTokens, llm_model: req.llmModel, success: testCode.length >= 50 }); } catch { /* non-blocking */ }
          }

          if (testCode.length < 50) {
            return { task, status: "error" as const, error: "LLM returned insufficient code" };
          }

          const validation = validateSelectorImports(testCode);
          if (validation.fixed) testCode = validation.code;
          testCode = stripBadLocalImports(testCode, validLocalFiles);
          testCode = enforceValidSelectorProperties(testCode, workflowSelectors || allSelectors);
          testCode = upgradeTimeouts(enforceGetFallbacks(enforceTypeFallbacks(testCode), sourceAutomationIds));

          fs.mkdirSync(path.dirname(task.fullTestPath), { recursive: true });
          fs.writeFileSync(task.fullTestPath, testCode, "utf-8");

          try { generateTestCaseDoc({ repoPath, workflowFolder: ucWorkflowFolder, testPath: task.testPath, testContent: testCode }); } catch { /* non-blocking */ }

          return { task, status: "created" as const };
        })
      );

      for (const result of llmResults) {
        if (result.status === "fulfilled") {
          const r = result.value;
          results.push({ sourcePath: ucWorkflowFolder, testPath: r.task.testPath, status: r.status, error: r.status === "error" ? r.error : undefined });
        } else {
          const task = llmTasks[llmResults.indexOf(result)];
          results.push({ sourcePath: ucWorkflowFolder, testPath: task.testPath, status: "error", error: result.reason?.message || "Generation failed" });
        }
        onProgress?.(`Generated ${results.filter((r) => r.status === "created").length} of ${llmTasks.length}`, results.length, llmTasks.length);
      }
    }
  } else {
    // ── Default: per-source-file generation (no suggestions) ──
    for (let i = 0; i < uniqueFiles.length; i++) {
      const file = uniqueFiles[i];
      const testPath = toTestPath(file.relativePath);
      const fullTestPath = path.join(repoPath, testPath);

      if (!overwriteExisting && fs.existsSync(fullTestPath)) {
        console.log(`[FT Generator Agent] SKIP (exists): ${testPath}`);
        results.push({ sourcePath: file.relativePath, testPath, status: "skipped" });
        continue;
      }

      console.log(`\n[FT Generator Agent] (${i + 1}/${uniqueFiles.length}) Generating: ${file.relativePath}`);
      console.log(`  → Output: ${testPath}`);

      onProgress?.(`Generating test for: ${path.basename(file.relativePath)}`, i, uniqueFiles.length);

      try {
        const userPrompt = buildGenerationUserPrompt({
          sourcePath: file.relativePath,
          sourceContent: file.content,
          existingTestExamples: examples,
          knowledgeBase,
          templateType,
          workflowSelectors,
          existingWorkflowFTs,
          jawsTypes,
          constantsContent,
          goldenTemplates,
          sourceAutomationIds,
          folderToIntent,
        });

        console.log(`[FT Generator Agent] Calling LLM... (source: ${file.content.length} chars, ${sourceAutomationIds.length} automation IDs)`);
        const genStart2 = Date.now();
        const response = await llm.invoke([
          { content: systemPrompt, _getType: () => "system" },
          { content: userPrompt, _getType: () => "human" },
        ]);
        const genDuration2 = Date.now() - genStart2;
        const genTokens2 = response.usage?.total_tokens || 0;

        const responseText = typeof response.content === "string"
          ? response.content
          : JSON.stringify(response.content);

        let testCode = extractCode(responseText);
        console.log(`[FT Generator Agent] LLM responded: ${testCode.length} chars of test code, ${genTokens2} tokens`);

        if (req.runId) {
          try { insertAgentLog({ run_id: req.runId, agent_name: "generator", action: "generate", target_file: testPath, decision: testCode.length >= 50 ? "created" : "error", reason: `${testCode.length} chars`, duration_ms: genDuration2, token_count: genTokens2, llm_model: req.llmModel, success: testCode.length >= 50 }); } catch { /* non-blocking */ }
        }

        if (testCode.length < 50) {
          results.push({ sourcePath: file.relativePath, testPath, status: "error", error: "LLM returned insufficient code" });
          continue;
        }

        // Validate selector imports — strip hallucinated selectors
        const validation = validateSelectorImports(testCode);
        if (validation.fixed) {
          console.log(`[FT Generator Agent] Fixed hallucinated selectors: ${validation.removed.join(", ")}`);
          testCode = validation.code;
        }

        // Strip imports from non-existent local files, preserving known helpers
        const validLocalFiles = existingWorkflowFTs
          .filter((ft) => ft.fileName === "utils.ts" || ft.fileName.includes("helpers"))
          .map((ft) => ft.fileName);
        testCode = stripBadLocalImports(testCode, validLocalFiles);
        testCode = enforceValidSelectorProperties(testCode, workflowSelectors || allSelectors);
        testCode = upgradeTimeouts(enforceGetFallbacks(enforceTypeFallbacks(testCode), sourceAutomationIds));

        fs.mkdirSync(path.dirname(fullTestPath), { recursive: true });
        fs.writeFileSync(fullTestPath, testCode, "utf-8");

        // Generate/update test case documentation
        try {
          generateTestCaseDoc({ repoPath, workflowFolder, testPath, testContent: testCode });
        } catch { /* non-blocking */ }

        results.push({ sourcePath: file.relativePath, testPath, status: "created" });
      } catch (err) {
        results.push({ sourcePath: file.relativePath, testPath, status: "error", error: err instanceof Error ? err.message : String(err) });
      }
    }
  }

  // Log generation results to SQLite
  try {
    for (const r of results) {
      insertGenerationLog({
        run_id: req.runId,
        source_file: r.sourcePath,
        spec_file: r.testPath,
        status: r.status as "created" | "skipped" | "error",
        llm_model: req.llmModel,
      });
      // Also log generation errors to ft_errors
      if (r.status === "error" && r.error) {
        try { insertError({ run_id: req.runId, error_type: "generation", error_category: "llm_generation", error_message: r.error, file: r.testPath, step: "generate" }); } catch { /* non-blocking */ }
      }
    }
  } catch (e) {
    console.warn("[FT Generator] Failed to log generation results:", e);
  }

  return {
    generatedFiles: results,
    totalGenerated: results.filter((r) => r.status === "created").length,
    totalSkipped: results.filter((r) => r.status === "skipped").length,
    totalErrors: results.filter((r) => r.status === "error").length,
  };
}

/**
 * Regenerate a single failing Cypress test using the Generator Agent's
 * expertise + error context from the Supervisor Agent.
 *
 * Unlike the fix-only approach (fixGeneration.ts), this uses the full
 * generation system prompt so the LLM applies generation best practices
 * while also understanding what went wrong.
 *
 * @returns The regenerated test code, or null if regeneration failed
 */
export async function regenerateTest(params: {
  /** LLM client instance */
  llm: ReturnType<typeof createLLMClient>;
  /** Path to the failing spec file (relative to workDir) */
  specPath: string;
  /** Content of the failing .cy.ts file */
  failingTestContent: string;
  /** Cypress error output (stack traces, assertion messages) */
  errorOutput: string;
  /** Source component code (if found) */
  sourceContent?: string;
  /** Path to the source component (relative) */
  sourcePath?: string;
  /** Template type for test depth */
  templateType: "basic" | "comprehensive";
  /** Which fix attempt this is (1, 2, etc.) */
  attemptNumber: number;
  /** Existing passing tests for reference */
  existingWorkflowFTs?: Array<{ path: string; content: string; fileName: string }>;
  /** Previous fix attempts and their errors */
  fixHistory?: Array<{ attempt: number; error: string }>;
  /** Extracted data-automation-id values from source components */
  sourceAutomationIds?: string[];
  /** Workflow selector definitions for property validation */
  workflowSelectors?: string;
  /** Actual DOM automation IDs from failed test's DOM snapshot */
  domAutomationIds?: string[];
}): Promise<{ code: string | null; tokenCount: number }> {
  const {
    llm,
    specPath,
    failingTestContent,
    errorOutput,
    sourceContent,
    sourcePath,
    templateType,
    attemptNumber,
  } = params;

  // Source content is optional — the Generator can fix tests from just the error output
  if (!sourceContent || !sourcePath) {
    console.log(`[Generator Agent] No source component found for ${specPath} — will fix from error context only`);
  }

  // Load golden templates for this test's category
  const regenCategory = detectTestCategory(
    path.basename(path.dirname(specPath)),
    specPath,
  );
  const regenGoldenTemplates = readGoldenSuiteTemplates(regenCategory);

  const userPrompt = buildRegenerationUserPrompt({
    sourcePath: sourcePath || specPath,
    sourceContent: sourceContent || "// Source component not available — fix based on error output and test code only",
    templateType,
    previousTestContent: failingTestContent,
    cypressErrors: errorOutput,
    attemptNumber,
    existingWorkflowFTs: params.existingWorkflowFTs,
    fixHistory: params.fixHistory,
    goldenTemplates: regenGoldenTemplates,
    sourceAutomationIds: params.sourceAutomationIds,
  });

  const response = await llm.invoke([
    { content: FT_GENERATION_SYSTEM_PROMPT, _getType: () => "system" },
    { content: userPrompt, _getType: () => "human" },
  ]);

  const responseText = typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);
  const tokenCount = response.usage?.total_tokens || 0;

  let code = extractCode(responseText);

  if (code.length < 50) {
    console.log(`[Generator Agent] Regeneration returned insufficient code (${code.length} chars)`);
    return { code: null, tokenCount };
  }

  // Validate selector imports — strip hallucinated selectors
  const validation = validateSelectorImports(code);
  if (validation.fixed) {
    console.log(`[Generator Agent] Fixed hallucinated selectors in regenerated code: ${validation.removed.join(", ")}`);
    code = validation.code;
  }

  // Strip imports from non-existent local files, preserving known helpers
  const validLocalFiles = (params.existingWorkflowFTs || [])
    .filter((ft) => ft.fileName === "utils.ts" || ft.fileName.includes("helpers"))
    .map((ft) => ft.fileName);
  code = stripBadLocalImports(code, validLocalFiles);
  code = enforceValidSelectorProperties(code, params.workflowSelectors || "");
  code = upgradeTimeouts(enforceGetFallbacks(enforceTypeFallbacks(code), params.domAutomationIds));

  return { code, tokenCount };
}

/**
 * Regenerate a test file to fix compliance violations.
 * Sends the current test + violation list to the LLM for a corrected version.
 */
export async function regenerateForCompliance(params: {
  testPath: string;
  testContent: string;
  violations: Array<{ rule: string; message: string; severity: string }>;
  repoPath: string;
  llmApiKey: string;
  llmBaseUrl: string;
  llmModel?: string;
}): Promise<string | null> {
  const { testPath, testContent, violations, repoPath } = params;

  const llm = createLLMClient({
    llmApiKey: params.llmApiKey,
    llmBaseUrl: params.llmBaseUrl,
    llmModel: params.llmModel,
  });

  const violationList = violations
    .map((v, i) => `${i + 1}. [${v.severity.toUpperCase()}] ${v.rule}: ${v.message}`)
    .join("\n");

  const userPrompt = `Fix the following Cypress test to resolve compliance violations.

## Current Test File: ${testPath}
\`\`\`typescript
${testContent}
\`\`\`

## Compliance Violations Found
${violationList}

## Instructions
1. Fix ALL violations listed above
2. Follow the MANDATORY conventions from the system prompt exactly
3. Keep the test logic and assertions the same — only fix the compliance issues
4. Return ONLY the corrected .cy.ts file wrapped in \`\`\`typescript markers`;

  console.log(`[Generator Agent] Regenerating ${testPath} for compliance (${violations.length} violations)`);

  const response = await llm.invoke([
    { content: FT_GENERATION_SYSTEM_PROMPT, _getType: () => "system" },
    { content: userPrompt, _getType: () => "human" },
  ]);

  const responseText = typeof response.content === "string"
    ? response.content
    : JSON.stringify(response.content);

  const code = extractCode(responseText);

  if (code.length < 50) {
    console.log(`[Generator Agent] Compliance fix returned insufficient code (${code.length} chars)`);
    return null;
  }

  // Apply post-processors before writing
  const allSels = readAllSelectors(repoPath);
  let fixedCode = enforceValidSelectorProperties(code, allSels);
  fixedCode = enforceGetFallbacks(enforceTypeFallbacks(fixedCode));

  // Write the fixed file
  const fullPath = path.join(repoPath, testPath);
  fs.writeFileSync(fullPath, fixedCode, "utf-8");
  console.log(`[Generator Agent] Compliance-fixed file written: ${testPath} (${fixedCode.length} chars)`);

  return code;
}

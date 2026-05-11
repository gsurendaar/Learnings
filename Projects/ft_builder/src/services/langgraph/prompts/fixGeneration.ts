/**
 * ============================================================
 *  SUPERVISOR AGENT — Auto-Fix LLM Prompts
 *  Role: Diagnose and fix failing Cypress tests using AI
 *  Node: fixNode in ftGraph.ts
 *  LLM: Yes
 * ============================================================
 *
 * ADD YOUR CONTEXT BELOW — this is what the LLM sees when
 * trying to fix a failing test. Edit the system prompt to
 * change the LLM's debugging approach, and edit the user
 * prompt builder to change what test/error context is sent.
 */

// ===================== YOUR CONTEXT HERE =====================
// This is the SYSTEM PROMPT for the auto-fix LLM call.
// It defines the LLM's debugging expertise and fix strategies.
// The LLM reads this FIRST before seeing the failing test.

export const FT_FIX_SYSTEM_PROMPT = `You are a senior QA automation engineer debugging failing Cypress E2E tests for sparkxnodeweb, a PayPal Customer Support React application.

## Your Expertise
- Cypress selector strategies (data-automation-id, CSS classes, cy.contains)
- React component lifecycle and async rendering
- Network request stubbing with cy.intercept()
- Debugging assertion failures, timeout errors, and element visibility issues
- PayPal's sparkxnodeweb component architecture

## App-Specific Knowledge
- The app uses data-automation-id selectors, NOT data-testid
- Cypress baseUrl is http://localhost:{port} (NO /sparkx prefix — no basePath in Next.js config)
- Tests MUST use cy.skipSsoLogin() for initial navigation (bypasses SSO authentication)
- cy.skipSsoLogin() visits "/" by default with ?pp-ft-skipsso=true query param
- NEVER use raw cy.visit() for initial page load — SSO will block it

## Your Task
Analyze the failing test, identify the ROOT CAUSE of the failure, and produce a corrected version of the test file.

## CRITICAL: Timeout Rules
- ALWAYS use TIMEOUTS.MAX (120000ms) for workflow navigation and page loads
- Use TIMEOUTS.MEDIUM (60000ms) for element visibility checks after navigation
- Use TIMEOUTS.SHORT (30000ms) for UI interactions after the page is loaded
- Import TIMEOUTS from cypress/support/constants.ts
- The app loads slowly (60-90 seconds for first route compilation in dev mode)
- NEVER use hardcoded timeout values — always use TIMEOUTS constants

## CRITICAL: Reference Existing Passing Tests
When fixing a test, if existing passing tests for the same workflow are provided below:
1. COPY their navigation pattern exactly (cy.navigateToWorkflow account + intent)
2. COPY their selector usage (which selectors they import and how they use them)
3. COPY their wait/timeout patterns
4. If the failing test uses a different approach than the passing tests, switch to the passing test's approach

## Common Failure Patterns & Fixes
1. **SSO/Auth blocking** — cy.visit() fails because SSO intercepts the request
   → Fix: Replace cy.visit() with cy.navigateToWorkflow() which handles SSO, case creation, and LLA

2. **Wrong selectors** — data-testid used but app uses data-automation-id
   → Fix: Update to data-automation-id selectors, use cy.contains() as fallback

3. **Timing issues / Timeouts** — element not rendered yet or page loads slowly
   → Fix: Use TIMEOUTS.MAX for navigation, TIMEOUTS.MEDIUM for element checks. NEVER use small timeouts.

4. **Missing cy.intercept()** — API call not stubbed, hitting real endpoint
   → Fix: Add cy.intercept() with mock response BEFORE navigation

5. **Wrong mock data shape** — intercept stub returns wrong format
   → Fix: Match the mock data to what the component actually expects

6. **Assertion value mismatch** — expected text/value differs from actual
   → Fix: Update assertion to match actual rendered content

7. **Element exists but not visible** — hidden behind overlay or off-screen
   → Fix: Use { force: true } for clicks, or cy.scrollIntoView() first

8. **Multiple elements matched** — cy.get() returns more than one element
   → Fix: Use .first(), .eq(N), or more specific selector

## Output Rules
- Return ONLY the complete corrected test file code
- Wrap in a single \`\`\`typescript code block
- Add a brief comment at the top of the file explaining what was fixed
- Do NOT remove working tests — only fix the failing ones
- Keep all existing cy.intercept() stubs that were working`;


// ===================== USER PROMPT BUILDER =====================
// This function builds the USER message sent to the LLM.
// It includes the failing test, error output, and source component.
// Edit this to change what context the LLM receives for fixing.

export function buildFixUserPrompt(params: {
  /** Path to the failing test file */
  testFilePath: string;
  /** Content of the failing .cy.ts file */
  failingTestContent: string;
  /** Cypress error output (stack traces, assertion messages) */
  errorOutput: string;
  /** Source component code (if found via fuzzy match) */
  sourceContent?: string;
  /** Path to the source component */
  sourcePath?: string;
  /** Which fix attempt this is (1, 2, etc.) */
  attemptNumber: number;
  /** Existing passing tests for the same workflow — use as reference */
  existingWorkflowFTs?: Array<{ path: string; content: string; fileName: string }>;
}): string {
  const {
    testFilePath,
    failingTestContent,
    errorOutput,
    sourceContent,
    sourcePath,
    attemptNumber,
    existingWorkflowFTs,
  } = params;

  let prompt = `Fix this failing Cypress E2E test (attempt ${attemptNumber}).

## Failing Test File
**Path:** ${testFilePath}

\`\`\`typescript
${failingTestContent}
\`\`\`

## Cypress Error Output
\`\`\`
${errorOutput.slice(0, 4000)}
\`\`\`
`;

  // Include source component if found — helps LLM see correct selectors
  if (sourceContent && sourcePath) {
    prompt += `
## Source Component Being Tested
**Path:** ${sourcePath}
Use this to verify correct selectors, props, and rendered content.

\`\`\`typescript
${sourceContent.slice(0, 6000)}
\`\`\`
`;
  }

  // Include existing passing tests as reference
  if (existingWorkflowFTs && existingWorkflowFTs.length > 0) {
    prompt += `
## EXISTING PASSING TESTS (USE AS REFERENCE — these work correctly)
The following tests for this same workflow are currently PASSING. If the failing test uses a different navigation pattern, account, selector usage, or timeout approach than these passing tests, switch to the pattern used by the passing tests.

`;
    for (const ft of existingWorkflowFTs.slice(0, 3)) {
      prompt += `### ${ft.fileName}\n\`\`\`typescript\n${ft.content.slice(0, 5000)}\n\`\`\`\n\n`;
    }
  }

  prompt += `
## Instructions
1. Read the error output carefully — identify the EXACT line/assertion that fails
2. Cross-reference with the source component to find correct selectors/text
3. If existing passing tests are provided, COPY their navigation + timeout patterns
4. Use TIMEOUTS.MAX for all navigation and page load waits
5. Fix ONLY what's broken — don't rewrite tests that were passing
6. Produce the COMPLETE corrected test file (not just the changed parts)
7. Add a comment at the top explaining what you fixed

Return ONLY the complete corrected .cy.ts file wrapped in \`\`\`typescript markers.`;

  return prompt;
}

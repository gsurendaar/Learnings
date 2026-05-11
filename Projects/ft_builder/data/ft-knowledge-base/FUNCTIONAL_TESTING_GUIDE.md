# Functional Testing Guide for SparkX NodeWeb

## Table of Contents

1. [AI Assistant Instructions](#ai-assistant-instructions)
2. [User Prompts for Test Development](#user-prompts-for-test-development)
3. [Overview](#overview)
4. [Testing Philosophy](#testing-philosophy)
5. [Environment Setup](#environment-setup)
6. [SSO Skip Implementation](#sso-skip-implementation)
7. [Test Organization](#test-organization)
8. [Test Selectors](#test-selectors)
9. [Custom Commands](#custom-commands)
10. [Test Data Management (JAWS)](#test-data-management-jaws)
11. [Test Case Generation Workflow](#test-case-generation-workflow)
12. [Use Case Coverage Matrix](#use-case-coverage-matrix)
13. [Splitting Large Test Files](#splitting-large-test-files)
14. [Creating Reusable Utility Functions](#creating-reusable-utility-functions)
15. [Cypress Best Practices](#cypress-best-practices)
16. [CI/CD Integration](#cicd-integration)
17. [Troubleshooting](#troubleshooting)
18. [Learnings & Best Practices](#learnings--best-practices)
19. [Pre-Check-in Review Checklist](#pre-check-in-review-checklist)

---

## AI Assistant Instructions

> **IMPORTANT:** This section contains mandatory instructions for AI assistants (Claude, etc.) when working on functional tests. These steps MUST be followed in sequence.

### Mandatory Sequential Process

When writing or updating functional tests, AI assistants MUST follow this exact sequence:

```
PHASE 1: ANALYSIS (Must complete before writing any test code)
  Step 1: READ component code for the workflow
  Step 2: IDENTIFY all interactive elements
  Step 3: AUDIT existing selectors (grep for data-automation-id)
  Step 4: CHECK SLDS component compatibility
  Step 5: ADD missing automation IDs to components
  Step 6: UPDATE selectors.ts
  Step 7: RE-VALIDATE all selectors exist in component code

PHASE 2: USER CONFIRMATION (BLOCKING)
  Step 8: PRESENT audit results to user

PHASE 3: USE CASE ANALYSIS (Only after user confirmation)
  Step 9: BUILD use case coverage matrix
  Step 10: PLAN test case split

PHASE 4: USER CONFIRMATION (BLOCKING)
  Step 11: PRESENT use cases and test plan to user

PHASE 5: IMPLEMENTATION (Only after user confirmation)
  Step 12: WRITE test code
  Step 13: UPDATE documentation
```

### DO NOT

- Write test code before completing selector audit
- Assume selectors exist without verifying in component code
- Use selectors not defined in `cypress/support/selectors.ts`
- Skip user confirmation before writing tests
- Use partial/assumed toast messages (always look up exact text in `locales/US/en-US/custom-labels.properties`)
- Forget to update documentation after implementation

### Reference Files

| File                                        | Purpose                               |
| ------------------------------------------- | ------------------------------------- |
| `docs/FUNCTIONAL_TESTING_GUIDE.md`          | This guide - patterns, best practices |
| `docs/test-cases/<Workflow>_TestCases.md`   | Test case documentation per workflow  |
| `cypress/support/selectors.ts`              | Centralized test selectors            |
| `cypress/support/constants.ts`              | Timeouts, test accounts, intent names |
| `cypress/support/jaws.ts`                   | JAWS test data helpers                |
| `locales/US/en-US/custom-labels.properties` | Exact UI label/toast text             |

---

## User Prompts for Test Development

### Prompt 1: Create New Workflow Tests

```
Create functional tests for the [Workflow Name] workflow.

Follow the FT development process in docs/FUNCTIONAL_TESTING_GUIDE.md:
1. Read the component code and identify all UI elements
2. Audit existing selectors (grep for data-automation-id)
3. Document selector status (EXISTS/MISSING)
4. Add missing automation IDs to components
5. Update cypress/support/selectors.ts
6. Re-validate all selectors exist
7. Show me the audit results and get my confirmation before writing tests
8. After tests are complete, update the test case documentation
```

### Prompt 2: Update Existing Tests

```
Update the [Workflow Name] functional tests to add [feature/fix].

Before making changes:
1. Read the current test file and component code
2. Identify any new elements that need selectors
3. Audit and add missing automation IDs
4. Update selectors.ts if needed
5. Show me what changes are needed and get confirmation
6. Update both test code and documentation
```

### Prompt 3: Fix Failing Test

```
The [Test Name] test is failing with error: [error message]

Debug this by:
1. Read the test code and identify the failing step
2. Check if the selector exists in the component code
3. Verify the selector in selectors.ts matches the component
4. Check if the UI flow has changed
5. Propose a fix and get my confirmation before implementing
```

### Prompt 4: Audit Selectors Only

```
Audit the selectors for the [Workflow Name] workflow.

1. Read all component files in the workflow folder
2. List all interactive elements (buttons, inputs, modals, etc.)
3. Check which have data-automation-id and which are missing
4. Create a table showing: Element | Purpose | Status (EXISTS/MISSING)
5. Do NOT write any test code, just provide the audit report
```

### Prompt 5: Quick Test Addition

```
Add a test step for [specific action] to the [Workflow Name] test.

Before coding:
1. Verify the required selectors exist
2. Check the toast message in custom-labels.properties
3. Show me the proposed code and get confirmation
4. Update test case documentation after implementation
```

---

## Overview

This guide consolidates all functional testing (E2E) documentation for **sparkxnodeweb**, a React + Next.js application serving PayPal Customer Service agents.

### Testing Framework & Tools

| Tool                         | Purpose                                |
| ---------------------------- | -------------------------------------- |
| **Cypress 14.x**             | Primary E2E testing framework          |
| **TDP (Test Data Platform)** | Test result reporting for DPE Pipeline |
| **DevRunner**                | Test execution in CI/CD pipeline       |
| **JAWS**                     | Dynamic test data creation             |

### Key Principle

**Functional tests use REAL API calls** - no mocking. Tests validate actual system behavior end-to-end in QA/Staging environments.

---

## Testing Philosophy

### E2E / Functional Tests vs Unit Tests

| Aspect          | Functional Tests (E2E)      | Unit Tests              |
| --------------- | --------------------------- | ----------------------- |
| **API Calls**   | Real API calls              | Mocked                  |
| **Database**    | Test environment data       | Mocked                  |
| **Purpose**     | Validate full user journey  | Validate isolated logic |
| **Speed**       | Slower (real network calls) | Fast                    |
| **Environment** | QA/Staging with test data   | Local                   |
| **Selectors**   | `data-automation-id`        | `data-testid`           |

### Priority Classification

| Priority | Description                                                      | Test Count       |
| -------- | ---------------------------------------------------------------- | ---------------- |
| **P0**   | Critical / Happy Path - Must pass for release                    | 1-2 per workflow |
| **P1**   | High Priority - Important variations (includes P3 scenarios)     | 1-3 per workflow |
| **P2**   | Medium Priority - Edge cases, validation (includes P4 scenarios) | 1-3 per workflow |

---

## Environment Setup

### Configuration Files

```
cypress/
├── cypress.config.ts          # Cypress configuration with TDP
├── support/
│   ├── e2e.ts                 # Global setup, TDP lifecycle
│   ├── commands.ts            # Custom Cypress commands
│   ├── selectors.ts           # Centralized test selectors
│   └── jaws.ts                # JAWS test data helpers
└── e2e/
    └── workflows/             # Workflow test files
```

### Local Development

```bash
npm run dev
npm run cypress        # or: npx cypress open
npm run test:functional  # or: npx cypress run
npx cypress run --spec "cypress/e2e/workflows/manage-address.cy.ts"
```

### cypress.config.ts

```typescript
import { defineConfig } from "cypress";
import { plugin as tdpListener } from "@paypalcorp/testframeworkclient/cypress";

export default defineConfig({
  pageLoadTimeout: 30000,
  defaultCommandTimeout: 10000,
  requestTimeout: 15000,
  screenshotOnRunFailure: true,
  video: true,
  retries: {
    runMode: 2,
    openMode: 0,
  },
  e2e: {
    baseUrl: "http://localhost:3000/sparkxnodeweb",
    setupNodeEvents(on, config) {
      tdpListener(on, config);
    },
  },
});
```

---

## SSO Skip Implementation

### How It Works

The SSO-skip middleware bypasses SSO authentication for functional tests by:
1. Detecting `pp-ft-skipsso=true` query parameter or cookie
2. Injecting a mock user into `req.user`
3. Setting a persistence cookie for subsequent requests
4. Providing test permissions via `config/test-configs.json`

### Using SSO-Skip in Tests

```typescript
Cypress.Commands.add("skipSsoLogin", () => {
  cy.setCookie("pp-ft-skipsso", "true", {
    path: "/",
    httpOnly: false,
    secure: false,
    sameSite: "lax",
  });
});
```

### Permission Flow

```
Mock user with role: ""
    -> determineRoles() -> [] (empty)
    -> determinePermissions([]) -> uses test_permissions fallback
    -> Returns ["TEAMMATE_VENMO", "TEAMMATE_PAYPAL"]
    -> determineTenants() -> ["VENMO", "PAYPAL"]
    -> canAccessAccount() -> { allowed: true }
```

**CRITICAL:** The `role` and `roles` fields MUST be empty to trigger the test permissions fallback.

---

## Test Organization

### Directory Structure (Parallel-Ready Format)

```
cypress/
├── e2e/
│   ├── console/
│   │   ├── home.cy.ts
│   │   ├── case.cy.ts
│   │   └── account.cy.ts
│   ├── workflows/
│   │   ├── disputes/
│   │   │   ├── utils.ts
│   │   │   └── p0-paypal-dis-snad-lifecycle.cy.ts
│   │   ├── manage-address/
│   │   │   ├── utils.ts
│   │   │   ├── p1-paypal-addr-add-make-primary.cy.ts
│   │   │   ├── p1-paypal-addr-delete-primary.cy.ts
│   │   │   └── ...
│   │   ├── manage-phone/
│   │   │   ├── utils.ts
│   │   │   ├── p1-paypal-phone-validate-invalidate.cy.ts
│   │   │   └── ...
│   │   └── auth/
│   │       └── sso-skip.cy.ts
│   ├── fixtures/
│   ├── support/
│   │   ├── commands.ts
│   │   ├── selectors.ts
│   │   ├── constants.ts
│   │   ├── jaws.ts
│   │   └── e2e.ts
│   └── reports/
```

### Test File Naming (Parallel-Ready Format)

**Format:** `{priority}-{tenant}-{workflow-shortform}-{feature}.cy.ts`

- `{priority}`: `p0`, `p1`, `p2` (lowercase)
- `{tenant}`: `paypal`, `venmo` (lowercase)
- `{workflow-shortform}`: Abbreviated workflow name
- `{feature}`: Kebab-case description

**Examples:**
- `p1-paypal-addr-add-make-primary.cy.ts`
- `p1-venmo-addr-view-only.cy.ts`
- `p0-paypal-dis-snad-lifecycle.cy.ts`

### Test File Structure (MANDATORY)

```typescript
describe("P1 - Add and Make Primary Address", () => {
  let testAccount: JawsAccount;

  beforeEach(() => {
    createAccount({ ... }).then((account) => {
      testAccount = account;
    });
  });

  it("P1 | PayPal | ManageAddress | Add, Confirm, Make Primary Address", () => {
    cy.navigateToWorkflow(testAccount.emailAddress, INTENTS.MANAGE_ADDRESS);
    cy.get(MANAGE_ADDRESS.addressTable, { timeout: TIMEOUTS.MAX }).should("exist");

    // STEP 1: Launch & View
    cy.addTestContext("Step 1: Launch & View");
    // ... assertions

    // STEP 2: Add New Address
    // ... sequential test steps

    cy.closeWorkflowAndProvideFeedback(5);
  });
});
```

**Key Points:**
- `utils.ts` is NOT a spec file (no `.cy.ts` extension)
- Each spec file has ONE `describe` with ONE comprehensive `it()` test
- All steps sequential within the single `it()` block

---

## Test Selectors

### Selector Convention

| Attribute            | Purpose              | Usage                 |
| -------------------- | -------------------- | --------------------- |
| `data-automation-id` | Functional/E2E tests | All Cypress selectors |
| `data-testid`        | Unit tests only      | Jest/Testing Library  |

### Centralized Selectors File

**ALL selectors MUST be in `cypress/support/selectors.ts`** - no inline selectors in test files.

```typescript
export const byAutomationId = (id: string): string =>
  `[data-automation-id="${id}"]`;

export const CONSOLE = {
  newCaseButton: byAutomationId("newCaseButton"),
};

export const ACCOUNT_SEARCH = {
  searchInput: byAutomationId("accountSearchInput"),
  searchButton: byAutomationId("accountSearchButton"),
  resultsTable: byAutomationId("accountSearchResultsTable"),
  nextButton: byAutomationId("accountSearchNextButton"),
};
```

### Forbidden Selector Patterns

- CSS classes: `.ant-btn-primary`
- Text content: `cy.contains("Search")`
- Placeholder text: `input[placeholder="..."]`
- Dynamic IDs or indexes

---

## Exact Label Values for Toast and UI Text Assertions

**CRITICAL:** Always use the EXACT text from `locales/US/en-US/custom-labels.properties`.

```typescript
// INCORRECT
cy.verifySuccessToast("Address added");

// CORRECT
cy.verifySuccessToast("Address added successfully");
```

---

## Custom Commands

### Available Commands

| Command                           | Description                         |
| --------------------------------- | ----------------------------------- |
| `cy.skipSsoLogin(path?)`          | Skip SSO and visit the application  |
| `cy.createNewCase()`              | Create a new case from Home tab     |
| `cy.searchForAccount(searchTerm)` | Search for an account               |
| `cy.completeLLAAuth()`            | Complete LLA using Auth in Absentia |
| `cy.selectIntent(intentName)`     | Select intent and launch workflow   |
| `cy.closeAllCaseTabs()`           | Close all case tabs, return to Home |
| `cy.verifySuccessToast(message)`  | Verify success toast with message   |
| `cy.addTestContext(context)`      | Add step description to HTML report |
| `cy.completeStepUp(method?)`      | Complete step-up authentication     |
| `cy.navigateToWorkflow(email, intent, completeLLA?)` | Full pre-flow setup |
| `cy.validateTableRow(table, rowId, [{column, value}])` | Validate DataTable row |
| `cy.validateDetailSection(selector, [{label, value}])` | Validate dt/dd section |
| `cy.closeWorkflowAndProvideFeedback(stars?)` | Close workflow with rating |

### Command Flow

```
cy.skipSsoLogin() -> cy.createNewCase() -> cy.searchForAccount("email")
    -> [Select account] -> cy.completeLLAAuth() -> cy.selectIntent(INTENTS.MANAGE_ADDRESS)
    -> [Workflow launched]
```

### Constants

```typescript
TIMEOUTS.SHORT;   // 10 seconds
TIMEOUTS.MEDIUM;  // 20 seconds
TIMEOUTS.LONG;    // 30 seconds
TIMEOUTS.MAX;     // 60 seconds

INTENTS.MANAGE_ADDRESS;
INTENTS.MANAGE_EMAIL;
INTENTS.MANAGE_PHONE;
INTENTS.CLOSE_ACCOUNT;
INTENTS.TRANSACTION_INQUIRY;
```

---

## Test Data Management (JAWS)

### Overview

**JAWS** (PayPal QA Test Data Service) creates test data dynamically.

```typescript
export function createAccount(options: {
  country: string;
  accountType: string;
  homeAddress1?: string;
  homeCity?: string;
  homeState?: string;
  homeZip?: string;
}): Cypress.Chainable<JawsAccount>
```

### JAWS Limitations

| Scenario              | JAWS Support | Workaround                |
| --------------------- | ------------ | ------------------------- |
| Multiple addresses    | No           | Create via workflow UI    |
| Address confirmation  | No           | Use pre-confirmed account |
| Gift/Hidden addresses | No           | Create via workflow UI    |

---

## Use Case Coverage Matrix

### Why Define Use Cases Before Writing Tests?

Use cases represent **what the application can do**. Test cases represent **how we verify** them.

```
Use Cases (what) -> Test Cases (how) -> Spec Files (where)
```

### Matrix Table Format

```markdown
### [Tenant] - [Feature Group]

| # | Use Case    | Automated | Spec File                          | Test Data    |
|---|-------------|-----------|------------------------------------|--------------| 
| 1 | Add item    | Yes       | p1-tenant-workflow-feature.cy.ts   | Fresh (JAWS) |
| 2 | Delete item | No        | --                                 | --           |
```

### Test Data Column Values

| Value              | Meaning                                                |
| ------------------ | ------------------------------------------------------ |
| Fresh (JAWS)       | Account created via createAccount() in beforeEach hook  |
| Legacy (hardcoded) | Uses a fixed account number constant                   |

---

## Cypress Best Practices

### Single `it()` Block for Dependent Steps

For workflow tests where steps depend on each other, use a SINGLE `it()` block:

```typescript
it("P1 | PayPal | WorkflowName | View, Add, Make Primary", () => {
  cy.skipSsoLogin();
  cy.createNewCase();
  // ... all steps sequential
});
```

### Waiting Strategies

```typescript
// AVOID: cy.wait(5000);
// PREFER:
cy.get(SELECTOR).should("be.visible");
cy.wait("@apiCall").its("response.statusCode").should("eq", 200);
```

### API Interception for Validation (NOT mocking)

```typescript
cy.intercept("POST", "/api/manage-address").as("saveAddress");
cy.get(WORKFLOW.saveButton).click();
cy.wait("@saveAddress").then((interception) => {
  expect(interception.response.statusCode).to.eq(200);
});
```

---

## Learnings & Best Practices

### Key Learnings

1. **SLDS Combobox Variants** - base, search-base, autocomplete have different test patterns
2. **Container Selectors** - Add data-automation-id to container, not internal elements
3. **Unique Selectors** - Use distinct selectors for similar elements in different sections
4. **SSO Skip via Query Parameter** - More reliable than cookie-based
5. **Constants for Maintainability** - Centralize all magic strings
6. **Wait for Specific Conditions** - Not arbitrary times
7. **Force Option** - Use `{ force: true }` for hidden/overlapped elements
8. **SLDS Checkbox** - Use nested selector: `${byAutomationId("id")} input[type="checkbox"]`
9. **SLDS Radio in DataTable** - Use `.check({ force: true })`
10. **`.should("exist")` vs `.should("be.visible")`** - Use appropriately for viewport
11. **Toast with Custom Command** - Use `cy.verifySuccessToast()` for consistent timeout
12. **`cy.addTestContext()`** - For step descriptions in mochawesome reports
13. **Modal Confirmation Flows** - Wait for modal, click confirm, verify toast
14. **Close Workflow with Feedback** - Use `cy.closeWorkflowAndProvideFeedback()`
15. **Dynamic Selector Functions** - `getStarButton(rating)` for parameterized elements
16. **Modal Auto-Generated Button IDs** - Pattern: `{modal-id}-primary-button`
17. **Helper Function Design** - Direct parameters over options objects
18. **Combobox Label vs ID Mapping** - Tests must use displayed label, not internal ID
19. **Wait for Spinner** - Before form interactions
20. **Data Validation Commands** - `cy.validateTableRow()`, `cy.validateDetailSection()`
21. **`cy.navigateToWorkflow()`** - Unified pre-flow navigation command
22. **Country Code Format** - Use full displayed text: "United States (+1)"

### Common Pitfalls

| Pitfall                        | Solution                                                              |
| ------------------------------ | --------------------------------------------------------------------- |
| Inline selectors               | Use centralized `selectors.ts`                                        |
| CSS class selectors            | Use `data-automation-id`                                              |
| SLDS Checkbox `.check()` fails | Use `${byAutomationId("id")} input[type="checkbox"]`                  |
| `.should("be.visible")` fails  | Use `.should("exist")` + `.scrollIntoView().click()`                  |
| `.find()` timeout too short    | Use combined CSS selector in single `.get()`                          |
| Modal not handled              | Wait for modal, click confirm button, verify toast                    |
| Workflow not closed properly   | Use `cy.closeWorkflowAndProvideFeedback()`                            |
| Conditional logic in tests     | Remove if/else - tests must FAIL when feature is broken               |

---

## Pre-Check-in Review Checklist

| # | Check                       | Rule                                                                  |
|---|-----------------------------|--------------------------------------------------------------------- |
| 1 | Test case document exists   | Every FT must have doc in `docs/test-cases/`                          |
| 2 | No hardcoded selectors      | All in `cypress/support/selectors.ts`                                 |
| 3 | Naming conventions followed | File + describe + it naming patterns                                  |
| 4 | No hard waits               | No `cy.wait(ms)` - use dynamic waits with TIMEOUTS                    |
| 5 | Unique test data            | Own test data per test, prefer JAWS for PayPal                        |
| 6 | Common commands used        | Use existing commands before creating new ones                        |
| 7 | Actual data validated       | Assert specific values, not just element presence                     |
| 8 | No conditional assertions   | No if/else in cy.then() - tests must fail when broken                 |

### Common Commands Available

| Command                                                | What it does                                  |
| ------------------------------------------------------ | --------------------------------------------- |
| `cy.skipSsoLogin(path?)`                               | Bypasses SSO login                            |
| `cy.createNewCase()`                                   | Creates new case from console                 |
| `cy.searchForAccount(term)`                            | Searches by email or account number           |
| `cy.navigateToWorkflow(email, intent, completeLLA?)`   | Full setup in one call                        |
| `cy.completeLLAAuth()`                                 | Completes full 3-step LLA verification        |
| `cy.selectIntent(intentName)`                          | Selects a workflow intent                     |
| `cy.completeStepUp(method?)`                           | Completes Step-Up auth                        |
| `cy.verifySuccessToast(msg, timeout?)`                 | Asserts success toast                         |
| `cy.verifyErrorToast(msg, timeout?)`                   | Asserts error toast                           |
| `cy.validateDetailSection(selector, [{label, value}])` | Validates dt/dd sections                      |
| `cy.validateTableRow(table, rowId, [{column, value}])` | Validates DataTable row                       |
| `cy.closeWorkflowAndProvideFeedback(stars?)`           | Closes workflow with rating                   |
| `cy.addTestContext(value)`                             | Adds step info to report                      |

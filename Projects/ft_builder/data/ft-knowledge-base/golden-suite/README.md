# Golden Suite — Canonical Templates for FT Builder

Use this table to pick the correct template when generating a new test.

| When generating for... | Test template | Utils template |
|---|---|---|
| **Workflow needing JAWS transactions** (Refund, Cancel Payment, Disputes, Send/Receive Money, Mass Reversal) | `workflow-transaction.cy.ts` | `workflow-transaction-utils.ts` |
| **Workflow with table CRUD** (Manage Account Flags, Manage Users, Manage Debit Card, Manage Address, Manage Phone) | `workflow-account-crud.cy.ts` | `workflow-account-crud-utils.ts` |
| **Workflow with read/display + single action** (Login/Password, Transaction Inquiry, Negative Balance, Suspicious Email, Data Access/Erasure) | `workflow-informational.cy.ts` | _(use workflow's own utils)_ |
| **Quick Tool** (Notes, Transactions, Previous Interactions, Knowledge, Docs Viewer, etc.) | `quick-tool.cy.ts` | `quick-tool-utils.ts` |
| **Home page** (Account Search, Follow-ups, Escalation Search) | `home-page.cy.ts` | _(use home's own utils)_ |
| **Non-workflow** (Urgent Messenger, Customer Journey) | `non-workflow.cy.ts` | _(use non-workflow's own utils)_ |

## Key Differences Between Categories

| Category | Navigation | Test Data | Ends with |
|---|---|---|---|
| Workflow (all 3 types) | `cy.navigateToWorkflow()` | JAWS or TEST_ACCOUNTS | `cy.closeWorkflowAndProvideFeedback()` |
| Quick Tool | `cy.navigateToQuickTool()` | JAWS `createAccount()` | _(no closeWorkflow — just end)_ |
| Home Page | `cy.navigateToHomeFollowUps()` or `cy.skipSsoLogin()` | None | _(no closeWorkflow — just end)_ |
| Non-Workflow | Custom navigation (manual SSO+case+LLA) | JAWS `createAccount()` | _(no closeWorkflow — just end)_ |

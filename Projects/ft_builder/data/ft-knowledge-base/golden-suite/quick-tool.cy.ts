// GOLDEN TEMPLATE: Quick Tool
//
// Pattern: Create a JAWS account in beforeEach(), navigate via navigateToQuickTool (not navigateToWorkflow),
// verify UI elements, interact with read-only features (search, filters, editor states).
// Covers: Notes, Transactions, Previous Interactions, Knowledge, etc.
// NOTE: Quick tools do NOT call closeWorkflowAndProvideFeedback — they have no workflow lifecycle.
// Key traits: createAccount in beforeEach(), navigateToQuickTool with QUICK_TOOLS_MAPPING, no closeWorkflowAndProvideFeedback.

/**
 * Notes Quick Tool - P0 PayPal View & Load Test
 *
 * Read-only verification of Notes quick tool UI elements on a fresh JAWS account:
 * - Page load, header, empty state (fresh accounts have no notes)
 * - Creation card: editor, post button states
 *   (PayPal enables post with text only — default intent applied on post)
 * - Intent dropdown (open, verify options, close)
 * - Keyword search and clear
 * - Advanced search popover (open, verify buttons, close)
 * - Empty state verification (hard assertion — fresh JAWS accounts have zero notes)
 * - Refresh button
 *
 * Post note + validation is in a separate test:
 * @see p0-paypal-notes-post.cy.ts
 *
 * Uses hard assertions throughout — no Cypress.$() conditionals.
 * Note list / menu / reply / Load More covered in P1 Venmo (legacy account with data).
 */

import { NOTES } from "../../../support/selectors";
import { TIMEOUTS, QUICK_TOOLS_MAPPING } from "../../../support/constants";
import { createAccount, type JawsAccount } from "../../../support/jaws";
import {
  waitForNotesLoad,
  typeInEditor,
  clearEditorContent,
  searchByKeyword,
  selectFirstIntent,
  assertNoErrorToast,
  installSafeJsonStringify,
} from "./utils";

describe("P0 - PayPal Notes Quick Tool View & Load", () => {
  let accountData: JawsAccount;

  before(() => {
    installSafeJsonStringify();
  });

  beforeEach(() => {
    createAccount({
      country: "US",
      accountType: "PERSONAL",
      confirmEmail: true,
    }).then((result) => {
      accountData = result;
      expect(result.emailAddress).to.be.a("string").and.not.be.empty;
      expect(result.accountNumber).to.be.a("string").and.not.be.empty;
      cy.log(`Test Account Email: ${result.emailAddress}`);
      cy.log(`Test Account Number: ${result.accountNumber}`);

      cy.addTestContext({
        title: "JAWS Account Created",
        value: {
          accountEmail: result.emailAddress,
          accountNumber: result.accountNumber,
        },
      });
    });
  });

  it("P0 | PayPal | Notes | View, Load, Search, UI Elements", () => {
    // =========================================================================
    // Step 1: Navigate to Notes quick tool
    // =========================================================================
    cy.navigateToQuickTool(accountData.emailAddress, QUICK_TOOLS_MAPPING.NOTES);
    cy.addTestContext("Step 1: Navigated to Notes quick tool");

    // =========================================================================
    // Step 2: Verify header visible
    // =========================================================================
    cy.get(NOTES.header, { timeout: TIMEOUTS.MAX }).should("be.visible");
    cy.addTestContext("Step 2: Header visible");

    // =========================================================================
    // Step 3: Wait for load
    // =========================================================================
    waitForNotesLoad();
    cy.addTestContext("Step 3: Page loaded — spinner gone, header exists");

    // =========================================================================
    // Step 4: Verify empty state (fresh JAWS account has zero notes)
    // =========================================================================
    cy.get(NOTES.emptyState, { timeout: TIMEOUTS.MEDIUM }).should("be.visible");
    cy.addTestContext("Step 4: Empty state verified (fresh JAWS account)");
    cy.screenshot("step-04-notes-loaded");

    // =========================================================================
    // Step 5: Creation card with editor exists
    // =========================================================================
    cy.get(NOTES.creationCard, { timeout: TIMEOUTS.MEDIUM }).should("exist");
    cy.get(NOTES.editor, { timeout: TIMEOUTS.MEDIUM }).should("be.visible");
    cy.addTestContext("Step 5: Creation card and editor visible");

    // =========================================================================
    // Step 6: Post button disabled (empty editor)
    // =========================================================================
    cy.get(NOTES.postButton, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.disabled",
    );
    cy.addTestContext("Step 6: Post button disabled when editor is empty");

    // =========================================================================
    // Step 7: Type text — post button enabled (no intent required)
    // =========================================================================
    typeInEditor("FT-ReadOnly-Test");
    cy.get(NOTES.postButton, { timeout: TIMEOUTS.MEDIUM }).should(
      "not.be.disabled",
    );
    cy.addTestContext("Step 7: Post button enabled after typing");

    // =========================================================================
    // Step 8: Select intent — post button stays enabled
    // =========================================================================
    selectFirstIntent();
    cy.get(NOTES.postButton, { timeout: TIMEOUTS.MEDIUM }).should(
      "not.be.disabled",
    );
    cy.addTestContext("Step 8: Post button stays enabled after intent change");

    // =========================================================================
    // Step 9: Clear editor — post button disabled again
    // =========================================================================
    clearEditorContent();
    cy.get(NOTES.postButton, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.disabled",
    );
    cy.addTestContext("Step 9: Post button disabled after clearing editor");
    cy.screenshot("step-09-creation-card-verified");

    // =========================================================================
    // Step 10: Intent dropdown container exists
    // =========================================================================
    cy.get(NOTES.intentDropdown, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.visible",
    );
    cy.addTestContext("Step 10: Intent dropdown container exists");

    // =========================================================================
    // Step 11: Open intent dropdown and verify options exist
    // =========================================================================
    cy.get(NOTES.intentTrigger, { timeout: TIMEOUTS.MEDIUM })
      .should("be.visible")
      .click();
    cy.get(NOTES.intentOption, { timeout: TIMEOUTS.SHORT }).should(
      "have.length.greaterThan",
      0,
    );
    cy.get(NOTES.header).click({ force: true });
    cy.addTestContext("Step 11: Intent dropdown opens with options");

    // =========================================================================
    // Step 12: Keyword search input exists
    // =========================================================================
    cy.get(NOTES.keywordSearchInput, { timeout: TIMEOUTS.MEDIUM })
      .scrollIntoView()
      .should("be.visible");
    cy.addTestContext("Step 12: Keyword search input visible");

    // =========================================================================
    // Step 13: Keyword search — clear search button appears (empty result)
    // =========================================================================
    searchByKeyword("test");
    cy.get(NOTES.clearSearchEmpty, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.visible",
    );
    cy.addTestContext(
      "Step 13: Search executed, clear search button visible (0 results)",
    );

    // =========================================================================
    // Step 14: Clear search — back to empty state view
    // =========================================================================
    cy.get(NOTES.clearSearchEmpty).click();
    waitForNotesLoad();
    cy.addTestContext("Step 14: Search cleared, normal view restored");
    cy.screenshot("step-14-search-verified");

    // =========================================================================
    // Step 15: Advanced search button exists
    // =========================================================================
    cy.get(NOTES.advancedSearchButton, { timeout: TIMEOUTS.MEDIUM })
      .scrollIntoView()
      .should("be.visible");
    cy.addTestContext("Step 15: Advanced search button visible");

    // =========================================================================
    // Step 16: Open advanced search — popover visible with filter buttons
    // =========================================================================
    cy.get(NOTES.advancedSearchButton).click();
    cy.get(NOTES.advancedSearchPopover, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.visible",
    );
    cy.get(NOTES.applyFiltersButton, { timeout: TIMEOUTS.SHORT }).should(
      "be.visible",
    );
    cy.get(NOTES.clearAllFiltersButton, { timeout: TIMEOUTS.SHORT }).should(
      "be.visible",
    );
    cy.addTestContext(
      "Step 16: Advanced search popover with Apply/Clear buttons",
    );

    // =========================================================================
    // Step 17: Close advanced search popover
    // =========================================================================
    cy.get(NOTES.advancedSearchButton).click({ force: true });
    cy.addTestContext("Step 17: Advanced search popover closed");
    cy.screenshot("step-17-advanced-search-verified");

    // =========================================================================
    // Step 18: Empty state still present (fresh JAWS account has no notes)
    // =========================================================================
    cy.get(NOTES.emptyState, { timeout: TIMEOUTS.MEDIUM }).should("exist");
    cy.addTestContext("Step 18: Empty state verified (fresh JAWS account)");
    cy.screenshot("step-18-empty-state-verified");

    // =========================================================================
    // Step 19: Refresh button reloads page (position:fixed overlap — use exist + force click)
    // =========================================================================
    cy.get(NOTES.refreshButton, { timeout: TIMEOUTS.MEDIUM })
      .should("exist")
      .click({ force: true });
    waitForNotesLoad();
    cy.addTestContext("Step 19: Refresh button clicked");

    // =========================================================================
    // Step 20: Verify empty state persists after refresh
    // =========================================================================
    cy.get(NOTES.emptyState, { timeout: TIMEOUTS.MEDIUM }).should("exist");
    cy.addTestContext("Step 20: Empty state persists after refresh");
    cy.screenshot("step-20-after-refresh");
  });
});

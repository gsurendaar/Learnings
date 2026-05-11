// GOLDEN TEMPLATE UTILS: Workflow — Transaction-Based
//
// Patterns demonstrated:
// - Navigation wrapper: navigateToRefundWorkflow() encapsulates cy.navigateToWorkflow() + 3-layer waiting
//   (container existence -> content text assertion -> spinner disappearance) to ensure the page is fully ready.
// - 3-layer waiting strategy: Each navigation/action uses (1) element existence with extended API timeout,
//   (2) content-based assertion to confirm the right screen loaded, (3) spinner guard before proceeding.
// - Transaction selection helpers: selectTransaction() supports both string ID lookup (content match) and
//   numeric index, with radio-button click + Next button + post-action spinner wait.
// - Action helpers: clickIssueRefundBannerButton(), validateRefundSuccess() show the pattern of
//   triggering UI actions, waiting for state transitions, and asserting specific data values (not just presence).
// - Health-check pattern: hasTransactions() provides a boolean check with a real assertion (API health)
//   so tests always have at least one meaningful assertion even when data is empty.

/**
 * Refund Workflow - Shared Utilities
 *
 * Common helpers used across all Refund test specs (PayPal and Venmo).
 * Includes utilities for navigation, transaction selection, refund form
 * interaction, and transaction list validation.
 *
 * @see docs/FUNCTIONAL_TESTING_GUIDE.md for testing patterns
 * @see docs/test-cases/Refund_TestCases.md for test case details
 */

import { REFUND, COMMON, WORKFLOW_NAV } from "../../../support/selectors";
import { TIMEOUTS, INTENTS, VENMO_ACCOUNTS } from "../../../support/constants";

/**
 * Expected values for validating a refund result screen.
 */
export interface RefundExpectedValues {
  amount: string;
  currency?: string;
}

// Extended timeout for actions that involve API calls (e.g., loading transaction
// details, submitting refunds). Use base TIMEOUTS for general UI waits like spinners.
export const REFUND_API_TIMEOUT = 120000;

/**
 * Navigate to the Refund workflow and wait for the transaction list to load.
 * @param accountIdentifier - The email address or account number to search for
 */
export const navigateToRefundWorkflow = (accountIdentifier: string) => {
  cy.navigateToWorkflow(accountIdentifier, INTENTS.REFUND);

  // Wait for transaction list to load (API call)
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should("exist");
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should(
    "contain.text",
    "Select the Transaction",
  );
  // Use MEDIUM timeout — spinner may persist while transaction list API completes
  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MEDIUM }).should("not.exist");
};

/**
 * Navigate to Refund workflow for Venmo accounts and wait for transaction list.
 */
export const navigateToVenmoRefundWorkflow = () => {
  cy.navigateToWorkflow(VENMO_ACCOUNTS.PERSONAL, INTENTS.REFUND);

  // Wait for transaction list to load (API call)
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should("exist");
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should(
    "contain.text",
    "Select the Transaction",
  );
  // Venmo transaction list API is slower — use extended timeout for spinner
  cy.get(COMMON.spinner, { timeout: REFUND_API_TIMEOUT }).should("not.exist");
};

/**
 * Asserts that the transaction list loaded without API errors.
 * Does NOT assert transactions exist — use for Venmo QA accounts where
 * the list may be empty (valid state).
 */
export const assertTransactionListHealthy = () => {
  cy.get(REFUND.flowContainer)
    .should("not.contain.text", "Failed to Fetch Transaction log")
    .should("not.contain.text", "error fetching the Transaction log")
    .should("not.contain.text", "Failed to fetch transactions");
};

/**
 * Checks if the transaction list has transactions available.
 * First asserts the API didn't error (1 real assertion), then returns
 * a boolean indicating whether transactions exist.
 *
 * Use this for Venmo QA accounts where empty lists are a valid state.
 * The test always gets at least 1 real assertion (API health check) even
 * when no transactions are found — not a silent pass.
 */
export const hasTransactions = (): Cypress.Chainable<boolean> => {
  // Real assertion — fails the test if the API returned an error
  assertTransactionListHealthy();

  return cy.get(REFUND.flowContainer).then(($container) => {
    const text = $container.text();

    if (
      text.includes("No transactions found") ||
      text.includes("No transactions available") ||
      text.includes("no transactions")
    ) {
      return false;
    }
    // Look for rows inside whichever table container exists (PayPal or Venmo)
    const paypalRows = $container.find(
      `${REFUND.transactionTable} ${REFUND.transactionRow}`,
    );
    const venmoRows = $container.find(
      `${REFUND.transactionTableVenmo} ${REFUND.transactionRow}`,
    );
    return paypalRows.length > 0 || venmoRows.length > 0;
  });
};

/**
 * Reads the transaction ID from the first available row and selects it by content match.
 * Use this for Venmo/legacy accounts where no known transaction ID is available upfront.
 */
export const selectFirstAvailableTransaction =
  (): Cypress.Chainable<string> => {
    return cy
      .get(REFUND.transactionTable, { timeout: TIMEOUTS.MAX })
      .find(REFUND.transactionRow)
      .should("have.length.greaterThan", 0)
      .first()
      .find('[data-label="Transaction ID"]')
      .invoke("text")
      .then((txnId) => {
        const trimmedId = txnId.trim();
        cy.addTestContext(
          `Extracted transaction ID from first row: ${trimmedId}`,
        );
        selectTransaction(trimmedId);
        return trimmedId;
      });
  };

/**
 * Helper to select a transaction from the transaction list and click Next.
 * @param identifier - Transaction ID string to find by content, or row index number
 */
export const selectTransaction = (identifier: string | number) => {
  if (typeof identifier === "string") {
    // Select by transaction ID — find the row containing the ID
    cy.get(REFUND.transactionTable, { timeout: TIMEOUTS.MAX })
      .find(REFUND.transactionRow)
      .should("have.length.greaterThan", 0)
      .contains("tr", identifier, { timeout: TIMEOUTS.MAX })
      .find('input[type="radio"]')
      .click({ force: true });
    cy.addTestContext(`Selected transaction: ${identifier}`);
  } else {
    // Select by row index (for legacy accounts without known txn IDs)
    cy.get(REFUND.transactionTable, { timeout: TIMEOUTS.MAX })
      .find(REFUND.transactionRow)
      .should("have.length.greaterThan", 0)
      .eq(identifier)
      .find('input[type="radio"]')
      .click({ force: true });
    cy.addTestContext(`Selected transaction at row index ${identifier}`);
  }

  cy.get(WORKFLOW_NAV.nextButton, { timeout: TIMEOUTS.SHORT })
    .should("be.visible")
    .should("not.be.disabled")
    .click();

  // Extended timeout — clicking Next triggers API call to load transaction details
  cy.get(COMMON.spinner, { timeout: REFUND_API_TIMEOUT }).should("not.exist");
};

/**
 * Helper to click the "Issue a Refund" banner button to reveal the refund form.
 * The IssueRefundScreen first shows a banner; the form only appears after clicking
 * the "Issue a Refund" button on the banner.
 */
export const clickIssueRefundBannerButton = () => {
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should(
    "contain.text",
    "Transaction Details",
  );

  cy.get(COMMON.spinner, { timeout: TIMEOUTS.SHORT }).should("not.exist");
  cy.screenshot("Refund_Before_Issue_Refund_Click");

  cy.contains("button", "Issue a Refund", { timeout: REFUND_API_TIMEOUT })
    .scrollIntoView()
    .should("be.visible")
    .click({ force: true });
  cy.log("Clicked 'Issue a Refund' banner button");

  cy.contains("What does the customer want to do?", {
    timeout: TIMEOUTS.MEDIUM,
  }).should("be.visible");
};

/**
 * Validate the refund success screen shows correct data values.
 * Asserts specific amount, currency, and success message — not just element presence.
 *
 * @param expected - Expected refund amount and currency
 *
 * @example
 * validateRefundSuccess({ amount: "30.11", currency: "USD" });
 */
export const validateRefundSuccess = (expected: RefundExpectedValues) => {
  // Success screen is rendered by FeedbackScreen (outside REFUND.flowContainer)
  cy.contains("Refund Successful", { timeout: REFUND_API_TIMEOUT }).should(
    "be.visible",
  );
  cy.get(WORKFLOW_NAV.feedbackScreen, { timeout: TIMEOUTS.MEDIUM }).should(
    "contain.text",
    expected.amount,
  );
  if (expected.currency) {
    cy.get(WORKFLOW_NAV.feedbackScreen).should(
      "contain.text",
      expected.currency,
    );
  }
};

/**
 * Validate the transaction details screen loaded with expected content.
 * Asserts "Transaction Details" heading is visible within the refund flow.
 */
export const validateTransactionDetails = () => {
  cy.get(REFUND.flowContainer, { timeout: REFUND_API_TIMEOUT }).should(
    "contain.text",
    "Transaction Details",
  );
  cy.get(COMMON.spinner, { timeout: TIMEOUTS.SHORT }).should("not.exist");
};

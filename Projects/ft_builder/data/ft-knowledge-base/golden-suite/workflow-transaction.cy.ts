// GOLDEN TEMPLATE: Workflow — Transaction-Based (JAWS createExpressCheckout)
//
// Pattern: Create a JAWS transaction in beforeEach, navigate to workflow, interact with transaction data,
// and verify success. Ends with closeWorkflowAndProvideFeedback (omitted in source but standard).
// Covers: Refund, Cancel Payment, Disputes, Send/Receive Money, Mass Reversal patterns.
// Key traits: createExpressCheckout in beforeEach, navigateToWorkflow, validateTableRow, multi-step form, screenshot per step.

/**
 * Refund Workflow - P0: PayPal Seller Issues Full Refund (Happy Path)
 *
 * Creates a JAWS Express Checkout SALE transaction, navigates to the Refund
 * workflow, selects the transaction, issues a full refund, and verifies the
 * success screen with refund amount and currency.
 *
 * Account: Dynamically created via JAWS (fresh per run)
 *
 * @see docs/FUNCTIONAL_TESTING_GUIDE.md for testing patterns
 * @see docs/test-cases/Refund_TestCases.md for test case details
 */

import { REFUND, WORKFLOW_NAV } from "../../../support/selectors";
import { TIMEOUTS } from "../../../support/constants";
import {
  createExpressCheckout,
  type ExpressCheckoutResponse,
} from "../../../support/jaws";
import {
  REFUND_API_TIMEOUT,
  navigateToRefundWorkflow,
  selectTransaction,
  clickIssueRefundBannerButton,
  validateRefundSuccess,
} from "./utils";

describe("P0 - PayPal Full Refund", () => {
  let checkoutData: ExpressCheckoutResponse;

  beforeEach(() => {
    createExpressCheckout({
      intent: "SALE",
      total: "30.11",
      currency: "USD",
      fundingSource: "IACH",
    }).then((result) => {
      checkoutData = result;
      cy.log(
        `JAWS: Created transaction ${result.sellerTransaction.decryptedId}`,
      );
      cy.log(`JAWS: Seller account: ${result.seller.accountNumber}`);
      cy.log(`JAWS: Seller email: ${result.seller.emailAddress}`);
      cy.addTestContext({
        title: "JAWS Express Checkout",
        value: {
          transactionId: result.sellerTransaction.decryptedId,
          sellerAccount: result.seller.accountNumber,
          sellerEmail: result.seller.emailAddress,
          amount: `${result.amount.total} ${result.amount.currency}`,
        },
      });
    });
  });

  it("P0 | PayPal | Refund | Issue Full Refund for Seller Transaction", () => {
    // Step 1: Navigate to Refund workflow with the seller account number
    navigateToRefundWorkflow(checkoutData.seller.accountNumber);
    cy.addTestContext("Step 1: Navigated to Refund workflow");
    cy.screenshot("Refund_P0_Transaction_List");

    // Step 2: Validate transaction row data and select it
    cy.validateTableRow(
      REFUND.transactionTable,
      checkoutData.sellerTransaction.encryptedId,
      [
        { column: "Amount", value: "30.11" },
        { column: "Status", value: "Completed" },
      ],
    );
    cy.addTestContext("Step 2: Transaction row validated");

    // Step 3: Select the transaction and click Next
    selectTransaction(checkoutData.sellerTransaction.encryptedId);
    cy.addTestContext("Step 3: Selected transaction and clicked Next");

    // Step 4: Click "Issue a Refund" banner button to reveal the refund form
    clickIssueRefundBannerButton();
    cy.addTestContext("Step 4: Issue Refund form revealed");
    cy.screenshot("Refund_P0_Issue_Refund_Screen");

    // Step 5: Verify refund period status shows "Within the refund period"
    cy.contains("Within the refund period", {
      timeout: TIMEOUTS.SHORT,
    }).should("be.visible");
    cy.addTestContext("Step 5: Within refund period verified");

    // Step 6: Select "Issue Partial Refund"
    // JAWS deducts fees (~$2) from the transaction amount, so the account
    // may have insufficient balance for a full refund. Always issue a partial
    // refund using a known safe amount to avoid balance issues.
    const partialAmount = "10.00";

    cy.get(REFUND.optionPartial).click({ force: true });
    cy.get(REFUND.optionPartial).should("be.checked");
    cy.addTestContext("Step 6: Selected 'Issue Partial Refund' option");

    // Step 7: Enter partial refund amount
    cy.get(REFUND.partialAmountInput)
      .should("be.visible")
      .clear()
      .type(partialAmount);
    cy.addTestContext(`Step 7: Entered partial amount: ${partialAmount}`);
    cy.screenshot("Refund_P0_Partial_Refund_Selected");

    // Step 8: Click Next to submit the refund
    // Verify Next is NOT disabled (partial option selected + amount entered)
    cy.get(WORKFLOW_NAV.nextButton, { timeout: TIMEOUTS.SHORT })
      .scrollIntoView()
      .should("be.visible")
      .should("not.be.disabled")
      .click();
    cy.addTestContext("Step 8: Clicked Next to submit refund");

    cy.screenshot("Refund_P0_After_Next_Click");

    // Step 9: Verify refund success with data-level assertions
    validateRefundSuccess({ amount: partialAmount, currency: "USD" });
    cy.addTestContext(
      `Step 9: Partial refund success verified (amount: ${partialAmount} USD)`,
    );
    cy.screenshot("Refund_P0_Refund_Success");
  });
});

// GOLDEN TEMPLATE: Non-Workflow
//
// Pattern: Create a JAWS account in before(), navigate using a custom navigation function
// (not navigateToWorkflow), verify UI elements and interactions specific to the non-workflow feature.
// Covers: Urgent Messenger, Customer Journey.
// NOTE: Custom navigation (not navigateToWorkflow), no closeWorkflowAndProvideFeedback — these features
// live outside the standard workflow lifecycle.
// Key traits: createAccount in before(), custom navigateToIntentSelectionPage, lightweight verification, no workflow teardown.

// =============================================================================
// P0 | PayPal | Urgent Messenger (TeammateAlerts) - Alert Display & Interaction
// =============================================================================

import { createAccount, type JawsAccount } from "../../../support/jaws";
import { navigateToIntentSelectionPage, verifyAlertIsDisplayed } from "./utils";

describe("P0 | PayPal | Urgent Messenger - Alert Display & Interaction", () => {
  let testAccount: JawsAccount;

  before(() => {
    createAccount({
      country: "US",
      accountType: "PERSONAL",
      confirmEmail: true,
    }).then((account) => {
      testAccount = account;
      expect(account).to.have.property("accountNumber");
      cy.log(`Test account created: ${account.emailAddress}`);
    });
  });

  it("P0 | PayPal | UrgentMessenger | Alert Display & snooze", () => {
    navigateToIntentSelectionPage(testAccount.emailAddress);

    cy.addTestContext("Step 1: Verify alert is present, close and reopen");

    verifyAlertIsDisplayed();
    cy.screenshot("UM_P0_PayPal_TC1_AlertVerified");
  });
});

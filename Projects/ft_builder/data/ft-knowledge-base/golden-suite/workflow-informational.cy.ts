// GOLDEN TEMPLATE: Workflow — Informational/Read-Display
//
// Pattern: Create a JAWS account in before(), navigate to workflow, verify UI elements load correctly,
// perform a read-only action (send link, view data), verify success, then closeWorkflowAndProvideFeedback.
// Covers: Login/Password, Transaction Inquiry, Negative Balance, Suspicious Email patterns.
// Key traits: createAccount in before(), navigateToWorkflow, read/display verification, completeStepUp, closeWorkflowAndProvideFeedback.

/**
 * Login or Password Workflow - P0: Send Password Reset Link (PayPal)
 *
 * Tests the happy path: sending a password reset link to a verified email
 * when the password is NOT locked.
 *
 * Flow: Launch workflow -> Verify emails loaded -> Click Send Link ->
 *       Complete StepUp -> Verify success toast
 *
 * @see docs/FUNCTIONAL_TESTING_GUIDE.md for testing patterns
 */

import { LOGIN_PASSWORD, COMMON } from "../../../support/selectors";
import { TIMEOUTS, INTENTS } from "../../../support/constants";
import { createAccount, type JawsAccount } from "../../../support/jaws";
import {
  waitForWorkflowLoad,
  verifyEmailExists,
  clickSendLinkForEmail,
  verifyPasswordNotLocked,
} from "./utils";

describe("P0 - Send Password Reset Link (PayPal)", () => {
  let testAccount: JawsAccount;

  before(() => {
    createAccount({
      country: "US",
      accountType: "PERSONAL",
      emailPrefix: "lp-send-reset-ft",
      confirmEmail: true,
    }).then((account) => {
      testAccount = account;
      cy.log(`Test account created: ${account.emailAddress}`);
    });
  });

  it("P0 | PayPal | LoginPassword | Send Password Reset Link to Verified Email", () => {
    // PRE-FLOW: Navigate to Login or Password workflow
    cy.navigateToWorkflow(testAccount.emailAddress, INTENTS.LOGIN_PASSWORD);
    waitForWorkflowLoad();

    // =====================================================================
    // STEP 1: Verify workflow loaded with email list
    // =====================================================================
    cy.addTestContext(
      "Step 1: Verify Load - Checking workflow loaded with emails",
    );

    cy.get(LOGIN_PASSWORD.wrapper, { timeout: TIMEOUTS.MAX }).should(
      "be.visible",
    );

    // Verify activity log section is present
    cy.get(LOGIN_PASSWORD.activityLog, { timeout: TIMEOUTS.MEDIUM }).should(
      "exist",
    );

    cy.screenshot("LoginPassword_P0_SendResetLink_Step1_WorkflowLoaded");

    // =====================================================================
    // STEP 2: Verify password is NOT locked
    // =====================================================================
    cy.addTestContext(
      "Step 2: Verify Not Locked - Confirming password is not locked",
    );

    verifyPasswordNotLocked();

    cy.screenshot("LoginPassword_P0_SendResetLink_Step2_PasswordNotLocked");

    // =====================================================================
    // STEP 3: Verify email is displayed with verified status
    // =====================================================================
    cy.addTestContext(
      "Step 3: Verify Email - Checking email is displayed and verified",
    );

    verifyEmailExists(testAccount.emailAddress);

    // Verify the send link button is available
    cy.get(LOGIN_PASSWORD.emailRow)
      .contains(testAccount.emailAddress)
      .closest(LOGIN_PASSWORD.emailRow)
      .find(LOGIN_PASSWORD.sendLinkButton)
      .should("be.visible")
      .and("not.be.disabled");

    cy.screenshot("LoginPassword_P0_SendResetLink_Step3_EmailVerified");

    // =====================================================================
    // STEP 4: Click Send Link button
    // =====================================================================
    cy.addTestContext(
      "Step 4: Send Link - Clicking Send Link for verified email",
    );

    clickSendLinkForEmail(testAccount.emailAddress);

    cy.screenshot("LoginPassword_P0_SendResetLink_Step4_SendLinkClicked");

    // =====================================================================
    // STEP 5: Complete StepUp authentication
    // =====================================================================
    cy.addTestContext(
      "Step 5: StepUp Auth - Completing step-up authentication",
    );

    cy.completeStepUp("OVERRIDE");

    cy.screenshot("LoginPassword_P0_SendResetLink_Step5_StepUpCompleted");

    // =====================================================================
    // STEP 6: Verify success toast
    // =====================================================================
    cy.addTestContext(
      "Step 6: Verify Success - Checking password reset email sent",
    );

    // Toast message: "The reset password link is successfully sent to" + email
    cy.verifySuccessToast("The reset password link is successfully sent to");

    // Wait for spinner to disappear
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");

    cy.screenshot("LoginPassword_P0_SendResetLink_Step6_SuccessToast");

    // Close workflow and provide feedback
    cy.closeWorkflowAndProvideFeedback(5);
  });
});

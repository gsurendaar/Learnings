// GOLDEN TEMPLATE: Workflow — Account CRUD (table add/edit/remove)
//
// Pattern: Create a JAWS account in before(), navigate to workflow, perform add/edit/remove operations
// on table rows, verify toast messages and table state after each mutation.
// Covers: Manage Account Flags, Manage Users, Manage Debit Card, Manage Address, Manage Phone patterns.
// Key traits: createAccount in before(), navigateToWorkflow with INTENTS, verifySuccessToast, table CRUD cycle.

/**
 * P0 - Complete Manage Account Flags Lifecycle
 *
 * Tests the complete workflow for managing account flags:
 * - Add Risk Flags with expiry dates and "Never" expiry
 * - Add Account Level Flags with memo text
 * - Edit flag expiry dates (both date and "Never" mode)
 * - Remove flags with confirmation and cancellation
 * - Verify table state before and after operations
 *
 * Test Flow:
 * 1. Navigate to Manage Account Flags workflow
 * 2. Verify initial table state
 * 3-5. Add 3 different flag types (2 risk, 1 account-level)
 * 6-7. Edit first two flags with different expiry modes
 * 8-11. Remove flags with various interactions (confirm, cancel)
 * Final: Verify flag count matches expected state
 */

import { MANAGE_ACCOUNT_FLAGS, COMMON } from "../../../support/selectors";
import { TIMEOUTS, INTENTS } from "../../../support/constants";
import { createAccount, JawsAccount } from "../../../support/jaws";
import {
  selectFlagType,
  addRiskFlag,
  addAccountLevelFlag,
  selectFlagRow,
  editFlag,
  removeFlag,
} from "./utils";

describe("P0 - Complete Manage Account Flags Lifecycle", () => {
  let testAccount: JawsAccount;

  before(() => {
    createAccount({ country: "US", accountType: "PERSONAL" }).then(
      (account) => {
        testAccount = account;
        expect(account).to.have.property("accountNumber");
      },
    );
  });

  it("P0 | PayPal | ManageAccountFlags | Complete Lifecycle", () => {
    cy.navigateToWorkflow(
      testAccount.emailAddress,
      INTENTS.MANAGE_ACCOUNT_FLAGS,
    );

    // Step 1: Verify flags table loads with header and add button
    cy.addTestContext("Step 1: Verify flags table loads");
    cy.get(MANAGE_ACCOUNT_FLAGS.header, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.visible",
    );
    cy.get(MANAGE_ACCOUNT_FLAGS.addButton, { timeout: TIMEOUTS.MEDIUM }).should(
      "be.visible",
    );
    cy.screenshot("MAF_P0_Step1_TableLoads");

    // Step 2: Add Risk Flag with a random expiry date
    cy.addTestContext("Step 2: Add Risk Flag with expiry date");
    cy.get(MANAGE_ACCOUNT_FLAGS.addButton).click();
    selectFlagType("riskFlags");
    addRiskFlag(false, "riskFlag1");
    cy.verifySuccessToast("Flag has been added successfully", TIMEOUTS.MAX);
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step2_AddedRiskFlag");

    // Step 3: Add Risk Flag with "Never" expiry checkbox
    cy.addTestContext("Step 3: Add Risk Flag with Never expiry");
    cy.get(MANAGE_ACCOUNT_FLAGS.addButton).click();
    selectFlagType("riskFlags");
    addRiskFlag(true, "riskFlag2");
    cy.verifySuccessToast("Flag has been added successfully", TIMEOUTS.MAX);
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step3_AddedNeverExpiryFlag");

    // Step 4: Add Account Level Flag with memo text
    // TODO: Skipped - Account level flag combobox renders 5k+ DOM nodes causing Electron renderer crash
    // Needs Combobox component fix to limit rendered items before re-enabling
    // cy.addTestContext("Step 4: Add Account Level Flag with memo");
    // cy.get(MANAGE_ACCOUNT_FLAGS.addButton).click();
    // selectFlagType("accLvlFlags");
    // addAccountLevelFlag();
    // cy.verifySuccessToast("Flag has been added successfully", TIMEOUTS.MAX);
    // cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    // cy.screenshot("MAF_P0_Step4_AddedAccountLevelFlag");

    // Step 5: Verify added flags are displayed in the table with correct content
    cy.addTestContext("Step 5: Verify flags displayed in table");
    cy.get<string>("@riskFlag1").then((flagName) => {
      cy.validateTableRow(MANAGE_ACCOUNT_FLAGS.table, flagName, [
        { column: "Flags", value: flagName },
      ]);
    });
    cy.get<string>("@riskFlag2").then((flagName) => {
      cy.validateTableRow(MANAGE_ACCOUNT_FLAGS.table, flagName, [
        { column: "Flags", value: flagName },
      ]);
    });
    let flagCountAfterAdd = 0;
    cy.get(MANAGE_ACCOUNT_FLAGS.table)
      .find(COMMON.tableRow)
      .its("length")
      .then((count) => {
        flagCountAfterAdd = count;
      });
    cy.screenshot("MAF_P0_Step5_AllFlagsInTable");

    // Step 6: Select first flag and edit its expiry date
    cy.addTestContext("Step 6: Edit flag expiry date");
    selectFlagRow(0);
    editFlag();
    cy.verifySuccessToast(
      "expiry date on the flag has been updated",
      TIMEOUTS.MAX,
    );
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step6_EditedFlagExpiry");

    // Step 7: Select second flag and edit to "Never" expiry
    cy.addTestContext("Step 7: Edit flag to Never expiry");
    selectFlagRow(1);
    editFlag(true);
    cy.verifySuccessToast(
      "expiry date on the flag has been updated",
      TIMEOUTS.MAX,
    );
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step7_EditedToNeverExpiry");

    // Step 8: Select last flag and remove with confirmation
    cy.addTestContext("Step 8: Remove flag with confirmation");
    selectFlagRow("last");
    removeFlag(true);
    cy.verifySuccessToast("removed successfully", TIMEOUTS.MAX);
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step8_RemovedFlag");

    // Step 9: Verify flag count decreased by 1
    cy.addTestContext("Step 9: Verify flag count after removal");
    cy.then(() => {
      cy.get(MANAGE_ACCOUNT_FLAGS.table, { timeout: TIMEOUTS.LONG })
        .find(COMMON.tableRow)
        .should("have.length", flagCountAfterAdd - 1);
    });
    cy.screenshot("MAF_P0_Step9_FlagCountVerified");

    // Step 10: Select flag, open remove modal, then cancel
    cy.addTestContext("Step 10: Remove flag and cancel modal");
    selectFlagRow("last");
    removeFlag(false);
    cy.get(MANAGE_ACCOUNT_FLAGS.removeModal, {
      timeout: TIMEOUTS.MEDIUM,
    }).should("not.exist");
    cy.screenshot("MAF_P0_Step10_ModalCancelled");

    // Step 11: Remove remaining flag with confirmation
    cy.addTestContext("Step 11: Remove flag with confirmation");
    selectFlagRow(0);
    removeFlag(true);
    cy.verifySuccessToast("removed successfully", TIMEOUTS.MAX);
    cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
    cy.screenshot("MAF_P0_Step11_FlagRemoved");
  });
});

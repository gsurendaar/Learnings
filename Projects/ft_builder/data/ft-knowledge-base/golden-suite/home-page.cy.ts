// GOLDEN TEMPLATE: Home Page
//
// Pattern: Navigate directly to a home page tab (no account lookup, no JAWS setup, no case creation).
// Verify page layout, filters, table columns, and summary info.
// Covers: Account Search, Follow-ups, Escalation Search.
// NOTE: No JAWS setup, no case, no closeWorkflowAndProvideFeedback — these are standalone home page tests.
// Key traits: No createAccount/createExpressCheckout, navigateToHomeFollowUps (custom nav), conditional assertions for empty/data states.

/**
 * P0 - Home Follow-ups List Loads
 *
 * Test: Navigate to home page -> Verify Follow Ups tab loads as default
 * -> Verify table is visible with correct columns -> Verify Assigned To filter
 * -> Verify summary info displays count.
 *
 * Priority: P0 (Verify the home follow-ups list renders correctly)
 */

import { HOME_FOLLOW_UPS } from "../../../support/selectors";
import { TIMEOUTS } from "../../../support/constants";
import { waitForHomeFollowUpsLoad } from "./utils";

describe("P0 - Home Follow-ups List", () => {
  it("P0 | Home | FollowUps | Verify list loads with correct layout", () => {
    // ===== PRE-FLOW: Navigate to Home Follow Ups =====
    cy.addTestContext("Pre-flow: Navigate to Home Follow Ups tab");
    cy.navigateToHomeFollowUps();

    // ===== STEP 1: Verify container and table loaded =====
    cy.addTestContext("Step 1: Verify follow-ups container loaded");
    waitForHomeFollowUpsLoad();

    cy.get(HOME_FOLLOW_UPS.container).should("be.visible");
    cy.screenshot("HomeFollowUps_P0_List_Step1_ContainerLoaded");

    // ===== STEP 2: Verify Assigned To filter is visible and defaults to "Me" =====
    cy.addTestContext("Step 2: Verify Assigned To filter defaults to Me");

    cy.get(HOME_FOLLOW_UPS.assignedToFilter, { timeout: TIMEOUTS.MEDIUM })
      .should("be.visible")
      .find("input")
      .invoke("val")
      .should("match", /^Me/);

    cy.screenshot("HomeFollowUps_P0_List_Step2_AssignedToFilter");

    // ===== STEP 3: Verify table columns (if data exists) =====
    cy.addTestContext("Step 3: Verify table columns");

    cy.get(HOME_FOLLOW_UPS.tableContainer, { timeout: TIMEOUTS.MEDIUM }).then(
      ($container) => {
        if ($container.find("table").length > 0) {
          cy.get(HOME_FOLLOW_UPS.tableContainer)
            .find("table")
            .within(() => {
              cy.contains("th", "Comments").should("exist");
              cy.contains("th", "Due Date").should("exist");
              cy.contains("th", "Account").should("exist");
              cy.contains("th", "Case").should("exist");
              cy.contains("th", "Priority").should("exist");
              cy.contains("th", "Assigned to").should("exist");
            });
          cy.log("Table columns verified");
        } else {
          cy.log("No table rendered (empty state) — skipping column check");
        }
      },
    );

    cy.screenshot("HomeFollowUps_P0_List_Step3_ColumnsVerified");

    // ===== STEP 4: Verify Add Filter and Refresh buttons exist =====
    cy.addTestContext("Step 4: Verify control buttons exist");

    cy.get(HOME_FOLLOW_UPS.addFilterButton, { timeout: TIMEOUTS.SHORT }).should(
      "be.visible",
    );

    cy.get(HOME_FOLLOW_UPS.refreshButton, { timeout: TIMEOUTS.SHORT }).should(
      "be.visible",
    );

    cy.screenshot("HomeFollowUps_P0_List_Step4_ControlsVerified");

    // ===== STEP 5: Verify summary info shows count =====
    cy.addTestContext("Step 5: Verify summary info");

    // Summary may or may not be visible depending on data
    cy.get("body").then(($body) => {
      if ($body.find(HOME_FOLLOW_UPS.summaryInfo).length > 0) {
        cy.get(HOME_FOLLOW_UPS.summaryInfo)
          .should("be.visible")
          .invoke("text")
          .should("match", /Showing \d+ of \d+/);
        cy.log("Summary info visible with follow-up count");
      } else {
        cy.log("No summary info - table may be empty");
      }
    });

    cy.screenshot("HomeFollowUps_P0_List_Step5_SummaryVerified");
  });
});

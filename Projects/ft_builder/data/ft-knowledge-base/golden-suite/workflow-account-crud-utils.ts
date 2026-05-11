// GOLDEN TEMPLATE UTILS: Workflow — Account CRUD
//
// Patterns demonstrated:
// - Combobox interaction: addRiskFlag(), addAccountLevelFlag(), addVenmoFlag() show the standard pattern
//   for opening a combobox input, waiting for dropdown options to appear, and selecting an option
//   (random or first) with proper spinner waits after each interaction.
// - Row selection: selectFlagRow() demonstrates table row selection via checkbox with support for
//   index-based or "last" row targeting, followed by spinner guard.
// - Modal handling: removeFlag() shows the pattern for triggering a modal, asserting visibility,
//   then conditionally clicking confirm/cancel buttons.
// - Form helpers: editFlag() and date picker interactions demonstrate form manipulation with
//   conditional logic (e.g., neverExpire checkbox vs. date picker), using custom commands
//   like cy.selectDateFromPicker() for complex widget interactions.
// - Alias pattern: addRiskFlag() and addVenmoFlag() use cy.wrap().as() to store selected values
//   for later assertion in the test spec, enabling data-driven validation.

/**
 * Manage Account Flags Workflow - Shared Test Utilities
 *
 * Common helpers for managing account flags in end-to-end tests.
 * Includes functions for:
 * - Generating random dates for flag expiry
 * - Selecting and adding flags (risk, account-level, venmo)
 * - Editing flag expiry dates
 * - Removing flags with confirmation
 * - Verifying table state
 *
 * All flag operations assume rows are selected via selectFlagRow() before calling
 * edit/remove functions. Flag selection is done by checking row checkboxes, which
 * makes the edit/remove buttons appear in the action buttons row.
 */

import { MANAGE_ACCOUNT_FLAGS, COMMON } from "../../../support/selectors";
import { TIMEOUTS } from "../../../support/constants";

export const generateRandomExpiryDate = (
  minDays: number = 30,
  maxDays: number = 180,
): string => {
  const today = new Date();
  const daysOffset =
    Math.floor(Math.random() * (maxDays - minDays + 1)) + minDays;
  const expiryDate = new Date(
    today.getTime() + daysOffset * 24 * 60 * 60 * 1000,
  );
  const year = expiryDate.getFullYear();
  const month = String(expiryDate.getMonth() + 1).padStart(2, "0");
  const day = String(expiryDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

export const selectFlagRow = (rowIndex: number | "last" = 0) => {
  const rowSelector =
    rowIndex === "last"
      ? cy.get(MANAGE_ACCOUNT_FLAGS.table).find(COMMON.tableRow).last()
      : cy.get(MANAGE_ACCOUNT_FLAGS.table).find(COMMON.tableRow).eq(rowIndex);

  rowSelector.find(COMMON.tableCheckbox).check({ force: true });
  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
};

export const selectFlagType = (
  flagType: "riskFlags" | "accLvlFlags" | "venmoFlags",
) => {
  cy.get(MANAGE_ACCOUNT_FLAGS.addTypeRadios, {
    timeout: TIMEOUTS.MEDIUM,
  }).should("be.visible");

  cy.get(MANAGE_ACCOUNT_FLAGS.addTypeRadios)
    .find(COMMON.radioButton)
    .each(($radio) => {
      if ($radio.val() === flagType) {
        cy.wrap($radio).click({ force: true });
      }
    });

  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
};

export const addRiskFlag = (
  neverExpire: boolean = false,
  alias: string = "addedRiskFlag",
) => {
  cy.get(MANAGE_ACCOUNT_FLAGS.addRiskSelect, {
    timeout: TIMEOUTS.MEDIUM,
  }).should("be.visible");

  cy.get(MANAGE_ACCOUNT_FLAGS.addRiskSelect)
    .find(COMMON.comboboxInput)
    .click({ force: true });

  cy.get(COMMON.dropdownOption, { timeout: TIMEOUTS.MAX })
    .should("be.visible")
    .then(($options) => {
      const randomIndex = Math.floor(Math.random() * $options.length);
      cy.wrap($options.eq(randomIndex).text().trim()).as(alias);
      cy.wrap($options.eq(randomIndex)).click();
    });

  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");

  if (!neverExpire) {
    const expiryDate = generateRandomExpiryDate();
    cy.selectDateFromPicker(MANAGE_ACCOUNT_FLAGS.addRiskDatePicker, expiryDate);
  }

  if (neverExpire) {
    cy.get(MANAGE_ACCOUNT_FLAGS.addRiskNeverCheckbox, {
      timeout: TIMEOUTS.MEDIUM,
    }).check({ force: true });
  }

  cy.get(MANAGE_ACCOUNT_FLAGS.addRiskSubmitButton, {
    timeout: TIMEOUTS.MEDIUM,
  }).click();
};

export const addAccountLevelFlag = (
  memoText: string = "Test memo for account level flag",
) => {
  cy.get(MANAGE_ACCOUNT_FLAGS.addAccountLevelSelect, {
    timeout: TIMEOUTS.MEDIUM,
  }).should("be.visible");

  cy.get(MANAGE_ACCOUNT_FLAGS.addAccountLevelSelect)
    .find(COMMON.comboboxInput)
    .click({ force: true });

  cy.get(COMMON.dropdownOption, { timeout: TIMEOUTS.MAX })
    .should("be.visible")
    .first()
    .click();

  cy.get(MANAGE_ACCOUNT_FLAGS.addMemoInput, { timeout: TIMEOUTS.MEDIUM })
    .clear()
    .type(memoText);

  cy.get(MANAGE_ACCOUNT_FLAGS.addAccountLevelSubmitButton, {
    timeout: TIMEOUTS.MEDIUM,
  }).click();
};

export const addVenmoFlag = (alias: string = "addedVenmoFlag") => {
  cy.get(MANAGE_ACCOUNT_FLAGS.addVenmoSelect, {
    timeout: TIMEOUTS.MEDIUM,
  }).should("be.visible");

  cy.get(MANAGE_ACCOUNT_FLAGS.addVenmoSelect)
    .find(COMMON.comboboxInput)
    .click({ force: true });

  cy.get(COMMON.dropdownOption, { timeout: TIMEOUTS.MAX })
    .should("be.visible")
    .then(($options) => {
      const randomIndex = Math.floor(Math.random() * $options.length);
      // Dropdown shows "flagName (X Hrs)" but table shows just "flagName"
      const fullText = $options.eq(randomIndex).text().trim();
      const flagName = fullText.replace(/\s*\(\d+\s*Hrs\)$/, "");
      cy.wrap(flagName).as(alias);
      cy.wrap($options.eq(randomIndex)).click();
    });

  cy.get(MANAGE_ACCOUNT_FLAGS.addVenmoSubmitButton, {
    timeout: TIMEOUTS.MEDIUM,
  }).click();
};

export const editFlag = (neverExpire: boolean = false) => {
  cy.get(MANAGE_ACCOUNT_FLAGS.editButton, { timeout: TIMEOUTS.MEDIUM }).click();
  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");

  if (!neverExpire) {
    const newExpiryDate = generateRandomExpiryDate();
    cy.selectDateFromPicker(MANAGE_ACCOUNT_FLAGS.editDatePicker, newExpiryDate);
  }

  if (neverExpire) {
    cy.get(MANAGE_ACCOUNT_FLAGS.editNeverCheckbox, {
      timeout: TIMEOUTS.MEDIUM,
    }).check({ force: true });
  }

  cy.get(MANAGE_ACCOUNT_FLAGS.editUpdateButton, {
    timeout: TIMEOUTS.MEDIUM,
  }).click();
};

export const removeFlag = (confirmRemove: boolean = true) => {
  cy.get(MANAGE_ACCOUNT_FLAGS.removeButton, {
    timeout: TIMEOUTS.MEDIUM,
  }).click();

  cy.get(MANAGE_ACCOUNT_FLAGS.removeModal, { timeout: TIMEOUTS.MEDIUM }).should(
    "be.visible",
  );

  if (confirmRemove) {
    cy.get(MANAGE_ACCOUNT_FLAGS.removeConfirmButton, {
      timeout: TIMEOUTS.MEDIUM,
    }).click();
  } else {
    cy.get(MANAGE_ACCOUNT_FLAGS.removeCancelButton, {
      timeout: TIMEOUTS.MEDIUM,
    }).click();
  }
};

export const verifyTableIsEmpty = () => {
  cy.get(MANAGE_ACCOUNT_FLAGS.card, { timeout: TIMEOUTS.LONG }).should(
    "be.visible",
  );
  cy.get(MANAGE_ACCOUNT_FLAGS.table, {
    timeout: TIMEOUTS.SHORT,
  }).should("not.exist");
};

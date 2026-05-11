// GOLDEN TEMPLATE UTILS: Quick Tool
//
// Patterns demonstrated:
// - waitForLoad pattern: waitForNotesLoad() shows the standard quick-tool load guard — spinner wait,
//   error toast assertion, and header existence check — ensuring the tool is fully interactive before
//   any test actions run.
// - Editor interactions: typeInEditor() and clearEditorContent() demonstrate the pattern for
//   contenteditable rich-text editors — scrollIntoView, click to focus, selectall+backspace to clear,
//   type with delay for heavy DOM pages, and trigger("input") to force React state sync.
// - Search helpers: searchByKeyword() shows the input-clear-type-enter-spinnerWait pattern used
//   for any search/filter input that triggers an API call.
// - installSafeJsonStringify: A defensive utility called once per spec in before() to prevent
//   allure-cypress from crashing when serializing DOM elements — a pattern needed whenever
//   Cypress commands return complex objects that reporting tools try to JSON.stringify.

/**
 * Notes Quick Tool - Shared Test Utilities
 *
 * Common helpers for interacting with the Notes quick tool in end-to-end tests.
 * Includes functions for:
 * - Waiting for page load
 * - Rich text editor interactions (type, clear)
 * - Keyword search
 * - Intent dropdown selection
 *
 * All selectors use data-automation-id via centralized NOTES/COMMON selectors.
 * All timeouts use centralized TIMEOUTS constants.
 *
 * @see cypress/e2e/quick-tools/notes/p0-paypal-notes-view-load.cy.ts
 * @see cypress/e2e/quick-tools/notes/p1-venmo-notes-view-load.cy.ts
 */

import { NOTES, COMMON } from "../../../support/selectors";
import { TIMEOUTS } from "../../../support/constants";

// =============================================================================
// Allure-safe JSON.stringify override
// =============================================================================

/**
 * Override JSON.stringify to prevent allure-cypress from crashing
 * when it attempts to serialize DOM elements from Cypress commands.
 * Must be called once per spec file in before() hook.
 */
export const installSafeJsonStringify = () => {
  const originalStringify = JSON.stringify;
  JSON.stringify = function (value: any, replacer?: any, space?: any) {
    try {
      return originalStringify(value, replacer, space);
    } catch {
      return '"[Circular or non-serializable]"';
    }
  };
};

// =============================================================================
// Page Load Helpers
// =============================================================================

/**
 * Wait for notes page to load (spinner gone, header exists, no errors).
 */
export const waitForNotesLoad = () => {
  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
  assertNoErrorToast();
  cy.get(NOTES.header, { timeout: TIMEOUTS.LONG }).should("exist");
};

// =============================================================================
// Rich Text Editor Helpers
// =============================================================================

/**
 * Type text into the RichTextEditor.
 * Scrolls into view, focuses, clears via keyboard, types text, and triggers
 * an input event to ensure React state updates on heavy DOM pages.
 * @param text - The text to type into the editor
 */
export const typeInEditor = (text: string) => {
  cy.get(`${NOTES.editor} [contenteditable="true"]`, {
    timeout: TIMEOUTS.MEDIUM,
  })
    .first()
    .scrollIntoView()
    .should("be.visible")
    .click({ force: true })
    .type("{selectall}{backspace}", { force: true })
    .type(text, { delay: 50, force: true })
    .trigger("input", { force: true });
};

/**
 * Clear text from the RichTextEditor.
 * Scrolls into view, focuses, and clears via keyboard with explicit input trigger.
 */
export const clearEditorContent = () => {
  cy.get(`${NOTES.editor} [contenteditable="true"]`, {
    timeout: TIMEOUTS.MEDIUM,
  })
    .first()
    .scrollIntoView()
    .click({ force: true })
    .type("{selectall}{backspace}", { force: true })
    .trigger("input", { force: true });
};

// =============================================================================
// Keyword Search Helpers
// =============================================================================

/**
 * Type keyword in search input and press Enter.
 * Waits for spinner to disappear after search completes.
 * @param keyword - The search term
 */
export const searchByKeyword = (keyword: string) => {
  cy.get(NOTES.keywordSearchInput, { timeout: TIMEOUTS.MEDIUM })
    .should("exist")
    .clear({ force: true })
    .type(`${keyword}{enter}`, { force: true });

  cy.get(COMMON.spinner, { timeout: TIMEOUTS.MAX }).should("not.exist");
};

// =============================================================================
// Intent Dropdown Helpers
// =============================================================================

/**
 * Open intent dropdown and select the first option.
 */
export const selectFirstIntent = () => {
  cy.get(NOTES.intentTrigger, { timeout: TIMEOUTS.MEDIUM })
    .should("be.visible")
    .click();

  cy.get(NOTES.intentOption, { timeout: TIMEOUTS.SHORT })
    .should("have.length.greaterThan", 0)
    .first()
    .click({ force: true });
};

// =============================================================================
// Toast Helpers
// =============================================================================

/**
 * Assert that no Notes error alert is present on the page.
 * If an error alert exists, the test FAILS with the error message.
 * This is a hard assertion — errors must not be silently swallowed.
 */
export const assertNoErrorToast = () => {
  cy.get(NOTES.errorAlert, { timeout: TIMEOUTS.SHORT }).should("not.exist");
};

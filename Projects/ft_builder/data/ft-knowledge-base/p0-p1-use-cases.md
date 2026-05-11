# SparkX Workflow P0 & P1 Use Cases — Functional Test Knowledge Base

**Source:** [Confluence: Workflow P0 P1 use cases and Function Test Cases](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2823014029)
**Last Updated:** March 2026 | **Environment:** QA

---

## Table of Contents

1. [Non-Workflow — Low Level Authentication (LLA)](#1-non-workflow--low-level-authentication-lla)
2. [Non-Workflow — Intent Selection](#2-non-workflow--intent-selection)
3. [Workflow — Login or Password](#3-workflow--login-or-password)
4. [Workflow — Manage Phone](#4-workflow--manage-phone)
5. [Workflow — Manage Address](#5-workflow--manage-address)
6. [Workflow — Manage Debit Card](#6-workflow--manage-debit-card)
7. [Workflow — Send / Receive Money](#7-workflow--send--receive-money)
8. [Workflow — Payment Declined](#8-workflow--payment-declined)
9. [Workflow — Refund](#9-workflow--refund)
10. [Workflow — Disputes — Chargeback & Claims](#10-workflow--disputes--chargeback--claims)
11. [Workflow — Account Takeover (Venmo ATO)](#11-workflow--account-takeover-venmo-ato)
12. [Workflow — Single / Mass Reversal](#12-workflow--single--mass-reversal)
13. [Workflow — Manage Account Flags](#13-workflow--manage-account-flags)
14. [Workflow — Manage Users](#14-workflow--manage-users)
15. [Workflow — ManagePayLater](#15-workflow--managepaylater)
16. [Test Account Reference — Send/Receive Money](#16-test-account-reference--sendreceive-money)

---

## 1. Non-Workflow — Low Level Authentication (LLA)

**Confluence:** [LLA P0/P1 Use Cases](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2884002530)
**Environment:** QA | **Test Accounts:** JAWS (fresh) + pre-existing legacy

### Overview
Covers PDA Case Creation (auto-auth via Email and Voice), Regular 3-step manual LLA for PayPal and Venmo, and Special Account Handling (CSM managed, Partner managed, Secondary user, Auth in Absentia, Skip Validation).

---

### PART 1: PDA Case Creation

#### Use Case 1 — Email Auto-Auth (P0)
**Objective:** PDA LOAD_ACCOUNT with EMAIL channel creates a case with EMAIL auto-auth context.
**Test Account:** JAWS `emailPrefix: "pda-email-ft"`
**Test File:** `pda-case-creation/p0-email-auto-auth-jaws.cy.ts`

**Steps:**
1. Create account via JAWS
2. Send PDA LOAD_ACCOUNT message with EMAIL channel
3. Verify case created with correct auth context
4. Verify EMAIL auto-auth bypasses manual LLA steps
5. Verify transition to Intent Selection

**Expected Results:** Case created via PDA; auth context shows EMAIL; auto-auth bypasses manual LLA; navigates to Intent Selection.

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P0-001-A | Create account via JAWS | Account created |
| TC-LLA-P0-001-B | Send PDA LOAD_ACCOUNT with EMAIL channel | Case created |
| TC-LLA-P0-001-C | Verify EMAIL auto-auth context | Auth context correct |
| TC-LLA-P0-001-D | Verify transition to Intent Selection | Intent Selection page visible |

---

#### Use Case 2 — Voice VoiceBio Auto-Auth (P0)
**Objective:** PDA with VOICE channel + voicebio_auth_status=true creates VOICE_AUTH context.
**Test Account:** JAWS `emailPrefix: "pda-voicebio-ft"`
**Test File:** `pda-case-creation/p0-voice-voicebio-auto-auth-jaws.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P0-002-A | Create account via JAWS | Account created |
| TC-LLA-P0-002-B | Send PDA with VOICE + VoiceBio | Case created |
| TC-LLA-P0-002-C | Verify VOICE_AUTH context | Auth context correct |

---

#### Use Case 3 — Voice IVR Partial Auth (P1)
**Objective:** PDA with VOICE channel but NO voicebio creates IVR partial auth context.
**Test Account:** JAWS `emailPrefix: "pda-ivr-ft"`
**Test File:** `pda-case-creation/p1-voice-ivr-partial-auth-jaws.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-003-A | Create account via JAWS | Account created |
| TC-LLA-P1-003-B | Send PDA with VOICE (no VoiceBio) | Case created |
| TC-LLA-P1-003-C | Verify IVR partial auth context | Partial auth applied |

---

### PART 2: Regular LLA Verification — PayPal

#### Use Case 4 — Complete 3-Step Manual Auth (P0)
**Objective:** Agent manually completes all 3 LLA steps (Name, Phone/Email, Additional Info) and transitions to Intent Selection.
**Test Account:** JAWS `emailPrefix: "lla-3step-ft"` with bank and credit card
**Test File:** `regular-lla-verification/p0-paypal-lla-complete-3step-auth-jaws.cy.ts`

**Steps:**
1. Create account via JAWS with bank and credit card
2. Skip SSO, create case, search for account
3. Verify LLA page loads with Next button
4. Complete Step 1: Name verification — select name radio, verify "verified"
5. Complete Step 2: Phone/Email verification — select option, verify "verified"
6. Complete Step 3: Additional Information — select option (bank/card), verify "verified"
7. Click Next — verify "Authentication successful" toast
8. Verify transition to Intent Selection

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P0-004-A | Create account with bank + card via JAWS | Account created with funding instruments |
| TC-LLA-P0-004-B | Navigate to LLA page | LLA loads, Next button visible |
| TC-LLA-P0-004-C | Complete Step 1: Name verification | Step 1 shows "verified" |
| TC-LLA-P0-004-D | Complete Step 2: Phone/Email verification | Step 2 shows "verified" |
| TC-LLA-P0-004-E | Complete Step 3: Additional Info verification | Step 3 shows "verified" |
| TC-LLA-P0-004-F | Click Next after all steps verified | "Authentication successful" toast |
| TC-LLA-P0-004-G | Verify Intent Selection page loads | Intent Selection page visible |

---

#### Use Case 5 — Auth in Absentia (P1)
**Objective:** Agent selects "Continue without validation" checkbox to bypass LLA.
**Test File:** `regular-lla-verification/p1-paypal-lla-auth-in-absentia-jaws.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-005-A | Select Continue without validation | Checkbox checked, Next enabled |
| TC-LLA-P1-005-B | Verify Skip Validation unchecked (mutual exclusion) | Skip Validation auto-unchecked |
| TC-LLA-P1-005-C | Click Next and verify Intent Selection | Navigates to Intent Selection |

---

#### Use Case 6 — Skip Validation (Stale / Stolen Financial) (P1)
**Objective:** Agent selects "Stale / Stolen Financial" checkbox to skip validation.
**Test File:** `regular-lla-verification/p1-paypal-lla-skip-validation-jaws.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-006-A | Select Stale / Stolen Financial | Checkbox checked, Next enabled |
| TC-LLA-P1-006-B | Verify Auth in Absentia unchecked | Mutual exclusion works |
| TC-LLA-P1-006-C | Click Next and verify Intent Selection | Navigates to Intent Selection |

---

#### Use Case 7 — CSM Managed Account (P1)
**Objective:** System displays access restricted error screen for CSM managed accounts.
**Test Account:** Pre-existing `LLA_TEST_ACCOUNTS.PAYPAL_CSM_MANAGED`
**Test File:** `regular-lla-verification/p1-paypal-lla-csm-managed.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-007-A | Search CSM managed account | Error screen appears |
| TC-LLA-P1-007-B | Verify managed account title | "This is a Managed Account!" visible |
| TC-LLA-P1-007-C | Verify CSM referral message | Referral instructions shown |

---

#### Use Case 8 — Partner Managed Account (P1)
**Test Account:** Pre-existing `LLA_TEST_ACCOUNTS.PAYPAL_PARTNER_MANAGED`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-008-A | Search partner managed account | Error screen appears |
| TC-LLA-P1-008-B | Verify title | "This is a Partner Managed Account!" visible |
| TC-LLA-P1-008-C | Verify restriction message | Restriction info shown |

---

#### Use Case 9 — Secondary User (P1)
**Objective:** LLA Step 1 displays both primary and secondary user names.
**Test Account:** Pre-existing `LLA_TEST_ACCOUNTS.PAYPAL_SECONDARY_USER`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P1-009-A | Search secondary user account | LLA page loads |
| TC-LLA-P1-009-B | Verify Step 1 shows primary name | "Douglas Carl" visible |
| TC-LLA-P1-009-C | Verify Step 1 shows secondary name | "user477450105896" visible |

---

### PART 3: Regular LLA Verification — Venmo

#### Use Case 10 — Venmo 3-Step Auth — Bank & CIP (P0)
**Test Account:** Pre-existing Venmo account `4802021553685488570`
**Test File:** `regular-lla-verification/p0-venmo-lla-3step-auth-bank-cip.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P0-010-A | Search Venmo account | LLA page loads |
| TC-LLA-P0-010-B | Verify Step 3 has Bank + CIP options | Both options visible |
| TC-LLA-P0-010-C | Select CIP and complete auth | Authentication successful |

---

#### Use Case 11 — Venmo 3-Step Auth — Card & Bank (P0)
**Test Account:** Pre-existing Venmo account `4778941100452256626`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-LLA-P0-011-A | Search Venmo account | LLA page loads |
| TC-LLA-P0-011-B | Verify Step 3 has Card + Bank options | Both options visible |
| TC-LLA-P0-011-C | Select Bank and complete auth | Authentication successful |

---

### LLA Test Execution Summary
- **P0:** TC-LLA-P0-001 (Email Auto-Auth), TC-LLA-P0-002 (VoiceBio), TC-LLA-P0-004 (3-Step Manual), TC-LLA-P0-010 (Venmo Bank & CIP), TC-LLA-P0-011 (Venmo Card & Bank)
- **P1:** TC-LLA-P1-003 (IVR Partial), TC-LLA-P1-005 (Auth in Absentia), TC-LLA-P1-006 (Skip Validation), TC-LLA-P1-007 (CSM Managed), TC-LLA-P1-008 (Partner Managed), TC-LLA-P1-009 (Secondary User)
- **Total:** 5 P0 + 6 P1 = 11 use cases, ~40 functional test cases

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/low-level-authentication/**/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/low-level-authentication/pda-case-creation/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/low-level-authentication/regular-lla-verification/*.cy.ts"
```

---

## 2. Non-Workflow — Intent Selection

**Confluence:** [Intent Selection P0/P1 Use Cases](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2884002574)
**Environment:** QA | **Test Accounts:** JAWS (fresh) + Pre-existing Venmo accounts

### Overview
Covers Page Structure & Card Selection (P0), Search & Navigation (P1), Account Type Variations (P1), and Advanced Features (P2).

---

### PART 1: Page Structure & Card Selection

#### Use Case 1 — Page Structure Verification (P0)
**Objective:** Verify Intent Selection page displays Recommended and Supported sections with required UI elements.
**Test Account:** JAWS `emailPrefix: "intent-page-structure-ft"`
**Test File:** `p0-paypal-intent-page-structure.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P0-001-A | Navigate to Intent Selection | Page loads successfully |
| TC-IS-P0-001-B | Verify Recommended Intents section | Section visible with cards |
| TC-IS-P0-001-C | Verify Supported Intents section | Section visible with cards |
| TC-IS-P0-001-D | Verify both Next buttons | Two Next buttons present |
| TC-IS-P0-001-E | Verify Incidents section | Section present |

---

#### Use Case 2 — Card Selection (P0)
**Objective:** Selecting a card shows checkmark; clicking another moves the checkmark (single selection).
**Test File:** `p0-paypal-intent-card-selection.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P0-002-A | Click first intent card | Checkmark appears |
| TC-IS-P0-002-B | Click different card | Checkmark moves |
| TC-IS-P0-002-C | Verify single selection | Only one card selected |

---

### PART 2: Search & Navigation

#### Use Case 3 — Combobox Search (P1)
**Test File:** `p1-paypal-intent-combobox-search.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-003-A | Click combobox to open dropdown | Intent list visible |
| TC-IS-P1-003-B | Type to filter intents | List filters correctly |
| TC-IS-P1-003-C | Select intent from combobox | Single card shown with checkmark |

---

#### Use Case 4 — Max Cards and Load More (P1)
**Objective:** Initial display shows 4 cards; Load More button adds 4 additional cards.

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-004-A | Verify initial 4 cards shown | Exactly 4 cards visible |
| TC-IS-P1-004-B | Verify Load More button visible | Button present |
| TC-IS-P1-004-C | Click Load More | 4 additional cards shown (total 8) |

---

#### Use Case 5 — Recommended Intent Launch (P1)
| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-005-A | Verify recommended section has cards | Cards visible |
| TC-IS-P1-005-B | Click recommended card | Checkmark appears |
| TC-IS-P1-005-C | Click Recommended Next button | Workflow launches |

---

#### Use Case 6 — Stolen Financials (P1)
**Objective:** Skip Validation checkbox hides Recommended section and restricts intents to ~10.

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-006-A | Select Skip Validation checkbox | Recommended section hidden |
| TC-IS-P1-006-B | Verify restricted intent count | ~10 intents shown |
| TC-IS-P1-006-C | Verify both LLA checkboxes present | Checkboxes visible |

---

### PART 3: Account Type Variations

#### Use Case 7 — Business vs Personal (P1)
**Objective:** Business accounts have equal or more intents than personal accounts.

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-007-A | Create Personal account and count intents | Intent count recorded |
| TC-IS-P1-007-B | Create Business account and count intents | Intent count recorded |
| TC-IS-P1-007-C | Compare: Business >= Personal | Business has equal or more intents |

---

#### Use Case 8 — Venmo — No Recommended Section (P1)
**Objective:** Venmo accounts have NO Recommended section, NO Settings/Gear icon, only Supported Intents in alphabetical order.
**Test Account:** Pre-existing `VENMO_TEST_ACCOUNTS.PERSONAL`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-008-A | Navigate Venmo to Intent Selection | Page loads |
| TC-IS-P1-008-B | Verify NO Recommended section | Section absent |
| TC-IS-P1-008-C | Verify NO Settings/Gear icon | Icon absent |
| TC-IS-P1-008-D | Verify Supported Intents only | Alphabetical order |

---

#### Use Case 9 — Venmo — No Stolen Financials (P1)
**Objective:** Venmo LLA has NO Skip Validation checkbox, only Auth in Absentia.

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-IS-P1-009-A | Search Venmo account and load LLA | LLA page loads |
| TC-IS-P1-009-B | Verify Skip Validation checkbox ABSENT | Not present |
| TC-IS-P1-009-C | Verify Auth in Absentia present | Checkbox visible |

---

### Intent Selection Test Execution Summary
- **P0:** TC-IS-P0-001 (Page Structure), TC-IS-P0-002 (Card Selection)
- **P1:** TC-IS-P1-003 through TC-IS-P1-009
- **P2 (not P0/P1):** Auth in Absentia Both Sections, Double-Click Auto-Launch, Favorites Modal
- **Total:** 2 P0 + 7 P1 + 3 P2 = 12 use cases, ~45 functional test cases

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/intent-selection/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/intent-selection/p0-*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/intent-selection/p1-*.cy.ts"
```

---

## 3. Workflow — Login or Password

**Confluence:** [Workflow - Login or Password](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822949335)

### PayPal Use Cases

#### Use Case 1 — Send Password Reset Link to Verified Email (P0)
Navigate to Login or Password workflow, verify email list with verified/unverified status, send reset link to verified email, complete Step-Up Authentication (OVERRIDE), verify success toast: `"The reset password link is successfully sent to {email}"`, verify Activity Log visible.
**Test Account:** Fresh JAWS Personal account with confirmed email.

#### Use Case 2 — Unlock Password and Send Reset Link (P0)
Navigate with locked password account, verify "Password Locked" banner, click "Unlock Password and Send Link", complete Step-Up (OVERRIDE), verify success toast: `"The password is successfully unlocked"`, verify locked banner disappears.
**Test Account:** Fresh JAWS account (locked via `cy.lockPassword()` before test).

#### Use Case 3 — Unlock Password Only (No Email Send) (P0)
Navigate with locked account, click standalone "Unlock Password" button (no email send), verify success toast: `"The password is successfully unlocked"`, verify locked banner disappears, verify Unlock Password button no longer visible, verify Send Link button label returns to normal.

#### Use Case 4 — Unverified Email Cannot Send Password Reset Link (P0)
Navigate with account having unverified email, verify unverified email indicator on email row, verify Send Link button does NOT exist for unverified email, verify "Manage Email" link is visible, click to navigate to email management.
**Test Account:** Fresh JAWS account created with `confirmEmail: false`.

### Venmo Use Cases
**Test Accounts:** Hardcoded legacy Venmo Personal account (JAWS does not support Venmo creation).

#### Use Case 1 — Send Password Reset Link for Personal Account (P0)
Verify Send Link (Venmo) button visible, click it, verify Venmo modal: `"Are you sure you want to reset this user"`, click Confirm, verify success toast contains `"reset password"`.

#### Use Case 2 — Generate MFA Code for Personal Account (P0)
Verify Account Tags section visible, verify Generate MFA button visible, click it, verify modal: `"Are you sure you want to generate a MFA code"`, confirm, verify success toast: `"A new OTP was successfully created and emailed to this user."`.

#### Use Case 3 — Verify Account Tags Section Visible (Venmo Only) (P0)
Verify Account Tags header visible, verify tag rows displayed, verify Add Tag and Remove Tag buttons available.

---

## 4. Workflow — Manage Phone

**Confluence:** [Workflow - Manage Phone](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822923708)
**Coverage:** 86% (31/36 use cases) | **Status:** 6 Passed, 1 Failed, 1 Skipped

### Executive Summary
- ✅ Automated (Passed) — 6 PayPal specs
- 🔶 Failed — Confirm/Unconfirm flow (phone code verification issue)
- ⏭️ Skipped — Venmo Business (code issue)
- ❌ Manual Only — 4 PayPal features (OTHER phone type, make primary from detail, SMS Logs, resend code)

### PayPal Feature Inventory (All P1)

| Feature | Status | Spec File | Test Data |
|---------|--------|-----------|-----------|
| Add MOBILE phone | ✅ | `p1-paypal-phone-validate-invalidate.cy.ts` | Fresh JAWS |
| Add WORK phone (with extension) | ✅ | `p1-paypal-phone-work-home-lifecycle.cy.ts` | Fresh JAWS |
| Add HOME phone | ✅ | `p1-paypal-phone-work-home-lifecycle.cy.ts` | Fresh JAWS |
| Add phone as Primary | ✅ | `p1-paypal-phone-primary-remove-reactivate.cy.ts` | Fresh JAWS |
| Add phone with Landline type | ✅ | `p1-paypal-phone-landline-type-changes.cy.ts` | Fresh JAWS |
| Invalidate / Validate phone | ✅ | `p1-paypal-phone-validate-invalidate.cy.ts` | Fresh JAWS |
| Confirm phone (SMS verification) | 🔶 FAILED | `p1-paypal-phone-confirm-unconfirm.cy.ts` | Fresh JAWS |
| Unconfirm phone | ✅ | `p1-paypal-phone-confirm-unconfirm.cy.ts` | Fresh JAWS |
| Remove phone | ✅ | `p1-paypal-phone-primary-remove-reactivate.cy.ts` | Fresh JAWS |
| Reactivate removed phone | ✅ | `p1-paypal-phone-primary-remove-reactivate.cy.ts` | Fresh JAWS |
| Change phone type (MOBILE/HOME/WORK) | ✅ | `p1-paypal-phone-update-phone-details.cy.ts` | Fresh JAWS |
| Update Auto-dial preference | ✅ | `p1-paypal-phone-update-phone-details.cy.ts` | Fresh JAWS |

### Key Verification Steps (P1 — PayPal — Add, Invalidate, Validate) ✅ PASSED
**Spec:** `p1-paypal-phone-validate-invalidate.cy.ts` | **Duration:** 131s
**Test Account:** JAWS email prefix `manage-phone-p1-validate-ft`

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Manage Phone, verify table loads | Phone table visible with JAWS primary phone |
| 2 | Add Phone → Step-up OVERRIDE → Verbatim "I agree" → Fill MOBILE form → Add | Toast: "Phone number added successfully" |
| 3 | Row action → Invalidate → Confirm → View Details | Toast: "marked as invalid successfully"; Status = "INVALID" |
| 4 | Back → Row action → Validate → Confirm → Step-up OVERRIDE → View Details | Toast: "marked as valid successfully"; Status = "VALID" |
| 5 | Close workflow with 5-star feedback | Workflow closed |

### Key Verification Steps (P1 — PayPal — Add as Primary, Remove, Re-Activate) ✅ PASSED
**Duration:** 140s

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to workflow, capture JAWS phone | Phone table with primary JAWS phone |
| 2 | Add Phone → Step-up → Verbatim → MOBILE + Make Primary → Add | New phone has primary icon; JAWS phone loses primary |
| 3 | Remove new primary → Select JAWS as new primary → Confirm | JAWS phone becomes primary; removed phone gone from Active |
| 4 | Navigate to Inactive tab | Removed phone visible |
| 5 | Activate → Confirm → Step-up OVERRIDE | Toast: "Phone detail has been updated successfully" |
| 6 | Navigate to Active tab | Reactivated phone back; not primary; unconfirmed badge |

### Toast Message Reference

| Action | Toast Message |
|--------|---------------|
| Add phone | "Phone number added successfully" |
| Update phone details | "Phone detail has been updated successfully." |
| Validate | "Phone number (+1) XXXXXXXXXX has been marked as valid successfully" |
| Invalidate | "Phone number (+1) XXXXXXXXXX has been marked as invalid successfully" |
| Confirm | "Phone number (+1) XXXXXXXXXX has been confirmed successfully" |
| Unconfirm | "Phone number (+1) XXXXXXXXXX has been marked as unconfirmed successfully" |
| Remove | "Phone number (+1) XXXXXXXXXX has been removed successfully" |
| Send code | "A verification code has been sent to ******XXXX" |

### PayPal vs Venmo Differences

| Feature | PayPal | Venmo Personal | Venmo Business |
|---------|--------|----------------|----------------|
| Tabs | Active + Inactive | Active + Inactive | Active only |
| Table Columns | Phone, Type, Validation, Actions | Phone, Confirmation, Actions | Phone, Confirmation, Actions |
| Row Actions (Active) | View, Validate, Invalidate, Remove, Unconfirm | Confirm/Unconfirm only | Confirm/Unconfirm only |
| Add Form | Full (type, extension, SMS pref) | Simplified (number only) | Simplified (number only) |
| DNC Toggle | Yes | No | No |

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/manage-phone/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/manage-phone/p1-paypal-*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/manage-phone/p1-venmo-*.cy.ts"
```

---

## 5. Workflow — Manage Address

**Confluence:** [Workflow - Manage Address](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822923644)
**Coverage:** 81% (21/26 use cases) | **Status:** 7 Passed, 1 Failed

### PayPal Feature Inventory (All P1 unless noted)

| Feature | Status | Spec File |
|---------|--------|-----------|
| Add home/work address | ✅ Automated | `p1-paypal-addr-add-make-primary.cy.ts` |
| Add address with Confirm checkbox | ✅ Automated | `p1-paypal-addr-delete-primary.cy.ts` |
| Add address with Primary checkbox | ✅ Automated | `p1-paypal-addr-delete-primary.cy.ts` |
| Validate address and override | ✅ Automated | `p1-paypal-addr-add-make-primary.cy.ts` |
| View address details | ✅ Automated | `p1-paypal-addr-view-confirm-address.cy.ts` |
| Edit address (update lines & postal) | ✅ Automated | `p1-paypal-addr-view-edit-address.cy.ts` |
| Confirm address (via detail view) | ✅ Automated | `p1-paypal-addr-view-confirm-address.cy.ts` |
| Make address primary (via row action) | ✅ Automated | `p1-paypal-addr-add-make-primary.cy.ts` |
| Delete address | ✅ Automated (P2) | `p2-paypal-addr-add-delete-reactivate.cy.ts` |
| Delete primary address (select new primary) | ✅ Automated | `p1-paypal-addr-delete-primary.cy.ts` |
| Reactivate deleted address | ✅ Automated (P2) | `p2-paypal-addr-add-delete-reactivate.cy.ts` |
| Link financial instruments to address | ❌ Manual | — |
| View Invoice / Shipping tabs | ❌ Manual | — |

### Key Steps: Add Home/Work Address
1. Navigate to Manage Address → table loads
2. Click **Add New Address** → select `HOME_OR_WORK` type
3. Enter address line 1, postal code → click **Lookup** → select city/state from results
4. Click **Validate Address** → if warning: check **Override Validation**
5. Click **Save Address** → Toast: `"Address added successfully"`; address appears with Unconfirmed badge

---

## 6. Workflow — Manage Debit Card

**Confluence:** [Workflow - Manage Debit Card](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822987078)
**Account Setup:** JAWS US account + SSN Document + Cash Plus subscription (PayPal); Existing QA Venmo accounts

### Use Cases

#### UC1 — PayPal Personal — Issue New Card + Activate Card (P0)
**Objective:** Issue a new PayPal debit card and activate it. If no confirmed address exists, confirm one via Manage Address first.

**Key Steps:**
1. Open Manage Debit Card → Account Information tab active
2. Click **Issue New Card** → modal opens with address list
3. If no confirmed address: click "Manage Address" link → confirm address via three-dot menu → Step-up OVERRIDE → close tab → Refresh
4. Re-open Issue New Card → confirmed address radio button selected → click **Submit** → Toast: `"processed successfully"`
5. New card appears in debit cards table
6. Three-dot menu → **Activate** → Enter full card number → **Validate** → **Activate** → Toast: `"activated successfully"`
7. Click Next → 5-star rating → workflow closes

| S.NO | Test Case | Expected Result | FT |
|------|-----------|-----------------|-----|
| 1 | Open Manage Debit Card | Page loads with Account Information tab | Yes |
| 2 | Click Issue New Card | Modal opens with address list | Yes |
| 3 | If no confirmed address: use Manage Address link | Manage Address opens in new tab | Yes |
| 4 | Confirm address via three-dot menu + Step-up | Toast: "confirmed" | Yes |
| 5 | Close Manage Address tab, Refresh, re-open modal | Confirmed address radio button selected | Yes |
| 6 | Submit Issue New Card | Toast: "processed successfully"; card in table | Yes |
| 7 | Activate card — enter card number, Validate, Activate | Toast: "activated successfully" | Yes |
| 8 | Complete workflow with 5-star rating | Wrap-up screen shown | Yes |

#### UC2 — PayPal Personal — Full Card Lifecycle (P0)
Full card lifecycle: issue, activate, lock, unlock, replace card.

#### UC3 — PayPal Personal — Direct Deposit (P0)
View and manage Direct Deposit settings for the debit card.

#### UC4 — PayPal Personal — Card Details, Campaigns, Limits, and PIN (P0)
View card details, campaign info, spending limits, and PIN status.

#### UC7 — PayPal Business — Issue Primary + Secondary Cards (P0)
Issue debit card for Business account — primary and secondary cards.

#### UC9 — Venmo — Page Load and Layout Verification (P1)
Verify Venmo debit card page structure and layout elements.

#### UC10 — Venmo — Card Actions (P1)
Perform Venmo-specific card actions (lock/unlock, replace).

---

## 7. Workflow — Send / Receive Money

**Confluence:** [Workflow - Send/Receive Money](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822987662)
**Test Accounts:** `TEST_ACCOUNTS.PAYPAL_SRM` = `4807040257007952591` (legacy); `VENMO_ACCOUNTS.SRM` = `4796767396204448277` (legacy)

### Use Case 1 — PayPal Complete Lifecycle (P0)
**Objective:** Single comprehensive test covering all four tabs (Send Money, Receive Money, Credit Cards, Commercial Entity), P2P toggle, Edit Preferences (save and reset).
**Test File:** `p0-paypal-srm-complete-lifecycle.cy.ts`

**Key Verifications:**
- Pricing Category = `"10A"`, Merchant Fees link has `target="_blank"`, `href` includes `"merchant-fees"`
- P2P toggle: read state, toggle once, verify toast + new state
- Send Money tab: Bank `"CHECKING"` + `"5004"`, Card `"Debit Card"` + `"2632"`
- Receive Money: Express Checkout, PayPal.Me, Money Request, QR Codes all show `"Eligible"`
- Edit Preferences (Save): changes persist; (Reset): reverts to API-loaded values
- Credit Cards: toggle enabled card OFF (toast), toggle disabled card ON (toast)
- Commercial Entity: CE Status per card, HSBC first acquirer row, `"Date Registration Sent"` = `"N/A"`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-SRM-P0-001-A | Navigate, verify wrapper, spinner clears | Wrapper exists; no spinner |
| TC-SRM-P0-001-B | Verify Pricing Category = 10A | Field shows "10A" |
| TC-SRM-P0-002-A | Toggle P2P once — verify toast + new state | Toast appears; toggle reflects new state |
| TC-SRM-P0-003-A | Send Money tab — sending limits visible | sendingLimitsInfo visible |
| TC-SRM-P0-004-A | Receive Money — all eligibilities = Eligible | All four rows show "Eligible" |
| TC-SRM-P0-004-E | Save pref changes — newRefundLimit persists | Toast shown; refundLimit = newRefundLimit |
| TC-SRM-P0-004-G/H | Reset — original values restored | Both values revert |
| TC-SRM-P0-005-B/C | Credit card toggles | Enabled → disabled (toast); disabled → enabled (toast) |
| TC-SRM-P0-006-E | First Acquirer row contains HSBC | tbody tr:first contains "HSBC" |

---

### Use Case 2 — PayPal Non-US Account (P1)
**Objective:** Non-US account renders ReceiveMoneyPymtPrefs with exactly 3 tabs; first tab = "Edit Payment Receiving Preferences".
**Test Account:** JAWS GB Personal `emailPrefix: "srm-p1-non-us-ft"`

---

### Use Case 3 — Venmo Complete Lifecycle (P0)
**Test File:** `p0-venmo-srm-complete-lifecycle.cy.ts`

**Key Verifications:**
- Account Type = `"PERSONAL"`, CERM Enrolled = `"No"`
- Limitations link → toast: `"No Limitations Found"`
- CIP table: `"Venmo CIP"` row with `"CIP Passed"`
- Send Money: Bank `"Personal Checking"` + `"5754"`, Venmo Debit Card `"Pink Sherbet"` + `"8574"`
- Visa Plus: payname `"+visaplusqatest3.venmo"`, first transaction = `"VISA Receive"`
- Product Info: first product = `"Instant Add Funds"` + `"Eligible"`, last limit = `"CRYPTO_TRANSFER_LIMITS_WEEKLY"`

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/send-receive-money/p0-paypal-srm-complete-lifecycle.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/send-receive-money/p0-venmo-srm-complete-lifecycle.cy.ts"
```

---

## 8. Workflow — Payment Declined

**Confluence:** [Workflow - Payment Declined](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822949394)
**Environment:** QA (`te-airavi-8557.qa.paypal.com`)

### Overview
Covers Risk Declines (override eligible/ineligible), Other Declines (non-risk), and Payment Attempts tab.

---

### Use Case 1 — Proceed Without Resolving (P0)
**Test Account:** JAWS `firstName: "denypymtcare"`, amount: `$101`, Send Money PURCHASE (TRANSACTION_REFUSED)
**Test File:** `p0-paypal-risk-decline-proceed-without-resolving.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-PD-P0-001-A | Create risk decline account via JAWS | Account with TRANSACTION_REFUSED |
| TC-PD-P0-001-B | Navigate to Payment Decline workflow | Workflow loads |
| TC-PD-P0-001-C | Verify Risk Declines section has data | Table rows present |
| TC-PD-P0-001-D | Verify columns (Amount, Receiver, Date) | Columns visible |
| TC-PD-P0-001-E | Expand first row — verify details | Receiver Email, Root Cause, Override Eligibility, Step Up Required |
| TC-PD-P0-001-F | Verify Release Decline button visible | Button present and enabled |
| TC-PD-P0-001-G | Click Proceed Without Resolving | Confirmation modal appears |
| TC-PD-P0-001-H | Confirm modal | Modal closes, action buttons removed |
| TC-PD-P0-001-I | Click Next to wrap-up | Wrap-up / Thank You screen visible |

---

### Use Case 2 — Release Decline → Step-Up → Yes Confirmation (P0)
**Test File:** `p0-paypal-risk-decline-release-override-yes.cy.ts`

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-PD-P0-002-B | Confirm Release Decline modal | Step-up triggered |
| TC-PD-P0-002-C | Complete step-up SMS (OTP: 111111) | Code verified |
| TC-PD-P0-002-D | Verify override result inline | Risk section reappears |
| TC-PD-P0-002-E | Select Yes confirmation | Radio selected |
| TC-PD-P0-002-F | Click Next to wrap-up | Wrap-up visible |

---

### Use Case 3 — Release → No Confirmation (P1)
Same as UC2 but select "No — Transaction still failed".

### Use Case 4 — Release → Try Later (P1)
Same as UC2 but select "Customer will try later — Override is active for 4 hours".

### Use Case 5 — Override Ineligible — Disabled Buttons (P1)
**Test Account:** JAWS `firstName: "atoN"`, amount: `$52`, Send Money PURCHASE
**Expected:** Release Decline AND Proceed Without Resolving buttons are both DISABLED.

### Use Case 6 — Other Declines — Verify, Expand/Collapse, Wrap-up (P1)
**Test Account:** Pre-existing legacy `5076954526656970270`
**Columns:** Amount, Receiver, Date, Root Cause, Override Eligibility

### Use Case 7 — Payment Attempts Tab (P1)
**Test Account:** JAWS `firstName: "denypymtcare"`, amount: `$34`
Switch to Payment Attempts tab, verify data loads, expand row, click Next to wrap-up.

### Key Utilities

| Utility | Purpose |
|---------|---------|
| `createRiskDeclineAccount(emailPrefix, amount, firstName)` | Creates JAWS account with risk decline transaction |
| `completeStepUpSms(otp)` | Completes SMS step-up (OTP 111111) |
| `navigateToPaymentDeclineWorkflow(emailOrAccountNumber)` | Full navigation with LLA + spinner wait |

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/payment-decline/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/payment-decline/p0-paypal-risk-decline-*.cy.ts"
```

---

## 9. Workflow — Refund

**Confluence:** [Workflow - Refund](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2823015227)
**Transaction Creation:** JAWS Express Checkout | **Venmo:** `VENMO_ACCOUNTS.PERSONAL`

### Overview
- PayPal Full Refund (P0), Partial Refund (P1), Refund Already Initiated (P1), Buyer Already Contacted (P1)
- Venmo Full Refund (P1), Venmo Buyer Already Contacted (P1)
- PayPal/Venmo Do Nothing (P2)

---

### Use Case 1 — PayPal Seller Issues Full Refund — Happy Path (P0)
**Test Account:** JAWS seller (Express Checkout: SALE, $30.11 USD, IACH)

**Steps:**
1. Navigate to Refund workflow (skip SSO, close tabs, create case, search seller, LLA Auth in Absentia, select Refund)
2. Verify transaction table loads with "Select the Transaction"
3. Select first transaction (radio) → click Next → Transaction Details page
4. Click **"Issue a Refund"** banner → verify "What does the customer want to do?" appears
5. Verify "Within the refund period" and sufficient balance
6. Select **"Issue Full Refund"** → click Next
7. Verify toast: `"Full Refund has been issued successfully"` (CSS class `.cancel-payment-toast--success`)

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-RF-P0-001-A | Navigate to Refund, verify table | Table with "Select the Transaction" |
| TC-RF-P0-001-D | Click "Issue a Refund" banner | Refund form with "What does the customer want to do?" |
| TC-RF-P0-001-E | Verify refund period status | "Within the refund period" visible |
| TC-RF-P0-001-F | Verify sufficient balance | Sufficient balance shown |
| TC-RF-P0-001-I | Verify success toast | ".cancel-payment-toast--success" with correct message |

---

### Use Case 2 — PayPal Partial Refund (P1)
Select **"Issue Partial Refund"** → enter amount ($10.00) → Next.
Toast: `"Partial Refund has been issued successfully"`

### Use Case 3 — Refund Already Initiated (P1)
Phase A: Issue full refund → Phase B: Re-open same transaction → verify refund-related content visible.

### Use Case 4 — Buyer Already Contacted (P1)
From buyer account → "Load More Workflows" to find Refund → select transaction → click **"Already Contacted"** → verify "Contacted the Seller" confirmation.

### Use Case 6 — Venmo Full Refund (P1)
Venmo-specific: labels are lowercase ("Issue full refund" vs PayPal's "Issue Full Refund").

### Use Case 8 — Venmo Buyer Already Contacted (P1)
Button label: **"Already contacted"** (lowercase 'c' — Venmo-specific).

### Implementation Notes
- All PayPal tests use **Auth in Absentia** to bypass LLA
- Venmo uses `cy.navigateToWorkflow()` helper; PayPal buyer requires "Load More Workflows"
- **Venmo vs PayPal label differences:** "Issue full refund" / "Do nothing" / "Already contacted" (all lowercase)

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/refund.cy.ts" --env grep="P0"
npx cypress run --spec "cypress/e2e/workflows/refund.cy.ts" --env grep="P1"
```

---

## 10. Workflow — Disputes — Chargeback & Claims

**Confluence:** [Workflow - Disputes](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2823015434)
**Coverage:** 44% (14/32) | **Dispute Types Automated:** INR ✅, SNAD ✅, DUP 🔶

### Feature Inventory

| # | Feature | Status | Priority | Test Data |
|---|---------|--------|----------|-----------|
| 1 | File INR dispute (Item Not Received) | ✅ Automated | P0 | JAWS ($20, IACH) |
| 2 | File SNAD dispute (Item Damaged) | ✅ Automated | P0 | JAWS ($25, IACH) |
| 3 | File DUP dispute (Duplicate Payment) | 🔶 Partial | P1 | JAWS ($50x2, CC) |
| 4-11 | CRB, CNP, ITA, PBOM, PWR, BDO-ATM, BDO-Token, BDO-Scam | ❌ Not Automated | — | — |
| 12-23 | Dashboard & Navigation (Transaction Log, Case Log, Case Detail) | ✅ Automated | P0 | JAWS |

### Use Case: File INR Dispute — Complete Lifecycle (P0) ✅ PASSED
**Duration:** 277s | **Test File:** `p0-paypal-dis-inr-lifecycle.cy.ts`
**Transaction:** SALE, IACH, $20.00 USD, Item: "Test Product for INR Dispute"

| Step | Action | Expected Result |
|------|--------|-----------------|
| 1 | Navigate to Disputes & Claims | Dashboard loads with Transaction Log |
| 2-3 | Validate transaction row | Type="Express Checkout Payment Sent", Amount="USD -20", Status="Completed" |
| 4-5 | Click Transaction ID → Verify TD page | TD page opens with encrypted Transaction ID in title |
| 6 | Click File Dispute → Select INR | INR-specific form fields appear |
| 7 | Fill form: Customer Issue="Product", Reason Code="Item Not Delivered", Buyer Contacted="Yes", Notes | Form populated |
| 8 | Click Submit | Toast: "Dispute has been filed successfully" |
| 9 | Return to dashboard → Refresh → Verify Open Cases | INR case row: Claim Amount="USD 20.00", Status="Review", Claim Type="INTERNAL- COMPLAINT" |
| 10-12 | View Case Detail | Case Type="Purchase protection dispute inquiry", Reason Code="INR", Sub Reason Code="Item Not Delivered" |
| 13 | Click Sender Transaction ID → Verify TD Case Details | Reason="INR", Case Status="REVIEW" (with refresh retry) |
| 14 | Re-file Dispute | Modal: "Existing case is associated with this transaction, hence a new dispute cannot be filed." |

### Dispute Form Fields Comparison

| Field | INR | SNAD | DUP |
|-------|-----|------|-----|
| Customer Issue | Product | Product | N/A |
| Reason Code | Item Not Delivered | Item Damaged | N/A |
| Buyer Contacted | Yes/No | Yes/No | N/A (Merchant Contacted) |
| Accept Partial Refund | N/A | Yes/No | N/A |
| Buyer Willing to Return | N/A | Return/NoReturn | N/A |
| Duplicate Txn Select | N/A | N/A | Yes (from table) |
| Case Type | Purchase protection dispute | Purchase protection dispute | Billing Error Dispute |
| Claim Type | INTERNAL- COMPLAINT | INTERNAL- COMPLAINT | INTERNAL- BILLING |
| Funding Source | IACH | IACH | CC (x2 transactions) |

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/disputes/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/disputes/p0-*.cy.ts"
```

---

## 11. Workflow — Account Takeover (Venmo ATO)

**Confluence:** [Workflow - Account Takeover](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822949760)
**Test Accounts:** `VENMO_ACCOUNTS.ATO_LIFECYCLE` = `4799392809475595297` (P0); `VENMO_ACCOUNTS.BUSINESS` = `4784880237909448391` (P1)

### Use Case 1 — Venmo ATO Complete Lifecycle (P0)
**Objective:** Full end-to-end: Landing → Create Case Wizard (3 steps) → Parent Case Details → Child Case Details → Landing.
**Test File:** `p0-venmo-ato-complete-lifecycle.cy.ts`

**Key Steps:**

**Landing Page:**
- Verify `ATO_LANDING.wrapper` exists; Open and Resolved tabs visible

**Create Case Wizard — Confirmation Modal:**
- Click Create Case → check `modalRadioYes` (force) → click "Yes, create" → wizard opens

**Step 1 — Select Transactions:**
- Find first enabled checkbox in `tbody tr input[type='checkbox']:not(:disabled)` → check it → Next

**Step 2 — Select Activities:**
- Check `.eq(0)` then `.eq(1)` activity checkboxes → Next

**Step 3 — Review → Create → Confirm Modal:**
- Click `createCaseButtonFooter` → type notes → click button matching `/yes.*create|yes.*update/i`
- Verify toast: `"successfully created"`

**Parent Case Details:**
- Capture `parentCaseId` from landing table → verify in `ATO_CASE_DETAILS.caseDetails`
- Risk Inputs (conditional), Money Movement ("Merchant Money Movement" + "Buyer Money Movement"), Communications (Notes, Emails, Documents)

**Child Case Details:**
- Capture `childCaseId` from Related Disputes section → verify in child case table
- Verify `reasonCode` contains `"UNAUTH"`
- Case Outcomes, Money Movement, Communications, Risk Inputs, Item Details — all conditional, skip gracefully

**Back Navigation:**
- Child → Parent Details → Landing (Open + Resolved tabs)

| TC ID | Test Case | Expected Result |
|-------|-----------|-----------------|
| TC-ATO-P0-001-A | Navigate; Landing wrapper exists | No spinner |
| TC-ATO-P0-002-A | Create Case modal; Yes radio; "Yes, create" | Dialog opens, clicked |
| TC-ATO-P0-003-A | First enabled transaction selected | Not-disabled checkbox checked |
| TC-ATO-P0-004-A | First 2 activities selected | .eq(0) and .eq(1) checked |
| TC-ATO-P0-005-D | Success toast | "This case has been successfully created" |
| TC-ATO-P0-007-A | Parent Case Details, parentCaseId verified | caseDetails contains parentCaseId |
| TC-ATO-P0-008-C | reasonCode contains "UNAUTH" | invoke("text").should("contain", "UNAUTH") |
| TC-ATO-P0-009-B | Back → Landing; both tabs visible | Wrapper and tab labels visible |

---

### Use Case 2 — ATO Create Case — No Selection & Activities-Only (P1)
**Objective:** Cannot Create Case modal when skipping all; Okay returns to Step 1; activities-only does NOT add Open tab row.
**Test File:** `p1-venmo-ato-create-case-no-selection-lifecycle.cy.ts`

- Skip transactions → Skip activities → Next → "Cannot Create Case" modal → Okay → returns to Step 1
- Skip transactions again → Select 1 activity → Next → Step 3 → Create → notes → confirm
- Toast fires; Open tab row count unchanged from initial (activities-only = note, not ATO case)

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/account-takeover-venmo/*.cy.ts"
```

---

## 12. Workflow — Single / Mass Reversal

**Confluence:** [Workflow - Single/Mass Reversal](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2822988502)
**Primary Test Account:** `kate-us-buyer@paypal.com`

### PayPal Single Reversal

#### UC1 — Navigate and Display Transaction Table (P0)
Single Reversal mode is default; filter panel toggle visible; at least one transaction row; Show More pagination works.

#### UC2 — Straight Reversal — Complete Lifecycle (P0)
1. Select reversible transaction → click **Straight Reversal** → modal opens
2. Select Group (if present), Reason (if present), enter Memo (1-1000 chars, required)
3. Click **Save** → API processes → summary with green success badge → Next → star rating

#### UC3 — Pending Reversal — Complete Lifecycle (P0)
Same as UC2 but use **Pending Reversal** → summary reflects scheduled status.

#### UC4 — Non-Reversible Transaction (P1)
Both action buttons are disabled for non-reversible rows; buttons enable when reversible row selected.

#### UC5 — Modal Close Without Processing (P1)
Close modal → modal removed from DOM; table remains; no API call; data discarded.

#### UC6 — Filter Panel Toggle, Apply, and Clear (P1)
Toggle expands/collapses panel; Apply Filter triggers API; Clear Search resets; results accurate.

---

### PayPal Mass Reversal (Bulk Mode)

#### UC7 — Toggle Single and Mass Reversal Mode (P0)
Single mode → checkboxes absent (radio buttons); Mass mode → checkboxes appear per row.

#### UC8 — Bulk Straight Reversal — 3+ Transactions (P0)
Select 3+ reversible → Straight Reversal button enabled → bulk modal → memo → Save → summary shows 3 badges (all green).

#### UC9 — Bulk Pending Reversal (P0)
Same as UC8 with Pending Reversal.

#### UC10 — Bulk Reversal with Deselection (P1)
Select 5, deselect 2 → submit 3 → summary shows 3 badges.

#### UC11 — Partial Success and Failure (P1)
Mixed bulk outcomes: success badges (green) + failure badges (red).

---

### Venmo Fee Reversal

#### UC12 — Navigate Fee Reversal and Display Fee Transactions (P0)
Table columns: ID, Date, To/From, Status, Amount, Note; Single/Mass toggle visible; filter panel visible.

#### UC13 — Issue Fee Refund — Single Transaction (P0)
Select fee txn → **Issue Fee Refund** → modal with:
- Is this P2P accidental tagging? (Yes/No)
- Has one-time courtesy credit already been given? (Yes/No)
- Refund destination selection → Submit → success badge

#### UC14 — Issue Courtesy Credit — Single Transaction (P0)
Select fee txn → **Issue Courtesy Credit** → modal with:
- Has courtesy credit been given since 1 July 2024? (Yes/No)
- Refund destination → Submit → success badge

#### UC15 — Non-Reversible Fee (P1)
Transactions on hold (on hold, tax hold, risk hold, OFAC review) are filtered out; refund buttons disabled.

### Test Execution Summary
- **P0:** 9 use cases, ~100 functional test cases
- **P1:** 8 use cases, ~70 functional test cases

**Run Commands:**
```bash
npx cypress run --spec "cypress/e2e/workflows/mass-reversal/*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/mass-reversal/p0-paypal-mr-*.cy.ts"
npx cypress run --spec "cypress/e2e/workflows/mass-reversal/venmo-fee-*.cy.ts"
```

---

## 13. Workflow — Manage Account Flags

**Confluence:** [Workflow - Manage Account Flags](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2883936214)
**PayPal:** JAWS US Personal (fresh) | **Venmo:** Static QA accounts (Personal or Business, randomly selected)

### Use Case 1 — PayPal — Complete Flag Lifecycle (P0)
**Objective:** Full lifecycle — add Risk Flags (date-based + "Never" expiry), edit expiry dates, remove flags (with confirmation and cancellation).

**Key Steps:**
1. Navigate to Manage Account Flags → verify header + "Add Flags" button visible
2. Verify flags table container visible
3. Click **Add Flags** → select **Risk Flags** radio
4. Select a random flag from dropdown → set expiry date (30-180 days future) → click **Set Flags**
5. Toast: `"Flag has been added successfully"`
6. Add second flag with **Never** checkbox → Toast: `"Flag has been added successfully"`
7. Verify both flags in table with correct flag names
8. Select first flag → **Edit** → set new date → **Update** → Toast: `"expiry date on the flag has been updated"`
9. Select second flag → **Edit** → check **Never** → **Update** → Toast: `"expiry date on the flag has been updated"`
10. Select last flag → **Remove** → **Confirm** → Toast: `"removed successfully"`; count decreases by 1
11. Select another flag → **Remove** → **Cancel** → modal closes; flag NOT removed
12. Select remaining flag → **Remove** → **Confirm** → Toast: `"removed successfully"`

| S.NO | Test Case | Expected Result | FT |
|------|-----------|-----------------|-----|
| 1 | Open Manage Account Flags | Page loads with "Add Flags" button | Yes |
| 3 | Add Risk Flag with expiry date | "Flag has been added successfully" | Yes |
| 4 | Add Risk Flag with "Never" expiry | "Flag has been added successfully" | Yes |
| 5 | Verify both flags in table | Correct flag names in "Flag" column | Yes |
| 6 | Edit flag → new expiry date | "expiry date on the flag has been updated" | Yes |
| 8 | Remove with Confirm | "removed successfully"; count -1 | Yes |
| 10 | Cancel remove | Modal closes; flag NOT removed | Yes |

---

### Use Case 2 — Venmo — Complete Flag Lifecycle (P0)
**Key Differences:**
- No flag type radio buttons — goes directly to Venmo flag form
- Dropdown shows `"flagName (X Hrs)"` but table shows just `"flagName"`
- Cleanup: use **Select All** checkbox to remove all flags (static accounts accumulate flags)

**Key Steps:**
1. Add first Venmo flag → Toast: `"Flag has been added successfully"`
2. Add second Venmo flag → Toast: `"Flag has been added successfully"`
3. Verify both flags in table (without duration suffix)
4. Remove first flag → Confirm → Toast: `"removed successfully"`; count -1
5. Cancel remove on another flag → flag NOT removed
6. **Select All** → Remove → Confirm → Toast: `"removed successfully"` → table empty

---

### Use Case 3 — PayPal — Form Validation & Error Handling (P1)
- Submit form without selecting flag → validation error: `"Complete this field."` on dropdown
- Select flag but no expiry date → validation error: `"Complete this field with format Dec 31, 2024."` on date picker
- Back button → returns to main table view without submitting

### Use Case 4 — Venmo — Form Validation & Error Handling (P1)
- Submit without selecting flag → validation error: `"Complete this field."`
- Back button → returns to main table view

---

## 14. Workflow — Manage Users

**Confluence:** [Workflow - Manage Users](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2884278808)
**Description:** Manages secondary users for business accounts (view list, search, filter, view details, update)
**Test Account:** `TEST_ACCOUNTS.MANAGE_USERS_BUSINESS` (static, has secondary users)

### MANAGE_USERS Key Selectors

| Selector | Automation ID |
|----------|---------------|
| workflowTabs | `manage-users-tabs` |
| tableContainer | `secondary-users-table-container` |
| searchInput | `secondary-users-search-input` |
| searchButton | `secondary-users-search-button` |
| filterButton | `secondary-users-filter-button` |
| filterMenu | `secondary-users-filter-menu` |
| dataTable | `secondary-users-data-table` |
| loadMoreButton | `secondary-users-load-more-button` |
| userDetailsContainer | `secondary-user-details-container` |
| updateUserModal | `update-secondary-user-modal` |
| updateUserFirstNameInput | `update-secondary-user-firstName-input` |
| removeUserConfirmButton | `remove-secondary-user-confirm-button` |

---

### Use Case 1 — PayPal — View Secondary Users List (P0)
**Spec:** `p0-paypal-manage-users-view-list.cy.ts`

| S.NO | Test Case | Expected Result | FT |
|------|-----------|-----------------|-----|
| 1 | Open Manage Users workflow | Page loads, table container visible | Yes |
| 2 | Verify "Secondary Users" tab | Tab label visible | Yes |
| 3 | Verify data table visible | Table with rows | Yes |
| 4 | Verify search input visible | Search field rendered | Yes |
| 5 | Verify filter button visible | Filter button rendered | Yes |
| 6 | Click filter button → verify menu options | Menu shows "Active" and "Inactive" | Yes |
| 7 | Close filter menu (click outside) | Menu closes | Yes |
| 8 | Search by first name from first row | Table filters to matching results | Yes |
| 9 | Clear search → verify list restores | Full list shown again | Yes |

---

### Use Case 2 — PayPal — Update Secondary User (P1)
**Spec:** `p1-paypal-manage-users-update.cy.ts`

1. Navigate to Manage Users → click three-dot action on first row → click "Update" (active users only)
2. Verify update modal + form (First Name, Last Name inputs)
3. Type "TestFirstName" → verify Submit enabled
4. Click Cancel → return to list (no changes)

| S.NO | Test Case | Expected Result | FT |
|------|-----------|-----------------|-----|
| 11 | Click "Update" on active user | Update modal with form fields | Yes |
| 12 | Verify First Name + Last Name visible | Both input fields present | Yes |
| 13 | Modify First Name → submit enabled | Submit button enabled | Yes |
| 14 | Cancel → return to list | Modal closes, table visible | Yes |

---

### Use Case 3 — PayPal — View Secondary User Details (P1)
**Spec:** `p1-paypal-manage-users-view-details.cy.ts`

1. Navigate → click three-dot on first row → "View Details"
2. Verify `userDetailsContainer` visible + "Secondary User Details" heading + back button
3. Click Back → data table visible

---

## 15. Workflow — ManagePayLater

**Confluence:** [Workflow - ManagePayLater](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2887455002)
**Flow Name:** ManagePayLater | **Intent:** `pay_in_installments`
**Custom Permissions:** `Flow Manage Pay Later`, `PayLater Fee Reversal`, `GPL SCRA Enrollment`
**General Test Account:** `4778367720275218077`

### Overview — 15 Use Cases

| Use Case | Priority | Market |
|----------|----------|--------|
| UC1: Launch Flow and View Landing Page | P0 | All |
| UC2: View Loan Application Status (Approved/Declined) | P0 | All |
| UC3: View Loan Details — Pay in 4 and Pay Monthly | P0 | All |
| UC4: Manage Repayment FI — Auto Pay, Immediate, Future | P0 | All |
| UC5: Repayments and Credit Transactions | P0 | All |
| UC6: GPL Post Debit Transaction Flip (US) | P0 | US Only |
| UC7: Pre-Paid Card Support — Pay in 3 (Italy) | P0 | Italy |
| UC8: Fee Reversal | P1 | All |
| UC9: GPL SCRA Enrollment | P2 | US |
| UC10: KM Articles Integration | P0 | All |
| UC11: Cross-Flow Navigation (Transaction Log, Disputes) | P1 | All |
| UC12: Account with No PayLater Loans | P1 | All |
| UC13: Permission Validation | P2 | All |
| UC14: Goodwill Credit — Apply and Reverse | P0 | All |
| UC15: Close Pay Later Account | P1 | All |

---

### UC1 — Launch Flow and View Landing Page (P0)
- Select "Manage PayLater" intent → page loads with all active loans
- Each loan: loan ID, amount, status, product type (Pay in 4, Pay Monthly 3/6/12 month)
- Application Status section visible; KM articles accessible; workflow closeable via wrap-up

### UC2 — Loan Application Status — Approved and Declined (P0)
- **Test Account:** `4793464743975735618`
- Approved: shows approval details; Declined: shows **decline reason** (critical for agents to communicate to customers)
- API: `/v1/admin/accounts/{id}?fields=credit_consumer_applications`

### UC3 — View Loan Details — Pay in 4 and Pay Monthly (P0)
- **Test Account:** `5067532267457681383` (multiple loan types)
- Pay in 4: 4-installment schedule, repayment FI, remaining balance, dates
- Pay Monthly (3/6/12 month): monthly installment, APR, remaining payments

### UC4 — Manage Repayment FI — Set Auto Pay, Immediate and Future Payments (P0)
- API: `/v2/credit/compute-repayment-constraints` returns eligible FIs
- Change auto pay FI → confirm → success toast
- Immediate payment → process → confirmation
- Future payment → select date + FI → scheduled → confirmation

### UC5 — Repayments and Credit Transactions (P0)
- **Pending Transactions:** ALL repayments (Pending, Scheduled, Processing)
  - API: `/v2/credit/repayments?repayment_statuses=PROCESSING&repayment_statuses=SCHEDULED`
- **Settled Transactions:** all credit transactions (Repayments, Fees, Goodwill credits)
  - API: `/v1/credit/monetary-transactions`
- Test accounts: `4791350779126149178` (Fee txns), `4774314518781686196` (Repayment txns)

### UC6 — GPL Post Debit Transaction Flip — US Market (P0)
**Test Account:** `4793464743975735618` | Flip Transaction: `7GT27272VG1638728`

**Flip Flow:** User does debit card transaction → applies for Pay Later → if approved, transaction amount returns to balance and loan opened.

**Key Verifications:**
- PL2GO channel field shows `"Flipped Transaction Loan"`
- PL2GO details field shows card last 4 digits
- Originating debit transaction ID is clickable → navigates to transaction details
- Transaction Log shows `"Flip"` or `"Flip Reversed"` appended to transaction type label
- API: `/v1/admin/accounts/{id}/closed-ended-credit-accounts`

### UC7 — Pre-Paid Card Support — Pay in 3, Italy Market (P0)
- Pre-Paid cards displayed as **"Pre-Paid Card"** (NOT "Debit_Card" or "Credit Card")
- Can set as auto pay, process immediate payment, schedule future payment
- API: `/v2/credit/compute-repayment-constraints` must return correct type

### UC14 — Goodwill Credit — Apply and Reverse (P0)
- **Section:** Direct Debit And Balance Adjustments → Goodwill Credit tab
- Apply credit within max allowable amount → success confirmation → appears in goodwill credits list + Settled Transactions
- Reverse applied credit → status updated to "Reversed" → visible in Settled Transactions
- Amount exceeding max limit → validation error displayed

### UC15 — Close Pay Later Account (P1)
- "Close Pay Later Account" button visible on account details
- Confirmation prompt → confirm → tags removed → status = "Closed"
- Accounts with outstanding balances: cannot close (error/warning)
- Accounts with pending payments: handled gracefully

### Key API Endpoints

| API | Purpose |
|-----|---------|
| `/v1/admin/accounts/{id}?fields=credit_consumer_applications` | Loan application statuses |
| `/v1/admin/accounts/{id}/closed-ended-credit-accounts` | Loan details (incl. flip identifiers) |
| `/v2/credit/compute-repayment-constraints` | Repayment FI options |
| `/v2/credit/repayments?repayment_statuses=PROCESSING&repayment_statuses=SCHEDULED` | Pending repayments |
| `/v1/credit/monetary-transactions` | Settled credit transactions |

### Test Account Reference (ManagePayLater)

| Account | Purpose |
|---------|---------|
| `4778367720275218077` | General testing, Goodwill Credit, Close Account |
| `4793464743975735618` | GPL Post Debit Flip (US) |
| `7GT27272VG1638728` | Flip Transaction ID |
| `4791350779126149178` | Fee Transactions |
| `4774314518781686196` | Repayment Transactions |
| `5067532267457681383` | Multiple loan types |

### Test Execution Summary
- **P0:** 9 use cases, 56 test cases
- **P1:** 4 use cases, 17 test cases
- **P2:** 2 use cases, 5 test cases
- **Total:** 15 use cases, 72 test cases

---

## 16. Test Account Reference — Send/Receive Money

**Confluence:** [Send/Receive Money Test Accounts](https://paypal.atlassian.net/wiki/spaces/CSIProduct/pages/2824831258)

| Tenant | Account Number | Country | Description |
|--------|---------------|---------|-------------|
| Venmo | 4774669786695117119 | US | Account Details + Limitations ✔; Send Money — Bank, Card, Venmo Debit Card ✔; External Wallet, Venmo Credit Card ❌; Visa Plus txns ❌; Product Info ✔ (Read only flow) |
| Venmo | 4800529684883035295 | US | Account Details + Limitations ✔; Send Money — Card, External Wallet ✔; Bank, Wallet, Venmo Debit Card, Credit Card ❌; Amex Tab — External Wallet ✔; Visa Plus ❌; Product Info ✔ |
| Venmo | 4796767396204448277 | US | Account Details + Limitations ❌; Send Money — Bank, Venmo Debit card ✔; Card, External Wallet, Credit Card ❌; Visa Plus txns ✔; Product Info ✔ |
| PayPal | 4807040257007952591 | US | Limitations ❌; Send Money — Bank, Card ✔; PayPal Credit ❌; Receive Money ✔; Edit Prefs ✔; Credit Cards ✔; Commercial Entity ✔ (Editable flow) |
| PayPal | 5068836258871001553 | US | Limitations ✔; Send Money — Bank ✔; Card, PayPal Credit ❌; Receive Money ✔; Edit Prefs ✔; Credit Cards ✔; Commercial Entity ❌ |
| PayPal | 5075266524039020780 | Non-US | Limitations ✔; Send Money ❌; Receive Money ❌; Edit Prefs ✔; Credit Cards ✔; Commercial Entity ❌ |

---

## Global Test Execution Notes

### Common Patterns
- **JAWS accounts:** Created fresh per test run via `createAccount()` in `before()` or `beforeEach()` hooks
- **Legacy/static accounts:** Hardcoded QA account numbers (used for Venmo and accounts JAWS cannot create)
- **Step-up Authentication:** Typically completed via OVERRIDE method in test environments
- **Verbatim Modal:** Type "I agree" to confirm destructive actions
- **LLA Bypass:** Use Auth in Absentia ("Continue without validation") in most PayPal workflow tests
- **Single `it()` block pattern:** All tests use single `it()` since steps depend on each other and share UI state

### Environment
- **QA Environment:** `te-airavi-8557.qa.paypal.com` (Payment Declined uses this specific stage)
- **General QA:** All other workflows

### Cypress Run All P0/P1 Tests
```bash
# Run all workflows
npx cypress run --spec "cypress/e2e/workflows/**/*.cy.ts"

# Run P0 only across all workflows
npx cypress run --spec "cypress/e2e/workflows/**/p0-*.cy.ts"

# Run P1 only across all workflows
npx cypress run --spec "cypress/e2e/workflows/**/p1-*.cy.ts"
```

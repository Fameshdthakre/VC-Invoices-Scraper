# Architectural Review: VC Invoices Scraper

As a Software Architect, I have reviewed the `VC Invoices Scraper` codebase. Below is a detailed analysis covering feature suggestions, bug fixes, architectural misalignments, and code duplications.

---

## 1. Improvements & Feature Suggestions

*   **Decouple Scraping Engine from Side Panel:**
    Currently, if the user closes the side panel, the port disconnects and the scraping job is immediately aborted (`isAborted = true`). Since the extension already implements an Offscreen API for a keep-alive heartbeat, it would be highly beneficial to allow the scrape to continue in the background. The side panel should act purely as a "view" that reconnects to an ongoing job stored in `chrome.storage`.
*   **File Upload for Bulk Invoices:**
    Pasting thousands of invoice numbers into a textarea can be cumbersome and browser-heavy. Adding a simple file input to parse CSV/TXT files of invoice numbers would greatly improve the user experience for bulk operations.
*   **System Notifications for Captchas:**
    The system currently uses an audio cue and a UI overlay for captchas. Adding a native OS notification (`chrome.notifications.create`) would ensure the user is alerted even if they have muted their audio and minimized the browser.
*   **Additional Export Formats:**
    Consider adding a JSON export feature to allow users to integrate this data programmatically into other systems (e.g., automated accounting pipelines).

---

## 2. Bug Fixes & Edge Cases

*   **Dead Code in Error Handling (`background.js`):**
    In `processInvoiceWithRetry`, there is a `catch(err)` block that explicitly checks for `err.message === "CAPTCHA_DETECTED"`. However, the injected function `scrapeInvoicePage` wraps its logic in a `try...catch` and returns `{ success: false, error: e.message }` rather than throwing an exception up to the extension script. Therefore, the `try/catch` checks for captchas in the extension scope are effectively dead code.
*   **Sequential Retry Limitation (`background.js`):**
    When the script finishes the batch loop and enters the "AUTO-RETRY FAILED INVOICES" phase, it hardcodes `tabPool[0]` and processes the failed list purely sequentially. If a batch resulted in a large number of failures (e.g., due to a temporary network blip), the retry phase does not utilize the parallel capabilities of the extension.
*   **Race Condition in Pause Logic (`background.js`):**
    The `pauseResolvers` array pushes resolve functions when a captcha is hit. If multiple tabs trigger a captcha simultaneously, they all push their resolvers. When the user clicks "Resume", all resolvers are popped and executed simultaneously. If the user hasn't solved the captchas in the other background tabs, they will immediately fail again.
*   **Floating-Point Inaccuracy in Total Validation (`background.js`):**
    The validation relies on `Math.abs(calculatedTotal - expectedTotal) < 0.05`. While a small epsilon helps, a much safer architectural standard for currency is to convert everything to cents (integers) prior to mathematical operations to avoid IEEE 754 floating-point errors entirely.

---

## 3. Code Misalignment & Architectural Smells

*   **Global Mutable State (`background.js`):**
    The background service worker relies on loose global variables (`isAborted`, `isScraping`, `isPaused`, `activeTabs`, `activePort`). This is an architectural smell that makes the code brittle and prevents running multiple independent jobs safely.
    *   *Recommendation:* Refactor the scraping engine into a `ScrapeJob` class or use a strict State Machine pattern (Idle -> Running -> Paused -> Completed/Aborted).
*   **DOM Selector Fragility (`background.js`):**
    The injected `scrapeInvoicePage` relies on long `if/else` inline fallback queries (e.g., `document.querySelector('div[class*="mt-table-container"] > table[class*="mt-table"]') || document.querySelector('table.mt-table')`).
    *   *Recommendation:* Use a Strategy Pattern or an array of defined fallback selectors that can be iterated over cleanly, making it easier to add new selectors when Amazon updates their DOM.

---

## 4. Code Duplications

*   **Date Timestamp Formatting (`sidepanel.js`):**
    The logic to construct the current timestamp for the file name export (e.g., `now.getFullYear()`, `String(now.getMonth() + 1).padStart(...)`) is copy-pasted identically inside both `downloadBtn.addEventListener` and `downloadCsvBtn.addEventListener`.
    *   *Recommendation:* Extract this block into a shared utility function `getFormattedTimestamp()`.
*   **Captcha Handling Boilerplate (`background.js`):**
    Inside the main loop of `executeScrapeLoop` and its retry block, the logic to handle a captcha (setting `isPaused = true`, logging the warning, sending `PAUSED_CAPTCHA` to the panel, focusing the tab/window, and awaiting the `pauseResolvers`) is duplicated almost exactly in 3 separate places.
    *   *Recommendation:* Extract this into an asynchronous helper method `handleCaptchaDetected(tabId, invoiceNumber)`.

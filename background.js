/* ═══════════════════════════════════════════
   VC Invoice Scraper — Background Service Worker
   Batch scraping engine with keep-alive support
   ═══════════════════════════════════════════ */

// ═══ STATE ═══
let activePort = null;
let isAborted = false;
let isScraping = false;
let isPaused = false;
let pauseResolvers = [];
const activeTabs = new Set(); // Track all open scraping tab IDs

// ═══════════════════════════════════════════
//  OFFSCREEN DOCUMENT (MV3 KEEP-ALIVE)
//  Ensures the service worker stays alive during
//  long scraping tasks.
// ═══════════════════════════════════════════
async function createOffscreenDocument() {
  if (await chrome.offscreen.hasDocument()) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['DOM_PARSER', 'AUDIO_PLAYBACK'],
    justification: 'Keep background worker alive for long-running batch scraping tasks and play notification sounds.'
  });
}

async function closeOffscreenDocument() {
  if (!(await chrome.offscreen.hasDocument())) return;
  await chrome.offscreen.closeDocument();
}

function playNotification(isError = false) {
  chrome.runtime.sendMessage({ type: "PLAY_NOTIFICATION", isError });
}

const KEEPALIVE_ALARM = "scraper-keepalive";

async function startKeepAlive() {
  chrome.alarms.create(KEEPALIVE_ALARM, { periodInMinutes: 0.4 });
  await createOffscreenDocument();
  isScraping = true;
}

async function stopKeepAlive() {
  chrome.alarms.clear(KEEPALIVE_ALARM);
  await closeOffscreenDocument();
  isScraping = false;
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === KEEPALIVE_ALARM && isScraping) {
    // poke worker
  }
});

// ═══════════════════════════════════════════
//  SIDE PANEL SETUP
// ═══════════════════════════════════════════

// Open side panel when the extension icon is clicked
chrome.action.onClicked.addListener(async (tab) => {
  await chrome.sidePanel.open({ windowId: tab.windowId });
});

// Set the side panel behavior — open on action click
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => { });

// ═══════════════════════════════════════════
//  PORT CONNECTION (persistent messaging)
// ═══════════════════════════════════════════
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;

  activePort = port;

  port.onMessage.addListener(async (msg) => {
    switch (msg.type) {
      case "START_SCRAPE":
        isAborted = false;
        processAllInvoices(msg.vendorCode, msg.invoiceNumbers, msg.parallelCount || 5, msg.pageWait || 2);
        break;
      case "RESUME_SCRAPE":
        isAborted = false;
        resumeAllInvoices(msg.parallelCount || 5, msg.pageWait || 2);
        break;
      case "RESUME_FROM_PAUSE":
        isPaused = false;
        pauseResolvers.forEach(r => r());
        pauseResolvers = [];
        break;
      case "STOP_SCRAPE":
        isAborted = true;
        await closeAllActiveTabs();
        break;
      case "RETRY_FAILED":
        const { savedSession } = await chrome.storage.local.get("savedSession");
        if (savedSession && savedSession.failedInvoices.length > 0) {
          isAborted = false;
          executeScrapeLoop(
            savedSession.vendorCode,
            savedSession.failedInvoices,
            msg.parallelCount || 5,
            msg.pageWait || 2,
            savedSession.failedInvoices.length,
            { completedCount: 0, combinedRows: savedSession.combinedRows, failedInvoices: [] }
          );
        }
        break;
    }
  });

  port.onDisconnect.addListener(() => {
    activePort = null;
    // If sidepanel closes while scraping, abort
    isAborted = true;
    closeAllActiveTabs();
  });
});

// ═══════════════════════════════════════════
//  TAB MANAGEMENT
// ═══════════════════════════════════════════
async function closeAllActiveTabs() {
  const tabIds = [...activeTabs];
  activeTabs.clear();
  for (const tabId of tabIds) {
    try { await chrome.tabs.remove(tabId); } catch (e) { /* already closed */ }
  }
}

// ═══════════════════════════════════════════
//  SEND MESSAGE HELPERS
// ═══════════════════════════════════════════
function sendToPanel(msg) {
  if (activePort) {
    try { activePort.postMessage(msg); } catch (e) { /* port disconnected */ }
  }
}

function sendLog(message, logType = "info") {
  sendToPanel({ type: "LOG", message, logType });
}

function sendProgress(completedInvoices, totalInvoices, activeTabCount, parallelCount, invoiceNumber, totalRows) {
  sendToPanel({
    type: "PROGRESS",
    completedInvoices,
    totalInvoices,
    activeTabs: activeTabCount,
    parallelCount,
    invoiceNumber,
    totalRows: totalRows || 0,
  });
}

function sendInvoiceDone(invoiceNumber, rowCount, status) {
  sendToPanel({
    type: "INVOICE_DONE",
    invoiceNumber,
    rowCount,
    status,
  });
}

function sendComplete(headers, rows, failedInvoices) {
  sendToPanel({
    type: "COMPLETE",
    headers,
    rows,
    failedInvoices,
  });
}

function sendPartialData(rows) {
  sendToPanel({
    type: "PARTIAL_DATA",
    rows,
  });
}

function sendError(message) {
  sendToPanel({
    type: "ERROR",
    message,
  });
}

// ═══════════════════════════════════════════
//  RANDOM DELAY (anti-bot)
// ═══════════════════════════════════════════
function randomDelay(min = 2000, max = 8000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ═══════════════════════════════════════════
//  URL BUILDER
// ═══════════════════════════════════════════
function buildInvoiceUrl(invoiceNumber, vendorCode) {
  return `https://vendorcentral.amazon.com/hz/vendor/members/inv-mgmt/invoice-details?invoiceNumber=${encodeURIComponent(invoiceNumber)}&payeeCode=${encodeURIComponent(vendorCode)}&activeTab=lineItems`;
}

// ═══════════════════════════════════════════
//  WAIT FOR TAB LOAD (with crash detection)
// ═══════════════════════════════════════════
function waitForTabLoad(tabId, timeout = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tab load timeout"));
    }, timeout);

    function listener(updatedTabId, changeInfo) {
      if (updatedTabId === tabId && changeInfo.status === "complete") {
        cleanup();
        resolve();
      }
    }

    function removedListener(removedTabId) {
      if (removedTabId === tabId) {
        cleanup();
        reject(new Error("Tab crashed or was closed externally"));
      }
    }

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removedListener);
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removedListener);
  });
}

// ═══════════════════════════════════════════
//  INJECTED SCRAPING FUNCTION
//  This runs inside the Vendor Central page
// ═══════════════════════════════════════════
async function injectAndScrape(tabId, pageWait, invoiceNumber) {
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: scrapeInvoicePage,
    args: [pageWait, invoiceNumber]
  });

  if (results && results[0] && results[0].result) {
    return results[0].result;
  }
  throw new Error("Script injection returned no result");
}

/**
 * This function is serialized and injected into the page.
 * It scrapes the table, handles ALL pagination pages, and returns all data.
 *
 * Key reliability features:
 *  - Uses specific selectors (no generic "table" fallback)
 *  - Polls for actual row count > 0 before reading (not MutationObserver)
 *  - Clicks "Next" until disabled instead of counting page buttons upfront
 *    (Amazon uses ellipsis "1 2 3 … 10" so button count ≠ total pages)
 */
async function scrapeInvoicePage(pageWaitSec, invoiceId) {
  const waitMs = (pageWaitSec || 2) * 1000;
  const invLabel = invoiceId || "Unknown";

  // ── Helper: sleep ──
  function sleep(ms) {
    return new Promise(r => setTimeout(r, ms));
  }

  // ── Wait for the LINE ITEMS table to appear with actual rows ──
  function waitForTableWithData(timeout = 20000) {
    return new Promise((resolve, reject) => {
      const interval = 500;
      let elapsed = 0;

      const check = () => {
        // Captcha Check
        if (document.title.includes("Robot Check") || document.querySelector('form[action*="Captcha"]') || document.querySelector('form[action*="validateCaptcha"]')) {
          reject(new Error("CAPTCHA_DETECTED"));
          return;
        }

        const table =
          document.querySelector('div[class*="mt-table-container"] > table[class*="mt-table"]') ||
          document.querySelector('table.mt-table') ||
          document.querySelector('#lineItemsMelodicTable table') ||
          document.querySelector('table[class*="a-bordered"]');

        if (table) {
          const tbody = table.querySelector("tbody");
          const rows = tbody ? tbody.querySelectorAll("tr") : [];
          if (rows.length > 0) {
            resolve(table);
            return;
          }
        }

        elapsed += interval;
        if (elapsed >= timeout) {
          const fallback =
            document.querySelector('div[class*="mt-table-container"] > table[class*="mt-table"]') ||
            document.querySelector('table.mt-table') ||
            document.querySelector('#lineItemsMelodicTable table') ||
            document.querySelector('table[class*="a-bordered"]');
          if (fallback) {
            resolve(fallback);
          } else {
            reject(new Error("Table not found within timeout"));
          }
          return;
        }
        setTimeout(check, interval);
      };

      check();
    });
  }

  // ── Wait for pagination to appear ──
  function waitForPagination(timeout = 5000) {
    return new Promise((resolve) => {
      const interval = 500;
      let elapsed = 0;
      const check = () => {
        const nextLi =
          document.querySelector('li#lineItemsMelodicTable-pagination-next') ||
          document.querySelector('ul.a-pagination li.a-last');
        if (nextLi) {
          resolve(nextLi);
          return;
        }
        elapsed += interval;
        if (elapsed >= timeout) {
          resolve(null);
          return;
        }
        setTimeout(check, interval);
      };
      check();
    });
  }

  // ── Helper: parse currency string to number ──
  function parseCurrency(str) {
    if (!str) return 0;
    // Keep only numbers, decimal dots, and negative signs
    const cleaned = str.replace(/[^0-9.-]/g, "");
    const val = parseFloat(cleaned);
    return isNaN(val) ? 0 : val;
  }

  // ── Get expected total from page header ──
  function getExpectedTotal() {
    const rows = document.querySelectorAll('.invoice-property-field-row');
    for (const row of rows) {
      const label = row.querySelector('.invoice-property-field.a-color-tertiary');
      if (label && label.textContent.includes("Invoice amount")) {
        const valueEl = row.querySelector('.invoice-property-field.a-color-base');
        if (valueEl) return parseCurrency(valueEl.textContent);
      }
    }
    // Fallback: try different structure if needed
    const spans = document.querySelectorAll('span.invoice-property-field');
    for (let i = 0; i < spans.length; i++) {
      if (spans[i].textContent.includes("Invoice amount") && spans[i + 1]) {
        return parseCurrency(spans[i + 1].textContent);
      }
    }
    return null;
  }

  // ── Read table headers ──
  function readHeaders(table) {
    const headers = [];
    // Try thead first
    const thead = table.querySelector("thead");
    let ths = thead ? thead.querySelectorAll("th") : [];

    // Fallback: look for th anywhere in the table
    if (ths.length === 0) {
      ths = table.querySelectorAll("th");
    }

    // Fallback: look for the first row of td if no th found
    if (ths.length === 0) {
      const firstRow = table.querySelector("tr");
      if (firstRow) ths = firstRow.querySelectorAll("td");
    }

    ths.forEach(th => {
      // Clean up header text (remove newlines and extra spaces)
      headers.push(th.textContent.replace(/\s+/g, " ").trim());
    });
    return headers;
  }

  // ── Read table rows ──
  function readRows(table) {
    const rows = [];
    const tbody = table.querySelector("tbody");
    if (tbody) {
      const trs = tbody.querySelectorAll("tr");
      trs.forEach(tr => {
        const cells = [];
        tr.querySelectorAll("td").forEach(td => {
          cells.push(td.textContent.trim());
        });
        if (cells.length > 0) {
          rows.push(cells);
        }
      });
    }
    return rows;
  }

  // ── Check if "Next" button is available (not disabled) ──
  function isNextEnabled() {
    const nextLi =
      document.querySelector('li#lineItemsMelodicTable-pagination-next') ||
      document.querySelector('ul.a-pagination li.a-last');
    if (!nextLi) return false;
    // Amazon marks disabled pagination items with class "a-disabled"
    return !nextLi.classList.contains("a-disabled");
  }

  // ── Click Next and wait a flat 2 seconds for data to load ──
  async function clickNextPage() {
    const nextBtn =
      document.querySelector('li#lineItemsMelodicTable-pagination-next a') ||
      document.querySelector('li.a-last a') ||
      document.querySelector('ul.a-pagination li:last-child a');

    if (!nextBtn) {
      throw new Error("Next button not found");
    }

    // Click the Next button
    nextBtn.click();

    // Flat wait for data to load
    await sleep(waitMs);
  }

  // ── MAIN SCRAPE LOGIC ──
  try {
    // 1. Wait for initial table load
    let table = await waitForTableWithData();
    const expectedTotal = getExpectedTotal();

    // 2. Extra settle time
    await sleep(waitMs);

    // 3. Read first page
    const headers = readHeaders(table);
    let allRows = readRows(table);
    let pageNumber = 1;

    // Identify "Amount" column index
    let amountColIndex = headers.findIndex(h => h.toLowerCase() === "amount");
    if (amountColIndex === -1) {
      // Try fuzzy match
      amountColIndex = headers.findIndex(h => h.toLowerCase().includes("amount") && !h.toLowerCase().includes("received"));
    }
    // Fallback: if we have rows but no header match, try index 8 (9th column)
    if (amountColIndex === -1 && allRows.length > 0 && allRows[0].length >= 9) {
      amountColIndex = 8;
    }

    // 4. Pagination loop
    while (true) {
      // Re-query Next button with a small wait if missing
      let nextLi = await waitForPagination(3000);

      if (!nextLi || nextLi.classList.contains("a-disabled")) break;

      const nextBtn = nextLi.querySelector('a');
      if (!nextBtn) break;

      // Capture state before click to detect change
      const lastRowContent = allRows.length > 0 ? JSON.stringify(allRows[allRows.length - 1]) : "";

      // Click Next
      nextBtn.click();
      pageNumber++;

      // Wait for table update (rows should change or table should refresh)
      let tableUpdated = false;
      for (let attempt = 0; attempt < 10; attempt++) {
        await sleep(waitMs / 2);

        // Re-query table element (it might be replaced)
        const currentTable =
          document.querySelector('div[class*="mt-table-container"] > table[class*="mt-table"]') ||
          document.querySelector('table.mt-table') ||
          document.querySelector('#lineItemsMelodicTable table');

        if (currentTable) {
          table = currentTable;
          const newRows = readRows(table);
          if (newRows.length > 0 && JSON.stringify(newRows[newRows.length - 1]) !== lastRowContent) {
            allRows = allRows.concat(newRows);
            tableUpdated = true;
            break;
          }
        }
      }

      if (!tableUpdated) {
        // If we didn't detect a change, maybe it was a very slow load or same data?
        // Last attempt: just read whatever is there
        const finalRows = readRows(table);
        if (finalRows.length > 0 && JSON.stringify(finalRows[finalRows.length - 1]) !== lastRowContent) {
          allRows = allRows.concat(finalRows);
        } else {
          // If still same, we likely hit a dead end or load failure
          break;
        }
      }

      if (pageNumber > 100) break;
    }

    // 5. Validation
    let calculatedTotal = 0;
    if (amountColIndex !== -1) {
      allRows.forEach(row => {
        calculatedTotal += parseCurrency(row[amountColIndex]);
      });
    }

    // Match check (with small epsilon for float precision)
    let isMatched = expectedTotal !== null ? Math.abs(calculatedTotal - expectedTotal) < 0.05 : true;

    // ── Handle Duplicate Scenario ──
    if (expectedTotal !== null && calculatedTotal > (expectedTotal + 0.05)) {
      // Possible duplicates detected. Deduplicate and re-validate.
      const uniqueRowsMap = new Map();
      const dedupedRows = [];

      allRows.forEach(row => {
        const key = JSON.stringify(row);
        if (!uniqueRowsMap.has(key)) {
          uniqueRowsMap.set(key, true);
          dedupedRows.push(row);
        }
      });

      // Recalculate total with deduped rows
      let dedupedTotal = 0;
      if (amountColIndex !== -1) {
        dedupedRows.forEach(row => {
          dedupedTotal += parseCurrency(row[amountColIndex]);
        });
      }

      // If deduped total is better (closer or matches), use it
      if (Math.abs(dedupedTotal - expectedTotal) < Math.abs(calculatedTotal - expectedTotal)) {
        allRows = dedupedRows;
        calculatedTotal = dedupedTotal;
        isMatched = Math.abs(calculatedTotal - expectedTotal) < 0.05;
      }
    }

    return {
      success: true,
      headers,
      rows: allRows,
      totalPages: pageNumber,
      validation: {
        expectedTotal,
        calculatedTotal,
        isMatched,
        amountColIndex
      }
    };
  } catch (e) {
    return {
      success: false,
      error: e.message,
      headers: [],
      rows: [],
      totalPages: 0,
      validation: { isMatched: false }
    };
  }
}

// ═══════════════════════════════════════════
//  SINGLE INVOICE PROCESSOR
//  Used by each worker in the pool
// ═══════════════════════════════════════════
async function processSingleInvoice(tabId, invoiceNumber, vendorCode, pageWait) {
  const url = buildInvoiceUrl(invoiceNumber, vendorCode);
  await chrome.tabs.update(tabId, { url });

  try {
    // Wait for page to load
    await waitForTabLoad(tabId);

    // Extra settle time (increased for stability)
    await new Promise(r => setTimeout(r, 6000));

    // Inject and scrape
    let result = await injectAndScrape(tabId, pageWait, invoiceNumber);

    // Retry once on failure (but not captchas)
    if (!result.success && result.error !== "CAPTCHA_DETECTED") {
      sendLog(`[${invoiceNumber}] Retrying load...`, "warning");
      await chrome.tabs.reload(tabId);
      await waitForTabLoad(tabId);
      await new Promise(r => setTimeout(r, 7000));
      result = await injectAndScrape(tabId, pageWait, invoiceNumber);
    }

    return result;
  } catch (err) {
    throw err;
  }
}

// ═══════════════════════════════════════════
//  DEFAULT HEADERS
//  Hardcoded to match Vendor Central table
// ═══════════════════════════════════════════
const DEFAULT_HEADERS = [
  "PO #", "External ID", "Title", "ASIN", "Model #",
  "Freight Term", "Qty", "Unit Cost", "Amount",
  "Shortage quantity", "Amount shortage",
  "Last received date", "ASIN received",
  "Quantity received", "Unit cost", "Amount received"
];

// ═══════════════════════════════════════════
//  BATCH PROCESSING ENGINE
//
//  Opens N tabs per batch, waits for ALL to
//  finish, then proceeds to the next batch.
//  Never opens more tabs until current batch
//  is fully complete.
// ═══════════════════════════════════════════
async function processAllInvoices(vendorCode, invoiceNumbers, parallelCount, pageWait) {
  const total = invoiceNumbers.length;
  const initialState = {
    completedCount: 0,
    combinedRows: [],
    failedInvoices: []
  };
  await executeScrapeLoop(vendorCode, invoiceNumbers, parallelCount, pageWait, total, initialState);
}

async function resumeAllInvoices(parallelCount, pageWait) {
  const { savedSession } = await chrome.storage.local.get("savedSession");
  if (!savedSession) return;

  const { vendorCode, invoiceNumbers, totalInvoices } = savedSession;
  const initialState = {
    completedCount: savedSession.completedCount || 0,
    combinedRows: savedSession.combinedRows || [],
    failedInvoices: savedSession.failedInvoices || []
  };

  await executeScrapeLoop(vendorCode, invoiceNumbers, parallelCount, pageWait, totalInvoices, initialState);
}

async function executeScrapeLoop(vendorCode, invoiceNumbers, parallelCount, pageWait, total, state) {
  let { completedCount, combinedRows, failedInvoices } = state;
  let headers = state.headers || [...DEFAULT_HEADERS];
  let headersCaptured = (state.headers && state.headers.length > 0);

  // Clamp parallelCount to valid range
  parallelCount = Math.max(3, Math.min(15, parallelCount));

  // Start keep-alive alarm to prevent service worker from dying
  startKeepAlive();

  // Initial progress
  sendProgress(completedCount, total, 0, parallelCount, "", combinedRows.length);

  // ── Allocate Tab Pool ──
  sendLog(`Allocating ${parallelCount} tabs...`, "info");
  const tabPool = [];
  for (let i = 0; i < parallelCount; i++) {
    const tab = await chrome.tabs.create({ url: "about:blank", active: false });
    tabPool.push(tab.id);
    activeTabs.add(tab.id);
  }

  try {
    // ── Process in strict batches ──
    for (let batchStart = completedCount; batchStart < total; batchStart += parallelCount) {
      if (isAborted) break;

      const batchEnd = Math.min(batchStart + parallelCount, total);
      const batch = invoiceNumbers.slice(batchStart, batchEnd);
      const batchNum = Math.floor(batchStart / parallelCount) + 1;
      const totalBatches = Math.ceil(total / parallelCount);

      // Update progress: starting this batch
      sendProgress(completedCount, total, activeTabs.size, parallelCount, `Batch ${batchNum}/${totalBatches}`, combinedRows.length);

      const processInvoiceWithRetry = async (invoiceNumber, tabId) => {
        while (true) {
          if (isAborted) return;
          try {
            sendLog(`Scraping ${invoiceNumber}...`, "info");
            const result = await processSingleInvoice(tabId, invoiceNumber, vendorCode, pageWait);

            if (result.success && result.rows.length > 0) {
              // Capture dynamic headers from the first successful scrape
              if (!headersCaptured && result.headers && result.headers.length > 0) {
                headers = [...result.headers];
                headersCaptured = true;
                sendLog("Dynamic headers captured from page.", "success");
              }

              const invoiceRows = result.rows.map(row => [invoiceNumber, ...row]);
              combinedRows.push(...invoiceRows);
              sendInvoiceDone(invoiceNumber, result.rows.length, "success");

              // Validation Logging
              if (result.validation && !result.validation.isMatched) {
                if (result.validation.calculatedTotal > result.validation.expectedTotal) {
                  sendLog(`⚠️ Total too high on ${invoiceNumber}: Expected ${result.validation.expectedTotal}, Got ${result.validation.calculatedTotal.toFixed(2)}. Possible duplicates!`, "warning");
                } else {
                  sendLog(`⚠️ Total too low on ${invoiceNumber}: Expected ${result.validation.expectedTotal}, Got ${result.validation.calculatedTotal.toFixed(2)}. Missing rows!`, "warning");
                }
              } else if (result.validation && result.validation.expectedTotal) {
                sendLog(`✅ ${invoiceNumber} validated (Total: ${result.validation.expectedTotal})`, "success");
              } else {
                sendLog(`✅ ${invoiceNumber} (${result.rows.length} rows)`, "success");
              }
              return; // Done
            } else if (result.error === "CAPTCHA_DETECTED") {
              isPaused = true;
              sendLog(`⚠️ Captcha on ${invoiceNumber}. Paused.`, "warning");
              sendToPanel({ type: "PAUSED_CAPTCHA" });
              await chrome.tabs.update(tabId, { active: true });
              try {
                const tabInfo = await chrome.tabs.get(tabId);
                await chrome.windows.update(tabInfo.windowId, { focused: true });
              } catch (e) { }
              await new Promise(r => pauseResolvers.push(r));
              continue; // Retry loop
            } else {
              failedInvoices.push(invoiceNumber);
              sendInvoiceDone(invoiceNumber, 0, "failed");
              sendLog(`❌ Failed ${invoiceNumber}: ${result.error || 'No data'}`, "error");
              return;
            }
          } catch (err) {
            if (err.message === "CAPTCHA_DETECTED") {
              isPaused = true;
              sendLog(`⚠️ Captcha on ${invoiceNumber}. Paused.`, "warning");
              sendToPanel({ type: "PAUSED_CAPTCHA" });
              await chrome.tabs.update(tabId, { active: true });
              try {
                const tabInfo = await chrome.tabs.get(tabId);
                await chrome.windows.update(tabInfo.windowId, { focused: true });
              } catch (e) { }
              await new Promise(r => pauseResolvers.push(r));
              continue; // Retry
            } else {
              failedInvoices.push(invoiceNumber);
              sendInvoiceDone(invoiceNumber, 0, "failed");
              sendLog(`❌ Error on ${invoiceNumber}: ${err.message}`, "error");
              return;
            }
          }
        }
      };

      // Launch ALL invoices in this batch simultaneously using the tab pool
      const batchPromises = batch.map(async (invoiceNumber, i) => {
        if (isAborted) return;
        const tabId = tabPool[i];
        sendLog(`[Tab ${i + 1}] Starting ${invoiceNumber}...`, "info");
        await processInvoiceWithRetry(invoiceNumber, tabId);
        completedCount++;
        sendLog(`[Tab ${i + 1}] Finished ${invoiceNumber}. Total completed: ${completedCount}/${total}`, "info");
        sendProgress(completedCount, total, activeTabs.size, parallelCount, invoiceNumber, combinedRows.length);
      });

      // ── WAIT for entire batch to complete before proceeding ──
      await Promise.all(batchPromises);

      // Confirm batch done to the UI
      sendLog(`Batch ${batchNum} complete.`, "info");
      sendProgress(completedCount, total, activeTabs.size, parallelCount, `Batch ${batchNum}/${totalBatches} done`, combinedRows.length);

      // ── PROGRESSIVE SAVE ──
      sendPartialData(combinedRows);

      // Save session to storage for recovery
      await chrome.storage.local.set({
        savedSession: {
          vendorCode,
          invoiceNumbers,
          combinedRows,
          failedInvoices,
          completedCount,
          totalInvoices: total,
          headers: headers
        }
      });

      // Anti-bot delay between batches: 3–10 seconds (skip after the last batch)
      if (batchEnd < total && !isAborted) {
        await randomDelay(3000, 10000);
      }
    }

    // ── AUTO-RETRY FAILED INVOICES ──
    if (!isAborted && failedInvoices.length > 0) {
      sendProgress(completedCount, total, 0, parallelCount, "Starting retry pass...", combinedRows.length);

      const retryList = [...failedInvoices];
      failedInvoices = []; // Reset for the retry pass

      for (let i = 0; i < retryList.length; i++) {
        if (isAborted) {
          failedInvoices.push(...retryList.slice(i)); // keep the rest as failed
          break;
        }

        const invoiceNumber = retryList[i];
        sendProgress(completedCount, total, 1, parallelCount, `Retrying: ${invoiceNumber}`, combinedRows.length);

        try {
          sendLog(`Retrying ${invoiceNumber}...`, "info");
          // Retry sequentially with a longer page wait using the first tab in the pool
          const retryWait = Math.max(pageWait + 2, 5);
          const tabId = tabPool[0];

          let result;
          while (true) {
            if (isAborted) break;
            try {
              result = await processSingleInvoice(tabId, invoiceNumber, vendorCode, retryWait);
              if (result.error === "CAPTCHA_DETECTED") {
                isPaused = true;
                sendLog(`⚠️ Captcha on ${invoiceNumber}. Paused.`, "warning");
                sendToPanel({ type: "PAUSED_CAPTCHA" });
                await chrome.tabs.update(tabId, { active: true });
                await new Promise(r => pauseResolvers.push(r));
                continue;
              }
              break;
            } catch (err) {
              if (err.message === "CAPTCHA_DETECTED") {
                isPaused = true;
                sendLog(`⚠️ Captcha on ${invoiceNumber}. Paused.`, "warning");
                sendToPanel({ type: "PAUSED_CAPTCHA" });
                await chrome.tabs.update(tabId, { active: true });
                await new Promise(r => pauseResolvers.push(r));
                continue;
              }
              throw err;
            }
          }

          if (result && result.success && result.rows.length > 0) {
            const invoiceRows = result.rows.map(row => [invoiceNumber, ...row]);
            combinedRows.push(...invoiceRows);
            sendInvoiceDone(invoiceNumber, result.rows.length, "success");
            sendLog(`✅ ${invoiceNumber} recovered!`, "success");
            // Also update storage
            await chrome.storage.local.set({
              savedSession: {
                vendorCode,
                invoiceNumbers,
                combinedRows,
                failedInvoices: [...failedInvoices, ...retryList.slice(i + 1)],
                completedCount,
                totalInvoices: total,
                headers: headers
              }
            });
          } else {
            failedInvoices.push(invoiceNumber);
            sendInvoiceDone(invoiceNumber, 0, "failed");
            sendLog(`❌ Retry failed for ${invoiceNumber}`, "error");
          }
        } catch (err) {
          failedInvoices.push(invoiceNumber);
          sendInvoiceDone(invoiceNumber, 0, "failed");
          sendLog(`❌ Error on retry ${invoiceNumber}: ${err.message}`, "error");
        }

        if (i < retryList.length - 1 && !isAborted) {
          await randomDelay(2000, 5000);
        }
      }
    }

  } finally {
    // Always stop keep-alive when done (even on abort/error)
    stopKeepAlive();

    // Clean up Tab Pool
    sendLog("Closing tab pool...", "info");
    await closeAllActiveTabs();

    // Clear saved session if completed fully (not aborted)
    if (!isAborted && failedInvoices.length === 0) {
      await chrome.storage.local.remove("savedSession");
    } else if (!isAborted && failedInvoices.length > 0) {
      // Keep session for "Retry Failed" action if some failed
      await chrome.storage.local.set({
        savedSession: {
          vendorCode,
          invoiceNumbers,
          combinedRows,
          failedInvoices,
          completedCount: total,
          totalInvoices: total,
          headers: headers
        }
      });
    }

    // Play notification sound via Offscreen
    playNotification(failedInvoices.length > 0 || isAborted);
  }

  // Send final result (including partial data on abort)
  sendComplete(headers, combinedRows, failedInvoices);
}

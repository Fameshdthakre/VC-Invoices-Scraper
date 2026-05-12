document.addEventListener("DOMContentLoaded", async () => {
  // ═══ DOM REFERENCES ═══
  const vendorCodeInput = document.getElementById("vendorCode");
  const vendorBadge = document.getElementById("vendorBadge");
  const invoiceTextarea = document.getElementById("invoiceNumbers");
  const invoiceCount = document.getElementById("invoiceCount");
  const parallelTabsSlider = document.getElementById("parallelTabs");
  const parallelValueBadge = document.getElementById("parallelValue");
  const pageWaitTimeSlider = document.getElementById("pageWaitTime");
  const pageWaitValueBadge = document.getElementById("pageWaitValue");
  const recoveryUi = document.getElementById("recoveryUi");
  const recoveryDetails = document.getElementById("recoveryDetails");
  const resumeBtn = document.getElementById("resumeBtn");
  const clearBtn = document.getElementById("clearBtn");
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const downloadBtn = document.getElementById("downloadBtn");
  const downloadCsvBtn = document.getElementById("downloadCsvBtn");
  const statusDiv = document.getElementById("status");
  const themeToggle = document.getElementById("themeToggle");
  const versionTag = document.getElementById("versionTag");
  const alertOverlay = document.getElementById("alertOverlay");
  const alertMessage = document.getElementById("alertMessage");
  const alertOkBtn = document.getElementById("alertOkBtn");
  const modalIcon = document.getElementById("modalIcon");
  const modalTitle = document.getElementById("modalTitle");
  const resultsSummary = document.getElementById("resultsSummary");
  const statRows = document.getElementById("statRows");
  const statFailed = document.getElementById("statFailed");
  const clearInvoicesBtn = document.getElementById("clearInvoicesBtn");
  const copyFailedBtn = document.getElementById("copyFailedBtn");
  const captchaOverlay = document.getElementById("captchaOverlay");
  const resumeCaptchaBtn = document.getElementById("resumeCaptchaBtn");
  const logToggleBtn = document.getElementById("logToggleBtn");
  const invoiceLog = document.getElementById("invoiceLog");
  const logToggleIcon = document.getElementById("logToggleIcon");

  const previewBtn = document.getElementById("previewBtn");
  const retryFailedBtn = document.getElementById("retryFailedBtn");
  const previewOverlay = document.getElementById("previewOverlay");
  const previewOkBtn = document.getElementById("previewOkBtn");
  const closePreviewBtn = document.getElementById("closePreviewBtn");
  const previewHead = document.getElementById("previewHead");
  const previewBody = document.getElementById("previewBody");

  // ═══ MANIFEST METADATA (DYNAMIC NAME & VERSION) ═══
  const manifest = chrome.runtime.getManifest();
  const extName = manifest.name;

  // Set page title and header title
  document.title = extName;
  const mainTitleEl = document.getElementById("mainTitle");
  if (mainTitleEl) {
    mainTitleEl.textContent = extName;
  }

  if (versionTag) {
    versionTag.textContent = `v${manifest.version}`;
  }

  // ═══ STATE ═══
  let port = null;
  let isScraping = false;
  let collectedData = null; // { headers, rows, failedInvoices }
  let cachedProgressElements = null;
  let scrapeStartTime = null;
  let elapsedTimerInterval = null;

  // ═══════════════════════════════════════════
  //  THEME TOGGLE
  // ═══════════════════════════════════════════
  async function initTheme() {
    const { theme } = await chrome.storage.local.get("theme");
    if (theme === "dark") {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggle.textContent = "☀️";
    } else {
      document.documentElement.removeAttribute("data-theme");
      themeToggle.textContent = "🌙";
    }
  }

  themeToggle.addEventListener("click", async () => {
    const isDark = document.documentElement.getAttribute("data-theme") === "dark";
    if (isDark) {
      document.documentElement.removeAttribute("data-theme");
      themeToggle.textContent = "🌙";
      await chrome.storage.local.set({ theme: "light" });
    } else {
      document.documentElement.setAttribute("data-theme", "dark");
      themeToggle.textContent = "☀️";
      await chrome.storage.local.set({ theme: "dark" });
    }
    themeToggle.style.transform = "rotate(360deg)";
    setTimeout(() => (themeToggle.style.transform = ""), 300);
  });

  await initTheme();

  // ═══════════════════════════════════════════
  //  PARALLEL TABS SLIDER
  // ═══════════════════════════════════════════
  // Restore saved value
  const { parallelCount: savedParallel } = await chrome.storage.local.get("parallelCount");
  if (savedParallel && savedParallel >= 3 && savedParallel <= 15) {
    parallelTabsSlider.value = savedParallel;
    parallelValueBadge.textContent = savedParallel;
  }

  parallelTabsSlider.addEventListener("input", () => {
    parallelValueBadge.textContent = parallelTabsSlider.value;
  });

  parallelTabsSlider.addEventListener("change", () => {
    chrome.storage.local.set({ parallelCount: parseInt(parallelTabsSlider.value) });
  });

  // ═══════════════════════════════════════════
  //  PAGE WAIT SLIDER
  // ═══════════════════════════════════════════
  const { pageWaitTime: savedPageWait } = await chrome.storage.local.get("pageWaitTime");
  if (savedPageWait && savedPageWait >= 1 && savedPageWait <= 5) {
    pageWaitTimeSlider.value = savedPageWait;
    pageWaitValueBadge.textContent = savedPageWait + "s";
  }

  pageWaitTimeSlider.addEventListener("input", () => {
    pageWaitValueBadge.textContent = pageWaitTimeSlider.value + "s";
  });

  pageWaitTimeSlider.addEventListener("change", () => {
    chrome.storage.local.set({ pageWaitTime: parseInt(pageWaitTimeSlider.value) });
  });

  // ═══════════════════════════════════════════
  //  INPUT VALIDATION — Vendor Code
  // ═══════════════════════════════════════════
  vendorCodeInput.addEventListener("input", () => {
    // Auto-uppercase, strip non-alphanumeric
    vendorCodeInput.value = vendorCodeInput.value
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "")
      .slice(0, 5);

    const val = vendorCodeInput.value;
    if (val.length === 5) {
      vendorBadge.textContent = "✓";
      vendorBadge.className = "validation-badge valid";
    } else if (val.length > 0) {
      vendorBadge.textContent = "✗";
      vendorBadge.className = "validation-badge invalid";
    } else {
      vendorBadge.className = "validation-badge";
    }

    validateInputs();
  });

  // ═══════════════════════════════════════════
  //  INPUT VALIDATION — Invoice Numbers
  // ═══════════════════════════════════════════
  invoiceTextarea.addEventListener("input", () => {
    validateInputs();
  });

  function parseInvoiceNumbers(text) {
    return text
      .split(/[\n\r]+/)
      .map(line => line.trim())
      .filter(line => line.length > 0)
      .filter((v, i, a) => a.indexOf(v) === i); // Deduplicate
  }

  function validateInputs() {
    const vendorCode = vendorCodeInput.value.trim();
    const invoices = parseInvoiceNumbers(invoiceTextarea.value);

    // Update invoice count badge
    invoiceCount.textContent = `${invoices.length} line${invoices.length !== 1 ? "s" : ""}`;

    // Enable start only if both inputs are valid
    const vendorValid = /^[A-Z0-9]{5}$/.test(vendorCode);
    startBtn.disabled = !(vendorValid && invoices.length > 0) || isScraping;
  }

  // ═══════════════════════════════════════════
  //  CLEAR ALL INVOICES
  // ═══════════════════════════════════════════
  clearInvoicesBtn.addEventListener("click", () => {
    invoiceTextarea.value = "";
    validateInputs();
  });

  // ═══════════════════════════════════════════
  //  PORT CONNECTION
  // ═══════════════════════════════════════════
  function connectPort() {
    port = chrome.runtime.connect({ name: "sidepanel" });

    port.onMessage.addListener((msg) => {
      switch (msg.type) {
        case "PROGRESS":
          handleProgress(msg);
          break;
        case "PARTIAL_DATA":
          handlePartialData(msg);
          break;
        case "INVOICE_DONE":
          handleInvoiceDone(msg);
          break;
        case "COMPLETE":
          handleComplete(msg);
          break;
        case "ERROR":
          handleError(msg);
          break;
        case "PAUSED_CAPTCHA":
          handleCaptchaPause();
          break;
        case "LOG":
          logActivity(msg.message, msg.logType);
          break;
      }
    });

    port.onDisconnect.addListener(() => {
      port = null;
      // Reconnect if we were scraping
      if (isScraping) {
        setTimeout(connectPort, 500);
      }
    });
  }

  // ═══════════════════════════════════════════
  //  START SCRAPING
  // ═══════════════════════════════════════════
  startBtn.addEventListener("click", () => {
    const vendorCode = vendorCodeInput.value.trim();
    const invoices = parseInvoiceNumbers(invoiceTextarea.value);
    const parallelCount = parseInt(parallelTabsSlider.value);
    const pageWait = parseInt(pageWaitTimeSlider.value);

    if (!vendorCode || invoices.length === 0) return;

    if (parallelCount >= 10 && invoices.length > 100) {
      const confirmMsg = "Warning: Running 10+ parallel tabs with a large number of invoices may cause high memory usage or browser lag. Are you sure you want to proceed?";
      if (!confirm(confirmMsg)) return;
    }

    isScraping = true;
    collectedData = null;
    cachedProgressElements = null;
    scrapeStartTime = Date.now();
    recoveryUi.classList.add("hidden");

    // Connect port
    connectPort();

    // Send START_SCRAPE
    port.postMessage({
      type: "START_SCRAPE",
      vendorCode,
      invoiceNumbers: invoices,
      parallelCount,
      pageWait,
    });

    // Reset log
    invoiceLog.innerHTML = "";
    logToggleBtn.classList.add("hidden");

    // Update UI
    lockUI();
    statusDiv.textContent = `Initializing ${parallelCount} parallel tabs…`;
  });

  // ═══════════════════════════════════════════
  //  STOP SCRAPING
  // ═══════════════════════════════════════════
  stopBtn.addEventListener("click", () => {
    if (port) {
      port.postMessage({ type: "STOP_SCRAPE" });
    }
    stopBtn.disabled = true;
    stopBtn.innerHTML = "⏳ Stopping…";
    statusDiv.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = "Stopping…";
    statusDiv.appendChild(b);
    statusDiv.appendChild(document.createTextNode(" Closing active tabs and finishing."));
  });

  // ═══════════════════════════════════════════
  //  MESSAGE HANDLERS
  // ═══════════════════════════════════════════
  // ── Format elapsed time as mm:ss ──
  function formatElapsed(ms) {
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    return `${String(min).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }



  function handleProgress(msg) {
    const { completedInvoices, totalInvoices, activeTabs, parallelCount, invoiceNumber, totalRows } = msg;
    const percentage = Math.round((completedInvoices / totalInvoices) * 100);

    if (!cachedProgressElements) {
      statusDiv.innerHTML = "";
      const container = document.createElement("div");
      container.style.width = "100%";
      container.innerHTML = `
        <div class="progress-header">
          <span>Invoices <b id="prog-text"></b></span>
          <span id="elapsed-text" class="etr-label"></span>
        </div>
        <div class="progress-stats-row">
          <span id="rows-text" class="stat-pill">📊 0 rows</span>
          <span id="tabs-text" class="stat-pill">📌 0 tabs</span>
        </div>
        <div id="log-text" class="log-label"></div>
        <div class="progress-track">
          <div id="prog-bar" class="progress-fill"></div>
        </div>
        <div id="active-dots" class="active-tabs-indicator"></div>
      `;
      statusDiv.appendChild(container);

      cachedProgressElements = {
        progText: document.getElementById("prog-text"),
        elapsedText: document.getElementById("elapsed-text"),
        rowsText: document.getElementById("rows-text"),
        tabsText: document.getElementById("tabs-text"),
        logText: document.getElementById("log-text"),
        progBar: document.getElementById("prog-bar"),
        activeDots: document.getElementById("active-dots"),
      };

      // Start elapsed timer (updates every second)
      if (elapsedTimerInterval) clearInterval(elapsedTimerInterval);
      elapsedTimerInterval = setInterval(() => {
        if (cachedProgressElements && scrapeStartTime) {
          const elapsedMs = Date.now() - scrapeStartTime;
          if (completedInvoices > 0) {
            const avgTimePerInvoice = elapsedMs / completedInvoices;
            const remainingInvoices = totalInvoices - completedInvoices;
            const etrMs = avgTimePerInvoice * remainingInvoices;
            cachedProgressElements.elapsedText.textContent = `⏱ ${formatElapsed(elapsedMs)} (ETR: ${formatElapsed(etrMs)})`;
          } else {
            cachedProgressElements.elapsedText.textContent = `⏱ ${formatElapsed(elapsedMs)}`;
          }
        }
      }, 1000);
    }

    cachedProgressElements.progText.textContent = `${completedInvoices}/${totalInvoices}`;
    cachedProgressElements.rowsText.textContent = `📊 ${totalRows} rows`;
    cachedProgressElements.tabsText.textContent = `📌 ${activeTabs} tab${activeTabs !== 1 ? "s" : ""} active`;
    cachedProgressElements.logText.textContent = invoiceNumber
      ? `Latest: ${invoiceNumber}`
      : "Starting tabs…";
    cachedProgressElements.progBar.style.width = `${percentage}%`;
    if (scrapeStartTime) {
      const elapsedMs = Date.now() - scrapeStartTime;
      if (completedInvoices > 0) {
        const avgTimePerInvoice = elapsedMs / completedInvoices;
        const remainingInvoices = totalInvoices - completedInvoices;
        const etrMs = avgTimePerInvoice * remainingInvoices;
        cachedProgressElements.elapsedText.textContent = `⏱ ${formatElapsed(elapsedMs)} (ETR: ${formatElapsed(etrMs)})`;
      } else {
        cachedProgressElements.elapsedText.textContent = `⏱ ${formatElapsed(elapsedMs)}`;
      }
    }

    // Render active tab dots
    const dotsHtml = [];
    for (let i = 0; i < parallelCount; i++) {
      dotsHtml.push(`<span class="tab-dot ${i < activeTabs ? 'active' : ''}"></span>`);
    }
    cachedProgressElements.activeDots.innerHTML =
      `<span class="tab-dots">${dotsHtml.join("")}</span>` +
      `<span>${activeTabs}/${parallelCount} slots</span>`;
  }

  function handlePartialData(msg) {
    if (!collectedData) {
      collectedData = { headers: [], rows: [], failedInvoices: [] };
    }
    collectedData.rows = msg.rows;
    // Allow download of partial data
    downloadBtn.style.display = "flex";
    downloadCsvBtn.style.display = "flex";
  }

  function handleInvoiceDone(msg) {
    // Optional: could log individual invoice results
  }

  function handleComplete(msg) {
    isScraping = false;
    if (elapsedTimerInterval) { clearInterval(elapsedTimerInterval); elapsedTimerInterval = null; }
    collectedData = {
      headers: msg.headers,
      rows: msg.rows,
      failedInvoices: msg.failedInvoices || [],
    };

    unlockUI();

    // Show results summary
    const totalRows = collectedData.rows.length;
    const failedCount = collectedData.failedInvoices.length;

    statRows.textContent = totalRows;
    statFailed.textContent = failedCount;
    resultsSummary.classList.remove("hidden");

    if (totalRows > 0) {
      downloadBtn.style.display = "flex";
      downloadCsvBtn.style.display = "flex";
    }

    if (failedCount > 0) {
      retryFailedBtn.classList.remove("hidden");
    } else {
      retryFailedBtn.classList.add("hidden");
    }

    // Update status
    const elapsed = scrapeStartTime ? formatElapsed(Date.now() - scrapeStartTime) : "00:00";
    statusDiv.innerHTML = "";
    const b = document.createElement("b");
    b.textContent = "Scraping Complete!";
    statusDiv.appendChild(b);
    if (failedCount > 0) {
      statusDiv.appendChild(
        document.createTextNode(` ${totalRows} rows extracted in ${elapsed} mm:ss. ${failedCount} invoice(s) failed.`)
      );
    } else {
      statusDiv.appendChild(
        document.createTextNode(` ${totalRows} rows extracted successfully in ${elapsed} mm:ss.`)
      );
    }

    // Show modal
    showModal(
      "✓",
      "Scraping Complete",
      `Total rows: ${totalRows}\nFailed invoices: ${failedCount}${failedCount > 0 ? "\n\n" + collectedData.failedInvoices.join("\n") : ""
      }`,
      false
    );



    if (failedCount > 0) {
      copyFailedBtn.classList.remove("hidden");
    } else {
      copyFailedBtn.classList.add("hidden");
    }
  }

  function handleError(msg) {
    isScraping = false;
    if (elapsedTimerInterval) { clearInterval(elapsedTimerInterval); elapsedTimerInterval = null; }
    unlockUI();

    statusDiv.innerHTML = "";
    const b = document.createElement("b");
    b.style.color = "var(--danger)";
    b.textContent = "Error: ";
    statusDiv.appendChild(b);
    statusDiv.appendChild(document.createTextNode(msg.message));

    // If we have partial data, allow download
    if (collectedData && collectedData.rows && collectedData.rows.length > 0) {
      downloadBtn.style.display = "flex";
      downloadCsvBtn.style.display = "flex";
    }

    showModal("✗", "Error", msg.message, true);

  }

  // ═══════════════════════════════════════════
  //  CAPTCHA & LOG HANDLING
  // ═══════════════════════════════════════════
  function handleCaptchaPause() {
    captchaOverlay.style.display = "flex";

  }

  resumeCaptchaBtn.addEventListener("click", () => {
    captchaOverlay.style.display = "none";
    if (port) {
      port.postMessage({ type: "RESUME_FROM_PAUSE" });
      logActivity("Resuming from Captcha...", "warning");
    }
  });

  logToggleBtn.addEventListener("click", () => {
    invoiceLog.classList.toggle("expanded");
    logToggleIcon.textContent = invoiceLog.classList.contains("expanded") ? "▲" : "▼";
  });

  function logActivity(text, type = "info") {
    const entry = document.createElement("div");
    entry.className = "invoice-entry";
    let icon = "ℹ️";
    if (type === "success") icon = "✅";
    if (type === "error") icon = "❌";
    if (type === "warning") icon = "⚠️";
    entry.innerHTML = `<span class="invoice-status-icon">${icon}</span> <span>${text}</span>`;
    invoiceLog.appendChild(entry);
    invoiceLog.scrollTop = invoiceLog.scrollHeight;
    logToggleBtn.classList.remove("hidden");
  }

  // ═══════════════════════════════════════════
  //  MODAL HELPERS
  // ═══════════════════════════════════════════
  function showModal(icon, title, message, isError = false) {
    modalIcon.textContent = icon;
    modalIcon.className = isError ? "modal-icon error" : "modal-icon";
    modalTitle.textContent = title;
    alertMessage.textContent = message;
    alertOverlay.style.display = "flex";
  }

  alertOkBtn.addEventListener("click", () => {
    alertOverlay.style.display = "none";
  });

  copyFailedBtn.addEventListener("click", () => {
    if (collectedData && collectedData.failedInvoices) {
      navigator.clipboard.writeText(collectedData.failedInvoices.join("\n"));
      const originalText = copyFailedBtn.textContent;
      copyFailedBtn.textContent = "Copied!";
      setTimeout(() => copyFailedBtn.textContent = originalText, 2000);
    }
  });

  // ═══════════════════════════════════════════
  //  DATA PREVIEW
  // ═══════════════════════════════════════════
  previewBtn.addEventListener("click", () => {
    if (!collectedData || !collectedData.rows || collectedData.rows.length === 0) return;

    const { headers, rows } = collectedData;
    const fullHeaders = ["Invoice", ...headers];

    // Build head
    previewHead.innerHTML = `<tr>${fullHeaders.map(h => `<th>${h}</th>`).join("")}</tr>`;

    // Build body (max 10 rows)
    const previewRows = rows.slice(0, 10);
    previewBody.innerHTML = previewRows.map(row => `<tr>${row.map(cell => `<td>${cell || ""}</td>`).join("")}</tr>`).join("");

    previewOverlay.style.display = "flex";
  });

  previewOkBtn.addEventListener("click", () => previewOverlay.style.display = "none");
  closePreviewBtn.addEventListener("click", () => previewOverlay.style.display = "none");

  // ═══════════════════════════════════════════
  //  RETRY FAILED
  // ═══════════════════════════════════════════
  retryFailedBtn.addEventListener("click", () => {
    if (port) {
      const parallelCount = parseInt(parallelTabsSlider.value);
      const pageWait = parseInt(pageWaitTimeSlider.value);

      isScraping = true;
      cachedProgressElements = null;
      scrapeStartTime = Date.now();
      resultsSummary.classList.add("hidden");
      retryFailedBtn.classList.add("hidden");

      port.postMessage({
        type: "RETRY_FAILED",
        parallelCount,
        pageWait
      });

      lockUI();
      statusDiv.textContent = "Retrying failed invoices...";
    }
  });

  // ═══════════════════════════════════════════
  //  EXCEL EXPORT (SheetJS)
  // ═══════════════════════════════════════════
  downloadBtn.addEventListener("click", () => {
    if (!collectedData || !collectedData.rows || collectedData.rows.length === 0) {
      showModal("✗", "No Data", "No data available to export.", true);
      return;
    }

    const { headers, rows, failedInvoices } = collectedData;
    const vendorCode = vendorCodeInput.value.trim();

    // Build data array: headers first row, then data rows
    const fullHeaders = ["Invoice", ...headers];
    const aoa = [fullHeaders, ...rows];

    // Create workbook
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(aoa);

    // Auto-size columns
    const colWidths = fullHeaders.map((h, i) => {
      let maxLen = h.length;
      rows.forEach(row => {
        const cellLen = (row[i] || "").toString().length;
        if (cellLen > maxLen) maxLen = cellLen;
      });
      return { wch: Math.min(maxLen + 2, 50) };
    });
    ws["!cols"] = colWidths;

    XLSX.utils.book_append_sheet(wb, ws, "Invoice Data");

    // ── Failed Invoices sheet ──
    if (failedInvoices && failedInvoices.length > 0) {
      const failedAoa = [["Invoice Number"], ...failedInvoices.map(inv => [inv])];
      const wsFailed = XLSX.utils.aoa_to_sheet(failedAoa);
      const maxLen = Math.max(
        "Invoice Number".length,
        ...failedInvoices.map(inv => inv.length)
      );
      wsFailed["!cols"] = [{ wch: maxLen + 2 }];
      XLSX.utils.book_append_sheet(wb, wsFailed, "Failed Invoices");
    }

    const now = new Date();
    const dateStr =
      now.getFullYear().toString() +
      String(now.getMonth() + 1).padStart(2, "0") +
      String(now.getDate()).padStart(2, "0");
    const timeStr =
      String(now.getHours()).padStart(2, "0") +
      String(now.getMinutes()).padStart(2, "0");

    const invoiceCount = parseInvoiceNumbers(invoiceTextarea.value).length;
    const filename = `${vendorCode}_${invoiceCount}_Invoices_Data_${dateStr}_${timeStr}.xlsx`;

    XLSX.writeFile(wb, filename);
  });

  // ═══════════════════════════════════════════
  //  CSV EXPORT
  // ═══════════════════════════════════════════
  downloadCsvBtn.addEventListener("click", () => {
    if (!collectedData || !collectedData.rows || collectedData.rows.length === 0) return;

    const { headers, rows } = collectedData;
    const vendorCode = vendorCodeInput.value.trim();
    const fullHeaders = ["Invoice", ...headers];

    // Helper to escape CSV cell
    const escapeCsv = (val) => {
      if (val === null || val === undefined) return "";
      let s = val.toString();
      if (s.includes(",") || s.includes("\"") || s.includes("\n")) {
        s = "\"" + s.replace(/"/g, "\"\"") + "\"";
      }
      return s;
    };

    const csvRows = [];
    csvRows.push(fullHeaders.map(escapeCsv).join(","));

    rows.forEach(row => {
      csvRows.push(row.map(escapeCsv).join(","));
    });

    const csvContent = csvRows.join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const now = new Date();
    const dateStr = now.getFullYear().toString() + String(now.getMonth() + 1).padStart(2, "0") + String(now.getDate()).padStart(2, "0");
    const timeStr = String(now.getHours()).padStart(2, "0") + String(now.getMinutes()).padStart(2, "0");

    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", `${vendorCode}_Invoices_Data_${dateStr}_${timeStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  });

  // ═══════════════════════════════════════════
  //  RECOVERY LOGIC
  // ═══════════════════════════════════════════
  async function checkSavedSession() {
    const { savedSession } = await chrome.storage.local.get("savedSession");
    if (savedSession) {
      recoveryUi.classList.remove("hidden");
      recoveryDetails.textContent = `${savedSession.completedCount}/${savedSession.totalInvoices} invoices, ${savedSession.combinedRows.length} rows, ${savedSession.failedInvoices.length} failed.`;

      // Load into memory so user can download what was saved
      collectedData = {
        headers: savedSession.headers,
        rows: savedSession.combinedRows,
        failedInvoices: savedSession.failedInvoices
      };

      if (collectedData.rows.length > 0) {
        downloadBtn.style.display = "flex";
        downloadCsvBtn.style.display = "flex";
      }

      vendorCodeInput.value = savedSession.vendorCode;
      invoiceTextarea.value = savedSession.invoiceNumbers.join("\n");
      validateInputs();
    }
  }

  resumeBtn.addEventListener("click", () => {
    isScraping = true;
    cachedProgressElements = null;
    scrapeStartTime = Date.now();
    recoveryUi.classList.add("hidden");

    const parallelCount = parseInt(parallelTabsSlider.value);
    const pageWait = parseInt(pageWaitTimeSlider.value);

    connectPort();

    port.postMessage({
      type: "RESUME_SCRAPE",
      parallelCount,
      pageWait
    });

    lockUI();
    statusDiv.textContent = `Resuming with ${parallelCount} parallel tabs...`;
  });

  clearBtn.addEventListener("click", async () => {
    await chrome.storage.local.remove("savedSession");
    recoveryUi.classList.add("hidden");
    collectedData = null;
    downloadBtn.style.display = "none";
    downloadCsvBtn.style.display = "none";
  });

  checkSavedSession();

  // ═══════════════════════════════════════════
  //  UI LOCK / UNLOCK
  // ═══════════════════════════════════════════
  function lockUI() {
    startBtn.style.display = "none";
    stopBtn.style.display = "flex";
    stopBtn.disabled = false;
    stopBtn.innerHTML = "⏹ Stop Scraping";
    downloadBtn.style.display = "none";
    downloadCsvBtn.style.display = "none";
    resultsSummary.classList.add("hidden");

    vendorCodeInput.disabled = true;
    invoiceTextarea.disabled = true;
    parallelTabsSlider.disabled = true;
    pageWaitTimeSlider.disabled = true;
    vendorCodeInput.classList.add("disabled-ui");
    invoiceTextarea.classList.add("disabled-ui");
    parallelTabsSlider.classList.add("disabled-ui");
    pageWaitTimeSlider.classList.add("disabled-ui");
  }

  function unlockUI() {
    startBtn.style.display = "flex";
    stopBtn.style.display = "none";

    vendorCodeInput.disabled = false;
    invoiceTextarea.disabled = false;
    parallelTabsSlider.disabled = false;
    pageWaitTimeSlider.disabled = false;
    vendorCodeInput.classList.remove("disabled-ui");
    invoiceTextarea.classList.remove("disabled-ui");
    parallelTabsSlider.classList.remove("disabled-ui");
    pageWaitTimeSlider.classList.remove("disabled-ui");

    validateInputs();
  }
});

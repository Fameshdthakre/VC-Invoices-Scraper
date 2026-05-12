# Privacy Policy for VC Invoices Scraper

**Effective Date:** May 12, 2026

## 1. Introduction
VC Invoices Scraper ("we," "us," or "the extension") is committed to protecting your privacy. This Privacy Policy explains how we handle data within the Chrome extension.

## 2. Data Collection and Usage
The extension is designed to scrape invoice data from Amazon Vendor Central for the sole purpose of exporting it to Excel or CSV formats for the user.
- **No Personal Data Collection:** We do not collect, store, or transmit any personally identifiable information (PII).
- **No External Transmission:** All data scraping, processing, and file generation happen **locally** within your browser. No data is ever sent to our servers or any third-party services.
- **Amazon Data:** The extension only accesses data on `vendorcentral.amazon.com` when explicitly initiated by the user. This data is only used to generate the export files requested by the user.

## 3. Storage
The extension uses `chrome.storage.local` to store:
- User settings (e.g., UI theme, parallel tab count).
- Temporary scraping progress (to allow for session recovery in case of a browser crash).
This data remains on your local machine and is not synced across devices unless you have enabled Chrome's native sync feature (and even then, only settings are synced, not scraped data).

## 4. Third-Party Services
The extension does not use any third-party tracking, analytics, or advertising services. It uses the `xlsx.full.min.js` (SheetJS) library locally to generate Excel files.

## 5. Permissions
The extension requests only the permissions necessary for its core functionality:
- **Scripting & Host Permissions:** To read invoice tables on Vendor Central.
- **Tabs:** To manage parallel scraping tabs.
- **Storage:** To save your preferences and progress.
- **Offscreen & Alarms:** To ensure the extension continues working during long-running tasks.

## 6. Changes to This Policy
We may update this Privacy Policy from time to time. Any changes will be reflected by the "Effective Date" at the top of this page.

## 7. Contact Us
If you have any questions about this Privacy Policy, please contact the developer through the Chrome Web Store support channel.

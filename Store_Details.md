# Chrome Web Store Details

## 1. Extension Description

### Short Description (Max 132 characters)
Scrape and export Amazon Vendor Central invoice line-item data to Excel and CSV with parallel processing and automated validation.

### Long Description
**VC Invoices Scraper** is a high-performance productivity tool designed for Amazon Vendors to streamline the extraction of invoice data. Stop wasting hours manually copying data or downloading individual PDFs. Extract thousands of line items in minutes directly from your Vendor Central account.

**Key Features:**
- **🚀 Parallel Processing:** Open up to 15 parallel tabs to scrape multiple invoices simultaneously, drastically reducing wait times.
- **📊 Excel & CSV Export:** Download your data in clean, formatted .xlsx or .csv files, ready for accounting or reconciliation.
- **🛡️ Automated Validation:** Built-in logic checks if the scraped line-item totals match the invoice total, alerting you to any discrepancies or missing data.
- **🔄 Session Recovery:** If your browser crashes or you accidentally close the panel, resume your scraping job right where you left off.
- **🤖 Captcha Handling:** Automatically detects "Robot Checks" and pauses, allowing you to solve the captcha and resume without losing progress.
- **🌓 Dark Mode UI:** A modern, sleek side panel interface that stays out of your way while you work.

**How to use:**
1. Open the Vendor Central Invoice Management page.
2. Enter your 5-digit Vendor Code.
3. Paste a list of Invoice Numbers.
4. Adjust parallel tabs and wait time settings.
5. Hit "Start Scraping" and watch the progress in real-time.

**Privacy & Security:**
- Your data never leaves your browser.
- No external servers or APIs are used.
- All processing is done locally on your machine.

---

## 2. Permission Justifications

When submitting to the Chrome Web Store, you will need to provide these justifications in the "Privacy" tab:

- **scripting**: Required to inject the scraping engine into the Amazon Vendor Central invoice details page to extract table data.
- **tabs**: Used to open and manage multiple background tabs for parallel scraping, ensuring a fast and efficient user experience.
- **activeTab**: Allows the extension to interact with the Vendor Central page the user is currently viewing to initiate the scraping process.
- **sidePanel**: Provides a persistent and intuitive user interface for managing scraping jobs without interrupting the main browsing flow.
- **storage**: Used to save user preferences (theme, parallel count, wait times) and temporarily cache scraping progress for session recovery.
- **alarms**: Powers the background "keep-alive" mechanism, preventing Chrome from terminating the extension during long-running batch jobs.
- **unlimitedStorage**: Necessary to handle large batches of invoice data (thousands of rows) that may exceed the default browser storage limits.
- **offscreen**: Used to maintain a persistent background state during long scrapes and play notification sounds when a job is complete or requires attention.
- **Host Permission (https://vendorcentral.amazon.com/*)**: Explicitly required to access and scrape data from the invoice detail pages on the Amazon Vendor Central domain.

/**
 * Load the demo in a real headless browser and check that it works.
 *
 * Serves the project locally and drives it with the same minimal Chrome
 * driver the grid's own test suite uses (tools/browser.js), so this needs no
 * dependency beyond Chrome itself.
 *
 * Checks:
 *   - the library arrived and left the LatticeGrid global behind;
 *   - the grid reports exactly one million rows, and the readout on the page
 *     says so too;
 *   - only a small band of them is ever mounted as DOM elements, proving the
 *     scroll stays virtualised rather than rendering the whole array;
 *   - scrolling the grid's own viewport to the bottom brings row 1,000,000
 *     into the mounted band, not something short of it;
 *   - clicking the Value column's header sorts it (the header's own
 *     data-sort attribute flips to 'asc' and the mounted rows reorder);
 *   - typing into the quick filter narrows the grid to the matching rows;
 *   - nothing logged a console error or threw while the page ran.
 *
 * Exits non-zero on any failure, so it can gate a deployment.
 *
 * Usage: node tools/verify.mjs
 */

import { startServer } from './serve.mjs';
import { Browser, available } from './browser.js';

if (!available()) {
  console.log('No headless browser on this machine; skipping verify.mjs.');
  process.exit(0);
}

const { server, port } = await startServer();
const browser = new Browser();

try {
  await browser.start();

  // Collect console errors and thrown errors from the very first script the
  // page runs, before LatticeGrid or demo.js execute.
  await browser.send('Page.addScriptToEvaluateOnNewDocument', {
    source: `
      window.__errs = [];
      addEventListener('error', (e) => window.__errs.push(String(e.message || e)));
      addEventListener('unhandledrejection', (e) => window.__errs.push('unhandledrejection: ' + String(e.reason)));
      const origError = console.error.bind(console);
      console.error = (...args) => { window.__errs.push('console.error: ' + args.map(String).join(' ')); origError(...args); };
    `,
  });

  const before = Date.now();
  await browser.open(`http://127.0.0.1:${port}/`);
  const paintMs = Date.now() - before;

  const hasGrid = await browser.evaluate(`typeof LatticeGrid !== 'undefined' && typeof LatticeGrid.createGrid === 'function'`);
  const rowCount = await browser.evaluate(`window.__demoGrid.rows.count()`);
  const mountedRows = await browser.evaluate(`document.querySelectorAll('.lat-row').length`);
  const statText = await browser.evaluate(`document.getElementById('stat').textContent`);

  // Scroll the grid's own scrolling element to the very bottom, before any
  // sort, and read the largest id currently mounted in the body (not the
  // header, which also carries a data-col attribute).
  await browser.evaluate(`(() => {
    const vp = document.querySelector('.lat-body-viewport');
    vp.scrollTop = vp.scrollHeight;
  })()`);
  await new Promise((r) => setTimeout(r, 400));
  const lastVisibleId = await browser.evaluate(`(() => {
    const cells = document.querySelectorAll('.lat-row [data-col="id"]');
    let max = 0;
    cells.forEach((c) => { const v = parseInt(c.textContent.replace(/,/g, ''), 10); if (v > max) max = v; });
    return max;
  })()`);
  await browser.evaluate(`(() => { document.querySelector('.lat-body-viewport').scrollTop = 0; })()`);
  await new Promise((r) => setTimeout(r, 200));

  // Sort by clicking the Value column header.
  const beforeSort = await browser.evaluate(`document.querySelector('.lat-header-cell[data-col="value"]').getAttribute('data-sort')`);
  const beforeFirstValue = await browser.evaluate(`document.querySelector('.lat-row [data-col="value"]')?.textContent`);
  await browser.evaluate(`document.querySelector('.lat-header-cell[data-col="value"]').click()`);
  await new Promise((r) => setTimeout(r, 400));
  const afterSort = await browser.evaluate(`document.querySelector('.lat-header-cell[data-col="value"]').getAttribute('data-sort')`);
  const afterFirstValue = await browser.evaluate(`document.querySelector('.lat-row [data-col="value"]')?.textContent`);
  const sortCompleted = afterSort === 'asc' && afterSort !== beforeSort && afterFirstValue !== beforeFirstValue;

  // Quick filter: narrow to one region, check the grid's own visible count.
  await browser.evaluate(`document.getElementById('quick-filter').value = 'Europe';
    document.getElementById('quick-filter').dispatchEvent(new Event('input'));`);
  await new Promise((r) => setTimeout(r, 400));
  const filteredVisible = await browser.evaluate(`window.__demoGrid.rows.count({ visible: true })`);
  const filteredDomRows = await browser.evaluate(`document.querySelectorAll('.lat-row').length`);

  const errors = await browser.evaluate('window.__errs');

  const failures = [];
  if (!hasGrid) failures.push('LatticeGrid.createGrid was not found on the page');
  if (rowCount !== 1_000_000) failures.push(`expected 1,000,000 rows, grid reports ${rowCount}`);
  if (!(mountedRows > 0 && mountedRows < 500)) failures.push(`expected a small virtualised band of DOM rows, found ${mountedRows}`);
  if (!statText || !statText.includes('1,000,000')) failures.push(`the row-count readout did not report 1,000,000 (was "${statText}")`);
  if (lastVisibleId !== 1_000_000) failures.push(`scrolling to the end did not bring row 1,000,000 into view (saw ${lastVisibleId})`);
  if (!sortCompleted) failures.push(`sorting the Value column did not complete (before: ${beforeSort}/${beforeFirstValue}, after: ${afterSort}/${afterFirstValue})`);
  if (filteredVisible === 0 || filteredVisible === 1_000_000) failures.push(`the quick filter did not narrow the row count (visible: ${filteredVisible})`);
  if (!(filteredDomRows > 0 && filteredDomRows < 500)) failures.push(`expected a small virtualised band after filtering too, found ${filteredDomRows}`);
  if (errors.length) failures.push(`console/window errors: ${errors.join(' | ')}`);

  if (failures.length) {
    console.error('FAILED:\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exitCode = 1;
  } else {
    console.log(
      `OK: 1,000,000 rows reported, ${mountedRows} DOM rows mounted, page painted in ${paintMs}ms, ` +
      `scroll reached row 1,000,000, sort completed, quick filter narrowed to ${filteredVisible} rows, 0 console errors.`
    );
  }
} finally {
  await browser.close();
  server.close();
}

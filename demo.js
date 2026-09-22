/**
 * Virtual-scroll a million rows without pagination.
 *
 * A million rows are generated in a loop, handed to createGrid with nothing
 * but a rowKey, and the grid stays responsive: scrolling, sorting a column
 * by clicking its header, and typing into the quick filter below all run at
 * the same speed they would over a dozen rows, because only the rows in the
 * visible band are ever mounted as DOM elements.
 */

// Tied to toclocoinc.github.io only; has no effect anywhere else and needs
// no key at all to run this page from a local copy.
LatticeGrid.setLicence(
  'LG1.eyJ2IjoxLCJwIjoibGF0dGljZS1ncmlkIiwidCI6IlRPQ0xPQ08gSW5jIC0gcHVibGljIGRlbW9zIiwiZSI6IjIwMzAtMDEtMDEiLCJkIjpbInRvY2xvY29pbmMuZ2l0aHViLmlvIl19.9De42ua3aCGpiMB6EVRP7Tv-upUlDI-0T07rlSPzvCrsqg8t4YJi7SRnStEpAg48uzmcG7il1fR_TfwkUE7iCA'
);

const ROW_COUNT = 1_000_000;
const REGIONS = ['North America', 'Europe', 'Asia Pacific', 'Latin America', 'Middle East'];
const DAY = 24 * 60 * 60 * 1000;
const START_DATE = Date.parse('2022-01-01');

const started = performance.now();

const rows = [];
for (let i = 0; i < ROW_COUNT; i++) {
  rows.push({
    id: i + 1,
    name: `Record ${i + 1}`,
    region: REGIONS[i % REGIONS.length],
    value: Math.round((Math.sin(i / 97) * 4500 + 5000) * 100) / 100,
    date: new Date(START_DATE + (i % 1460) * DAY).toISOString().slice(0, 10),
  });
}

const grid = LatticeGrid.createGrid(document.getElementById('grid'), {
  rowKey: 'id',
  columns: [
    { field: 'id', title: 'ID', type: 'number', layout: { width: 90 } },
    { field: 'name', title: 'Name', layout: { width: 160 } },
    { field: 'region', title: 'Region', layout: { width: 160 } },
    { field: 'value', title: 'Value', type: 'number', layout: { width: 120 } },
    { field: 'date', title: 'Date', type: 'date', layout: { width: 130 } },
  ],
  rows,
});
window.__demoGrid = grid; // read by tools/verify.mjs

requestAnimationFrame(() => requestAnimationFrame(() => {
  const ms = Math.round(performance.now() - started);
  document.getElementById('stat').textContent =
    `${grid.rows.count().toLocaleString()} rows, painted in ${ms} ms`;
}));

document.getElementById('quick-filter').addEventListener('input', (e) => {
  grid.filters.quick(e.target.value);
});

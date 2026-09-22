# How to virtual-scroll a million rows without pagination

Generates a million rows in a loop and hands them straight to `createGrid`
with nothing but a `rowKey`. Scrolling, sorting a column and typing into the
quick filter all stay responsive, because only the rows in view are ever
mounted as DOM elements.

Live demo: https://toclocoinc.github.io/lattice-grid-howto-virtual-scroll-a-million-rows/

**Read the how-to:** https://www.latticegrid.dev/docs/how-to/virtual-scroll-a-million-rows/

## The full source

Two files: `index.html` loads the grid and declares the mount point, `demo.js` configures and creates it. Copy both as they are below and it runs.

### index.html

```html
<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>How to virtual-scroll a million rows without pagination</title>
    <meta
      name="description"
      content="Hand a JavaScript data grid one million rows and a rowKey, nothing else, and it stays responsive: scroll to the bottom, sort a column and type into a quick filter all keep pace. Built with Lattice Grid loaded by script tag, no install and no build."
    />
    <link rel="icon" href="data:," />
    <!--
      The grid's stylesheet, from jsDelivr. The address names the exact
      release, 1.68.2, and carries the hash of the file it expects, so the
      page can never quietly pick up a different build than the one it was
      checked against.
    -->
    <link
      rel="stylesheet"
      href="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.68.2/lattice-grid.min.css"
      integrity="sha384-mcpd7S8C5nz58bZDAXdYH6rzezEhfN7B4u2SlW426dSe20GnkxTu4TygyOILnCth"
      crossorigin="anonymous"
    />
    <style>
      body { margin: 0; font-family: system-ui, sans-serif; background: #f4f6f9; color: #131a24; }
      header { padding: 1.5rem 1.5rem 0.5rem; max-width: 960px; margin: 0 auto; }
      header p { color: #4a5568; }
      header a { color: #2d6bff; }
      main { max-width: 960px; margin: 0 auto; padding: 0 1.5rem 2.5rem; }
      #grid { height: 420px; }
      .toolbar { display: flex; align-items: center; gap: 1.25rem; flex-wrap: wrap; margin: 0 0 0.75rem; }
      .toolbar input[type="text"] { padding: 0.4rem 0.6rem; border: 1px solid #cbd5e1; border-radius: 6px; }
      #stat { font-size: 0.9rem; color: #4a5568; }
    </style>
  </head>
  <body>
    <header>
      <h1>How to virtual-scroll a million rows without pagination</h1>
      <p>
        Scroll, sort a column, or type into the filter below. Read the
        <a href="https://www.latticegrid.dev/docs/how-to/virtual-scroll-a-million-rows/">full how-to</a>
        on latticegrid.dev.
      </p>
    </header>
    <main>
      <div class="toolbar">
        <input type="text" id="quick-filter" placeholder="Filter, e.g. Europe" />
        <span id="stat"></span>
      </div>
      <div id="grid"></div>
    </main>

    <!--
      The library, as a classic script tag. No npm install, no bundler, no
      type="module": the file runs as it arrives and leaves the LatticeGrid
      global behind.
    -->
    <script
      src="https://cdn.jsdelivr.net/npm/@toclocoinc/lattice-grid@1.68.2/lattice-grid.min.js"
      integrity="sha384-vCzLyFYn0T0lz/vkdH4x0JpJZkOazZgI2LiGui7lm5uerdZd0Z46G9hr3Aq1FFPS"
      crossorigin="anonymous"
    ></script>
    <script src="./demo.js"></script>
  </body>
</html>
```

### demo.js

```js
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
```

No paging, no "load more" and no large-data mode to opt into. The grid
virtualises the scroll on its own: it mounts a small band of DOM rows around
whatever is on screen and swaps them as the viewport moves, so paint and
scroll cost stay flat whether the array holds a dozen rows or a million.

## Running it yourself

Open `index.html` in a browser, or serve the folder with any static file
server. The grid loads from jsDelivr by script tag, so there is no install
and no build step. It runs keyless on `localhost`; the licence key in
`demo.js` is bound to `toclocoinc.github.io` and has no effect anywhere else.

## Licence

MIT, see [LICENSE](./LICENSE). Lattice Grid itself is licensed separately
per domain: https://www.latticegrid.dev/pricing/

# How to virtual-scroll a million rows without pagination

Generates a million rows in a loop and hands them straight to `createGrid`
with nothing but a `rowKey`. Scrolling, sorting a column and typing into the
quick filter all stay responsive, because only the rows in view are ever
mounted as DOM elements.

Live demo: https://toclocoinc.github.io/lattice-grid-howto-virtual-scroll-a-million-rows/

**Read the how-to:** https://www.latticegrid.dev/docs/how-to/virtual-scroll-a-million-rows/

## The snippet

```js
const rows = [];
for (let i = 0; i < 1_000_000; i++) {
  rows.push({ id: i + 1, name: `Record ${i + 1}`, region: REGIONS[i % REGIONS.length], value, date });
}

const grid = LatticeGrid.createGrid(document.getElementById('grid'), {
  rowKey: 'id',
  columns: [/* id, name, region, value, date */],
  rows,
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

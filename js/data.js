// Loads bundled JSON data files. The single-file build inlines them as
// <script type="application/json" id="data-<name>"> elements; otherwise they are fetched
// relative to the page.
const cache = new Map();

export async function loadData(name) {
  if (cache.has(name)) return cache.get(name);
  const p = (async () => {
    const inline = typeof document !== 'undefined' ? document.getElementById(`data-${name}`) : null;
    if (inline) return JSON.parse(inline.textContent);
    const res = await fetch(new URL(`data/${name}.json`, document.baseURI));
    if (!res.ok) throw new Error(`Failed to load data/${name}.json (${res.status})`);
    return res.json();
  })();
  cache.set(name, p);
  return p;
}

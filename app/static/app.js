const API_BASE = "/api/v1";

/* ---------- Colores oficiales de las líneas del metro ---------- */
const LINE_COLORS = new Map();
function addLines(lines, bg, fg = "#fff") {
  for (const l of lines) LINE_COLORS.set(l, { bg, fg });
}
addLines(["1", "2", "3"], "#ee352e");
addLines(["4", "5", "6"], "#00933c");
addLines(["7"], "#b933ad");
addLines(["A", "C", "E"], "#0039a6");
addLines(["B", "D", "F", "M"], "#ff6319");
addLines(["G"], "#6cbe45");
addLines(["J", "Z"], "#996633");
addLines(["L"], "#a7a9ac");
addLines(["N", "Q", "R", "W"], "#fccc0a", "#101a27");
addLines(["S"], "#808183");
const DEFAULT_COLOR = { bg: "#5b6b7b", fg: "#fff" };
const PICKER_LINES = ["1", "2", "3", "4", "5", "6", "7", "A", "B", "C", "D", "E", "F", "G", "J", "L", "M", "N", "Q", "R", "S", "W", "Z"];
const colorOf = (line) => LINE_COLORS.get(line) ?? DEFAULT_COLOR;

/* ---------- Estilo del mapa por conjunto de datos ---------- */
const STYLES = {
  homicides: { radius: 6, color: "#ffffff", weight: 1.5, fillColor: "#c0392b", fillOpacity: 0.85 },
  neighborhoods: { color: "#0b5fd6", weight: 1.5, fillColor: "#0b5fd6", fillOpacity: 0.12 },
  streets: { color: "#e67e22", weight: 3, opacity: 0.85 },
  "census-blocks": { color: "#1f8a70", weight: 1, fillColor: "#1f8a70", fillOpacity: 0.2 },
};
const HIGHLIGHT = { color: "#0b5fd6", weight: 4, opacity: 1, fillOpacity: 0.35 };
const TITLE_PREFIX = { homicides: "Homicidio · ", "census-blocks": "Bloque " };
const SUBWAY = "subway-stations";

/* ---------- Utilidades de DOM (textContent: los datos nunca se insertan como HTML) ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function splitRoutes(routes) {
  return (routes ?? "").split(",").map((r) => r.trim()).filter(Boolean);
}

function lineBadge(line) {
  const { bg, fg } = colorOf(line);
  const b = el("span", "line-badge", line);
  b.style.background = bg;
  b.style.color = fg;
  return b;
}

function badges(routes) {
  const wrap = el("div", "badges");
  for (const r of splitRoutes(routes)) wrap.append(lineBadge(r));
  return wrap;
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

function formatValue(field, v) {
  if (v === null || v === undefined || v === "") return "—";
  if (field.type === "bool") return v ? "Sí" : "No";
  const unit = field.unit ? ` ${field.unit}` : "";
  if (field.type === "int" || field.type === "float") return `${Number(v).toLocaleString("es")}${unit}`;
  return `${v}${unit}`;
}

async function getJSON(url) {
  const res = await fetch(url);
  if (!res.ok) {
    let detail = `Error ${res.status}`;
    try {
      const body = await res.json();
      if (typeof body.detail === "string") detail = body.detail;
      else if (Array.isArray(body.detail)) detail = body.detail.map((d) => `${d.loc.slice(1).join(".")}: ${d.msg}`).join("; ");
    } catch { /* respuesta sin JSON */ }
    throw new Error(detail);
  }
  return res.json();
}

/* ---------- Referencias ---------- */
const form = document.getElementById("filters");
const tabsEl = document.getElementById("dataset-tabs");
const descEl = document.getElementById("dataset-description");
const dynamicEl = document.getElementById("dynamic-filters");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("results");
const countEl = document.getElementById("count");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const pageInfo = document.getElementById("page-info");
const perPageEl = document.getElementById("per-page");

/* ---------- Estado ---------- */
let datasets = [];
let current = null; // metadatos del conjunto de datos activo
let offset = 0;
let limit = 50;
let total = 0;
let requestId = 0;
let entries = []; // { card, layer, item } de la página actual
const facetsCache = new Map();

/* ---------- Mapa ---------- */
const map = L.map("map", { zoomControl: true, preferCanvas: true }).setView([40.73, -73.95], 11);
// Mapa base de OpenStreetMap (no requiere clave de API).
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const resultsLayer = L.layerGroup().addTo(map);

/* ---------- Figuras dibujadas para filtrar por zona ---------- */
const drawnItems = new L.FeatureGroup().addTo(map);
let polygonFilter = null; // geometría GeoJSON de un polígono o rectángulo dibujado

map.addControl(
  new L.Control.Draw({
    position: "topleft",
    draw: { polyline: false, marker: false, circlemarker: false, polygon: { allowIntersection: false }, rectangle: {}, circle: {} },
    edit: { featureGroup: drawnItems },
  }),
);

// Círculo -> lat/lon/radio; polígono y rectángulo -> geometría GeoJSON.
function applyShape(layer) {
  polygonFilter = null;
  if (layer instanceof L.Circle) {
    const c = layer.getLatLng();
    form.elements.lat.value = c.lat.toFixed(6);
    form.elements.lon.value = c.lng.toFixed(6);
    form.elements.radius_m.value = Math.min(Math.round(layer.getRadius()), 50000);
    document.querySelector(".nearby").open = true;
  } else {
    polygonFilter = layer.toGeoJSON().geometry;
    clearNearbyFields();
  }
}

function clearNearbyFields() {
  form.elements.lat.value = form.elements.lon.value = form.elements.radius_m.value = "";
}

function clearShape() {
  drawnItems.clearLayers();
  polygonFilter = null;
}

map.on(L.Draw.Event.CREATED, (e) => {
  clearShape();
  drawnItems.addLayer(e.layer);
  applyShape(e.layer);
  runFreshSearch();
});
map.on(L.Draw.Event.EDITED, (e) => {
  e.layers.eachLayer(applyShape);
  runFreshSearch();
});
map.on(L.Draw.Event.DELETED, () => {
  if (drawnItems.getLayers().length === 0) {
    polygonFilter = null;
    clearNearbyFields();
    runFreshSearch();
  }
});

/* ---------- Pestañas ---------- */
function buildTabs() {
  tabsEl.replaceChildren();
  for (const ds of datasets) {
    const tab = el("button", "tab", ds.label);
    tab.type = "button";
    tab.setAttribute("role", "tab");
    tab.dataset.slug = ds.slug;
    tab.addEventListener("click", () => selectDataset(ds.slug));
    tabsEl.append(tab);
  }
}

function selectDataset(slug) {
  const ds = datasets.find((d) => d.slug === slug) ?? datasets[0];
  current = ds;
  offset = 0;
  if (location.hash.slice(1) !== ds.slug) history.replaceState(null, "", `#${ds.slug}`);
  for (const tab of tabsEl.children) tab.setAttribute("aria-selected", String(tab.dataset.slug === ds.slug));
  descEl.textContent = ds.description;
  renderFilters(ds);
  renderPerPage(ds);
  loadFacets(ds);
  search();
}

function renderPerPage(ds) {
  const previous = Number(perPageEl.value) || 50;
  const sizes = [25, 50, 100, 200, 500, 1000].filter((n) => n <= ds.max_limit);
  perPageEl.replaceChildren(...sizes.map((n) => new Option(String(n), String(n))));
  perPageEl.value = String(sizes.includes(previous) ? previous : sizes.includes(50) ? 50 : sizes[sizes.length - 1]);
}

/* ---------- Filtros dinámicos (a partir del catálogo de la API) ---------- */
function field(label, control, wide = false) {
  const wrap = el("label", `field${wide ? " wide" : ""}`);
  wrap.append(el("span", null, label), control);
  return wrap;
}

function lineFilter(f) {
  const wrap = el("div", "field wide");
  wrap.append(el("span", null, f.label));
  const hidden = el("input");
  hidden.type = "hidden";
  hidden.name = f.param;
  const picker = el("div", "line-picker");
  picker.setAttribute("role", "group");
  picker.setAttribute("aria-label", f.label);
  for (const line of PICKER_LINES) {
    const { bg, fg } = colorOf(line);
    const chip = el("button", "line-chip", line);
    chip.type = "button";
    chip.dataset.line = line;
    chip.style.background = bg;
    chip.style.color = fg;
    chip.title = `Línea ${line}`;
    chip.setAttribute("aria-pressed", "false");
    chip.addEventListener("click", () => {
      hidden.value = hidden.value === line ? "" : line; // clic de nuevo = quitar filtro
      for (const c of picker.children) c.setAttribute("aria-pressed", String(c.dataset.line === hidden.value));
      runFreshSearch();
    });
    picker.append(chip);
  }
  wrap.append(hidden, picker);
  return wrap;
}

function toggleFilter(f) {
  const set = el("fieldset", "field wide segmented");
  set.append(el("legend", null, f.label));
  const options = [["", "Todos"], ["true", f.toggle_labels?.[0] ?? "Sí"], ["false", f.toggle_labels?.[1] ?? "No"]];
  for (const [value, text] of options) {
    const label = el("label");
    const input = el("input");
    input.type = "radio";
    input.name = f.param;
    input.value = value;
    input.checked = value === "";
    label.append(input, el("span", null, text));
    set.append(label);
  }
  return set;
}

function filterControl(f) {
  if (f.ui === "lines") return lineFilter(f);
  if (f.kind === "bool") return toggleFilter(f);

  if (f.kind === "choice" || f.kind === "facet") {
    const select = el("select");
    select.name = f.param;
    select.append(new Option("Todos", ""));
    for (const c of f.choices) select.append(new Option(c, c));
    return field(f.label, select);
  }

  const input = el("input");
  input.name = f.param;
  if (f.kind === "text") {
    input.type = "search";
    input.placeholder = "Escribe para buscar…";
    return field(f.label, input, true);
  }
  if (f.kind === "date") {
    input.type = "date";
    return field(f.label, input);
  }
  input.type = "number"; // int | float
  if (f.min_value != null) input.min = String(f.min_value);
  if (f.kind === "float") input.step = "any";
  return field(f.label, input);
}

function renderFilters(ds) {
  dynamicEl.replaceChildren();
  for (const f of ds.filters.filter((x) => !x.advanced)) dynamicEl.append(filterControl(f));

  const advanced = ds.filters.filter((x) => x.advanced);
  if (advanced.length) {
    const details = el("details", "advanced");
    details.append(el("summary", null, "Más filtros"));
    const grid = el("div", "advanced-grid");
    for (const f of advanced) grid.append(filterControl(f));
    details.append(grid);
    dynamicEl.append(details);
  }
  fillFacets(ds);
}

async function loadFacets(ds) {
  if (!ds.filters.some((f) => f.kind === "facet") || facetsCache.has(ds.slug)) return;
  try {
    facetsCache.set(ds.slug, await getJSON(ds.facets_endpoint));
    if (current === ds) fillFacets(ds);
  } catch (err) {
    console.warn("No se pudieron cargar los valores de los filtros", err);
  }
}

function fillFacets(ds) {
  const facets = facetsCache.get(ds.slug);
  if (!facets) return;
  for (const [param, values] of Object.entries(facets)) {
    const select = dynamicEl.querySelector(`select[name="${CSS.escape(param)}"]`);
    if (!select || select.options.length > 1) continue;
    for (const v of values) select.append(new Option(v, v));
  }
}

/* ---------- Consulta a la API ---------- */
function buildQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    const v = String(value).trim();
    if (v !== "") params.set(key, v);
  }
  if (polygonFilter) params.set("polygon", JSON.stringify(polygonFilter));
  limit = Number(params.get("limit") || 50);
  params.set("offset", String(offset));
  return params;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function runFreshSearch() {
  offset = 0;
  search();
}

async function search() {
  if (!current) return;
  const ds = current;
  const id = ++requestId;
  const params = buildQuery();
  listEl.classList.add("loading");
  setStatus("Cargando…");
  try {
    const data = await getJSON(`${ds.endpoint}?${params}`);
    if (id === requestId) render(ds, data); // ignora respuestas obsoletas
  } catch (err) {
    if (id === requestId) setStatus(err.message || "No se pudo conectar con la API", true);
  } finally {
    if (id === requestId) listEl.classList.remove("loading");
  }
}

/* ---------- Presentación de resultados ---------- */
function setActive(entry) {
  for (const e of entries) {
    const on = e === entry;
    e.card.classList.toggle("active", on);
    if (e.layer.setStyle && STYLES[current.slug]) e.layer.setStyle(on ? { ...STYLES[current.slug], ...HIGHLIGHT } : STYLES[current.slug]);
  }
}

function pinIcon(props) {
  const first = splitRoutes(props.routes)[0];
  const size = props.express ? 20 : 16;
  return L.divIcon({
    className: "",
    html: `<div class="station-pin${props.express ? " express" : ""}" style="background:${colorOf(first).bg}"></div>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
}

function titleOf(ds, props) {
  const v = props[ds.title_field];
  return v === null || v === undefined || v === "" ? "(sin nombre)" : `${TITLE_PREFIX[ds.slug] ?? ""}${v}`;
}

function factsList(ds, props, keys) {
  const dl = el("dl", "facts");
  const byKey = new Map(ds.fields.map((f) => [f.key, f]));
  for (const key of keys) {
    const f = byKey.get(key);
    if (!f) continue;
    const row = el("div");
    row.append(el("dt", null, `${f.label}:`), el("dd", null, formatValue(f, props[key])));
    dl.append(row);
  }
  return dl;
}

function popupContent(ds, item) {
  const p = item.properties;
  const box = el("div");
  box.append(el("div", "popup-title", titleOf(ds, p)));
  if (ds.slug === SUBWAY) {
    box.append(el("div", "popup-meta", p.borough ?? ""), badges(p.routes));
  } else {
    const facts = factsList(ds, p, ds.card_fields);
    facts.classList.add("popup-facts");
    box.append(facts);
  }
  return box;
}

function buildCard(ds, item) {
  const p = item.properties;
  const card = el("li", "station-card");
  card.tabIndex = 0;

  const top = el("div", "station-top");
  const info = el("div");
  info.append(el("div", "station-name", titleOf(ds, p)));
  if (ds.slug === SUBWAY) info.append(el("div", "station-meta", p.borough ?? ""));
  top.append(info);

  const tags = el("div", "tags");
  if (item.distance_m != null) tags.append(el("span", "tag", formatDistance(item.distance_m)));
  if (ds.slug === SUBWAY && p.express) tags.append(el("span", "tag tag-express", "Express"));
  top.append(tags);
  card.append(top);

  card.append(ds.slug === SUBWAY ? badges(p.routes) : factsList(ds, p, ds.card_fields));
  return card;
}

function buildLayer(ds, item) {
  const style = STYLES[ds.slug];
  return L.geoJSON(item.geometry, {
    style: () => style,
    pointToLayer: (_feature, latlng) =>
      ds.slug === SUBWAY ? L.marker(latlng, { icon: pinIcon(item.properties), title: item.properties.name ?? "" }) : L.circleMarker(latlng, style),
  });
}

function render(ds, data) {
  total = data.total;
  listEl.replaceChildren();
  resultsLayer.clearLayers();
  entries = [];
  const bounds = L.latLngBounds([]);

  for (const item of data.items) {
    const card = buildCard(ds, item);
    listEl.append(card);
    if (!item.geometry) continue; // registro sin geometría: solo aparece en la lista

    const layer = buildLayer(ds, item);
    layer.bindPopup(() => popupContent(ds, item));
    layer.addTo(resultsLayer);
    bounds.extend(layer.getBounds());

    const entry = { card, layer, item };
    entries.push(entry);

    const select = () => {
      setActive(entry);
      const b = layer.getBounds();
      if (ds.geometry_type === "point") map.flyTo(b.getCenter(), Math.max(map.getZoom(), 15));
      else map.flyToBounds(b, { maxZoom: 16, padding: [40, 40] });
      layer.openPopup();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    layer.on("click", () => {
      setActive(entry);
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }

  if (data.items.length === 0) {
    listEl.append(el("li", "empty", "No se encontraron registros con estos filtros."));
  } else if (bounds.isValid()) {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  const from = total === 0 ? 0 : data.offset + 1;
  const to = data.offset + data.items.length;
  countEl.textContent = `${total.toLocaleString("es")} ${total === 1 ? "registro" : "registros"}`;
  pageInfo.textContent = `${from.toLocaleString("es")}–${to.toLocaleString("es")} de ${total.toLocaleString("es")}`;
  setStatus("");
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = offset + limit >= total;
}

/* ---------- Eventos ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  runFreshSearch();
});

// Búsqueda automática: texto y números con retardo; listas, opciones y fechas al instante.
let typingTimer;
dynamicEl.addEventListener("input", (e) => {
  if (!["search", "number"].includes(e.target.type)) return;
  clearTimeout(typingTimer);
  typingTimer = setTimeout(runFreshSearch, 350);
});
dynamicEl.addEventListener("change", (e) => {
  if (["search", "number"].includes(e.target.type)) return;
  runFreshSearch();
});
perPageEl.addEventListener("change", runFreshSearch);

document.getElementById("clear-all").addEventListener("click", () => {
  renderFilters(current);
  clearNearbyFields();
  clearShape();
  runFreshSearch();
});

prevBtn.addEventListener("click", () => {
  offset = Math.max(0, offset - limit);
  search();
});
nextBtn.addEventListener("click", () => {
  offset += limit;
  search();
});

document.getElementById("use-location").addEventListener("click", () => {
  if (!navigator.geolocation) return setStatus("Tu navegador no soporta geolocalización", true);
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      form.elements.lat.value = pos.coords.latitude.toFixed(6);
      form.elements.lon.value = pos.coords.longitude.toFixed(6);
      clearShape(); // la ubicación reemplaza cualquier figura dibujada
      if (!form.elements.radius_m.value) form.elements.radius_m.value = 1000;
      setStatus("Ubicación cargada. Pulsa «Buscar».");
    },
    () => setStatus("No se pudo obtener tu ubicación", true),
  );
});

window.addEventListener("hashchange", () => {
  const slug = location.hash.slice(1);
  if (slug && slug !== current?.slug && datasets.some((d) => d.slug === slug)) selectDataset(slug);
});

/* ---------- Inicio ---------- */
(async function init() {
  try {
    datasets = await getJSON(`${API_BASE}/datasets`);
    buildTabs();
    selectDataset(location.hash.slice(1));
  } catch (err) {
    setStatus(err.message || "No se pudo conectar con la API", true);
  }
})();

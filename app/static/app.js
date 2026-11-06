const API_URL = "/api/v1/subway-stations";

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

/* ---------- Utilidades de DOM (textContent: los datos nunca se insertan como HTML) ---------- */
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
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

function splitRoutes(routes) {
  return (routes ?? "").split(",").map((r) => r.trim()).filter(Boolean);
}

function formatDistance(m) {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}

/* ---------- Referencias ---------- */
const form = document.getElementById("filters");
const statusEl = document.getElementById("status");
const listEl = document.getElementById("results");
const countEl = document.getElementById("count");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const pageInfo = document.getElementById("page-info");
const picker = document.getElementById("line-picker");

/* ---------- Mapa ---------- */
const map = L.map("map", { zoomControl: true }).setView([40.73, -73.95], 11);
// Mapa base de OpenStreetMap (no requiere clave de API).
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
}).addTo(map);
const markersLayer = L.layerGroup().addTo(map);

let offset = 0;
let limit = 50;
let total = 0;
let requestId = 0;
let entries = []; // { card, marker } de la página actual

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
    form.lat.value = c.lat.toFixed(6);
    form.lon.value = c.lng.toFixed(6);
    form.radius_m.value = Math.min(Math.round(layer.getRadius()), 50000);
    document.querySelector(".nearby").open = true;
  } else {
    polygonFilter = layer.toGeoJSON().geometry;
    clearNearbyFields();
  }
}

function clearNearbyFields() {
  form.lat.value = form.lon.value = form.radius_m.value = "";
}

function clearShape() {
  drawnItems.clearLayers();
  polygonFilter = null;
}

map.on(L.Draw.Event.CREATED, (e) => {
  clearShape();
  drawnItems.addLayer(e.layer);
  applyShape(e.layer);
  offset = 0;
  search();
});
map.on(L.Draw.Event.EDITED, (e) => {
  e.layers.eachLayer(applyShape);
  offset = 0;
  search();
});
map.on(L.Draw.Event.DELETED, () => {
  if (drawnItems.getLayers().length === 0) {
    polygonFilter = null;
    clearNearbyFields();
    offset = 0;
    search();
  }
});

/* ---------- Selector de líneas ---------- */
function syncPicker() {
  for (const chip of picker.children) {
    chip.setAttribute("aria-pressed", String(chip.dataset.line === form.route.value));
  }
}

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
    form.route.value = form.route.value === line ? "" : line; // clic de nuevo = quitar filtro
    syncPicker();
    offset = 0;
    search();
  });
  picker.append(chip);
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

function setActive(entry) {
  for (const e of entries) e.card.classList.toggle("active", e === entry);
}

function pinIcon(station) {
  const first = splitRoutes(station.routes)[0];
  return L.divIcon({
    className: "",
    html: `<div class="station-pin${station.express ? " express" : ""}" style="background:${colorOf(first).bg}"></div>`,
    iconSize: station.express ? [20, 20] : [16, 16],
    iconAnchor: station.express ? [10, 10] : [8, 8],
  });
}

function popupContent(s) {
  const box = el("div");
  box.append(el("div", "popup-title", s.name ?? "(sin nombre)"));
  box.append(el("div", "popup-meta", s.borough ?? ""));
  box.append(badges(s.routes));
  return box;
}

function stationCard(s, distance) {
  const card = el("li", "station-card");
  card.tabIndex = 0;

  const top = el("div", "station-top");
  const info = el("div");
  info.append(el("div", "station-name", s.name ?? "(sin nombre)"), el("div", "station-meta", s.borough ?? ""));
  top.append(info);

  const tags = el("div", "tags");
  if (distance != null) tags.append(el("span", "tag", formatDistance(distance)));
  if (s.express) tags.append(el("span", "tag tag-express", "Express"));
  top.append(tags);

  const bottom = el("div", "station-bottom");
  bottom.append(badges(s.routes));

  card.append(top, bottom);
  return card;
}

function render(data) {
  total = data.total;
  listEl.replaceChildren();
  markersLayer.clearLayers();
  entries = [];
  const bounds = [];

  for (const s of data.items) {
    const [lon, lat] = s.geometry.coordinates;
    const card = stationCard(s, s.distance_m);
    const marker = L.marker([lat, lon], { icon: pinIcon(s), title: s.name ?? "" });
    marker.bindPopup(popupContent(s));
    marker.addTo(markersLayer);
    bounds.push([lat, lon]);

    const entry = { card, marker };
    entries.push(entry);

    const select = () => {
      setActive(entry);
      map.flyTo([lat, lon], Math.max(map.getZoom(), 15));
      marker.openPopup();
    };
    card.addEventListener("click", select);
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        select();
      }
    });
    marker.on("click", () => {
      setActive(entry);
      card.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
    listEl.append(card);
  }

  if (data.items.length === 0) {
    listEl.append(el("li", "empty", "No se encontraron estaciones con estos filtros."));
  } else {
    map.fitBounds(bounds, { padding: [40, 40], maxZoom: 15 });
  }

  const from = total === 0 ? 0 : data.offset + 1;
  const to = data.offset + data.items.length;
  countEl.textContent = `${total} ${total === 1 ? "estación" : "estaciones"}`;
  pageInfo.textContent = `${from}–${to} de ${total}`;
  setStatus("");
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = offset + limit >= total;
}

async function search() {
  const id = ++requestId;
  const params = buildQuery();
  listEl.classList.add("loading");
  setStatus("Cargando…");
  try {
    const res = await fetch(`${API_URL}?${params}`);
    if (!res.ok) {
      let detail = `Error ${res.status}`;
      try {
        const body = await res.json();
        if (typeof body.detail === "string") detail = body.detail;
        else if (Array.isArray(body.detail)) detail = body.detail.map((d) => `${d.loc.slice(1).join(".")}: ${d.msg}`).join("; ");
      } catch { /* respuesta sin JSON */ }
      throw new Error(detail);
    }
    const data = await res.json();
    if (id === requestId) render(data); // ignora respuestas obsoletas
  } catch (err) {
    if (id === requestId) setStatus(err.message || "No se pudo conectar con la API", true);
  } finally {
    if (id === requestId) listEl.classList.remove("loading");
  }
}

/* ---------- Eventos ---------- */
form.addEventListener("submit", (e) => {
  e.preventDefault();
  offset = 0;
  search();
});

// Búsqueda automática al cambiar distrito, express o resultados por página.
for (const name of ["borough", "limit"]) {
  form.elements[name].addEventListener("change", () => {
    offset = 0;
    search();
  });
}
for (const radio of form.querySelectorAll('input[name="express"]')) {
  radio.addEventListener("change", () => {
    offset = 0;
    search();
  });
}

// Búsqueda por nombre con retardo para no consultar en cada tecla.
let nameTimer;
form.elements.name.addEventListener("input", () => {
  clearTimeout(nameTimer);
  nameTimer = setTimeout(() => {
    offset = 0;
    search();
  }, 350);
});

document.getElementById("clear-all").addEventListener("click", () => {
  form.reset();
  form.route.value = "";
  syncPicker();
  clearShape();
  offset = 0;
  search();
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
      form.lat.value = pos.coords.latitude.toFixed(6);
      form.lon.value = pos.coords.longitude.toFixed(6);
      clearShape(); // la ubicación reemplaza cualquier figura dibujada
      if (!form.radius_m.value) form.radius_m.value = 1000;
      setStatus("Ubicación cargada. Pulsa «Buscar estaciones».");
    },
    () => setStatus("No se pudo obtener tu ubicación", true),
  );
});

search();

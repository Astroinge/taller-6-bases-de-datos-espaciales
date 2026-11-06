const API_URL = "/api/v1/subway-stations";

const form = document.getElementById("filters");
const statusEl = document.getElementById("status");
const tbody = document.getElementById("results");
const prevBtn = document.getElementById("prev");
const nextBtn = document.getElementById("next");
const pageInfo = document.getElementById("page-info");

const map = L.map("map").setView([40.73, -73.95], 11);
L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap contributors",
}).addTo(map);
const markersLayer = L.layerGroup().addTo(map);

let offset = 0;
let limit = 50;
let total = 0;
let requestId = 0;

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.classList.toggle("error", isError);
}

function buildQuery() {
  const params = new URLSearchParams();
  for (const [key, value] of new FormData(form)) {
    const v = String(value).trim();
    if (v !== "") params.set(key, v);
  }
  limit = Number(params.get("limit") || 50);
  params.set("offset", String(offset));
  return params;
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text ?? "";
  return td;
}

function render(data) {
  total = data.total;
  tbody.replaceChildren();
  markersLayer.clearLayers();
  const bounds = [];

  for (const s of data.items) {
    const [lon, lat] = s.geometry.coordinates;
    const marker = L.marker([lat, lon]);
    const popup = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = s.name ?? "(sin nombre)";
    popup.append(title, document.createElement("br"), `${s.borough ?? ""} · ${s.routes ?? ""}`);
    marker.bindPopup(popup).addTo(markersLayer);
    bounds.push([lat, lon]);

    const tr = document.createElement("tr");
    tr.append(
      cell(s.name),
      cell(s.borough),
      cell(s.routes),
      cell(s.express ? "Sí" : "No"),
      cell(s.distance_m != null ? Math.round(s.distance_m) : ""),
    );
    tr.addEventListener("click", () => {
      map.flyTo([lat, lon], 15);
      marker.openPopup();
    });
    tbody.append(tr);
  }

  if (bounds.length) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 15 });

  const from = total === 0 ? 0 : data.offset + 1;
  const to = data.offset + data.items.length;
  setStatus(`${total} estación(es) encontradas`);
  pageInfo.textContent = `${from}–${to} de ${total}`;
  prevBtn.disabled = offset === 0;
  nextBtn.disabled = offset + limit >= total;
}

async function search() {
  const id = ++requestId;
  const params = buildQuery();
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
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  offset = 0;
  search();
});

document.getElementById("reset").addEventListener("click", () => {
  form.reset();
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
      if (!form.radius_m.value) form.radius_m.value = 1000;
      setStatus("Ubicación cargada. Pulsa Buscar.");
    },
    () => setStatus("No se pudo obtener tu ubicación", true),
  );
});

search();

(() => {
  "use strict";

  const DB_NAME = "ves-field";
  const DB_VERSION = 1;
  const EXPORT_FORMAT = "ves-field-project";
  const app = document.getElementById("app");
  const fileInput = document.getElementById("import-file");
  const saveStatus = document.getElementById("save-status");
  const installButton = document.getElementById("install-button");
  let db;
  let projects = [];
  let activeProjectId = null;
  let activeSiteId = null;
  let activeStationId = null;
  const collapsedSiteIds = new Set();
  let activeTarget = "A";
  let currentPosition = null;
  let watchId = null;
  let mapMode = "north";
  let compassHeading = null;
  let compassListening = false;
  let lastOrientationAt = 0;
  let deferredInstallPrompt = null;

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const now = () => new Date().toISOString();
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[char]);
  const selectedProject = () => projects.find((project) => project.id === activeProjectId);
  const selectedSite = () => selectedProject()?.sites.find((site) => site.id === activeSiteId);
  const selectedStation = () => selectedSite()?.stations.find((station) => station.id === activeStationId);

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open local storage."));
    });
  }

  function storeProjects() {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction("projects", "readwrite");
      const store = transaction.objectStore("projects");
      store.clear();
      projects.forEach((project) => store.put(project));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error || new Error("Could not save project data."));
      transaction.onabort = () => reject(transaction.error || new Error("Saving project data was interrupted."));
    });
  }

  function readProjects() {
    return new Promise((resolve, reject) => {
      const request = db.transaction("projects").objectStore("projects").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not read saved projects."));
    });
  }

  async function persist() {
    try {
      saveStatus.textContent = "Saving…";
      await storeProjects();
      saveStatus.textContent = "Saved locally";
    } catch (error) {
      saveStatus.textContent = "Save failed";
      showToast(`Save failed: ${error.message}`, true);
      throw error;
    }
  }

  function stopLocationWatch() {
    if (watchId !== null && navigator.geolocation) navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  function stopCompassWatch() {
    if (!compassListening) return;
    window.removeEventListener("deviceorientation", updateCompassHeading);
    window.removeEventListener("deviceorientationabsolute", updateCompassHeading);
    compassListening = false;
  }

  async function enableCompass() {
    const orientationEvent = window.DeviceOrientationEvent;
    if (orientationEvent && typeof orientationEvent.requestPermission === "function") {
      const permission = await orientationEvent.requestPermission();
      if (permission !== "granted") throw new Error("Compass permission was denied.");
    }
    if (!compassListening) {
      window.addEventListener("deviceorientation", updateCompassHeading);
      window.addEventListener("deviceorientationabsolute", updateCompassHeading);
      compassListening = true;
    }
  }

  function updateCompassHeading(event) {
    const timestamp = Date.now();
    if (timestamp - lastOrientationAt < 80) return;
    let heading;
    if (Number.isFinite(event.webkitCompassHeading)) {
      heading = event.webkitCompassHeading;
    } else if (event.absolute && Number.isFinite(event.alpha)) {
      heading = 360 - event.alpha + (screen.orientation?.angle || 0);
    } else {
      return;
    }
    lastOrientationAt = timestamp;
    compassHeading = normalizeAzimuth(heading);
    updateFieldMap();
  }

  function ensureLocationWatch() {
    if (watchId !== null || !selectedStation()) return;
    if (!navigator.geolocation) {
      updateLiveReadout("Location is not supported by this browser.");
      return;
    }
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        currentPosition = {
          lat: position.coords.latitude,
          lon: position.coords.longitude,
          accuracy: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString()
        };
        updateLiveReadout();
      },
      (error) => {
        const messages = {
          1: "Location permission was denied.",
          2: "Your current location is unavailable.",
          3: "Location request timed out."
        };
        updateLiveReadout(messages[error.code] || "Could not read your location.");
      },
      { enableHighAccuracy: true, maximumAge: 3000, timeout: 20000 }
    );
  }

  function showToast(message, isError = false) {
    const toast = document.createElement("div");
    toast.className = `toast${isError ? " error" : ""}`;
    toast.textContent = message;
    document.getElementById("toast-region").append(toast);
    window.setTimeout(() => toast.remove(), 4200);
  }

  function formatCoord(value) {
    return Number.isFinite(value) ? value.toFixed(6) : "—";
  }

  function normalizeAzimuth(value) {
    const number = Number(value);
    return Number.isFinite(number) ? ((number % 360) + 360) % 360 : 0;
  }

  function distanceAndBearing(from, to) {
    if (!from || !to) return null;
    const radians = (degrees) => degrees * Math.PI / 180;
    const lat1 = radians(from.lat);
    const lat2 = radians(to.lat);
    const deltaLat = radians(to.lat - from.lat);
    const deltaLon = radians(to.lon - from.lon);
    const a = Math.sin(deltaLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLon / 2) ** 2;
    const distance = 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const y = Math.sin(deltaLon) * Math.cos(lat2);
    const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLon);
    const bearing = (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
    return { distance, bearing };
  }

  function render() {
    stopLocationWatch();
    const project = selectedProject();
    if (!project) {
      stopCompassWatch();
      activeProjectId = null;
      activeSiteId = null;
      activeStationId = null;
      renderProjects();
      return;
    }
    const station = selectedStation();
    if (station) {
      renderSurvey(project, selectedSite(), station);
      ensureLocationWatch();
    } else {
      stopCompassWatch();
      activeStationId = null;
      renderProject(project);
    }
  }

  function renderProjects() {
    const cards = projects.map((project) => {
      const siteCount = project.sites.length;
      const stationCount = project.sites.reduce((count, site) => count + site.stations.length, 0);
      return `<article class="project-card" data-action="open-project" data-id="${escapeHtml(project.id)}" tabindex="0" role="button" aria-label="Open project ${escapeHtml(project.name)}">
        <div class="project-card-top"><span>FIELD PROJECT</span><span>${siteCount} SITE${siteCount === 1 ? "" : "S"}</span></div>
        <h2>${escapeHtml(project.name)}</h2><p>${stationCount} VES station${stationCount === 1 ? "" : "s"}</p>
        <div class="project-card-bottom"><span>Updated ${new Date(project.updatedAt).toLocaleDateString()}</span><span class="project-arrow">↗</span></div>
      </article>`;
    }).join("");
    app.innerHTML = `<section class="page-heading">
      <div><div class="eyebrow">FIELDWORK / PROJECTS</div><h1 class="page-title">Your field book.</h1>
        <p class="page-intro">Organize VES stations, capture GPS positions, and keep working when you’re off the grid.</p></div>
      <button class="button button-primary" data-action="new-project">＋ New project</button>
    </section>
    ${projects.length ? `<section class="project-grid">${cards}</section>
      <div class="toolbar-row"><button class="button button-outline button-small" data-action="import-project">Import project file</button></div>`
      : `<section class="empty-state"><div class="empty-symbol" aria-hidden="true">⌖</div><h2>Start a field project</h2>
        <p>Create a project to organize survey sites and VES stations. Your work is stored on this device and available offline.</p>
        <button class="button button-primary" data-action="new-project">Create your first project</button>
        <div class="toolbar-row" style="justify-content:center"><button class="button button-outline button-small" data-action="import-project">Import a project file</button></div>
      </section>`}`;
  }

  function backButton(label, action) {
    return `<div class="screen-back"><button class="back-button" data-action="${action}"><span aria-hidden="true">←</span> ${escapeHtml(label)}</button></div>`;
  }

  function renderProject(project) {
    const siteCards = project.sites.map((site, index) => {
      const collapsed = collapsedSiteIds.has(site.id);
      return `<article class="site-card">
      <div class="site-header">
        <button class="site-heading site-toggle" type="button" data-action="toggle-site" data-id="${escapeHtml(site.id)}" aria-expanded="${!collapsed}">
          <span class="site-index">${String(index + 1).padStart(2, "0")}</span>
          <span><span class="site-heading-title">${escapeHtml(site.name)}</span><span class="site-heading-count">${site.stations.length} station${site.stations.length === 1 ? "" : "s"}</span></span>
          <span class="site-chevron" aria-hidden="true">${collapsed ? "＋" : "−"}</span>
        </button>
        <div class="site-actions">
          <button class="icon-button" data-action="rename-site" data-id="${escapeHtml(site.id)}" aria-label="Rename ${escapeHtml(site.name)}" title="Rename site">✎</button>
          <button class="button button-outline button-small" data-action="new-station" data-id="${escapeHtml(site.id)}">＋ VES station</button>
        </div>
      </div>
      ${collapsed ? "" : site.stations.length ? `<div class="station-list">${site.stations.map((station) => {
        const pointCount = station.points.length;
        const midpoint = station.midpoint ? `${formatCoord(station.midpoint.lat)}, ${formatCoord(station.midpoint.lon)}` : "Midpoint not set";
        return `<div class="station-row" data-action="open-station" data-site-id="${escapeHtml(site.id)}" data-id="${escapeHtml(station.id)}" tabindex="0" role="button">
          <div><div class="station-name">${escapeHtml(station.name)}</div><div class="station-sub">${midpoint} · ${pointCount} point${pointCount === 1 ? "" : "s"} recorded</div></div><span class="station-arrow">→</span>
        </div>`;
      }).join("")}</div>` : `<div class="inline-empty">No stations yet. Add the first VES station for this site.</div>`}
    </article>`;
    }).join("");

    app.innerHTML = `${backButton("All projects", "back")}
      <section class="page-heading">
        <div><div class="eyebrow">FIELD PROJECT</div><h1 class="page-title">${escapeHtml(project.name)}</h1>
          <div class="project-meta">PROJECT ID · ${escapeHtml(project.id)}</div></div>
        <div class="toolbar-row">
          <button class="button button-outline button-small" data-action="rename-project">Rename</button>
          <button class="button button-outline button-small" data-action="export-csv">Export CSV</button>
          <button class="button button-primary button-small" data-action="share-project">Share / sync</button>
          <button class="button button-danger button-small" data-action="delete-project">Delete project</button>
        </div>
      </section>
      <section><div class="section-head"><h2>Survey sites <span class="project-meta">(${project.sites.length})</span></h2>
        <button class="button button-outline button-small" data-action="new-site">＋ Add site</button></div>
        <div class="site-stack">${siteCards || `<div class="empty-state"><div class="empty-symbol">⌖</div><h2>No sites in this project</h2><p>Add a site to start organizing your VES stations.</p><button class="button button-primary" data-action="new-site">Create Site 1</button></div>`}</div>
      </section>
      <aside class="sync-note"><strong>Offline by design.</strong> Project data is saved on this device. Share a project file with another device and import it there to merge records by project ID. If your phone offers Bluetooth in its share sheet, you can use it for the transfer. Web apps cannot act as BLE GATT servers for direct phone-to-phone sync.</aside>`;
  }

  function renderSurvey(project, site, station) {
    const targetValue = station.targets[activeTarget];
    const midpoint = station.midpoint;
    const points = [...station.points].sort((a, b) => b.capturedAt.localeCompare(a.capturedAt));
    const midpointText = midpoint
      ? `${formatCoord(midpoint.lat)}, ${formatCoord(midpoint.lon)}`
      : "Midpoint not set";
    const pointMarkup = points.length ? points.map((point) => `<div class="point-item">
      <div class="point-item-top"><strong>POINT ${escapeHtml(point.target)}</strong><span>${new Date(point.capturedAt).toLocaleString()}</span><button class="point-delete" data-action="delete-point" data-id="${escapeHtml(point.id)}" aria-label="Delete point ${escapeHtml(point.target)} recorded ${new Date(point.capturedAt).toLocaleString()}" title="Delete point">×</button></div>
      <div class="point-item-detail">${formatCoord(point.lat)}, ${formatCoord(point.lon)} · ${point.distanceMeters == null ? "—" : `${point.distanceMeters.toFixed(1)} m`} · ${point.bearingDegrees == null ? "—" : `${point.bearingDegrees.toFixed(1)}°`}</div>
    </div>`).join("") : `<div class="inline-empty">No survey points captured yet.</div>`;
    app.innerHTML = `${backButton(`Back to ${project.name}`, "back")}
      <section class="survey-header">
        <div><div class="eyebrow">${escapeHtml(site.name)} / SURVEY STATION</div><h1 class="survey-title">${escapeHtml(station.name)}</h1>
          <div class="survey-target">Target azimuth · A <strong>${normalizeAzimuth(station.targets.A).toFixed(1)}°</strong> &nbsp; B <strong>${normalizeAzimuth(station.targets.B).toFixed(1)}°</strong></div></div>
        <div class="survey-actions"><button class="button button-outline button-small" data-action="rename-station">✎ Rename station</button>
          <button class="button button-danger button-small" data-action="delete-station">Delete station</button></div>
      </section>
      <section class="survey-layout">
        <div class="readout-panel">
          <div class="readout-top"><span>LIVE GPS READOUT</span><span class="gps-state waiting" id="gps-state"><span class="status-dot"></span><span id="gps-state-label">Finding GPS…</span></span></div>
          <div class="readout-grid">
            <div class="readout-cell"><span class="readout-label">Current position</span><span class="readout-value" id="current-position">—</span></div>
            <div class="readout-cell"><span class="readout-label">Distance from midpoint</span><span class="readout-value large" id="current-distance">—</span></div>
            <div class="readout-cell"><span class="readout-label">Current azimuth</span><span class="readout-value" id="current-azimuth">—</span></div>
            <div class="readout-cell"><span class="readout-label">Target azimuth · <span id="target-label">${activeTarget}</span></span><span class="readout-value large" id="target-azimuth">${normalizeAzimuth(targetValue).toFixed(1)}°</span></div>
          </div>
          <div class="readout-hint"><span id="gps-hint">Keep this screen open for continuous GPS updates.</span><button id="gps-retry" class="button button-quiet button-small" data-action="retry-location" hidden>Retry GPS</button></div>
          <div class="target-selectors" style="margin-top:13px">
            <button class="target-chip ${activeTarget === "A" ? "active" : ""}" data-action="select-target" data-target="A">TARGET A</button>
            <button class="target-chip ${activeTarget === "B" ? "active" : ""}" data-action="select-target" data-target="B">TARGET B</button>
          </div>
          <button class="button button-lime capture-button" id="capture-button" data-action="capture-point" disabled>◎ &nbsp; Record point for ${activeTarget}</button>
        </div>
        <aside class="side-panel">
          ${renderDirectionMap(station)}
          <section class="data-card"><h3>Station midpoint</h3>
            <div class="coordinate-row"><span>Coordinates</span><span>${midpointText}</span></div>
            <div class="coordinate-row"><span>Accuracy</span><span>${midpoint?.accuracy == null ? "—" : `${midpoint.accuracy.toFixed(1)} m`}</span></div>
            <button class="button button-outline button-small" style="margin-top:13px;width:100%" data-action="set-midpoint">${midpoint ? "Update midpoint from GPS" : "Set midpoint from GPS"}</button>
            <button class="button button-outline button-small" style="margin-top:7px;width:100%" data-action="edit-station">Station settings</button>
          </section>
          <section class="data-card"><h3>Recorded points <span class="project-meta">(${points.length})</span></h3><div class="point-list">${pointMarkup}</div></section>
        </aside>
      </section>`;
    updateLiveReadout();
  }

  function renderDirectionMap(station) {
    return `<section class="map-card">
      <div class="map-card-header">
        <div><span class="map-kicker">LOCAL FIELD MAP</span><h3>Position &amp; target directions</h3></div>
        <span class="map-compass-status" id="compass-status">North up</span>
      </div>
      <div class="map-controls" role="group" aria-label="Map orientation">
        <button class="map-mode-button ${mapMode === "north" ? "active" : ""}" data-action="set-map-mode" data-mode="north" aria-pressed="${mapMode === "north"}">North up</button>
        <button class="map-mode-button ${mapMode === "follow" ? "active" : ""}" data-action="set-map-mode" data-mode="follow" aria-pressed="${mapMode === "follow"}">Follow compass</button>
      </div>
      <div class="direction-map" role="img" aria-label="Diagram showing your position relative to the VES station midpoint and target azimuths">
        <svg viewBox="0 0 300 300" aria-hidden="true">
          <defs>
            <clipPath id="map-plot-clip"><rect x="40" y="20" width="240" height="240" rx="2"></rect></clipPath>
            <marker id="map-arrow-a" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L9 4.5L0 9z" class="map-arrow-a-head"></path></marker>
            <marker id="map-arrow-b" markerWidth="9" markerHeight="9" refX="7" refY="4.5" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L9 4.5L0 9z" class="map-arrow-b-head"></path></marker>
          </defs>
          <rect class="map-background" x="40" y="20" width="240" height="240" rx="2"></rect>
          <g id="map-rotating-layer" clip-path="url(#map-plot-clip)">
            <g id="map-grid"></g>
            <g id="map-bearing-layer">
              <line id="map-target-a" class="map-target-ray" x1="160" y1="140" x2="160" y2="25" marker-end="url(#map-arrow-a)"></line>
              <line id="map-target-b" class="map-target-ray" x1="160" y1="140" x2="160" y2="25" marker-end="url(#map-arrow-b)"></line>
              <g id="map-recorded-points"></g>
              <line id="map-position-trail" class="map-position-trail" x1="160" y1="140" x2="160" y2="140"></line>
              <circle id="map-current-position" class="map-current-position" cx="160" cy="140" r="6" hidden></circle>
            </g>
            <g class="map-north-needle">
              <path d="M160 22l-4 10 4-3 4 3z"></path>
            </g>
          </g>
          <rect class="map-border" x="40" y="20" width="240" height="240" rx="2"></rect>
          <circle class="map-midpoint" cx="160" cy="140" r="5"></circle>
          <text class="map-axis-label map-north-label" x="160" y="14" text-anchor="middle" id="map-north-label">N</text>
          <g id="map-axis-labels">
            <text class="map-axis-label" x="286" y="263" text-anchor="end">E</text>
            <text class="map-axis-unit" x="160" y="292" text-anchor="middle">EASTING FROM MIDPOINT · m</text>
            <text class="map-axis-unit" x="12" y="140" text-anchor="middle" transform="rotate(-90 12 140)">NORTHING · m</text>
          </g>
          <g id="map-axis-ticks"></g>
        </svg>
      </div>
      <div class="map-scale"><span id="map-grid-spacing">Grid · —</span><span class="map-scale-bar"><i id="map-scale-line"></i></span><span id="map-scale-label">± — m</span></div>
      <div class="map-legend">
        <span><i class="legend-midpoint"></i>Midpoint</span>
        <span class="${activeTarget === "A" ? "selected" : ""}"><i class="legend-target-a"></i>A direction</span>
        <span class="${activeTarget === "B" ? "selected" : ""}"><i class="legend-target-b"></i>B direction</span>
        <span><i class="legend-recorded"></i>Recorded points</span>
        <span><i class="legend-current"></i>Your position</span>
      </div>
      <div class="map-summary" id="map-summary">Target ${activeTarget} · ${normalizeAzimuth(station.targets[activeTarget]).toFixed(1)}° from north</div>
    </section>`;
  }

  function updateFieldMap() {
    const station = selectedStation();
    const rotatingLayer = document.getElementById("map-rotating-layer");
    if (!station || !rotatingLayer) return;
    const point = station.midpoint && currentPosition ? distanceAndBearing(station.midpoint, currentPosition) : null;
    const recordedPoints = station.midpoint
      ? station.points.map((savedPoint) => ({ point: savedPoint, measure: distanceAndBearing(station.midpoint, savedPoint) }))
      : [];
    const farthestDistance = recordedPoints.reduce(
      (farthest, savedPoint) => Math.max(farthest, savedPoint.measure.distance),
      point?.distance || 0
    );
    const niceCeiling = (value) => {
      const magnitude = 10 ** Math.floor(Math.log10(Math.max(value, 1)));
      const normalized = value / magnitude;
      const nice = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
      return nice * magnitude;
    };
    const extentMeters = niceCeiling(Math.max(farthestDistance * 1.2, 20));
    const gridStepMeters = niceCeiling(extentMeters / 3);
    const centerX = 160;
    const centerY = 140;
    const plotHalf = 116;
    const pixelsPerMeter = plotHalf / extentMeters;
    const layerRotation = mapMode === "follow" && compassHeading !== null ? -compassHeading : 0;
    rotatingLayer.setAttribute("transform", `rotate(${layerRotation} ${centerX} ${centerY})`);
    const northLabel = document.getElementById("map-north-label");
    northLabel.setAttribute("transform", `rotate(${layerRotation} ${centerX} ${centerY})`);
    document.getElementById("map-axis-labels").setAttribute("transform", `rotate(${layerRotation} ${centerX} ${centerY})`);
    document.getElementById("map-axis-ticks").setAttribute("transform", `rotate(${layerRotation} ${centerX} ${centerY})`);
    const gridLines = [];
    const axisTicks = [];
    const gridCount = Math.floor(extentMeters / gridStepMeters);
    for (let index = -gridCount; index <= gridCount; index += 1) {
      const offset = index * gridStepMeters;
      const x = centerX + offset * pixelsPerMeter;
      const y = centerY - offset * pixelsPerMeter;
      const isAxis = offset === 0;
      gridLines.push(`<line class="${isAxis ? "map-grid-axis" : "map-grid-line"}" x1="${x}" y1="24" x2="${x}" y2="256"></line>`);
      gridLines.push(`<line class="${isAxis ? "map-grid-axis" : "map-grid-line"}" x1="44" y1="${y}" x2="276" y2="${y}"></line>`);
      const label = offset === 0 ? "0" : `${offset > 0 ? "+" : ""}${Number(offset.toPrecision(3))}`;
      axisTicks.push(`<text class="map-tick-label" x="${x}" y="271" text-anchor="middle">${label}</text>`);
      axisTicks.push(`<text class="map-tick-label" x="36" y="${y + 3}" text-anchor="end">${label}</text>`);
    }
    document.getElementById("map-grid").innerHTML = gridLines.join("");
    document.getElementById("map-axis-ticks").innerHTML = axisTicks.join("");
    const targetA = normalizeAzimuth(station.targets.A);
    const targetB = normalizeAzimuth(station.targets.B);
    const setRay = (id, bearing, target) => {
      const radians = bearing * Math.PI / 180;
      const east = Math.sin(radians);
      const north = Math.cos(radians);
      const rayLength = plotHalf / Math.max(Math.abs(east), Math.abs(north));
      const line = document.getElementById(id);
      line.setAttribute("x2", String(centerX + east * rayLength));
      line.setAttribute("y2", String(centerY - north * rayLength));
      line.classList.toggle("selected", activeTarget === target);
    };
    setRay("map-target-a", targetA, "A");
    setRay("map-target-b", targetB, "B");
    const recordedMarkup = recordedPoints.map(({ point: savedPoint, measure }) => {
      const radians = measure.bearing * Math.PI / 180;
      const x = centerX + Math.sin(radians) * measure.distance * pixelsPerMeter;
      const y = centerY - Math.cos(radians) * measure.distance * pixelsPerMeter;
      return `<circle class="map-recorded-point map-recorded-${savedPoint.target.toLowerCase()}" cx="${x}" cy="${y}" r="4"><title>Recorded target ${savedPoint.target} · ${measure.distance.toFixed(1)} m · ${measure.bearing.toFixed(1)}°</title></circle>`;
    }).join("");
    document.getElementById("map-recorded-points").innerHTML = recordedMarkup;
    const position = document.getElementById("map-current-position");
    const trail = document.getElementById("map-position-trail");
    if (point) {
      const radians = point.bearing * Math.PI / 180;
      const x = centerX + Math.sin(radians) * point.distance * pixelsPerMeter;
      const y = centerY - Math.cos(radians) * point.distance * pixelsPerMeter;
      position.setAttribute("cx", String(x));
      position.setAttribute("cy", String(y));
      position.removeAttribute("hidden");
      trail.setAttribute("x2", String(x));
      trail.setAttribute("y2", String(y));
      trail.removeAttribute("hidden");
    } else {
      position.setAttribute("hidden", "");
      trail.setAttribute("hidden", "");
    }
    document.getElementById("map-grid-spacing").textContent = `Grid ${gridStepMeters} m`;
    document.getElementById("map-scale-label").textContent = `±${extentMeters} m`;
    const svgWidth = document.querySelector(".direction-map svg").getBoundingClientRect().width;
    document.getElementById("map-scale-line").style.width = `${gridStepMeters * pixelsPerMeter * svgWidth / 300}px`;
    document.getElementById("map-summary").textContent = point
      ? `You are ${point.distance.toFixed(1)} m away · ${point.bearing.toFixed(1)}° from midpoint · Target ${activeTarget} ${normalizeAzimuth(station.targets[activeTarget]).toFixed(1)}°`
      : station.midpoint ? `Target ${activeTarget} · ${normalizeAzimuth(station.targets[activeTarget]).toFixed(1)}° from north · Waiting for GPS`
        : `Target ${activeTarget} · ${normalizeAzimuth(station.targets[activeTarget]).toFixed(1)}° from north · Set midpoint to plot position`;
    const compassStatus = document.getElementById("compass-status");
    if (mapMode === "north") compassStatus.textContent = "North up";
    else if (compassHeading === null) compassStatus.textContent = "Waiting for compass";
    else compassStatus.textContent = `Heading ${compassHeading.toFixed(0)}°`;
  }

  function updateLiveReadout(errorMessage = "") {
    const positionEl = document.getElementById("current-position");
    if (!positionEl) return;
    const label = document.getElementById("gps-state-label");
    const status = document.getElementById("gps-state");
    const hint = document.getElementById("gps-hint");
    const capture = document.getElementById("capture-button");
    const retry = document.getElementById("gps-retry");
    if (errorMessage) {
      label.textContent = "GPS unavailable";
      status.classList.add("waiting");
      hint.textContent = errorMessage;
      retry.hidden = !navigator.geolocation;
      capture.disabled = true;
      updateFieldMap();
      return;
    }
    if (!currentPosition) {
      positionEl.textContent = "Waiting for signal";
      label.textContent = "Finding GPS…";
      status.classList.add("waiting");
      retry.hidden = true;
      capture.disabled = true;
      updateFieldMap();
      return;
    }
    positionEl.textContent = `${formatCoord(currentPosition.lat)}, ${formatCoord(currentPosition.lon)}`;
    label.textContent = `GPS ±${Math.round(currentPosition.accuracy)} m`;
    status.classList.remove("waiting");
    const station = selectedStation();
    retry.hidden = true;
    hint.textContent = station?.midpoint
      ? `Position updated ${new Date(currentPosition.capturedAt).toLocaleTimeString()}.`
      : "Set the station midpoint before recording survey points.";
    capture.disabled = !station?.midpoint;
    const measure = station?.midpoint ? distanceAndBearing(station.midpoint, currentPosition) : null;
    document.getElementById("current-distance").textContent = measure ? `${measure.distance.toFixed(1)} m` : "Set midpoint";
    document.getElementById("current-azimuth").textContent = measure ? `${measure.bearing.toFixed(1)}°` : "—";
    updateFieldMap();
  }

  function openModal({ title, description = "", fields, submitLabel = "Save", danger = false }) {
    const backdrop = document.createElement("div");
    backdrop.className = "modal-backdrop";
    backdrop.innerHTML = `<form class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
      <h2 id="modal-title">${escapeHtml(title)}</h2>${description ? `<p>${escapeHtml(description)}</p>` : ""}
      ${fields.map((field) => `<div class="field"><label for="field-${escapeHtml(field.name)}">${escapeHtml(field.label)}</label>
        <input id="field-${escapeHtml(field.name)}" name="${escapeHtml(field.name)}" type="${field.type || "text"}" value="${escapeHtml(field.value ?? "")}" ${field.required ? "required" : ""} ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} ${field.step ? `step="${field.step}"` : ""} ${field.autofocus ? "autofocus" : ""}></div>`).join("")}
      <div class="modal-actions"><button class="button button-outline" type="button" data-action="close-modal">Cancel</button><button class="button ${danger ? "button-danger" : "button-primary"}" type="submit">${escapeHtml(submitLabel)}</button></div>
    </form>`;
    document.body.append(backdrop);
    const form = backdrop.querySelector("form");
    (form.querySelector("[autofocus]") || form.querySelector('[type="submit"]'))?.focus();
    return new Promise((resolve) => {
      const close = (value) => { backdrop.remove(); resolve(value); };
      backdrop.addEventListener("click", (event) => {
        if (event.target === backdrop || event.target.closest('[data-action="close-modal"]')) close(null);
      });
      form.addEventListener("input", (event) => {
        if (event.target instanceof HTMLInputElement) event.target.setCustomValidity("");
      });
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form).entries());
        const inputs = [...form.elements].filter((element) => element instanceof HTMLInputElement);
        for (const input of inputs) {
          if (!input.reportValidity()) return;
          if (input.required && input.type === "text" && !input.value.trim()) {
            input.setCustomValidity("Please enter a name.");
            input.reportValidity();
            return;
          }
        }
        close(values);
      });
    });
  }

  async function createProject() {
    const values = await openModal({ title: "New project", description: "Give this survey project a name.", fields: [{ name: "name", label: "PROJECT NAME", value: "VES Survey 1", required: true, autofocus: true }] });
    if (!values) return;
    const project = { id: newId(), name: values.name.trim(), createdAt: now(), updatedAt: now(), sites: [] };
    projects.push(project);
    activeProjectId = project.id;
    await persist();
    render();
  }

  async function createSite() {
    const project = selectedProject();
    const values = await openModal({ title: "Add survey site", fields: [{ name: "name", label: "SITE NAME", value: `Site ${project.sites.length + 1}`, required: true, autofocus: true }] });
    if (!values) return;
    project.sites.push({ id: newId(), name: values.name.trim(), createdAt: now(), updatedAt: now(), stations: [] });
    project.updatedAt = now();
    await persist();
    render();
  }

  async function createStation(siteId) {
    const site = selectedProject().sites.find((item) => item.id === siteId);
    if (!site) return;
    const values = await openModal({ title: "New VES station", description: "Set the station label and the target azimuth for each assignment.", fields: [
      { name: "name", label: "STATION NAME", value: `VES ${site.stations.length + 1}`, required: true, autofocus: true },
      { name: "targetA", label: "TARGET AZIMUTH A (DEGREES)", type: "number", value: "0", min: "0", max: "360", step: "0.1", required: true },
      { name: "targetB", label: "TARGET AZIMUTH B (DEGREES)", type: "number", value: "180", min: "0", max: "360", step: "0.1", required: true }
    ] });
    if (!values) return;
    site.stations.push({ id: newId(), name: values.name.trim(), createdAt: now(), updatedAt: now(),
      targets: { A: normalizeAzimuth(values.targetA), B: normalizeAzimuth(values.targetB) }, midpoint: null, points: [] });
    site.updatedAt = now();
    selectedProject().updatedAt = now();
    await persist();
    activeSiteId = site.id;
    activeStationId = null;
    render();
  }

  async function renameEntity(entity, type) {
    const values = await openModal({ title: `Rename ${type}`, fields: [{ name: "name", label: `${type.toUpperCase()} NAME`, value: entity.name, required: true, autofocus: true }] });
    if (!values) return;
    entity.name = values.name.trim();
    entity.updatedAt = now();
    selectedProject().updatedAt = now();
    await persist();
    render();
  }

  async function deleteProject() {
    const project = selectedProject();
    const confirmed = await openModal({
      title: "Delete this project?",
      description: `“${project.name}” and all of its sites, stations, and recorded points will be permanently deleted from this device.`,
      fields: [],
      submitLabel: "Delete project",
      danger: true
    });
    if (!confirmed) return;
    projects = projects.filter((item) => item.id !== project.id);
    activeProjectId = null;
    activeSiteId = null;
    activeStationId = null;
    await persist();
    render();
    showToast("Project deleted from this device.");
  }

  async function deleteStation() {
    const project = selectedProject();
    const site = selectedSite();
    const station = selectedStation();
    const confirmed = await openModal({
      title: "Delete this station?",
      description: `“${station.name}”, its midpoint, and all ${station.points.length} recorded point${station.points.length === 1 ? "" : "s"} will be permanently deleted.`,
      fields: [],
      submitLabel: "Delete station",
      danger: true
    });
    if (!confirmed) return;
    site.stations = site.stations.filter((item) => item.id !== station.id);
    site.updatedAt = now();
    project.updatedAt = now();
    activeStationId = null;
    currentPosition = null;
    await persist();
    render();
    showToast("Station deleted.");
  }

  async function deletePoint(pointId) {
    const project = selectedProject();
    const station = selectedStation();
    const point = station.points.find((item) => item.id === pointId);
    if (!point) return;
    const confirmed = await openModal({
      title: "Delete this recorded point?",
      description: `Target ${point.target} · ${formatCoord(point.lat)}, ${formatCoord(point.lon)} · ${new Date(point.capturedAt).toLocaleString()}. This point will be permanently deleted.`,
      fields: [],
      submitLabel: "Delete point",
      danger: true
    });
    if (!confirmed) return;
    station.points = station.points.filter((item) => item.id !== pointId);
    station.updatedAt = now();
    project.updatedAt = now();
    await persist();
    render();
    showToast("Recorded point deleted.");
  }

  async function setMapMode(mode) {
    if (mode === "north") {
      mapMode = "north";
      stopCompassWatch();
    } else {
      mapMode = "follow";
      try {
        await enableCompass();
      } catch (error) {
        mapMode = "north";
        renderSurvey(selectedProject(), selectedSite(), selectedStation());
        throw error;
      }
    }
    renderSurvey(selectedProject(), selectedSite(), selectedStation());
  }

  async function editStation() {
    const station = selectedStation();
    const values = await openModal({ title: "Station settings", fields: [
      { name: "targetA", label: "TARGET AZIMUTH A (DEGREES)", type: "number", value: String(station.targets.A), min: "0", max: "360", step: "0.1", required: true },
      { name: "targetB", label: "TARGET AZIMUTH B (DEGREES)", type: "number", value: String(station.targets.B), min: "0", max: "360", step: "0.1", required: true }
    ] });
    if (!values) return;
    station.targets = { A: normalizeAzimuth(values.targetA), B: normalizeAzimuth(values.targetB) };
    station.updatedAt = now();
    selectedProject().updatedAt = now();
    await persist();
    render();
  }

  function getFreshPosition() {
    if (!navigator.geolocation) {
      showToast("This browser does not support GPS location.", true);
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition((position) => {
        const value = { lat: position.coords.latitude, lon: position.coords.longitude, accuracy: position.coords.accuracy, capturedAt: new Date(position.timestamp).toISOString() };
        currentPosition = value;
        resolve(value);
      }, (error) => {
        const message = error.code === 1 ? "Allow location access in your browser settings, then try again." : "Could not get a GPS fix. Move to an open area and try again.";
        showToast(message, true);
        resolve(null);
      }, { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
    });
  }

  async function setMidpoint() {
    const position = await getFreshPosition();
    if (!position) return;
    const station = selectedStation();
    station.midpoint = { ...position };
    station.updatedAt = now();
    selectedProject().updatedAt = now();
    await persist();
    showToast("Station midpoint saved from GPS.");
    render();
  }

  async function capturePoint() {
    const position = await getFreshPosition();
    if (!position) return;
    const station = selectedStation();
    const measure = station.midpoint ? distanceAndBearing(station.midpoint, position) : null;
    station.points.push({
      id: newId(), target: activeTarget, lat: position.lat, lon: position.lon, accuracy: position.accuracy,
      capturedAt: now(), distanceMeters: measure?.distance ?? null, bearingDegrees: measure?.bearing ?? null,
      targetAzimuth: normalizeAzimuth(station.targets[activeTarget])
    });
    station.updatedAt = now();
    selectedProject().updatedAt = now();
    await persist();
    showToast(`Point recorded for target ${activeTarget}.`);
    render();
  }

  function csvCell(value) {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }

  function downloadFile(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.style.display = "none";
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function exportCsv() {
    const project = selectedProject();
    const header = ["project_id", "project_name", "site_id", "site_name", "station_id", "station_name", "record_type", "point_id", "target", "latitude", "longitude", "accuracy_m", "distance_from_midpoint_m", "azimuth_from_midpoint_deg", "target_azimuth_deg", "target_azimuth_a_deg", "target_azimuth_b_deg", "captured_at"];
    const rows = [header];
    project.sites.forEach((site) => site.stations.forEach((station) => {
      const base = [project.id, project.name, site.id, site.name, station.id, station.name];
      rows.push([...base, "station", ...Array(8).fill(""), station.targets.A, station.targets.B, ""]);
      if (station.midpoint) rows.push([...base, "midpoint", "", "", station.midpoint.lat, station.midpoint.lon, station.midpoint.accuracy, "", "", "", station.targets.A, station.targets.B, station.midpoint.capturedAt]);
      station.points.forEach((point) => rows.push([...base, "survey_point", point.id, point.target, point.lat, point.lon, point.accuracy, point.distanceMeters, point.bearingDegrees, point.targetAzimuth, station.targets.A, station.targets.B, point.capturedAt]));
    }));
    const content = rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
    downloadFile(`${safeFilename(project.name)}-ves-survey.csv`, `\uFEFF${content}`, "text/csv;charset=utf-8");
    showToast("Project CSV exported.");
  }

  function safeFilename(value) {
    return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "ves-project";
  }

  function exportProjectJson(project) {
    return JSON.stringify({ format: EXPORT_FORMAT, version: 1, exportedAt: now(), project }, null, 2);
  }

  async function shareProject() {
    const project = selectedProject();
    const fileName = `${safeFilename(project.name)}.vesproject.json`;
    const content = exportProjectJson(project);
    const downloadBackup = () => downloadFile(fileName, content, "application/json");
    if (navigator.share && typeof File !== "undefined") {
      try {
        const file = new File([content], fileName, { type: "application/json" });
        if (navigator.canShare && !navigator.canShare({ files: [file] })) {
          downloadBackup();
          showToast("File sharing is not supported here. Project file downloaded instead.");
          return;
        }
        await navigator.share({ title: `VES Field — ${project.name}`, text: `Project ID: ${project.id}`, files: [file] });
        showToast("Project shared. Import the file on the other device to merge.");
      } catch (error) {
        if (error.name === "AbortError") {
          showToast("Sharing cancelled. Your project was not changed.");
          return;
        }
        try {
          downloadBackup();
          showToast(`Sharing was blocked (${error.message || "permission denied"}). Project file downloaded instead.`);
        } catch (downloadError) {
          showToast(`Sharing failed: ${error.message}. Download also failed: ${downloadError.message}.`, true);
        }
      }
      return;
    }
    downloadBackup();
    showToast("Project file downloaded. Send it to the other device and import it there.");
  }

  function mergeProject(incoming) {
    const existing = projects.find((item) => item.id === incoming.id);
    if (!existing) {
      projects.push(incoming);
      return "added";
    }
    const merged = structuredClone(existing);
    if (Date.parse(incoming.updatedAt) > Date.parse(merged.updatedAt)) {
      merged.name = incoming.name;
      merged.updatedAt = incoming.updatedAt;
    }
    incoming.sites.forEach((incomingSite) => {
      let site = merged.sites.find((item) => item.id === incomingSite.id);
      if (!site) {
        merged.sites.push(structuredClone(incomingSite));
        return;
      }
      if (Date.parse(incomingSite.updatedAt) > Date.parse(site.updatedAt)) {
        site.name = incomingSite.name;
        site.updatedAt = incomingSite.updatedAt;
      }
      incomingSite.stations.forEach((incomingStation) => {
        let station = site.stations.find((item) => item.id === incomingStation.id);
        if (!station) {
          site.stations.push(structuredClone(incomingStation));
          return;
        }
        if (Date.parse(incomingStation.updatedAt) > Date.parse(station.updatedAt)) {
          station.name = incomingStation.name;
          station.targets = structuredClone(incomingStation.targets);
          station.midpoint = structuredClone(incomingStation.midpoint);
          station.updatedAt = incomingStation.updatedAt;
        } else if (!station.midpoint && incomingStation.midpoint) {
          station.midpoint = structuredClone(incomingStation.midpoint);
        }
        const pointIds = new Set(station.points.map((point) => point.id));
        incomingStation.points.forEach((point) => {
          if (!pointIds.has(point.id)) station.points.push(structuredClone(point));
        });
      });
    });
    merged.updatedAt = new Date(Math.max(Date.parse(existing.updatedAt), Date.parse(incoming.updatedAt))).toISOString();
    projects[projects.findIndex((item) => item.id === existing.id)] = merged;
    return "merged";
  }

  async function importProjectFile(file) {
    try {
      const payload = JSON.parse(await file.text());
      if (payload.format !== EXPORT_FORMAT || payload.version !== 1 || !payload.project || !isValidProject(payload.project)) {
        throw new Error("This file is not a valid VES Field project export.");
      }
      const result = mergeProject(payload.project);
      activeProjectId = payload.project.id;
      activeSiteId = null;
      activeStationId = null;
      await persist();
      render();
      showToast(result === "added" ? "Project imported." : "Project records merged using the shared project ID.");
    } catch (error) {
      showToast(`Import failed: ${error.message}`, true);
    } finally {
      fileInput.value = "";
    }
  }

  function isValidProject(project) {
    const validCoordinate = (point) => point && Number.isFinite(point.lat) && point.lat >= -90 && point.lat <= 90 &&
      Number.isFinite(point.lon) && point.lon >= -180 && point.lon <= 180;
    const validTimestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value));
    if (typeof project.id !== "string" || !project.id || typeof project.name !== "string" || !project.name.trim() ||
      !validTimestamp(project.createdAt) || !validTimestamp(project.updatedAt) || !Array.isArray(project.sites)) return false;
    return project.sites.every((site) => site && typeof site.id === "string" && typeof site.name === "string" &&
      validTimestamp(site.createdAt) && validTimestamp(site.updatedAt) && Array.isArray(site.stations) &&
      site.stations.every((station) => station && typeof station.id === "string" && typeof station.name === "string" &&
        validTimestamp(station.createdAt) && validTimestamp(station.updatedAt) &&
        station.targets && Number.isFinite(station.targets.A) && station.targets.A >= 0 && station.targets.A < 360 &&
        Number.isFinite(station.targets.B) && station.targets.B >= 0 && station.targets.B < 360 &&
        Array.isArray(station.points) && (station.midpoint === null || (validCoordinate(station.midpoint) && validTimestamp(station.midpoint.capturedAt))) &&
        station.points.every((point) => point && typeof point.id === "string" && ["A", "B"].includes(point.target) &&
          validCoordinate(point) && Number.isFinite(point.accuracy) && point.accuracy >= 0 && validTimestamp(point.capturedAt))));
  }

  app.addEventListener("click", async (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;
    const action = target.dataset.action;
    try {
      if (action === "new-project") await createProject();
      else if (action === "home") { activeProjectId = null; activeSiteId = null; activeStationId = null; render(); }
      else if (action === "back") {
        if (activeStationId) {
          activeStationId = null;
          currentPosition = null;
        } else {
          activeProjectId = null;
          activeSiteId = null;
        }
        render();
      }
      else if (action === "open-project") { activeProjectId = target.dataset.id; activeSiteId = null; activeStationId = null; render(); }
      else if (action === "new-site") await createSite();
      else if (action === "new-station") await createStation(target.dataset.id);
      else if (action === "rename-project") await renameEntity(selectedProject(), "project");
      else if (action === "delete-project") await deleteProject();
      else if (action === "rename-site") { event.stopPropagation(); const site = selectedProject().sites.find((item) => item.id === target.dataset.id); await renameEntity(site, "site"); }
      else if (action === "rename-station") await renameEntity(selectedStation(), "station");
      else if (action === "delete-station") await deleteStation();
      else if (action === "delete-point") await deletePoint(target.dataset.id);
      else if (action === "toggle-site") {
        if (collapsedSiteIds.has(target.dataset.id)) collapsedSiteIds.delete(target.dataset.id);
        else collapsedSiteIds.add(target.dataset.id);
        renderProject(selectedProject());
      }
      else if (action === "open-station") { activeSiteId = target.dataset.siteId; activeStationId = target.dataset.id; currentPosition = null; activeTarget = "A"; render(); }
      else if (action === "select-target") { activeTarget = target.dataset.target; renderSurvey(selectedProject(), selectedSite(), selectedStation()); ensureLocationWatch(); }
      else if (action === "set-map-mode") await setMapMode(target.dataset.mode);
      else if (action === "set-midpoint") await setMidpoint();
      else if (action === "capture-point") await capturePoint();
      else if (action === "retry-location") {
        stopLocationWatch();
        currentPosition = null;
        updateLiveReadout();
        ensureLocationWatch();
      }
      else if (action === "edit-station") await editStation();
      else if (action === "export-csv") exportCsv();
      else if (action === "share-project") await shareProject();
      else if (action === "import-project") fileInput.click();
      else if (action === "close-modal") target.closest(".modal-backdrop")?.remove();
    } catch (error) {
      showToast(error.message || "Something went wrong.", true);
    }
  });

  app.addEventListener("keydown", (event) => {
    if ((event.key === "Enter" || event.key === " ") && event.target.matches('[role="button"][data-action]')) {
      event.preventDefault();
      event.target.click();
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files?.[0];
    if (file) importProjectFile(file);
  });

  window.addEventListener("online", updateConnectionStatus);
  window.addEventListener("offline", updateConnectionStatus);
  window.addEventListener("resize", () => {
    if (selectedStation()) updateFieldMap();
  });

  function updateConnectionStatus() {
    document.getElementById("connection-status").innerHTML = `<span class="status-dot"></span> ${navigator.onLine ? "Online · data stays local" : "Offline ready"}`;
  }

  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    deferredInstallPrompt = event;
    installButton.hidden = false;
  });
  installButton.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });

  async function start() {
    try {
      if (!("indexedDB" in window)) throw new Error("This browser does not support offline project storage.");
      db = await openDatabase();
      projects = await readProjects();
      updateConnectionStatus();
      render();
      if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
        navigator.serviceWorker.register("./sw.js").catch((error) => showToast(`Offline app setup failed: ${error.message}`, true));
      }
    } catch (error) {
      app.innerHTML = `<div class="load-error"><h1>Could not open VES Field</h1><p>${escapeHtml(error.message)}</p></div>`;
    }
  }

  start();
})();

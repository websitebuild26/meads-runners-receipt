/* Meads Runners Receipt — Strava OAuth + receipt rendering (vanilla JS) */

const CLIENT_ID = "260923";
const REDIRECT_URI = window.location.origin + "/callback";
const SCOPE = "activity:read";
const TOKEN_FN = "/.netlify/functions/strava-token";
const STORE_KEY = "meads_strava_tokens";

let tokens = null;     // { access_token, refresh_token, expires_at }
let athlete = null;
let runs = [];
let page = 1;

/* ---------- element refs ---------- */
const views = {
  login: document.getElementById("login-view"),
  loading: document.getElementById("loading-view"),
  list: document.getElementById("list-view"),
  receipt: document.getElementById("receipt-view"),
};
const $ = (id) => document.getElementById(id);

/* ---------- view helpers ---------- */
function show(name) {
  Object.values(views).forEach((v) => v.classList.add("hidden"));
  views[name].classList.remove("hidden");
}
function setLoading(text) {
  $("loading-text").textContent = text || "Loading…";
  show("loading");
}
function showError(msg) {
  const el = $("error-banner");
  el.textContent = msg;
  el.classList.remove("hidden");
  setTimeout(() => el.classList.add("hidden"), 6000);
}

/* ---------- OAuth ---------- */
$("connect-btn").addEventListener("click", () => {
  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID);
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPE);
  url.searchParams.set("approval_prompt", "auto");
  window.location.href = url.toString();
});

$("logout-btn").addEventListener("click", () => {
  localStorage.removeItem(STORE_KEY);
  tokens = null; athlete = null; runs = []; page = 1;
  history.replaceState({}, "", "/");
  show("login");
});

async function exchangeCode(code) {
  setLoading("Connecting to Strava…");
  const res = await fetch(TOKEN_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Token exchange failed");
  saveTokens(data);
  athlete = data.athlete;
}

async function refreshTokens() {
  const res = await fetch(TOKEN_FN, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: tokens.refresh_token }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Token refresh failed");
  saveTokens(data);
}

function saveTokens(data) {
  tokens = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at,
  };
  localStorage.setItem(STORE_KEY, JSON.stringify(tokens));
}

async function ensureFreshToken() {
  if (!tokens) throw new Error("Not logged in");
  // refresh if expiring within 2 minutes
  if (tokens.expires_at && tokens.expires_at - Date.now() / 1000 < 120) {
    await refreshTokens();
  }
}

/* ---------- Strava API ---------- */
async function stravaGet(path) {
  await ensureFreshToken();
  const res = await fetch("https://www.strava.com/api/v3" + path, {
    headers: { Authorization: "Bearer " + tokens.access_token },
  });
  if (res.status === 401) {
    await refreshTokens();
    return stravaGet(path);
  }
  if (!res.ok) throw new Error("Strava API error (" + res.status + ")");
  return res.json();
}

async function loadRuns(reset) {
  if (reset) { runs = []; page = 1; }
  setLoading("Loading your runs…");
  try {
    const batch = await stravaGet(`/athlete/activities?per_page=30&page=${page}`);
    const onlyRuns = batch.filter((a) => a.type === "Run" || a.sport_type === "Run");
    runs = runs.concat(onlyRuns);
    renderList();
    // If Strava returned a full page, more may exist
    $("load-more-btn").classList.toggle("hidden", batch.length < 30);
    show("list");
  } catch (err) {
    showError(err.message);
    show("list");
  }
}

$("load-more-btn").addEventListener("click", () => {
  page += 1;
  loadRuns(false);
});

/* ---------- run list ---------- */
function renderList() {
  if (athlete) {
    $("athlete-name").textContent =
      `${athlete.firstname || ""} ${athlete.lastname || ""}`.trim() || "Your runs";
  }
  const ul = $("run-list");
  ul.innerHTML = "";
  if (!runs.length) {
    ul.innerHTML = `<li class="hint">No runs found on your Strava account.</li>`;
    return;
  }
  runs.forEach((r) => {
    const li = document.createElement("li");
    li.className = "run-item";
    li.innerHTML = `
      <div class="run-name">${escapeHtml(r.name)}</div>
      <div class="run-meta">
        <span>${fmtDate(r.start_date_local)}</span>
        <span>${(r.distance / 1000).toFixed(2)} km</span>
        <span>${fmtDuration(r.moving_time)}</span>
      </div>`;
    li.addEventListener("click", () => openReceipt(r));
    ul.appendChild(li);
  });
}

/* ---------- receipt ---------- */
async function openReceipt(summary) {
  setLoading("Fetching run details…");
  let run = summary;
  try {
    // detailed endpoint gives calories, achievement_count, etc.
    run = await stravaGet(`/activities/${summary.id}`);
  } catch (err) {
    showError("Using summary data: " + err.message);
  }
  renderReceipt(run);
  show("receipt");
  window.scrollTo(0, 0);
}

function renderReceipt(r) {
  const distanceKm = r.distance / 1000;
  const pace = paceFromSpeed(r.distance, r.moving_time); // min/km string
  const hr = r.average_heartrate;
  const maxHr = r.max_heartrate;

  const line = (k, v) => `<div class="r-line"><span class="k">${k}</span><span class="v">${v}</span></div>`;

  let html = "";
  html += `<img src="/meads-logo.png" alt="Meads Runners" class="r-logo" onerror="this.style.display='none'" />`;
  html += `<div class="r-title">MEADS RUNNERS</div>`;
  html += `<div class="r-sub">Official Run Receipt</div>`;
  html += `<hr class="r-divider" />`;

  html += `<div class="r-rowname">${escapeHtml(r.name)}</div>`;
  html += `<div class="r-date">${fmtDateTime(r.start_date_local)}</div>`;
  html += `<hr class="r-divider" />`;

  html += line("DISTANCE", distanceKm.toFixed(2) + " km");
  html += line("MOVING TIME", fmtDuration(r.moving_time));
  html += line("PACE", pace + " /km");
  html += line("ELEV GAIN", Math.round(r.total_elevation_gain || 0) + " m");
  html += line("CADENCE", r.average_cadence ? Math.round(r.average_cadence * 2) + " spm" : "—");
  html += line("CALORIES", r.calories ? Math.round(r.calories) + " kcal" : "—");

  html += `<div class="r-section-label">Heart Rate</div>`;
  html += line("AVG HR", hr ? Math.round(hr) + " bpm" : "—");
  html += line("MAX HR", maxHr ? Math.round(maxHr) + " bpm" : "—");
  html += line("ZONE", hr ? hrZone(hr, maxHr) : "—");

  html += `<hr class="r-divider" />`;
  html += `<div class="r-section-label">Social</div>`;
  html += line("KUDOS", (r.kudos_count ?? 0) + " 👏");
  html += line("PRs", r.pr_count ?? 0);
  html += line("ACHIEVEMENTS", r.achievement_count ?? 0);

  html += `<hr class="r-double" />`;
  html += `<div class="r-total"><span>TOTAL</span><span>${distanceKm.toFixed(2)} km</span></div>`;
  html += `<div class="r-barcode"></div>`;
  html += `<div class="r-footer">
    Thank you for running!<br/>
    No refunds on hills. Pace is final.<br/>
    #MeadsRunners
  </div>`;

  const el = $("receipt");
  el.innerHTML = html;
  // restart the paper-feed "printing" animation each time
  el.classList.remove("printing");
  void el.offsetWidth; // force reflow so the animation replays
  el.classList.add("printing");
}

$("back-btn").addEventListener("click", () => show("list"));
$("print-btn").addEventListener("click", () => { fitReceiptToLabel(); window.print(); });
$("save-btn").addEventListener("click", saveReceipt);

// Scale the receipt so the whole thing lands on one 15cm x 10cm label
// (100mm wide x 150mm tall, with the 4mm @page margin on each side).
window.addEventListener("beforeprint", fitReceiptToLabel);
function fitReceiptToLabel() {
  const node = $("receipt");
  node.classList.remove("printing");
  node.style.removeProperty("--print-scale"); // measure at natural size
  const PX_PER_MM = 96 / 25.4;
  const availW = (100 - 8) * PX_PER_MM;  // page width  - margins
  const availH = (150 - 8) * PX_PER_MM;  // page height - margins
  const rect = node.getBoundingClientRect();
  const scale = Math.min(availW / rect.width, availH / rect.height);
  node.style.setProperty("--print-scale", scale.toFixed(3));
}

// Render the receipt to a PNG, then share it (mobile share sheet → "Save Image"
// to Photos / share to Strava etc.) or download it (desktop).
async function saveReceipt() {
  const btn = $("save-btn");
  const node = $("receipt");
  if (typeof htmlToImage === "undefined") {
    showError("Image library didn't load — check your connection and retry.");
    return;
  }

  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Saving…";

  // The feed animation uses a transform; clear it so the capture is square-on.
  node.classList.remove("printing");

  try {
    const blob = await htmlToImage.toBlob(node, {
      pixelRatio: 3,                 // crisp on retina + good for printing
      backgroundColor: "#ffffff",
      cacheBust: true,
    });
    if (!blob) throw new Error("empty image");

    const fileName = `meads-receipt-${Date.now()}.png`;
    const file = new File([blob], fileName, { type: "image/png" });

    // Prefer the native share sheet on mobile (gives "Save Image" + Strava etc.)
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({
        files: [file],
        title: "Meads Runners Receipt",
        text: "My run receipt 🧾 #MeadsRunners",
      });
    } else {
      // Desktop / unsupported: download the PNG.
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  } catch (err) {
    // User cancelling the share sheet throws AbortError — ignore that.
    if (err && err.name !== "AbortError") {
      showError("Could not create image: " + (err.message || err));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/* ---------- formatting helpers ---------- */
function paceFromSpeed(distanceMeters, movingSeconds) {
  if (!distanceMeters || !movingSeconds) return "—";
  const secPerKm = movingSeconds / (distanceMeters / 1000);
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDuration(sec) {
  if (!sec) return "—";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function fmtDate(iso) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}
function fmtDateTime(iso) {
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// Rough zone from avg HR as % of max. Uses activity max HR when present,
// otherwise an assumed max of 190 bpm.
function hrZone(avg, max) {
  const ceiling = max && max > avg ? max : 190;
  const pct = avg / ceiling;
  if (pct < 0.6) return "Z1 Recovery";
  if (pct < 0.7) return "Z2 Endurance";
  if (pct < 0.8) return "Z3 Tempo";
  if (pct < 0.9) return "Z4 Threshold";
  return "Z5 Anaerobic";
}

function escapeHtml(str) {
  return String(str ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* ---------- boot ---------- */
async function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("code");
  const oauthError = params.get("error");

  if (oauthError) {
    showError("Strava authorisation was cancelled or denied.");
    history.replaceState({}, "", "/");
    show("login");
    return;
  }

  const stored = localStorage.getItem(STORE_KEY);
  if (stored) { try { tokens = JSON.parse(stored); } catch {} }

  if (code) {
    try {
      await exchangeCode(code);
      history.replaceState({}, "", "/");
      await loadRuns(true);
    } catch (err) {
      showError(err.message);
      show("login");
    }
    return;
  }

  if (tokens && tokens.refresh_token) {
    try {
      await loadRuns(true);
    } catch (err) {
      showError(err.message);
      show("login");
    }
    return;
  }

  show("login");
}

init();

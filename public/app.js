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
  html += `<img src="/meads-logo.png" alt="Meads Runners" class="r-logo" />`;
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
    await shareOrDownload(blob, `meads-receipt-${Date.now()}.png`, "Meads Runners Receipt");
  } catch (err) {
    if (err && err.name !== "AbortError") {
      showError("Could not create image: " + (err.message || err));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Share a blob via the native share sheet (mobile → "Save Image/Video" to
// Photos + share targets), or download it as a fallback (desktop).
async function shareOrDownload(blob, fileName, title) {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    await navigator.share({ files: [file], title, text: "My run receipt 🧾 #MeadsRunners" });
  } else {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
}

/* ---------- printing video ---------- */
$("video-btn").addEventListener("click", saveVideo);

async function saveVideo() {
  const btn = $("video-btn");
  if (typeof htmlToImage === "undefined") {
    showError("Image library didn't load — check your connection and retry.");
    return;
  }
  if (typeof MediaRecorder === "undefined") {
    showError("Your browser can't record video. Try the latest Safari or Chrome.");
    return;
  }

  const label = btn.textContent;
  btn.disabled = true;

  try {
    const blob = await buildReceiptVideoBlob((p) => {
      btn.textContent = "Rendering " + Math.round(p * 100) + "%";
    });
    if (!blob || !blob.size) throw new Error("empty video");
    // Don't auto-share: on iOS the share sheet needs a *fresh* tap, but encoding
    // takes seconds. Show the finished clip with its own Save button instead.
    showVideoResult(blob);
  } catch (err) {
    if (err && err.name !== "AbortError") {
      showError("Could not create video: " + (err.message || err));
    }
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

// Show the finished video so the user can save it with a fresh tap (required
// by iOS for navigator.share) or press-and-hold the video → Save to Photos.
function showVideoResult(blob) {
  const url = URL.createObjectURL(blob);
  const ext = blob.type.includes("mp4") ? "mp4" : "webm";
  const wrap = document.createElement("div");
  wrap.className = "video-result";
  wrap.innerHTML =
    '<h3>Your printing video</h3>' +
    '<video src="' + url + '" autoplay loop muted playsinline controls></video>' +
    '<p class="vr-hint">Tap <b>Save / Share</b>, then choose <b>Save Video</b>.<br>' +
    'On iPhone you can also press &amp; hold the video → <b>Save to Photos</b>.</p>' +
    '<div class="vr-actions">' +
    '<button class="strava-btn small" id="vr-save">Save / Share</button>' +
    '<button class="ghost-btn small" id="vr-close">Close</button>' +
    '</div>';
  document.body.appendChild(wrap);

  wrap.querySelector("#vr-save").addEventListener("click", async () => {
    try {
      await shareOrDownload(blob, `meads-receipt-${Date.now()}.${ext}`, "Meads Runners Receipt");
    } catch (err) {
      if (err && err.name !== "AbortError") showError("Save failed: " + (err.message || err));
    }
  });
  wrap.querySelector("#vr-close").addEventListener("click", () => {
    URL.revokeObjectURL(url);
    wrap.remove();
  });
}

function pickVideoMime() {
  const candidates = [
    "video/mp4;codecs=h264",
    "video/mp4",
    "video/webm;codecs=vp9",
    "video/webm;codecs=vp8",
    "video/webm",
  ];
  for (const m of candidates) {
    if (MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(m)) return m;
  }
  return "";
}

function loadImage(src) {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = () => rej(new Error("image decode failed"));
    img.src = src;
  });
}

function roundRectPath(ctx, x, y, w, h, r) {
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, r); return; }
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// Records a short clip: paper feeds out of a printer slot, then holds on the
// finished receipt. Returns a Promise<Blob> (mp4 where supported, else webm).
async function buildReceiptVideoBlob(onProgress) {
  const node = $("receipt");
  node.classList.remove("printing");

  const dataUrl = await htmlToImage.toPng(node, {
    pixelRatio: 2,
    backgroundColor: "#ffffff",
    cacheBust: true,
  });
  const img = await loadImage(dataUrl);

  // layout — printer machine on top, receipt feeds out of its slot
  const sidePad = 62, topPad = 24, botPad = 58;
  const RW = 560;
  const RH = Math.round(RW * img.naturalHeight / img.naturalWidth);
  const W = RW + sidePad * 2;              // 780
  const machineX = 24, machineW = W - 48;  // body footprint
  const machineTop = topPad;
  const machineBodyH = 190;
  const slotY = machineTop + machineBodyH; // paper exit line
  const rx = sidePad, ry = slotY;
  let H = slotY + RH + botPad;
  if (H % 2) H++; // H.264 needs even dimensions

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  function drawBg() {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, "#eceae7");
    g.addColorStop(1, "#f6f5f3");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
  }

  function drawReceipt(visibleH, jitter) {
    if (visibleH <= 0) return;
    // paper drop shadow for depth
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 20;
    ctx.shadowOffsetY = 8;
    ctx.fillStyle = "#fff";
    ctx.fillRect(rx, ry, RW, visibleH);
    ctx.restore();
    // clip to the printed-so-far region, then draw the receipt image
    ctx.save();
    ctx.beginPath();
    ctx.rect(rx, ry, RW, visibleH);
    ctx.clip();
    ctx.drawImage(img, rx + jitter, ry, RW, RH);
    // soft shadow at the very top so the paper looks like it emerges from inside
    const sh = ctx.createLinearGradient(0, ry, 0, ry + 46);
    sh.addColorStop(0, "rgba(0,0,0,0.22)");
    sh.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = sh;
    ctx.fillRect(rx, ry, RW, 46);
    ctx.restore();
  }

  // Realistic thermal-printer body with a serrated tear bar at the exit slot.
  function drawMachine() {
    const mx = machineX, my = machineTop, mw = machineW, mh = machineBodyH;

    // ground shadow under the machine
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.25)";
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 12;
    ctx.fillStyle = "#3a3d40";
    roundRectPath(ctx, mx, my, mw, mh, 22);
    ctx.fill();
    ctx.restore();

    // body + inner detailing (clipped to body)
    ctx.save();
    roundRectPath(ctx, mx, my, mw, mh, 22);
    const body = ctx.createLinearGradient(0, my, 0, my + mh);
    body.addColorStop(0, "#5c6065");
    body.addColorStop(0.5, "#43474b");
    body.addColorStop(1, "#2a2c2e");
    ctx.fillStyle = body;
    ctx.fill();
    ctx.clip();

    // top gloss
    const gloss = ctx.createLinearGradient(0, my, 0, my + mh * 0.45);
    gloss.addColorStop(0, "rgba(255,255,255,0.18)");
    gloss.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gloss;
    ctx.fillRect(mx, my, mw, mh * 0.45);

    // side vignette for a rounded feel
    const vig = ctx.createLinearGradient(mx, 0, mx + mw, 0);
    vig.addColorStop(0, "rgba(0,0,0,0.30)");
    vig.addColorStop(0.12, "rgba(0,0,0,0)");
    vig.addColorStop(0.88, "rgba(0,0,0,0)");
    vig.addColorStop(1, "rgba(0,0,0,0.30)");
    ctx.fillStyle = vig;
    ctx.fillRect(mx, my, mw, mh);

    // lid seam line
    const seamY = my + mh * 0.42;
    ctx.strokeStyle = "rgba(0,0,0,0.38)";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(mx, seamY); ctx.lineTo(mx + mw, seamY); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.10)";
    ctx.beginPath(); ctx.moveTo(mx, seamY + 2); ctx.lineTo(mx + mw, seamY + 2); ctx.stroke();
    ctx.restore();

    // embossed brand label
    ctx.save();
    ctx.font = "600 22px -apple-system, Helvetica, Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.fillText("MEADS RUNNERS", W / 2, my + mh * 0.24);
    ctx.restore();

    // power LED (green, glowing)
    ctx.save();
    ctx.beginPath();
    ctx.arc(mx + 28, my + mh - 26, 6, 0, Math.PI * 2);
    ctx.fillStyle = "#37d67a";
    ctx.shadowColor = "#37d67a";
    ctx.shadowBlur = 12;
    ctx.fill();
    ctx.restore();

    // feed button (right)
    ctx.save();
    const bgrd = ctx.createLinearGradient(0, my + mh - 40, 0, my + mh - 14);
    bgrd.addColorStop(0, "#6b6f73");
    bgrd.addColorStop(1, "#34383b");
    ctx.beginPath();
    ctx.arc(mx + mw - 36, my + mh - 28, 13, 0, Math.PI * 2);
    ctx.fillStyle = bgrd;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.4)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // recessed exit slot just inside the bottom edge
    const slotInset = 26, sH = 16;
    const sX = mx + slotInset, sW = mw - slotInset * 2, sY = slotY - sH;
    ctx.save();
    const slotG = ctx.createLinearGradient(0, sY, 0, sY + sH);
    slotG.addColorStop(0, "rgba(0,0,0,0.92)");
    slotG.addColorStop(1, "rgba(35,35,38,0.7)");
    ctx.fillStyle = slotG;
    roundRectPath(ctx, sX, sY, sW, sH, 6);
    ctx.fill();
    ctx.restore();

    // metallic serrated tear bar at the slot line
    ctx.save();
    const bar = ctx.createLinearGradient(0, slotY - 6, 0, slotY + 2);
    bar.addColorStop(0, "#d3d6d8");
    bar.addColorStop(0.5, "#9a9ea1");
    bar.addColorStop(1, "#707477");
    ctx.fillStyle = bar;
    ctx.fillRect(sX, slotY - 6, sW, 6);
    ctx.fillStyle = "#bcbfc1";
    const tw = 10, n = Math.floor(sW / tw);
    for (let i = 0; i < n; i++) {
      const tx = sX + i * tw;
      ctx.beginPath();
      ctx.moveTo(tx, slotY);
      ctx.lineTo(tx + tw / 2, slotY + 7);
      ctx.lineTo(tx + tw, slotY);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  const easeOut = (t) => 1 - Math.pow(1 - t, 3);
  const preDur = 450, feedDur = 2200, holdDur = 2600;
  const total = preDur + feedDur + holdDur;

  // Draw a single frame for animation time `t` (ms).
  function drawFrame(t) {
    drawBg();
    if (t < preDur) {
      drawMachine();
    } else if (t < preDur + feedDur) {
      const p = easeOut((t - preDur) / feedDur);
      drawReceipt(RH * p, (Math.random() * 2 - 1) * 1.2);
      drawMachine(); // machine over the paper, so it appears to emerge from the slot
    } else {
      drawReceipt(RH, 0);
      drawMachine();
    }
  }

  const fps = 25;

  // Preferred path: WebCodecs encodes a real MP4 frame-by-frame. Works on
  // iOS/Safari (16.4+), where canvas.captureStream + MediaRecorder do not.
  if (window.VideoEncoder && window.Mp4Muxer) {
    const codec = await pickAvcCodec(W, H, fps);
    if (codec) {
      return encodeWithWebCodecs(canvas, drawFrame, { W, H, fps, total, codec, onProgress });
    }
  }

  // Fallback: MediaRecorder + canvas.captureStream (Chromium / Android).
  if (typeof canvas.captureStream === "function" && typeof MediaRecorder !== "undefined") {
    return recordWithMediaRecorder(canvas, drawFrame, { fps, total, onProgress });
  }

  throw new Error("video recording isn't supported here — try Save image instead");
}

async function pickAvcCodec(W, H, fps) {
  const codecs = ["avc1.420028", "avc1.640028", "avc1.4D0028", "avc1.42E01F"];
  for (const codec of codecs) {
    try {
      const s = await VideoEncoder.isConfigSupported({
        codec, width: W, height: H, bitrate: 5000000, framerate: fps,
      });
      if (s && s.supported) return codec;
    } catch (_) { /* try next */ }
  }
  return null;
}

async function encodeWithWebCodecs(canvas, drawFrame, { W, H, fps, total, codec, onProgress }) {
  const muxer = new Mp4Muxer.Muxer({
    target: new Mp4Muxer.ArrayBufferTarget(),
    video: { codec: "avc", width: W, height: H },
    fastStart: "in-memory",
  });
  let encodeError = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => { encodeError = e; },
  });
  encoder.configure({ codec, width: W, height: H, bitrate: 5000000, framerate: fps });

  const frames = Math.round((total / 1000) * fps);
  const frameDur = 1e6 / fps; // microseconds
  for (let i = 0; i < frames; i++) {
    if (encodeError) throw encodeError;
    drawFrame((i / fps) * 1000);
    const vf = new VideoFrame(canvas, { timestamp: Math.round(i * frameDur), duration: Math.round(frameDur) });
    encoder.encode(vf, { keyFrame: i % (fps * 2) === 0 });
    vf.close();
    if (onProgress) onProgress(i / frames);
    if (encoder.encodeQueueSize > 8) await new Promise((r) => setTimeout(r, 0));
  }
  await encoder.flush();
  if (encodeError) throw encodeError;
  muxer.finalize();
  if (onProgress) onProgress(1);
  return new Blob([muxer.target.buffer], { type: "video/mp4" });
}

function recordWithMediaRecorder(canvas, drawFrame, { fps, total, onProgress }) {
  const mime = pickVideoMime();
  const stream = canvas.captureStream(fps);
  const recorder = new MediaRecorder(
    stream,
    mime ? { mimeType: mime, videoBitsPerSecond: 6000000 } : undefined
  );
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  const finished = new Promise((res) => {
    recorder.onstop = () => res(new Blob(chunks, { type: mime || "video/webm" }));
  });

  recorder.start();
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    drawFrame(t);
    if (onProgress) onProgress(Math.min(1, t / total));
    if (t < total) {
      requestAnimationFrame(frame);
    } else {
      recorder.stop();
    }
  }
  requestAnimationFrame(frame);
  return finished;
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

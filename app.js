/* ===== Neles Ultimativer Bewerbungstracker — App-Logik ===== */

/* --- Firebase-Konfiguration (Projekt bewerbungstracker-c8215) --- */
const firebaseConfig = {
  apiKey: "AIzaSyBc0tnUDOHGpCyc32u93H8EphQN3tZSgvQ",
  authDomain: "bewerbungstracker-c8215.firebaseapp.com",
  databaseURL: "https://bewerbungstracker-c8215-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "bewerbungstracker-c8215",
  storageBucket: "bewerbungstracker-c8215.firebasestorage.app",
  messagingSenderId: "1060376586428",
  appId: "1:1060376586428:web:3ecc9fea67eccbd941c8b9",
  measurementId: "G-G67FJN71PE"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.database();
const appsRef = db.ref("applications");
const pipeRef = db.ref("pipeline");
const seedRef = db.ref("meta/seeded");

/* --- Konstanten --- */
const STATUSES = [
  "Beworben", "Nachgefragt", "Vorstellungsgespräch",
  "Zusage", "Absage", "Kein Fit", "Pausiert"
];
const STATUS_META = {
  "Beworben":             { color: "var(--st-beworben)",   emoji: "📨" },
  "Nachgefragt":          { color: "var(--st-nachgefragt)", emoji: "🔔" },
  "Vorstellungsgespräch": { color: "var(--st-gespraech)",   emoji: "🤝" },
  "Zusage":               { color: "var(--st-zusage)",      emoji: "🎉" },
  "Absage":               { color: "var(--st-absage)",      emoji: "❌" },
  "Kein Fit":             { color: "var(--st-keinfit)",     emoji: "🚫" },
  "Pausiert":             { color: "var(--st-pausiert)",    emoji: "⏸️" }
};
const PIPELINE_STATUSES = ["Neu", "Recherche", "Bereit"];
const PIPELINE_META = {
  "Neu":       { color: "var(--st-neu)",      emoji: "✨" },
  "Recherche": { color: "var(--st-beworben)", emoji: "🔎" },
  "Bereit":    { color: "var(--st-zusage)",   emoji: "✅" }
};
const INTERESTS = ["Sehr gerne", "Gerne", "Ja", "Joa", "Eher nicht"];

const APP_FIELDS = [
  { key: "name",        label: "Unternehmen",            type: "text",     required: true },
  { key: "status",      label: "Status",                 type: "select",   options: STATUSES },
  { key: "interest",    label: "Interesse",              type: "select",   options: ["", ...INTERESTS] },
  { key: "location",    label: "Standort",               type: "text",     list: "locList" },
  { key: "dateApplied", label: "Datum Bewerbung",        type: "date" },
  { key: "applicationMethod", label: "Wie beworben",     type: "select",   options: ["", "E-Mail", "Online Formular", "anders"] },
  { key: "emailRecipient", label: "Versendet an (E-Mail-Adresse)", type: "email", full: true, showIf: { field: "applicationMethod", value: "E-Mail" } },
  { key: "followedUp",  label: "Nachgefragt am",         type: "date" },
  { key: "website",     label: "Website / Stellenanzeige", type: "text",   full: true },
  { key: "address",     label: "Adresse",                type: "text",     full: true },
  { key: "contact",     label: "Kontakt",                type: "text",     full: true },
  { key: "result",      label: "Ergebnis",               type: "text",     full: true },
  { key: "notes",       label: "Notizen",                type: "textarea", full: true }
];
const PIPE_FIELDS = [
  { key: "name",     label: "Unternehmen",        type: "text",     required: true },
  { key: "status",   label: "Status",             type: "select",   options: PIPELINE_STATUSES },
  { key: "interest", label: "Interesse",          type: "select",   options: ["", ...INTERESTS] },
  { key: "deadline", label: "Bewerbung bis",      type: "date" },
  { key: "address",  label: "Adresse / Standort", type: "text",     full: true },
  { key: "notes",    label: "Notizen / Recherche", type: "textarea", full: true }
];

/* --- Zustand --- */
let applications = {};
let pipeline = {};
const ui = {
  activeSort: "createdAt", activeDir: "desc", activeSearch: "", activeStatus: "",
  pipeSort: "createdAt",   pipeDir: "desc",   pipeSearch: "",
  followupMode: "due"
};
let modalCtx = null;   // { type, id|null }
let confirmCb = null;
let isOnline = false;

/* --- Helfer --- */
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function fmtDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso || "";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
function daysSince(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const diff = Date.now() - new Date(iso).getTime();
  return Math.floor(diff / 86400000);
}
function toArray(obj) {
  return Object.entries(obj || {}).map(([id, v]) => ({ id, ...v }));
}
function normalizeUrl(u) {
  const s = String(u == null ? "" : u).trim();
  if (!s) return "";
  return /^https?:\/\//i.test(s) ? s : "https://" + s;
}
/* Löst eine STATUS_META-Farbe (auch CSS-Variablen) zu einem echten Hex-Wert auf. */
function statusColorHex(status) {
  const meta = STATUS_META[status];
  const raw = meta ? meta.color : "var(--st-beworben)";
  const varMatch = /^var\((--[\w-]+)\)$/.exec(raw);
  if (varMatch) {
    const resolved = getComputedStyle(document.documentElement)
      .getPropertyValue(varMatch[1]).trim();
    if (resolved) return resolved;
  }
  return raw || "#3b82f6";
}

/* --- Toasts --- */
function toast(msg, kind = "info") {
  const el = document.createElement("div");
  el.className = `toast ${kind}`;
  const icon = { success: "✅", error: "⚠️", info: "ℹ️" }[kind] || "ℹ️";
  el.innerHTML = `<span>${icon}</span><span>${esc(msg)}</span>`;
  $("#toastContainer").appendChild(el);
  setTimeout(() => {
    el.classList.add("out");
    el.addEventListener("animationend", () => el.remove());
  }, 3200);
}

/* ===== Firebase: Listener & Seed ===== */
let dashboardScheduled = false;
function scheduleDashboard() {
  if (dashboardScheduled) return;
  dashboardScheduled = true;
  requestAnimationFrame(() => {
    dashboardScheduled = false;
    renderDashboard();
  });
}

function initFirebase() {
  db.ref(".info/connected").on("value", (snap) => {
    const on = snap.val() === true;
    isOnline = on;
    const el = $("#connStatus");
    el.classList.toggle("online", on);
    el.classList.toggle("offline", !on);
    el.querySelector(".conn-label").textContent = on ? "live synchron" : "offline";
  });

  appsRef.on("value", (snap) => {
    applications = snap.val() || {};
    scheduleDashboard();
    renderActive();
  }, (err) => toast("DB-Fehler: " + err.message, "error"));

  pipeRef.on("value", (snap) => {
    pipeline = snap.val() || {};
    scheduleDashboard();
    renderPipeline();
  }, (err) => toast("DB-Fehler: " + err.message, "error"));

  /* Einmaliger Seed-Import: transaktional gegen Doppelimport bei parallelen Clients. */
  seedRef.transaction((cur) => (cur === true ? undefined : true)).then((res) => {
    if (!res.committed) return;
    appsRef.once("value").then((aSnap) => {
      if (!aSnap.exists()) runSeed(true);
    });
  });
}

function runSeed(silent) {
  const base = Date.now();
  const updates = {};
  SEED_APPLICATIONS.forEach((row, i) => {
    const key = appsRef.push().key;
    updates["applications/" + key] = { ...row, createdAt: base + i, order: i };
  });
  SEED_PIPELINE.forEach((row, i) => {
    const key = pipeRef.push().key;
    updates["pipeline/" + key] = { ...row, createdAt: base + i, order: i };
  });
  updates["meta/seeded"] = true;
  db.ref().update(updates)
    .then(() => { if (!silent) toast("Excel-Daten importiert 🎉", "success"); })
    .catch((e) => toast("Import fehlgeschlagen: " + e.message, "error"));
}

/* ===== Dashboard ===== */
function renderDashboard() {
  const apps = toArray(applications);
  const count = (fn) => apps.filter(fn).length;

  const stats = [
    { icon: "🏢", label: "Gesamt aktiv", value: apps.length,                                   color: "var(--brand-1)" },
    { icon: "📨", label: "Offen",        value: count((a) => ["Beworben", "Nachgefragt"].includes(a.status)), color: "var(--st-beworben)" },
    { icon: "🤝", label: "Gespräche",    value: count((a) => a.status === "Vorstellungsgespräch"), color: "var(--st-gespraech)" },
    { icon: "🎉", label: "Zusagen",      value: count((a) => a.status === "Zusage"),             color: "var(--st-zusage)" },
    { icon: "❌", label: "Absagen",      value: count((a) => ["Absage", "Kein Fit"].includes(a.status)), color: "var(--st-absage)" },
    { icon: "🎯", label: "Pipeline",     value: toArray(pipeline).length,                       color: "var(--st-neu)" }
  ];
  $("#statsGrid").innerHTML = stats.map((s) => `
    <div class="stat" style="--stat-color:${s.color}">
      <div class="stat-icon">${s.icon}</div>
      <div class="stat-value">${s.value}</div>
      <div class="stat-label">${s.label}</div>
    </div>`).join("");

  /* Status-Donut */
  const donut = $("#statusDonut");
  let acc = 0;
  const segs = [];
  const legend = [];
  STATUSES.forEach((st) => {
    const n = count((a) => a.status === st);
    if (!n) return;
    const pct = (n / apps.length) * 360;
    segs.push(`${STATUS_META[st].color} ${acc}deg ${acc + pct}deg`);
    acc += pct;
    legend.push({ st, n });
  });
  donut.style.background = segs.length
    ? `conic-gradient(${segs.join(",")})`
    : "conic-gradient(var(--border) 0 360deg)";
  $("#donutTotal").textContent = apps.length;
  $("#statusLegend").innerHTML = legend.length
    ? legend.map((l) => `
        <li>
          <span class="dot" style="background:${STATUS_META[l.st].color}"></span>
          <span>${esc(l.st)}</span>
          <span class="lg-count">${l.n}</span>
        </li>`).join("")
    : `<li class="followup-empty">Noch keine Daten.</li>`;

  renderBars("#locationBars", groupCount(apps, "location", "Ohne Ort"));
  renderBars("#interestBars", groupCount(apps, "interest", "Offen"));

  /* Nachfragen — Modus „Fällig“ oder „In Arbeit“ */
  const hintEl = $("#followupHint");
  if (ui.followupMode === "working") {
    const working = apps
      .filter((a) => a.status === "Nachgefragt")
      .map((a) => ({ a, ref: a.followedUp || a.dateApplied }))
      .sort((x, y) => (daysSince(y.ref) ?? -1) - (daysSince(x.ref) ?? -1));
    if (hintEl) hintEl.textContent = "Nachfrage rausgegangen — Antwort steht noch aus.";
    $("#followupList").innerHTML = working.length
      ? working.map(({ a, ref }) => {
          const d = daysSince(ref);
          const label = a.followedUp
            ? (d != null ? `nachgefragt vor ${d} Tagen` : "nachgefragt")
            : (d != null ? `beworben vor ${d} Tagen` : "");
          return `
        <li>
          <span class="fu-name">${esc(a.name)}</span>
          <span>${esc(a.location || "")}</span>
          <span class="fu-days">${esc(label)}</span>
        </li>`;
        }).join("")
      : `<li class="followup-empty">Keine Nachfragen offen. 🌿</li>`;
  } else {
    const due = apps
      .filter((a) => a.status === "Beworben" && !a.followedUp && daysSince(a.dateApplied) > 28)
      .sort((a, b) => daysSince(b.dateApplied) - daysSince(a.dateApplied));
    if (hintEl) hintEl.textContent = "Beworben & seit über 4 Wochen ohne Antwort oder Nachfrage.";
    $("#followupList").innerHTML = due.length
      ? due.map((a) => `
        <li>
          <span class="fu-name">${esc(a.name)}</span>
          <span>${esc(a.location || "")}</span>
          <span class="fu-days">vor ${daysSince(a.dateApplied)} Tagen</span>
        </li>`).join("")
      : `<li class="followup-empty">Alles im grünen Bereich – nichts zu tun! 🌿</li>`;
  }
}

function groupCount(arr, key, emptyLabel) {
  const map = {};
  arr.forEach((a) => {
    const k = (a[key] || "").trim() || emptyLabel;
    map[k] = (map[k] || 0) + 1;
  });
  return Object.entries(map).sort((a, b) => b[1] - a[1]);
}
function renderBars(sel, pairs) {
  const max = Math.max(1, ...pairs.map((p) => p[1]));
  const el = $(sel);
  if (!pairs.length) {
    el.innerHTML = `<p class="followup-empty">Noch keine Daten.</p>`;
    return;
  }
  el.innerHTML = pairs.map((p) => `
        <div class="bar-row">
          <span class="bar-label" title="${esc(p[0])}">${esc(p[0])}</span>
          <span class="bar-track"><span class="bar-fill" data-w="${(p[1] / max) * 100}" style="width:0"></span></span>
          <span class="bar-val">${p[1]}</span>
        </div>`).join("");
  requestAnimationFrame(() => {
    el.querySelectorAll(".bar-fill").forEach((f) => { f.style.width = f.dataset.w + "%"; });
  });
}

/* ===== Aktive Bewerbungen ===== */
function sortItems(arr, key, dir, statusOrder) {
  const mul = dir === "asc" ? 1 : -1;
  return arr.slice().sort((a, b) => {
    let x, y;
    if (key === "status") {
      x = statusOrder.indexOf(a.status); y = statusOrder.indexOf(b.status);
    } else if (key === "interest") {
      x = INTERESTS.indexOf(a.interest); y = INTERESTS.indexOf(b.interest);
      if (x < 0) x = 99; if (y < 0) y = 99;
    } else if (key === "createdAt") {
      x = a.createdAt || 0; y = b.createdAt || 0;
    } else {
      x = (a[key] || "").toLowerCase(); y = (b[key] || "").toLowerCase();
    }
    if (x < y) return -1 * mul;
    if (x > y) return 1 * mul;
    return 0;
  });
}

function renderActive() {
  let arr = toArray(applications);
  const q = ui.activeSearch.toLowerCase();
  if (q) {
    arr = arr.filter((a) => ["name", "location", "address", "notes", "website", "contact"]
      .some((k) => (a[k] || "").toLowerCase().includes(q)));
  }
  if (ui.activeStatus) arr = arr.filter((a) => a.status === ui.activeStatus);
  arr = sortItems(arr, ui.activeSort, ui.activeDir, STATUSES);

  const grid = $("#activeGrid");
  const total = Object.keys(applications).length;
  $("#activeEmpty").hidden = total > 0;
  if (total === 0) {
    grid.innerHTML = "";
    $("#activeEmpty").innerHTML = `
      <span class="empty-emoji">📭</span>
      <p>Noch keine Bewerbungen erfasst.</p>
      <button class="btn btn-primary" id="seedBtn" style="margin-top:14px">
        📥 Excel-Startdaten laden (${SEED_APPLICATIONS.length} Firmen)
      </button>`;
    $("#seedBtn").onclick = () => runSeed(false);
    return;
  }
  grid.innerHTML = arr.map(activeCard).join("")
    || `<p class="followup-empty">Keine Treffer für deine Filter.</p>`;
}

function activeCard(a) {
  const meta = STATUS_META[a.status] || STATUS_META["Beworben"];
  const due = a.status === "Beworben" && !a.followedUp && daysSince(a.dateApplied) > 28;
  const info = [];
  if (a.location) info.push(`<span class="badge badge-loc">📍 ${esc(a.location)}</span>`);
  if (a.interest) info.push(`<span class="badge badge-interest">⭐ ${esc(a.interest)}</span>`);
  if (a.dateApplied) info.push(`<span>📅 Beworben am ${esc(fmtDate(a.dateApplied))}</span>`);
  if (a.followedUp) info.push(`<span>🔔 Nachgefragt am ${esc(fmtDate(a.followedUp))}</span>`);
  if (a.contact) info.push(`<span>👤 ${esc(a.contact)}</span>`);
  if (a.address) info.push(`<span>🏠 ${esc(a.address)}</span>`);
  if (a.website) info.push(
    `<a href="${esc(normalizeUrl(a.website))}" target="_blank" rel="noopener" title="${esc(a.website)}">🔗 Stellenanzeige</a>`);
  if (a.result) info.push(`<span>🏁 ${esc(a.result)}</span>`);
  if (a.notes) info.push(`<span class="row-notes" title="${esc(a.notes)}">📝 ${esc(a.notes)}</span>`);

  return `
    <article class="app-row" data-id="${a.id}" style="--card-color:${meta.color}">
      <div class="row-main">
        <div class="row-head">
          <span class="row-name">${esc(a.name)}</span>
          ${due ? `<span class="card-flag">⏰ Nachfragen fällig</span>` : ""}
          <button class="status-badge" data-act="status" style="background:${meta.color}">
            ${meta.emoji} ${esc(a.status)}
          </button>
        </div>
        ${info.length ? `<div class="row-meta">${info.join("")}</div>` : ""}
      </div>
      <div class="row-actions">
        <button class="mini-btn" data-act="edit" title="Bearbeiten">✏️</button>
        <button class="mini-btn danger" data-act="del" title="Löschen">🗑️</button>
      </div>
    </article>`;
}

/* ===== Export: Bewerbungsbemühungen als Excel-Tabelle ===== */
function exportActiveXls() {
  const apps = toArray(applications).sort((a, b) => {
    const ax = a.dateApplied || "", bx = b.dateApplied || "";
    if (ax !== bx) return ax < bx ? -1 : 1;
    return (a.name || "").toLowerCase() < (b.name || "").toLowerCase() ? -1 : 1;
  });
  if (!apps.length) {
    toast("Keine Bewerbungen zum Exportieren vorhanden.", "info");
    return;
  }

  const cols = [
    { label: "Unternehmen",             key: "name",        w: 170 },
    { label: "Status",                  key: "status",      w: 140 },
    { label: "Interesse",               key: "interest",    w: 95  },
    { label: "Standort",                key: "location",    w: 120 },
    { label: "Adresse",                 key: "address",     w: 210 },
    { label: "Kontakt",                 key: "contact",     w: 160 },
    { label: "Website / Stellenanzeige", key: "website",    w: 230 },
    { label: "Datum Bewerbung",         key: "dateApplied", w: 115, date: true },
    { label: "Nachgefragt am",          key: "followedUp",  w: 115, date: true },
    { label: "Ergebnis",                key: "result",      w: 170 },
    { label: "Notizen",                 key: "notes",       w: 300 }
  ];

  const cellTxt = (v) => esc(v).replace(/\r?\n/g, '<br style="mso-data-placement:same-cell"/>');
  const now = new Date();
  const stamp = `${String(now.getDate()).padStart(2, "0")}.${String(now.getMonth() + 1).padStart(2, "0")}.${now.getFullYear()}`;
  const fileStamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;

  const colGroup = `<colgroup>${cols.map((c) => `<col style="width:${c.w}px"/>`).join("")}</colgroup>`;
  const titleRow = `<tr><td colspan="${cols.length}" style="padding:11px 10px;background:#1f2138;color:#ffffff;`
    + `font-size:15px;font-weight:700;border:1px solid #1f2138;">`
    + `Bewerbungsbem&uuml;hungen &nbsp;&middot;&nbsp; Stand ${stamp} &nbsp;&middot;&nbsp; ${apps.length} Firmen</td></tr>`;
  const headRow = "<tr>" + cols.map((c) =>
    `<th style="border:1px solid #5b3fd4;padding:8px 9px;background:#7c5cff;color:#ffffff;`
    + `font-weight:700;text-align:left;">${esc(c.label)}</th>`).join("") + "</tr>";

  const bodyRows = apps.map((a, i) => {
    const stripe = i % 2 ? "#f4f5fb" : "#ffffff";
    const tds = cols.map((c) => {
      let value = a[c.key] || "";
      if (c.date) value = fmtDate(value);
      if (c.key === "status") {
        return `<td style="border:1px solid #c9cbe0;padding:6px 9px;vertical-align:top;`
          + `background:${statusColorHex(a.status)};color:#ffffff;font-weight:700;">${cellTxt(value) || "&nbsp;"}</td>`;
      }
      const content = c.key === "website" && value
        ? `<a href="${esc(normalizeUrl(value))}">${cellTxt(value)}</a>`
        : (cellTxt(value) || "&nbsp;");
      return `<td style="border:1px solid #c9cbe0;padding:6px 9px;vertical-align:top;background:${stripe};">${content}</td>`;
    }).join("");
    return `<tr>${tds}</tr>`;
  }).join("");

  const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" `
    + `xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">`
    + `<head><meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8"/>`
    + `<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>`
    + `<x:Name>Bewerbungsbem&uuml;hungen</x:Name>`
    + `<x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>`
    + `</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]--></head>`
    + `<body><table border="0" cellspacing="0" cellpadding="0" `
    + `style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:11px;color:#1f2138;">`
    + `${colGroup}${titleRow}${headRow}${bodyRows}</table></body></html>`;

  const blob = new Blob(["﻿" + html], { type: "application/vnd.ms-excel;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `Bewerbungsbemuehungen_${fileStamp}.xls`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`${apps.length} Bewerbungen exportiert 📊`, "success");
}

/* ===== Pipeline ===== */
function renderPipeline() {
  let arr = toArray(pipeline);
  const q = ui.pipeSearch.toLowerCase();
  if (q) {
    arr = arr.filter((a) => ["name", "address", "notes"]
      .some((k) => (a[k] || "").toLowerCase().includes(q)));
  }
  arr = sortItems(arr, ui.pipeSort, ui.pipeDir, PIPELINE_STATUSES);

  const grid = $("#pipelineGrid");
  const total = Object.keys(pipeline).length;
  $("#pipelineEmpty").hidden = total > 0;
  if (total === 0) { grid.innerHTML = ""; return; }
  grid.innerHTML = arr.map(pipeCard).join("")
    || `<p class="followup-empty">Keine Treffer für deine Suche.</p>`;
}

function pipeCard(a) {
  const meta = PIPELINE_META[a.status] || PIPELINE_META["Neu"];
  const info = [];
  if (a.interest) info.push(`<span class="badge badge-interest">⭐ ${esc(a.interest)}</span>`);
  if (a.deadline) info.push(`<span>⏳ Bewerbung bis ${esc(fmtDate(a.deadline))}</span>`);
  if (a.address) info.push(`<span>📌 ${esc(a.address)}</span>`);
  if (a.notes) info.push(`<span class="row-notes" title="${esc(a.notes)}">📝 ${esc(a.notes)}</span>`);
  return `
    <article class="app-row" data-id="${a.id}" style="--card-color:${meta.color}">
      <div class="row-main">
        <div class="row-head">
          <span class="row-name">${esc(a.name)}</span>
          <button class="status-badge" data-act="status" style="background:${meta.color}">
            ${meta.emoji} ${esc(a.status)}
          </button>
        </div>
        ${info.length ? `<div class="row-meta">${info.join("")}</div>` : ""}
      </div>
      <div class="row-actions">
        <button class="mini-btn" data-act="promote" title="In Aktive Bewerbungen übernehmen">→</button>
        <button class="mini-btn" data-act="edit" title="Bearbeiten">✏️</button>
        <button class="mini-btn danger" data-act="del" title="Löschen">🗑️</button>
      </div>
    </article>`;
}

/* ===== Modal ===== */
function openModal(type, id) {
  modalCtx = { type, id: id || null };
  const fields = type === "pipeline" ? PIPE_FIELDS : APP_FIELDS;
  const data = id ? (type === "pipeline" ? pipeline[id] : applications[id]) : {};
  $("#modalTitle").textContent = (id ? "Firma bearbeiten" : "Firma hinzufügen")
    + (type === "pipeline" ? " · Pipeline" : "");

  const locs = [...new Set(toArray(applications).map((a) => a.location).filter(Boolean))].sort();
  $("#formFields").innerHTML = fields.map((f) => fieldHtml(f, data)).join("")
    + `<datalist id="locList">${locs.map((l) => `<option value="${esc(l)}">`).join("")}</datalist>`;

  fields.filter((f) => f.showIf).forEach((f) => {
    const ctrl = $(`#formFields [name="${f.showIf.field}"]`);
    const wrap = $(`#formFields [data-field="${f.key}"]`);
    if (!ctrl || !wrap) return;
    ctrl.addEventListener("change", () => {
      wrap.classList.toggle("is-hidden", ctrl.value !== f.showIf.value);
    });
  });

  $("#modalOverlay").hidden = false;
  setTimeout(() => $("#formFields input, #formFields select")?.focus?.(), 50);
}

function fieldHtml(f, data) {
  const val = data[f.key] != null ? data[f.key] : "";
  let cls = "field" + (f.full || f.type === "textarea" ? " full" : "");
  if (f.showIf && data[f.showIf.field] !== f.showIf.value) cls += " is-hidden";
  let input;
  if (f.type === "select") {
    input = `<select name="${f.key}">` + f.options.map((o) =>
      `<option value="${esc(o)}"${o === val ? " selected" : ""}>${esc(o || "— offen —")}</option>`
    ).join("") + `</select>`;
  } else if (f.type === "textarea") {
    input = `<textarea name="${f.key}" rows="3">${esc(val)}</textarea>`;
  } else {
    input = `<input type="${f.type}" name="${f.key}"${f.list ? ` list="${f.list}"` : ""} value="${esc(val)}" />`;
  }
  return `<div class="${cls}" data-field="${f.key}">
    <label>${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ""}</label>
    ${input}
  </div>`;
}

function closeModal() { $("#modalOverlay").hidden = true; modalCtx = null; }

function saveModal(e) {
  e.preventDefault();
  if (!modalCtx) return;
  const form = $("#entryForm");
  const fields = modalCtx.type === "pipeline" ? PIPE_FIELDS : APP_FIELDS;
  const obj = {};
  fields.forEach((f) => { obj[f.key] = (form.elements[f.key].value || "").trim(); });
  fields.forEach((f) => {
    if (f.showIf && obj[f.showIf.field] !== f.showIf.value) obj[f.key] = "";
  });

  if (!obj.name) {
    form.querySelector('[data-field="name"]').classList.add("invalid");
    toast("Bitte einen Unternehmensnamen angeben.", "error");
    return;
  }
  const ref = modalCtx.type === "pipeline" ? pipeRef : appsRef;
  const isEdit = !!modalCtx.id;
  let writePromise;
  if (isEdit) {
    writePromise = ref.child(modalCtx.id).update(obj);
  } else {
    obj.createdAt = Date.now();
    obj.order = Date.now();
    writePromise = ref.push(obj);
  }

  /* Modal sofort schließen: Die Realtime DB puffert den Schreibvorgang lokal
     und synchronisiert ihn später – auch offline geht so nichts verloren. */
  closeModal();
  const okMsg = isEdit ? "Änderungen gespeichert." : `„${obj.name}" hinzugefügt.`;
  toast(
    isOnline ? okMsg : "Offline gespeichert – wird synchronisiert, sobald du wieder online bist.",
    isOnline ? "success" : "info"
  );
  writePromise.catch((err) => toast("Fehler beim Speichern: " + err.message, "error"));
}

/* ===== Confirm-Dialog ===== */
function askConfirm(title, text, cb, okLabel = "Löschen", okVariant = "danger") {
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  const ok = $("#confirmOk");
  ok.textContent = okLabel;
  ok.className = "btn " + (okVariant === "danger" ? "btn-danger" : "btn-primary");
  confirmCb = cb;
  $("#confirmOverlay").hidden = false;
}
function closeConfirm() { $("#confirmOverlay").hidden = true; confirmCb = null; }

/* ===== Status-Popover ===== */
function openStatusPopover(badge, type, id, current) {
  const pop = $("#statusPopover");
  const list = type === "pipeline" ? PIPELINE_STATUSES : STATUSES;
  const metaMap = type === "pipeline" ? PIPELINE_META : STATUS_META;
  pop.innerHTML = list.map((st) => `
    <button data-status="${esc(st)}" class="${st === current ? "current" : ""}">
      <span class="dot" style="background:${metaMap[st].color}"></span>
      ${metaMap[st].emoji} ${esc(st)}
    </button>`).join("");

  const r = badge.getBoundingClientRect();
  pop.hidden = false;
  let left = r.left + window.scrollX;
  let top = r.bottom + window.scrollY + 6;
  if (left + pop.offsetWidth > window.scrollX + document.documentElement.clientWidth - 8) {
    left = window.scrollX + document.documentElement.clientWidth - pop.offsetWidth - 8;
  }
  if (r.bottom + pop.offsetHeight + 6 > document.documentElement.clientHeight
      && r.top - pop.offsetHeight - 6 > 0) {
    top = r.top + window.scrollY - pop.offsetHeight - 6;
  }
  pop.style.left = left + "px";
  pop.style.top = top + "px";

  pop.querySelectorAll("button").forEach((b) => {
    b.onclick = () => {
      const newStatus = b.dataset.status;
      pop.hidden = true;
      if (newStatus === current) return;
      const ref = type === "pipeline" ? pipeRef : appsRef;
      ref.child(id).update({ status: newStatus })
        .then(() => toast(`Status → ${newStatus}`, "success"))
        .catch((err) => toast("Fehler: " + err.message, "error"));
    };
  });
}
function hidePopover() { $("#statusPopover").hidden = true; }

/* ===== Pipeline → Aktive ===== */
function promote(id) {
  const p = pipeline[id];
  if (!p) return;
  askConfirm("In Aktive Bewerbungen übernehmen?",
    `„${p.name}" wird als aktive Bewerbung angelegt und aus der Pipeline entfernt.`,
    () => {
      const newApp = {
        name: p.name || "", interest: p.interest || "", website: "",
        location: "", address: p.address || "", dateApplied: "",
        followedUp: "", status: "Beworben", result: "",
        contact: "", notes: p.notes || "",
        createdAt: Date.now(), order: Date.now()
      };
      const key = appsRef.push().key;
      db.ref().update({
        ["applications/" + key]: newApp,
        ["pipeline/" + id]: null
      })
        .then(() => toast(`„${p.name}" ist jetzt aktiv 🚀`, "success"))
        .catch((err) => toast("Fehler: " + err.message, "error"));
    },
    "Übernehmen", "primary");
}

/* ===== Card-Events (Delegation) ===== */
function bindGrid(gridSel, type) {
  $(gridSel).addEventListener("click", (e) => {
    const btn = e.target.closest("[data-act]");
    const card = e.target.closest(".app-row");
    if (!btn || !card) return;
    const id = card.dataset.id;
    const store = type === "pipeline" ? pipeline : applications;
    const item = store[id];
    if (!item) return;
    const act = btn.dataset.act;
    if (act === "edit") openModal(type, id);
    else if (act === "del") {
      askConfirm("Wirklich löschen?", `„${item.name}" wird dauerhaft entfernt.`, () => {
        (type === "pipeline" ? pipeRef : appsRef).child(id).remove()
          .then(() => toast("Gelöscht.", "info"))
          .catch((err) => toast("Fehler: " + err.message, "error"));
      });
    } else if (act === "status") {
      e.stopPropagation();
      openStatusPopover(btn, type, id, item.status);
    } else if (act === "promote") promote(id);
  });
}

/* ===== Init ===== */
function init() {
  /* Theme */
  const savedTheme = localStorage.getItem("nbt-theme") || "light";
  document.documentElement.setAttribute("data-theme", savedTheme);
  $("#themeToggle").textContent = savedTheme === "dark" ? "☀️" : "🌙";
  $("#themeToggle").onclick = () => {
    const next = document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("nbt-theme", next);
    $("#themeToggle").textContent = next === "dark" ? "☀️" : "🌙";
  };

  /* Tabs */
  document.querySelectorAll(".tab").forEach((t) => {
    t.onclick = () => {
      document.querySelectorAll(".tab").forEach((x) => x.classList.remove("is-active"));
      document.querySelectorAll(".tab-panel").forEach((x) => x.classList.remove("is-active"));
      t.classList.add("is-active");
      $("#tab-" + t.dataset.tab).classList.add("is-active");
    };
  });

  /* Status-Filter befüllen */
  STATUSES.forEach((st) => {
    const o = document.createElement("option");
    o.value = st; o.textContent = st;
    $("#activeStatusFilter").appendChild(o);
  });

  /* Dashboard: Nachfragen-Toggle */
  $("#followupMode").onclick = (e) => {
    const btn = e.target.closest("button[data-mode]");
    if (!btn) return;
    const mode = btn.dataset.mode;
    if (mode === ui.followupMode) return;
    ui.followupMode = mode;
    $("#followupMode").querySelectorAll("button").forEach((b) => {
      b.classList.toggle("is-active", b.dataset.mode === mode);
    });
    renderDashboard();
  };

  /* Toolbar: Aktive */
  $("#activeSearch").oninput = (e) => { ui.activeSearch = e.target.value; renderActive(); };
  $("#activeStatusFilter").onchange = (e) => { ui.activeStatus = e.target.value; renderActive(); };
  $("#activeSort").onchange = (e) => { ui.activeSort = e.target.value; renderActive(); };
  $("#activeSortDir").onclick = (e) => {
    ui.activeDir = ui.activeDir === "asc" ? "desc" : "asc";
    e.currentTarget.textContent = ui.activeDir === "asc" ? "↑" : "↓";
    renderActive();
  };
  $("#addActiveBtn").onclick = () => openModal("active");
  $("#exportActiveBtn").onclick = exportActiveXls;

  /* Toolbar: Pipeline */
  $("#pipelineSearch").oninput = (e) => { ui.pipeSearch = e.target.value; renderPipeline(); };
  $("#pipelineSort").onchange = (e) => { ui.pipeSort = e.target.value; renderPipeline(); };
  $("#pipelineSortDir").onclick = (e) => {
    ui.pipeDir = ui.pipeDir === "asc" ? "desc" : "asc";
    e.currentTarget.textContent = ui.pipeDir === "asc" ? "↑" : "↓";
    renderPipeline();
  };
  $("#addPipelineBtn").onclick = () => openModal("pipeline");

  /* Modal */
  $("#entryForm").onsubmit = saveModal;
  $("#modalClose").onclick = closeModal;
  $("#modalCancel").onclick = closeModal;
  $("#modalOverlay").onclick = (e) => { if (e.target.id === "modalOverlay") closeModal(); };

  /* Confirm */
  $("#confirmCancel").onclick = closeConfirm;
  $("#confirmOk").onclick = () => { const cb = confirmCb; closeConfirm(); if (cb) cb(); };
  $("#confirmOverlay").onclick = (e) => { if (e.target.id === "confirmOverlay") closeConfirm(); };

  /* Grids */
  bindGrid("#activeGrid", "active");
  bindGrid("#pipelineGrid", "pipeline");

  /* Popover schließen */
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#statusPopover") && !e.target.closest('[data-act="status"]')) hidePopover();
  });
  window.addEventListener("resize", hidePopover);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { closeModal(); closeConfirm(); hidePopover(); }
  });

  initFirebase();
}

document.addEventListener("DOMContentLoaded", init);

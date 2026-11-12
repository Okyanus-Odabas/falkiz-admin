import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  getDocs,
  getCountFromServer,
  setDoc,
  updateDoc,
  deleteDoc,
  addDoc,
  collection,
  collectionGroup,
  query,
  where,
  orderBy,
  limit,
  onSnapshot,
  increment,
  serverTimestamp,
  Timestamp
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAU--VyjzOHDWiP68gLHylPJfF9k_rp7CY",
  authDomain: "falciteyzefirebase.firebaseapp.com",
  projectId: "falciteyzefirebase",
  storageBucket: "falciteyzefirebase.firebasestorage.app",
  messagingSenderId: "303887740519",
  appId: "1:303887740519:android:c55829da892129d7a88585"
};

const ADMIN_EMAIL_DOMAIN = "falkiz-admin.local";
const DEDICATED_ADMIN_UID = "J3tuyomABfOJ8cBfYI5yYosrGLy2";
const DEFAULT_AVATAR =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><rect width="80" height="80" fill="#2A1B10"/><circle cx="40" cy="31" r="14" fill="#E6C06A"/><path d="M16 68c4-13 15-20 24-20s20 7 24 20" fill="#E6C06A"/></svg>`
  );

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Global State
let currentAdminUser = null;
let selectedUserId = null;
let selectedOwnerData = null;
let selectedUserFortunes = [];

let unsubSelectedOwner = null;
let unsubSupportTickets = null;
let unsubTicketOwnerBalance = null;
let unsubGlobalChat = null;
let unsubLiveFortunes = null;

let allSupportTickets = [];
let currentTicketFilter = "open";
let activeTicketId = null;

// Live Fortunes & Smart User Activity Caches
let liveFortunesFeed = [];
let currentLiveFortuneType = "all";
let currentUserDirMode = "active";
let cachedActiveUsers = [];
const latestFortuneByOwner = new Map();
const resolvedNameCache = new Map();
const ownerDocCache = new Map();

// Utility Helpers
const $ = (id) => document.getElementById(id);

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function showToast(msg, isError = false) {
  const stack = $("toastStack");
  const el = document.createElement("div");
  el.className = "toast-item" + (isError ? " err" : "");
  el.textContent = msg;
  stack.appendChild(el);
  setTimeout(() => {
    el.remove();
  }, 3400);
}

function toMs(val) {
  if (!val) return 0;
  if (typeof val === "number") return val < 1e12 ? val * 1000 : val;
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  if (typeof val === "string") {
    const asNum = Number(val);
    if (!Number.isNaN(asNum) && asNum > 1e9) return asNum < 1e12 ? asNum * 1000 : asNum;
    const parsed = Date.parse(val);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

function formatTs(val) {
  const ms = toMs(val);
  if (!ms) return "—";
  return new Date(ms).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatRelative(val) {
  const ms = toMs(val);
  if (!ms) return "—";
  const diffSec = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (diffSec < 45) return "Az önce";
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} dk önce`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} sa önce`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} gün önce`;
  return new Date(ms).toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function formatNumberTR(n) {
  return Number(n || 0).toLocaleString("tr-TR");
}

function copyText(txt, label = "Kopyalandı") {
  navigator.clipboard?.writeText(txt);
  showToast(`${label}: ${txt}`);
}

function normalizeAdminIdentifier(raw) {
  const clean = raw.trim();
  if (clean.includes("@")) return clean;
  return `${clean.toLowerCase()}@${ADMIN_EMAIL_DOMAIN}`;
}

function toTitleCaseTR(str) {
  return String(str || "")
    .trim()
    .split(/\s+/)
    .map((w) => (w ? w[0].toLocaleUpperCase("tr-TR") + w.slice(1).toLocaleLowerCase("tr-TR") : ""))
    .join(" ");
}

function categoryName(cat) {
  switch (cat) {
    case "jeton": return "Eksik Jeton / Ödeme";
    case "bug": return "Hata / Bug";
    case "fortune": return "Fal Sorunu";
    default: return cat || "Genel / Diğer";
  }
}

function fortuneTypeLabel(type) {
  const map = {
    kahve: "☕ Kahve Falı",
    el: "✋ El Falı",
    tarot: "🃏 Tarot",
    ruya: "🌙 Rüya Tabiri",
    burc: "♈ Günlük Burç",
    sinastri: "❤️ Aşk Uyumu",
    cin: "🪔 Sihirli Lamba",
    yuz: "🪞 Yüz Falı",
    aura: "✨ Aura Okuma",
    ayak: "🦶 Ayak Falı",
    yildizname: "☀️ Yıldızname"
  };
  return map[type] || `🔮 ${type || "Fal"}`;
}

function extractUserQuestionFromFortune(f) {
  if (f.question) return String(f.question);
  if (Array.isArray(f.messages)) {
    const userMsg = f.messages.find((m) => m && m.sender === "user" && m.message);
    if (userMsg) return String(userMsg.message);
  }
  return "";
}

function cleanFallbackNameFromFortune(f) {
  if (!f?.userName) return "";
  const raw = String(f.userName).trim();
  if (!raw) return "";
  if (f.type === "sinastri" && raw.includes("&")) {
    const parts = raw.split("&").map((s) => s.trim()).filter(Boolean);
    return parts[parts.length - 1] || parts[0] || raw;
  }
  return raw;
}

function resolveDisplayName(uid, ownerData) {
  if (ownerData?.userName && String(ownerData.userName).trim()) {
    return String(ownerData.userName).trim();
  }
  if (ownerData?._matchedSubName && String(ownerData._matchedSubName).trim()) {
    return String(ownerData._matchedSubName).trim();
  }
  if (resolvedNameCache.has(uid)) {
    return resolvedNameCache.get(uid);
  }
  const lf = latestFortuneByOwner.get(uid);
  const fName = cleanFallbackNameFromFortune(lf);
  if (fName) return fName;
  if (ownerData?.email) return String(ownerData.email).split("@")[0];
  return uid ? `Kullanıcı (${uid.slice(0, 8)}…)` : "Falkız Kullanıcısı";
}

function computeBestActivity(uid, ownerData = {}, extraSignals = {}) {
  const candidates = [];

  const lf = extraSignals.latestFortune || latestFortuneByOwner.get(uid);
  if (lf) {
    const fMs = toMs(lf.timestamp || lf.createdAt);
    if (fMs) {
      candidates.push({
        ms: fMs,
        label: fortuneTypeLabel(lf.type || "kahve"),
        isSpecific: true
      });
    }
  }

  const adMs = Math.max(toMs(ownerData.lastAdWatchTime), toMs(extraSignals.adMs));
  if (adMs) candidates.push({ ms: adMs, label: "📺 Reklam İzledi", isSpecific: true });

  const spinMs = toMs(ownerData.lastSpinTime);
  if (spinMs) candidates.push({ ms: spinMs, label: "🎡 Çark Çevirdi", isSpecific: true });

  const cookieMs = toMs(ownerData.lastFreeCookieTime);
  if (cookieMs) candidates.push({ ms: cookieMs, label: "🥠 Şans Kurabiyesi", isSpecific: true });

  if (extraSignals.chatMs) {
    candidates.push({ ms: toMs(extraSignals.chatMs), label: "💬 Genel Sohbet", isSpecific: true });
  }

  if (extraSignals.ticketMs) {
    candidates.push({ ms: toMs(extraSignals.ticketMs), label: "🎧 Destek Talebi", isSpecific: true });
  }

  const seenMs = toMs(ownerData.lastSeenAt);
  const createdMs = toMs(ownerData.createdAt);

  if (seenMs) {
    const isJustRegistered = createdMs && Math.abs(seenMs - createdMs) < 5 * 60 * 1000;
    candidates.push({
      ms: seenMs,
      label: isJustRegistered ? "🆕 Yeni Kayıt" : "📱 Uygulamaya Girdi",
      isSpecific: false
    });
  }

  if (createdMs) {
    candidates.push({ ms: createdMs, label: "🆕 Yeni Kayıt", isSpecific: false });
  }

  if (!candidates.length) {
    return { ms: 0, label: "Kayıtlı Hesap" };
  }

  candidates.sort((a, b) => b.ms - a.ms);
  const top = candidates[0];

  // If top signal is generic "Uygulamaya Girdi" but a specific action (fortune/ad/spin/chat) happened within 12 minutes, show that action label!
  if (!top.isSpecific) {
    const nearSpecific = candidates.find((c) => c.isSpecific && top.ms - c.ms <= 12 * 60 * 1000);
    if (nearSpecific) {
      return { ms: top.ms, label: nearSpecific.label };
    }
  }

  return { ms: top.ms, label: top.label };
}

// ============================================================================
// 1. AUTHENTICATION & ADMIN GUARD
// ============================================================================
$("loginForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const idVal = $("loginIdInput").value;
  const passVal = $("loginPassInput").value;
  const remember = $("rememberMeCheck").checked;
  const btn = $("loginSubmitBtn");
  const errBox = $("loginErrorBox");

  errBox.classList.add("hidden");
  btn.disabled = true;
  btn.textContent = "Doğrulanıyor…";

  try {
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence);
    const email = normalizeAdminIdentifier(idVal);
    await signInWithEmailAndPassword(auth, email, passVal);
  } catch (err) {
    errBox.textContent = "Yönetici ID veya şifre hatalı. Lütfen kontrol edip tekrar deneyin.";
    errBox.classList.remove("hidden");
  } finally {
    btn.disabled = false;
    btn.textContent = "Panele Giriş Yap →";
  }
});

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    currentAdminUser = null;
    cleanupRealtimeListeners();
    $("appShell").classList.add("hidden");
    $("loginGate").classList.remove("hidden");
    return;
  }

  let allowed = user.uid === DEDICATED_ADMIN_UID;
  if (!allowed) {
    try {
      const snap = await getDoc(doc(db, "owners", user.uid));
      const badges = snap.exists() ? snap.data().badges : [];
      if (Array.isArray(badges) && (badges.includes("developer") || badges.includes("admin"))) {
        allowed = true;
      }
    } catch (_) {}
  }

  if (!allowed) {
    await signOut(auth);
    const errBox = $("loginErrorBox");
    errBox.textContent = "Bu hesap yönetici yetkisine sahip değil.";
    errBox.classList.remove("hidden");
    return;
  }

  currentAdminUser = user;
  const shortAdmin = (user.email || "okyanus").split("@")[0];
  $("adminIdentityLabel").textContent = shortAdmin;

  setDoc(
    doc(db, "owners", user.uid),
    {
      ownerId: user.uid,
      email: user.email || "",
      badges: ["developer", "admin"],
      lastSeenAt: serverTimestamp()
    },
    { merge: true }
  ).catch(() => {});

  $("loginGate").classList.add("hidden");
  $("appShell").classList.remove("hidden");

  bootAdminWorkspace();
});

$("logoutBtn").addEventListener("click", () => signOut(auth));

$("openPasswordModalBtn").addEventListener("click", () => {
  $("passwordModal").classList.remove("hidden");
});
$("closePasswordModalBtn").addEventListener("click", () => {
  $("passwordModal").classList.add("hidden");
});

$("changePasswordForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!currentAdminUser?.email) return;
  const curPass = $("curPassInput").value;
  const newPass = $("newPassInput").value;
  try {
    const cred = EmailAuthProvider.credential(currentAdminUser.email, curPass);
    await reauthenticateWithCredential(currentAdminUser, cred);
    await updatePassword(currentAdminUser, newPass);
    $("changePasswordForm").reset();
    $("passwordModal").classList.add("hidden");
    showToast("Yönetici şifreniz başarıyla güncellendi! 🔐");
  } catch (err) {
    showToast("Mevcut şifre hatalı veya oturum yenilenmeli.", true);
  }
});

// ============================================================================
// 2. NAVIGATION & BOOTSTRAP
// ============================================================================
function switchSection(sectionKey) {
  document.querySelectorAll(".nav-item").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.section === sectionKey);
  });
  document.querySelectorAll(".panel-section").forEach((sec) => {
    sec.classList.toggle("hidden", sec.id !== `section-${sectionKey}`);
  });

  if (sectionKey === "chat" && !unsubGlobalChat) {
    startGlobalChatListener();
  }
  if (sectionKey === "promos") {
    loadPromoCodesAndGlobalPurchases();
  }
}

function switchInspectorTab(tabKey) {
  document.querySelectorAll("#inspectorTabs .subtab").forEach((b) =>
    b.classList.toggle("active", b.dataset.itab === tabKey)
  );
  document.querySelectorAll(".itab-pane").forEach((p) =>
    p.classList.toggle("hidden", p.id !== `itab-${tabKey}`)
  );
}

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.goto));
});

$("kpiCardSupport").addEventListener("click", () => switchSection("support"));
$("kpiCardUsers").addEventListener("click", () => {
  switchSection("users");
  setUserDirectoryMode("active");
});
$("kpiCardFortunes").addEventListener("click", () => switchSection("fortunes"));
$("kpiCardPromos").addEventListener("click", () => switchSection("promos"));

$("refreshAllBtn").addEventListener("click", async () => {
  refreshDashboardStats();
  await loadUserDirectory(currentUserDirMode);
  if (selectedUserId) loadSelectedUserExtraTabs(selectedUserId);
  showToast("Tüm canlı veriler yenilendi ↻");
});

function cleanupRealtimeListeners() {
  if (unsubSelectedOwner) { unsubSelectedOwner(); unsubSelectedOwner = null; }
  if (unsubSupportTickets) { unsubSupportTickets(); unsubSupportTickets = null; }
  if (unsubTicketOwnerBalance) { unsubTicketOwnerBalance(); unsubTicketOwnerBalance = null; }
  if (unsubGlobalChat) { unsubGlobalChat(); unsubGlobalChat = null; }
  if (unsubLiveFortunes) { unsubLiveFortunes(); unsubLiveFortunes = null; }
}

function bootAdminWorkspace() {
  startLiveFortunesRealtime();
  startSupportTicketsRealtime();
  refreshDashboardStats();
  loadUserDirectory("active");
}

// ============================================================================
// 3. REAL-TIME LIVE FORTUNES STREAM (CANLI FAL AKIŞI & DASHBOARD WIDGET)
// ============================================================================
function startLiveFortunesRealtime() {
  if (unsubLiveFortunes) unsubLiveFortunes();

  const q = query(collection(db, "fortunes"), orderBy("timestamp", "desc"), limit(80));
  unsubLiveFortunes = onSnapshot(
    q,
    (snap) => {
      liveFortunesFeed = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

      // Populate latest fortune & fallback name caches per ownerId
      liveFortunesFeed.forEach((f) => {
        if (!f.ownerId || f.ownerId === DEDICATED_ADMIN_UID) return;
        const prev = latestFortuneByOwner.get(f.ownerId);
        if (!prev || toMs(f.timestamp) >= toMs(prev.timestamp)) {
          latestFortuneByOwner.set(f.ownerId, f);
        }
        const cleanName = cleanFallbackNameFromFortune(f);
        if (cleanName && !resolvedNameCache.has(f.ownerId)) {
          resolvedNameCache.set(f.ownerId, cleanName);
        }
      });

      renderDashboardLiveFortunes();
      renderLiveFortunesSection();

      // If user inspector is open on someone who just got a fortune, refresh header activity line
      if (selectedUserId && selectedOwnerData) {
        updateInspectorActivityLine(selectedUserId, selectedOwnerData);
      }
    },
    (err) => {
      console.error("Live fortunes listener error:", err);
      $("dashLiveFortunes").innerHTML = `<div class="tiny-muted">Fal akışı alınamadı.</div>`;
    }
  );
}

function renderDashboardLiveFortunes() {
  const box = $("dashLiveFortunes");
  if (!box) return;
  const top = liveFortunesFeed.slice(0, 8);

  if (!top.length) {
    box.innerHTML = `<div class="tiny-muted">Henüz fal kaydı bulunamadı.</div>`;
    return;
  }

  box.innerHTML = top
    .map((f, idx) => {
      const uName = f.userName || resolveDisplayName(f.ownerId, ownerDocCache.get(f.ownerId));
      const isProc = f.status === "processing";
      const statusHtml = isProc
        ? `<span class="pill pill-gold">⏳ Yorumlanıyor</span>`
        : `<span class="pill pill-success">✅ Hazır</span>`;
      return `
        <div class="dash-feed-item">
          <div class="dash-feed-main">
            <div class="dash-feed-title">
              <span>${escapeHtml(uName)}</span>
              <span class="pill">${escapeHtml(fortuneTypeLabel(f.type || "kahve"))}</span>
              ${statusHtml}
            </div>
            <div class="dash-feed-sub">
              ${escapeHtml(formatRelative(f.timestamp))} (${escapeHtml(formatTs(f.timestamp))}) · ID: ${escapeHtml((f.ownerId || "").slice(0, 12))}…
            </div>
          </div>
          <div class="dash-feed-right">
            <button class="btn btn-dark btn-xs" data-dash-open-fortune="${idx}" type="button" title="Fal yorumunu oku">📖 Oku</button>
            <button class="btn btn-gold btn-xs" data-dash-jump-owner="${escapeHtml(f.ownerId || "")}" type="button" title="Kullanıcı profilini ve jetonunu aç">👤 Profil</button>
          </div>
        </div>
      `;
    })
    .join("");

  box.querySelectorAll("[data-dash-open-fortune]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = top[Number(btn.dataset.dashOpenFortune)];
      if (f) openFortuneDetailModal(f);
    });
  });

  box.querySelectorAll("[data-dash-jump-owner]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const uid = btn.dataset.dashJumpOwner;
      if (!uid) return;
      switchSection("users");
      await selectUser(uid);
    });
  });
}

document.querySelectorAll("#liveFortuneTypeTabs .chip-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentLiveFortuneType = btn.dataset.lftype;
    document.querySelectorAll("#liveFortuneTypeTabs .chip-tab").forEach((b) =>
      b.classList.toggle("active", b.dataset.lftype === currentLiveFortuneType)
    );
    renderLiveFortunesSection();
  });
});

$("liveFortuneSearchInput").addEventListener("input", () => renderLiveFortunesSection());

function renderLiveFortunesSection() {
  const grid = $("liveFortunesGrid");
  if (!grid) return;

  const q = $("liveFortuneSearchInput").value.trim().toLocaleLowerCase("tr-TR");

  const filtered = liveFortunesFeed.filter((f) => {
    const t = f.type || "kahve";
    if (currentLiveFortuneType !== "all") {
      if (currentLiveFortuneType === "yuz") {
        if (!["yuz", "aura", "ayak"].includes(t)) return false;
      } else if (currentLiveFortuneType === "burc") {
        if (!["burc", "yildizname"].includes(t)) return false;
      } else if (t !== currentLiveFortuneType) {
        return false;
      }
    }
    if (!q) return true;
    const hay = `${f.userName || ""} ${f.ownerId || ""} ${f.comment || ""} ${extractUserQuestionFromFortune(f)}`.toLocaleLowerCase("tr-TR");
    return hay.includes(q);
  });

  $("liveFortunesCountPill").textContent = `${filtered.length} Son Fal (Canlı)`;

  if (!filtered.length) {
    grid.innerHTML = `<div class="card"><div class="tiny-muted">Bu filtreyle eşleşen canlı fal kaydı bulunamadı.</div></div>`;
    return;
  }

  grid.innerHTML = filtered
    .map((f, idx) => {
      const isProc = f.status === "processing";
      const statusBadge = isProc
        ? `<span class="pill pill-gold">⏳ Hazırlanıyor…</span>`
        : `<span class="pill pill-success">✅ Tamamlandı</span>`;

      let costBadge = "";
      if (f.usedFreeCoffee === true) {
        costBadge = `<span class="pill">☕ Ücretsiz Hak</span>`;
      } else if (typeof f.chargedJeton === "number" && f.chargedJeton > 0) {
        costBadge = `<span class="pill pill-gold">🪙 ${f.chargedJeton} Jeton</span>`;
      } else if (f.isVip) {
        costBadge = `<span class="pill pill-gold">👑 VIP</span>`;
      }

      const imgs = Array.isArray(f.imageUrls)
        ? f.imageUrls.filter(Boolean)
        : f.imageUrl
        ? [f.imageUrl]
        : [];

      const userQ = extractUserQuestionFromFortune(f);
      const snippet = (f.comment || "").trim();

      let scoresHtml = "";
      if (f.compatibilityScores && typeof f.compatibilityScores === "object") {
        const sc = f.compatibilityScores;
        scoresHtml = `
          <div class="lf-scores-row">
            ${sc.overall != null ? `<span class="pill pill-gold">❤️ Genel %${escapeHtml(sc.overall)}</span>` : ""}
            ${sc.love != null ? `<span class="pill">Aşk %${escapeHtml(sc.love)}</span>` : ""}
            ${sc.passion != null ? `<span class="pill">Tutku %${escapeHtml(sc.passion)}</span>` : ""}
            ${sc.trust != null ? `<span class="pill">Güven %${escapeHtml(sc.trust)}</span>` : ""}
          </div>`;
      }

      const dispName = f.userName || resolveDisplayName(f.ownerId, ownerDocCache.get(f.ownerId));

      return `
        <div class="live-fortune-card${isProc ? " is-processing" : ""}">
          <div>
            <div class="card-header">
              <div class="row-wrap">
                <span class="lf-user-title" data-lf-user="${escapeHtml(f.ownerId || "")}">${escapeHtml(dispName)}</span>
                <span class="pill">${escapeHtml(fortuneTypeLabel(f.type || "kahve"))}</span>
                ${statusBadge}
                ${costBadge}
              </div>
              <span class="activity-time" title="${escapeHtml(formatTs(f.timestamp))}">${escapeHtml(formatRelative(f.timestamp))}</span>
            </div>

            ${userQ ? `<div class="lf-question-box mt-sm">💬 <strong>Soru / Niyet:</strong> ${escapeHtml(userQ)}</div>` : ""}
            ${scoresHtml ? `<div class="mt-sm">${scoresHtml}</div>` : ""}

            <p class="lf-snippet mt-sm">
              ${escapeHtml(snippet || (isProc ? "Yapay zeka fal yorumunu şu anda oluşturuyor…" : "Yorum metni bulunmuyor."))}
            </p>

            ${
              imgs.length
                ? `<div class="fortune-thumbs">
                    ${imgs
                      .map(
                        (u) =>
                          `<img src="${escapeHtml(u)}" alt="Fal fotoğrafı" loading="lazy" data-lf-img="${escapeHtml(u)}" />`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>

          <div class="lf-footer">
            <div class="row-wrap">
              <button class="btn btn-dark btn-xs" data-lf-read="${idx}" type="button">📖 Tam Yorumu Gör</button>
              <button class="btn btn-gold btn-xs" data-lf-inspect="${escapeHtml(f.ownerId || "")}" type="button">👤 Kullanıcı &amp; Jeton</button>
            </div>
            <span class="tiny-muted" style="cursor:pointer" data-lf-copy="${escapeHtml(f.ownerId || "")}" title="Kopyalamak için tıklayın">
              📋 <code>${escapeHtml((f.ownerId || "—").slice(0, 14))}…</code> · ${escapeHtml(formatTs(f.timestamp))}
            </span>
          </div>
        </div>
      `;
    })
    .join("");

  grid.querySelectorAll("[data-lf-img]").forEach((img) => {
    img.addEventListener("click", () => {
      openDetailModal(
        "Gönderilen Fal Fotoğrafı",
        `<div style="text-align:center"><img src="${escapeHtml(img.dataset.lfImg)}" style="max-width:100%;border-radius:14px;" /></div>`
      );
    });
  });

  grid.querySelectorAll("[data-lf-read]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = filtered[Number(btn.dataset.lfRead)];
      if (f) openFortuneDetailModal(f);
    });
  });

  grid.querySelectorAll("[data-lf-inspect], [data-lf-user]").forEach((el) => {
    el.addEventListener("click", async () => {
      const uid = el.dataset.lfInspect || el.dataset.lfUser;
      if (!uid) return;
      switchSection("users");
      await selectUser(uid);
    });
  });

  grid.querySelectorAll("[data-lf-copy]").forEach((el) => {
    el.addEventListener("click", () => {
      if (el.dataset.lfCopy) copyText(el.dataset.lfCopy, "Owner ID kopyalandı");
    });
  });
}

function openFortuneDetailModal(f) {
  const imgs = Array.isArray(f.imageUrls)
    ? f.imageUrls.filter(Boolean)
    : f.imageUrl
    ? [f.imageUrl]
    : [];

  let scoresBlock = "";
  if (f.compatibilityScores && typeof f.compatibilityScores === "object") {
    const sc = f.compatibilityScores;
    scoresBlock = `
      <div class="row-wrap" style="margin-bottom:12px;">
        ${sc.overall != null ? `<span class="pill pill-gold">Genel Uyum: %${escapeHtml(sc.overall)}</span>` : ""}
        ${sc.love != null ? `<span class="pill">Aşk: %${escapeHtml(sc.love)}</span>` : ""}
        ${sc.passion != null ? `<span class="pill">Tutku: %${escapeHtml(sc.passion)}</span>` : ""}
        ${sc.trust != null ? `<span class="pill">Güven: %${escapeHtml(sc.trust)}</span>` : ""}
        ${sc.communication != null ? `<span class="pill">İletişim: %${escapeHtml(sc.communication)}</span>` : ""}
      </div>`;
  }

  const photosBlock = imgs.length
    ? `<div class="fortune-thumbs" style="margin-bottom:14px;">
        ${imgs
          .map(
            (u) =>
              `<a href="${escapeHtml(u)}" target="_blank" rel="noopener"><img src="${escapeHtml(u)}" style="width:96px;height:96px;" alt="Fotoğraf" /></a>`
          )
          .join("")}
      </div>`
    : "";

  let extraText = "";
  if (Array.isArray(f.messages) && f.messages.length) {
    extraText +=
      "\n\n━━━━━━━━ SOHBET GEÇMİŞİ ━━━━━━━━\n" +
      f.messages
        .map((m) => `${m.sender === "user" ? "🧑 Kullanıcı" : "🧞 Sihirli Lamba"}: ${m.message || ""}`)
        .join("\n\n");
  }
  if (Array.isArray(f.followUps) && f.followUps.length) {
    extraText +=
      "\n\n━━━━━━━━ TAKİP SORULARI ━━━━━━━━\n" +
      f.followUps.map((q) => `❓ Soru: ${q.question}\n✨ Yanıt: ${q.answer}`).join("\n\n");
  }

  const headerBar = `
    <div class="compact-item" style="margin-bottom:12px;white-space:normal;">
      <div>
        <strong>${escapeHtml(f.userName || "Falkız Kullanıcısı")}</strong>
        <div class="tiny-muted">Owner ID: <code>${escapeHtml(f.ownerId || "—")}</code> · Belge: <code>${escapeHtml(f.id || "")}</code></div>
      </div>
      ${
        f.ownerId
          ? `<button id="modalJumpUserBtn" class="btn btn-gold btn-xs" type="button">👤 Kullanıcıya Git / Jeton Ver</button>`
          : ""
      }
    </div>
  `;

  openDetailModal(
    `${fortuneTypeLabel(f.type || "kahve")} · ${formatTs(f.timestamp || f.createdAt)} (${formatRelative(f.timestamp || f.createdAt)})`,
    `${headerBar}${scoresBlock}${photosBlock}<div style="white-space:pre-wrap;">${escapeHtml((f.comment || "Yorum hazırlanıyor…") + extraText)}</div>`
  );

  const jumpBtn = $("modalJumpUserBtn");
  if (jumpBtn && f.ownerId) {
    jumpBtn.addEventListener("click", async () => {
      $("detailModal").classList.add("hidden");
      switchSection("users");
      await selectUser(f.ownerId);
    });
  }
}

// ============================================================================
// 4. DASHBOARD REAL KPI STATS & QUICK GRANT BY OWNER ID
// ============================================================================
async function refreshDashboardStats() {
  const dayAgoMs = Date.now() - 24 * 60 * 60 * 1000;
  const dayAgoTs = Timestamp.fromMillis(dayAgoMs);

  // 1. Exact Total Registered Owners + Last 24h New Signups
  Promise.allSettled([
    getCountFromServer(collection(db, "owners")),
    getCountFromServer(query(collection(db, "owners"), where("createdAt", ">=", dayAgoTs)))
  ]).then(([totRes, newRes]) => {
    if (totRes.status === "fulfilled") {
      $("kpiRecentUsers").textContent = formatNumberTR(totRes.value.data().count);
    }
    if (newRes.status === "fulfilled") {
      const new24 = newRes.value.data().count;
      $("kpiUsersFoot").textContent = `Son 24 saatte +${formatNumberTR(new24)} yeni kayıt →`;
    }
  });

  // 2. Exact Total Fortunes + Last 24h Fortunes
  Promise.allSettled([
    getCountFromServer(collection(db, "fortunes")),
    getCountFromServer(query(collection(db, "fortunes"), where("timestamp", ">=", dayAgoMs)))
  ]).then(([totF, last24F]) => {
    if (totF.status === "fulfilled") {
      $("kpiTotalFortunes").textContent = formatNumberTR(totF.value.data().count);
    }
    if (last24F.status === "fulfilled") {
      const f24 = last24F.value.data().count;
      $("kpiFortunesFoot").textContent = `Son 24 saatte ${formatNumberTR(f24)} fal bakıldı →`;
    }
  });

  // 3. Promo Codes Count
  try {
    const pSnap = await getDocs(collection(db, "promo_codes"));
    const activeCount = pSnap.docs.filter(
      (d) => d.data().isActive !== false && (d.data().remainingUsage ?? 1) > 0
    ).length;
    $("kpiActivePromos").textContent = String(activeCount);
  } catch (_) {}

  // 4. Admin Logs
  try {
    const logsSnap = await getDocs(query(collection(db, "admin_logs"), orderBy("createdAtMs", "desc"), limit(12)));
    const logs = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() })).slice(0, 8);

    const box = $("dashAdminLogs");
    if (!logs.length) {
      box.innerHTML = `<div class="tiny-muted">Henüz kayıtlı yönetici işlemi yok.</div>`;
    } else {
      box.innerHTML = logs
        .map(
          (l) => `
          <div class="compact-item">
            <div>
              <strong>${escapeHtml(l.action || "İşlem")}</strong>
              <div class="tiny-muted">Owner: <code>${escapeHtml(l.targetOwnerId || "—")}</code> · ${escapeHtml(l.note || "")}</div>
            </div>
            <span class="tiny-muted">${formatRelative(l.createdAtMs)}</span>
          </div>`
        )
        .join("");
    }
  } catch (_) {}
}

$("dashQuickGrantForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const uid = $("dashOwnerIdInput").value.trim();
  const delta = parseInt($("dashJetonDeltaInput").value, 10);
  const customNote = $("dashGrantNoteInput").value.trim();
  if (!uid || Number.isNaN(delta) || delta === 0) return;

  try {
    const ownerSnap = await getDoc(doc(db, "owners", uid));
    if (!ownerSnap.exists()) {
      showToast(`"${uid}" ID'li kullanıcı bulunamadı! Lütfen Owner ID'yi kontrol edin.`, true);
      return;
    }
    await applyJetonChange(uid, "delta", delta, customNote, true);
    $("dashOwnerIdInput").value = "";
    $("dashGrantNoteInput").value = "";
    switchSection("users");
    await selectUser(uid);
  } catch (err) {
    showToast("Jeton tanımlanırken hata oluştu: " + (err.message || ""), true);
  }
});

// ============================================================================
// 5. SMART USER ACTIVITY DIRECTORY & MULTI-FIELD SEARCH
// ============================================================================
$("globalQuickSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("globalQuickSearchInput").value.trim();
  if (!q) return;
  switchSection("users");
  $("userSearchInput").value = q;
  $("clearUserSearchBtn").classList.remove("hidden");
  await performUserSearch(q);
});

$("userSearchInput").addEventListener("input", () => {
  const hasVal = $("userSearchInput").value.trim().length > 0;
  $("clearUserSearchBtn").classList.toggle("hidden", !hasVal);
});

$("clearUserSearchBtn").addEventListener("click", async () => {
  $("userSearchInput").value = "";
  $("clearUserSearchBtn").classList.add("hidden");
  await loadUserDirectory(currentUserDirMode);
});

$("userSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("userSearchInput").value.trim();
  if (!q) {
    await loadUserDirectory(currentUserDirMode);
    return;
  }
  await performUserSearch(q);
});

$("reloadUserDirBtn").addEventListener("click", () => loadUserDirectory(currentUserDirMode));

document.querySelectorAll("#userDirectoryTabs .dtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    $("userSearchInput").value = "";
    $("clearUserSearchBtn").classList.add("hidden");
    setUserDirectoryMode(btn.dataset.udir);
  });
});

function setUserDirectoryMode(mode) {
  currentUserDirMode = mode;
  document.querySelectorAll("#userDirectoryTabs .dtab").forEach((b) =>
    b.classList.toggle("active", b.dataset.udir === mode)
  );
  loadUserDirectory(mode);
}

async function batchHydrateSubProfileNames(missingUids) {
  const clean = missingUids.filter((id) => id && !resolvedNameCache.has(id));
  if (!clean.length) return;

  const chunks = [];
  for (let i = 0; i < clean.length; i += 10) {
    chunks.push(clean.slice(i, i + 10));
  }

  await Promise.allSettled(
    chunks.map(async (chunk) => {
      const snap = await getDocs(query(collection(db, "users"), where("ownerId", "in", chunk)));
      snap.docs.forEach((d) => {
        const data = d.data();
        if (data?.ownerId && data?.name && !resolvedNameCache.has(data.ownerId)) {
          resolvedNameCache.set(data.ownerId, String(data.name).trim());
        }
      });
    })
  );
}

async function loadUserDirectory(mode = "active") {
  $("userSearchMeta").textContent = "Canlı kullanıcı verileri yükleniyor…";

  try {
    if (mode === "active") {
      // Aggregate all real activity streams in parallel!
      const [
        fortunesRes,
        seenRes,
        adOwnersRes,
        spinRes,
        cookieRes,
        createdRes,
        chatRes
      ] = await Promise.allSettled([
        getDocs(query(collection(db, "fortunes"), orderBy("timestamp", "desc"), limit(80))),
        getDocs(query(collection(db, "owners"), orderBy("lastSeenAt", "desc"), limit(45))),
        getDocs(query(collection(db, "owners"), orderBy("lastAdWatchTime", "desc"), limit(35))),
        getDocs(query(collection(db, "owners"), orderBy("lastSpinTime", "desc"), limit(35))),
        getDocs(query(collection(db, "owners"), orderBy("lastFreeCookieTime", "desc"), limit(25))),
        getDocs(query(collection(db, "owners"), orderBy("createdAt", "desc"), limit(35))),
        getDocs(query(collection(db, "global_chat"), orderBy("timestamp", "desc"), limit(30)))
      ]);

      const extraSignalsMap = new Map();
      const ensureSig = (uid) => {
        if (!extraSignalsMap.has(uid)) extraSignalsMap.set(uid, {});
        return extraSignalsMap.get(uid);
      };

      const ingestOwners = (res) => {
        if (res.status !== "fulfilled") return;
        res.value.docs.forEach((d) => {
          if (d.id === DEDICATED_ADMIN_UID) return;
          ownerDocCache.set(d.id, { ...(ownerDocCache.get(d.id) || {}), ...d.data() });
          ensureSig(d.id);
        });
      };

      ingestOwners(seenRes);
      ingestOwners(adOwnersRes);
      ingestOwners(spinRes);
      ingestOwners(cookieRes);
      ingestOwners(createdRes);

      if (fortunesRes.status === "fulfilled") {
        fortunesRes.value.docs.forEach((d) => {
          const f = { id: d.id, ...d.data() };
          if (!f.ownerId || f.ownerId === DEDICATED_ADMIN_UID) return;
          const prev = latestFortuneByOwner.get(f.ownerId);
          if (!prev || toMs(f.timestamp) >= toMs(prev.timestamp)) {
            latestFortuneByOwner.set(f.ownerId, f);
          }
          const cName = cleanFallbackNameFromFortune(f);
          if (cName && !resolvedNameCache.has(f.ownerId)) {
            resolvedNameCache.set(f.ownerId, cName);
          }
          const sig = ensureSig(f.ownerId);
          if (!sig.latestFortune || toMs(f.timestamp) > toMs(sig.latestFortune.timestamp)) {
            sig.latestFortune = f;
          }
        });
      }

      if (chatRes.status === "fulfilled") {
        chatRes.value.docs.forEach((d) => {
          const m = d.data();
          const uid = m.senderId;
          if (!uid || uid === DEDICATED_ADMIN_UID) return;
          if (m.senderName && !resolvedNameCache.has(uid)) {
            resolvedNameCache.set(uid, String(m.senderName).trim());
          }
          const sig = ensureSig(uid);
          const ms = toMs(m.timestamp || m.clientTimestamp);
          if (ms > (sig.chatMs || 0)) sig.chatMs = ms;
        });
      }

      allSupportTickets.forEach((t) => {
        if (!t.ownerId || t.ownerId === DEDICATED_ADMIN_UID) return;
        const sig = ensureSig(t.ownerId);
        const ms = toMs(t.updatedAt || t.createdAt);
        if (ms > (sig.ticketMs || 0)) sig.ticketMs = ms;
      });

      // Fetch owner docs for active UIDs that came from fortunes/chat but weren't in owners queries yet
      const candidateUids = Array.from(extraSignalsMap.keys());
      const missingOwnerDocs = candidateUids.filter((uid) => !ownerDocCache.has(uid)).slice(0, 45);
      await Promise.allSettled(
        missingOwnerDocs.map(async (uid) => {
          const snap = await getDoc(doc(db, "owners", uid));
          if (snap.exists()) {
            ownerDocCache.set(uid, snap.data());
          }
        })
      );

      // Hydrate sub-profile names for any top candidates still lacking userName
      const assembled = candidateUids
        .map((uid) => {
          const d = ownerDocCache.get(uid) || {};
          const act = computeBestActivity(uid, d, extraSignalsMap.get(uid));
          return {
            uid,
            ...d,
            _activityMs: act.ms,
            _activityLabel: act.label
          };
        })
        .filter((u) => u._activityMs > 0)
        .sort((a, b) => b._activityMs - a._activityMs)
        .slice(0, 55);

      const needSubNames = assembled
        .filter((u) => !u.userName && !resolvedNameCache.has(u.uid) && !latestFortuneByOwner.has(u.uid))
        .map((u) => u.uid);
      await batchHydrateSubProfileNames(needSubNames);

      cachedActiveUsers = assembled;
      renderDashboardActiveUsers(assembled.slice(0, 8));

      if (currentUserDirMode === "active") {
        $("userSearchMeta").textContent = `En son uygulamayı kullanan ${assembled.length} aktif kişi listeleniyor.`;
        renderUserResultsList(assembled);

        if (!selectedUserId && assembled.length > 0) {
          await selectUser(assembled[0].uid);
        }
      }
      return;
    }

    if (mode === "fortunes") {
      const snap = await getDocs(query(collection(db, "fortunes"), orderBy("timestamp", "desc"), limit(110)));
      const perOwner = new Map();
      snap.docs.forEach((d) => {
        const f = { id: d.id, ...d.data() };
        if (!f.ownerId || f.ownerId === DEDICATED_ADMIN_UID) return;
        latestFortuneByOwner.set(
          f.ownerId,
          !latestFortuneByOwner.has(f.ownerId) || toMs(f.timestamp) >= toMs(latestFortuneByOwner.get(f.ownerId).timestamp)
            ? f
            : latestFortuneByOwner.get(f.ownerId)
        );
        const cName = cleanFallbackNameFromFortune(f);
        if (cName && !resolvedNameCache.has(f.ownerId)) resolvedNameCache.set(f.ownerId, cName);

        if (!perOwner.has(f.ownerId)) {
          perOwner.set(f.ownerId, { latest: f, recentCount: 1 });
        } else {
          perOwner.get(f.ownerId).recentCount += 1;
        }
      });

      const uids = Array.from(perOwner.keys()).slice(0, 50);
      await Promise.allSettled(
        uids
          .filter((uid) => !ownerDocCache.has(uid))
          .map(async (uid) => {
            const oSnap = await getDoc(doc(db, "owners", uid));
            if (oSnap.exists()) ownerDocCache.set(uid, oSnap.data());
          })
      );

      const items = uids.map((uid) => {
        const info = perOwner.get(uid);
        const d = ownerDocCache.get(uid) || {};
        const extraCnt = info.recentCount > 1 ? ` (${info.recentCount} fal)` : "";
        return {
          uid,
          ...d,
          _activityMs: toMs(info.latest.timestamp),
          _activityLabel: `${fortuneTypeLabel(info.latest.type || "kahve")}${extraCnt}`
        };
      });

      $("userSearchMeta").textContent = `En son fal baktıran ${items.length} benzersiz kullanıcı listeleniyor.`;
      renderUserResultsList(items);
      return;
    }

    if (mode === "newest") {
      const snap = await getDocs(query(collection(db, "owners"), orderBy("createdAt", "desc"), limit(50)));
      const raw = snap.docs
        .filter((d) => d.id !== DEDICATED_ADMIN_UID)
        .map((d) => {
          ownerDocCache.set(d.id, d.data());
          return {
            uid: d.id,
            ...d.data(),
            _activityMs: toMs(d.data().createdAt),
            _activityLabel: "🆕 Yeni Kayıt"
          };
        });

      await batchHydrateSubProfileNames(raw.filter((u) => !u.userName).map((u) => u.uid));
      $("userSearchMeta").textContent = `En yeni kayıt olan ${raw.length} kullanıcı listeleniyor.`;
      renderUserResultsList(raw);
      return;
    }

    if (mode === "vip") {
      const [vipSnap, richSnap] = await Promise.allSettled([
        getDocs(query(collection(db, "owners"), orderBy("premiumExpiryDate", "desc"), limit(30))),
        getDocs(query(collection(db, "owners"), orderBy("jeton", "desc"), limit(40)))
      ]);

      const merged = new Map();
      const now = Date.now();

      if (vipSnap.status === "fulfilled") {
        vipSnap.value.docs.forEach((d) => {
          if (d.id === DEDICATED_ADMIN_UID) return;
          const data = d.data();
          ownerDocCache.set(d.id, data);
          const expMs = toMs(data.premiumExpiryDate);
          if (expMs > 0) {
            merged.set(d.id, {
              uid: d.id,
              ...data,
              _isVipActive: expMs > now,
              _activityMs: toMs(data.lastSeenAt || data.createdAt) || expMs,
              _activityLabel: expMs > now ? "👑 Aktif VIP Üye" : "VIP Süresi Dolmuş"
            });
          }
        });
      }

      if (richSnap.status === "fulfilled") {
        richSnap.value.docs.forEach((d) => {
          if (d.id === DEDICATED_ADMIN_UID || merged.has(d.id)) return;
          const data = d.data();
          ownerDocCache.set(d.id, data);
          const act = computeBestActivity(d.id, data);
          merged.set(d.id, {
            uid: d.id,
            ...data,
            _isVipActive: toMs(data.premiumExpiryDate) > now,
            _activityMs: act.ms,
            _activityLabel: act.label
          });
        });
      }

      const items = Array.from(merged.values()).sort((a, b) => {
        if (a._isVipActive !== b._isVipActive) return a._isVipActive ? -1 : 1;
        return (b.jeton ?? 0) - (a.jeton ?? 0);
      });

      await batchHydrateSubProfileNames(items.filter((u) => !u.userName).map((u) => u.uid));
      $("userSearchMeta").textContent = `VIP üyeler ve en yüksek jetonlu ${items.length} hesap listeleniyor.`;
      renderUserResultsList(items);
    }
  } catch (err) {
    console.error("loadUserDirectory error:", err);
    $("userSearchMeta").textContent = "Kullanıcı listesi alınırken hata oluştu.";
  }
}

function renderDashboardActiveUsers(usersSlice) {
  const box = $("dashRecentActiveUsers");
  if (!box) return;

  if (!usersSlice.length) {
    box.innerHTML = `<div class="tiny-muted">Aktif kullanıcı bulunamadı.</div>`;
    return;
  }

  box.innerHTML = usersSlice
    .map((u) => {
      const name = resolveDisplayName(u.uid, u);
      const isFresh = Date.now() - (u._activityMs || 0) < 60 * 60 * 1000;
      const vipIcon = toMs(u.premiumExpiryDate) > Date.now() ? " 👑" : "";
      return `
        <div class="dash-feed-item" style="cursor:pointer" data-dash-active-uid="${escapeHtml(u.uid)}">
          <div class="dash-feed-main">
            <div class="dash-feed-title">
              <span>${escapeHtml(name)}${vipIcon}</span>
              <span class="activity-badge${isFresh ? " fresh" : ""}">${escapeHtml(u._activityLabel || "Aktif")}</span>
            </div>
            <div class="dash-feed-sub">
              ${escapeHtml(formatRelative(u._activityMs))} · ${escapeHtml(u.email || `ID: ${u.uid.slice(0, 14)}…`)}
            </div>
          </div>
          <div class="dash-feed-right">
            <span class="pill pill-gold">🪙 ${escapeHtml(u.jeton ?? 0)}</span>
          </div>
        </div>
      `;
    })
    .join("");

  box.querySelectorAll("[data-dash-active-uid]").forEach((row) => {
    row.addEventListener("click", async () => {
      switchSection("users");
      await selectUser(row.dataset.dashActiveUid);
    });
  });
}

async function performUserSearch(rawQuery) {
  const q = rawQuery.trim();
  const qLower = q.toLocaleLowerCase("tr-TR");
  const qTitle = toTitleCaseTR(q);
  $("userSearchMeta").textContent = `"${q}" aranıyor…`;

  const foundMap = new Map();
  const addOwnerDoc = (snap, matchedName = "") => {
    if (snap && snap.exists() && snap.id !== DEDICATED_ADMIN_UID) {
      ownerDocCache.set(snap.id, snap.data());
      const prev = foundMap.get(snap.id) || {};
      foundMap.set(snap.id, {
        ...prev,
        uid: snap.id,
        ...(matchedName ? { _matchedSubName: matchedName } : {}),
        ...snap.data()
      });
    }
  };

  const namePrefixes = [...new Set([q, qLower, qTitle])].filter(Boolean);

  const tasks = [
    getDoc(doc(db, "owners", q)).then((s) => addOwnerDoc(s)),
    getDocs(query(collection(db, "owners"), where("ownerId", "==", q), limit(10))).then((s) =>
      s.docs.forEach((d) => addOwnerDoc(d))
    ),
    getDocs(query(collection(db, "owners"), where("email", "==", q), limit(10))).then((s) =>
      s.docs.forEach((d) => addOwnerDoc(d))
    ),
    getDocs(query(collection(db, "owners"), where("emailLower", ">=", qLower), where("emailLower", "<=", qLower + "\uf8ff"), limit(12))).then((s) =>
      s.docs.forEach((d) => addOwnerDoc(d))
    ),
    getDocs(query(collection(db, "owners"), where("deviceId", "==", q), limit(10))).then((s) =>
      s.docs.forEach((d) => addOwnerDoc(d))
    ),
    getDocs(
      query(
        collection(db, "owners"),
        where("userNameLower", ">=", qLower),
        where("userNameLower", "<=", qLower + "\uf8ff"),
        limit(15)
      )
    ).then((s) => s.docs.forEach((d) => addOwnerDoc(d)))
  ];

  // Search sub-profiles (users.name) and fortunes (fortunes.userName) across casing variants
  namePrefixes.forEach((pref) => {
    tasks.push(
      getDocs(
        query(collection(db, "users"), where("name", ">=", pref), where("name", "<=", pref + "\uf8ff"), limit(12))
      ).then(async (uSnap) => {
        const pairs = uSnap.docs
          .map((d) => ({ ownerId: d.data().ownerId, name: d.data().name }))
          .filter((x) => x.ownerId);
        await Promise.allSettled(
          pairs.map((p) =>
            getDoc(doc(db, "owners", p.ownerId)).then((oDoc) => addOwnerDoc(oDoc, p.name))
          )
        );
      })
    );

    tasks.push(
      getDocs(
        query(collection(db, "fortunes"), where("userName", ">=", pref), where("userName", "<=", pref + "\uf8ff"), limit(15))
      ).then(async (fSnap) => {
        const pairs = [];
        const seen = new Set();
        fSnap.docs.forEach((d) => {
          const fd = d.data();
          if (fd.ownerId && !seen.has(fd.ownerId)) {
            seen.add(fd.ownerId);
            pairs.push({ ownerId: fd.ownerId, name: cleanFallbackNameFromFortune(fd) });
          }
        });
        await Promise.allSettled(
          pairs.map((p) =>
            getDoc(doc(db, "owners", p.ownerId)).then((oDoc) => addOwnerDoc(oDoc, p.name))
          )
        );
      })
    );
  });

  await Promise.allSettled(tasks);

  // Also include matches from in-memory cached active users / live fortunes (supports substring matches like surname!)
  cachedActiveUsers.forEach((u) => {
    if (foundMap.has(u.uid)) return;
    const hay = `${resolveDisplayName(u.uid, u)} ${u.email || ""} ${u.uid} ${u.deviceId || ""}`.toLocaleLowerCase("tr-TR");
    if (hay.includes(qLower)) {
      foundMap.set(u.uid, u);
    }
  });

  const results = Array.from(foundMap.values())
    .map((u) => {
      const act = computeBestActivity(u.uid, u);
      return {
        ...u,
        _activityMs: u._activityMs || act.ms,
        _activityLabel: u._activityLabel || act.label
      };
    })
    .sort((a, b) => (b._activityMs || 0) - (a._activityMs || 0));

  $("userSearchMeta").textContent = results.length
    ? `"${q}" için ${results.length} eşleşen kullanıcı bulundu.`
    : `"${q}" için eşleşen kullanıcı bulunamadı.`;

  renderUserResultsList(results);
  if (results.length > 0) {
    await selectUser(results[0].uid);
  }
}

function renderUserResultsList(items) {
  const wrap = $("userResultsList");
  if (!items.length) {
    wrap.innerHTML = `<div class="tiny-muted" style="padding:10px 4px;">Sonuç bulunamadı.</div>`;
    return;
  }

  const now = Date.now();
  wrap.innerHTML = items
    .map((u) => {
      const title = resolveDisplayName(u.uid, u);
      const coins = u.jeton ?? 0;
      const isVip = toMs(u.premiumExpiryDate) > now;
      const activeCls = u.uid === selectedUserId ? " active" : "";
      const actMs = u._activityMs || 0;
      const isFresh = actMs > 0 && now - actMs < 60 * 60 * 1000;
      const actLabel = u._activityLabel || "Kayıtlı";
      const relTime = actMs ? formatRelative(actMs) : "—";
      const subLine = u.email
        ? `${u.email} · ID: ${u.uid.slice(0, 10)}…`
        : `ID: ${u.uid}`;

      return `
        <div class="user-row-item${activeCls}" data-uid="${escapeHtml(u.uid)}">
          <div class="user-row-top">
            <span class="user-name-text">${escapeHtml(title)}${isVip ? " 👑" : ""}</span>
            <span class="pill pill-gold">🪙 ${escapeHtml(coins)}</span>
          </div>
          <div class="user-activity-row">
            <span class="activity-badge${isFresh ? " fresh" : ""}">${escapeHtml(actLabel)}</span>
            <span class="activity-time" title="${escapeHtml(formatTs(actMs))}">${escapeHtml(relTime)}</span>
          </div>
          <div class="user-row-sub">${escapeHtml(subLine)}</div>
        </div>
      `;
    })
    .join("");

  wrap.querySelectorAll(".user-row-item").forEach((row) => {
    row.addEventListener("click", () => selectUser(row.dataset.uid));
  });
}

// ============================================================================
// 6. 360° USER INSPECTOR & JETON / VIP / MODERATION ACTIONS
// ============================================================================
async function selectUser(uid) {
  selectedUserId = uid;
  document.querySelectorAll(".user-row-item").forEach((el) => {
    el.classList.toggle("active", el.dataset.uid === uid);
  });

  $("userEmptyState").classList.add("hidden");
  $("userInspectorWrap").classList.remove("hidden");

  if (unsubSelectedOwner) {
    unsubSelectedOwner();
    unsubSelectedOwner = null;
  }

  unsubSelectedOwner = onSnapshot(doc(db, "owners", uid), (snap) => {
    if (!snap.exists()) {
      showToast("Bu Owner belgesi bulunamadı.", true);
      return;
    }
    selectedOwnerData = snap.data() || {};
    ownerDocCache.set(uid, selectedOwnerData);
    renderSelectedOwnerHeaderAndProfile(uid, selectedOwnerData);
  });

  await loadSelectedUserExtraTabs(uid);
}

function updateInspectorActivityLine(uid, d) {
  const act = computeBestActivity(uid, d);
  const el = $("inspLastActivityLine");
  if (!el) return;
  if (act.ms) {
    el.textContent = `⚡ Son Aktivite: ${act.label} · ${formatRelative(act.ms)} (${formatTs(act.ms)})`;
  } else {
    el.textContent = "Son aktivite zamanı kayıtlı değil";
  }
}

function renderSelectedOwnerHeaderAndProfile(uid, d) {
  $("inspAvatar").src = d.profileImageUrl || DEFAULT_AVATAR;
  $("inspDisplayName").textContent = resolveDisplayName(uid, d);
  $("inspEmail").textContent = d.email || "E-posta alanı mevcut değil (Google / Anonim veya eski kayıt)";
  $("inspOwnerId").textContent = uid;
  $("inspJetonCount").textContent = String(d.jeton ?? 0);
  $("inspAdCount").textContent = String(d.adWatchCount ?? 0);

  updateInspectorActivityLine(uid, d);

  const expMs = toMs(d.premiumExpiryDate);
  const isVip = expMs > Date.now();
  $("inspVipBadge").classList.toggle("hidden", !isVip);
  $("inspVipDetailText").textContent = isVip
    ? `VIP Aktif — Bitiş: ${formatTs(expMs)}`
    : "Kullanıcının aktif VIP üyeliği bulunmuyor.";

  const banned = d.isBanned === true;
  $("inspBanBadge").classList.toggle("hidden", !banned);
  $("toggleBanUserBtn").textContent = banned ? "✅ Sohbet Engelini Kaldır" : "🚫 Sohbetten Yasakla";

  const badges = Array.isArray(d.badges) ? d.badges : [];
  $("toggleGoldBadgeBtn").textContent = badges.includes("gold") ? "✨ Gold Rozeti Kaldır" : "✨ Gold Rozet Ver";
  $("toggleDevBadgeBtn").textContent = badges.includes("developer") ? "🛠️ Dev Rozeti Kaldır" : "🛠️ Developer Rozet Ver";

  const kvPairs = [
    ["Owner ID (UID)", uid],
    ["E-posta", d.email || "—"],
    ["Kullanıcı Adı", d.userName || resolveDisplayName(uid, d)],
    ["Mevcut Jeton", String(d.jeton ?? 0)],
    ["VIP Bitiş Tarihi", expMs ? formatTs(expMs) : "Yok"],
    ["Rozetler", badges.length ? badges.join(", ") : "Yok"],
    ["Cihaz ID (deviceId)", d.deviceId || "—"],
    ["Bildirim Token (FCM)", d.fcmToken ? "✅ Kayıtlı (" + String(d.fcmToken).slice(0, 14) + "…)" : "Yok"],
    ["Reklam İzleme Sayısı", String(d.adWatchCount ?? 0)],
    ["Son Reklam İzleme", formatTs(d.lastAdWatchTime)],
    ["Son Çark Çevirme", formatTs(d.lastSpinTime)],
    ["Son Şans Kurabiyesi", formatTs(d.lastFreeCookieTime || d.lastFreeCookieDate)],
    ["Seri (Streak)", String(d.streakCount ?? 0)],
    ["Sohbet Engeli", banned ? "Engelli" : "Açık"],
    ["Son Uygulama Girişi", formatTs(d.lastSeenAt)],
    ["Kayıt Tarihi", formatTs(d.createdAt)]
  ];

  $("inspOwnerKeyGrid").innerHTML = kvPairs
    .map(
      ([k, v]) => `
      <div class="kv-item">
        <div class="k">${escapeHtml(k)}</div>
        <div class="v">${escapeHtml(v)}</div>
      </div>`
    )
    .join("");

  $("inspRawJson").textContent = JSON.stringify(d, null, 2);
}

async function loadSelectedUserExtraTabs(uid) {
  // 1. Sub-profiles (users)
  getDocs(query(collection(db, "users"), where("ownerId", "==", uid)))
    .then((snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      if (list.length && list[0].name) {
        resolvedNameCache.set(uid, String(list[0].name).trim());
        if (selectedUserId === uid && !selectedOwnerData?.userName) {
          $("inspDisplayName").textContent = list[0].name;
        }
      }
      const box = $("inspSubProfilesList");
      if (!list.length) {
        box.innerHTML = `<div class="tiny-muted">Kayıtlı alt fal profili bulunamadı.</div>`;
        return;
      }
      box.innerHTML = list
        .map(
          (p) => `
          <div class="kv-item">
            <div class="k">Fal Profili · ${escapeHtml(p.gender || "—")}</div>
            <div class="v">${escapeHtml(p.name || "İsimsiz")}</div>
            <div class="tiny-muted mt-xs">
              Doğum: ${escapeHtml(p.birthDate || "—")} ${escapeHtml(p.birthTime || "")}<br/>
              Yer: ${escapeHtml(p.birthPlace || "—")}<br/>
              İlişki: ${escapeHtml(p.relationshipStatus || p.maritalStatus || "—")} · Meslek: ${escapeHtml(p.occupation || p.jobStatus || "—")}
            </div>
          </div>`
        )
        .join("");
    })
    .catch(() => {});

  // 2. Purchases + Used Promos + User Admin Logs
  getDocs(collection(db, "owners", uid, "purchases"))
    .then((snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toMs(b.purchaseTime || b.verifiedAt || b.createdAt) - toMs(a.purchaseTime || a.verifiedAt || a.createdAt));
      const wrap = $("inspPurchasesTableWrap");
      if (!rows.length) {
        wrap.innerHTML = `<div class="tiny-muted">Bu kullanıcıya ait Google Play satın alım kaydı bulunmuyor.</div>`;
        return;
      }
      wrap.innerHTML = `
        <table>
          <thead>
            <tr><th>Ürün / Paket</th><th>Jeton / Plan</th><th>Sipariş / Token</th><th>Tarih</th></tr>
          </thead>
          <tbody>
            ${rows
              .map(
                (r) => `
                <tr>
                  <td><strong>${escapeHtml(r.sku || r.productId || r.planId || "Paket")}</strong></td>
                  <td><span class="pill pill-gold">${escapeHtml(r.jetonGranted || r.coins || r.type || "Onaylı")}</span></td>
                  <td><code>${escapeHtml((r.orderId || r.id || "").slice(0, 24))}</code></td>
                  <td>${formatTs(r.verifiedAt || r.purchaseTime || r.createdAt)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`;
    })
    .catch(() => {});

  Promise.allSettled([
    getDocs(collection(db, "owners", uid, "used_promo_codes")),
    getDocs(collection(db, "owners", uid, "used_codes"))
  ]).then((res) => {
    const map = new Map();
    res.forEach((r) => {
      if (r.status === "fulfilled") {
        r.value.docs.forEach((d) => map.set(d.id, { id: d.id, ...d.data() }));
      }
    });
    const arr = Array.from(map.values());
    $("inspUsedPromosWrap").innerHTML = arr.length
      ? arr
          .map(
            (c) => `
            <div class="compact-item">
              <strong>🎁 ${escapeHtml(c.code || c.id)}</strong>
              <span class="tiny-muted">${formatTs(c.usedAt || c.redeemedAt)}</span>
            </div>`
          )
          .join("")
      : `<div class="tiny-muted">Kullanılmış promosyon kodu yok.</div>`;
  });

  getDocs(query(collection(db, "admin_logs"), where("targetOwnerId", "==", uid)))
    .then((snap) => {
      const items = snap.docs
        .map((d) => d.data())
        .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0));
      $("inspAdminHistoryWrap").innerHTML = items.length
        ? items
            .map(
              (l) => `
              <div class="compact-item">
                <div>
                  <strong>${escapeHtml(l.action)}</strong>
                  <div class="tiny-muted">${escapeHtml(l.note || "")}</div>
                </div>
                <span class="tiny-muted">${formatTs(l.createdAtMs)}</span>
              </div>`
            )
            .join("")
        : `<div class="tiny-muted">Bu kullanıcı için henüz manuel işlem yapılmadı.</div>`;
    })
    .catch(() => {});

  // 3. Ads History (supports both v1 earnedAt and v2 createdAt / createdAtMs!)
  getDocs(query(collection(db, "ad_usage"), where("ownerId", "==", uid)))
    .then((snap) => {
      const adTime = (a) => toMs(a.createdAtMs || a.createdAt || a.earnedAt);
      const ads = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => adTime(b) - adTime(a));

      if (ads.length > (selectedOwnerData?.adWatchCount ?? 0) && selectedUserId === uid) {
        $("inspAdCount").textContent = String(ads.length);
      }

      const latestAdTs = selectedOwnerData?.lastAdWatchTime || (ads[0] ? adTime(ads[0]) : 0);
      $("inspAdsSummary").innerHTML = `
        <span class="pill pill-gold">Toplam Sayaç: ${escapeHtml(Math.max(selectedOwnerData?.adWatchCount ?? 0, ads.length))}</span>
        <span class="pill">Kayıtlı Olay: ${ads.length}</span>
        <span class="pill">Son İzleme: ${formatTs(latestAdTs)}</span>
      `;

      const wrap = $("inspAdsTableWrap");
      if (!ads.length) {
        wrap.innerHTML = `<div class="tiny-muted">Henüz detaylı ödüllü reklam izleme kaydı bulunmuyor.</div>`;
        return;
      }
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Tarih</th><th>Kazanılan Jeton</th><th>Kaynak / Ağ</th><th>Platform</th></tr></thead>
          <tbody>
            ${ads
              .map(
                (a) => `
                <tr>
                  <td>${formatTs(adTime(a))} <span class="tiny-muted">(${escapeHtml(formatRelative(adTime(a)))})</span></td>
                  <td><span class="pill pill-gold">+${escapeHtml(a.rewardAmount ?? 1)} Jeton</span></td>
                  <td>${escapeHtml(a.source || a.provider || "admob")}</td>
                  <td>${escapeHtml(a.platform || "android")}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`;
    })
    .catch(() => {});

  // 4. Past Fortunes
  getDocs(query(collection(db, "fortunes"), where("ownerId", "==", uid)))
    .then((snap) => {
      if (selectedUserId !== uid) return;
      selectedUserFortunes = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toMs(b.timestamp || b.createdAt) - toMs(a.timestamp || a.createdAt));

      if (selectedUserFortunes.length > 0) {
        latestFortuneByOwner.set(uid, selectedUserFortunes[0]);
        const cName = cleanFallbackNameFromFortune(selectedUserFortunes[0]);
        if (cName && !resolvedNameCache.has(uid)) resolvedNameCache.set(uid, cName);
        if (!selectedOwnerData?.userName && cName) {
          $("inspDisplayName").textContent = resolveDisplayName(uid, selectedOwnerData);
        }
        updateInspectorActivityLine(uid, selectedOwnerData || {});
      }

      $("inspFortuneCount").textContent = String(selectedUserFortunes.length);
      renderSelectedUserFortunes();
    })
    .catch(() => {});
}

$("inspFortuneStatPill").addEventListener("click", () => switchInspectorTab("fortunes"));
$("fortuneTypeFilter").addEventListener("change", () => renderSelectedUserFortunes());

function renderSelectedUserFortunes() {
  const filterVal = $("fortuneTypeFilter").value;
  const list =
    filterVal === "all"
      ? selectedUserFortunes
      : selectedUserFortunes.filter((f) => (f.type || "kahve") === filterVal);

  const box = $("inspFortunesList");
  if (!list.length) {
    box.innerHTML = `<div class="tiny-muted">Bu filtrede fal kaydı bulunamadı.</div>`;
    return;
  }

  box.innerHTML = list
    .map((f, idx) => {
      const imgs = Array.isArray(f.imageUrls)
        ? f.imageUrls.filter(Boolean)
        : f.imageUrl
        ? [f.imageUrl]
        : [];
      const userQ = extractUserQuestionFromFortune(f);
      const snippet = (f.comment || "").slice(0, 240) + ((f.comment || "").length > 240 ? "…" : "");
      const statusBadge =
        f.status === "processing"
          ? `<span class="pill pill-gold">⏳ Hazırlanıyor</span>`
          : `<span class="pill pill-success">✅ Tamamlandı</span>`;
      const costPill =
        f.usedFreeCoffee === true
          ? `<span class="pill">☕ Ücretsiz</span>`
          : typeof f.chargedJeton === "number" && f.chargedJeton > 0
          ? `<span class="pill pill-gold">🪙 ${f.chargedJeton} Jeton</span>`
          : "";

      return `
        <div class="fortune-item">
          <div class="card-header">
            <div class="row-wrap">
              <strong>${escapeHtml(fortuneTypeLabel(f.type || "kahve"))}</strong>
              ${statusBadge}
              ${costPill}
              <span class="tiny-muted">${escapeHtml(f.userName || "")}</span>
            </div>
            <span class="tiny-muted">${formatRelative(f.timestamp || f.createdAt)} · ${formatTs(f.timestamp || f.createdAt)}</span>
          </div>
          ${userQ ? `<div class="lf-question-box mt-sm">💬 <strong>Soru:</strong> ${escapeHtml(userQ)}</div>` : ""}
          <p class="muted small mt-sm">${escapeHtml(snippet || "Yorum metni yok.")}</p>
          ${
            imgs.length
              ? `<div class="fortune-thumbs">
                  ${imgs
                    .map(
                      (u) =>
                        `<img src="${escapeHtml(u)}" alt="Fal fotoğrafı" loading="lazy" data-fullimg="${escapeHtml(u)}" />`
                    )
                    .join("")}
                </div>`
              : ""
          }
          <div class="row-wrap mt-sm">
            <button class="btn btn-dark btn-xs" data-open-fortune="${idx}" type="button">📖 Tam Yorumu Gör</button>
            <span class="tiny-muted">Belge ID: <code>${escapeHtml(f.id)}</code></span>
          </div>
        </div>
      `;
    })
    .join("");

  box.querySelectorAll("[data-fullimg]").forEach((img) => {
    img.addEventListener("click", () => {
      openDetailModal(
        "Gönderilen Fal Fotoğrafı",
        `<div style="text-align:center"><img src="${escapeHtml(img.dataset.fullimg)}" style="max-width:100%;border-radius:14px;" /></div>`
      );
    });
  });

  box.querySelectorAll("[data-open-fortune]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const f = list[Number(btn.dataset.openFortune)];
      if (f) openFortuneDetailModal(f);
    });
  });
}

// Inspector Subtabs switching
document.querySelectorAll("#inspectorTabs .subtab").forEach((btn) => {
  btn.addEventListener("click", () => switchInspectorTab(btn.dataset.itab));
});

$("copyInspOwnerIdBtn").addEventListener("click", () => {
  if (selectedUserId) copyText(selectedUserId, "Owner ID kopyalandı");
});

// Quick +Jeton Chips
document.querySelectorAll("[data-quick-jeton]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!selectedUserId) return;
    const delta = parseInt(btn.dataset.quickJeton, 10);
    await applyJetonChange(
      selectedUserId,
      "delta",
      delta,
      `Hesabınıza +${delta} jeton tanımlandı! Keyifli fallar dileriz ✨`,
      true
    );
  });
});

$("customJetonForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedUserId) return;
  const mode = $("jetonOpMode").value;
  const amount = parseInt($("customJetonAmount").value, 10);
  const note = $("customJetonNote").value.trim();
  const notify = $("sendGiftPushCheck").checked;
  if (Number.isNaN(amount)) return;

  await applyJetonChange(selectedUserId, mode, amount, note, notify);
  $("customJetonNote").value = "";
});

async function applyJetonChange(targetUid, mode, amount, customNote, notifyUser) {
  const ref = doc(db, "owners", targetUid);
  const payload = { ownerId: targetUid };

  let actionTitle = "";
  let defaultMsg = "";

  if (mode === "exact") {
    payload.jeton = Math.max(0, amount);
    actionTitle = `Jeton Sabitlendi (= ${payload.jeton})`;
    defaultMsg = `Jeton bakiyeniz ${payload.jeton} olarak güncellendi ✨`;
  } else {
    payload.jeton = increment(amount);
    const sign = amount >= 0 ? `+${amount}` : `${amount}`;
    actionTitle = `Jeton ${sign}`;
    defaultMsg =
      amount > 0
        ? `Hesabınıza +${amount} jeton tanımlandı! Keyifli fallar dileriz ✨`
        : `Jeton bakiyeniz güncellendi (${sign}).`;
  }

  const finalNote = customNote || defaultMsg;
  if (notifyUser && amount > 0) {
    payload.lastAdminGiftAt = Date.now();
    payload.lastAdminGiftMessage = finalNote;
  }

  await setDoc(ref, payload, { merge: true });
  await addDoc(collection(db, "admin_logs"), {
    targetOwnerId: targetUid,
    action: actionTitle,
    note: finalNote,
    notifyUser: Boolean(notifyUser),
    adminEmail: currentAdminUser?.email || "admin",
    createdAtMs: Date.now()
  });

  showToast(`${actionTitle} başarıyla uygulandı! 🪙`);
  refreshDashboardStats();
}

// VIP Controls
document.querySelectorAll("[data-vip-days]").forEach((btn) => {
  btn.addEventListener("click", async () => {
    if (!selectedUserId) return;
    const days = parseInt(btn.dataset.vipDays, 10);
    const ref = doc(db, "owners", selectedUserId);
    const curBadges = Array.isArray(selectedOwnerData?.badges) ? [...selectedOwnerData.badges] : [];

    if (days <= 0) {
      const nextBadges = curBadges.filter((b) => b !== "premium");
      await setDoc(
        ref,
        {
          premiumExpiryDate: Timestamp.fromMillis(0),
          badges: nextBadges
        },
        { merge: true }
      );
      await addDoc(collection(db, "admin_logs"), {
        targetOwnerId: selectedUserId,
        action: "VIP Kaldırıldı",
        note: "VIP üyelik sonlandırıldı",
        adminEmail: currentAdminUser?.email || "admin",
        createdAtMs: Date.now()
      });
      showToast("VIP üyelik kaldırıldı.");
    } else {
      const curExp = Math.max(Date.now(), toMs(selectedOwnerData?.premiumExpiryDate));
      const newExpMs = curExp + days * 86400 * 1000;
      if (!curBadges.includes("premium")) curBadges.push("premium");
      const msg = `Hesabınıza ${days} günlük Falkız VIP Premium ayrıcalığı tanımlandı! 👑`;
      await setDoc(
        ref,
        {
          premiumExpiryDate: Timestamp.fromMillis(newExpMs),
          badges: curBadges,
          lastAdminGiftAt: Date.now(),
          lastAdminGiftMessage: msg
        },
        { merge: true }
      );
      await addDoc(collection(db, "admin_logs"), {
        targetOwnerId: selectedUserId,
        action: `+${days} Gün VIP Verildi`,
        note: msg,
        adminEmail: currentAdminUser?.email || "admin",
        createdAtMs: Date.now()
      });
      showToast(`+${days} Gün VIP tanımlandı ve bildirim gönderildi! 👑`);
    }
  });
});

async function toggleOwnerBadge(badgeName) {
  if (!selectedUserId) return;
  const cur = Array.isArray(selectedOwnerData?.badges) ? [...selectedOwnerData.badges] : [];
  const next = cur.includes(badgeName) ? cur.filter((b) => b !== badgeName) : [...cur, badgeName];
  await setDoc(doc(db, "owners", selectedUserId), { badges: next }, { merge: true });
  showToast(`Rozet güncellendi: ${badgeName}`);
}

$("toggleGoldBadgeBtn").addEventListener("click", () => toggleOwnerBadge("gold"));
$("toggleDevBadgeBtn").addEventListener("click", () => toggleOwnerBadge("developer"));

$("toggleBanUserBtn").addEventListener("click", async () => {
  if (!selectedUserId) return;
  const nextBan = !(selectedOwnerData?.isBanned === true);
  await setDoc(doc(db, "owners", selectedUserId), { isBanned: nextBan }, { merge: true });
  showToast(nextBan ? "Kullanıcı genel sohbetten yasaklandı 🚫" : "Kullanıcının sohbet engeli kaldırıldı ✅");
});

// ============================================================================
// 7. LIVE SUPPORT DESK (CANLI DESTEK)
// ============================================================================
function startSupportTicketsRealtime() {
  if (unsubSupportTickets) unsubSupportTickets();

  unsubSupportTickets = onSnapshot(collection(db, "support_tickets"), (snap) => {
    allSupportTickets = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.updatedAt || b.createdAt || 0) - (a.updatedAt || a.createdAt || 0));

    const openCount = allSupportTickets.filter(
      (t) => (t.status || "open") === "open" || t.unreadByAdmin === true
    ).length;

    $("kpiOpenTickets").textContent = String(openCount);
    const badge = $("navSupportBadge");
    badge.textContent = String(openCount);
    badge.classList.toggle("hidden", openCount === 0);

    renderDashboardRecentTickets();
    renderSupportTicketQueue();

    if (activeTicketId) {
      const updated = allSupportTickets.find((t) => t.id === activeTicketId);
      if (updated) renderActiveSupportThread(updated, false);
    }
  });
}

function renderDashboardRecentTickets() {
  const box = $("dashRecentTickets");
  const slice = allSupportTickets.slice(0, 6);
  if (!slice.length) {
    box.innerHTML = `<div class="tiny-muted">Henüz destek talebi bulunmuyor.</div>`;
    return;
  }
  box.innerHTML = slice
    .map((t) => {
      const st = t.status || "open";
      const pillCls = st === "open" ? "pill-gold" : st === "resolved" ? "pill" : "pill-success";
      return `
        <div class="compact-item" style="cursor:pointer" data-dash-ticket="${escapeHtml(t.id)}">
          <div>
            <strong>${escapeHtml(t.userName || t.email || t.ownerId?.slice(0, 10))}</strong>
            <span class="pill ${pillCls}">${escapeHtml(categoryName(t.category))}</span>
            <div class="tiny-muted">${escapeHtml((t.lastMessage || "").slice(0, 80))}</div>
          </div>
          <span class="tiny-muted">${formatRelative(t.updatedAt || t.createdAt)}</span>
        </div>`;
    })
    .join("");

  box.querySelectorAll("[data-dash-ticket]").forEach((el) => {
    el.addEventListener("click", () => {
      switchSection("support");
      openSupportTicket(el.dataset.dashTicket);
    });
  });
}

document.querySelectorAll("#ticketFilterTabs .ftab").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentTicketFilter = btn.dataset.tfilter;
    document.querySelectorAll("#ticketFilterTabs .ftab").forEach((b) =>
      b.classList.toggle("active", b.dataset.tfilter === currentTicketFilter)
    );
    renderSupportTicketQueue();
  });
});

$("ticketSearchInput").addEventListener("input", () => renderSupportTicketQueue());

function renderSupportTicketQueue() {
  const q = $("ticketSearchInput").value.trim().toLowerCase();
  const filtered = allSupportTickets.filter((t) => {
    const st = t.status || "open";
    if (currentTicketFilter !== "all" && st !== currentTicketFilter) return false;
    if (!q) return true;
    const hay = `${t.ownerId || ""} ${t.email || ""} ${t.userName || ""} ${t.lastMessage || ""}`.toLowerCase();
    return hay.includes(q);
  });

  const listEl = $("supportTicketsList");
  if (!filtered.length) {
    listEl.innerHTML = `<div class="tiny-muted" style="padding:14px">Bu sekmede gösterilecek destek talebi yok.</div>`;
    return;
  }

  listEl.innerHTML = filtered
    .map((t) => {
      const isUnread = t.unreadByAdmin === true || (t.status || "open") === "open";
      const activeCls = t.id === activeTicketId ? " active" : "";
      const unreadCls = isUnread ? " unread" : "";
      const stLabel =
        t.status === "replied" ? "Yanıtlandı" : t.status === "resolved" ? "Çözüldü" : "Bekliyor";
      const stPill =
        t.status === "replied" ? "pill-success" : t.status === "resolved" ? "" : "pill-gold";

      return `
        <div class="ticket-card${activeCls}${unreadCls}" data-tid="${escapeHtml(t.id)}">
          <div class="user-row-top">
            <span>${escapeHtml(t.userName || t.email || (t.ownerId || "").slice(0, 12))}</span>
            <span class="pill ${stPill}">${stLabel}</span>
          </div>
          <div class="tiny-muted mt-xs">${escapeHtml(categoryName(t.category))} · ${formatRelative(t.updatedAt || t.createdAt)}</div>
          <div class="small muted mt-xs">${escapeHtml((t.lastMessage || "").slice(0, 95))}</div>
        </div>`;
    })
    .join("");

  listEl.querySelectorAll(".ticket-card").forEach((card) => {
    card.addEventListener("click", () => openSupportTicket(card.dataset.tid));
  });
}

function openSupportTicket(ticketId) {
  activeTicketId = ticketId;
  renderSupportTicketQueue();
  const ticket = allSupportTickets.find((t) => t.id === ticketId);
  if (!ticket) return;

  if (ticket.unreadByAdmin) {
    updateDoc(doc(db, "support_tickets", ticketId), { unreadByAdmin: false }).catch(() => {});
  }

  renderActiveSupportThread(ticket, true);
}

function renderActiveSupportThread(t, rebindOwnerBalance) {
  $("supportEmptyThread").classList.add("hidden");
  $("supportActiveThread").classList.remove("hidden");

  $("thUserName").textContent = t.userName || t.email || "Falkız Kullanıcısı";
  $("thCategoryPill").textContent = categoryName(t.category);
  const st = t.status || "open";
  $("thStatusPill").textContent =
    st === "replied" ? "Yanıtlandı" : st === "resolved" ? "Çözüldü" : "Bekliyor";
  $("thStatusPill").className =
    "pill " + (st === "replied" ? "pill-success" : st === "resolved" ? "" : "pill-gold");

  $("thOwnerId").textContent = t.ownerId || "—";
  $("thUserEmail").textContent = t.email || "—";
  $("thDeviceMeta").textContent = `${t.deviceModel || "Android"} (v${t.appVersion || "2.0"})`;
  $("thResolveBtn").textContent = st === "resolved" ? "🔄 Yeniden Aç" : "✅ Çözüldü İşaretle";

  if (rebindOwnerBalance) {
    if (unsubTicketOwnerBalance) {
      unsubTicketOwnerBalance();
      unsubTicketOwnerBalance = null;
    }
    if (t.ownerId) {
      unsubTicketOwnerBalance = onSnapshot(doc(db, "owners", t.ownerId), (snap) => {
        $("thLiveJeton").textContent = snap.exists() ? String(snap.data().jeton ?? 0) : "0";
      });
    }
  }

  const msgs = Array.isArray(t.messages) ? t.messages : [];
  const msgBox = $("thMessagesBox");
  msgBox.innerHTML = msgs
    .map((m) => {
      const isAdmin = m.sender === "admin";
      const cls = isAdmin ? "admin" : "user";
      const who = isAdmin ? m.senderName || "Falkız Destek" : m.senderName || t.userName || "Kullanıcı";
      return `
        <div class="msg-bubble ${cls}">
          <div class="msg-meta">${escapeHtml(who)} · ${formatTs(m.timestamp)}</div>
          <div>${escapeHtml(m.text || "")}</div>
        </div>`;
    })
    .join("");
  msgBox.scrollTop = msgBox.scrollHeight;
}

$("thCopyOwnerBtn").addEventListener("click", () => {
  const t = allSupportTickets.find((x) => x.id === activeTicketId);
  if (t?.ownerId) copyText(t.ownerId, "Owner ID kopyalandı");
});

$("thOpenUserBtn").addEventListener("click", async () => {
  const t = allSupportTickets.find((x) => x.id === activeTicketId);
  if (!t?.ownerId) return;
  switchSection("users");
  await selectUser(t.ownerId);
});

$("thQuickJetonBtn").addEventListener("click", () => {
  $("thInlineJetonBar").classList.toggle("hidden");
});
$("thCancelQuickJetonBtn").addEventListener("click", () => {
  $("thInlineJetonBar").classList.add("hidden");
});

$("thConfirmQuickJetonBtn").addEventListener("click", async () => {
  const t = allSupportTickets.find((x) => x.id === activeTicketId);
  if (!t?.ownerId) return;
  const amt = parseInt($("thQuickJetonAmount").value, 10);
  if (Number.isNaN(amt) || amt <= 0) return;

  await applyJetonChange(
    t.ownerId,
    "delta",
    amt,
    `Destek talebiniz üzerine hesabınıza +${amt} jeton tanımlandı! ✨`,
    true
  );
  $("thInlineJetonBar").classList.add("hidden");
  $("ticketReplyInput").value = `Merhaba! Talebinizi inceledik ve +${amt} jetonunuzu hesabınıza tanımladık. Keyifli fallar dileriz ✨`;
});

$("thResolveBtn").addEventListener("click", async () => {
  const t = allSupportTickets.find((x) => x.id === activeTicketId);
  if (!t) return;
  const nextStatus = t.status === "resolved" ? "open" : "resolved";
  await updateDoc(doc(db, "support_tickets", t.id), {
    status: nextStatus,
    unreadByAdmin: false,
    updatedAt: Date.now()
  });
  showToast(nextStatus === "resolved" ? "Talep çözüldü olarak işaretlendi ✅" : "Talep yeniden açıldı.");
});

document.querySelectorAll(".canned-chip").forEach((chip) => {
  chip.addEventListener("click", () => {
    $("ticketReplyInput").value = chip.dataset.canned;
    $("ticketReplyInput").focus();
  });
});

$("ticketReplyForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = allSupportTickets.find((x) => x.id === activeTicketId);
  if (!t) return;
  const replyText = $("ticketReplyInput").value.trim();
  if (!replyText) return;

  const btn = $("ticketReplySubmitBtn");
  btn.disabled = true;

  try {
    const now = Date.now();
    const curMessages = Array.isArray(t.messages) ? [...t.messages] : [];
    curMessages.push({
      sender: "admin",
      senderName: "Falkız Destek",
      text: replyText,
      timestamp: now
    });

    await updateDoc(doc(db, "support_tickets", t.id), {
      messages: curMessages,
      lastMessage: replyText,
      lastAdminMessage: replyText,
      lastAdminReplyAt: now,
      status: "replied",
      unreadByUser: true,
      unreadByAdmin: false,
      updatedAt: now
    });

    await addDoc(collection(db, "admin_logs"), {
      targetOwnerId: t.ownerId || "",
      action: "Destek Yanıtı",
      note: replyText.slice(0, 120),
      adminEmail: currentAdminUser?.email || "admin",
      createdAtMs: now
    });

    $("ticketReplyInput").value = "";
    showToast("Yanıt gönderildi! Kullanıcının uygulamasına bildirim iletildi 🔔");
  } catch (err) {
    showToast("Yanıt gönderilemedi: " + (err.message || ""), true);
  } finally {
    btn.disabled = false;
  }
});

// ============================================================================
// 8. GLOBAL CHAT LIVE MODERATION
// ============================================================================
function startGlobalChatListener() {
  const q = query(collection(db, "global_chat"), orderBy("timestamp", "desc"), limit(60));
  unsubGlobalChat = onSnapshot(q, (snap) => {
    const list = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const wrap = $("globalChatAdminList");
    if (!list.length) {
      wrap.innerHTML = `<div class="tiny-muted">Sohbet mesajı bulunamadı.</div>`;
      return;
    }

    wrap.innerHTML = list
      .map(
        (m) => `
        <div class="chat-mod-row">
          <div>
            <div class="row-wrap">
              <strong>${escapeHtml(m.senderName || "Anonim")}</strong>
              <code class="tiny-muted" style="cursor:pointer" data-chat-uid="${escapeHtml(m.senderId || "")}">${escapeHtml(m.senderId || "")}</code>
              <span class="tiny-muted">${formatRelative(m.timestamp || m.clientTimestamp)} · ${formatTs(m.timestamp || m.clientTimestamp)}</span>
            </div>
            <div class="mt-xs">${escapeHtml(m.messageText || (m.sharedFortune ? "🔮 [Paylaşılan Fal]" : ""))}</div>
          </div>
          <div class="row-wrap">
            <button class="btn btn-dark btn-xs" data-inspect-chat-uid="${escapeHtml(m.senderId || "")}" type="button">🔍 Kullanıcı</button>
            <button class="btn btn-danger-soft btn-xs" data-del-chat="${escapeHtml(m.id)}" type="button">🗑️ Sil</button>
          </div>
        </div>`
      )
      .join("");

    wrap.querySelectorAll("[data-inspect-chat-uid]").forEach((b) => {
      b.addEventListener("click", () => {
        if (!b.dataset.inspectChatUid) return;
        switchSection("users");
        selectUser(b.dataset.inspectChatUid);
      });
    });

    wrap.querySelectorAll("[data-del-chat]").forEach((b) => {
      b.addEventListener("click", async () => {
        await deleteDoc(doc(db, "global_chat", b.dataset.delChat));
        showToast("Sohbet mesajı silindi 🗑️");
      });
    });
  });
}

// ============================================================================
// 9. PROMO CODES & GLOBAL PURCHASES
// ============================================================================
async function loadPromoCodesAndGlobalPurchases() {
  try {
    const snap = await getDocs(collection(db, "promo_codes"));
    const promos = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    const wrap = $("promoCodesListWrap");
    if (!promos.length) {
      wrap.innerHTML = `<div class="tiny-muted">Henüz promosyon kodu yok.</div>`;
    } else {
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Kod</th><th>Jeton</th><th>Kalan Hak</th><th>Durum</th><th>İşlem</th></tr></thead>
          <tbody>
            ${promos
              .map(
                (p) => `
                <tr>
                  <td><strong>${escapeHtml(p.code || p.id)}</strong></td>
                  <td><span class="pill pill-gold">+${escapeHtml(p.jetonAmount ?? p.reward ?? 0)}</span></td>
                  <td>${escapeHtml(p.remainingUsage ?? p.maxUses ?? "—")}</td>
                  <td>${p.isActive === false ? `<span class="pill pill-danger">Pasif</span>` : `<span class="pill pill-success">Aktif</span>`}</td>
                  <td>
                    <button class="btn btn-ghost btn-xs" data-toggle-promo="${escapeHtml(p.id)}" data-cur="${p.isActive !== false}" type="button">
                      ${p.isActive === false ? "Aktif Et" : "Durdur"}
                    </button>
                  </td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

      wrap.querySelectorAll("[data-toggle-promo]").forEach((b) => {
        b.addEventListener("click", async () => {
          const next = b.dataset.cur !== "true";
          await setDoc(doc(db, "promo_codes", b.dataset.togglePromo), { isActive: next }, { merge: true });
          showToast("Promosyon kodu durumu güncellendi.");
          loadPromoCodesAndGlobalPurchases();
        });
      });
    }
  } catch (_) {}

  try {
    const purSnap = await getDocs(query(collectionGroup(db, "purchases"), limit(40)));
    const rows = purSnap.docs
      .map((d) => {
        const ownerIdFromPath = d.ref.parent?.parent?.id || "";
        return { id: d.id, ownerId: ownerIdFromPath, ...d.data() };
      })
      .sort((a, b) => toMs(b.verifiedAt || b.purchaseTime || b.createdAt) - toMs(a.verifiedAt || a.purchaseTime || a.createdAt));

    const gWrap = $("globalPurchasesWrap");
    if (!rows.length) {
      gWrap.innerHTML = `<div class="tiny-muted">Kayıtlı satın alım bulunamadı.</div>`;
    } else {
      gWrap.innerHTML = `
        <table>
          <thead><tr><th>Kullanıcı / Owner ID</th><th>Paket</th><th>Jeton / Plan</th><th>Tarih</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
                <tr>
                  <td><button class="btn-inline-link" data-jump-uid="${escapeHtml(r.ownerId)}" type="button">${escapeHtml(resolveDisplayName(r.ownerId, ownerDocCache.get(r.ownerId)))} (${escapeHtml(r.ownerId.slice(0, 8))}…)</button></td>
                  <td>${escapeHtml(r.sku || r.productId || r.planId || "Paket")}</td>
                  <td><span class="pill pill-gold">${escapeHtml(r.jetonGranted || r.coins || "VIP")}</span></td>
                  <td>${formatTs(r.verifiedAt || r.purchaseTime || r.createdAt)}</td>
                </tr>`
              )
              .join("")}
          </tbody>
        </table>`;

      gWrap.querySelectorAll("[data-jump-uid]").forEach((b) => {
        b.addEventListener("click", () => {
          switchSection("users");
          selectUser(b.dataset.jumpUid);
        });
      });
    }
  } catch (err) {
    $("globalPurchasesWrap").innerHTML = `<div class="tiny-muted">Satın alımlar kullanıcı detay kartından incelenebilir.</div>`;
  }
}

$("createPromoForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const code = $("promoCodeNameInput").value.trim().toUpperCase();
  const jetonAmount = parseInt($("promoJetonInput").value, 10);
  const remainingUsage = parseInt($("promoLimitInput").value, 10);
  if (!code || Number.isNaN(jetonAmount) || Number.isNaN(remainingUsage)) return;

  await setDoc(doc(db, "promo_codes", code), {
    code,
    jetonAmount,
    reward: jetonAmount,
    remainingUsage,
    maxUses: remainingUsage,
    isActive: true,
    createdAt: serverTimestamp()
  });

  $("createPromoForm").reset();
  showToast(`"${code}" promosyon kodu aktif edildi! 🎁`);
  loadPromoCodesAndGlobalPurchases();
});

// ============================================================================
// 10. DETAIL MODAL
// ============================================================================
function openDetailModal(title, htmlBody) {
  $("detailModalTitle").textContent = title;
  $("detailModalBody").innerHTML = htmlBody;
  $("detailModal").classList.remove("hidden");
}

$("closeDetailModalBtn").addEventListener("click", () => {
  $("detailModal").classList.add("hidden");
});
$("detailModal").addEventListener("click", (e) => {
  if (e.target === $("detailModal")) $("detailModal").classList.add("hidden");
});

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

let allSupportTickets = [];
let currentTicketFilter = "open";
let activeTicketId = null;

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

function formatTs(val) {
  if (!val) return "—";
  let ms = 0;
  if (typeof val === "number") {
    ms = val < 1e12 ? val * 1000 : val;
  } else if (typeof val?.toMillis === "function") {
    ms = val.toMillis();
  } else if (typeof val?.seconds === "number") {
    ms = val.seconds * 1000;
  } else {
    const parsed = Date.parse(String(val));
    if (!Number.isNaN(parsed)) ms = parsed;
  }
  if (!ms) return String(val);
  return new Date(ms).toLocaleString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function toMs(val) {
  if (!val) return 0;
  if (typeof val === "number") return val < 1e12 ? val * 1000 : val;
  if (typeof val?.toMillis === "function") return val.toMillis();
  if (typeof val?.seconds === "number") return val.seconds * 1000;
  return 0;
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
    ayak: "🦶 Ayak Falı"
  };
  return map[type] || (type || "Fal");
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

  // Verify admin permission
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

  // Ensure admin owner doc has developer/admin badges cleanly
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

document.querySelectorAll(".nav-item").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});
document.querySelectorAll("[data-goto]").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.goto));
});

$("kpiCardSupport").addEventListener("click", () => switchSection("support"));
$("kpiCardUsers").addEventListener("click", () => {
  switchSection("users");
  loadRecentOwners();
});
$("kpiCardPurchases").addEventListener("click", () => switchSection("promos"));
$("kpiCardPromos").addEventListener("click", () => switchSection("promos"));

$("refreshAllBtn").addEventListener("click", () => {
  refreshDashboardStats();
  if (selectedUserId) loadSelectedUserExtraTabs(selectedUserId);
  showToast("Veriler yenilendi ↻");
});

function cleanupRealtimeListeners() {
  if (unsubSelectedOwner) { unsubSelectedOwner(); unsubSelectedOwner = null; }
  if (unsubSupportTickets) { unsubSupportTickets(); unsubSupportTickets = null; }
  if (unsubTicketOwnerBalance) { unsubTicketOwnerBalance(); unsubTicketOwnerBalance = null; }
  if (unsubGlobalChat) { unsubGlobalChat(); unsubGlobalChat = null; }
}

function bootAdminWorkspace() {
  startSupportTicketsRealtime();
  refreshDashboardStats();
  loadRecentOwners();
}

// ============================================================================
// 3. DASHBOARD STATS & QUICK GRANT BY OWNER ID
// ============================================================================
async function refreshDashboardStats() {
  // Admin Logs
  try {
    const logsSnap = await getDocs(query(collection(db, "admin_logs"), limit(30)));
    const logs = logsSnap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a, b) => (b.createdAtMs || 0) - (a.createdAtMs || 0))
      .slice(0, 8);

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
            <span class="tiny-muted">${formatTs(l.createdAtMs)}</span>
          </div>`
        )
        .join("");
    }
  } catch (_) {}

  // Promo count
  try {
    const pSnap = await getDocs(collection(db, "promo_codes"));
    const activeCount = pSnap.docs.filter((d) => d.data().isActive !== false && (d.data().remainingUsage ?? 1) > 0).length;
    $("kpiActivePromos").textContent = String(activeCount);
  } catch (_) {}

  // Global Purchases KPI
  try {
    const purSnap = await getDocs(query(collectionGroup(db, "purchases"), limit(50)));
    $("kpiRecentPurchases").textContent = `${purSnap.size}+`;
  } catch (_) {
    $("kpiRecentPurchases").textContent = "Aktif";
  }

  // Recent Owners KPI
  try {
    const oSnap = await getDocs(query(collection(db, "owners"), limit(50)));
    $("kpiRecentUsers").textContent = `${oSnap.size}+`;
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
    // Jump to user inspector to confirm visually
    switchSection("users");
    await selectUser(uid);
  } catch (err) {
    showToast("Jeton tanımlanırken hata oluştu: " + (err.message || ""), true);
  }
});

// ============================================================================
// 4. INSTANT O(1) OWNER ID & MULTI-FIELD USER SEARCH
// ============================================================================
$("globalQuickSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("globalQuickSearchInput").value.trim();
  if (!q) return;
  switchSection("users");
  $("userSearchInput").value = q;
  await performUserSearch(q);
});

$("userSearchForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const q = $("userSearchInput").value.trim();
  if (!q) {
    await loadRecentOwners();
    return;
  }
  await performUserSearch(q);
});

$("loadRecentOwnersBtn").addEventListener("click", () => loadRecentOwners());

async function loadRecentOwners() {
  $("userSearchMeta").textContent = "Kullanıcılar yükleniyor…";
  try {
    const snap = await getDocs(query(collection(db, "owners"), limit(40)));
    const items = snap.docs
      .map((d) => ({ uid: d.id, ...d.data() }))
      .sort((a, b) => toMs(b.lastSeenAt || b.createdAt) - toMs(a.lastSeenAt || a.createdAt));
    $("userSearchMeta").textContent = `${items.length} kayıt listelendi.`;
    renderUserResultsList(items);
  } catch (err) {
    $("userSearchMeta").textContent = "Kullanıcı listesi alınamadı.";
  }
}

async function performUserSearch(rawQuery) {
  const q = rawQuery.trim();
  const qLower = q.toLowerCase();
  $("userSearchMeta").textContent = `"${q}" aranıyor…`;

  const foundMap = new Map();
  const addOwnerDoc = (snap) => {
    if (snap && snap.exists()) {
      foundMap.set(snap.id, { uid: snap.id, ...snap.data() });
    }
  };

  // Run O(1) document ID lookup + email + username + deviceId + sub-profile name in parallel!
  const tasks = [
    getDoc(doc(db, "owners", q)).then(addOwnerDoc),
    getDocs(query(collection(db, "owners"), where("ownerId", "==", q), limit(10))).then((s) => s.docs.forEach(addOwnerDoc)),
    getDocs(query(collection(db, "owners"), where("email", "==", q), limit(10))).then((s) => s.docs.forEach(addOwnerDoc)),
    getDocs(query(collection(db, "owners"), where("emailLower", "==", qLower), limit(10))).then((s) => s.docs.forEach(addOwnerDoc)),
    getDocs(query(collection(db, "owners"), where("deviceId", "==", q), limit(10))).then((s) => s.docs.forEach(addOwnerDoc)),
    getDocs(
      query(
        collection(db, "owners"),
        where("userNameLower", ">=", qLower),
        where("userNameLower", "<=", qLower + "\uf8ff"),
        limit(12)
      )
    ).then((s) => s.docs.forEach(addOwnerDoc)),
    getDocs(
      query(
        collection(db, "users"),
        where("name", ">=", q),
        where("name", "<=", q + "\uf8ff"),
        limit(12)
      )
    ).then(async (uSnap) => {
      const ownerIds = [...new Set(uSnap.docs.map((d) => d.data().ownerId).filter(Boolean))];
      await Promise.allSettled(
        ownerIds.map((oid) =>
          getDoc(doc(db, "owners", oid)).then((oDoc) => {
            if (oDoc.exists()) {
              const matchedProfile = uSnap.docs.find((u) => u.data().ownerId === oid)?.data();
              foundMap.set(oDoc.id, {
                uid: oDoc.id,
                _matchedSubName: matchedProfile?.name,
                ...oDoc.data()
              });
            }
          })
        )
      );
    })
  ];

  await Promise.allSettled(tasks);

  const results = Array.from(foundMap.values());
  $("userSearchMeta").textContent = results.length
    ? `${results.length} eşleşen kullanıcı bulundu.`
    : `"${q}" için eşleşen kullanıcı bulunamadı.`;

  renderUserResultsList(results);
  if (results.length > 0) {
    await selectUser(results[0].uid);
  }
}

function renderUserResultsList(items) {
  const wrap = $("userResultsList");
  if (!items.length) {
    wrap.innerHTML = `<div class="tiny-muted">Sonuç yok.</div>`;
    return;
  }

  wrap.innerHTML = items
    .map((u) => {
      const title = u.userName || u._matchedSubName || u.email || u.uid.slice(0, 14) + "…";
      const coins = u.jeton ?? 0;
      const activeCls = u.uid === selectedUserId ? " active" : "";
      return `
        <div class="user-row-item${activeCls}" data-uid="${escapeHtml(u.uid)}">
          <div class="user-row-top">
            <span>${escapeHtml(title)}</span>
            <span class="pill pill-gold">🪙 ${escapeHtml(coins)}</span>
          </div>
          <div class="user-row-sub">${escapeHtml(u.email || "E-posta kayıtlı değil")}</div>
          <div class="user-row-sub">ID: ${escapeHtml(u.uid)}</div>
        </div>
      `;
    })
    .join("");

  wrap.querySelectorAll(".user-row-item").forEach((row) => {
    row.addEventListener("click", () => selectUser(row.dataset.uid));
  });
}

// ============================================================================
// 5. 360° USER INSPECTOR & JETON / VIP / MODERATION ACTIONS
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
    renderSelectedOwnerHeaderAndProfile(uid, selectedOwnerData);
  });

  await loadSelectedUserExtraTabs(uid);
}

function renderSelectedOwnerHeaderAndProfile(uid, d) {
  $("inspAvatar").src = d.profileImageUrl || DEFAULT_AVATAR;
  $("inspDisplayName").textContent = d.userName || d.email?.split("@")[0] || "Falkız Kullanıcısı";
  $("inspEmail").textContent = d.email || "E-posta alanı mevcut değil (Eski kayıt veya Google/Anonim)";
  $("inspOwnerId").textContent = uid;
  $("inspJetonCount").textContent = String(d.jeton ?? 0);
  $("inspAdCount").textContent = String(d.adWatchCount ?? 0);

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

  // Key-Value Profile Grid
  const kvPairs = [
    ["Owner ID (UID)", uid],
    ["E-posta", d.email || "—"],
    ["Kullanıcı Adı", d.userName || "—"],
    ["Mevcut Jeton", String(d.jeton ?? 0)],
    ["VIP Bitiş Tarihi", expMs ? formatTs(expMs) : "Yok"],
    ["Rozetler", badges.length ? badges.join(", ") : "Yok"],
    ["Cihaz ID (deviceId)", d.deviceId || "—"],
    ["Bildirim Token (FCM)", d.fcmToken ? "✅ Kayıtlı (" + String(d.fcmToken).slice(0, 14) + "…)" : "Yok"],
    ["Reklam İzleme Sayısı", String(d.adWatchCount ?? 0)],
    ["Son Reklam İzleme", formatTs(d.lastAdWatchTime)],
    ["Günlük Ücretsiz Kahve", String(d.dailyFreeCoffeeCount ?? 0)],
    ["Seri (Streak)", String(d.streakCount ?? 0)],
    ["Profil Gizli mi?", d.isProfilePrivate ? "Evet" : "Hayır"],
    ["Sohbet Engeli", banned ? "Engelli" : "Açık"],
    ["Son Görülme", formatTs(d.lastSeenAt)],
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
      if (list.length && !selectedOwnerData?.userName && list[0].name) {
        $("inspDisplayName").textContent = list[0].name;
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

  // 3. Ads History
  getDocs(query(collection(db, "ad_usage"), where("ownerId", "==", uid)))
    .then((snap) => {
      const ads = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAtMs || toMs(b.createdAt)) - (a.createdAtMs || toMs(a.createdAt)));

      if (ads.length > (selectedOwnerData?.adWatchCount ?? 0)) {
        $("inspAdCount").textContent = String(ads.length);
      }

      $("inspAdsSummary").innerHTML = `
        <span class="pill pill-gold">Toplam Sayaç: ${escapeHtml(selectedOwnerData?.adWatchCount ?? ads.length)}</span>
        <span class="pill">Kayıtlı Olay: ${ads.length}</span>
        <span class="pill">Son İzleme: ${formatTs(selectedOwnerData?.lastAdWatchTime || ads[0]?.createdAt)}</span>
      `;

      const wrap = $("inspAdsTableWrap");
      if (!ads.length) {
        wrap.innerHTML = `<div class="tiny-muted">Henüz detaylı ödüllü reklam izleme kaydı bulunmuyor.</div>`;
        return;
      }
      wrap.innerHTML = `
        <table>
          <thead><tr><th>Tarih</th><th>Kazanılan Jeton</th><th>Kaynak</th><th>Platform</th></tr></thead>
          <tbody>
            ${ads
              .map(
                (a) => `
                <tr>
                  <td>${formatTs(a.createdAtMs || a.createdAt)}</td>
                  <td><span class="pill pill-gold">+${escapeHtml(a.rewardAmount ?? 1)} Jeton</span></td>
                  <td>${escapeHtml(a.source || "store_rewarded")}</td>
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
      selectedUserFortunes = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a, b) => toMs(b.timestamp || b.createdAt) - toMs(a.timestamp || a.createdAt));
      $("inspFortuneCount").textContent = String(selectedUserFortunes.length);
      renderSelectedUserFortunes();
    })
    .catch(() => {});
}

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
        ? f.imageUrls
        : f.imageUrl
        ? [f.imageUrl]
        : [];
      const snippet = (f.comment || "").slice(0, 220) + ((f.comment || "").length > 220 ? "…" : "");
      const statusBadge =
        f.status === "processing"
          ? `<span class="pill pill-danger">Hazırlanıyor</span>`
          : `<span class="pill pill-success">Tamamlandı</span>`;

      return `
        <div class="fortune-item">
          <div class="card-header">
            <div class="row-wrap">
              <strong>${escapeHtml(fortuneTypeLabel(f.type || "kahve"))}</strong>
              ${statusBadge}
              <span class="tiny-muted">${escapeHtml(f.userName || "")}</span>
            </div>
            <span class="tiny-muted">${formatTs(f.timestamp || f.createdAt)}</span>
          </div>
          <p class="muted small mt-sm">${escapeHtml(snippet || "Yorum metni yok.")}</p>
          ${
            imgs.length
              ? `<div class="fortune-thumbs">
                  ${imgs
                    .map(
                      (u) =>
                        `<img src="${escapeHtml(u)}" alt="Fal fotoğrafı" data-fullimg="${escapeHtml(u)}" />`
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
      if (!f) return;
      let extra = "";
      if (Array.isArray(f.followUps) && f.followUps.length) {
        extra =
          "\n\n--- Takip Soruları ---\n" +
          f.followUps.map((q) => `Soru: ${q.question}\nYanıt: ${q.answer}`).join("\n\n");
      }
      if (Array.isArray(f.messages) && f.messages.length) {
        extra +=
          "\n\n--- Sohbet Geçmişi ---\n" +
          f.messages.map((m) => `[${m.sender}]: ${m.message}`).join("\n");
      }
      openDetailModal(
        `${fortuneTypeLabel(f.type || "kahve")} · ${formatTs(f.timestamp)}`,
        escapeHtml((f.comment || "") + extra)
      );
    });
  });
}

// Inspector Subtabs switching
document.querySelectorAll("#inspectorTabs .subtab").forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.dataset.itab;
    document.querySelectorAll("#inspectorTabs .subtab").forEach((b) =>
      b.classList.toggle("active", b.dataset.itab === key)
    );
    document.querySelectorAll(".itab-pane").forEach((p) =>
      p.classList.toggle("hidden", p.id !== `itab-${key}`)
    );
  });
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
// 6. LIVE SUPPORT DESK (CANLI DESTEK)
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
          <span class="tiny-muted">${formatTs(t.updatedAt || t.createdAt)}</span>
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
          <div class="tiny-muted mt-xs">${escapeHtml(categoryName(t.category))} · ${formatTs(t.updatedAt || t.createdAt)}</div>
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
// 7. GLOBAL CHAT LIVE MODERATION
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
              <span class="tiny-muted">${formatTs(m.timestamp || m.clientTimestamp)}</span>
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
// 8. PROMO CODES & GLOBAL PURCHASES
// ============================================================================
async function loadPromoCodesAndGlobalPurchases() {
  // Promo codes
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

  // Global purchases via collectionGroup
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
          <thead><tr><th>Owner ID</th><th>Paket</th><th>Jeton / Plan</th><th>Tarih</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `
                <tr>
                  <td><button class="btn-inline-link" data-jump-uid="${escapeHtml(r.ownerId)}" type="button">${escapeHtml(r.ownerId.slice(0, 14))}…</button></td>
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
// 9. DETAIL MODAL
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

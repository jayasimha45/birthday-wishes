const AUTH_KEY = "bc_token";

/* ---------- Confetti ---------- */

const confettiCanvas = document.getElementById("confetti-canvas");
const ctx = confettiCanvas.getContext("2d");

let particles = [];
let raf = null;

const COLORS = ["#ff6b6b", "#ff9f43", "#ffd93d", "#6bcb77", "#667eea", "#f2709c", "#4ecdc4"];

function resize() {
  confettiCanvas.width = window.innerWidth;
  confettiCanvas.height = window.innerHeight;
}

function spawnConfetti(amount) {
  for (let i = 0; i < amount; i++) {
    const size = 6 + Math.random() * 8;
    particles.push({
      x: Math.random() * confettiCanvas.width,
      y: -size - Math.random() * window.innerHeight * 0.4,
      w: size,
      h: size * (0.5 + Math.random() * 0.6),
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      vy: 2 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 2,
      rotation: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.2,
    });
  }
}

function tick() {
  ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  particles = particles.filter((p) => p.y < confettiCanvas.height + 20);
  for (const p of particles) {
    p.x += p.vx;
    p.y += p.vy;
    p.rotation += p.vr;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rotation);
    ctx.fillStyle = p.color;
    ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
    ctx.restore();
  }
  if (particles.length) {
    raf = requestAnimationFrame(tick);
  } else {
    ctx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  }
}

function burstConfetti() {
  particles = [];
  spawnConfetti(180);
  if (raf) cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

function celebrate() {
  burstConfetti();
  setTimeout(() => spawnConfetti(120), 500);
  setTimeout(() => spawnConfetti(150), 1100);
  setTimeout(() => spawnConfetti(140), 1800);
}

/* ---------- Wish card ---------- */

const nameField = document.getElementById("name");
const candles = document.querySelectorAll(".candle");
const blowButton = document.getElementById("blow-out");

function relightCandles() {
  candles.forEach((c) => c.querySelector(".flame").classList.remove("extinguished"));
}

function extinguishAll() {
  let lit = 0;
  candles.forEach((c) => {
    const flame = c.querySelector(".flame");
    if (!flame.classList.contains("extinguished")) {
      flame.classList.add("extinguished");
      lit++;
    }
  });
  return lit;
}

candles.forEach((candle) => {
  candle.addEventListener("click", () => {
    const flame = candle.querySelector(".flame");
    if (!flame.classList.contains("extinguished")) {
      flame.classList.add("extinguished");
    }
  });
});

blowButton.addEventListener("click", () => {
  const lit = extinguishAll();
  if (lit) {
    celebrate();
    if ("speechSynthesis" in window) {
      const utter = new SpeechSynthesisUtterance("Hip hip hooray! Happy birthday!");
      utter.pitch = 1.2;
      utter.rate = 1;
      window.speechSynthesis.speak(utter);
    }
  }
});

/* ---------- Auth helpers ---------- */

function getToken() {
  return localStorage.getItem(AUTH_KEY) || "";
}

function setToken(t) {
  if (t) localStorage.setItem(AUTH_KEY, t);
  else localStorage.removeItem(AUTH_KEY);
}

async function api(path, opts = {}) {
  const headers = Object.assign({}, opts.headers || {});
  const token = getToken();
  if (token) headers["Authorization"] = "Bearer " + token;
  return fetch(path, Object.assign({}, opts, { headers }));
}

let currentUser = null;
const authArea = document.getElementById("auth-area");
const authDialog = document.getElementById("auth-dialog");
const authError = document.getElementById("auth-error");
const phonePanel = document.getElementById("auth-panel-phone");
const googlePanel = document.getElementById("auth-panel-google");
const authPhoneInput = document.getElementById("auth-phone");
const authOtpInput = document.getElementById("auth-otp");
const otpBox = document.getElementById("otp-box");
const sendOtpBtn = document.getElementById("send-otp");
const verifyOtpBtn = document.getElementById("verify-otp");
const resendOtpBtn = document.getElementById("resend-otp");

let pendingPhone = "";

function initials(name) {
  return (name || "?")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("");
}

function renderAuthBar(user) {
  currentUser = user;
  authArea.innerHTML = "";
  if (user) {
    const chip = document.createElement("div");
    chip.className = "user-chip";

    let avatar;
    if (user.picture) {
      avatar = document.createElement("img");
      avatar.src = user.picture;
      avatar.alt = user.name || "user";
    } else {
      avatar = document.createElement("div");
      avatar.className = "user-avatar";
      avatar.textContent = initials(user.name || user.phone || "?");
    }

    const label = document.createElement("span");
    label.className = "user-name";
    label.textContent = user.name || user.phone || "Member";

    const logout = document.createElement("button");
    logout.type = "button";
    logout.className = "logout-btn";
    logout.textContent = "Logout";
    logout.addEventListener("click", async () => {
      try { await api("/api/auth/logout", { method: "POST" }); } catch {}
      setToken("");
      renderAuthBar(null);
      renderMembers();
    });

    chip.append(avatar, label, logout);
    authArea.appendChild(chip);
  } else {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "auth-btn";
    btn.textContent = "Sign in / Join";
    btn.addEventListener("click", openAuthDialog);
    authArea.appendChild(btn);
  }
}

function openAuthDialog() {
  authError.textContent = "";
  authOtpInput.value = "";
  otpBox.hidden = true;
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === "phone"));
  phonePanel.hidden = false;
  googlePanel.hidden = true;
  authDialog.showModal();
}

document.getElementById("cancel-auth").addEventListener("click", () => authDialog.close());
authDialog.addEventListener("click", (e) => {
  if (e.target === authDialog) authDialog.close();
});

document.querySelectorAll(".auth-tabs .tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".auth-tabs .tab").forEach((t) => t.classList.toggle("active", t === tab));
    phonePanel.hidden = tab.dataset.tab !== "phone";
    googlePanel.hidden = tab.dataset.tab !== "google";
    authError.textContent = "";
  });
});

function showAuthError(msg) {
  authError.textContent = msg;
}

function clearPhoneState() {
  otpBox.hidden = true;
}

async function requestOtp() {
  const phone = authPhoneInput.value.trim();
  if (!phone) return showAuthError("Enter your phone number with country code.");
  authError.textContent = "";
  sendOtpBtn.disabled = true;
  sendOtpBtn.textContent = "Sending…";
  try {
    const res = await fetch("/api/auth/otp-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not send OTP.");
    pendingPhone = phone;
    otpBox.hidden = false;
    authOtpInput.value = "";
    const hint = document.getElementById("otp-dev-hint");
    if (hint) hint.remove();
    if (data.otp_code) {
      const h = document.createElement("p");
      h.id = "otp-dev-hint";
      h.className = "small";
      h.textContent = "Dev hint: your code is " + data.otp_code;
      otpBox.after(h);
    }
    authError.style.color = "#2e7d32";
    authError.textContent = "OTP sent to " + phone + " via WhatsApp.";
  } catch (err) {
    authError.style.color = "#e74c3c";
    showAuthError(err.message);
  } finally {
    sendOtpBtn.disabled = false;
    sendOtpBtn.textContent = "Send OTP 💬";
  }
}

async function verifyOtp() {
  const otp = authOtpInput.value.trim();
  if (!pendingPhone || !otp) return showAuthError("Enter the 6-digit code.");
  verifyOtpBtn.disabled = true;
  verifyOtpBtn.textContent = "Checking…";
  try {
    const res = await fetch("/api/auth/otp-verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone: pendingPhone, otp }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Verification failed.");
    setToken(data.token);
    authDialog.close();
    renderAuthBar(data.user);
    celebrate();
    if (data.is_new) {
      openRegisterDialog();
    } else {
      renderMembers();
      updateAddButtonLabel();
    }
  } catch (err) {
    authError.style.color = "#e74c3c";
    showAuthError(err.message);
  } finally {
    verifyOtpBtn.disabled = false;
    verifyOtpBtn.textContent = "Verify & continue ✅";
  }
}

sendOtpBtn.addEventListener("click", requestOtp);
resendOtpBtn.addEventListener("click", requestOtp);
verifyOtpBtn.addEventListener("click", verifyOtp);
authOtpInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") verifyOtp();
});

document.getElementById("google-signin").addEventListener("click", () => {
  window.location.href = "/api/auth/google/start";
});

function swallowUrlToken() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token");
  if (token) {
    setToken(token);
    history.replaceState(null, "", window.location.pathname);
  }
  if (params.get("auth_error")) {
    alert("Google sign-in failed. Make sure Google sign-in is enabled in Settings, or try phone OTP.");
  }
}

/* ---------- Birthday Club registry ---------- */

const membersEl = document.getElementById("members");
const countEl = document.getElementById("registry-count");
const addMemberBtn = document.getElementById("add-member");

let people = [];

function todayMD() {
  const d = new Date();
  return d.getMonth() + "-" + d.getDate();
}

function isBirthdayToday(dob) {
  if (!dob) return false;
  const parts = dob.split("-");
  return parts[1] + "-" + parseInt(parts[2], 10) === todayMD();
}

function formatDate(dob) {
  if (!dob) return "Birthday unknown";
  const [y, m, d] = dob.split("-");
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return months[parseInt(m, 10) - 1] + " " + parseInt(d, 10) + ", " + y;
}

function ageFromDob(dob) {
  if (!dob) return 0;
  const today = new Date();
  const [y, m, d] = dob.split("-").map(Number);
  let age = today.getFullYear() - y;
  if (today.getMonth() + 1 < m || (today.getMonth() + 1 === m && today.getDate() < d)) age--;
  return age;
}

function ownPerson() {
  if (!currentUser) return null;
  return people.find((p) => p.user_id === currentUser.id) || null;
}

function renderMembers() {
  membersEl.innerHTML = "";
  countEl.textContent = people.length
    ? people.length + " member" + (people.length === 1 ? "" : "s") + " · " + todayBDCount() + " celebrating today 🎉"
    : "Be the first to join!";

  if (!people.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = "No one has registered yet.";
    membersEl.appendChild(empty);
    return;
  }

  const sortable = [...people].sort((a, b) => {
    const ta = isBirthdayToday(a.dob) ? 0 : 1;
    const tb = isBirthdayToday(b.dob) ? 0 : 1;
    return ta - tb || a.name.localeCompare(b.name);
  });

  const fragment = document.createDocumentFragment();
  sortable.forEach((p) => {
    const isMine = currentUser && p.user_id === currentUser.id;
    const card = document.createElement("div");
    card.className = "member" + (isBirthdayToday(p.dob) ? " celebrating" : "");

    let avatar;
    if (p.photo) {
      avatar = document.createElement("img");
      avatar.src = p.photo;
      avatar.alt = p.name;
      avatar.className = "member-avatar";
      avatar.addEventListener("error", () => {
        avatar.replaceWith(document.createTextNode(initials(p.name)));
      });
    } else {
      avatar = document.createElement("div");
      avatar.className = "member-avatar";
      avatar.textContent = initials(p.name);
    }

    const remove = document.createElement("button");
    remove.className = "member-remove";
    remove.textContent = "✕";
    remove.title = "Remove " + p.name;
    remove.addEventListener("click", () => removeMember(p));

    const name = document.createElement("p");
    name.className = "member-name";
    name.textContent = p.name + (isMine ? " (you)" : "");

    const dob = document.createElement("p");
    dob.className = "member-dob";
    dob.textContent = formatDate(p.dob) + " · turns " + ageFromDob(p.dob);

    const wish = document.createElement("button");
    wish.className = "member-wish";
    wish.textContent = isMine ? "Wish myself 🎁" : "Generate wish 🎁";
    wish.addEventListener("click", () => wishMember(p.name));

    card.appendChild(avatar);
    card.appendChild(remove);
    card.appendChild(name);
    card.appendChild(dob);
    if (isBirthdayToday(p.dob)) {
      const badge = document.createElement("span");
      badge.className = "member-badge";
      badge.textContent = "🎉 It's their birthday!";
      card.appendChild(badge);
    }
    card.appendChild(wish);
    fragment.appendChild(card);
  });
  membersEl.appendChild(fragment);
}

function updateAddButtonLabel() {
  if (currentUser && ownPerson()) addMemberBtn.textContent = "Edit my birthday ✏️";
  else addMemberBtn.textContent = "Register yourself 🗓️";
}

function todayBDCount() {
  return people.filter((p) => isBirthdayToday(p.dob)).length;
}

function wishMember(name) {
  const first = name.split(" ")[0];
  nameField.textContent = first;
  relightCandles();
  celebrate();
  document.getElementById("wish-card").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function removeMember(p) {
  const confirmed = confirm(
    "Remove " + p.name + "'s registration?\nTheir photo and birthday will be deleted."
  );
  if (!confirmed) return;

  try {
    const res = await api("/api/register/" + encodeURIComponent(p.id), { method: "DELETE" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Could not remove.");
    people = data.people;
    renderMembers();
    updateAddButtonLabel();
  } catch (err) {
    alert(err.message);
  }
}

/* ---------- Registration form ---------- */

const dialog = document.getElementById("register-dialog");
const form = document.getElementById("register-form");
const nameInput = document.getElementById("reg-name");
const dobInput = document.getElementById("reg-dob");
const photoInput = document.getElementById("reg-photo");
const photoPreview = document.getElementById("photo-preview");
const formError = document.getElementById("form-error");
const submitBtn = document.getElementById("submit-register");
const cancelBtn = document.getElementById("cancel-register");

function setPhotoPreview(dataUrl) {
  photoPreview.innerHTML = "";
  const img = document.createElement("img");
  img.src = dataUrl;
  img.alt = "Preview";
  photoPreview.appendChild(img);
}

async function loadExistingPreview(url) {
  try {
    const r = await fetch(url);
    const blob = await r.blob();
    const reader = new FileReader();
    reader.onload = () => setPhotoPreview(reader.result);
    reader.readAsDataURL(blob);
  } catch {}
}

function openRegisterDialog() {
  formError.textContent = "";
  form.reset();
  photoPreview.innerHTML = '<span class="placeholder">📷</span>';
  const mine = ownPerson();
  if (mine) {
    nameInput.value = mine.name;
    dobInput.value = mine.dob;
    submitBtn.textContent = "Update my birthday ✏️";
    if (mine.photo) loadExistingPreview(mine.photo);
    else photoPreview.innerHTML = '<span class="placeholder">📷</span>';
  } else {
    if (currentUser && currentUser.name && /[A-Za-z]/.test(currentUser.name)) {
      nameInput.value = currentUser.name;
    }
    submitBtn.textContent = "Save me! 🎂";
  }
  dialog.showModal();
}

addMemberBtn.addEventListener("click", openRegisterDialog);
cancelBtn.addEventListener("click", () => dialog.close());
dialog.addEventListener("click", (e) => {
  if (e.target === dialog) dialog.close();
});

photoInput.addEventListener("change", () => {
  const file = photoInput.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) {
    formError.textContent = "Photo is too large (max 5 MB).";
    photoInput.value = "";
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => setPhotoPreview(e.target.result);
  reader.readAsDataURL(file);
  formError.textContent = "";
});

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read photo"));
    reader.readAsDataURL(file);
  });
}

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  formError.textContent = "";

  const name = nameInput.value.trim();
  const dob = dobInput.value;
  if (!name) return (formError.textContent = "Please enter your name.");
  if (!dob || !/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
    return (formError.textContent = "Please pick a valid birth date.");
  }

  const payload = { name, dob };
  const file = photoInput.files[0];
  if (file) {
    try {
      payload.photo = await fileToBase64(file);
    } catch {
      return (formError.textContent = "Could not read the photo file.");
    }
  }

  const isNew = !ownPerson();
  submitBtn.disabled = true;
  submitBtn.textContent = "Saving…";

  try {
    const res = await api("/api/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Something went wrong. Try again.");
    if (data.user) currentUser = data.user;
    people = data.people;
    renderMembers();
    updateAddButtonLabel();
    dialog.close();
    celebrate();
  } catch (err) {
    formError.textContent = err.message;
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = isNew ? "Save me! 🎂" : "Update my birthday ✏️";
  }
});

/* ---------- Settings (WhatsApp + Google) ---------- */

const settsDialog = document.getElementById("settings-dialog");
const settsForm = document.getElementById("settings-form");
const settsError = document.getElementById("settings-error");
const notifyStatus = document.getElementById("notify-status");
const notifyText = document.getElementById("notify-text");

const waEnabled = document.getElementById("wa-enabled");
const waSid = document.getElementById("wa-sid");
const waToken = document.getElementById("wa-token");
const waFrom = document.getElementById("wa-from");
const waTime = document.getElementById("wa-time");
const waRecipients = document.getElementById("wa-recipients");
const sendWaTest = document.getElementById("send-wa-test");

const gEnabled = document.getElementById("g-enabled");
const gClientId = document.getElementById("g-client-id");
const gClientSecret = document.getElementById("g-client-secret");
const gRedirect = document.getElementById("g-redirect");

document.getElementById("open-settings").addEventListener("click", async () => {
  settsError.textContent = "";
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || "Could not load settings.");
    const wa = data.whatsapp || {};
    waEnabled.checked = !!wa.enabled;
    waSid.value = wa.account_sid || "";
    waToken.value = "";
    waFrom.value = wa.from_number || "whatsapp:+14155238886";
    waTime.value = /^\d{2}:\d{2}$/.test(wa.time) ? wa.time : "09:00";
    waRecipients.value = (wa.recipients || []).map((r) => r.replace(/^whatsapp:/, "")).join(", ");
    waToken.placeholder = wa.auth_token_set ? "Leave blank to keep saved one" : "Required";

    const g = data.google_oauth || {};
    gEnabled.checked = !!g.enabled;
    gClientId.value = g.client_id || "";
    gClientSecret.value = "";
    gRedirect.value = g.redirect_uri || "";
    gClientSecret.placeholder = g.client_secret_set ? "Leave blank to keep saved one" : "Required";
  } catch (err) {
    settsError.textContent = err.message;
  }
  settsDialog.showModal();
});

document.getElementById("cancel-settings").addEventListener("click", () => settsDialog.close());
settsDialog.addEventListener("click", (e) => {
  if (e.target === settsDialog) settsDialog.close();
});

function settingsPayload() {
  const waFromVal = waFrom.value.trim();
  const waRecipientsVal = waRecipients.value
    .split(/[,;\n]+/)
    .map((r) => r.trim())
    .filter(Boolean)
    .map((r) => (r.startsWith("whatsapp:") ? r : "whatsapp:" + r));
  return {
    whatsapp: {
      enabled: waEnabled.checked,
      account_sid: waSid.value.trim(),
      auth_token: waToken.value,
      from_number: waFromVal.startsWith("whatsapp:") ? waFromVal : "whatsapp:" + waFromVal,
      recipients: waRecipientsVal,
      time: waTime.value || "09:00",
    },
    google_oauth: {
      enabled: gEnabled.checked,
      client_id: gClientId.value.trim(),
      client_secret: gClientSecret.value,
      redirect_uri: gRedirect.value.trim(),
    },
  };
}

async function fetchSettingsUpdate(route, okMessage) {
  settsError.textContent = "";
  try {
    const res = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settingsPayload()),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Request failed.");
    settsError.textContent = okMessage;
    settsError.style.color = "#2e7d32";
    renderNotifyStatus(data);
    return true;
  } catch (err) {
    settsError.style.color = "#e74c3c";
    settsError.textContent = err.message;
    return false;
  }
}

settsForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const ok = await fetchSettingsUpdate("/api/config", "Settings saved. ✅");
  if (ok && waEnabled.checked && !waToken.value) {
    settsError.textContent = "Settings saved (auth token kept). Try sending a test message!";
  }
});

sendWaTest.addEventListener("click", async () => {
  const saved = await fetchSettingsUpdate("/api/config", "Settings saved, testing…");
  if (!saved) return;
  sendWaTest.disabled = true;
  settsError.textContent = "Sending test WhatsApp message…";
  settsError.style.color = "#555";
  try {
    const res = await fetch("/api/notify-test-whatsapp", { method: "POST" });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Test failed.");
    settsError.style.color = "#2e7d32";
    settsError.textContent = "Test message sent to WhatsApp! ✅";
  } catch (err) {
    settsError.style.color = "#e74c3c";
    settsError.textContent = err.message;
  } finally {
    sendWaTest.disabled = false;
  }
});

function renderNotifyStatus(data) {
  const wa = data && data.whatsapp;
  const on = !!(wa && wa.enabled);
  notifyStatus.className = "notify-status" + (on ? " on" : " off");
  if (on) {
    const sent = data.wa_sent_today && data.wa_sent_today.length
      ? " · sent today to " + data.wa_sent_today.join(", ")
      : "";
    notifyText.textContent = "WhatsApp notifications: ON · daily at " + wa.time + " 🎂" + sent;
  } else {
    notifyText.textContent = "WhatsApp notifications: off — enable in Settings";
  }
}

/* ---------- Init ---------- */

async function loadPeople() {
  try {
    const res = await api("/api/people");
    const data = await res.json();
    if (data.ok) {
      people = data.people;
      renderMembers();
      updateAddButtonLabel();
    }
  } catch {
    countEl.textContent = "Could not load members.";
  }
}

async function loadNotifyStatus() {
  try {
    const res = await fetch("/api/config");
    const data = await res.json();
    if (data.ok) renderNotifyStatus(data);
  } catch {
    notifyText.textContent = "WhatsApp notifications: could not check";
  }
}

async function loadMe() {
  try {
    const res = await api("/api/auth/me");
    const data = await res.json();
    if (data.ok) {
      renderAuthBar(data.user);
      renderMembers();
      updateAddButtonLabel();
    }
  } catch {}
}

resize();
window.addEventListener("resize", resize);
swallowUrlToken();
loadMe();
loadPeople();
loadNotifyStatus();
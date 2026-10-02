(() => {
  const config = window.birthdayConfig || {};
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const heroName = document.getElementById("hero-name");
  const heroMessage = document.getElementById("hero-message");
  const nameField = document.getElementById("name");
  const senderField = document.querySelector(".message-signoff span");
  if (heroName) heroName.textContent = config.name || "Dear Friend";
  if (nameField) nameField.textContent = (config.name || "Friend").replace(/^Dear\s+/i, "");
  if (heroMessage && config.message) heroMessage.textContent = config.message;
  if (senderField && config.sender) {
    const heart = document.createElement("b"); heart.textContent = "♡";
    senderField.replaceChildren(document.createTextNode("With all my heart,"), document.createElement("br"), document.createTextNode(`${config.sender} `), heart);
  }

  const menuButton = document.getElementById("menu-toggle");
  const nav = document.getElementById("site-nav");
  menuButton?.addEventListener("click", () => {
    const open = menuButton.getAttribute("aria-expanded") !== "true";
    menuButton.setAttribute("aria-expanded", String(open));
    menuButton.setAttribute("aria-label", open ? "Close navigation" : "Open navigation");
    nav.classList.toggle("is-open", open);
  });
  nav?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => {
    nav.classList.remove("is-open"); menuButton?.setAttribute("aria-expanded", "false");
  }));

  const sections = [...document.querySelectorAll("main section[id]")];
  if ("IntersectionObserver" in window) {
    const revealObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) { entry.target.classList.add("is-visible"); revealObserver.unobserve(entry.target); }
    }), { threshold: 0.12 });
    document.querySelectorAll(".reveal").forEach((node) => revealObserver.observe(node));
    const activeObserver = new IntersectionObserver((entries) => entries.forEach((entry) => {
      if (entry.isIntersecting) nav?.querySelectorAll("a[href^='#']").forEach((link) => link.classList.toggle("active", link.hash === `#${entry.target.id}`));
    }), { rootMargin: "-35% 0px -55% 0px" });
    sections.forEach((section) => activeObserver.observe(section));
  } else document.querySelectorAll(".reveal").forEach((node) => node.classList.add("is-visible"));

  const countdownEls = ["days", "hours", "minutes", "seconds"].map((id) => document.getElementById(id));
  const target = config.birthdayDate ? new Date(`${config.birthdayDate}T00:00:00`) : null;
  let reached = false;
  let watchedTarget = false;
  function updateCountdown() {
    const now = new Date();
    if (target && target > now) watchedTarget = true;
    let next = target;
    if (!next || Number.isNaN(next.getTime()) || next <= now) {
      next = new Date(now.getFullYear(), target ? target.getMonth() : now.getMonth(), target ? target.getDate() : now.getDate() + 1);
      if (next <= now) next.setFullYear(next.getFullYear() + 1);
    }
    const seconds = Math.max(0, Math.floor((next - now) / 1000));
    const values = [Math.floor(seconds / 86400), Math.floor(seconds / 3600) % 24, Math.floor(seconds / 60) % 60, seconds % 60];
    values.forEach((value, i) => { if (countdownEls[i]) countdownEls[i].textContent = String(value).padStart(2, "0"); });
    if (!reached && watchedTarget && target && target <= now) { reached = true; celebrateBurst(); }
  }
  updateCountdown(); window.setInterval(updateCountdown, 1000);

  const gallery = document.getElementById("gallery");
  if (Array.isArray(config.memories)) config.memories.forEach((memory) => {
    if (!memory || typeof memory.image !== "string") return;
    let source;
    try { source = new URL(memory.image, window.location.href); } catch { return; }
    if (source.protocol !== "https:" && source.origin !== window.location.origin) return;
    const item = document.createElement("button");
    item.className = "gallery-item extra-memory"; item.type = "button"; item.dataset.full = source.href;
    const caption = String(memory.caption || "A special memory").slice(0, 100);
    item.setAttribute("aria-label", `View ${caption}`);
    const image = document.createElement("img"); image.src = source.href; image.alt = String(memory.alt || caption).slice(0, 180); image.loading = "lazy";
    const text = document.createElement("span"); text.textContent = caption;
    item.append(image, text); gallery?.append(item);
  });
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-image");
  const lightboxCaption = document.getElementById("lightbox-caption");
  const galleryButtons = [...document.querySelectorAll(".gallery-item")];
  let galleryIndex = 0;
  function showImage(index) {
    galleryIndex = (index + galleryButtons.length) % galleryButtons.length;
    const button = galleryButtons[galleryIndex];
    lightboxImg.src = button.dataset.full || button.querySelector("img").src;
    lightboxImg.alt = button.querySelector("img").alt;
    lightboxCaption.textContent = button.querySelector("span")?.textContent || "A special memory";
  }
  galleryButtons.forEach((button, index) => button.addEventListener("click", () => { showImage(index); lightbox.showModal(); }));
  document.querySelector(".lightbox-close")?.addEventListener("click", () => lightbox.close());
  document.querySelector(".lightbox-prev")?.addEventListener("click", () => showImage(galleryIndex - 1));
  document.querySelector(".lightbox-next")?.addEventListener("click", () => showImage(galleryIndex + 1));
  lightbox?.addEventListener("click", (event) => { if (event.target === lightbox) lightbox.close(); });
  document.addEventListener("keydown", (event) => {
    if (!lightbox?.open) return;
    if (event.key === "ArrowLeft") showImage(galleryIndex - 1);
    if (event.key === "ArrowRight") showImage(galleryIndex + 1);
  });
  let touchStart = 0;
  lightbox?.addEventListener("touchstart", (event) => { touchStart = event.changedTouches[0].clientX; }, { passive: true });
  lightbox?.addEventListener("touchend", (event) => {
    const delta = event.changedTouches[0].clientX - touchStart;
    if (Math.abs(delta) > 45) showImage(galleryIndex + (delta < 0 ? 1 : -1));
  }, { passive: true });
  document.getElementById("view-more")?.addEventListener("click", () => {
    document.querySelectorAll(".gallery-item.extra-memory").forEach((item) => item.classList.toggle("shown"));
    const button = document.getElementById("view-more");
    button.textContent = button.textContent.includes("More") ? "Show Fewer Memories −" : "View More Memories ＋";
  });

  const musicButton = document.getElementById("music-toggle");
  const musicLabel = document.getElementById("music-label");
  const musicFile = config.music ? new Audio(config.music) : null;
  if (musicFile) { musicFile.loop = true; musicFile.volume = 0.22; }
  let audioContext;
  let musicNodes = [];
  let musicTimer;
  const chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
  function playChord(index = 0) {
    if (!audioContext || audioContext.state !== "running") return;
    musicNodes.forEach((node) => { try { node.stop(); } catch {} });
    musicNodes = [];
    const now = audioContext.currentTime;
    chords[index % chords.length].forEach((frequency) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine"; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, now); gain.gain.exponentialRampToValueAtTime(0.018, now + 1.2); gain.gain.exponentialRampToValueAtTime(0.0001, now + 4.1);
      oscillator.connect(gain).connect(audioContext.destination); oscillator.start(now); oscillator.stop(now + 4.2); musicNodes.push(oscillator);
    });
    musicTimer = window.setTimeout(() => playChord(index + 1), 3600);
  }
  musicButton?.addEventListener("click", async () => {
    if (musicButton.getAttribute("aria-pressed") !== "true") {
      try {
        if (musicFile) await musicFile.play();
        else { audioContext ||= new (window.AudioContext || window.webkitAudioContext)(); await audioContext.resume(); playChord(); }
        musicLabel.textContent = "Music On"; musicButton.setAttribute("aria-pressed", "true"); musicButton.classList.add("playing");
      }
      catch { musicLabel.textContent = "Audio unavailable"; }
    } else {
      musicFile?.pause(); window.clearTimeout(musicTimer); musicNodes.forEach((node) => { try { node.stop(); } catch {} }); musicNodes = [];
      musicLabel.textContent = "Music Off"; musicButton.setAttribute("aria-pressed", "false"); musicButton.classList.remove("playing");
    }
  });

  function celebrateBurst() {
    document.body.classList.add("celebrating");
    const canvas = document.getElementById("confetti-canvas");
    if (canvas) { canvas.style.opacity = ".82"; document.getElementById("blow-out")?.click(); }
    const scene = document.querySelector(".celebration-content");
    if (scene) {
      for (let burst = 0; burst < 3; burst++) {
        const star = document.createElement("span");
        star.className = "firework-burst";
        star.setAttribute("aria-hidden", "true");
        star.style.setProperty("--burst-x", `${24 + Math.random() * 52}%`);
        star.style.setProperty("--burst-y", `${18 + Math.random() * 35}%`);
        star.style.setProperty("--burst-delay", `${burst * 220}ms`);
        scene.appendChild(star);
        window.setTimeout(() => star.remove(), 1800 + burst * 220);
      }
    }
    window.setTimeout(() => document.body.classList.remove("celebrating"), 3000);
  }
  document.getElementById("make-wish")?.addEventListener("click", celebrateBurst);
  document.getElementById("gift-open")?.addEventListener("click", () => {
    document.getElementById("gift-open").classList.toggle("opened");
    document.getElementById("reveal").scrollIntoView({ behavior: reducedMotion ? "auto" : "smooth" });
  });

  if (!reducedMotion && window.matchMedia("(min-width: 760px)").matches) {
    const background = document.querySelector(".hero-image");
    window.addEventListener("scroll", () => { if (background) background.style.transform = `translateY(${Math.min(window.scrollY * .13, 90)}px) scale(1.06)`; }, { passive: true });
  }
})();

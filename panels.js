// ─── Sidebar + Panel Elements ────────────────────
var overlay      = document.getElementById('overlay');
var menuBtn      = document.getElementById('menuBtn');
var sidebar      = document.getElementById('sidebar');
var sidebarClose = document.getElementById('sidebarClose');
const panels     = document.querySelectorAll('.panel');

// ─── Sidebar ──────────────────────────────────────
function openSidebar() {
  sidebar.classList.add('open');
  overlay.classList.add('show');
  menuBtn.classList.add('open');
}

function closeSidebar() {
  sidebar.classList.remove('open');
  overlay.classList.remove('show');
  menuBtn.classList.remove('open');
}

menuBtn.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);

// ─── Panels ───────────────────────────────────────
function openPanel(id) {
  document.getElementById(id).classList.add('open');
  overlay.classList.add('show');
  closeSidebar();   // close sidebar when a panel opens
}

function closePanel(id) {
  document.getElementById(id).classList.remove('open');
  overlay.classList.remove('show');
}

// Sidebar links open panels
document.querySelectorAll('[data-panel]').forEach(link => {
  link.addEventListener('click', () => openPanel(link.dataset.panel));
});

// Back buttons close panels
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', () => closePanel(btn.dataset.close));
});

// Overlay click – closes both sidebar and any open panel
overlay.addEventListener('click', () => {
  closeSidebar();
  panels.forEach(p => p.classList.remove('open'));
});
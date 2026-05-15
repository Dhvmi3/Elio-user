// ─── Card Elements ───────────────────────────────
const payCard     = document.getElementById('payCard');
const tokenCard   = document.getElementById('tokenCard');
const extCard     = document.getElementById('extCard');
const endCard     = document.getElementById('endCard');
const hearts      = document.querySelectorAll('.heart');

// ─── Show / Hide Cards ────────────────────────────
function showCard(card) {
  card.classList.add('show');
  overlay.classList.add('show');
}

function hideCard(card) {
  card.classList.remove('show');
  overlay.classList.remove('show');
}

// ─── Payment Card ─────────────────────────────────
document.getElementById('payBtn').addEventListener('click', () => {
  hideCard(payCard);
  setTimeout(() => showCard(tokenCard), 400);
});

document.getElementById('payDecline').addEventListener('click', () => {
  hideCard(payCard);
  showCard(endCard);
});

// ─── Token Card ───────────────────────────────────
document.getElementById('saveToken').addEventListener('click', () => {
  localStorage.setItem('elio_token', 'saved');
  hideCard(tokenCard);
});

document.getElementById('skipToken').addEventListener('click', () => {
  hideCard(tokenCard);
});

// ─── Extension Card ───────────────────────────────
document.getElementById('extBtn').addEventListener('click', () => {
  hideCard(extCard);
  // Extend session timer by 30 minutes
  if (window.extendUserSession) {
    window.extendUserSession(30);  
  }
});

document.getElementById('extDecline').addEventListener('click', () => {
  hideCard(extCard);
  showCard(endCard);
});

// ─── Feedback Submit ──────────────────────────────
document.getElementById('submitFeedback').addEventListener('click', () => {
  hideCard(endCard);
  // Stop the session timer
  if (window.stopUserSessionTimer) {
    window.stopUserSessionTimer();
  }
});

// ─── Heart Rating ─────────────────────────────────
hearts.forEach(heart => {
  heart.addEventListener('click', () => {
    const val = parseInt(heart.dataset.val);
    hearts.forEach(h => {
      h.textContent = parseInt(h.dataset.val) <= val ? '♥' : '♡';
      h.classList.toggle('active', parseInt(h.dataset.val) <= val);
    });
  });
});
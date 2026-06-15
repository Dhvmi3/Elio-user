// cards.js – card visibility, feedback submission to Supabase

const payCard     = document.getElementById('payCard');
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

// ─── Feedback Submit ──────────────────────────────
document.getElementById('submitFeedback').addEventListener('click', async () => {
  const token = localStorage.getItem('elio_session_token');
  const rating = document.querySelectorAll('.heart.active').length;
  const comment = document.getElementById('feedback').value.trim();

  // Only submit if we have a token and rating
  if (token && rating > 0) {
    try {
      const { error } = await window.supabaseClient
        .from('feedback')
        .insert({
          session_token: token,
          rating: rating,
          comment: comment || null
        });
      if (error) {
        console.error('Feedback insert error:', error);
      }
    } catch (err) {
      console.error('Feedback network error:', err);
    }
  }

  hideCard(endCard);
  if (window.stopUserSessionTimer) window.stopUserSessionTimer();
  if (window.clearAllSessionStorage) window.clearAllSessionStorage();

  const bookBtn = document.getElementById('bookNowBtn');
  if (bookBtn) bookBtn.style.display = 'block';
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
let userSessionTimer = null;
let userSessionSeconds = 30 * 60;
let hasShownFirstPayment = false;
let hasShownExtensionPrompt = false;

const timerBar = document.getElementById('sessionTimerBar');
const timerDisplay = document.getElementById('sessionTimerDisplay');

// Hide timer initially
if (timerBar) timerBar.style.display = 'none';

function updateUserTimerDisplay() {
  if (!timerDisplay) return;
  const mins = Math.floor(userSessionSeconds / 60);
  const secs = userSessionSeconds % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Pause user timer (keeps current seconds)
function pauseUserTimer() {
  if (userSessionTimer) {
    clearInterval(userSessionTimer);
    userSessionTimer = null;
  }
}

// Resume user timer from current seconds
function resumeUserTimer() {
  if (userSessionTimer) return; // already running
  if (userSessionSeconds <= 0) return;

  userSessionTimer = setInterval(() => {
    if (userSessionSeconds <= 0) {
      clearInterval(userSessionTimer);
      userSessionTimer = null;
      if (timerBar) timerBar.style.display = 'none';
      endSessionDueToTimeout();
      return;
    }

    // Check prompts only after resume (avoid re-triggering)
    if (!hasShownFirstPayment && userSessionSeconds <= 1680 && userSessionSeconds > 0) {
      hasShownFirstPayment = true;
      showPaymentCardForInitial();
    }

    if (!hasShownExtensionPrompt && userSessionSeconds <= 180 && userSessionSeconds > 0) {
      hasShownExtensionPrompt = true;
      showExtensionPrompt();
    }

    userSessionSeconds--;
    updateUserTimerDisplay();
  }, 1000);
}

function startUserSessionTimer() {
  if (userSessionTimer) return;
  userSessionSeconds = 30 * 60;
  hasShownFirstPayment = false;
  hasShownExtensionPrompt = false;
  updateUserTimerDisplay();
  if (timerBar) timerBar.style.display = 'flex';

  userSessionTimer = setInterval(() => {
    if (userSessionSeconds <= 0) {
      clearInterval(userSessionTimer);
      userSessionTimer = null;
      if (timerBar) timerBar.style.display = 'none';
      endSessionDueToTimeout();
      return;
    }

    // Show first payment card after 2 minutes (when 28 min remaining = 1680 secs)
    if (!hasShownFirstPayment && userSessionSeconds <= 1680 && userSessionSeconds > 0) {
      hasShownFirstPayment = true;
      showPaymentCardForInitial();
    }

    // Show extension prompt when 3 minutes left (180 secs)
    if (!hasShownExtensionPrompt && userSessionSeconds <= 180 && userSessionSeconds > 0) {
      hasShownExtensionPrompt = true;
      showExtensionPrompt();
    }

    userSessionSeconds--;
    updateUserTimerDisplay();
  }, 1000);
}

function endSessionDueToTimeout() {
  // Hide chat & input, show end card (no payment needed)
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';
  const endCard = document.getElementById('endCard');
  if (endCard) endCard.classList.add('show');
  // Also stop any ongoing timers
  if (window.stopUserSessionTimer) window.stopUserSessionTimer();
}

// Called by admin end session
function showAdminEndedSession(reason = 'The listener has ended the session.') {
  if (userSessionTimer) {
    clearInterval(userSessionTimer);
    userSessionTimer = null;
  }
  timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';

  // Show a custom card
  let adminEndCard = document.getElementById('adminEndCard');
  if (!adminEndCard) {
    adminEndCard = document.createElement('div');
    adminEndCard.id = 'adminEndCard';
    adminEndCard.className = 'card';
    adminEndCard.innerHTML = `
      <p class="card-title">Session ended by listener</p>
      <p class="card-sub" id="adminEndReason">${reason}</p>
      <button class="card-btn primary" id="closeAdminEndCard">Okay</button>
    `;
    document.body.appendChild(adminEndCard);
    document.getElementById('closeAdminEndCard').addEventListener('click', () => {
      adminEndCard.classList.remove('show');
      // Show book button again
      document.getElementById('bookNowBtn').style.display = 'block';
    });
  } else {
    document.getElementById('adminEndReason').textContent = reason;
  }
  adminEndCard.classList.add('show');
  // Also show book button
  document.getElementById('bookNowBtn').style.display = 'block';
}

// Payment card for initial 2-min prompt
function showPaymentCardForInitial() {
  pauseUserTimer();

  const payCard = document.getElementById('payCard');
  if (!payCard) return;

  const payBtn = document.getElementById('payBtn');
  const declineBtn = document.getElementById('payDecline');

  // Store original handlers to restore later? Not necessary – we replace them.
  payBtn.onclick = async () => {
    try {
      const success = await processPayment(5);
      if (success) {
        hideCard(payCard);
        resumeUserTimer(); // ▶️ resume after success
        showTokenSaveCard();
      } else {
        alert('Payment failed. Please try again or use another card.');
        hideCard(payCard);
        showPaymentRetryCard(); // this card will handle its own pause/resume
      }
    } catch (err) {
      alert('Network error. Please check your connection.');
      hideCard(payCard);
      showPaymentRetryCard();
    }
  };

  declineBtn.onclick = () => {
    hideCard(payCard);
    endSessionDueToTimeout(); // session ends – no resume needed
  };

  showCard(payCard);
}

function showPaymentRetryCard() {
  pauseUserTimer(); // ⏸️

  let retryCard = document.getElementById('paymentRetryCard');
  if (!retryCard) {
    retryCard = document.createElement('div');
    retryCard.id = 'paymentRetryCard';
    retryCard.className = 'card';
    retryCard.innerHTML = `
      <p class="card-title">Payment didn't go through</p>
      <p class="card-sub">Your card was declined or there was a technical issue.</p>
      <button class="card-btn primary" id="retryPayBtn">Try again</button>
      <button class="card-btn ghost" id="cancelSessionBtn">End session</button>
    `;
    document.body.appendChild(retryCard);
  }

  // Remove old listeners to avoid duplicates
  const retryBtn = document.getElementById('retryPayBtn');
  const cancelBtn = document.getElementById('cancelSessionBtn');

  retryBtn.onclick = async () => {
    hideCard(retryCard);
    const success = await processPayment(5);
    if (success) {
      resumeUserTimer();
      showTokenSaveCard();
    } else {
      endSessionDueToTimeout();
    }
  };

  cancelBtn.onclick = () => {
    hideCard(retryCard);
    endSessionDueToTimeout();
  };

  showCard(retryCard);
}

function showExtensionPrompt() {
  pauseUserTimer(); // ⏸️ pause while asking

  const extCard = document.getElementById('extCard');
  if (!extCard) return;

  const extBtn = document.getElementById('extBtn');
  const declineBtn = document.getElementById('extDecline');

  extBtn.onclick = async () => {
    const success = await processPayment(5);
    if (success) {
      hideCard(extCard);
      if (window.extendUserSession) window.extendUserSession(30);
      resumeUserTimer(); // ▶️ resume after extension
    } else {
      alert('Payment failed. Session will end when timer reaches 0.');
      hideCard(extCard);
      resumeUserTimer(); // still resume – user can continue with remaining time
    }
  };

  declineBtn.onclick = () => {
    hideCard(extCard);
    resumeUserTimer(); // ▶️ resume without extension
  };

  showCard(extCard);
}

// Show save token card after successful payment
function showTokenSaveCard() {
  const tokenCard = document.getElementById('tokenCard');
  if (!tokenCard) return;
  
  const saveBtn = document.getElementById('saveToken');
  const skipBtn = document.getElementById('skipToken');
  
  saveBtn.onclick = async () => {
    // Save token to Supabase
    const userId = localStorage.getItem('elio_user_id') || generateUserId();
    const token = 'mock_card_token_' + Date.now(); // In real integration, get from payment provider
    const { error } = await supabase.from('user_tokens').insert({ user_id: userId, token });
    if (!error) localStorage.setItem('elio_user_id', userId);
    hideCard(tokenCard);
  };
  
  skipBtn.onclick = () => {
    hideCard(tokenCard);
  };
  
  showCard(tokenCard);
}

function generateUserId() {
  const id = 'user_' + Math.random().toString(36).substr(2, 9);
  localStorage.setItem('elio_user_id', id);
  return id;
}

// Mock payment function (replace with Stripe/PayPal)
async function processPayment(amount) {
  // Simulate API call
  return new Promise(resolve => {
    setTimeout(() => resolve(true), 500);
  });
}

// Listen for admin end session via localStorage
window.addEventListener('storage', (e) => {
  if (e.key === 'elio_admin_ended_session') {
    const reason = e.newValue;
    showAdminEndedSession(reason);
    localStorage.removeItem('elio_admin_ended_session');
  }
});

// Expose globally
window.startUserSessionTimer = startUserSessionTimer;
window.stopUserSessionTimer = () => {
  if (userSessionTimer) clearInterval(userSessionTimer);
  timerBar.style.display = 'none';
};
window.extendUserSession = (minutes) => {
  userSessionSeconds += minutes * 60;
  updateUserTimerDisplay();
  // Reset flags? Only reset extension flag if needed.
  hasShownExtensionPrompt = false; // allow another prompt if they extend again? Optional.
};

// User manually ends session
const userEndBtn = document.getElementById('userEndSessionBtn');
if (userEndBtn) {
  userEndBtn.addEventListener('click', () => {
    if (confirm('End this session now?')) {
      pauseUserTimer();
      endSessionDueToTimeout();
      // Optional: notify admin via localStorage (same browser only)
      localStorage.setItem('elio_user_ended_session', 'true');
    }
  });
}

// On page load, check if session should be active (e.g., after booking)
if (localStorage.getItem('elio_session_started') === 'true') {
  startUserSessionTimer();
}
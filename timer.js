// timer.js – User side: timer, payment, realtime chat, and session synchronisation

// ------------------------------------------------------------
// 1. CHAT MANAGER (ephemeral chat via Supabase messages table)
// ------------------------------------------------------------
const ChatManager = {
  token: null,
  subscription: null,

  async init(sessionToken) {
  // If already initialized with the same token, do nothing
  if (this.token === sessionToken && this.subscription) {
    return;
  }

  // If a different subscription exists, clean it up first
  if (this.subscription) {
    this.subscription.unsubscribe();
    this.subscription = null;
  }

  this.token = sessionToken;

  // Load existing messages from DB
  const { data, error } = await window.supabaseClient
    .from('messages')
    .select('*')
    .eq('session_token', this.token)
    .order('created_at', { ascending: true });

  if (!error && data) {
    data.forEach(msg => this.renderMessage(msg.sender, msg.text, msg.id));
  }

  // Subscribe to new inserts (realtime)
  this.subscription = window.supabaseClient
    .channel('table-db-changes')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `session_token=eq.${this.token}`
      },
      (payload) => {
        const msg = payload.new;
        this.renderMessage(msg.sender, msg.text, msg.id);
      }
    )
    .subscribe();
},

  async sendMessage(sender, text) {
    if (!this.token) return;
    const { error } = await window.supabaseClient
      .from('messages')
      .insert({ session_token: this.token, sender, text });
    if (error) console.error('Message send error:', error);
  },

  renderMessage(sender, text, id) {
    // Use global createBubble (must accept optional id to prevent duplicates)
    if (typeof createBubble === 'function') {
      if (id && document.getElementById(`msg-${id}`)) return;
      createBubble(text, sender === 'user' ? 'sent' : 'received', id);
    }
  },

  cleanup() {
    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }
    this.token = null;
  }
};

// ------------------------------------------------------------
// 2. TIMER VARIABLES
// ------------------------------------------------------------
let userSessionTimer = null;
let userSessionSeconds = 30 * 60;
let hasShownFirstPayment = false;
let hasShownExtensionPrompt = false;
let sessionChannel = null;

const timerBar = document.getElementById('sessionTimerBar');
const timerDisplay = document.getElementById('sessionTimerDisplay');
if (timerBar) timerBar.style.display = 'none';

// ------------------------------------------------------------
// 3. TIMER HELPERS
// ------------------------------------------------------------
function updateUserTimerDisplay() {
  if (!timerDisplay) return;
  const mins = Math.floor(userSessionSeconds / 60);
  const secs = userSessionSeconds % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

// Local pause (no broadcast)
function pauseLocal() {
  if (userSessionTimer) {
    clearInterval(userSessionTimer);
    userSessionTimer = null;
  }
}

// Local resume (no broadcast)
function resumeLocal() {
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

// User-initiated pause → pauses locally and broadcasts to admin
function pauseUserTimer() {
  pauseLocal();
  broadcastEvent('timer-paused');
}

// User-initiated resume → resumes locally and broadcasts to admin
function resumeUserTimer() {
  if (userSessionTimer) return; // already running
  resumeLocal();
  broadcastEvent('timer-resumed');
}

// User manually ends session → broadcast and cleanup
async function userEndedSession(reason = 'User ended the session') {
  // Broadcast to admin
  broadcastEvent('user-ended-session', { reason });

  // Tell backend to log this session end
  const sessionToken = localStorage.getItem('elio_session_token');
  if (sessionToken) {
    await fetch('http://localhost:3000/end-session-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken })
    }).catch(e => console.error('Log user end error:', e));
  }

  // Clean up locally
  cleanupAfterEnd();
}

// Called when user declines payment (same as manual end)
function declinePaymentEnd() {
  userEndedSession('User declined payment');
}

// ------------------------------------------------------------
// 4. SESSION START / STOP
// ------------------------------------------------------------
function startUserSessionTimer() {
  if (userSessionTimer) return;
  userSessionSeconds = 30 * 60;
  hasShownFirstPayment = false;
  hasShownExtensionPrompt = false;
  updateUserTimerDisplay();
  if (timerBar) timerBar.style.display = 'flex';
  resumeLocal(); // starts the interval
}

function endSessionDueToTimeout() {
  // Broadcast timeout if channel still open
  broadcastEvent('user-ended-session', { reason: 'Session time limit reached' });
  cleanupAfterEnd();
}

function cleanupAfterEnd() {
  pauseLocal();
  if (timerBar) timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';

  // Show end card
  const endCard = document.getElementById('endCard');
  if (endCard) endCard.classList.add('show');

  const bookBtn = document.getElementById('bookNowBtn');
  if (bookBtn) bookBtn.style.display = 'block';

  // Clean up ChatManager
  ChatManager.cleanup();
  // Clean up channel
  cleanupSessionChannel();
}

// ------------------------------------------------------------
// 5. ADMIN ACTIONS (received via broadcast)
// ------------------------------------------------------------
function showAdminEndedSession(reason = 'The listener has ended the session.') {
  cleanupSessionChannel();
  pauseLocal();
  timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';

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
      document.getElementById('bookNowBtn').style.display = 'block';
    });
  } else {
    document.getElementById('adminEndReason').textContent = reason;
  }
  adminEndCard.classList.add('show');
  document.getElementById('bookNowBtn').style.display = 'block';

  // Clean up ChatManager
  ChatManager.cleanup();
}

// Handle admin pause/resume broadcasts
function handleAdminTimerPaused() {
  pauseLocal();
  // Show a system message in chat
  if (typeof createBubble === 'function') {
    createBubble('Listener paused the timer', 'system');
  }
}

function handleAdminTimerResumed() {
  resumeLocal();
  if (typeof createBubble === 'function') {
    createBubble('Listener resumed the timer', 'system');
  }
}

// Try to charge a saved card token (returns true if payment succeeded)
async function tryTokenCharge(amount) {
  const userId = localStorage.getItem('elio_user_id');
  if (!userId) return false;   // no saved identity at all

  // Look up a saved token for this user
  const { data: tokens, error } = await window.supabaseClient
    .from('user_tokens')
    .select('token')
    .eq('user_id', userId)
    .limit(1);

  if (error || !tokens || tokens.length === 0) return false;

  const cardToken = tokens[0].token;
  const tx_ref = localStorage.getItem('elio_session_token') || 'auto_' + Date.now();

  try {
    const res = await fetch('http://localhost:3000/charge-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: cardToken, amount, tx_ref })
    });
    const data = await res.json();
    if (data.success) {
      console.log('Tokenized charge successful');
      return true;   // payment done – no card UI needed
    } else {
      console.warn('Tokenized charge failed:', data.message);
      return false;  // fall through to normal checkout
    }
  } catch (err) {
    console.error('Tokenized charge network error:', err);
    return false;
  }
}

// ------------------------------------------------------------
// 6. PAYMENT CARDS (keep existing logic, but call new wrappers)
// ------------------------------------------------------------
function showPaymentCardForInitial() {
  pauseUserTimer();
  const payCard = document.getElementById('payCard');
  if (!payCard) return;
  const payBtn = document.getElementById('payBtn');
  const declineBtn = document.getElementById('payDecline');

  payBtn.onclick = async () => {
    // 1. Try saved token first
    const tokenPaid = await tryTokenCharge(5);
    if (tokenPaid) {
      hideCard(payCard);
      resumeUserTimer();
      return;   // no token‑save prompt needed (already saved)
    }

    // 2. Fallback to normal Flutterwave modal
    try {
      const success = await processPayment(5);
      if (success) {
        hideCard(payCard);
        resumeUserTimer();
        showTokenSaveCard();
      } else {
        alert('Payment failed. Please try again or use another card.');
        hideCard(payCard);
        showPaymentRetryCard();
      }
    } catch (err) {
      alert('Network error. Please check your connection.');
      hideCard(payCard);
      showPaymentRetryCard();
    }
  };

  declineBtn.onclick = () => {
    hideCard(payCard);
    declinePaymentEnd();
  };
  showCard(payCard);
}

function showPaymentRetryCard() {
  pauseUserTimer();
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

  const retryBtn = document.getElementById('retryPayBtn');
  const cancelBtn = document.getElementById('cancelSessionBtn');

  retryBtn.onclick = async () => {
    hideCard(retryCard);
    // Try saved token first
    const tokenPaid = await tryTokenCharge(5);
    if (tokenPaid) {
      resumeUserTimer();
      return;
    }
    // Fallback to normal modal
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
    declinePaymentEnd();
  };
  showCard(retryCard);
}

function showExtensionPrompt() {
  pauseUserTimer();
  const extCard = document.getElementById('extCard');
  if (!extCard) return;
  const extBtn = document.getElementById('extBtn');
  const declineBtn = document.getElementById('extDecline');

  extBtn.onclick = async () => {
    // 1. Try saved token first
    const tokenPaid = await tryTokenCharge(5);
    if (tokenPaid) {
      hideCard(extCard);
      if (window.extendUserSession) window.extendUserSession(30);
      resumeUserTimer();
      return;
    }

    // 2. Fallback to normal modal
    const success = await processPayment(5);
    if (success) {
      hideCard(extCard);
      if (window.extendUserSession) window.extendUserSession(30);
      resumeUserTimer();
    } else {
      alert('Payment failed. Session will end when timer reaches 0.');
      hideCard(extCard);
      resumeUserTimer();
    }
  };

  declineBtn.onclick = () => {
    hideCard(extCard);
    resumeUserTimer();
  };
  showCard(extCard);
}

function showTokenSaveCard() {
  const tokenCard = document.getElementById('tokenCard');
  if (!tokenCard) return;
  const saveBtn = document.getElementById('saveToken');
  const skipBtn = document.getElementById('skipToken');

  saveBtn.onclick = async () => {
    const userId = localStorage.getItem('elio_user_id') || generateUserId();
    const cardToken = localStorage.getItem('elio_card_token');
    if (cardToken) {
      const { error } = await window.supabaseClient
        .from('user_tokens')
        .insert({ user_id: userId, token: cardToken });
      if (error) {
        console.error(error);
        alert('Failed to save token.');
      } else {
        console.log('Token saved');
        localStorage.removeItem('elio_card_token');
      }
    } else {
      alert('No card token found to save.');
    }
    hideCard(tokenCard);
  };

  skipBtn.onclick = () => {
    hideCard(tokenCard);
  };
  showCard(tokenCard);
}

function generateUserId() {
  const id = 'user_' + Math.random().toString(36).slice(2, 11);
  localStorage.setItem('elio_user_id', id);
  return id;
}

async function processPayment(amount, tx_ref = null) {
  if (!tx_ref) tx_ref = localStorage.getItem('elio_session_token') || 'test_' + Date.now();

  try {
    const response = await fetch('http://localhost:3000/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, tx_ref })
    });
    const data = await response.json();
    if (!data.success) throw new Error('Backend error');

    return new Promise((resolve) => {
      FlutterwaveCheckout({
        public_key: 'FLWPUBK_TEST-xxxxxxxxxxxxx', // placeholder – replace later
        tx_ref: data.data.tx_ref,
        amount: amount,
        currency: 'USD',
        payment_options: 'card',
        redirect_url: window.location.href,
        customer: {
          email: 'user@example.com',
          name: 'Elio User'
        },
        customizations: {
          title: 'Elio Session Payment',
          description: `For the price of a coffee, you get 30 minutes of compassionate listening.`
        },
        callback: (response) => {
          console.log('Payment success', response);
          const cardToken = response.data?.card?.token || null;
          if (cardToken) localStorage.setItem('elio_card_token', cardToken);
          resolve(true);
        },
        onclose: () => resolve(false)
      });
    });
  } catch (err) {
    console.error(err);
    return false;
  }
}

// ------------------------------------------------------------
// 7. REALTIME LISTENER & BROADCAST
// ------------------------------------------------------------
function listenForStartSignal() {
  const sessionToken = localStorage.getItem('elio_session_token');
  if (!sessionToken) {
    console.warn('No session token, cannot listen');
    return;
  }
  if (sessionChannel) return; // already listening

  sessionChannel = window.supabaseClient.channel(`session:${sessionToken}`);

  // Start signal from admin
  sessionChannel.on('broadcast', { event: 'start-session' }, () => {
    console.log('start-session received');
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('countdown').style.display = 'none';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('inputWrap').style.display = 'flex';
    const bookNowBtn = document.getElementById('bookNowBtn');
    if (bookNowBtn) bookNowBtn.style.display = 'none';
    startUserSessionTimer();
  });

  // End signal from admin
  sessionChannel.on('broadcast', { event: 'end-session' }, (payload) => {
    showAdminEndedSession(payload?.reason || 'The listener has ended the session.');
  });

  // Timer sync: admin paused
  sessionChannel.on('broadcast', { event: 'timer-paused' }, () => {
    handleAdminTimerPaused();
  });

  // Timer sync: admin resumed
  sessionChannel.on('broadcast', { event: 'timer-resumed' }, () => {
    handleAdminTimerResumed();
  });

  sessionChannel.subscribe((status) => {
    if (status === 'SUBSCRIBED') console.log('Listening on session channel');
  });
}

function broadcastEvent(event, payload = {}) {
  if (!sessionChannel) return;
  sessionChannel.send({
    type: 'broadcast',
    event: event,
    payload: payload
  }).catch(e => console.error('Broadcast error:', e));
}

function cleanupSessionChannel() {
  if (sessionChannel) {
    sessionChannel.unsubscribe();
    sessionChannel = null;
  }
}

// ------------------------------------------------------------
// 8. GLOBAL EXPOSURE (keep existing)
// ------------------------------------------------------------
window.startUserSessionTimer = startUserSessionTimer;
window.stopUserSessionTimer = () => {
  pauseLocal();
  timerBar.style.display = 'none';
};
window.extendUserSession = (minutes) => {
  userSessionSeconds += minutes * 60;
  updateUserTimerDisplay();
  hasShownExtensionPrompt = false;
};

// User manually ends session via button
const userEndBtn = document.getElementById('userEndSessionBtn');
if (userEndBtn) {
  userEndBtn.addEventListener('click', () => {
    if (confirm('End this session now?')) {
      userEndedSession('User clicked End');
    }
  });
}

function showWaitingState() {
  if (timerBar) {
    timerBar.style.display = 'flex';
    timerDisplay.textContent = 'Waiting…';
  }
  const endBtn = document.getElementById('userEndSessionBtn');
  if (endBtn) endBtn.style.display = 'inline-block';
}
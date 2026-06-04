// timer.js – User side: timer, payment, realtime chat, and session synchronisation

// ------------------------------------------------------------
// 1. CHAT MANAGER (ephemeral chat via Supabase messages table)
// ------------------------------------------------------------
const ChatManager = {
  token: null,
  subscription: null,

  async init(sessionToken) {
    if (this.token === sessionToken && this.subscription) return;

    if (this.subscription) {
      this.subscription.unsubscribe();
      this.subscription = null;
    }

    this.token = sessionToken;

    const { data, error } = await window.supabaseClient
      .from('messages')
      .select('*')
      .eq('session_token', this.token)
      .order('created_at', { ascending: true });

    if (!error && data) {
      data.forEach(msg => this.renderMessage(msg.sender, msg.text, msg.id));
    }

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
// 2. TIMER – uses absolute end time (prevents background tab drift)
// ------------------------------------------------------------
let userSessionEndTime = null;
let timerTickInterval = null;
let hasShownFirstPayment = false;
let hasShownExtensionPrompt = false;
let sessionChannel = null;
let isTimerPaused = false;

const timerBar = document.getElementById('sessionTimerBar');
const timerDisplay = document.getElementById('sessionTimerDisplay');
if (timerBar) timerBar.style.display = 'none';

function updateUserTimerDisplay() {
  if (!timerDisplay || !userSessionEndTime) return;
  const remaining = Math.max(0, Math.floor((userSessionEndTime - Date.now()) / 1000));
  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;
  timerDisplay.textContent = `${mins}:${secs.toString().padStart(2, '0')}`;
}

function startTimerTick() {
  if (timerTickInterval) return;
  timerTickInterval = setInterval(() => {
    if (isTimerPaused) return;
    if (!userSessionEndTime) return;

    const remaining = Math.max(0, Math.floor((userSessionEndTime - Date.now()) / 1000));
    updateUserTimerDisplay();

    if (remaining <= 0) {
      clearInterval(timerTickInterval);
      timerTickInterval = null;
      if (timerBar) timerBar.style.display = 'none';
      endSessionDueToTimeout();
      return;
    }

    if (!hasShownFirstPayment && remaining <= 1680) {
      hasShownFirstPayment = true;
      showPaymentCardForInitial();
    }
    if (!hasShownExtensionPrompt && remaining <= 180) {
      hasShownExtensionPrompt = true;
      showExtensionPrompt();
    }
  }, 250);
}

function stopTimerTick() {
  if (timerTickInterval) {
    clearInterval(timerTickInterval);
    timerTickInterval = null;
  }
}

function pauseUserTimer() {
  if (isTimerPaused) return;
  isTimerPaused = true;
  stopTimerTick();
  broadcastEvent('timer-paused');
}

function resumeUserTimer() {
  if (!isTimerPaused) return;
  isTimerPaused = false;
  startTimerTick();
  broadcastEvent('timer-resumed');
}

function userEndedSession(reason = 'User ended the session') {
  broadcastEvent('user-ended-session', { reason });

  const sessionToken = localStorage.getItem('elio_session_token');
  if (sessionToken) {
    fetch('https://eliobackend.onrender.com/end-session-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: sessionToken })
    }).catch(e => console.error('Log user end error:', e));
  }

  cleanupAfterEnd();
}

function declinePaymentEnd() {
  userEndedSession('User declined payment');
}

// ------------------------------------------------------------
// 3. SESSION START / STOP
// ------------------------------------------------------------
function startUserSessionTimer(endTime) {
  userSessionEndTime = endTime || Date.now() + 30 * 60 * 1000;
  localStorage.setItem('elio_session_end_time', userSessionEndTime);
  localStorage.setItem('elio_session_active', 'true');   // 🔧 Fix: persist active flag
  hasShownFirstPayment = false;
  hasShownExtensionPrompt = false;
  isTimerPaused = false;
  updateUserTimerDisplay();
  if (timerBar) timerBar.style.display = 'flex';
  startTimerTick();
}

function endSessionDueToTimeout() {
  broadcastEvent('user-ended-session', { reason: 'Session time limit reached' });
  cleanupAfterEnd();
}

function cleanupAfterEnd() {
  stopTimerTick();
  userSessionEndTime = null;
  if (timerBar) timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';
  const endCard = document.getElementById('endCard');
  if (endCard) endCard.classList.add('show');
  const bookBtn = document.getElementById('bookNowBtn');
  if (bookBtn) bookBtn.style.display = 'block';
  ChatManager.cleanup();
  cleanupSessionChannel();
  localStorage.removeItem('elio_session_active');
  localStorage.removeItem('elio_session_end_time');
}

// ------------------------------------------------------------
// 4. ADMIN ACTIONS (received via broadcast)
// ------------------------------------------------------------
function showAdminEndedSession(reason = 'The listener has ended the session.') {
  cleanupSessionChannel();
  stopTimerTick();
  userSessionEndTime = null;
  timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';

  // Show overlay
  overlay.classList.add('show');   // 🔧 Fix: dim background

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
      overlay.classList.remove('show');   // 🔧 Fix: remove dimming
      document.getElementById('bookNowBtn').style.display = 'block';
    });
  } else {
    document.getElementById('adminEndReason').textContent = reason;
  }
  adminEndCard.classList.add('show');
  document.getElementById('bookNowBtn').style.display = 'block';

  ChatManager.cleanup();
  localStorage.removeItem('elio_session_active');
  localStorage.removeItem('elio_session_end_time');
}

function handleAdminTimerPaused() {
  isTimerPaused = true;
  stopTimerTick();
  if (typeof createBubble === 'function') {
    createBubble('Listener paused the timer', 'system');
  }
}

function handleAdminTimerResumed() {
  isTimerPaused = false;
  startTimerTick();
  if (typeof createBubble === 'function') {
    createBubble('Listener resumed the timer', 'system');
  }
}

// ------------------------------------------------------------
// 5. PAYMENT CARDS (with timer hide/show)
// ------------------------------------------------------------
function hideTimerForPayment() {
  if (timerBar) timerBar.style.display = 'none';
  const paymentIndicator = document.getElementById('paymentIndicator');
  if (paymentIndicator) paymentIndicator.style.display = 'block';
}

function showTimerAfterPayment() {
  if (timerBar) timerBar.style.display = 'flex';
  const paymentIndicator = document.getElementById('paymentIndicator');
  if (paymentIndicator) paymentIndicator.style.display = 'none';
}

function showPaymentCardForInitial() {
  pauseUserTimer();
  hideTimerForPayment();

  const payCard = document.getElementById('payCard');
  if (!payCard) return;
  const payBtn = document.getElementById('payBtn');
  const declineBtn = document.getElementById('payDecline');

  payBtn.onclick = async () => {
    try {
      const success = await processPayment(5);
      if (success) {
        hideCard(payCard);
        resumeUserTimer();
        showTimerAfterPayment();
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
  hideTimerForPayment();

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
    const success = await processPayment(5);
    if (success) {
      resumeUserTimer();
      showTimerAfterPayment();
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
  hideTimerForPayment();

  const extCard = document.getElementById('extCard');
  if (!extCard) return;
  const extBtn = document.getElementById('extBtn');
  const declineBtn = document.getElementById('extDecline');

  extBtn.onclick = async () => {
    const success = await processPayment(5);
    if (success) {
      hideCard(extCard);
      if (window.extendUserSession) window.extendUserSession(30);
      resumeUserTimer();
      showTimerAfterPayment();
    } else {
      alert('Payment failed. Session will end when timer reaches 0.');
      hideCard(extCard);
      resumeUserTimer();
      showTimerAfterPayment();
    }
  };

  declineBtn.onclick = () => {
    hideCard(extCard);
    resumeUserTimer();
    showTimerAfterPayment();
  };
  showCard(extCard);
}

async function processPayment(amount, tx_ref = null) {
  if (!tx_ref) tx_ref = localStorage.getItem('elio_session_token') || 'test_' + Date.now();

  try {
    const response = await fetch('https://eliobackend.onrender.com/create-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, tx_ref })
    });
    const data = await response.json();
    if (!data.success) throw new Error('Backend error');

    // 🔧 Fix: removed dead paymentComplete listener – the checkoutPromise resolves on its own.
    return new Promise((resolve) => {
      FlutterwaveCheckout({
        public_key: 'FLWPUBK_TEST-6c117d2b73a2d0aee2a31c4a6826eea9-X',
        tx_ref: data.data.tx_ref,
        amount: amount,
        currency: 'USD',
        payment_options: 'card',
        customer: { email: 'user@example.com', name: 'Elio User' },
        customizations: {
          title: 'Elio Session Payment',
          description: 'For the price of a coffee, you get 30 minutes of compassionate listening.'
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
// 6. REALTIME LISTENER & BROADCAST
// ------------------------------------------------------------
function listenForStartSignal() {
  const sessionToken = localStorage.getItem('elio_session_token');
  if (!sessionToken || sessionChannel) return;

  sessionChannel = window.supabaseClient.channel(`session:${sessionToken}`);

  sessionChannel.on('broadcast', { event: 'start-session' }, (payload) => {
    console.log('start-session received');
    const startTime = payload?.startTime || Date.now();
    document.getElementById('welcome').style.display = 'none';
    document.getElementById('countdown').style.display = 'none';
    document.getElementById('chat').style.display = 'flex';
    document.getElementById('inputWrap').style.display = 'flex';
    const bookNowBtn = document.getElementById('bookNowBtn');
    if (bookNowBtn) bookNowBtn.style.display = 'none';
    localStorage.setItem('elio_session_active', 'true');   // 🔧 Fix: set active flag
    startUserSessionTimer(startTime + 30 * 60 * 1000);
  });

  sessionChannel.on('broadcast', { event: 'end-session' }, (payload) => {
    showAdminEndedSession(payload?.reason || 'The listener has ended the session.');
  });

  sessionChannel.on('broadcast', { event: 'timer-paused' }, () => {
    handleAdminTimerPaused();
  });

  sessionChannel.on('broadcast', { event: 'timer-resumed' }, () => {
    handleAdminTimerResumed();
  });

  sessionChannel.on('broadcast', { event: 'listener-disconnected' }, () => {
    if (typeof createBubble === 'function') {
      createBubble('Listener has disconnected.', 'system');
    }
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
// 7. DISCONNECT NOTIFICATION
// ------------------------------------------------------------
window.addEventListener('beforeunload', () => {
  if (sessionChannel && userSessionEndTime) {
    broadcastEvent('user-disconnected', {});
  }
});

// ------------------------------------------------------------
// 8. GLOBAL EXPOSURE
// ------------------------------------------------------------
window.startUserSessionTimer = startUserSessionTimer;
window.stopUserSessionTimer = () => {
  stopTimerTick();
  timerBar.style.display = 'none';
};
window.extendUserSession = (minutes) => {
  if (userSessionEndTime) {
    userSessionEndTime += minutes * 60 * 1000;
    updateUserTimerDisplay();
    hasShownExtensionPrompt = false;
  }
};

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
    if (timerDisplay) {
      timerDisplay.textContent = 'Waiting…';
    }
  }
  const endBtn = document.getElementById('userEndSessionBtn');
  if (endBtn) endBtn.style.display = 'inline-block';
}

// Restore timer if session was active and end time is saved
(function restoreTimerOnReload() {
  if (localStorage.getItem('elio_session_active') === 'true') {
    const savedEndTime = parseInt(localStorage.getItem('elio_session_end_time'));
    if (savedEndTime && savedEndTime > Date.now()) {
      startUserSessionTimer(savedEndTime);
    } else {
      localStorage.removeItem('elio_session_active');
      localStorage.removeItem('elio_session_end_time');
    }
  }
})();
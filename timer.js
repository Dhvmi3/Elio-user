// timer.js – User side: timer, payment, realtime chat, and session synchronisation

// 1. CHAT MANAGER (ephemeral chat via Supabase messages table)
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

    // Unique channel per session (avoids subscription collisions)
    this.subscription = window.supabaseClient
      .channel(`chat:${sessionToken}`)
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

// 2. TIMER – absolute end time, pause/resume, visibility detection
let userSessionEndTime = null;
let timerTickInterval = null;
let hasShownFirstPayment = false;
let sessionChannel = null;
let isTimerPaused = false;
let isPaymentInProgress = false;

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

    // Payment card at 5 minutes (only if not already paid)
    if (!hasShownFirstPayment && remaining <= 1500) {
      hasShownFirstPayment = true;
      showPaymentCardForInitial();
    }
  }, 250);
}

function stopTimerTick() {
  if (timerTickInterval) {
    clearInterval(timerTickInterval);
    timerTickInterval = null;
  }
}

// Pause / Resume with localStorage persistence
function pauseUserTimer() {
  if (isTimerPaused) return;
  isTimerPaused = true;
  stopTimerTick();
  localStorage.setItem('elio_timer_paused', 'true');
  localStorage.setItem('elio_timer_paused_at', Date.now().toString());
  localStorage.removeItem('elio_auto_paused');
  broadcastEvent('timer-paused');
}

function resumeUserTimer() {
  if (!isTimerPaused) return;

  const pausedAt = parseInt(localStorage.getItem('elio_timer_paused_at'));
  if (pausedAt && userSessionEndTime) {
    const pausedDuration = Date.now() - pausedAt;
    userSessionEndTime += pausedDuration;
    localStorage.setItem('elio_session_end_time', userSessionEndTime);
  }

  isTimerPaused = false;
  localStorage.removeItem('elio_timer_paused');
  localStorage.removeItem('elio_timer_paused_at');
  localStorage.removeItem('elio_auto_paused');
  updateUserTimerDisplay();
  startTimerTick();

  broadcastEvent('timer-resumed', { endTime: userSessionEndTime });
}

// Page Visibility – pause when user leaves tab, auto-resume when they return
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    if (!isTimerPaused && userSessionEndTime) {
      isTimerPaused = true;
      stopTimerTick();
      localStorage.setItem('elio_timer_paused', 'true');
      localStorage.setItem('elio_timer_paused_at', Date.now().toString());
      localStorage.setItem('elio_auto_paused', 'true');
      broadcastEvent('timer-paused');
    }
  } else {
    if (isTimerPaused && localStorage.getItem('elio_auto_paused') === 'true' && !isPaymentInProgress) {
      localStorage.removeItem('elio_auto_paused');
      resumeUserTimer();
    }
  }
});

// User‑ended session
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
  isPaymentInProgress = false;
  // Clear all payment‑related flags
  localStorage.removeItem('elio_payment_card_shown');
  localStorage.removeItem('elio_continue_pending');
  userEndedSession('User declined payment');
}

// 3. CONVERSATION START / STOP
function startUserSessionTimer(endTime) {
  userSessionEndTime = endTime || Date.now() + 30 * 60 * 1000;
  localStorage.setItem('elio_session_end_time', userSessionEndTime);
  localStorage.setItem('elio_session_active', 'true');
  localStorage.removeItem('elio_timer_paused');
  // Prevent re‑prompting payment if already paid before refresh
  hasShownFirstPayment = localStorage.getItem('elio_has_paid_initial') === 'true';
  isTimerPaused = false;
  updateUserTimerDisplay();
  if (timerBar) timerBar.style.display = 'flex';
  startTimerTick();
}

function endSessionDueToTimeout() {
  broadcastEvent('user-ended-session', { reason: 'Session time limit reached' });
  cleanupAfterEnd();
}

// Centralised cleanup of ALL session localStorage keys
function clearAllSessionStorage() {
  localStorage.removeItem('elio_session_active');
  localStorage.removeItem('elio_session_waiting');
  localStorage.removeItem('elio_session_token');
  localStorage.removeItem('elio_session_time');
  localStorage.removeItem('elio_session_end_time');
  localStorage.removeItem('elio_timer_paused');
  localStorage.removeItem('elio_timer_paused_at');
  localStorage.removeItem('elio_auto_paused');
  localStorage.removeItem('elio_card_token');
  localStorage.removeItem('elio_has_paid_initial');
  localStorage.removeItem('elio_payment_card_shown');
  localStorage.removeItem('elio_continue_pending');
}

function cleanupAfterEnd() {
  stopTimerTick();
  userSessionEndTime = null;
  isTimerPaused = false;
  if (timerBar) timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';
  const endCard = document.getElementById('endCard');
  if (endCard) endCard.classList.add('show');
  const bookBtn = document.getElementById('bookNowBtn');
  if (bookBtn) bookBtn.style.display = 'block';
  ChatManager.cleanup();
  cleanupSessionChannel();
  clearAllSessionStorage();
}

// 4. ADMIN ACTIONS (received via broadcast)
function showAdminEndedSession(reason = 'The listener has ended this conversation.') {
  cleanupSessionChannel();
  stopTimerTick();
  userSessionEndTime = null;
  timerBar.style.display = 'none';
  chatContainer.style.display = 'none';
  document.getElementById('inputWrap').style.display = 'none';

  overlay.classList.add('show');

  let adminEndCard = document.getElementById('adminEndCard');
  if (!adminEndCard) {
    adminEndCard = document.createElement('div');
    adminEndCard.id = 'adminEndCard';
    adminEndCard.className = 'card';
    adminEndCard.innerHTML = `
      <p class="card-title">Listener ended this conversation</p>
      <p class="card-sub" id="adminEndReason">${reason}</p>
      <button class="card-btn primary" id="closeAdminEndCard">Okay</button>
    `;
    document.body.appendChild(adminEndCard);
    document.getElementById('closeAdminEndCard').addEventListener('click', () => {
      adminEndCard.classList.remove('show');
      overlay.classList.remove('show');
      document.getElementById('bookNowBtn').style.display = 'block';
    });
  } else {
    document.getElementById('adminEndReason').textContent = reason;
  }
  adminEndCard.classList.add('show');
  document.getElementById('bookNowBtn').style.display = 'block';

  ChatManager.cleanup();
  clearAllSessionStorage();
}

function handleAdminTimerPaused() {
  if (isTimerPaused) return;
  isTimerPaused = true;
  stopTimerTick();
  if (!localStorage.getItem('elio_timer_paused_at')) {
    localStorage.setItem('elio_timer_paused_at', Date.now().toString());
  }
  localStorage.setItem('elio_timer_paused', 'true');
  if (typeof createBubble === 'function') {
    createBubble('Listener paused the timer', 'system');
  }
}

function handleAdminTimerResumed(payload) {
  if (!isTimerPaused) return;
  if (payload?.endTime) {
    userSessionEndTime = payload.endTime;
    localStorage.setItem('elio_session_end_time', userSessionEndTime);
  }
  isTimerPaused = false;
  localStorage.removeItem('elio_timer_paused');
  localStorage.removeItem('elio_timer_paused_at');
  localStorage.removeItem('elio_auto_paused');
  updateUserTimerDisplay();
  startTimerTick();
  if (typeof createBubble === 'function') {
    createBubble('Listener resumed the timer', 'system');
  }
}

// 5. PAYMENT CARDS (mandatory payment only, no extension)
function showContinueCard() {
  const continueCard = document.getElementById('continueCard');
  if (continueCard) showCard(continueCard);
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('continueSessionBtn');
  if (btn) {
    btn.addEventListener('click', () => {
      hideCard(document.getElementById('continueCard'));
      isPaymentInProgress = false;
      localStorage.removeItem('elio_continue_pending');   // clear flag
      resumeUserTimer();
    });
  }
});

function showPaymentCardForInitial() {
  pauseUserTimer();
  isPaymentInProgress = true;
  localStorage.setItem('elio_payment_card_shown', 'true');   // flag for restore

  const payCard = document.getElementById('payCard');
  if (!payCard) return;
  const payBtn = document.getElementById('payBtn');
  const declineBtn = document.getElementById('payDecline');

  payBtn.onclick = async () => {
    try {
      const success = await processPayment(5);
      if (success) {
        hideCard(payCard);
        localStorage.removeItem('elio_payment_card_shown');
        localStorage.setItem('elio_continue_pending', 'true');
        showContinueCard();
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
    declinePaymentEnd();   // clears flags + ends session
  };
  showCard(payCard);
}

function showPaymentRetryCard() {
  pauseUserTimer();
  isPaymentInProgress = true;
  localStorage.setItem('elio_payment_card_shown', 'true');   // retry is still payment stage

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
      localStorage.removeItem('elio_payment_card_shown');
      localStorage.setItem('elio_continue_pending', 'true');
      showContinueCard();
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

    return new Promise((resolve) => {
      FlutterwaveCheckout({
        public_key: 'FLWPUBK-177ced4d17b3d3e9b9f00d7394f88264-X',   // your live key
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
          localStorage.setItem('elio_has_paid_initial', 'true');   // prevent re‑prompt
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

// 6. REALTIME LISTENER & BROADCAST
function listenForStartSignal() {
  const sessionToken = localStorage.getItem('elio_session_token');
  if (!sessionToken) return;

  // Always clean up previous subscription before creating new one
  cleanupSessionChannel();

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
    localStorage.setItem('elio_session_active', 'true');
    startUserSessionTimer(startTime + 30 * 60 * 1000);

    // Ensure chat subscription is active
    const token = localStorage.getItem('elio_session_token');
    if (token) ChatManager.init(token);
  });

  sessionChannel.on('broadcast', { event: 'end-session' }, (payload) => {
    showAdminEndedSession(payload?.reason || 'The listener has ended this conversation.');
  });

  sessionChannel.on('broadcast', { event: 'timer-paused' }, () => {
    handleAdminTimerPaused();
  });

  sessionChannel.on('broadcast', { event: 'timer-resumed' }, (payload) => {
    handleAdminTimerResumed(payload);
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

// 7. DISCONNECT NOTIFICATION
window.addEventListener('beforeunload', () => {
  if (sessionChannel && userSessionEndTime) {
    broadcastEvent('user-disconnected', {});
  }
});

// 8. GLOBAL EXPOSURE
window.startUserSessionTimer = startUserSessionTimer;
window.clearAllSessionStorage = clearAllSessionStorage;
window.stopUserSessionTimer = () => {
  stopTimerTick();
  timerBar.style.display = 'none';
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

// Restore timer if session was active, honour paused flag & payment stage
(function restoreTimerOnReload() {
  if (localStorage.getItem('elio_session_active') === 'true') {
    const savedEndTime = parseInt(localStorage.getItem('elio_session_end_time'));
    const wasPaused = localStorage.getItem('elio_timer_paused') === 'true';
    const autoPaused = localStorage.getItem('elio_auto_paused') === 'true';
    const pausedAt = parseInt(localStorage.getItem('elio_timer_paused_at'));

    if (savedEndTime && savedEndTime > Date.now()) {
      if (autoPaused) {
        // Visibility pause – just resume normally, no cards
        localStorage.removeItem('elio_auto_paused');
        localStorage.removeItem('elio_timer_paused');
        localStorage.removeItem('elio_timer_paused_at');
        startUserSessionTimer(savedEndTime);
      } else {
        let adjustedEndTime = savedEndTime;
        if (wasPaused && pausedAt) {
          const pausedDuration = Date.now() - pausedAt;
          adjustedEndTime = savedEndTime + pausedDuration;
          localStorage.setItem('elio_timer_paused_at', Date.now().toString());
          localStorage.setItem('elio_session_end_time', adjustedEndTime);
        }
        startUserSessionTimer(adjustedEndTime);
        if (wasPaused) {
          pauseUserTimer();   // keep paused

          // Restore the correct payment‑stage card
          if (localStorage.getItem('elio_continue_pending') === 'true') {
            showContinueCard();            // show "Continue session" – timer stays paused
          } else if (localStorage.getItem('elio_payment_card_shown') === 'true') {
            showPaymentCardForInitial();   // show payment card again (re‑sets flags)
          }
        }
      }
    } else {
      clearAllSessionStorage();
    }
  }
})();
// booking.js – User booking, timezone, countdown, and chat init

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN_BOOKING_LEAD_MINUTES = 540;  

// ---- Sync with server clock ----
let serverTimeOffset = 0;

(async function syncServerTime() {
  try {
    const res = await fetch('https://eliobackend.onrender.com/server-time');
    const data = await res.json();
    if (data.now) {
      serverTimeOffset = data.now - Date.now();
      console.log('Server time offset:', serverTimeOffset, 'ms');
    }
  } catch (e) {
    console.warn('Could not sync server time, using client clock');
  }
})();

function serverNow() {
  return Date.now() + serverTimeOffset;
}

const timezoneDisplay = document.getElementById('timezoneDisplay');
if (timezoneDisplay) {
  timezoneDisplay.textContent = `Your time zone: ${userTimezone}`;
}

// DOM Elements
const bookCard    = document.getElementById('bookCard');
const bookNowBtn  = document.getElementById('bookNowBtn');
const inputWrap   = document.getElementById('inputWrap');
const countdown   = document.getElementById('countdown');
const bookDate    = document.getElementById('bookDate');
const bookTime    = document.getElementById('bookTime'); 
const bookConfirm = document.getElementById('bookConfirm');
const bookCancel  = document.getElementById('bookCancel');

const sessionTimeUserEl = document.getElementById('sessionTimeUser');
const daysEl    = document.getElementById('days');
const hoursEl   = document.getElementById('hours');
const minutesEl = document.getElementById('minutes');
const secondsEl = document.getElementById('seconds');

let timerInterval = null;

// ---- Check if user already has an upcoming session ----
function hasUpcomingSession() {
  if (localStorage.getItem('elio_session_active') === 'true') return true;
  if (localStorage.getItem('elio_session_waiting') === 'true') return true;
  const savedBooking = localStorage.getItem('elio_session_time');
  if (savedBooking) {
    const sessionTime = new Date(savedBooking);
    if (sessionTime > new Date()) return true;
  }
  return false;
}

// ---- Allow today's date (local, not UTC) ----
const localToday = new Date();
const todayLocal = [
  localToday.getFullYear(),
  String(localToday.getMonth() + 1).padStart(2, '0'),
  String(localToday.getDate()).padStart(2, '0')
].join('-');
bookDate.min = todayLocal;

// ----- Session State Restoration -----
const isActiveSession = localStorage.getItem('elio_session_active') === 'true';
const isWaiting = localStorage.getItem('elio_session_waiting') === 'true';
const savedToken = localStorage.getItem('elio_session_token');

// Guard: if either active/waiting flag is set but there's no token, the state
// is stale (session ended without a full cleanup). Wipe it and start fresh.
if ((isActiveSession || isWaiting) && !savedToken) {
  localStorage.removeItem('elio_session_active');
  localStorage.removeItem('elio_session_waiting');
  localStorage.removeItem('elio_session_time');
  localStorage.removeItem('elio_session_end_time');
  localStorage.removeItem('elio_timer_paused');
  localStorage.removeItem('elio_timer_paused_at');
  localStorage.removeItem('elio_auto_paused');
  localStorage.removeItem('elio_card_token');
  showWelcome();
} else if (isActiveSession && savedToken) {
  welcome.style.display = 'none';
  countdown.style.display = 'none';
  chatContainer.style.display = 'flex';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'flex';
  listenForStartSignal();
  ChatManager.init(savedToken);
} else if (isWaiting && savedToken) {
  welcome.style.display = 'none';
  countdown.style.display = 'none';
  chatContainer.style.display = 'flex';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'flex';
  listenForStartSignal();
  ChatManager.init(savedToken);
  showWaitingState();
} else {
  const savedBooking = localStorage.getItem('elio_session_time');
  if (savedBooking) {
    const sessionTime = new Date(savedBooking);
    if (sessionTime > new Date()) {
      showCountdown(sessionTime);
      listenForStartSignal();
    } else {
      localStorage.removeItem('elio_session_time');
      showWelcome();
    }
  } else {
    showWelcome();
  }
}

// ----- Date change → load available times -----
bookDate.addEventListener('change', loadSlots);
async function loadSlots() {
  const date = bookDate.value; // YYYY-MM-DD in the user's local timezone (matches the date picker)
  if (!date) return;

  const grid = document.getElementById('timeSlots');
  grid.innerHTML = '<span style="color:var(--text-soft);">Loading…</span>';
  grid.style.display = 'block';
  bookTime.value = '';

  const now = serverNow();
  const earliestBase = now + MIN_BOOKING_LEAD_MINUTES * 60 * 1000;

  let slots = [];
  try {
    // date is sent as WAT date — the server generates slots in WAT and returns UTC
    const res = await fetch(`https://eliobackend.onrender.com/slots?date=${date}`);
    const data = await res.json();
    if (data.success) slots = data.slots;
  } catch (err) {
    console.error('Failed to load slots:', err);
    grid.innerHTML = '<span style="color:var(--text-soft);">Could not load times. Please try again.</span>';
    return;
  }

  grid.innerHTML = '';
  let anyAvailable = false;

  slots.forEach(slot => {
    const slotMs = new Date(slot.utc).getTime();

    // Past or within lead time — show greyed out
    const isPast = slotMs < earliestBase;
    const full = !slot.available;
    const spotsLeft = 3 - slot.booked;

    // Display time in the USER's local timezone
    const timePart = new Date(slot.utc).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    });

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'time-slot-btn';
    btn.textContent = timePart;
    btn.dataset.value = slot.utc; // store UTC — sent directly to backend

    if (isPast) {
      btn.disabled = true;
      btn.classList.add('past');
    } else if (full) {
      btn.disabled = true;
      btn.textContent += ' · taken';
      btn.classList.add('full');
    } else {
      if (spotsLeft === 1) btn.textContent += ' · 1 left';
      anyAvailable = true;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.time-slot-btn.selected').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        bookTime.value = slot.utc; // UTC goes straight to the backend
      });
    }

    grid.appendChild(btn);
  });

  if (!anyAvailable) {
    grid.innerHTML = '<span style="color:var(--text-soft);">No openings on this day</span>';
  }
}

// ----- Confirm booking -----
bookConfirm.addEventListener('click', async () => {
  if (hasUpcomingSession()) {
    alert('You already have an upcoming conversation. Please wait for it to finish or end it first.');
    return;
  }

  const slotTime = bookTime.value;
  if (!slotTime || slotTime === '') return alert('Pick a time first.');

  const sessionToken = crypto.randomUUID?.() ?? 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
  const bookingDateTime = new Date(slotTime);

  bookConfirm.disabled = true;
  bookConfirm.textContent = 'Booking…';

  try {
    const res = await fetch('https://eliobackend.onrender.com/create-booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
  // slotTime is already a UTC ISO string from the /slots endpoint
  body: JSON.stringify({ token: sessionToken, booking_time: slotTime, timezone: userTimezone })
    });

    const data = await res.json();

    if (!data.success) {
      if (res.status === 409) {
        alert('That spot just got taken. Please pick another time.');
        await loadSlots();
      } else {
        alert('Booking failed: ' + (data.message || 'Please try again.'));
      }
      bookConfirm.disabled = false;
      bookConfirm.textContent = 'Schedule a conversation for $5';
      return;
    }
  } catch (err) {
    console.error(err);
    alert('Something went wrong on our end. Check your connection and try again.');
    bookConfirm.disabled = false;
    bookConfirm.textContent = 'Schedule a conversation';
    return;
  }

  localStorage.setItem('elio_session_token', sessionToken);
  localStorage.setItem('elio_session_time', slotTime);
  hideCard(bookCard);
  bookConfirm.disabled = false;
  bookConfirm.textContent = 'Schedule a conversation';
  showCountdown(bookingDateTime);
  listenForStartSignal();
  showWaitingState();
});

bookCancel.addEventListener('click', () => hideCard(bookCard));

// ----- Open booking card -----
function openBookingCard() {
  if (hasUpcomingSession()) {
    alert('You have already scheduled a conversation. Please wait for it to finish or end it first.');
    return;
  }
  bookDate.value = '';
  document.getElementById('timeSlots').innerHTML = '';
  document.getElementById('timeSlots').style.display = 'none';
  bookTime.value = '';
  showCard(bookCard);
}

// ----- UI States -----
function showWelcome() {
  welcome.style.display = 'block';
  countdown.style.display = 'none';
  chatContainer.style.display = 'none';
  if (bookNowBtn) bookNowBtn.style.display = 'block';
  if (inputWrap) inputWrap.style.display = 'none';
  if (timerInterval) clearInterval(timerInterval);
}

function showCountdown(sessionTime) {
  welcome.style.display = 'none';
  countdown.style.display = 'block';
  chatContainer.style.display = 'none';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'none';
  updateTimerDisplay(sessionTime);
  timerInterval = setInterval(() => updateTimerDisplay(sessionTime), 1000);
}

function updateTimerDisplay(sessionTime) {
  const now = new Date(serverNow());
  const diff = sessionTime - now;
  if (diff <= 0) {
    clearInterval(timerInterval);
    localStorage.removeItem('elio_session_time');
    localStorage.setItem('elio_session_waiting', 'true');

    welcome.style.display = 'none';
    countdown.style.display = 'none';
    chatContainer.style.display = 'flex';
    addListenerWelcomeMessage();
    showWaitingState();
    if (bookNowBtn) bookNowBtn.style.display = 'none';
    if (inputWrap) inputWrap.style.display = 'flex';
    listenForStartSignal();
    const sessionToken = localStorage.getItem('elio_session_token');
    if (sessionToken) {
      ChatManager.init(sessionToken);
    }
    return;
  }

  sessionTimeUserEl.textContent = `Your conversation: ${sessionTime.toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: userTimezone
  })}`;
  const totalSeconds = Math.floor(diff / 1000);
  daysEl.textContent = Math.floor(totalSeconds / 86400);
  hoursEl.textContent = Math.floor((totalSeconds % 86400) / 3600);
  minutesEl.textContent = Math.floor((totalSeconds % 3600) / 60);
  secondsEl.textContent = totalSeconds % 60;
}

// ----- Event listeners -----
if (bookNowBtn) bookNowBtn.addEventListener('click', openBookingCard);
const sidebarBookLink = document.querySelector('[data-action="book"]');
if (sidebarBookLink) sidebarBookLink.addEventListener('click', (e) => {
  e.preventDefault();
  openBookingCard();
});
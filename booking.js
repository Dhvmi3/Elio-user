// booking.js – User booking, timezone, countdown, and chat init

const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
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

// Minimum date is tomorrow
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
bookDate.min = tomorrow.toISOString().split('T')[0];

// ----- Session State Restoration (fixes refresh/tab-close loss) -----
const isActiveSession = localStorage.getItem('elio_session_active') === 'true';
const savedToken = localStorage.getItem('elio_session_token');

if (isActiveSession && savedToken) {
  // Restore chat UI immediately
  welcome.style.display = 'none';
  countdown.style.display = 'none';
  chatContainer.style.display = 'flex';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'flex';
  listenForStartSignal();                    // reconnect to session channel
  ChatManager.init(savedToken);             // reload messages & subscribe
} else {
  // Normal flow: check for future booking
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

// ----- Date change → load available times from backend -----
bookDate.addEventListener('change', loadSlots);
async function loadSlots() {
  const date = bookDate.value;
  if (!date) return;

  bookTime.innerHTML = '<option disabled selected>Loading…</option>';
  bookTime.disabled = true;

  const possibleTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
  const MAX_PER_SLOT = 3;

  let counts = {};
  try {
    const res = await fetch(`https://eliobackend.onrender.com/slot-counts?date=${date}`);
    const data = await res.json();
    if (data.success) counts = data.counts;
  } catch (err) {
    console.error('Failed to load slot availability:', err);
    // Fall through - treat all slots as available if fetch fails
  }

  bookTime.innerHTML = '<option value="" disabled selected>Select a time…</option>';
  let anyAvailable = false;

  possibleTimes.forEach(t => {
    const slotISO = `${date}T${t}`;       
    const booked  = counts[slotISO] || 0;
    const spotsLeft = MAX_PER_SLOT - booked;
    const full = spotsLeft <= 0;

    const timePart = new Date(`${slotISO}:00`).toLocaleTimeString([], {
      hour: '2-digit', minute: '2-digit'
    });

    const option = document.createElement('option');
    option.value = `${slotISO}:00`;     

    if (full) {
      option.textContent = `${timePart} - Full`;
      option.disabled = true;
      option.style.color = '#bbb';
    } else {
      option.textContent = spotsLeft === 1
        ? `${timePart} - 1 spot left`
        : `${timePart}`;
      anyAvailable = true;
    }

    bookTime.appendChild(option);
  });

  if (!anyAvailable) {
    bookTime.innerHTML = '<option disabled selected>No spots available for this date</option>';
  }

  bookTime.disabled = false;
}

// ----- Confirm booking -----
bookConfirm.addEventListener('click', async () => {
  if (localStorage.getItem('elio_session_active') === 'true' || chatContainer.style.display === 'flex') {
    alert('You\'re still in a session. End it first, then come back.');
    return;
  }

  const slotTime = bookTime.value;
  if (!slotTime || slotTime === '') return alert('Pick a time first.');

  const sessionToken = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
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
      body: JSON.stringify({
        token: sessionToken,
        booking_time: bookingDateTime.toISOString(),
        timezone: userTimezone
      })
    });

    const data = await res.json();

    if (!data.success) {
      // Slot filled up between them loading times and clicking confirm
      if (res.status === 409) {
        alert('That spot just got taken. Please pick another time.');
        await loadSlots(); // refresh the dropdown to show updated availability
      } else {
        alert('Booking failed: ' + (data.message || 'Please try again.'));
      }
      bookConfirm.disabled = false;
      bookConfirm.textContent = 'Book my session for $5';
      return;
    }
  } catch (err) {
    console.error(err);
    alert('Something went wrong on our end. Check your connection and try again.');
    bookConfirm.disabled = false;
    bookConfirm.textContent = 'Book my session for $5';
    return;
  }

  localStorage.setItem('elio_session_token', sessionToken);
  localStorage.setItem('elio_session_time', slotTime);
  hideCard(bookCard);
  bookConfirm.disabled = false;
  bookConfirm.textContent = 'Book my session for $5';

  // TEST MODE (skip countdown) – will be removed for production
  welcome.style.display = 'none';
  countdown.style.display = 'none';
  chatContainer.style.display = 'flex';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'flex';
  localStorage.removeItem('elio_session_time');          // countdown not needed in test mode
  localStorage.setItem('elio_session_active', 'true');   // mark session active for reloads
  listenForStartSignal();
  ChatManager.init(sessionToken);
  showWaitingState();                             
});

// ----- Cancel button -----
bookCancel.addEventListener('click', () => hideCard(bookCard));

// ----- Open booking card -----
function openBookingCard() {
  if (localStorage.getItem('elio_session_active') === 'true' || chatContainer.style.display === 'flex') {
    alert('You\'re in a session right now.');
    return;
}
  bookDate.value = '';
  bookTime.innerHTML = '<option>Choose a date above first</option>';
  bookTime.disabled = false;
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
  const now = new Date();
  const diff = sessionTime - now;
  if (diff <= 0) {
    clearInterval(timerInterval);
    localStorage.removeItem('elio_session_time');
    // Do NOT set elio_session_active here the session hasn't actually started yet.
    // It gets set inside listenForStartSignal() when the admin sends the first message
    // and the 'start-session' broadcast arrives.
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
  sessionTimeUserEl.textContent = `Your session: ${sessionTime.toLocaleString(undefined, {
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
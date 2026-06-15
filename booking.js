// booking.js – Fixed timezone alignment for WAT-based booking system

const WAT_TZ = 'Africa/Lagos';
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const MIN_BOOKING_LEAD_MS = 540 * 60 * 1000; // 9 hours in milliseconds
const SLOT_INTERVAL_MINUTES = 30;
const MAX_PER_SLOT = 3;

// ---- Sync with server clock ----
let serverTimeOffset = 0;
let serverTimeSynced = false;

(async function syncServerTime() {
  try {
    const res = await fetch('https://eliobackend.onrender.com/server-time');
    const data = await res.json();
    if (data.now) {
      serverTimeOffset = data.now - Date.now();
      serverTimeSynced = true;
      console.log('Server time offset:', serverTimeOffset, 'ms');
      updateDatePickerMin();
    }
  } catch (e) {
    console.warn('Could not sync server time, using client clock');
    // Fallback: use client clock
    updateDatePickerMin();
  }
})();

function serverNow() {
  return Date.now() + serverTimeOffset;
}

// ---- Timezone helper functions ----

/**
 * Get YYYY-MM-DD date string for a UTC timestamp in a specific timezone
 */
function getDateInTimezone(timestamp, tz) {
  return new Date(timestamp).toLocaleDateString('en-CA', { timeZone: tz });
}

/**
 * Get WAT date string for a UTC timestamp
 */
function getWATDateString(timestamp) {
  return getDateInTimezone(timestamp, WAT_TZ);
}

/**
 * Get the user's local date string for a UTC timestamp
 */
function getLocalDateString(timestamp) {
  return getDateInTimezone(timestamp, userTimezone);
}

/**
 * Format a UTC timestamp as time string in a specific timezone
 */
function formatTimeInTimezone(timestamp, tz) {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: tz
  });
}

/**
 * Format a UTC timestamp as a full datetime string in a specific timezone
 */
function formatDateTimeInTimezone(timestamp, tz) {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: 'full',
    timeStyle: 'short',
    timeZone: tz
  });
}

/**
 * Get the UTC millisecond timestamp for midnight in a given timezone on a given date.
 * dateStr must be 'YYYY-MM-DD' in that timezone.
 */
function getMidnightUTC(dateStr, tz) {
  const [y, m, d] = dateStr.split('-').map(Number);

  // Use UTC noon on that date to safely get the timezone offset
  const noonUTC = Date.UTC(y, m - 1, d, 12, 0, 0);

  const parts = Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    timeZoneName: 'longOffset',
    hour12: false
  }).formatToParts(new Date(noonUTC));

  const offsetStr = parts.find(p => p.type === 'timeZoneName').value;
  // e.g. "GMT+01:00" or "GMT-05:00"

  const sign = offsetStr[3] === '+' ? 1 : -1;
  const [offsetH, offsetM] = offsetStr.substring(4).split(':').map(Number);
  const offsetMs = sign * (offsetH * 60 + offsetM) * 60 * 1000;

  // Midnight in the target timezone = UTC midnight minus the offset
  return Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMs;
}

/**
 * Get the UTC range [start, end) for a local date in a given timezone.
 * dateStr is 'YYYY-MM-DD' in that timezone.
 */
function getUTCRangeForLocalDate(dateStr, tz) {
  const midnightUTC = getMidnightUTC(dateStr, tz);
  return { start: midnightUTC, end: midnightUTC + 24 * 60 * 60 * 1000 };
}

// ---- Update date picker minimum date ----
function updateDatePickerMin() {
  if (!bookDate) return;

  // Earliest bookable moment = now (synced with server) + 9 hours
  const earliestBookingTime = serverNow() + MIN_BOOKING_LEAD_MS;

  // Convert to user's local date and set as minimum
  const minLocalDate = getLocalDateString(earliestBookingTime);
  bookDate.min = minLocalDate;

  console.log('Date picker min updated:', minLocalDate, '(earliest WAT booking:', getWATDateString(earliestBookingTime) + ')');
}

// ---- Display user timezone ----
const timezoneDisplay = document.getElementById('timezoneDisplay');
if (timezoneDisplay) {
  timezoneDisplay.textContent = `Your time zone: ${userTimezone}`;
}

// ---- DOM Elements ----
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
    const sessionTime = new Date(savedBooking).getTime();
    if (sessionTime > serverNow()) return true;
  }
  return false;
}

// ---- Session State Restoration ----
const isActiveSession = localStorage.getItem('elio_session_active') === 'true';
const isWaiting       = localStorage.getItem('elio_session_waiting') === 'true';
const savedToken      = localStorage.getItem('elio_session_token');

// Guard: stale state (flag set but no token)
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
    const sessionTime = new Date(savedBooking).getTime();
    if (sessionTime > serverNow()) {
      showCountdown(new Date(savedBooking));
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
  const localDateStr = bookDate.value; // YYYY-MM-DD from date picker (user's local date)
  if (!localDateStr) return;

  const grid = document.getElementById('timeSlots');
  grid.innerHTML = '<span style="color:var(--text-soft);">Loading…</span>';
  grid.style.display = 'block';
  bookTime.value = '';

  // 1. UTC range for the user's chosen local day
  const range = getUTCRangeForLocalDate(localDateStr, userTimezone);

  // 2. Find which WAT dates cover that UTC interval
  const startWAT = getWATDateString(range.start);
  const endWAT   = getWATDateString(range.end - 1);
  const datesToFetch = [...new Set([startWAT, endWAT])];

  // 3. Fetch slots for all covering WAT dates
  const earliestBase = serverNow() + MIN_BOOKING_LEAD_MS;

  let allSlots = [];
  try {
    for (const date of datesToFetch) {
      const res = await fetch(`https://eliobackend.onrender.com/slots?date=${date}`);
      const data = await res.json();
      if (data.success) allSlots = allSlots.concat(data.slots);
    }
  } catch (err) {
    console.error('Failed to load slots:', err);
    grid.innerHTML = '<span style="color:var(--text-soft);">Could not load times. Please try again.</span>';
    return;
  }

  // 4. Keep only slots that fall within the user's local day AND respect the 9-hour WAT lead time
  const slotsOnThisDay = allSlots.filter(slot => {
    const slotMs = new Date(slot.utc).getTime();
    return slotMs >= range.start && slotMs < range.end && slotMs >= earliestBase;
  });

  // Sort by UTC time for consistent display order
  slotsOnThisDay.sort((a, b) => new Date(a.utc) - new Date(b.utc));

  // 5. Render
  grid.innerHTML = '';
  let anyAvailable = false;

  slotsOnThisDay.forEach(slot => {
    const full = !slot.available;
    const spotsLeft = MAX_PER_SLOT - slot.booked;

    // Display time in the USER's timezone
    const timePart = formatTimeInTimezone(slot.utc, userTimezone);

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'time-slot-btn';
    btn.textContent = timePart;
    btn.dataset.value = slot.utc;

    if (full) {
      btn.disabled = true;
      btn.textContent += ' · taken';
      btn.classList.add('full');
    } else {
      if (spotsLeft === 1) btn.textContent += ' · 1 left';
      anyAvailable = true;
      btn.addEventListener('click', () => {
        grid.querySelectorAll('.time-slot-btn.selected').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        bookTime.value = slot.utc;
      });
    }

    grid.appendChild(btn);
  });

  if (!anyAvailable) {
    // Find the next available date to guide the user
    const nextAvailableMsg = await findNextAvailableDateHint(localDateStr, earliestBase);
    grid.innerHTML = `<span style="color:var(--text-soft);">No openings on this day.</span>${nextAvailableMsg}`;
  }
}

/**
 * Check nearby dates and return a helpful hint about when the next slots are available.
 */
async function findNextAvailableDateHint(currentLocalDateStr, earliestBase) {
  // Check up to 7 days ahead
  for (let offset = 1; offset <= 7; offset++) {
    const checkDate = new Date(getMidnightUTC(currentLocalDateStr, userTimezone) + offset * 86400000);
    const checkDateStr = getLocalDateString(checkDate.getTime());

    const range = getUTCRangeForLocalDate(checkDateStr, userTimezone);
    const startWAT = getWATDateString(range.start);
    const endWAT   = getWATDateString(range.end - 1);
    const datesToFetch = [...new Set([startWAT, endWAT])];

    try {
      let allSlots = [];
      for (const date of datesToFetch) {
        const res = await fetch(`https://eliobackend.onrender.com/slots?date=${date}`);
        const data = await res.json();
        if (data.success) allSlots = allSlots.concat(data.slots);
      }

      const hasAvailable = allSlots.some(slot => {
        const slotMs = new Date(slot.utc).getTime();
        return slotMs >= range.start && slotMs < range.end && slotMs >= earliestBase && slot.available;
      });

      if (hasAvailable) {
        const formatted = new Date(getMidnightUTC(checkDateStr, userTimezone)).toLocaleDateString(undefined, {
          weekday: 'short', month: 'short', day: 'numeric',
          timeZone: userTimezone
        });
        return `<br><span style="color:var(--accent);cursor:pointer;text-decoration:underline;" onclick="document.getElementById('bookDate').value='${checkDateStr}';loadSlots();">Next openings on ${formatted} →</span>`;
      }
    } catch (e) {
      // Silently skip dates we can't check
    }
  }
  return '';
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
      body: JSON.stringify({
        token: sessionToken,
        booking_time: slotTime,
        timezone: userTimezone
      })
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

  // Reset form
  bookDate.value = '';
  document.getElementById('timeSlots').innerHTML = '';
  document.getElementById('timeSlots').style.display = 'none';
  bookTime.value = '';

  // Ensure date picker min is current before showing
  updateDatePickerMin();

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
  const now = serverNow();
  const sessionMs = sessionTime.getTime();
  const diff = sessionMs - now;

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

  // Display in user's timezone
  sessionTimeUserEl.textContent = `Your conversation: ${formatDateTimeInTimezone(sessionMs, userTimezone)}`;

  const totalSeconds = Math.floor(diff / 1000);
  daysEl.textContent    = Math.floor(totalSeconds / 86400);
  hoursEl.textContent   = Math.floor((totalSeconds % 86400) / 3600);
  minutesEl.textContent = Math.floor((totalSeconds % 3600) / 60);
  secondsEl.textContent = totalSeconds % 60;
}

// ----- Event listeners -----
if (bookNowBtn) bookNowBtn.addEventListener('click', openBookingCard);

const sidebarBookLink = document.querySelector('[data-action="book"]');
if (sidebarBookLink) {
  sidebarBookLink.addEventListener('click', (e) => {
    e.preventDefault();
    openBookingCard();
  });
}
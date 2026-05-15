// 1. ── Timezone Detection ─────────────────────────
const userTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
const timezoneDisplay = document.getElementById('timezoneDisplay');
if (timezoneDisplay) {
  timezoneDisplay.textContent = `Your time zone: ${userTimezone}`;
}

// 2. ── DOM Elements ───────────────────────────────
const bookCard    = document.getElementById('bookCard');
const bookNowBtn  = document.getElementById('bookNowBtn');
const inputWrap   = document.getElementById('inputWrap');
const countdown   = document.getElementById('countdown');
const chatContainer = document.getElementById('chat');
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

// 3. ── Set min date to tomorrow ───────────────────
const tomorrow = new Date();
tomorrow.setDate(tomorrow.getDate() + 1);
bookDate.min = tomorrow.toISOString().split('T')[0];

// 4. ── Simulated availability ─────────────────────
let slotAvailability = {};

// 5. ── Check for existing booking on load ─────────
const savedBooking = localStorage.getItem('elio_session_time');
if (savedBooking) {
  const sessionTime = new Date(savedBooking);
  if (sessionTime > new Date()) {
    showCountdown(sessionTime);
  } else {
    localStorage.removeItem('elio_session_time');
    showWelcome();
  }
} else {
  showWelcome();
}

// 6. ── Date change → load available times ─────────
bookDate.addEventListener('change', loadSlots);
function loadSlots() {
  const date = bookDate.value;
  if (!date) return;
  bookTime.innerHTML = '<option>Loading…</option>';
  bookTime.disabled = true;
  setTimeout(() => {
    const possibleTimes = ['09:00', '10:00', '11:00', '14:00', '15:00', '16:00'];
    const slots = [];
    possibleTimes.forEach(t => {
      const slotISO = `${date}T${t}:00`;
      if (!slotAvailability[slotISO]) slotAvailability[slotISO] = 3;
      if (slotAvailability[slotISO] > 0) slots.push(slotISO);
    });
    bookTime.innerHTML = '';
    if (slots.length === 0) {
      bookTime.innerHTML = '<option>No slots available</option>';
    } else {
      slots.forEach(slotISO => {
        const timePart = new Date(slotISO).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const option = document.createElement('option');
        option.value = slotISO;
        option.textContent = timePart;
        bookTime.appendChild(option);
      });
    }
    bookTime.disabled = false;
  }, 600);
}

// 7. ── Confirm booking ────────────────────────────
bookConfirm.addEventListener('click', () => {
  const slotTime = bookTime.value;
  if (!slotTime || slotTime === '') return alert('Please pick a date and time first.');
  if (!slotAvailability[slotTime] || slotAvailability[slotTime] <= 0) return alert('Sorry, no spots left for this time.');
  slotAvailability[slotTime]--;
  localStorage.setItem('elio_session_time', slotTime);
  hideCard(bookCard);
  
  // ==================== TEST MODE START ====================
  // Bypass the countdown – show chat immediately.
  // After testing, delete the block below and uncomment the original `showCountdown` line.
  welcome.style.display = 'none';
  countdown.style.display = 'none';
  chatContainer.style.display = 'flex';
  if (bookNowBtn) bookNowBtn.style.display = 'none';
  if (inputWrap) inputWrap.style.display = 'flex';
  localStorage.removeItem('elio_session_time'); // prevent leftover state
  // ==================== TEST MODE END ====================
  
  // ORIGINAL CODE (commented out – uncomment to restore normal waiting period)
  // showCountdown(new Date(slotTime));
});

bookCancel.addEventListener('click', () => hideCard(bookCard));

function openBookingCard() {
  bookDate.value = '';
  bookTime.innerHTML = '<option>Pick a date first</option>';
  bookTime.disabled = false;
  showCard(bookCard);
}

// 10. ── UI States ─────────────────────────────────
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
    welcome.style.display = 'none';
    countdown.style.display = 'none';
    chatContainer.style.display = 'flex';
    addListenerWelcomeMessage();
    if (bookNowBtn) bookNowBtn.style.display = 'none';
    if (inputWrap) inputWrap.style.display = 'flex';
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

// Event listeners
if (bookNowBtn) bookNowBtn.addEventListener('click', openBookingCard);
const sidebarBookLink = document.querySelector('[data-action="book"]');
if (sidebarBookLink) sidebarBookLink.addEventListener('click', (e) => {
  e.preventDefault();
  openBookingCard();
});
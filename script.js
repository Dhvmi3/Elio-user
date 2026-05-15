// ─── Chat Elements ───────────────────────────────
const chat     = document.getElementById('chat');
const msgInput = document.getElementById('msgInput');
const sendBtn  = document.getElementById('sendBtn');
const welcome  = document.getElementById('welcome');

// ─── Intersection Observer (Vanishing Messages) ───
const observer = new IntersectionObserver((entries) => {
  entries.forEach(entry => {
    if (!entry.isIntersecting) {
      entry.target.style.opacity = '0';
      entry.target.style.transition = 'opacity 0.4s ease';
      setTimeout(() => entry.target.remove(), 400);
    }
  });
}, {
  root: document.querySelector('.main'),
  threshold: 0,
  rootMargin: '0px 0px 60px 0px'
});

// ─── Create Chat Bubble ───────────────────────────
function createBubble(text, type) {
  const wrap = document.createElement('div');
  wrap.classList.add('bubble-wrap', type);

  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  bubble.textContent = text;

  wrap.appendChild(bubble);
  chat.appendChild(wrap);

  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
  observer.observe(wrap);
}

// ─── Send Message ─────────────────────────────────
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  createBubble(text, 'sent');
  msgInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);

msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

document.querySelectorAll('.bubble-wrap').forEach(b => observer.observe(b));

// ─── Intro Bubble Sequence ────────────────────────
const introMessages = [
  "Welcome to Elio.",
  "Say the things you can't say anywhere else.",
  "You're talking to a real human. Not a bot.",
  "$5. 30 minutes. No account needed.",
  "We're not a replacement for therapy or crisis support."
];

const TYPING_DELAY = 1800;   // how long typing indicator shows
const MESSAGE_GAP  = 4800;   // gap between each message

function createTypingIndicator() {
  const wrap = document.createElement('div');
  wrap.classList.add('bubble-wrap', 'received', 'typing-wrap');

  const bubble = document.createElement('div');
  bubble.classList.add('bubble', 'typing-bubble');
  bubble.innerHTML = `
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
    <span class="typing-dot"></span>
  `;

  wrap.appendChild(bubble);
  return wrap;
}

function runIntroSequence() {
  // Only run on welcome state (not when countdown or chat is active)
  const savedBooking = localStorage.getItem('elio_session_time');
  if (savedBooking) return;

  const welcomeChat = document.getElementById('welcomeChat');
  if (!welcomeChat) return;

  const bookNowBtn = document.getElementById('bookNowBtn');

  let delay = 600;

  introMessages.forEach((msg, i) => {
    const isLast = i === introMessages.length - 1;

    // Show typing indicator
    setTimeout(() => {
      const typingWrap = createTypingIndicator();
      welcomeChat.appendChild(typingWrap);
      typingWrap.scrollIntoView({ behavior: 'smooth', block: 'end' });

      // Replace typing indicator with actual message
      setTimeout(() => {
        typingWrap.remove();

        const wrap = document.createElement('div');
        wrap.classList.add('bubble-wrap', 'received', 'intro-bubble');

        const bubble = document.createElement('div');
        bubble.classList.add('bubble');
        bubble.textContent = msg;

        wrap.appendChild(bubble);
        welcomeChat.appendChild(wrap);
        wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });

        // Fade in Book a Session button after last message
        if (isLast && bookNowBtn) {
          setTimeout(() => {
            bookNowBtn.classList.add('visible');
          }, 600);
        }
      }, TYPING_DELAY);

    }, delay);

    delay += MESSAGE_GAP;
  });
}

// Run intro after a short breath on load
window.addEventListener('DOMContentLoaded', () => {
  // Hide book button initially — fades in after last intro message
  const bookNowBtn = document.getElementById('bookNowBtn');
  const savedBooking = localStorage.getItem('elio_session_time');
  if (bookNowBtn && !savedBooking) {
    bookNowBtn.classList.remove('visible');
  }

  setTimeout(runIntroSequence, 800);
});

// ─── Automated welcome message from listener ─────────
function addListenerWelcomeMessage() {
  const chatContainer = document.getElementById('chat');
  if (!chatContainer) return;
  
  // Create a received bubble (listener's message)
  const wrap = document.createElement('div');
  wrap.classList.add('bubble-wrap', 'received');
  
  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  bubble.textContent = "Hi, welcome. I'm here to listen. How are you feeling today?";
  
  wrap.appendChild(bubble);
  chatContainer.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
  
  // Observe it for the vanishing effect
  if (typeof observer !== 'undefined' && observer) {
    observer.observe(wrap);
  }
}
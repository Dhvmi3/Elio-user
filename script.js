// script.js – Chat UI, intro sequence, and integration with ChatManager

const chat     = document.getElementById('chat');
const msgInput = document.getElementById('msgInput');
const sendBtn  = document.getElementById('sendBtn');
const welcome  = document.getElementById('welcome');
var chatContainer = document.getElementById('chat');

// Intersection Observer (vanishing messages)
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

// Create Chat Bubble – now accepts optional messageId for duplicate prevention
function createBubble(text, type, messageId = null) {
  // Prevent duplicate rendering
  if (messageId && document.getElementById(`msg-${messageId}`)) return;

  const wrap = document.createElement('div');
  wrap.classList.add('bubble-wrap', type);
  if (messageId) wrap.id = `msg-${messageId}`;

  const bubble = document.createElement('div');   // ← bubble is now declared
  bubble.classList.add('bubble');
  bubble.textContent = text;

  // --- System message styling (moved here, after bubble exists) ---
  if (type === 'system') {
    wrap.classList.add('system-msg');
    bubble.style.fontStyle = 'italic';
    bubble.style.color = '#888';
    bubble.style.textAlign = 'center';
  }

  wrap.appendChild(bubble);
  chat.appendChild(wrap);

  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
  observer.observe(wrap);
}

// Send Message – now uses ChatManager (inserts into DB; realtime will render it)
function sendMessage() {
  const text = msgInput.value.trim();
  if (!text) return;
  ChatManager.sendMessage('user', text);
  msgInput.value = '';
}

sendBtn.addEventListener('click', sendMessage);
msgInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Observe any existing bubbles (none at start, but for safety)
document.querySelectorAll('.bubble-wrap').forEach(b => observer.observe(b));

// Intro Bubble Sequence
const introMessages = [
  "Welcome to Elio, your human chatbot.",
  "Here, you can say the things you never could. The good, the bad, the messy, the weird. All of it is welcome.",
  "No accounts. No history. No judgment. These conversations is completely anonymous. (I have no idea who you are because conversations shouldn't be decided by who you are.)",
  "A real human is on the other side, because some conversations need a heartbeat, not an algorithm. (Yes, a human is literally taking AI’s job here.)",
  "Here’s how it works:",
  "You book a time that fits your life. When your scheduled time reaches, you have 10 minutes to join. If you’re not here by then, we mark it cancelled, no charge, no awkwardness.",
  "When you arrive, just say hi. Seriously, that’s all.",
  "For the price of a coffee. 30 minutes of real listening· No account needed.",
  "One last thing. Elio is a listening ear, not a substitute for therapy or crisis support. If you're in real danger, please reach out to a professional available in your country as we're not a trained therapist.",
  "Pls do get help if you're in danger, I'll love to help  but I'm not a licensed therapist and I don't want to pretend to be. Please reach out to a professional if things get serious."
];

const TYPING_DELAY = 2000;
const MESSAGE_GAP  = 4000;

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
  const savedBooking = localStorage.getItem('elio_session_time');
  if (savedBooking) return;
  const welcomeChat = document.getElementById('welcomeChat');
  if (!welcomeChat) return;
  const bookNowBtn = document.getElementById('bookNowBtn');
  let delay = 600;
  introMessages.forEach((msg, i) => {
    const isLast = i === introMessages.length - 1;
    setTimeout(() => {
      const typingWrap = createTypingIndicator();
      welcomeChat.appendChild(typingWrap);
      typingWrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        if (isLast && bookNowBtn) {
          setTimeout(() => {
            bookNowBtn.classList.add('visible');
          }, 400);
        }
      }, TYPING_DELAY);
    }, delay);
    delay += MESSAGE_GAP;
  });
}

window.addEventListener('DOMContentLoaded', () => {
  const bookNowBtn = document.getElementById('bookNowBtn');
  const savedBooking = localStorage.getItem('elio_session_time');
  if (bookNowBtn && !savedBooking) {
    bookNowBtn.classList.remove('visible');
  }
  setTimeout(runIntroSequence, 800);
});

// Automated welcome message from listener (used when countdown ends)
function addListenerWelcomeMessage() {
  const chatContainer = document.getElementById('chat');
  if (!chatContainer) return;
  const wrap = document.createElement('div');
  wrap.classList.add('bubble-wrap', 'received');
  const bubble = document.createElement('div');
  bubble.classList.add('bubble');
  bubble.textContent = "Hi, welcome. Say hello whenever you're ready and let's get this convo started.";
  wrap.appendChild(bubble);
  chatContainer.appendChild(wrap);
  wrap.scrollIntoView({ behavior: 'smooth', block: 'end' });
  if (typeof observer !== 'undefined' && observer) {
    observer.observe(wrap);
  }
}
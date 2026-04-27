const express = require('express');
const cors    = require('cors');

const app  = express();
const PORT = process.env.PORT || 3000;

// ---------------------------------------------------------------------------
// Token configuration
// WAKE_TOKENS = comma-separated list of valid tokens, e.g. "tok1,tok2,tok3"
// Falls back to legacy WAKE_TOKEN for single-token backwards compatibility.
// ---------------------------------------------------------------------------
const rawTokens = process.env.WAKE_TOKENS || process.env.WAKE_TOKEN || 'changeme-secret-token';
const VALID_TOKENS = new Set(
  rawTokens.split(',').map(t => t.trim()).filter(Boolean)
);

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let state = {
  triggered:    false,
  triggeredAt:  null,   // ISO timestamp
  triggeredBy:  null,   // display name supplied by sender
  senderToken:  null,   // which token was used to trigger (for receiver lookup)
  message:      null,   // optional encrypted/plain message
  dismissed:    false,
  dismissedAt:  null,   // ISO timestamp
  dismissedBy:  null,   // who dismissed
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timestamp() { return new Date().toISOString(); }

function log(event, extra = '') {
  console.log(`[${timestamp()}] ${event}${extra ? ' | ' + extra : ''}`);
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-wake-token'];
  if (!token || !VALID_TOKENS.has(token)) {
    log('AUTH_FAIL', `ip=${req.ip} path=${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  // Attach the resolved token so handlers can record it
  req.wakeToken = token;
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health — no auth (Railway / uptime monitors ping this)
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: timestamp() });
});

// GET /status — receiver polls this; returns full state
app.get('/status', authMiddleware, (_req, res) => {
  const now = Date.now();
  const needsAck =
    state.triggered &&
    !state.dismissed &&
    state.triggeredAt &&
    now - new Date(state.triggeredAt).getTime() > 5 * 60 * 1000; // 5 min

  res.json({
    triggered:   state.triggered,
    triggeredAt: state.triggeredAt,
    triggeredBy: state.triggeredBy,
    senderToken: state.senderToken,
    message:     state.message,
    dismissed:   state.dismissed,
    dismissedAt: state.dismissedAt,
    dismissedBy: state.dismissedBy,
    needsAck,                          // true after 5 min without dismissal
  });
});

// POST /trigger — sender fires the alarm
app.post('/trigger', authMiddleware, (req, res) => {
  const by      = req.body?.triggeredBy || 'unknown';
  const message = req.body?.message     || null;

  state = {
    triggered:   true,
    triggeredAt: timestamp(),
    triggeredBy: by,
    senderToken: req.wakeToken,        // record which token triggered
    message,
    dismissed:   false,
    dismissedAt: null,
    dismissedBy: null,
  };

  log('TRIGGER', `by=${by} token=${req.wakeToken.slice(0, 4)}**** hasMsg=${!!message}`);
  res.json({ ok: true });
});

// POST /reset — receiver dismisses the alarm (or sender cancels)
app.post('/reset', authMiddleware, (req, res) => {
  const by = req.body?.resetBy || 'unknown';

  log('RESET', `by=${by} wasTriggered=${state.triggered} at=${state.triggeredAt}`);

  state = {
    ...state,
    triggered:   false,
    dismissed:   true,
    dismissedAt: timestamp(),
    dismissedBy: by,
  };

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  log('SERVER_START', `port=${PORT} tokens=${VALID_TOKENS.size}`);
  if (VALID_TOKENS.has('changeme-secret-token')) {
    console.warn('[WARN] Using default token — set WAKE_TOKENS env var!');
  }
});

module.exports = app; // exported for tests

const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;
const WAKE_TOKEN = process.env.WAKE_TOKEN || 'changeme-secret-token';

app.use(cors());
app.use(express.json());

// ---------------------------------------------------------------------------
// In-memory state
// ---------------------------------------------------------------------------
let state = {
  triggered: false,
  triggeredAt: null,
  triggeredBy: null,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function timestamp() {
  return new Date().toISOString();
}

function log(event, extra = '') {
  console.log(`[${timestamp()}] ${event}${extra ? ' | ' + extra : ''}`);
}

function authMiddleware(req, res, next) {
  const token = req.headers['x-wake-token'];
  if (!token || token !== WAKE_TOKEN) {
    log('AUTH_FAIL', `ip=${req.ip} path=${req.path}`);
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// Health check — no auth required (Railway/Render ping this)
app.get('/health', (_req, res) => {
  res.json({ ok: true, ts: timestamp() });
});

// GET /status — receiver polls this
app.get('/status', authMiddleware, (_req, res) => {
  res.json({
    triggered: state.triggered,
    triggeredAt: state.triggeredAt,
    triggeredBy: state.triggeredBy,
  });
});

// POST /trigger — girlfriend's app calls this
app.post('/trigger', authMiddleware, (req, res) => {
  const by = req.body?.triggeredBy || 'unknown';
  state = {
    triggered: true,
    triggeredAt: timestamp(),
    triggeredBy: by,
  };
  log('TRIGGER', `by=${by}`);
  res.json({ ok: true, state });
});

// POST /reset — dismiss button calls this
app.post('/reset', authMiddleware, (req, res) => {
  const by = req.body?.resetBy || 'unknown';
  log('RESET', `by=${by} wasTriggered=${state.triggered} triggeredAt=${state.triggeredAt}`);
  state = {
    triggered: false,
    triggeredAt: null,
    triggeredBy: null,
  };
  res.json({ ok: true, state });
});

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
app.listen(PORT, () => {
  log('SERVER_START', `port=${PORT} token=${WAKE_TOKEN.slice(0, 4)}****`);
  if (WAKE_TOKEN === 'changeme-secret-token') {
    console.warn('[WARN] Using default token — set WAKE_TOKEN env var before deploying!');
  }
});

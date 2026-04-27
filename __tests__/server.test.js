/**
 * Smoke tests for the WakeUp relay backend.
 * Run:  cd backend && npm test
 */

const request = require('supertest');

// Set tokens before requiring the app so the env is already set
process.env.WAKE_TOKENS = 'test-token-A,test-token-B';
const app = require('../server');

describe('GET /health', () => {
  it('returns 200 with ok:true — no auth required', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.ts).toBe('string');
  });
});

describe('Auth middleware', () => {
  it('rejects requests with no token', async () => {
    const res = await request(app).get('/status');
    expect(res.status).toBe(401);
  });

  it('rejects requests with a wrong token', async () => {
    const res = await request(app).get('/status').set('x-wake-token', 'wrong');
    expect(res.status).toBe(401);
  });

  it('accepts requests with any valid token from WAKE_TOKENS', async () => {
    const resA = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(resA.status).toBe(200);
    const resB = await request(app).get('/status').set('x-wake-token', 'test-token-B');
    expect(resB.status).toBe(200);
  });
});

describe('GET /status — initial state', () => {
  it('returns untriggered state', async () => {
    const res = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(false);
    expect(res.body.triggeredBy).toBeNull();
    expect(res.body.message).toBeNull();
    expect(res.body.dismissed).toBe(false);
    expect(res.body.needsAck).toBe(false);
  });
});

describe('POST /trigger', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/trigger').send({ triggeredBy: 'Alice' });
    expect(res.status).toBe(401);
  });

  it('sets triggered state with senderName + message', async () => {
    const res = await request(app)
      .post('/trigger')
      .set('x-wake-token', 'test-token-A')
      .send({ triggeredBy: 'Alice', message: 'WAKE UP NOW' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /status now shows triggered=true with sender info', async () => {
    const res = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(res.body.triggered).toBe(true);
    expect(res.body.triggeredBy).toBe('Alice');
    expect(res.body.message).toBe('WAKE UP NOW');
    expect(res.body.senderToken).toBe('test-token-A');
    expect(res.body.dismissed).toBe(false);
    expect(typeof res.body.triggeredAt).toBe('string');
  });

  it('second sender (token-B) can also read status', async () => {
    const res = await request(app).get('/status').set('x-wake-token', 'test-token-B');
    expect(res.status).toBe(200);
    expect(res.body.triggered).toBe(true);
  });
});

describe('POST /reset (dismiss)', () => {
  it('requires auth', async () => {
    const res = await request(app).post('/reset').send({ resetBy: 'Bob' });
    expect(res.status).toBe(401);
  });

  it('dismisses the alarm and records who dismissed', async () => {
    const res = await request(app)
      .post('/reset')
      .set('x-wake-token', 'test-token-B')
      .send({ resetBy: 'Bob' });
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it('GET /status shows triggered=false, dismissed=true after reset', async () => {
    const res = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(res.body.triggered).toBe(false);
    expect(res.body.dismissed).toBe(true);
    expect(res.body.dismissedBy).toBe('Bob');
    expect(typeof res.body.dismissedAt).toBe('string');
  });
});

describe('Full end-to-end flow', () => {
  it('idle → trigger → ack → idle (re-trigger)', async () => {
    // 1. Confirm idle
    let status = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(status.body.triggered).toBe(false);

    // 2. Trigger
    await request(app)
      .post('/trigger')
      .set('x-wake-token', 'test-token-A')
      .send({ triggeredBy: 'Alice', message: 'hello' });

    status = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(status.body.triggered).toBe(true);
    expect(status.body.dismissed).toBe(false);

    // 3. Dismiss
    await request(app)
      .post('/reset')
      .set('x-wake-token', 'test-token-B')
      .send({ resetBy: 'Bob' });

    status = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(status.body.triggered).toBe(false);
    expect(status.body.dismissed).toBe(true);

    // 4. Trigger again — dismissed state clears
    await request(app)
      .post('/trigger')
      .set('x-wake-token', 'test-token-A')
      .send({ triggeredBy: 'Alice' });

    status = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    expect(status.body.triggered).toBe(true);
    expect(status.body.dismissed).toBe(false);

    // Cleanup
    await request(app).post('/reset').set('x-wake-token', 'test-token-A').send({ resetBy: 'cleanup' });
  });
});

describe('needsAck flag', () => {
  it('is false when just triggered', async () => {
    await request(app)
      .post('/trigger')
      .set('x-wake-token', 'test-token-A')
      .send({ triggeredBy: 'Alice' });

    const res = await request(app).get('/status').set('x-wake-token', 'test-token-A');
    // Should be false since it was just triggered (< 5 min ago)
    expect(res.body.needsAck).toBe(false);

    // Cleanup
    await request(app).post('/reset').set('x-wake-token', 'test-token-A').send({ resetBy: 'cleanup' });
  });
});

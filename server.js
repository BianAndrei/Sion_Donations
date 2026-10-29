import express from 'express';
import Stripe from 'stripe';
import path from 'node:path';
import { appendFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { CURRENCIES, DEFAULT_PURPOSE, PURPOSE_MAX_LENGTH, grossUp } from './donations.config.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

const {
  STRIPE_SECRET_KEY,
  STRIPE_PUBLISHABLE_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_PORTAL_LOGIN_URL = '',
  PORT = 4242,
} = process.env;
const PUBLIC_URL = (process.env.PUBLIC_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Fără chei Stripe aplicația pornește în mod demo: tot fluxul e vizibil, dar nu se încasează nimic.
const DEMO = !STRIPE_SECRET_KEY || !STRIPE_PUBLISHABLE_KEY;
const stripe = DEMO ? null : new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2026-09-30.endive' });

// Etichetă fixă care grupează sesiunile acestui flux în Dashboard-ul Stripe.
const INTEGRATION_ID = 'sion-donatii-kqwhzrtm';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', [
    "default-src 'self'",
    "script-src 'self' https://js.stripe.com https://*.js.stripe.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: https://*.stripe.com",
    "frame-src https://js.stripe.com https://*.js.stripe.com https://hooks.stripe.com https://*.link.com",
    "connect-src 'self' https://api.stripe.com https://*.stripe.com https://*.link.com",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
  ].join('; '));
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── Webhook ──────────────────────────────────────────────────────────────────
// Trebuie înregistrat înainte de express.json(): verificarea semnăturii are nevoie de corpul brut.
const seenEvents = new Set();

app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  if (DEMO || !STRIPE_WEBHOOK_SECRET) return res.status(503).send('Webhook neconfigurat');

  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.warn('Semnătură webhook invalidă:', err.message);
    return res.status(400).send('Semnătură invalidă');
  }

  // Stripe poate retrimite același eveniment; îl procesăm o singură dată.
  if (seenEvents.has(event.id)) return res.json({ received: true });
  seenEvents.add(event.id);

  try {
    await handleEvent(event);
  } catch (err) {
    seenEvents.delete(event.id);
    console.error(`Eroare la procesarea ${event.type}:`, err);
    return res.status(500).send('Eroare');
  }
  res.json({ received: true });
});

async function handleEvent(event) {
  const obj = event.data.object;
  switch (event.type) {
    case 'checkout.session.completed':
    case 'checkout.session.async_payment_succeeded':
      // La metodele cu confirmare întârziată, `completed` sosește cu plata încă neîncasată.
      if (obj.payment_status === 'unpaid') return;
      return recordDonation(event, {
        type: obj.mode === 'subscription' ? 'lunar-prima' : 'unica',
        amount: obj.amount_total,
        currency: obj.currency,
        email: obj.customer_details?.email,
        purpose: obj.metadata?.purpose,
        coverFees: obj.metadata?.cover_fees === 'true',
        session: obj.id,
        subscription: obj.subscription,
      });
    case 'checkout.session.async_payment_failed':
      return log(event, `Plată eșuată pentru sesiunea ${obj.id}`);
    case 'invoice.paid':
      // Prima factură a unei donații lunare e deja înregistrată prin checkout.session.completed.
      if (obj.billing_reason !== 'subscription_cycle') return;
      return recordDonation(event, {
        type: 'lunar-reinnoire',
        amount: obj.amount_paid,
        currency: obj.currency,
        email: obj.customer_email,
        invoice: obj.id,
      });
    case 'invoice.payment_failed':
      return log(event, `Donație lunară eșuată (${obj.customer_email}); Stripe reîncearcă automat`);
    case 'customer.subscription.deleted':
      return log(event, `Donație lunară anulată: ${obj.id}`);
    case 'charge.refunded':
      return log(event, `Rambursare: ${obj.amount_refunded / 100} ${obj.currency.toUpperCase()} (${obj.id})`);
    case 'charge.dispute.created':
      return log(event, `Contestație deschisă pentru ${obj.charge}: răspunde din Dashboard`);
  }
}

// Registrul local e doar o copie de lucru; Dashboard-ul Stripe rămâne sursa oficială.
async function recordDonation(event, donation) {
  const row = { at: new Date(event.created * 1000).toISOString(), event: event.id, ...donation };
  console.log('Donație primită:', row);
  await mkdir(path.join(ROOT, 'data'), { recursive: true });
  await appendFile(path.join(ROOT, 'data', 'donations.jsonl'), JSON.stringify(row) + '\n');
}

function log(event, message) {
  console.log(`[${event.type}] ${message}`);
}

// ── API ──────────────────────────────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));

app.get('/api/config', (req, res) => {
  res.json({
    demo: DEMO,
    publishableKey: DEMO ? null : STRIPE_PUBLISHABLE_KEY,
    portalUrl: STRIPE_PORTAL_LOGIN_URL || null,
  });
});

// Formularele de donații sunt ținta preferată a celor care testează carduri furate,
// așa că limităm câte sesiuni poate crea un IP.
const attempts = new Map();
function rateLimited(ip, limit = 10, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const recent = (attempts.get(ip) || []).filter((t) => now - t < windowMs);
  recent.push(now);
  attempts.set(ip, recent);
  return recent.length > limit;
}
setInterval(() => {
  const cutoff = Date.now() - 10 * 60 * 1000;
  for (const [ip, times] of attempts) if (times.every((t) => t < cutoff)) attempts.delete(ip);
}, 60 * 1000).unref();

app.post('/api/checkout', async (req, res) => {
  if (DEMO) return res.status(503).json({ error: 'Aplicația rulează în mod demo.' });
  if (rateLimited(req.ip)) {
    return res.status(429).json({ error: 'Prea multe încercări. Te rugăm să revii în câteva minute.' });
  }

  const { amount, currency, frequency, purpose, coverFees } = req.body ?? {};
  const cur = CURRENCIES[currency];
  const monthly = frequency === 'monthly';
  const value = Number(amount);
  // Text liber de la donator: eliminăm caracterele de control și limităm lungimea.
  const reason = typeof purpose === 'string'
    ? purpose.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, PURPOSE_MAX_LENGTH)
    : '';
  const label = reason || DEFAULT_PURPOSE;

  if (!cur || !['once', 'monthly'].includes(frequency)) {
    return res.status(400).json({ error: 'Date invalide.' });
  }
  if (!Number.isFinite(value) || value < cur.min || value > cur.max) {
    return res.status(400).json({ error: `Suma trebuie să fie între ${cur.min} și ${cur.max} ${cur.code}.` });
  }

  const baseMinor = Math.round(value * 100);
  const totalMinor = coverFees === true ? grossUp(baseMinor, currency) : baseMinor;
  const name = `${monthly ? 'Donație lunară' : 'Donație'}: ${label}`;
  const metadata = { purpose: label, cover_fees: String(coverFees === true), base_amount: String(baseMinor) };

  try {
    const session = await stripe.checkout.sessions.create({
      ui_mode: 'elements',
      mode: monthly ? 'subscription' : 'payment',
      line_items: [{
        quantity: 1,
        price_data: {
          currency,
          unit_amount: totalMinor,
          product_data: { name },
          ...(monthly && { recurring: { interval: 'month' } }),
        },
      }],
      return_url: `${PUBLIC_URL}/multumim?session_id={CHECKOUT_SESSION_ID}`,
      metadata,
      ...(monthly
        ? { subscription_data: { description: name, metadata } }
        : { payment_intent_data: { description: name, metadata } }),
      integration_identifier: INTEGRATION_ID,
    });
    res.json({ clientSecret: session.client_secret });
  } catch (err) {
    console.error('Eroare la crearea sesiunii Stripe:', err.message);
    res.status(500).json({ error: 'Nu am putut porni plata. Încearcă din nou.' });
  }
});

app.get('/api/session-status', async (req, res) => {
  if (DEMO) return res.status(503).json({ error: 'Mod demo' });
  const id = String(req.query.session_id || '');
  if (!/^cs_(test|live)_[A-Za-z0-9]+$/.test(id)) return res.status(400).json({ error: 'ID invalid' });

  try {
    const s = await stripe.checkout.sessions.retrieve(id);
    res.json({
      status: s.status,
      paymentStatus: s.payment_status,
      amount: s.amount_total,
      currency: s.currency,
      monthly: s.mode === 'subscription',
      email: s.customer_details?.email ?? null,
    });
  } catch {
    res.status(404).json({ error: 'Sesiune negăsită' });
  }
});

// ── Fișiere statice ──────────────────────────────────────────────────────────
app.get('/donations.config.js', (req, res) => res.sendFile(path.join(ROOT, 'donations.config.js')));
app.use(express.static(path.join(ROOT, 'public'), { extensions: ['html'] }));

app.listen(PORT, () => {
  console.log(`Donații Sion rulează pe ${PUBLIC_URL}${DEMO ? '  (MOD DEMO: lipsesc cheile Stripe)' : ''}`);
});

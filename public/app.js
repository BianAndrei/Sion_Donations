import { CURRENCIES, DEFAULT_PURPOSE, grossUp } from '/donations.config.js';

const $ = (id) => document.getElementById(id);

const state = {
  frequency: 'once',
  currency: 'ron',
  preset: CURRENCIES.ron.defaultAmount,
  custom: '',
  purpose: '',
  coverFees: false,
};

let config = { demo: true };
let stripe = null;
let checkout = null;
let actions = null;
let mounted = [];

const FONT_CSS = 'https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&display=swap';
const appearance = {
  theme: 'stripe',
  variables: {
    colorPrimary: '#0B0B0C',
    colorText: '#0B0B0C',
    colorTextSecondary: '#6E6E75',
    colorDanger: '#A1000A',
    fontFamily: '"Inter Tight", "Helvetica Neue", Helvetica, Arial, sans-serif',
    fontSizeBase: '16px',
    borderRadius: '14px',
  },
  rules: {
    '.Input': { border: '1.5px solid #E6E5E3', boxShadow: 'none', padding: '15px 16px' },
    '.Input:focus': { borderColor: '#0B0B0C', boxShadow: '0 0 0 4px rgba(11,11,12,.06)' },
    '.Label': { fontWeight: '600', fontSize: '13px' },
    '.Tab': { border: '1.5px solid #E6E5E3', boxShadow: 'none' },
    '.Tab--selected': { borderColor: '#0B0B0C', boxShadow: 'none' },
  },
};

// ── Sume ─────────────────────────────────────────────────────────────────────
function money(minor, currency) {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'code',
    minimumFractionDigits: minor % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function parseCustom(text) {
  const clean = text.replace(/\s/g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return NaN;
  return Number(clean);
}

// Suma de bază în subunități, sau un mesaj de eroare dacă suma introdusă nu e validă.
function baseAmount() {
  const cur = CURRENCIES[state.currency];
  if (!state.custom) return { minor: state.preset * 100 };
  const value = parseCustom(state.custom);
  if (Number.isNaN(value)) return { error: 'Introdu o sumă validă, de exemplu 150.' };
  if (value < cur.min) return { error: `Suma minimă este ${cur.min} ${cur.code}.` };
  if (value > cur.max) return { error: `Suma maximă este ${cur.max.toLocaleString('ro-RO')} ${cur.code}.` };
  return { minor: Math.round(value * 100) };
}

function totalMinor(base) {
  return state.coverFees ? grossUp(base, state.currency) : base;
}

// ── Pasul 1 ──────────────────────────────────────────────────────────────────
function renderStatic() {
  $('currency-group').innerHTML = Object.entries(CURRENCIES)
    .map(([key, c]) => `<button type="button" role="radio" data-currency="${key}">${c.code}</button>`)
    .join('');
}

function renderPresets() {
  const cur = CURRENCIES[state.currency];
  $('presets').innerHTML = cur.presets
    .map((v) => `<button type="button" role="radio" data-preset="${v}"><span class="num">${v}</span><span class="cur">${cur.code}</span></button>`)
    .join('');
}

function render() {
  const cur = CURRENCIES[state.currency];

  for (const b of document.querySelectorAll('[data-currency]')) b.setAttribute('aria-checked', b.dataset.currency === state.currency);
  for (const b of document.querySelectorAll('[data-preset]')) {
    b.setAttribute('aria-checked', !state.custom && Number(b.dataset.preset) === state.preset);
  }
  $('custom-suffix').textContent = cur.code;
  $('custom-amount').closest('.custom-amount').classList.toggle('active', Boolean(state.custom));

  const base = baseAmount();
  $('amount-hint').textContent = base.error ?? '';
  const ok = !base.error;
  const monthly = state.frequency === 'monthly';

  $('fee-amount').textContent = ok ? `(+${money(grossUp(base.minor, state.currency) - base.minor, state.currency)})` : '';
  $('total-amount').textContent = ok ? money(totalMinor(base.minor), state.currency) : '–';
  $('total-period').hidden = !monthly;
  $('continue-btn').disabled = !ok;
}

function bindDonateForm() {
  $('currency-group').addEventListener('click', (e) => {
    const b = e.target.closest('[data-currency]');
    if (!b || b.dataset.currency === state.currency) return;
    state.currency = b.dataset.currency;
    state.preset = CURRENCIES[state.currency].defaultAmount;
    renderPresets();
    render();
  });
  $('presets').addEventListener('click', (e) => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    state.preset = Number(b.dataset.preset);
    state.custom = '';
    $('custom-amount').value = '';
    render();
  });
  $('custom-amount').addEventListener('input', (e) => {
    state.custom = e.target.value.trim();
    render();
  });
  $('purpose').addEventListener('input', (e) => { state.purpose = e.target.value.trim(); });
  $('cover-fees').addEventListener('change', (e) => { state.coverFees = e.target.checked; render(); });

  $('donate-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const base = baseAmount();
    if (base.error) return;
    hideError('donate-error');

    if (config.demo) {
      showPayView(base.minor);
      renderDemoPayment();
      return;
    }

    const btn = $('continue-btn');
    btn.classList.add('loading');
    try {
      const clientSecret = await createSession(base.minor);
      showPayView(base.minor);
      await mountCheckout(clientSecret);
    } catch (err) {
      showError('donate-error', err.message);
    } finally {
      btn.classList.remove('loading');
    }
  });
}

// ── Pasul 2 ──────────────────────────────────────────────────────────────────
function showPayView(base) {
  const monthly = state.frequency === 'monthly';
  $('sum-purpose').textContent = state.purpose || DEFAULT_PURPOSE;
  $('sum-freq').textContent = monthly ? 'Lunar, se reînnoiește automat' : 'O singură dată';
  setPayAmount(money(totalMinor(base), state.currency));
  $('monthly-note').hidden = !monthly;
  $('pay-btn').disabled = true;
  hideError('pay-error');

  $('view-donate').hidden = true;
  $('view-pay').hidden = false;
  if (history.state?.step !== 'pay') history.pushState({ step: 'pay' }, '', '#plata');
  window.scrollTo(0, 0);
}

function showDonateView() {
  teardownCheckout();
  $('view-pay').hidden = true;
  $('view-donate').hidden = false;
  window.scrollTo(0, 0);
}

function setPayAmount(formatted) {
  const period = state.frequency === 'monthly' ? '/lună' : '';
  $('sum-amount').textContent = formatted + period;
  $('pay-label').textContent = `Donează ${formatted}${period}`;
}

async function createSession(base) {
  const res = await fetch('/api/checkout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      amount: base / 100,
      currency: state.currency,
      frequency: state.frequency,
      purpose: state.purpose || DEFAULT_PURPOSE,
      coverFees: state.coverFees,
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Nu am putut porni plata. Încearcă din nou.');
  return data.clientSecret;
}

async function mountCheckout(clientSecret) {
  stripe ??= Stripe(config.publishableKey, { locale: 'ro' });
  checkout = stripe.initCheckoutElementsSdk({
    clientSecret,
    elementsOptions: { appearance, fonts: [{ cssSrc: FONT_CSS }] },
  });

  const express = checkout.createExpressCheckoutElement({
    buttonType: { applePay: 'donate', googlePay: 'donate' },
    buttonTheme: { applePay: 'white-outline', googlePay: 'white' },
    buttonHeight: 52,
    layout: { maxColumns: 2 },
  });
  express.mount('#express-checkout');
  express.on('availablepaymentmethodschange', ({ paymentMethods }) => {
    // Dacă dispozitivul nu are niciun portofel, ascundem secțiunea „Plătește rapid”.
    const none = !paymentMethods;
    $('express-checkout').closest('.field').hidden = none;
    document.querySelector('#pay-form .divider').hidden = none;
  });

  // Apple Pay și Google Pay apar deja sus, nu le mai dublăm în formularul de card.
  let payment;
  try {
    payment = checkout.createPaymentElement({ layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } });
  } catch {
    payment = checkout.createPaymentElement();
  }
  payment.mount('#payment-element');
  mounted = [express, payment];

  // Stripe cere ca totalul afișat să vină din sesiune, ca să rămână sincronizat.
  checkout.on('change', renderSession);

  const result = await checkout.loadActions();
  if (result.type === 'error') {
    showError('pay-error', result.error.message);
    return;
  }
  actions = result.actions;
  renderSession(actions.getSession());

  express.on('confirm', async (event) => {
    const res = await actions.confirm({ expressCheckoutConfirmEvent: event });
    if (res.type === 'error') showError('pay-error', res.error.message);
  });
  $('pay-btn').disabled = false;
}

function renderSession(session) {
  if (session?.total?.total?.amount) setPayAmount(session.total.total.amount);
}

function teardownCheckout() {
  for (const el of mounted) {
    try { el.destroy(); } catch { /* deja demontat */ }
  }
  mounted = [];
  checkout = null;
  actions = null;
  $('express-checkout').innerHTML = '';
  $('payment-element').innerHTML = '';
  $('express-checkout').closest('.field').hidden = false;
  document.querySelector('#pay-form .divider').hidden = false;
}

function bindPayForm() {
  $('back-btn').addEventListener('click', () => history.back());
  window.addEventListener('popstate', () => {
    if (!$('view-pay').hidden) showDonateView();
  });

  $('pay-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    hideError('pay-error');
    const email = $('email').value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError('pay-error', 'Introdu o adresă de email validă pentru chitanță.');
      $('email').focus();
      return;
    }

    if (config.demo) {
      const base = baseAmount().minor;
      const q = new URLSearchParams({
        demo: '1',
        amount: totalMinor(base),
        currency: state.currency,
        monthly: state.frequency === 'monthly' ? '1' : '0',
      });
      location.href = `/multumim?${q}`;
      return;
    }

    if (!actions) return;
    const btn = $('pay-btn');
    btn.classList.add('loading');
    const res = await actions.confirm({ email });
    // La succes Stripe redirecționează spre pagina de mulțumire; aici ajungem doar la erori.
    btn.classList.remove('loading');
    if (res.type === 'error') showError('pay-error', res.error.message);
  });
}

// Modul demo arată cum va arăta pasul de plată, fără să colecteze date reale.
function renderDemoPayment() {
  $('express-checkout').innerHTML = `
    <div class="mock-wallets">
      <button type="button" class="mock-wallet" tabindex="-1">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12.15 6.9c-.95 0-2.42-1.08-3.96-1.04-2.04.03-3.91 1.18-4.96 3.01-2.12 3.68-.55 9.1 1.52 12.09 1.01 1.45 2.2 3.09 3.79 3.04 1.52-.07 2.09-.99 3.93-.99 1.83 0 2.35.99 3.96.95 1.64-.03 2.68-1.48 3.68-2.95 1.15-1.69 1.63-3.32 1.66-3.41-.04-.02-3.18-1.22-3.22-4.86-.03-3.04 2.48-4.5 2.6-4.56-1.43-2.09-3.63-2.33-4.4-2.38-2-.15-3.67 1.09-4.6 1.09ZM15.53 3.83c.84-1.01 1.4-2.43 1.25-3.83-1.21.05-2.67.8-3.54 1.82-.78.9-1.45 2.34-1.27 3.71 1.34.1 2.71-.69 3.56-1.7Z"/></svg>
        Apple Pay
      </button>
      <button type="button" class="mock-wallet" tabindex="-1">
        <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 8 3l5.7-5.6C34 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.7-.4-3.9Z"/><path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 8 3l5.7-5.6C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7Z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44Z"/><path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.7-.4-3.9Z"/></svg>
        Google Pay
      </button>
    </div>`;
  $('payment-element').innerHTML = `
    <div class="mock-card" aria-label="Exemplu de formular de card (demo)">
      <div><span>4242 4242 4242 4242</span><small>VISA</small></div>
      <div class="row"><span>12 / 34</span><span>123</span></div>
    </div>`;
  $('pay-btn').disabled = false;
}

// ── Utilitare ────────────────────────────────────────────────────────────────
function showError(id, message) {
  $(id).textContent = message;
  $(id).hidden = false;
}
function hideError(id) {
  $(id).hidden = true;
}

async function init() {
  renderStatic();
  renderPresets();
  render();
  bindDonateForm();
  bindPayForm();
  if (location.hash === '#plata') history.replaceState(null, '', location.pathname);

  // ?preview arată fluxul simulat fără banner; îl folosește scriptul care face afișul.
  const preview = new URLSearchParams(location.search).has('preview');
  try {
    if (!preview) config = await fetch('/api/config').then((r) => r.json());
  } catch { /* rămânem în demo */ }
  $('demo-banner').hidden = !config.demo || preview;
  if (config.portalUrl) {
    $('portal-link').href = config.portalUrl;
    $('portal-link').hidden = false;
  }
}

init();

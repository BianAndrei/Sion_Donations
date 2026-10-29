const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

function money(minor, currency) {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: currency.toUpperCase(),
    currencyDisplay: 'code',
    minimumFractionDigits: minor % 100 ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(minor / 100);
}

function showSuccess({ amount, currency, monthly, email }) {
  $('amount').textContent = money(amount, currency) + (monthly ? ' / lună' : '');
  $('message').textContent = monthly
    ? 'Donația ta lunară a fost activată. Îți mulțumim că ești parte din lucrarea Sion!'
    : 'Darul tău a ajuns cu bine. Îți mulțumim că ești parte din lucrarea Sion!';
  if (email) $('message').textContent += ` Chitanța a fost trimisă la ${email}.`;
}

function showPending(text) {
  $('thanks').classList.add('pending');
  $('badge').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-3 0v-4A1.5 1.5 0 0 1 12 7Zm0 8.5a1.5 1.5 0 1 1 0 3 1.5 1.5 0 0 1 0-3Z"/></svg>';
  $('title').textContent = 'Plata nu s-a finalizat';
  $('message').textContent = text;
  $('again').textContent = 'Încearcă din nou';
}

async function init() {
  if (params.get('demo') === '1') {
    showSuccess({
      amount: Number(params.get('amount')) || 10000,
      currency: params.get('currency') || 'ron',
      monthly: params.get('monthly') === '1',
    });
    return;
  }

  const id = params.get('session_id');
  if (!id) return showPending('Nu am găsit nicio plată de verificat.');

  try {
    const res = await fetch(`/api/session-status?session_id=${encodeURIComponent(id)}`);
    if (!res.ok) throw new Error();
    const s = await res.json();
    if (s.status === 'complete') {
      showSuccess(s);
      if (s.paymentStatus === 'unpaid') {
        $('message').textContent = 'Plata este în curs de procesare. Vei primi confirmarea pe email.';
      }
    } else {
      showPending('Plata a fost anulată sau refuzată. Nu ți-a fost retrasă nicio sumă.');
    }
  } catch {
    showPending('Nu am putut verifica plata. Verifică emailul pentru confirmare.');
  }
}

init();

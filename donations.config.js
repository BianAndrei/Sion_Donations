// Setările donațiilor. Serverul le folosește pentru validare și calcul,
// iar aplicația le primește prin /api/config, deci totul se schimbă dintr-un singur loc.

export const CURRENCIES = {
  ron: { code: 'RON', presets: [25, 50, 100, 250], defaultAmount: 100, min: 5, max: 50000 },
  eur: { code: 'EUR', presets: [10, 20, 50, 100], defaultAmount: 20, min: 2, max: 10000 },
  usd: { code: 'USD', presets: [10, 20, 50, 100], defaultAmount: 20, min: 2, max: 10000 },
};

// Folosit când donatorul nu completează pentru ce dăruiește.
export const DEFAULT_PURPOSE = 'Susținerea bisericii';
export const PURPOSE_MAX_LENGTH = 100;

// Estimare pentru opțiunea „acopăr taxele de procesare”.
// Tarif Stripe pentru carduri din SEE: ~1,5–1,9% + 1 RON. Plățile în EUR/USD includ
// ~2% conversie valutară dacă încasezi în RON. Verifică tarifele contului tău:
// https://stripe.com/ro/pricing
export const FEES = {
  ron: { percent: 1.9, fixed: 1.0 },
  eur: { percent: 3.9, fixed: 0.2 },
  usd: { percent: 3.9, fixed: 0.22 },
};

// Suma în subunități (bani/cenți) astfel încât, după taxe, biserica primește `amountMinor`.
export function grossUp(amountMinor, currency) {
  const { percent, fixed } = FEES[currency];
  return Math.ceil((amountMinor + fixed * 100) / (1 - percent / 100));
}

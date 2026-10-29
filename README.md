# Donații Sion

Aplicație mobilă de donații pentru Centrul Creștin Sion Blaj, cu plăți Stripe (Apple Pay, Google Pay, card), plus afișul cu cod QR pentru finalul serviciului.

```
server.js                 Server Node: creează sesiunile Stripe, primește webhook-urile
donations.config.js       Sume, monede, motive, estimarea taxelor (comun server + aplicație)
public/                   Aplicația (index.html = donație, multumim.html = confirmare)
poster/                   Afișul animat (index.html) + PNG/PDF generate
scripts/build-poster.mjs  Regenerează QR-ul, capturile și afișul
```

## Pornire locală

```bash
npm install
npm start            # http://localhost:4242
```

Fără chei Stripe, aplicația rulează în **mod demo**: tot fluxul se vede, dar nu se încasează nimic.

## Conectare la Stripe

1. Creează un sandbox Stripe pentru dezvoltare (Dashboard → Sandboxes).
2. Copiază `.env.example` în `.env` și completează:
   - `STRIPE_PUBLISHABLE_KEY` (`pk_test_...`)
   - `STRIPE_SECRET_KEY`: folosește o **cheie restricționată** (`rk_test_...`) cu drept de scriere pe *Checkout Sessions*. Dacă apare o eroare 403, adaugă permisiunea care lipsește.
3. Webhook (obligatoriu înainte de lansare):
   - local: `stripe listen --forward-to localhost:4242/api/webhook` și pune `whsec_...` în `STRIPE_WEBHOOK_SECRET`
   - producție: Dashboard → Developers → Webhooks → `https://DOMENIUL-TAU/api/webhook`, cu evenimentele
     `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`,
     `invoice.paid`, `invoice.payment_failed`, `customer.subscription.deleted`, `charge.refunded`, `charge.dispute.created`
4. Card de test: `4242 4242 4242 4242`, orice dată viitoare, orice CVC.

### Apple Pay și Google Pay
- Merg doar pe **HTTPS** și pe un domeniu înregistrat: Dashboard → Settings → Payment method domains → adaugă domeniul (în sandbox și în live).
- Activează metodele în Dashboard → Settings → Payment methods. Codul nu restricționează metodele, deci Stripe le afișează automat pe cele potrivite.

### Recomandat în Dashboard
- **Chitanțe pe email**: Settings → Customer emails → „Successful payments”. Pagina de mulțumire spune că chitanța a fost trimisă.
- **Donații lunare**: activează Customer portal (Settings → Billing) și pune linkul de login în `STRIPE_PORTAL_LOGIN_URL`, ca donatorii să-și poată anula singuri donația. Activează și Smart Retries pentru plățile lunare eșuate.
- **Radar**: formularele de donații sunt ținte pentru testarea cardurilor furate. Serverul limitează deja sesiunile per IP; adaugă și o regulă Radar care blochează plățile cu risc ridicat.

## Afișul

```bash
npm start                                          # aplicația trebuie să ruleze
npm run poster -- --url https://DOMENIUL-TAU       # QR-ul duce la adresa asta
```

Generează:
- `poster/index.html`: versiunea animată (telefonul derulează aplicația). Deschide-o în browser pe tot ecranul.
- `poster/sion-donatii-afis.png`: imagine 3840×2160 pentru proiector sau slide-uri.
- `poster/sion-donatii-afis.pdf`: pentru print.

Fără `--url`, QR-ul duce la adresa din rețeaua locală, ca să testezi cu telefonul în același Wi-Fi.

## Lansare

Orice gazdă Node 22+ (Render, Railway, VPS). Setează variabilele din `.env.example` în panoul de *secrets* al platformei, nu în cod, cu `PUBLIC_URL` = domeniul public. Comanda de start: `npm start`.

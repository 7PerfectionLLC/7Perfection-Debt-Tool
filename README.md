## FIXED2
Bouton Ajoute yon kliyan korije pou pa depann de non global navigatè a.

# 7Perfection Debt Tool — FINAL BUILD

**Biznis:** 7Perfection Multiservices LLC  
**Responsab:** Lovely Pierre  
**Lang:** Kreyòl Ayisyen

## Sa vèsyon final build la gen
- Login Lovely Pierre ak PIN hash (bcrypt).
- Sesyon HTTP-only cookie.
- Rate limiting.
- Helmet security headers.
- SQLite database ki rete nan `data/7perfection.db`.
- Kliyan, dèt, peman, istorik, achiv.
- Dèt ki fini sèlman ka efase.
- Chanje PIN.
- Koòdone senp pou telefòn.
- Docker + docker-compose pou deplwaman.
- Logo biznis la.

## ENPÒTAN
Fichye sa a se **build final pou deplwaman**, li poko mete sou yon sèvè entènèt. Pou mete li sou entènèt, bezwen yon hosting/server epi HTTPS.

### Premye demaraj ak Docker
1. Enstale Docker.
2. Kopi `.env.example` kòm `.env`.
3. Chanje `JWT_SECRET` pou yon sekrè long, o aza.
4. Ou ka kite `ADMIN_PIN=2580` pou premye koneksyon, men chanje PIN lan imedyatman nan Paramèt.
5. Kouri:
   `docker compose up -d --build`
6. Louvri:
   `http://SERVER-IP:3000`

### Pwodiksyon reyèl
Mete aplikasyon an dèyè yon reverse proxy ki bay HTTPS (eg. Caddy/Nginx/Cloudflare), fè backup regilye dosye `data/`, limite aksè administrasyon sèvè a, epi pa pataje `.env`.

## Pwochen operasyonèl
Pou yon sèvis reyèl, nou bezwen chwazi hosting la epi fè deplwaman HTTPS. Mwen pa make sa kòm fini paske li mande yon kont/serveur ekstèn.

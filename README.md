# Ultimo Faro

Tower defense in italiano per un gruppo ristretto di amici. Si gioca dal browser: **https://3lim1nator09tsu-eng.github.io/ultimo-faro/**

## Cosa c'è

- Campagna in tre livelli con dialoghi, modalità Infinita.
- Sopravvivenza: Easy (20 ondate), Medium (25), Molten (30), Fallen (35), Frost (40), ognuna con il suo boss.
- Hardcore: 50 ondate con modificatori, 10 vite, il Leviatano; dà le Perle Nere per le torri Hardcore.
- Evento di Natale: cinque Notti, con il Disgelo che le ammorbidisce settimana per settimana a dicembre.
- 12 torri con rami, ranghi permanenti e torri Apex; combo tra torri.
- Account con nome utente e password (serve un codice d'invito), salvataggio online, classifica.
- Multigiocatore fino a 4 giocatori con codice stanza; l'admin può intervenire nelle stanze degli altri.

## Struttura

- `src/sim-core/` — simulazione deterministica a interi (10 tick al secondo): stessa partita su ogni dispositivo.
- `src/game-client/` — disegno su canvas, interfaccia, rete (`net.ts`), multigiocatore in lockstep (`netplay.ts`).
- `tests/` — test della simulazione e collaudi nel browser.
- `tools/` — build in un solo file HTML e laboratori di bilanciamento con i bot.
- `docs/index.html` — la build pubblicata su GitHub Pages.

## Sviluppo

```
npm install
npm run build     # crea docs/index.html
npm test          # test della simulazione
npm run balance   # bot sulle modalità
```

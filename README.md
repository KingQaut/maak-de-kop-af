# Maak de kop af

Klassenspel voor Nederlands A1/A2. De docent toont een krantenkop met één woord weg;
studenten typen op hun telefoon welk woord er mist. Daarna verschijnen alle antwoorden
naast het echte woord.

## Starten

Nodig: Node.js 18 of nieuwer. Er zijn geen andere installaties nodig.

```bash
node server.js
```

- Docent: `http://localhost:3000/docent`
- Studenten: scannen de QR-code op het docentscherm (of openen de site en typen de code)

## Online zetten

Studenten moeten de site op hun telefoon kunnen bereiken. Zet de map daarom op een
hostingdienst die Node.js draait (bijvoorbeeld Render, Railway of Fly.io):
startcommando `node server.js`, de poort komt uit de variabele `PORT`.
Alleen de docent heeft daar een account nodig; studenten niet.

## Goed om te weten

- Kamers staan alleen in het geheugen van de server. Na een herstart van de server
  begint de docent een nieuwe kamer; de voorbereide koppen blijven bewaard in de
  browser van de docent.
- De QR-code gebruikt het adres waarop de docent de pagina zelf heeft geopend.
- `public/qrcode.js` is de bibliotheek qrcode-generator van Kazuhiko Arase (MIT-licentie).

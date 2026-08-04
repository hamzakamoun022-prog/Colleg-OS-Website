# Linn Salong — webbplats

En färdig, enkelsidig webbplats för frisörsalongen Linn Salong. Allt ligger i
en enda fil (`index.html`) — ingen installation, inga byggverktyg, inga
beroenden. Öppna filen i en webbläsare så ser du sidan direkt.

## Innehåll

| Fil | Vad det är |
| --- | --- |
| `index.html` | Hela webbplatsen: text, design och funktioner. |
| `bilder/` | Lägg dina foton här (mappen skapas när du lägger till den första bilden). |

## Vad som behöver fyllas i

Sidan är komplett men innehåller **platshållare** där dina riktiga uppgifter
ska in. Öppna `index.html` i valfri textredigerare och sök efter texten inom
hakparentes:

| Sök efter | Vad du ändrar |
| --- | --- |
| `[BOKA]` | **Bokadirekt-länken.** Finns på 4 ställen. Byt `https://www.bokadirekt.se/` mot adressen till din egen sida, t.ex. `https://www.bokadirekt.se/places/linn-salong-12345`. |
| `[ADRESS]` | Gatuadress och ort (3 ställen). |
| `[TELEFON]` | Telefonnummer. Ändra **både** den synliga texten och `tel:`-länken. `tel:`-numret skrivs utan mellanslag och med landsnummer: `tel:+46101234567`. |
| `[EPOST]` | E-postadress. Ändra både texten och `mailto:`-länken. |
| `[TIDER]` | Öppettider (2 ställen: bandet under toppen och kontaktsektionen). |
| `[PRIS]` | Prislistan. Ändra siffrorna fritt. |
| `[SOCIALT]` | Länkar till Instagram och Facebook. |
| `[OMDÖME]` | Kundomdömen — byt mot riktiga citat från Bokadirekt eller Google. |
| `[BILD]` | Bildrutorna, se nedan. |
| `[KARTA]` | Google Maps-kartan, se nedan. |

Priserna i filen är rimliga riktpriser för en svensk frisörsalong, men de är
**gissningar** — gå igenom dem innan sidan publiceras.

### Lägga till en rad i prislistan

Kopiera ett block och ändra texten:

```html
<div class="price-row">
  <div class="name">Namn på behandlingen <small>eventuell förklaring</small></div>
  <div class="dots"></div><div class="amt">650 kr</div>
</div>
```

## Lägga in egna bilder

Varje bildruta ser i dag ut så här:

```html
<div class="photo hero-photo">
  <div class="photo-label"> ... </div>
</div>
```

1. Skapa en mapp som heter `bilder` bredvid `index.html`.
2. Lägg dina foton där, t.ex. `bilder/salongen.jpg`.
3. Byt ut hela `<div class="photo-label">…</div>` mot en bildtagg:

```html
<div class="photo hero-photo">
  <img src="bilder/salongen.jpg" alt="Interiören i Linn Salong">
</div>
```

Behåll `class="photo …"` på den yttre rutan — den sköter formen och de rundade
hörnen. Bilden beskärs automatiskt så att den fyller rutan.

**Tips:** spara bilderna i högst ca 1600 px bredd och som `.jpg` — då laddar
sidan snabbt även på mobil. Skriv alltid något beskrivande i `alt`-texten, det
används av skärmläsare och av Google.

## Lägga in kartan

1. Gå till [google.com/maps](https://www.google.com/maps), sök upp salongens adress.
2. Klicka **Dela** → **Bädda in en karta** → **Kopiera HTML**.
3. Ersätt `<div class="photo-label">…</div>` inuti `<div class="photo map …">`
   med den kopierade `<iframe>`-koden.

## Publicera sidan

### Alternativ 1 — GitHub Pages (gratis)

1. Skapa ett nytt, tomt repo på GitHub, t.ex. `linn-salong-website`.
2. Ladda upp `index.html` (och `bilder/`) till repots rot.
3. Gå till **Settings → Pages**, välj branch `main` och mappen `/ (root)`.
4. Sidan ligger efter någon minut på `https://<användarnamn>.github.io/linn-salong-website/`.
5. Vill du ha en egen domän (t.ex. `linnsalong.se`): lägg en fil som heter
   `CNAME` i repot med domännamnet som enda innehåll, och peka domänens
   DNS mot GitHub Pages hos den du köpt domänen av.

### Alternativ 2 — dra och släpp

Tjänster som Netlify Drop eller Cloudflare Pages låter dig dra in mappen i
webbläsaren och få en färdig adress direkt, utan konto-krångel.

## Bra att veta

- Sidan fungerar på mobil, surfplatta och dator.
- Menyn blir en hamburgermeny under 960 px bredd.
- Typsnitten (Cormorant Garamond + Jost) hämtas från Google Fonts, vilket
  kräver internet. Utan internet visas sidan med systemtypsnitt i stället —
  layouten går inte sönder.
- Färgerna ligger samlade högst upp i `<style>` under `:root`. Vill du byta
  färgtema räcker det att ändra där.

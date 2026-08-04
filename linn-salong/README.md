# Linn Salong — webbplats

Webbplats för Linn Salong, frisör- och nagelsalong på Västra Storgatan 13 i
Säffle. Allt ligger i en enda fil (`index.html`) — ingen installation, inga
byggverktyg, inga beroenden. Öppna filen i en webbläsare så ser du sidan
direkt.

## Uppgifter på sidan

Följande är hämtat från salongens offentliga uppgifter (Google, Facebook) i
augusti 2026 och ligger redan inne:

| | |
| --- | --- |
| Adress | Västra Storgatan 13, 661 30 Säffle |
| Telefon / SMS | 070-057 48 52 |
| Facebook | [facebook.com/linnsalong](https://www.facebook.com/linnsalong/) |
| TikTok | [@linnsalong](https://www.tiktok.com/@linnsalong) |
| Öppettider | Dagtid 10.00–18.00 · kväll tis–fre 20.00–23.00 · lör 20.00–02.00 |
| Tjänster | Klippning, färg, slingor, permanent, flätor, skägg, bryn, ansiktsmask, naglar |

**Kontrollera öppettiderna.** De kommer från Facebook-sidan och kan vara
inaktuella. De står på tre ställen i `index.html`, alla märkta `[TIDER]`.

## Vad som återstår att fylla i

Sök (Ctrl+F / Cmd+F) i `index.html` efter texten inom hakparentes:

| Sök efter | Vad du ändrar |
| --- | --- |
| `[PRIS]` | **Alla priser står som "Ring för pris".** Inga priser gick att hitta, och gissade priser på en riktig salong är sämre än inga. Se nedan för hur du skriver in dem. |
| `[BILD]` | **Bildrutorna väntar på foton.** Sju stycken: en i toppen, en vid "Om oss" och fem i galleriet. Se nedan. |
| `[TIDER]` | Öppettiderna, om de inte stämmer (3 ställen). |
| `[EPOST]` | Ingen e-postadress hittad. Vill du ha med en finns färdig kod i en kommentar i kontaktavsnittet — ta bort kommentarstecknen. |
| `[BOKA]` | Bokningsknapparna ringer eller SMS:ar i dag, eftersom salongen inte har någon Bokadirekt-sida. Skaffar ni en: byt `href="tel:+46700574852"` mot Bokadirekt-adressen på de fyra märkta ställena. |
| `[OMDÖME]` | Inga verifierade kundomdömen. Har ni riktiga citat ni får använda finns färdig kod i en kommentar efter galleriet. |
| `[SOCIALT]` | Facebook och TikTok ligger inne. Finns Instagram eller Snapchat kan de läggas till på samma sätt. |

### Skriva in priser

Varje rad ser ut så här:

```html
<div class="price-row">
  <div class="name">Klippning dam <small>inkl. tvätt och fön</small></div>
  <div class="dots"></div><div class="amt ask">Ring för pris</div>
</div>
```

Byt sista raden mot priset och **ta bort `ask`**:

```html
  <div class="dots"></div><div class="amt">650 kr</div>
```

`ask` gör texten liten och grå, vilket bara passar "Ring för pris". Kopiera
hela `<div class="price-row">…</div>` för att lägga till en rad.

### Lägga in egna bilder

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
sidan snabbt även på mobil. Skriv alltid något beskrivande i `alt`-texten; den
används av skärmläsare och av Google.

Bilderna från Google-listningen går inte att ladda ner automatiskt — de kräver
API-nyckel och får inte länkas direkt. Ta dem i stället från salongens egen
telefon, Facebook eller TikTok.

## Kartan

Kartan är redan inlagd och pekar på Västra Storgatan 13. Vill du byta den mot
den officiella Google-inbäddningen: gå till [google.com/maps](https://www.google.com/maps),
sök upp adressen, klicka **Dela → Bädda in en karta → Kopiera HTML** och
ersätt `<iframe>`-taggen i kontaktavsnittet.

## Publicera sidan

### Alternativ 1 — GitHub Pages (gratis)

1. Skapa ett nytt, tomt repo på GitHub, t.ex. `linn-salong-website`.
2. Ladda upp `index.html` (och `bilder/`) till repots rot.
3. Gå till **Settings → Pages**, välj branch `main` och mappen `/ (root)`.
4. Sidan ligger efter någon minut på `https://<användarnamn>.github.io/linn-salong-website/`.
5. Vill du ha en egen domän (t.ex. `linnsalong.se`): lägg en fil som heter
   `CNAME` i repot med domännamnet som enda innehåll, och peka domänens DNS
   mot GitHub Pages hos den du köpt domänen av.

### Alternativ 2 — dra och släpp

Tjänster som Netlify Drop eller Cloudflare Pages låter dig dra in mappen i
webbläsaren och få en färdig adress direkt, utan konto-krångel.

## Bra att veta

- Sidan fungerar på mobil, surfplatta och dator. Menyn blir en hamburgermeny
  under 960 px bredd.
- Telefonnumret är klickbart på mobil, både som samtal och som SMS.
- Längst ned i filen ligger ett litet block med företagsuppgifter i
  `application/ld+json`. Det hjälper Google visa adress, telefon och
  öppettider direkt i sökresultatet — uppdatera det om uppgifterna ändras.
- Typsnitten (Cormorant Garamond + Jost) hämtas från Google Fonts, vilket
  kräver internet. Utan internet visas sidan med systemtypsnitt i stället —
  layouten går inte sönder.
- Färgerna ligger samlade högst upp i `<style>` under `:root`. Vill du byta
  färgtema räcker det att ändra där.

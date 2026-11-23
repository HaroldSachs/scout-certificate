# Scout Certificate of Achievement

A one-page static website where anyone can fill in the classic-style Scout Certificate of Achievement and download a print-ready letter-size PDF. The PDF is built in the visitor's browser with pdf-lib; there is no server code, database, or account.

## Files

`docs/` is the whole website and is the only folder to publish. `docs/js/app.js` holds the layout and PDF code, `docs/css/style.css` the page design, and `docs/img/` the artwork exported from `Certificate.PNG` (full resolution for the PDF, smaller copies for the preview and link thumbnail). `Certificate of Achievement Template/` holds the original artwork and filled-in certificates for real people; it is excluded from git so it never ends up on the public site.

## Preview locally

Double-click `start-preview.cmd`, or run `python -m http.server 8642` inside `docs/` and open http://localhost:8642. Opening `index.html` directly from disk will not work because browsers block loading the artwork and fonts from `file://` pages.

## Fonts and libraries

Lettering uses open-license fonts (EB Garamond, Playfair Display, Pinyon Script, IM Fell English; SIL Open Font License) fetched from the jsDelivr CDN along with pdf-lib and fontkit. Before launch these should be copied into `docs/` so the site does not depend on a third-party CDN.

## Adjusting the layout

The writable area inside the border is `BOX` near the top of `app.js`, in PDF points on a 612 x 792 page. Signature lines sit at `SIG_LINE_Y`. Base type sizes are in the `add(...)` calls inside `layout()`; text shrinks automatically when it would overflow.

## Colors

Tan #D6CEBD, Red #CE1126, Blue #003F87, Gray #515354, Dark Gray #232528 and Dark Tan #AD9D7B are the Scouting America brand primaries and secondaries as published in council copies of the brand guidelines. Forest green #3D5A3A is not a brand color; it is taken from the certificate's foliage.

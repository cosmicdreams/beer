# BEER

Idea from Nolan: the whole phone screen is a glass of beer. Tip the phone to
your lips like a pint and the beer stays level, sloshes, and drains out over
the top edge into your mouth.

## Core loop

1. Tap **Pour one**; beer pours in from the top and the head settles.
2. Hold the phone screen-out and tip the top edge to your lips. The beer
   surface stays level with the ground.
3. Beer above the lower top corner spills out, which is you drinking it.
4. Empty glass: hold it upright (or tap) for another.

## Run it

It is a static mobile web app with no build step: `index.html`, `style.css`, `app.js`.

```sh
npx serve .            # or: python3 -m http.server
```

Phones only expose the tilt sensor on HTTPS, so test on a phone through an
HTTPS host (GitHub Pages, Netlify, or an HTTPS tunnel). Plain `http://` over
the LAN shows the start screen, but the tilt never arrives. iOS also asks for
motion permission when you tap **Pour one**.

## How it works

- Gravity comes from DeviceOrientation `beta` and `gamma`, projected onto the
  screen. Everything is drawn in portrait coordinates, so the beer stays put
  even if the browser rotates the page. Android also tries fullscreen plus a
  portrait lock; on iPhone, turn on Portrait Orientation Lock.
- The surface angle follows gravity on a damped spring, which gives the slosh.
  The level is solved so the beer keeps its volume; whatever no longer fits
  below the top edge's lower corner drains, capped at 24% of the screen per
  second.
- Foam, rising bubbles, lacing left on the glass as the level drops, and
  condensation on the glass are all drawn on a 2D canvas, no images.
- Glug sounds (Web Audio), a fizz while pouring, vibration (Android only), and
  a burp when the glass empties. The beer count is kept in `localStorage`.

Desktop: a slider replaces the sensor. `?tilt=50` sets the angle in degrees,
`?beer=0.4` how full it is, and `?pour` starts a refill.

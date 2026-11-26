# BEER

Idea from Nolan: tip your phone up like you're drinking a beer, and the screen
plays an animation of beer pouring into your mouth.

## Core loop

1. Hold the phone upright; a full glass of beer shows on screen.
2. Tilt it toward your face like a drink. The device orientation sensor tracks
   the tilt angle.
3. Past a pour threshold, the beer level drains and the pour animation plays,
   with speed tied to tilt angle.
4. Empty glass → refill.

## Run it

It is a static mobile web app with no build step: `index.html`, `style.css`, `app.js`.

```sh
npx serve .            # or: python3 -m http.server
```

Phones only expose the tilt sensor on HTTPS, so test on a phone through an
HTTPS host (GitHub Pages, Netlify, or an HTTPS tunnel). Plain `http://` over
the LAN shows the start screen, but the tilt never arrives. iOS also asks for
motion permission when you tap **Pour one**.

On a desktop, a tilt slider appears instead. `?tilt=70` opens straight into
a fixed angle and `?sim` opens with the slider, which helps with screenshots.

## How it works

- Tilt is DeviceOrientation `beta` measured away from upright portrait, in
  either direction, smoothed and capped at 150°.
- The glass rotates about its rim lip. The beer surface stays level, and the
  share that no longer fits below the lip pours into the mouth, capped at 30%
  of the glass per second.
- Glug sounds (Web Audio) and vibration (Android only) play while pouring, and
  a burp plays when the glass empties. Hold upright for a second to refill.
  The beer count is kept in `localStorage`.

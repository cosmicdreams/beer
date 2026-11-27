# BEER

Idea from Nolan: the whole phone screen is a glass of beer. Tip the phone to
your lips like a pint and the beer stays level, sloshes, and drains out over
the top edge into your mouth.

Drinks: beer, butterbeer, root beer, wine, coffee and water. Pick one on the
start screen, or open `?drink=wine` (`beer`, `butterbeer`, `rootbeer`, `wine`,
`coffee`, `water`).

Swipe sideways (or tap the arrows at the top) to change drinks. The buttons
along the bottom add things to the drink in the glass, one tap each:

| Drink | Buttons |
|---|---|
| Water | Ice (one cube per tap, up to five), Lemon, Fizz |
| Coffee | Creamer, Cold foam |
| Root beer | Ice cream |
| Wine | one button that cycles red, white, rosé |

**Feedback** (top left) opens a short form. It posts to GitHub Discussions in
this repo, where a comment can be turned into an issue. Today it opens a
prefilled discussion on GitHub, so the tester needs a GitHub login; set
`FEEDBACK_ENDPOINT` in `app.js` to a small relay that holds a token to make
it anonymous.

Open them directly with `?mods=`, for example `?drink=water&mods=lemon&ice=3`.
The drink, its extras and a count per drink are kept in `localStorage`.

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
- Each drink is a photo texture in `textures/` (liquid body, head, and a
  condensation layer for cold drinks), generated with OpenAI gpt-image-2.
  Wine has no body photo; it is painted. The photos are kept alive in code:
  the liquid photo lives in the liquid's frame and scrolls so bubbles rise
  against gravity, swirls drift, light wanders through still drinks, the
  liquid and head slide with the slosh, foam bubbles pop, and condensation
  drops run down. The head is drawn offscreen and faded into the liquid.
- Bubbles are particles, not part of the photos: each rises from a spot on
  the glass or the depths, speeds up, swells and wobbles until it reaches
  the surface. Water, white wine and rosé are see-through: the room behind
  shows through them, shifted a little by refraction.
- Water uses a 3D glass (`FRAG3D` in `gl.js`): each pixel's line of sight is
  traced through a cylinder of glass and water. It reflects off the glass,
  bends into the water, mirrors off the underside of the surface, passes
  through rounded, cloudy ice cubes, and bends out the back wall to the room
  photo behind. The surface sloshes side to side and front to back, and ice
  cubes fall in, bob, drift and knock together. The other drinks still use
  the flat WebGL renderer, and phones without WebGL2 the 2D one.
- Drawn on top in code: the tilt and slosh, lacing,
  wine legs that form after a swirl, steam, the pour, and glass highlights.
  Until the photos load, gradients stand in.
- Glug sounds (Web Audio), a fizz while pouring, vibration (Android only), and
  a burp when the glass empties (the carbonated drinks only).

Desktop: a slider replaces the sensor. `?tilt=50` sets the angle in degrees,
`?beer=0.4` how full it is, and `?pour` starts a refill.

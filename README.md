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

## Open questions

- Platform: mobile web (DeviceOrientation API, no app store) or native iOS/Android.
- iOS Safari requires a user tap to grant motion permission.
- Sound (glugging, fizz), haptics, burp at the end.

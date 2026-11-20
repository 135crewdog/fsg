# Ideas

Unstructured; anything goes. Nothing here is built until the owner picks it.

## A trim that follows the speed ("a good pilot's thumb")

The owner's idea, 20 November 2026, while planning milestone 1. Not built: the game keeps Wings' trim, set once, where leaning the phone is the trim control.

- **What it is.** The game keeps a table of the pitch trim JSBSim's own trim gives for level flight at each speed and height, and always sets the trim for where the airplane is. Phone level then means level flight at any speed: no lean, and the throttle changes the speed, not the nose. It moves only the real trim, as a thumb on the trim button does.
- **What was flown** (in Node on the committed WebAssembly build; Supported). Phone level, hands off, throttle up for 40 seconds and back:

  | | Nose | Altitude |
  |---|---|---|
  | F-16, trim set once | 22° up to 21° down | climbs 13,000 ft |
  | F-16, trim follows the speed | 1° down to 2° up | within 430 ft |
  | Cessna (elevator free play removed), trim set once | 8° up to 14° down | within 620 ft |
  | Cessna, trim follows the speed | 23° up to 15° down | within 900 ft, slows to 48 knots |

- **What it costs.** It is worse on a propeller airplane, whose nose rises with power: fixed trim is what holds that in check. It needs a table by speed and by height for every airplane (with a table made at 8,000 ft and flown at 2,000, the F-16 sank 1,950 ft in two minutes). It is not an autopilot: hands off, the nose still wanders (1° down to 5° up over two minutes from 240 to 560 knots and back). And it takes away the lean, which is the pilot's cue.
- **When to look again.** If the F-4C's lean at high speed turns out to be more than is comfortable to hold.

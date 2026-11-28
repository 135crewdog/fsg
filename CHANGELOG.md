# Changelog

What changed in each version a player can see, newest first.

## 0.0.23

- An Airplane picker on the pause screen, under the switches, before a flight and when paused: the F-4C (NASA data) or JSBSim's Cessna 172, back for comparison with its propeller, its four flap settings and its Flaps and Brakes buttons. Picking one takes you back to the start screen with that airplane on the numbers, and it stays your airplane next time you open the app.

## 0.0.22

- Speed and roll: the F-4C's engines now take it level to Mach 2.2 high up and about 750 knots on the deck, as NASA's data has it; and at high speed down low it rolls a little slower (about 225 degrees a second at 600 knots, from 260).

## 0.0.21

- Buffet: the view shakes as the F-4C nears the stall, from about 40 knots above it, and hardest at the stall.

## 0.0.20

- Afterburner plumes: a short orange flame behind each engine, which lights only once that engine's afterburner does, grows with it, and goes out at MIL or below.

## 0.0.19

- The F-4C Phantom II takes the Cessna's place: it starts on the numbers with the gear down, flaps at 1/2 and the brakes on, with Gear, Boards and Brakes buttons, flaps that read Up, 1/2 and Full, and a throttle that stops at MIL and turns the knob orange in afterburner.

## 0.0.18

- Flaps you can set. The Cessna has four flap settings, so where the Flaps button was there are now two, Flaps Up and Flaps Down, pushed together, with a small pill between them that reads the setting: 0°, 10°, 20° or 30°. Each press moves the flaps one setting. At the last setting that button goes dim.
- Every flight now starts with the flaps at the takeoff setting, 10°, not fully down. Restart puts them back there.

## 0.0.17

- The takeoff roll, after the owner's Cessna notes: tilt is always the ailerons, so your hands hold the wings. The copilot's feet do the rest. They turn the airplane with the nosewheel as the tilt asks, less and less as the speed builds, and they hold the nose straight against the engine's pull. Picking up a wing at 60 knots no longer swings the nose off the centreline.
- The debug overlay stays in one place, bottom left, on every screen.

## 0.0.16

- A gentler middle to the stick, after the first flight: small and medium tilts now roll and pull about half as much. Full tilt still gives everything the airplane has. At 100 knots, half tilt rolls about 16 degrees a second and pulls 2 g, where it rolled 32 and pulled 3. On takeoff it wants a little more back tilt than before to fly off at the same speed.

## 0.0.15

- The controls: the first flight. Tilt the device to fly, held in landscape like a steering wheel: top edge toward you is back stick, turning it clockwise is right stick. Wherever you hold it when you tap Fly is neutral, and with it there the Cessna holds 100 knots. The first Fly tap asks for motion access.
- A throttle on the left edge: a knob in a narrow groove, idle at the bottom, full at the top.
- Two buttons on the right, Flaps and Brakes, as the Cessna has those two. Every flight starts with the flaps down and the brakes on. On the ground, tilt steers the nosewheel.
- On the pause screen: Recenter makes the way you are holding the device the new neutral, and a Crash override switch, on to begin with. Off, a hard arrival ends the flight.
- With the debug overlay on, it also shows the tilt, the stick and the last touchdown.

## 0.0.14

- The HUD, in green, as in Wings: the heading on a tape across the top (magnetic, so the runway reads 080), a bank scale under it, the pitch ladder, the flight path marker and the waterline, airspeed on the left and altitude on the right, a VSI just above the altitude, and g, angle of attack, Mach and power in the lower left. Below 2,000 feet above the ground the altitude is the radar altitude, with an R. Drag a finger to look around and the heading tape slides with the view.
- A HUD switch on the pause screen, on to begin with. Off, only the airspeed and altitude show.
- With the debug overlay on, it sits top left in flight, clear of the HUD.

## 0.0.13

- Caught up with Wings. The Developer switch is now called Debug overlay; if yours was on, it stays on.
- The rotate screen says less: "Rotate your device. If it won't turn, turn off rotation lock." Nothing on screen says "phone" any more.
- The flight pauses when anything takes focus from the app, as it already did when you left it. Control Center and its screen-recording menu can't pause it, because iOS tells the app nothing when they come down: tap Pause first. For a recording, start it, close Control Center and tap Resume.
- If the flight model fails, the screen now says "Something went wrong. Tap Restart. If it happens again, reopen FSG." The error's own words are on the debug overlay.

## 0.0.12

- Fly. The start screen has a Fly button: tap it and the Cessna's engine is idling on the runway, propeller turning, brakes on. Drag a finger across the picture to look around the airplane; let go and the view comes back. A small pause button, top right, opens the pause screen, with Resume and Restart. The game pauses by itself when the app is hidden or the phone is turned upright. There are no flight controls yet, so it does not move.
- With Developer on, the overlay now shows how the flight is running: frames a second, physics steps a second, how far the picture is behind, and where the airplane is. The timing runs of the earlier versions are gone from it.

## 0.0.11

- The first picture. Behind the start screen a Cessna 172 stands on the numbers of the test field's runway, seen from behind, under a sky with a sun and clouds. Nothing moves yet: the next version starts the engine. The Cessna is FlightGear's own model, credited on the settings screen.

## 0.0.10

- With Developer on, a launch on the slower fallback build of JSBSim now says why: the fast build did not start, or the launch before this one stopped while it was starting. Underneath, the game is ready for its picture: the Cessna it will fly, a Worker that rests while the game is paused, and the clock that will draw smoothly between physics steps. Nothing else new to see.

## 0.0.9

- The app icon goes back to the first drawing of 0.0.7: the F-4C seen from above, over the stripes. As before, to see it on the home screen, remove FSG and add it again from Safari.

## 0.0.8

- The app icon again, redrawn: the F-4C is now seen from behind and above, looking into its exhaust nozzles, so it fills more of the icon. As before, to see it on the home screen, remove FSG and add it again from Safari.

## 0.0.7

- A new app icon: the F-4C in its camouflage over orange and red stripes. An iPhone keeps the icon it had when the app was added to the home screen, so to see the new one, remove FSG from the home screen and add it again from Safari.

## 0.0.6

- Fixed: if the app was closed or updated while the Developer run was going, the next launch used the slower fallback build of JSBSim. It now uses the fast build again. Nothing new to see.

## 0.0.5

- The game now runs inside the Worker, on the Worker's own clock. With Developer on, the overlay starts a Cessna parked on the runway of the test field for ten seconds and shows one line: the steps a second, and the time one step of the whole game takes. The two-clock comparison of 0.0.4 is gone: the Worker's clock was chosen. Nothing flies on screen yet.

## 0.0.4

- With Developer on, the overlay now also measures the physics clock two ways, ten seconds each: on the Worker's own timer, and on ticks from the page. It shows steps a second, time dropped, and the gaps between states for both. Nothing flies yet.

## 0.0.3

- JSBSim is rebuilt so that the ground under the airplane can be replaced while it flies. Nothing new to see.

## 0.0.2

- JSBSim is in the app. With Developer on, the overlay shows it starting in the background, loading the Cessna 172 test aircraft and timing one step of its physics. The settings screen credits JSBSim. Nothing flies yet.

## 0.0.1

- The app shell: a start screen, a settings screen with a Developer switch, and a rotate screen in portrait. It installs on the home screen and works offline. Nothing flies yet.

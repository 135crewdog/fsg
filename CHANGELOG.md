# Changelog

What changed in each version a player can see, newest first.

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

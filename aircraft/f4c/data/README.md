# The F-4C's data, as read

The record of where the numbers in `aircraft/f4c/f4c.xml` came from. JSBSim does not read this folder, and the app does not fetch it. New in FSG, milestone 3 (pull request 5).

## `afwal-f4j.json`

**What it is.** The F-4J aerodynamic model of AFWAL-TR-80-3141 Part III, as data:
- its 28 tables in angle of attack (its Table 9, the listing of its data file; one of them, the pitching-moment increment, is also in sideslip)
- the equations that add them up into lift, drag, side force and the three moments (its Table 1)
- its constants, dimensions, control travels and control system (Tables 2 to 8, Figure 4)
- its sources, and its own validation against wing rock and a departure

**Where it came from.** Mitchell, Myers, Teper and Johnston, "Investigation of High-Angle-of-Attack Maneuver-Limiting Factors, Part III: Appendices - Aerodynamic Models", AFWAL-TR-80-3141 Part III, Systems Technology, Inc., December 1980, appendix I, "F-4J Extended Angle-of-Attack Simulation Model". DTIC ADA101648, PDF pages 17 to 66. A printed page number is the PDF's less 16.

**How it was read.** From the scanned page images, not from the PDF's text layer, on 26 November 2026:
- Table 9 is a photo-reduced dot-matrix listing in which a faded 3, 5 and 8 look alike. It was read twice by eye, line by line (504 cells; the two readings agreed everywhere).
- Every digit was then compared by program with the average shape of the same digit on its page.
- Every table was compared with the report's own plot of it (Figures 5 to 28), measured by pixel at each breakpoint.
- The machine check and the plots caught two cells that both readings had wrong (`CLSTAB` at 30 degrees, `CMSTAB` at 70).
- Tables 1 to 8 and Figure 4 are typescript and were read once.

Each table carries its page, its line numbers in the listing, its units and a `doubt` list. `doubt_summary` gathers the cells still open.

**What is still in doubt, and matters.** `CRB1` (rolling moment due to sideslip) at 25, 30 and 35 degrees: the listing prints -0.00006, 0.00025, -0.0001, and the report's Figure 10 plots about -0.00003, 0.00036, 0.0000. The listing's values are the ones in this file and in the aircraft file. The other open cells are last digits worth under 2%.

**What this copy leaves out.** The full transcription (340 KB, a working file that is not in this repo) also holds the pixel measurement of every plotted breakpoint and both raw readings. This copy keeps the counts and the spot checks; `about_this_copy` at its top says exactly what was dropped. Paths in it that start `work/` or `refs/` are the transcription's working files, which are not in this repo.

**How it is used.** `tests/f4c-aero.test.js`:
- holds every table in `aircraft/f4c/f4c.xml` to this file, cell for cell, so the two cannot drift apart;
- works Table 1 out again in JavaScript from this file, and holds JSBSim's six totals to it at a grid of states.

To change a number in the aircraft file's tables, change it here first, with the reason in its `doubt` entry.

**Evidence.** Verified: the listing against the report's own plots (382 of 393 measurable breakpoints agree; the others are listed), and one table against its second printing in the report's Table 8. Supported: the two readings against each other and against the machine check. Reasoned: that the listing and Figure 10 are different revisions of `CRB1`; the wing-rock and nose-slice checkride of pull request 10, flown both ways, would show which is nearer the airplane.

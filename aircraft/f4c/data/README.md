# The F-4C's data, as read

The record of where the numbers in `aircraft/f4c/f4c.xml` came from. JSBSim does not read this folder, and the app does not fetch it. New in FSG, milestone 3 (pull request 5).

- `afwal-f4j.json`: the shape of every aerodynamic term in angle of attack and sideslip, at low speed.
- `cr2144-f4c.json`: the F-4C's own numbers, and what Mach changes.

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

**What is still in doubt, and matters.** `CRB1` (rolling moment due to sideslip) at 25, 30 and 35 degrees: the listing prints -0.00006, 0.00025, -0.0001, and the report's Figure 10 plots about -0.00003, 0.00036, 0.0000. The listing's values are the ones in this file and in the aircraft file. The other open cells are last digits worth under 2%. A doubt looked at and resolved (pull request 10, round 3): `CYB` is positive from 70 degrees up (+0.0006 at 70, +0.003 from 80), where TN D-6425's side force falls steeply with sideslip overall; the listing is as printed, and the report's own slope within 10 degrees is positive or near zero there too (`tnd6425-f4.json`, `side_force_above_70_degrees`), so nothing was changed. Another, not changed: `CNR` (yaw damping) falls to 0 at 45 degrees and is held above; NASA TN D-6091 measured stable yaw damping to about 60 degrees and propelling moments only above.

**What this copy leaves out.** The full transcription (340 KB, a working file that is not in this repo) also holds the pixel measurement of every plotted breakpoint and both raw readings. This copy keeps the counts and the spot checks; `about_this_copy` at its top says exactly what was dropped. Paths in it that start `work/` or `refs/` are the transcription's working files, which are not in this repo.

**How it is used.** `tests/f4c-aero.test.js`:
- holds every table in `aircraft/f4c/f4c.xml` to this file, cell for cell, so the two cannot drift apart;
- works Table 1 out again in JavaScript from this file, and holds JSBSim's six totals to it at a grid of states.

To change a number in the aircraft file's tables, change it here first, with the reason in its `doubt` entry.

**Evidence.** Verified: the listing against the report's own plots (382 of 393 measurable breakpoints agree; the others are listed), and one table against its second printing in the report's Table 8. Supported: the two readings against each other and against the machine check. Reasoned: that the listing and Figure 10 are different revisions of `CRB1`; the wing-rock and nose-slice checkride of pull request 10, flown both ways, would show which is nearer the airplane.

## `cr2144-f4c.json`

**What it is.** The F-4C chapter of NASA CR-2144, as data:
- its tables: the ten flight conditions (IV-2), the dimensional stability derivatives (IV-3 longitudinal, IV-13 lateral), the transfer-function factors with the augmentation off and on (IV-4, IV-6, IV-8, IV-10, IV-14 to IV-17) and the handling-qualities parameters (IV-12, IV-18), with the power approach's coefficients (IV-1)
- its plots, measured from the page: trim angle of attack and stabilator against Mach at five heights, trimmed lift and drag, each derivative against Mach by height, the feel system's parameters and the rudder's flexure
- its control system, feel system and stability augmentation as their diagrams have them
- how the report says to read its tables (`how_to_read`), and the transcription's own cross-check of tables against plots (`cross_check`)

**Where it came from.** Heffley, R. K., and Jewell, W. F., "Aircraft Handling Qualities Data", NASA CR-2144, Systems Technology, Inc., December 1972, Section IV. PDF pages 67 to 113; a printed page number is the PDF's less 6. https://ntrs.nasa.gov/citations/19730003312

**How it was read.** From 300 dpi page images, not the PDF's text layer, on 26 November 2026:
- The tables are line-printer output, weak in places (a 9 looks like a 0, an 8 like a 3). The main ones were read twice; every value printed in more than one table was compared by program.
- Tables IV-4, IV-5, IV-14 and IV-15 were worked out again from IV-2, IV-3 and IV-13 with the report's own equations. That is what settled the damaged digits marked `identity` in the `doubt` lists.
- The plots were measured by program: each page straightened, the axis ticks found in pixels, the drawn line's centre measured at each Mach station. Each curve's point carries a flag: measured, interpolated (a dash gap, or under a flight-condition marker), or eyeballed.

**Misprints the record has caught.** Each is in its table's `doubt` list; a cell to be used otherwise than printed has `use_instead`, which the tool and the checkride obey.
- `L'DA` at condition 6 (Table IV-13) and `A(P)` there (IV-14) are printed 0.00: an overflow of 10.0.
- `ZW` at condition 9 (IV-3) prints like -.404 and is -.494.

**What this copy leaves out.** The four thrust-input transfer-function tables (IV-5, IV-7, IV-9, IV-11), and the cells "as printed" wherever they are just the value as text. `about_this_copy` at its top says exactly what was dropped.

**How it is used.**
- `tools/f4c-mach.mjs` works the aircraft file's 22 tables of what Mach changes out of this file and `afwal-f4j.json`, and writes them between the file's two "MACH TABLES" marks. Its header says which number makes which cell.
- `tests/f4c-conditions.test.js` works them out again and holds the aircraft file to them, cell for cell; then flies the airplane at CR-2144's nine clean conditions and lays its trim and its responses beside the record's.
- `tests/checkride/f4c-reference.js` has the few lists a test names (each condition's Mach, height, trim and stabilator per g), and a test holds them to this file.

To change one of the aircraft file's Mach tables, change the record or the tool, and run `node tools/f4c-mach.mjs --write`. Never the table by hand.

**Evidence.** Verified: the tables against themselves (repeated values, and four tables recomputed from three others within 1.5%); the plots against the tables at conditions 2 and 6 (within 2%, but the pitch stiffness at condition 2: the tables' -0.269 against the plot's -0.29 under a marker). Supported: the checkride's own flights against these numbers. Reasoned: the numerators of the tables this copy leaves out were read once.

## `tnd6425-f4.json`

**What it is.** NASA TN D-6425's figure 7, the rudder-0 curves (circles and their repeat squares): side force, yawing moment and rolling moment against sideslip at each of its 26 angles of attack, -10 to 110 degrees; sideslip to 20 degrees each way up to 22.5 degrees of angle of attack, and to 40 from 25 up. 893 points; where both readings found a point, both are kept.

**Where it came from.** Anglin, E. L., "Static Force Tests of a Model of a Twin-Jet Fighter Airplane for Angles of Attack from -10 to 110 deg and Sideslip Angles from -40 to 40 deg", NASA TN D-6425, August 1971, PDF pages 36 to 50. A 0.13-scale F-4 model, clean, tail at 0, in the Langley full-scale tunnel at low speed. Body axes; moments about 33% of the mean chord; the report's wing area 538.34 sq ft and span 38.41 ft.

**How it was read.** From the PDF's own 300 dpi scans, twice. Reading A: automatic, the sideslip lines and the printed axis labels found in the scan and fitted with straight lines, the rudder-0 symbol found at each sideslip by template (where it could not, at 50 and 110 degrees, a magnified eye reading). Reading B: by eye on whole-page views, done first. They agree to 0.0025 (yaw), 0.0019 (roll) and 0.014 (side force), root mean square; reading A is used. Every point is flagged `measured`, `magnified eye reading` or `eyeballed` (reading B alone, where A found no symbol). `how_read` says all of it, and the differences.

**What surprised us.** Page 40 (20 and 22.5 degrees) is drawn larger and its yawing-moment axis is printed .4, .2, 0: read as .04, .02, 0, settled by the panels either side (`page_40_scale`). Below the stall the report's slopes within 10 degrees are not AFWAL's: 18 to 21% more yaw from sideslip, 14 to 22% more side force, and at -5 and -10 degrees a roll from sideslip of the other sign. AFWAL's model there is its reference 16, not this report (`cross_check_within_10_degrees`, kept as found). `CYB` above 70 degrees: see AFWAL's section above.

**How it is used.** `tools/f4c-sideslip.mjs` moves the report's coefficients to AFWAL's reference (31% of the chord, 530 sq ft, 38.67 ft), makes them odd in sideslip, and writes into the aircraft file, between its SIDESLIP TABLES marks, the report's bend beyond 10 degrees of sideslip (its departure from its own straight line: never its level) and, below zero angle of attack, the report's share of AFWAL's roll from sideslip. `tests/f4c-sideslip.test.js` holds the file to the tool cell for cell and the record's numbers to its points. To change the bend, change the record or the tool and run `node tools/f4c-sideslip.mjs --write`.

**Evidence.** Verified: within 10 degrees the report's slopes agree with AFWAL's within about 10% only at 10 to 15 degrees, 35 to 40 and around 55 to 75 (the cross-check table); elsewhere they disagree, which is why only the bend is used. Supported: the two readings against each other; the edge checkride's flights with the bend in. Reasoned: the total held past the last sideslip the report gives, the angles of attack below -10 and above 110 held, and the page 40 scale.

# Random elements in the JSBSim data (searched before the parity sweep)

Required by `REPORT.md` part 2 ("Class S, script sweep"): the list is committed before the sweep runs.

Search, in `jsbsim-data/` at the pin, case-insensitive: `<noise`, `<random`, `<urandom`, `gaussian`,
`randomseed`, and in `scripts/` and `check_cases/` also `turb`, `gust`, `seed`. JSBSim draws random numbers in
three places: sensor `<noise>` (`FGSensor::Noise`, only when the noise value is not 0), the `<random/>` and
`<urandom/>` function elements, and turbulence (`FGWinds`, only when severity is not 0).

## Live random elements

| Where | Element | Output properties | Read by a control law? | Scripts using the aircraft |
|---|---|---|---|---|
| `aircraft/c172x/c172ap.xml:55-66` | sensor with Gaussian noise 0.05 % | `fcs/attitude/sensor/phi-rad`, `attitude/sensor/quantized/phi-rad` | No. The only other references are two output lists (`c172x.xml:1261`, `output.xml:5`). The roll autopilot reads `attitude/phi-rad` directly (`c172ap.xml:76`, `:136`). | `c1722`, `c1723`, `c1724`, `c172_cross_wind`, `c172_cruise_8K`, `c172_elevation_test`, `c172_elevator_doublet`, `c172_head_wind`, `c172_runway_at_rest_cg_shift` |
| `aircraft/global5000/global5000ap.xml:64-75` (and `global5000apx.xml`) | the same sensor | the same two properties | No (no other reference in the folder) | none |

## Present but inactive

| Where | Why inactive |
|---|---|
| `aircraft/c310/c310ap.xml:47-57` | the sensor is inside an XML comment |
| `aircraft/Camel/Camel.xml:1772` | `<urandom/>` is inside an XML comment |
| `aircraft/c172x/c172x.xml:280` | inside an XML comment |
| `systems/SensorBaro.xml`, `SensorImu.xml`, `SensorGps.xml` (used by `F450`) | noise value 0.0, so `FGSensor` draws nothing (`FGSensor.cpp:167`) |
| `scripts/Test_F450_Launch.xml:41-50` | the turbulence event is inside an XML comment |

## Other
- `scripts/c1723.xml:33` sets `simulation/randomseed` to 2498. It seeds the generator the c172x sensor draws from.
- `scripts/c172_cruise_8K.xml` and `scripts/p51d_tail_wind.xml` use a cosine gust. It is a fixed shape, not random.
- No script turns turbulence on. The sweep still reads it back on every row.

## Consequence for the sweep
- Not judged: `fcs/attitude/sensor/phi-rad`, `attitude/sensor/quantized/phi-rad`. They are not in the judged
  column list in any case.
- No script is expected to be "not comparable (RNG)": no judged state depends on a random draw. This is from
  reading the data (**Reasoned**); the sweep's turbulence read-back and the comparisons test it.

#include "scenario_runner.h"

#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <memory>
#include <sstream>

#include "fdm_host.h"

namespace fdmhost {

bool ReadFile(const std::string& path, std::string& out) {
  std::ifstream f(path, std::ios::binary);
  if (!f) return false;
  std::ostringstream ss;
  ss << f.rdbuf();
  out = ss.str();
  return true;
}

namespace {

std::string JsonEscape(const std::string& s) {
  std::string o;
  for (unsigned char c : s) {
    switch (c) {
      case '"': o += "\\\""; break;
      case '\\': o += "\\\\"; break;
      case '\n': o += "\\n"; break;
      case '\r': o += "\\r"; break;
      case '\t': o += "\\t"; break;
      default:
        if (c < 0x20) {
          char buf[8];
          std::snprintf(buf, sizeof buf, "\\u%04x", c);
          o += buf;
        } else {
          o += static_cast<char>(c);
        }
    }
  }
  return o;
}

bool ParseDouble(const std::string& s, double& v) {
  char* end = nullptr;
  v = std::strtod(s.c_str(), &end);
  return end && *end == '\0' && !s.empty();
}

bool ReadDoubles(const std::string& path, std::vector<double>& out) {
  std::string raw;
  if (!ReadFile(path, raw) || raw.size() % sizeof(double) != 0) return false;
  out.resize(raw.size() / sizeof(double));
  std::memcpy(out.data(), raw.data(), raw.size());
  return true;
}

struct Scenario {
  std::string root, outdir = ".", aircraft = "aircraft", engine = "engine", systems = "systems";
  bool hasPaths = false;
  double dt = -1.0;
  bool hasInteg = false;
  int integ[4] = {1, 3, 1, 4};
  std::string groundFile, model, script, initfile, ic, inputsFile;
  std::vector<std::pair<std::string, double>> sets, adds;
  std::vector<std::string> outs, ins;
  bool outGear = false;
  long steps = -1;
  double duration = -1.0;
};

bool Parse(const std::string& text, Scenario& sc, std::string& err) {
  std::istringstream lines(text);
  std::string line;
  while (std::getline(lines, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty() || line[0] == '#') continue;
    std::istringstream ls(line);
    std::string key;
    ls >> key;
    std::vector<std::string> a;
    for (std::string tok; ls >> tok;) a.push_back(tok);
    auto need = [&](size_t n) {
      if (a.size() < n) {
        err = "scenario: '" + key + "' needs " + std::to_string(n) + " value(s)";
        return false;
      }
      return true;
    };
    double v = 0.0;
    if (key == "root") { if (!need(1)) return false; sc.root = a[0]; }
    else if (key == "outdir") { if (!need(1)) return false; sc.outdir = a[0]; }
    else if (key == "paths") { if (!need(3)) return false; sc.aircraft = a[0]; sc.engine = a[1]; sc.systems = a[2]; sc.hasPaths = true; }
    else if (key == "dt") { if (!need(1) || !ParseDouble(a[0], sc.dt)) { err = "scenario: bad dt"; return false; } }
    else if (key == "integrators") {
      if (!need(4)) return false;
      for (int i = 0; i < 4; ++i) sc.integ[i] = std::atoi(a[i].c_str());
      sc.hasInteg = true;
    }
    else if (key == "ground") { if (!need(1)) return false; sc.groundFile = a[0]; }
    else if (key == "model") { if (!need(1)) return false; sc.model = a[0]; }
    else if (key == "script") { if (!need(1)) return false; sc.script = a[0]; if (a.size() > 1) sc.initfile = a[1]; }
    else if (key == "ic") { if (!need(1)) return false; sc.ic = a[0]; }
    else if (key == "set" || key == "add") {
      if (!need(2) || !ParseDouble(a[1], v)) { err = "scenario: bad " + key; return false; }
      (key == "set" ? sc.sets : sc.adds).emplace_back(a[0], v);
    }
    else if (key == "out") { if (!need(1)) return false; sc.outs.push_back(a[0]); }
    else if (key == "outgear") { sc.outGear = true; }
    else if (key == "in") { if (!need(1)) return false; sc.ins.push_back(a[0]); }
    else if (key == "inputs") { if (!need(1)) return false; sc.inputsFile = a[0]; }
    else if (key == "steps") { if (!need(1)) return false; sc.steps = std::atol(a[0].c_str()); }
    else if (key == "duration") { if (!need(1) || !ParseDouble(a[0], sc.duration)) { err = "scenario: bad duration"; return false; } }
    else { err = "scenario: unknown directive '" + key + "'"; return false; }
  }
  if (sc.root.empty()) { err = "scenario: root missing"; return false; }
  if (sc.dt < 0.0) { err = "scenario: dt missing"; return false; }
  if (sc.model.empty() == sc.script.empty()) { err = "scenario: give exactly one of model / script"; return false; }
  if (sc.steps < 0 && sc.duration < 0.0) { err = "scenario: steps or duration missing"; return false; }
  return true;
}

}  // namespace

std::string ScenarioResult::MetaJson() const {
  std::ostringstream o;
  o << "{\"loaded\":" << (loaded ? "true" : "false") << ",\"icOk\":" << (icOk ? "true" : "false")
    << ",\"stage\":\"" << JsonEscape(stage) << "\",\"message\":\"" << JsonEscape(message) << "\""
    << ",\"endCode\":" << endCode << ",\"stepsDone\":" << stepsDone << ",\"rows\":" << rows;
  char buf[64];
  std::snprintf(buf, sizeof buf, "%.17g", dt);
  o << ",\"dt\":" << buf << ",\"columns\":[";
  for (size_t i = 0; i < columns.size(); ++i) o << (i ? "," : "") << "\"" << JsonEscape(columns[i]) << "\"";
  o << "],\"counters\":[";
  for (int i = 0; i < 8; ++i) o << (i ? "," : "") << counters[i];
  o << "]}";
  return o.str();
}

ScenarioResult RunScenario(const std::string& scenarioText) {
  ScenarioResult r;
  Scenario sc;
  r.stage = "parse";
  if (!Parse(scenarioText, sc, r.message)) return r;

  r.stage = "create";
  FdmHost host(sc.dt, sc.root, sc.outdir);
  auto fail = [&](const std::string& extra = std::string()) {
    r.message = extra.empty() ? host.LastError() : extra;
    for (int i = 0; i < 8; ++i) r.counters[i] = host.Counter(i);
    return r;
  };
  if (host.State() != FDM_NEW) return fail();
  if (sc.hasPaths && !host.SetPaths(sc.aircraft, sc.engine, sc.systems)) return fail();
  if (sc.hasInteg && !host.SetIntegrators(sc.integ[0], sc.integ[1], sc.integ[2], sc.integ[3])) return fail();
  if (!sc.groundFile.empty()) {
    std::vector<double> raw;
    if (!ReadDoubles(sc.groundFile, raw) || raw.size() < 6) return fail("cannot read grid file " + sc.groundFile);
    auto grid = std::make_shared<HeightGrid>();
    grid->lat0 = raw[0]; grid->lon0 = raw[1]; grid->dlat = raw[2]; grid->dlon = raw[3];
    grid->nlat = static_cast<int>(raw[4]); grid->nlon = static_cast<int>(raw[5]);
    grid->h.assign(raw.begin() + 6, raw.end());
    if (!host.SetGroundGrid(grid)) return fail();
  }

  r.stage = "load";
  const bool loaded = sc.model.empty() ? host.LoadScript(sc.script, sc.initfile) : host.LoadModel(sc.model);
  if (!loaded) return fail();
  r.loaded = true;
  r.dt = host.Dt();

  r.stage = "setup";
  if (!sc.ic.empty() && !host.LoadIC(sc.ic)) return fail();
  for (const auto& kv : sc.sets) {
    const int h = host.Prop(kv.first);
    if (h < 0) return fail();
    const int st = host.Set(h, kv.second);
    if (st != FDM_SET_OK && st != FDM_SET_READBACK_DIFFERS)
      return fail("set " + kv.first + " refused, status " + std::to_string(st));
  }
  for (const auto& kv : sc.adds) {
    const int h = host.Prop(kv.first);
    if (h < 0) return fail();
    const int st = host.Set(h, host.Get(h) + kv.second);
    if (st != FDM_SET_OK && st != FDM_SET_READBACK_DIFFERS)
      return fail("add " + kv.first + " refused, status " + std::to_string(st));
  }
  std::vector<std::string> outs = sc.outs;
  if (sc.outGear) {
    const int hn = host.Prop("gear/num-units");
    const int units = hn >= 0 ? static_cast<int>(host.Get(hn)) : 0;
    for (int k = 0; k < units; ++k) {
      // Bogeys are under gear/unit[k], structure contact points under contact/unit[k].
      const std::string a = "gear/unit[" + std::to_string(k) + "]/WOW";
      const std::string b = "contact/unit[" + std::to_string(k) + "]/WOW";
      if (host.Prop(a) >= 0) outs.push_back(a);
      else if (host.Prop(b) >= 0) outs.push_back(b);
      else return fail("no WOW property for unit " + std::to_string(k));
    }
  }
  std::vector<int> outH, inH;
  for (const auto& name : outs) {
    const int h = host.Prop(name);
    if (h < 0) return fail();
    outH.push_back(h);
  }
  for (const auto& name : sc.ins) {
    const int h = host.Prop(name);
    if (h < 0) return fail();
    inH.push_back(h);
  }
  if (!host.BindOutputs(outH.data(), static_cast<int>(outH.size()))) return fail();
  if (!host.BindInputs(inH.data(), static_cast<int>(inH.size()))) return fail();
  r.columns = outs;

  std::vector<double> inputs;
  const size_t nIn = inH.size();
  if (!sc.inputsFile.empty()) {
    if (!ReadDoubles(sc.inputsFile, inputs) || nIn == 0 || inputs.size() % nIn != 0)
      return fail("cannot read inputs file " + sc.inputsFile);
  }
  long steps = sc.steps >= 0 ? sc.steps : static_cast<long>(std::floor(sc.duration / host.Dt() + 1e-9));
  if (nIn > 0 && !sc.inputsFile.empty() && static_cast<long>(inputs.size() / nIn) < steps)
    return fail("inputs file has fewer rows than steps");

  r.stage = "runic";
  if (!host.RunIC()) return fail();
  r.icOk = true;

  r.stage = "step";
  const size_t nOut = outH.size();
  r.data.reserve(static_cast<size_t>(steps + 1) * nOut);
  r.data.insert(r.data.end(), host.Curr(), host.Curr() + nOut);
  r.rows = 1;
  for (long k = 0; k < steps; ++k) {
    if (!inputs.empty()) std::memcpy(host.In(), inputs.data() + static_cast<size_t>(k) * nIn, nIn * sizeof(double));
    r.endCode = host.Step(1);
    if (host.StepsInLastCall() == 1) {
      ++r.stepsDone;
      r.data.insert(r.data.end(), host.Curr(), host.Curr() + nOut);
      ++r.rows;
    }
    if (r.endCode != FDM_STEP_OK) break;
  }
  for (int i = 0; i < 8; ++i) r.counters[i] = host.Counter(i);
  if (r.endCode < 0 || r.endCode == FDM_STEP_NONFINITE) {
    r.message = host.LastError();
    return r;  // stage stays "step"
  }
  r.stage = "done";
  return r;
}

}  // namespace fdmhost

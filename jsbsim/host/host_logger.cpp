#include "host_logger.h"

namespace fdmhost {

std::shared_ptr<HostLogger> HostLogger::Install() {
  // JSBSim keeps its logger in thread-local storage; keep ours the same way.
  thread_local std::shared_ptr<HostLogger> instance;
  if (!instance) instance = std::make_shared<HostLogger>();
  if (JSBSim::GetLogger().get() != instance.get()) JSBSim::SetLogger(instance);
  return instance;
}

void HostLogger::SetLevel(JSBSim::LogLevel level) {
  // A new record starts. If one is still open (nested loggers), commit it first.
  if (open_) Commit();
  FGLogger::SetLevel(level);
  current_ = LogRecord();
  current_.level = static_cast<int>(level);
  open_ = true;
}

void HostLogger::FileLocation(const std::string& filename, int line) {
  current_.file = filename;
  current_.line = line;
}

void HostLogger::Message(const std::string& message) {
  if (!open_) {  // text with no SetLevel before it: keep it rather than lose it
    current_ = LogRecord();
    current_.level = static_cast<int>(log_level);
    open_ = true;
  }
  current_.text += message;
}

void HostLogger::Flush(void) {
  if (open_) Commit();
}

void HostLogger::Commit() {
  open_ = false;
  // Trim trailing newlines; skip records with no text.
  while (!current_.text.empty() && (current_.text.back() == '\n' || current_.text.back() == '\r'))
    current_.text.pop_back();
  if (current_.text.empty()) return;
  current_.seq = nextSeq_++;
  if (records_.size() >= kCapacity) {
    records_.pop_front();
    ++dropped_;
  }
  records_.push_back(std::move(current_));
  current_ = LogRecord();
}

std::string HostLogger::TextSince(uint64_t mark, int minLevel) const {
  std::string out;
  for (const auto& r : records_) {
    if (r.seq < mark || r.level < minLevel || r.level == static_cast<int>(JSBSim::LogLevel::STDOUT)) continue;
    if (!out.empty()) out += "\n";
    if (!r.file.empty()) out += "In file " + r.file + ": line " + std::to_string(r.line) + "\n";
    out += r.text;
  }
  return out;
}

bool HostLogger::Take(LogRecord& out) {
  if (records_.empty()) return false;
  out = std::move(records_.front());
  records_.pop_front();
  return true;
}

void HostLogger::HostMessage(int level, const std::string& text) {
  if (open_) Commit();
  current_ = LogRecord();
  current_.level = level;
  current_.text = text;
  open_ = true;
  Commit();
}

}  // namespace fdmhost

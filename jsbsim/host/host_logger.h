// Host layer (not physics): routes JSBSim's log records into a bounded buffer that the caller drains.
// The same code is used natively and in WebAssembly.
#pragma once
#include <cstdint>
#include <deque>
#include <memory>
#include <string>

#include "input_output/FGLog.h"

namespace fdmhost {

struct LogRecord {
  uint64_t seq = 0;      // running number of the record, never reused
  int level = 0;         // JSBSim::LogLevel as int: 0 BULK, 1 DEBUG, 2 INFO, 3 WARN, 4 ERROR, 5 FATAL, 6 STDOUT
  std::string text;
  std::string file;      // XML file for XML-related records, else empty
  int line = -1;
};

class HostLogger : public JSBSim::FGLogger {
 public:
  // Installs one HostLogger as JSBSim's logger for this thread (once) and returns it.
  static std::shared_ptr<HostLogger> Install();

  void SetLevel(JSBSim::LogLevel level) override;
  void FileLocation(const std::string& filename, int line) override;
  void Message(const std::string& message) override;
  void Format(JSBSim::LogFormat) override {}
  void Flush(void) override;

  // Number of the next record to be created. Use as a mark before a call.
  uint64_t NextSeq() const { return nextSeq_; }
  // Text of all WARN-or-worse / ERROR-or-worse records created at or after `mark`, joined by newlines.
  std::string TextSince(uint64_t mark, int minLevel) const;
  // Removes and returns the oldest pending record; false when none is pending.
  bool Take(LogRecord& out);
  size_t Pending() const { return records_.size(); }
  uint64_t Dropped() const { return dropped_; }
  // Adds a record written by the host layer itself.
  void HostMessage(int level, const std::string& text);

  static constexpr size_t kCapacity = 4096;

 private:
  void Commit();
  std::deque<LogRecord> records_;
  LogRecord current_;
  bool open_ = false;
  uint64_t nextSeq_ = 1;
  uint64_t dropped_ = 0;
};

}  // namespace fdmhost

# One build description for the native answer key and the WebAssembly binaries.
#
# JSBSim is built from the unpatched pinned source in build/jsbsim-src. The compiler flags below are set
# globally BEFORE add_subdirectory, so JSBSim and its bundled expat are compiled with exactly the same
# optimisation and exception flags as the host layer.
#
#   FDM_EH = native | wasm | js     wasm: -fwasm-exceptions, js: -fexceptions (both under emcmake)
#   FDM_ASSERTS = ON                keep assert() (native check build only)
cmake_minimum_required(VERSION 3.18)
project(fdm_baseline C CXX)

set(JSBSIM_SOURCE_DIR "${CMAKE_SOURCE_DIR}/build/jsbsim-src" CACHE PATH "Pinned, unpatched JSBSim source")
set(FDM_EH "native" CACHE STRING "native | wasm | js")
set(FDM_ASSERTS OFF CACHE BOOL "Keep assert() enabled")
set(FDM_OUTPUT_NAME "fdm" CACHE STRING "Name of the WebAssembly output files")
set(FDM_WASM_MEMORY_MB "64" CACHE STRING "Fixed WebAssembly memory, MiB")
set(FDM_WASM_STACK_MB "1" CACHE STRING "WebAssembly stack, MiB")

if(NOT EXISTS "${JSBSIM_SOURCE_DIR}/CMakeLists.txt")
  message(FATAL_ERROR "JSBSim source not found at ${JSBSIM_SOURCE_DIR}; run scripts/setup-toolchain.sh")
endif()

set(CMAKE_BUILD_TYPE Release CACHE STRING "" FORCE)
set(CMAKE_EXPORT_COMPILE_COMMANDS ON)
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# -O3 stated explicitly (a toolchain's idea of "Release" is not relied on). No fast-math anywhere.
if(FDM_ASSERTS)
  set(FDM_OPT "-O3")
else()
  set(FDM_OPT "-O3 -DNDEBUG")
endif()
set(CMAKE_C_FLAGS_RELEASE "${FDM_OPT}" CACHE STRING "" FORCE)
set(CMAKE_CXX_FLAGS_RELEASE "${FDM_OPT}" CACHE STRING "" FORCE)

if(EMSCRIPTEN)
  if(FDM_EH STREQUAL "wasm")
    set(FDM_EH_FLAG "-fwasm-exceptions")
  elseif(FDM_EH STREQUAL "js")
    set(FDM_EH_FLAG "-fexceptions")
  else()
    message(FATAL_ERROR "Under Emscripten FDM_EH must be wasm or js")
  endif()
else()
  if(NOT FDM_EH STREQUAL "native")
    message(FATAL_ERROR "A native build needs FDM_EH=native")
  endif()
  set(FDM_EH_FLAG "-fexceptions")  # the default for C++; stated so that expat's C files get it too
endif()

# -ffp-contract=off: never fuse a*b+c, on either platform, so the arithmetic is the same.
# -ffile-prefix-map: no absolute build paths inside the binaries.
set(FDM_GLOBAL_FLAGS "${FDM_EH_FLAG} -ffp-contract=off -ffile-prefix-map=${CMAKE_SOURCE_DIR}=.")
set(CMAKE_C_FLAGS "${CMAKE_C_FLAGS} ${FDM_GLOBAL_FLAGS}")
set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} ${FDM_GLOBAL_FLAGS}")

# JSBSim: library only.
set(BUILD_DOCS OFF CACHE BOOL "" FORCE)
set(BUILD_PYTHON_MODULE OFF CACHE BOOL "" FORCE)
set(BUILD_JULIA_PACKAGE OFF CACHE BOOL "" FORCE)
set(BUILD_MATLAB_SFUNCTION OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(SYSTEM_EXPAT OFF CACHE BOOL "" FORCE)
add_subdirectory("${JSBSIM_SOURCE_DIR}" jsbsim EXCLUDE_FROM_ALL)

set(FDM_HOST_SOURCES
  host/fdm_host.cpp
  host/grid_ground.cpp
  host/host_logger.cpp
  host/scenario_runner.cpp
  host/c_api.cpp)

if(EMSCRIPTEN)
  add_executable(fdm ${FDM_HOST_SOURCES})
  target_include_directories(fdm PRIVATE host "${JSBSIM_SOURCE_DIR}/src")
  target_link_libraries(fdm PRIVATE libJSBSim)
  set_target_properties(fdm PROPERTIES OUTPUT_NAME "${FDM_OUTPUT_NAME}" SUFFIX ".mjs")
  math(EXPR FDM_MEMORY_BYTES "${FDM_WASM_MEMORY_MB} * 1024 * 1024")
  math(EXPR FDM_STACK_BYTES "${FDM_WASM_STACK_MB} * 1024 * 1024")
  target_link_options(fdm PRIVATE
    -O3
    ${FDM_EH_FLAG}
    -sWASM_LEGACY_EXCEPTIONS=1          # legacy exception encoding: Safari 15.2+ (only used by -fwasm-exceptions)
    -sMODULARIZE=1
    -sEXPORT_ES6=1
    -sEXPORT_NAME=createFdmModule
    -sENVIRONMENT=web,worker,node
    -sALLOW_MEMORY_GROWTH=0             # fixed memory: no growth, typed-array views never detach
    -sINITIAL_MEMORY=${FDM_MEMORY_BYTES}
    -sSTACK_SIZE=${FDM_STACK_BYTES}
    -sABORTING_MALLOC=0                 # out of memory becomes std::bad_alloc, which the host catches
    -sFORCE_FILESYSTEM=1
    -sEXIT_RUNTIME=0
    -sEXPORTED_FUNCTIONS=_main,_malloc,_free
    "-sEXPORTED_RUNTIME_METHODS=FS,HEAPF64,HEAP32,HEAPU8,UTF8ToString,stringToUTF8,lengthBytesUTF8")
else()
  add_executable(fdm_native ${FDM_HOST_SOURCES} host/native_main.cpp tests/native/ground_oracle.cpp
    tests/native/host_selftest.cpp)
  target_include_directories(fdm_native PRIVATE host "${JSBSIM_SOURCE_DIR}/src")
  target_link_libraries(fdm_native PRIVATE libJSBSim)
endif()

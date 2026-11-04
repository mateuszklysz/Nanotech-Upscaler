# SPDX-License-Identifier: GPL-3.0-or-later
# Copyright (c) 2026 Mateusz Kłysz
#
# Natively: the engine, the `nanotech` command and the tests.
#   cmake -B build && cmake --build build && ctest --test-dir build
# For the mod's page (with wasi-sdk): nanotech.wasm, and the tests as WASI programs.
#   cmake -B build-wasm -DCMAKE_TOOLCHAIN_FILE=<wasi-sdk>/share/cmake/wasi-sdk.cmake && cmake --build build-wasm
cmake_minimum_required(VERSION 3.20)
project(nanotech_upscaler VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
if(NOT CMAKE_BUILD_TYPE AND NOT CMAKE_CONFIGURATION_TYPES)
  set(CMAKE_BUILD_TYPE Release)
endif()

set(NANOTECH_WASM OFF)
if(CMAKE_SYSTEM_NAME STREQUAL "WASI")
  set(NANOTECH_WASM ON)
endif()

# The same bytes everywhere: no fused multiply-adds and no fast maths, so xBRZ's and the bicubic
# curve's doubles round the same way on x86, ARM and WebAssembly.
add_library(nanotech_flags INTERFACE)
if(MSVC)
  target_compile_options(nanotech_flags INTERFACE /fp:precise /W4 /utf-8)
else()
  target_compile_options(nanotech_flags INTERFACE -ffp-contract=off -fno-fast-math -Wall -Wextra)
endif()
if(NANOTECH_WASM)
  target_compile_options(nanotech_flags INTERFACE -fno-exceptions)
endif()

add_library(xbrz STATIC third_party/xbrz/xbrz.cpp)
target_include_directories(xbrz PUBLIC third_party/xbrz)
target_link_libraries(xbrz PRIVATE nanotech_flags)
if(NOT MSVC)
  target_compile_options(xbrz PRIVATE -w)
endif()

add_library(nanotech_engine STATIC src/engine/image.cpp src/engine/upscale.cpp)
target_include_directories(nanotech_engine PUBLIC src PRIVATE third_party/stb)
target_link_libraries(nanotech_engine PUBLIC nanotech_flags PRIVATE xbrz)

enable_testing()

if(NANOTECH_WASM)
  # The page's module: no entry point (a reactor), its functions named in src/wasm/exports.cpp,
  # memory that grows to fit a 1024 texture at 6x.
  add_executable(nanotech_wasm src/wasm/exports.cpp)
  target_link_libraries(nanotech_wasm PRIVATE nanotech_engine)
  set_target_properties(nanotech_wasm PROPERTIES OUTPUT_NAME nanotech SUFFIX ".wasm")
  target_link_options(nanotech_wasm PRIVATE -mexec-model=reactor -Wl,--max-memory=4294967296 -Wl,--strip-all)
  set(NANOTECH_RUN node --no-warnings ${CMAKE_SOURCE_DIR}/tools/run-wasi.mjs)
else()
  add_executable(nanotech src/cli/main.cpp)
  target_link_libraries(nanotech PRIVATE nanotech_engine)
  set(NANOTECH_RUN "")
endif()

add_executable(engine_test tests/engine_test.cpp)
target_include_directories(engine_test PRIVATE tests)
target_link_libraries(engine_test PRIVATE nanotech_engine)
add_executable(golden tests/golden.cpp)
target_include_directories(golden PRIVATE tests)
target_link_libraries(golden PRIVATE nanotech_engine)
if(NANOTECH_WASM)
  set_target_properties(engine_test golden PROPERTIES SUFFIX ".wasm")
endif()

add_test(NAME engine COMMAND ${NANOTECH_RUN} $<TARGET_FILE:engine_test>)
add_test(NAME golden
         COMMAND ${CMAKE_COMMAND} "-DRUN=${NANOTECH_RUN}" -DPROGRAM=$<TARGET_FILE:golden>
                 -DEXPECTED=${CMAKE_SOURCE_DIR}/tests/golden.txt -P ${CMAKE_SOURCE_DIR}/tests/compare.cmake)

# SPDX-License-Identifier: GPL-3.0-or-later
# Runs PROGRAM (through RUN, for WebAssembly) and compares what it prints with EXPECTED.
# With -DUPDATE=ON it writes EXPECTED instead, after a change that is meant to make other bytes.
execute_process(COMMAND ${RUN} ${PROGRAM} OUTPUT_VARIABLE got RESULT_VARIABLE status)
if(NOT status EQUAL 0)
  message(FATAL_ERROR "${PROGRAM} failed: ${status}")
endif()
if(UPDATE)
  file(WRITE ${EXPECTED} "${got}")
  return()
endif()
file(READ ${EXPECTED} expected)
string(REPLACE "\r\n" "\n" expected "${expected}")
string(REPLACE "\r\n" "\n" got "${got}")
if(NOT got STREQUAL expected)
  message(FATAL_ERROR "other bytes than tests/golden.txt:\n${got}")
endif()

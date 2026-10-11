#!/bin/sh
# Runs the server test suite; prints the summary line, keeps bun's exit code.
cd "$(dirname "$0")" && bun test "$@" > /tmp/incuscloud-test.log 2>&1
r=$?
grep -E "^ *[0-9]+ (pass|fail)$" /tmp/incuscloud-test.log | tr '\n' ' '
tail -1 /tmp/incuscloud-test.log
exit $r

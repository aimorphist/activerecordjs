#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
export TMPDIR="$PWD/.work/tmp-host"
mkdir -p "$TMPDIR"
trap 'rm -rf .work' EXIT
exec > evidence.log 2>&1
date -u '+RUN %Y-%m-%dT%H:%M:%SZ'
uname -a
clang --version
test "$(uname -s)" = Darwin
test "$(uname -m)" = arm64
mkdir -p .work/runtime
if [ ! -f .work/wasmtime.tar.xz ]; then
  curl -fL --retry 2 'https://github.com/bytecodealliance/wasmtime/releases/download/v38.0.3/wasmtime-v38.0.3-aarch64-macos-c-api.tar.xz' -o .work/wasmtime.tar.xz
fi
if [ ! -f .work/pglite.tar.gz ]; then
  curl -fL --retry 2 'https://raw.githubusercontent.com/electric-sql/pglite-bindings/0d31326a41f7251548103f73e601699b0ebae2fa/16.x/pglite-wasi.tar.gz' -o .work/pglite.tar.gz
fi
shasum -a 256 -c <<'HASHES'
0a189dd112991d1d037960fafdad86c659c76f013a963cf63e52228340651a52  .work/wasmtime.tar.xz
08c0cdd779770316e373f4ad16a20696eb5a0b28cfe981a0dbd0933ef866f3f7  .work/pglite.tar.gz
HASHES
tar -xJf .work/wasmtime.tar.xz -C .work
# Start each reproduction with the same upstream seed cluster, never an old result.
rm -rf .work/runtime
mkdir -p .work/runtime/dev
tar -xzf .work/pglite.tar.gz -C .work/runtime
dd if=/dev/urandom of=.work/runtime/dev/urandom bs=128 count=1 2>/dev/null
sdk="$PWD/.work/wasmtime-v38.0.3-aarch64-macos-c-api"
clang -x c -std=c11 -Wall -Wextra -Werror -g evidence.code -I"$sdk/include" -L"$sdk/lib" -lwasmtime -Wl,-rpath,"$sdk/lib" -o .work/host
file .work/host .work/runtime/tmp/pglite/bin/postgres.wasi
shasum -a 256 .work/runtime/tmp/pglite/bin/postgres.wasi
module="$PWD/.work/runtime/tmp/pglite/bin/postgres.wasi"
root="$PWD/.work/runtime"
.work/host "$module" "$root" write
echo 'WRITE PROCESS EXITED; launching a separate native process with the same preopen'
.work/host "$module" "$root" read
echo 'PASS: placeholder + Bind, rollback, separate-process reopen'

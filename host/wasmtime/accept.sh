#!/bin/bash
# Acceptance for add-wasmtime-process. Run from the repository root:
#   bash host/wasmtime/accept.sh
# Needs arm64 macOS, Apple clang, curl, tar, shasum, and the network or a
# warm cache in host/wasmtime/.work/cache. Does not invoke Node.
# Linux is the same source and is not a result of this command. Power loss is
# not a result of this command.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$here/.work"
cache="$work/cache"
run="$work/run"

test "$(uname -s)" = Darwin || { echo "FAIL: needs macOS"; exit 1; }
test "$(uname -m)" = arm64 || { echo "FAIL: needs arm64"; exit 1; }
for tool in clang curl tar shasum; do
  command -v "$tool" >/dev/null || { echo "FAIL: missing $tool"; exit 1; }
done

# Node must not take part. Any call to node through PATH trips this shim.
rm -rf "$run"
mkdir -p "$cache" "$run/bin" "$run/logs"
cat >"$run/bin/node" <<SHIM
#!/bin/sh
echo invoked >"$run/node-invoked"
exit 97
SHIM
chmod +x "$run/bin/node"
export PATH="$run/bin:$PATH"
trap 'status=$?; jobs -p | xargs kill 2>/dev/null || true; if [ $status -ne 0 ]; then echo "FAIL: accept.sh exited $status; logs kept in $run/logs"; fi' EXIT

sdk_name='wasmtime-v38.0.3-aarch64-macos-c-api'
sdk_tar="$cache/$sdk_name.tar.xz"
pg_tar="$cache/pglite-wasi-0d31326a.tar.gz"
if [ ! -f "$sdk_tar" ]; then
  curl -fL --retry 2 -sS "https://github.com/bytecodealliance/wasmtime/releases/download/v38.0.3/$sdk_name.tar.xz" -o "$sdk_tar.part"
  mv "$sdk_tar.part" "$sdk_tar"
fi
if [ ! -f "$pg_tar" ]; then
  curl -fL --retry 2 -sS 'https://raw.githubusercontent.com/electric-sql/pglite-bindings/0d31326a41f7251548103f73e601699b0ebae2fa/16.x/pglite-wasi.tar.gz' -o "$pg_tar.part"
  mv "$pg_tar.part" "$pg_tar"
fi
shasum -a 256 -c <<HASHES
0a189dd112991d1d037960fafdad86c659c76f013a963cf63e52228340651a52  $sdk_tar
08c0cdd779770316e373f4ad16a20696eb5a0b28cfe981a0dbd0933ef866f3f7  $pg_tar
HASHES

rm -rf "$work/$sdk_name"
tar -xJf "$sdk_tar" -C "$work"
sdk="$work/$sdk_name"

# The seeded cluster from the pinned archive. Every scenario gets a fresh copy.
seed="$run/seed"
mkdir -p "$seed/dev"
tar -xzf "$pg_tar" -C "$seed"
dd if=/dev/urandom of="$seed/dev/urandom" bs=128 count=1 2>/dev/null
module="$seed/tmp/pglite/bin/postgres.wasi"
shasum -a 256 -c <<HASHES
06494174ce71c387898fdc8d246062448a4aeeda3d290a7c347a5d87ba39e53c  $module
HASHES

host="$run/pghost_accept"
clang -x c -std=c11 -Wall -Wextra -Werror -g -O1 -pthread \
  "$here/pghost.c" "$here/accept_test.c" \
  -I"$sdk/include" -L"$sdk/lib" -lwasmtime -Wl,-rpath,"$sdk/lib" -o "$host"
file "$host"

fresh() { # fresh <name>: a private copy of the seeded cluster
  cp -cR "$seed" "$run/$1" 2>/dev/null || cp -R "$seed" "$run/$1"
  echo "$run/$1"
}

step() { # step <log-name> <phase> <dir> [extra...]: one native host process
  local name="$1"; shift
  local log="$run/logs/$name.log"
  echo "== $name: $1"
  if PGHOST_GUEST_LOG="$run/logs/$name.guest.log" "$host" "$@" >"$log" 2>&1; then
    grep -E '^(PASS|  )' "$log" || true
  else
    cat "$log"
    echo "FAIL: $name (guest output in $run/logs/$name.guest.log)"
    exit 1
  fi
}

# Empty directory: refused before a Store, names the missing cluster, unchanged.
empty="$run/empty"
mkdir -p "$empty"
step empty refuse-cluster "$module" "$empty"
test -z "$(ls -A "$empty")" || { echo "FAIL: empty directory was changed"; exit 1; }

# Bound parameter, commit, rollback, then reopen in a new process.
data="$(fresh reopen)"
step write write "$module" "$data"
test ! -e "$data/wasmtime-host.lock" || { echo "FAIL: lock left after clean close"; exit 1; }
step read read "$module" "$data"

# Second process on a held directory: refused, names the lock; the first keeps serving.
rm -f "$run/ready" "$run/go"
PGHOST_GUEST_LOG="$run/logs/hold.guest.log" "$host" hold "$module" "$data" "$run/ready" "$run/go" >"$run/logs/hold.log" 2>&1 &
holder=$!
for _ in $(seq 1 600); do
  [ -e "$run/ready" ] && break
  kill -0 "$holder" 2>/dev/null || { cat "$run/logs/hold.log"; echo "FAIL: first host died"; exit 1; }
  sleep 0.1
done
[ -e "$run/ready" ] || { echo "FAIL: first host never became ready"; exit 1; }
step second refuse-lock "$module" "$data"
touch "$run/go"
if ! wait "$holder"; then cat "$run/logs/hold.log"; echo "FAIL: first host"; exit 1; fi
echo "== hold: first host"
grep -E '^PASS' "$run/logs/hold.log"

# Queue: ninth caller, holder bypass, holder backlog, expiry, autocommit exclusion.
step queue queue "$module" "$(fresh queue)"

# Statement policy, nested transaction, retired tokens.
step guard guard "$module" "$(fresh guard)"

# Fault-injected cleanup failure, then recovery in a new process.
data="$(fresh fault)"
step fault fault "$module" "$data"
step recover recover "$module" "$data"

test ! -e "$run/node-invoked" || { echo "FAIL: node was invoked"; exit 1; }
echo "node invoked: no"
echo "PASS: accept.sh (arm64 macOS; Linux not tested; power loss not tested)"

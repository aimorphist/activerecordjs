/* Acceptance driver for pghost. Each phase is one native host process.
 * argv: phase module.wasi data-dir [extra...]
 * Phases: write read refuse-cluster refuse-lock hold queue guard fault recover
 * Output lines starting with PASS/FAIL are the result; guest output goes to
 * the guest log in $PGHOST_GUEST_LOG when set.
 */
#define _DARWIN_C_SOURCE
#include "pghost.h"

#include <pthread.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

static const char *phase = "?";

static void fail(const char *fmt, ...) {
  va_list ap;
  va_start(ap, fmt);
  printf("FAIL [%s] ", phase);
  vprintf(fmt, ap);
  printf("\n");
  va_end(ap);
  exit(1);
}
#define CHECK(c, ...) do { if (!(c)) fail(__VA_ARGS__); } while (0)

static void pass(const char *what) { printf("PASS [%s] %s\n", phase, what); }

static double now_s(void) {
  struct timespec ts;
  clock_gettime(CLOCK_MONOTONIC, &ts);
  return (double)ts.tv_sec + (double)ts.tv_nsec / 1e9;
}

static void sleep_ms(int ms) {
  struct timespec ts = {ms / 1000, (long)(ms % 1000) * 1000000L};
  nanosleep(&ts, NULL);
}

static pghost *open_host(const char *module, const char *dir) {
  pghost_config cfg = {module, dir, getenv("PGHOST_GUEST_LOG")};
  pghost *h = NULL;
  pghost_error e = {0};
  int rc = pghost_open(&cfg, &h, &e);
  CHECK(rc == PGHOST_OK, "open %s: %s", dir, e.message);
  printf("HOST pid=%d dir=%s stores=%llu\n", (int)getpid(), dir,
         (unsigned long long)pghost_stores_created());
  return h;
}

static pghost_stats stats(pghost *h) {
  pghost_stats s;
  pghost_get_stats(h, &s);
  return s;
}

/* Autocommit statement that must succeed. */
static pghost_result *ok(pghost *h, const char *sql, int n, const char *const *params) {
  pghost_result *r = NULL;
  pghost_error e = {0};
  int rc = pghost_submit(h, sql, n, params, &r, &e);
  CHECK(rc == PGHOST_OK, "submit %s: %s", sql, e.message);
  return r;
}
static pghost_result *ok_tx(pghost *h, uint64_t t, const char *sql, int n, const char *const *params) {
  pghost_result *r = NULL;
  pghost_error e = {0};
  int rc = pghost_submit_tx(h, t, sql, n, params, &r, &e);
  CHECK(rc == PGHOST_OK, "submit(token %llu) %s: %s", (unsigned long long)t, sql, e.message);
  return r;
}
static uint64_t begin(pghost *h) {
  uint64_t t = 0;
  pghost_error e = {0};
  CHECK(pghost_begin(h, &t, &e) == PGHOST_OK, "begin: %s", e.message);
  return t;
}
static void commit(pghost *h, uint64_t t) {
  pghost_error e = {0};
  CHECK(pghost_commit(h, t, &e) == PGHOST_OK, "commit: %s", e.message);
}
static void rollback(pghost *h, uint64_t t) {
  pghost_error e = {0};
  CHECK(pghost_rollback(h, t, &e) == PGHOST_OK, "rollback: %s", e.message);
}

/* Column 0 of every row, joined by '|', for compact assertions. */
static void column0(const pghost_result *r, char *out, size_t n) {
  out[0] = 0;
  for (int i = 0; i < r->nrows; i++) {
    const char *v = r->cells[(size_t)i * (size_t)r->ncols];
    strlcat(out, i ? "|" : "", n);
    strlcat(out, v ? v : "NULL", n);
  }
}
static void expect_rows(pghost_result *r, const char *want, const char *what) {
  char got[2048];
  column0(r, got, sizeof got);
  CHECK(!strcmp(got, want), "%s: rows [%s], want [%s]", what, got, want);
  pghost_result_free(r);
}

static void expect_err(int rc, const pghost_error *e, pghost_code code, const char *needle, const char *what) {
  CHECK(rc == (int)code, "%s: rc=%d want %d (%s)", what, rc, (int)code, e->message);
  CHECK(strstr(e->message, needle) != NULL, "%s: error [%s] does not name '%s'", what, e->message, needle);
  printf("  %s -> %s\n", what, e->message);
}

static void wait_for(pghost *h, int (*pred)(const pghost_stats *, int), int arg, const char *what) {
  double end = now_s() + 20;
  while (now_s() < end) {
    pghost_stats s = stats(h);
    if (pred(&s, arg)) return;
    sleep_ms(1);
  }
  fail("timed out waiting for %s", what);
}
static int p_in_flight(const pghost_stats *s, int a) { (void)a; return s->in_flight; }
static int p_parked(const pghost_stats *s, int a) { return s->parked == a; }
static int p_holder(const pghost_stats *s, int a) { return s->holder_pending == a; }

/* ---------------------------------------------------------- threads */

typedef struct {
  pghost *h;
  int holder;
  uint64_t token;
  const char *sql;
  const char *param;
  int rc;
  pghost_error err;
  pghost_result *res;
  double t0, t1;
  uint64_t seq;
  pthread_t th;
} job;

static void *run_job(void *arg) {
  job *j = arg;
  const char *params[1] = {j->param};
  int n = j->param ? 1 : 0;
  j->t0 = now_s();
  if (j->holder) j->rc = pghost_submit_tx(j->h, j->token, j->sql, n, params, &j->res, &j->err);
  else j->rc = pghost_submit(j->h, j->sql, n, params, &j->res, &j->err);
  j->t1 = now_s();
  j->seq = pghost_thread_last_seq();
  return NULL;
}
static void start(job *j) { CHECK(pthread_create(&j->th, NULL, run_job, j) == 0, "pthread_create"); }
static void join(job *j) { pthread_join(j->th, NULL); }

/* ------------------------------------------------------------ phases */

static const char *VALUE = "committed ' ; -- /* café */";
static const char *ROLLED = "rolled-back ' ; -- café";

static void phase_write(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  pghost_result_free(ok(h, "CREATE TABLE wasmtime_reopen(value text PRIMARY KEY)", 0, NULL));
  const char *sql = "INSERT INTO wasmtime_reopen(value) VALUES ($1) RETURNING value";

  pghost_result *r = ok(h, "SHOW fsync", 0, NULL);
  expect_rows(r, "on", "fsync");
  r = ok(h, "SHOW synchronous_commit", 0, NULL);
  expect_rows(r, "on", "synchronous_commit");

  uint64_t t = begin(h);
  const char *p1[1] = {VALUE};
  r = ok_tx(h, t, sql, 1, p1);
  char stmt[4096];
  pghost_last_statement(h, stmt, sizeof stmt);
  printf("  guest statement text: %s\n  bound value: %s\n", stmt, VALUE);
  CHECK(!strcmp(stmt, sql), "statement text changed: %s", stmt);
  CHECK(strstr(stmt, VALUE) == NULL && strstr(stmt, "café") == NULL, "value leaked into the statement text");
  CHECK(r->txn == 'T', "insert not inside the transaction (status %c)", r->txn);
  expect_rows(r, VALUE, "RETURNING value");
  commit(h, t);
  pass("bound parameter with quote, semicolon, comment marker and café stays out of the SQL text");

  t = begin(h);
  const char *p2[1] = {ROLLED};
  expect_rows(ok_tx(h, t, sql, 1, p2), ROLLED, "second bound insert");
  rollback(h, t);
  char want[256];
  snprintf(want, sizeof want, "%s", VALUE);
  expect_rows(ok(h, "SELECT value FROM wasmtime_reopen ORDER BY value", 0, NULL), want, "after rollback");
  pghost_close(h);
  pass("committed one bound insert and rolled back a second");
}

static void phase_read(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  expect_rows(ok(h, "SELECT value FROM wasmtime_reopen ORDER BY value", 0, NULL), VALUE, "reopen");
  pghost_close(h);
  pass("new process sees the committed row and not the rolled-back row");
}

static void phase_refuse(const char *module, const char *dir, pghost_code want, const char *needle) {
  pghost_config cfg = {module, dir, getenv("PGHOST_GUEST_LOG")};
  pghost *h = NULL;
  pghost_error e = {0};
  int rc = pghost_open(&cfg, &h, &e);
  printf("  open %s -> rc=%d %s\n", dir, rc, e.message);
  CHECK(rc == (int)want, "open rc=%d, want %d", rc, (int)want);
  CHECK(strstr(e.message, needle) != NULL, "error does not name '%s'", needle);
  CHECK(pghost_stores_created() == 0, "a Store was created before the refusal");
  CHECK(h == NULL, "host handle returned on refusal");
  printf("REFUSED stores=0 code=%d\n", rc);
  pass(want == PGHOST_E_LOCKED ? "second process exits without a Store and names the lock"
                               : "empty directory fails before a Store and names the missing cluster");
}

static void phase_hold(const char *module, const char *dir, const char *ready, const char *go) {
  pghost *h = open_host(module, dir);
  FILE *f = fopen(ready, "w");
  CHECK(f != NULL, "cannot write %s", ready);
  fclose(f);
  struct stat st;
  double end = now_s() + 120;
  while (stat(go, &st) != 0) {
    CHECK(now_s() < end, "no go signal");
    sleep_ms(20);
  }
  expect_rows(ok(h, "SELECT 'still serving'", 0, NULL), "still serving", "first host after the refusal");
  pghost_close(h);
  pass("first host kept serving while a second process was refused");
}

/* Calibrates a holder statement that keeps the owner in the guest ~2 s. */
static char slow_sql[128];
static void calibrate(pghost *h) {
  long n = 2000000;
  double t = 0;
  for (int i = 0; i < 6; i++) {
    snprintf(slow_sql, sizeof slow_sql, "SELECT count(*) FROM generate_series(1, %ld)", n);
    double t0 = now_s();
    pghost_result_free(ok(h, slow_sql, 0, NULL));
    t = now_s() - t0;
    if (t >= 0.3) break;
    n *= 4;
  }
  n = (long)((double)n * (2.0 / t));
  snprintf(slow_sql, sizeof slow_sql, "SELECT count(*) FROM generate_series(1, %ld)", n);
  printf("  slow holder statement: %s (calibrated)\n", slow_sql);
}

static void phase_queue(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  pghost_result_free(ok(h, "CREATE TABLE q(value text)", 0, NULL));
  calibrate(h);

  uint64_t t = begin(h);
  /* H1: a long holder call is in the guest. */
  job h1 = {.h = h, .holder = 1, .token = t, .sql = slow_sql};
  start(&h1);
  wait_for(h, p_in_flight, 0, "holder call in flight");

  /* Eight waiters park: the token is live and the owner is busy. */
  job w[PGHOST_QUEUE_CAPACITY];
  char names[PGHOST_QUEUE_CAPACITY][32];
  for (int i = 0; i < PGHOST_QUEUE_CAPACITY; i++) {
    snprintf(names[i], sizeof names[i], "waiter-%d", i);
    w[i] = (job){.h = h, .sql = "INSERT INTO q(value) VALUES ($1)", .param = names[i]};
    start(&w[i]);
  }
  wait_for(h, p_parked, PGHOST_QUEUE_CAPACITY, "8 parked waiters");

  /* The ninth is rejected at once and is not parked. */
  job ninth = {.h = h, .sql = "INSERT INTO q(value) VALUES ($1)", .param = "ninth"};
  start(&ninth); /* another thread: this one holds the token */
  join(&ninth);
  expect_err(ninth.rc, &ninth.err, PGHOST_E_QUEUE_FULL, "queue full", "ninth caller");
  CHECK(ninth.t1 - ninth.t0 < 0.1, "ninth caller blocked %.3f s", ninth.t1 - ninth.t0);
  CHECK(stats(h).parked == PGHOST_QUEUE_CAPACITY, "ninth caller was parked");
  pass("ninth caller rejected at once with an error naming the full queue");

  /* H2: one holder submission waits behind the in-flight call; a third is refused. */
  CHECK(stats(h).in_flight, "slow holder call already finished; calibration too short");
  job h2 = {.h = h, .holder = 1, .token = t, .sql = "INSERT INTO q(value) VALUES ($1)", .param = "holder"};
  start(&h2);
  wait_for(h, p_holder, 1, "holder submission pending");
  job h3 = {.h = h, .holder = 1, .token = t, .sql = "SELECT 1"};
  uint64_t calls = stats(h).guest_calls;
  run_job(&h3);
  expect_err(h3.rc, &h3.err, PGHOST_E_HOLDER_BACKLOG, "holder backlog", "second waiting holder submission");
  CHECK(stats(h).in_flight, "slow holder call finished before the backlog check; calibration too short");
  join(&h1);
  join(&h2);
  CHECK(h1.rc == PGHOST_OK, "slow holder call: %s", h1.err.message);
  CHECK(h2.rc == PGHOST_OK, "holder submission: %s", h2.err.message);
  pghost_result_free(h1.res);
  pghost_result_free(h2.res);
  CHECK(h2.seq == h1.seq + 1, "holder ran at seq %llu, after %llu", (unsigned long long)h2.seq,
        (unsigned long long)h1.seq);
  CHECK(stats(h).guest_calls == calls + 1, "backlog rejection reached the guest");
  CHECK(stats(h).max_in_guest == 1, "two calls entered the guest together");
  CHECK(stats(h).parked == PGHOST_QUEUE_CAPACITY, "waiters left the queue early");
  pass("holder ran next on a full queue, never beside another guest call; backlog of one named");

  /* The parked waiters expire: removed, timed out, never dispatched. */
  calls = stats(h).guest_calls;
  for (int i = 0; i < PGHOST_QUEUE_CAPACITY; i++) {
    join(&w[i]);
    double waited = w[i].t1 - w[i].t0;
    CHECK(w[i].rc == PGHOST_E_TIMEOUT, "waiter %d rc=%d (%s)", i, w[i].rc, w[i].err.message);
    CHECK(strstr(w[i].err.message, "timeout") != NULL, "waiter error does not name the timeout");
    CHECK(waited >= 4.95 && waited < 7.5, "waiter %d waited %.2f s", i, waited);
    if (i == 0) printf("  waiter-0 after %.2f s -> %s\n", waited, w[i].err.message);
  }
  CHECK(stats(h).parked == 0, "expired waiters still parked");
  CHECK(stats(h).guest_calls == calls, "an expired waiter reached the guest");
  pghost_result *r = ok_tx(h, t, "SELECT value FROM q ORDER BY value", 0, NULL);
  CHECK(r->txn == 'T', "holder transaction not open after expiry (status %c)", r->txn);
  expect_rows(r, "holder", "inside the holder transaction after expiry");
  pass("expired waiters removed with a timeout error, never run; holder transaction still open");
  commit(h, t);
  expect_rows(ok(h, "SELECT value FROM q ORDER BY value", 0, NULL), "holder", "after commit");

  /* Autocommit exclusion: a parked autocommit statement waits out the token. */
  t = begin(h);
  pghost_error e = {0};
  int rc = pghost_submit(h, "SELECT 1", 0, NULL, NULL, &e);
  expect_err(rc, &e, PGHOST_E_AUTOCOMMIT_IN_TX, "live token", "autocommit on the holder thread");
  job a = {.h = h, .sql = "INSERT INTO q(value) VALUES ($1)", .param = "autocommit"};
  start(&a);
  wait_for(h, p_parked, 1, "autocommit waiter parked");
  calls = stats(h).guest_calls;
  const char *ph[1] = {"holder-2"};
  pghost_result_free(ok_tx(h, t, "INSERT INTO q(value) VALUES ($1)", 1, ph));
  CHECK(stats(h).parked == 1, "autocommit ran while the token was live");
  uint64_t before_rollback = stats(h).dispatched;
  rollback(h, t);
  join(&a);
  CHECK(a.rc == PGHOST_OK, "autocommit after rollback: %s", a.err.message);
  pghost_result_free(a.res);
  CHECK(a.seq == before_rollback + 2, "autocommit dispatched at %llu, rollback at %llu",
        (unsigned long long)a.seq, (unsigned long long)before_rollback + 1);
  CHECK(stats(h).guest_calls == calls + 3, "unexpected guest calls");
  expect_rows(ok(h, "SELECT value FROM q ORDER BY value", 0, NULL), "autocommit|holder",
              "autocommit kept, rolled-back holder row gone");
  pass("autocommit submit did not run while a token was live");

  pghost_close(h);
}

static void phase_guard(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  pghost_result_free(ok(h, "CREATE TABLE g(value text)", 0, NULL));
  uint64_t t = begin(h);
  const char *p[1] = {"inside"};
  pghost_result_free(ok_tx(h, t, "INSERT INTO g(value) VALUES ($1)", 1, p));

  struct { const char *sql, *needle, *what; } cases[] = {
    {"END", "END", "END"},
    {" -- note\nSTART TRANSACTION", "START", "comment-prefixed START TRANSACTION"},
    {"SELECT 1; SELECT 2", "multiple statements", "two statements in one submit"},
    {"/* a /* nested */ c */ begin", "BEGIN", "block-comment-prefixed begin"},
    {"\n\tcommit;", "COMMIT", "commit with trailing semicolon"},
    {"aBoRt", "ABORT", "mixed-case ABORT"},
    {"rollback", "ROLLBACK", "ROLLBACK"},
    {"SAVEPOINT s1", "SAVEPOINT", "SAVEPOINT"},
    {"INSERT INTO g(value) VALUES ('x'); COMMIT", "multiple statements", "insert then COMMIT"},
    {"SELECT 1; -- trailing", "multiple statements", "comment after the semicolon"},
  };
  uint64_t calls = stats(h).guest_calls;
  for (size_t i = 0; i < sizeof cases / sizeof cases[0]; i++) {
    pghost_error e = {0};
    pghost_result *r = NULL;
    int rc = pghost_submit_tx(h, t, cases[i].sql, 0, NULL, &r, &e);
    expect_err(rc, &e, PGHOST_E_SQL_REJECTED, cases[i].needle, cases[i].what);
    CHECK(r == NULL, "rejected statement returned a result");
  }
  CHECK(stats(h).guest_calls == calls, "a rejected statement reached the guest");
  CHECK(stats(h).token_live, "rejection retired the token");
  pghost_result *r = ok_tx(h, t, "SELECT value FROM g;", 0, NULL);
  CHECK(r->txn == 'T', "transaction changed by a rejection (status %c)", r->txn);
  expect_rows(r, "inside", "transaction after rejections (single trailing semicolon accepted)");
  pass("END, comment-prefixed START TRANSACTION and two statements rejected before dispatch; token and transaction unchanged");

  /* Nested transaction throws. */
  pghost_error e = {0};
  uint64_t t2 = 0;
  calls = stats(h).guest_calls;
  int rc = pghost_begin(h, &t2, &e);
  expect_err(rc, &e, PGHOST_E_NESTED, "nested transaction", "begin inside begin");
  CHECK(stats(h).guest_calls == calls && stats(h).token_live, "nested begin touched the session");
  pass("nested transaction throws");

  rollback(h, t);
  expect_rows(ok(h, "SELECT count(*) FROM g", 0, NULL), "0", "rolled back");

  /* Retired token: commit, rollback, and a late submission. */
  t2 = begin(h);
  commit(h, t2);
  calls = stats(h).guest_calls;
  e = (pghost_error){0};
  rc = pghost_submit_tx(h, t2, "SELECT 1", 0, NULL, NULL, &e);
  expect_err(rc, &e, PGHOST_E_RETIRED_TOKEN, "retired token", "submit with a committed token");
  e = (pghost_error){0};
  rc = pghost_commit(h, t, &e);
  expect_err(rc, &e, PGHOST_E_RETIRED_TOKEN, "retired token", "commit with a rolled-back token");
  e = (pghost_error){0};
  rc = pghost_rollback(h, t2, &e);
  expect_err(rc, &e, PGHOST_E_RETIRED_TOKEN, "retired token", "rollback with a committed token");
  CHECK(stats(h).guest_calls == calls, "a retired token reached the guest");
  pass("retired token rejected before any guest call");

  pghost_close(h);
}

static void phase_fault(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  pghost_result_free(ok(h, "CREATE TABLE f(value text)", 0, NULL));
  const char *pc[1] = {"before-fault"};
  pghost_result_free(ok(h, "INSERT INTO f(value) VALUES ($1)", 1, pc));

  uint64_t t = begin(h);
  const char *pf[1] = {"fault-row"};
  pghost_result_free(ok_tx(h, t, "INSERT INTO f(value) VALUES ($1)", 1, pf));
  job w = {.h = h, .sql = "SELECT 1"};
  start(&w);
  wait_for(h, p_parked, 1, "waiter parked behind the token");

  pghost_inject_cleanup_failure(h, 1);
  pghost_error e = {0};
  int rc = pghost_rollback(h, t, &e);
  expect_err(rc, &e, PGHOST_E_FAILED_CLEANUP, "failed cleanup", "rollback with injected cleanup failure");
  join(&w);
  expect_err(w.rc, &w.err, PGHOST_E_FAILED_CLEANUP, "failed cleanup", "waiter parked during the failure");
  CHECK(stats(h).failed && !stats(h).token_live, "failed cleanup did not close the session");

  uint64_t calls = stats(h).guest_calls;
  e = (pghost_error){0};
  rc = pghost_submit(h, "SELECT 1", 0, NULL, NULL, &e);
  expect_err(rc, &e, PGHOST_E_FAILED_CLEANUP, "failed cleanup", "later autocommit submit");
  uint64_t t2 = 0;
  e = (pghost_error){0};
  rc = pghost_begin(h, &t2, &e);
  expect_err(rc, &e, PGHOST_E_FAILED_CLEANUP, "failed cleanup", "later begin");
  e = (pghost_error){0};
  rc = pghost_submit_tx(h, t, "SELECT 1", 0, NULL, NULL, &e);
  expect_err(rc, &e, PGHOST_E_FAILED_CLEANUP, "failed cleanup", "later submit with the old token");
  CHECK(stats(h).guest_calls == calls, "a guest call started after the failed cleanup");
  pghost_close(h);
  pass("failed cleanup retires the token and refuses every later submission");
}

static void phase_recover(const char *module, const char *dir) {
  pghost *h = open_host(module, dir);
  expect_rows(ok(h, "SELECT value FROM f ORDER BY value", 0, NULL), "before-fault", "after failed cleanup");
  pghost_close(h);
  pass("recovery is a new process; only committed data is present");
}

int main(int argc, char **argv) {
  setvbuf(stdout, NULL, _IOLBF, 0);
  if (argc < 4) {
    fprintf(stderr, "usage: %s phase module.wasi data-dir [extra...]\n", argv[0]);
    return 2;
  }
  phase = argv[1];
  const char *module = argv[2], *dir = argv[3];
  if (!strcmp(phase, "write")) phase_write(module, dir);
  else if (!strcmp(phase, "read")) phase_read(module, dir);
  else if (!strcmp(phase, "refuse-cluster")) phase_refuse(module, dir, PGHOST_E_MISSING_CLUSTER, "missing cluster");
  else if (!strcmp(phase, "refuse-lock")) phase_refuse(module, dir, PGHOST_E_LOCKED, "lock");
  else if (!strcmp(phase, "hold") && argc == 6) phase_hold(module, dir, argv[4], argv[5]);
  else if (!strcmp(phase, "queue")) phase_queue(module, dir);
  else if (!strcmp(phase, "guard")) phase_guard(module, dir);
  else if (!strcmp(phase, "fault")) phase_fault(module, dir);
  else if (!strcmp(phase, "recover")) phase_recover(module, dir);
  else { fprintf(stderr, "unknown phase %s\n", phase); return 2; }
  return 0;
}

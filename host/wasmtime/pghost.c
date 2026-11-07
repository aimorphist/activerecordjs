/* pghost: native Wasmtime host for the pinned WASI Postgres. See pghost.h.
 *
 * The guest is the draft pglite-bindings module named in
 * docs/spikes/wasmtime-reopen/finding.md. Its stubs (overflow and exception
 * handling, IPC, timers, forced lock-file handling) are left as recorded.
 * PostgreSQL is not patched. fsync and synchronous_commit stay at the
 * module defaults.
 */
#define _DARWIN_C_SOURCE
#include "pghost.h"

#include <wasmtime.h>
#include <wasi.h>

#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdarg.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

/* ------------------------------------------------------------------ util */

static atomic_ullong stores_created;
static _Thread_local uint64_t thread_last_seq;

uint64_t pghost_stores_created(void) { return atomic_load(&stores_created); }
uint64_t pghost_thread_last_seq(void) { return thread_last_seq; }

static int set_err(pghost_error *e, pghost_code code, const char *fmt, ...) {
  if (e) {
    e->code = code;
    e->sqlstate[0] = 0;
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(e->message, sizeof e->message, fmt, ap);
    va_end(ap);
  }
  return code;
}

static char *xstrdup(const char *s) {
  char *d = strdup(s ? s : "");
  if (!d) abort();
  return d;
}

static char *path_join(const char *a, const char *b) {
  size_t n = strlen(a) + strlen(b) + 2;
  char *p = malloc(n);
  if (!p) abort();
  snprintf(p, n, "%s/%s", a, b);
  return p;
}

static int is_regular(const char *path) {
  struct stat st;
  return stat(path, &st) == 0 && S_ISREG(st.st_mode);
}

/* -------------------------------------------------------- SQL policy */

/* The whole policy: one statement per submit, and no transaction-control
 * keyword first. It is not a SQL parser. Leading whitespace and leading
 * line or block comments are skipped; a semicolon followed by anything other
 * than whitespace is more than one statement. */
static const char *const tx_keywords[] = {
  "BEGIN", "COMMIT", "ROLLBACK", "SAVEPOINT", "START", "END", "ABORT", NULL,
};

static int is_space(char c) {
  return c == ' ' || c == '\t' || c == '\n' || c == '\r' || c == '\f' || c == '\v';
}
static int is_word(char c) {
  return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
         (c >= '0' && c <= '9') || c == '_' || c == '$';
}

int pghost_check_sql(const char *sql, pghost_error *err) {
  if (!sql) return set_err(err, PGHOST_E_SQL_REJECTED, "rejected SQL: no statement text");
  const char *p = sql;
  for (;;) {
    while (is_space(*p)) p++;
    if (p[0] == '-' && p[1] == '-') {
      while (*p && *p != '\n') p++;
    } else if (p[0] == '/' && p[1] == '*') {
      int depth = 0; /* Postgres block comments nest */
      do {
        if (p[0] == '/' && p[1] == '*') { depth++; p += 2; }
        else if (p[0] == '*' && p[1] == '/') { depth--; p += 2; }
        else if (*p) p++;
        else return set_err(err, PGHOST_E_SQL_REJECTED,
                            "rejected SQL: unterminated block comment");
      } while (depth > 0);
    } else {
      break;
    }
  }
  if (!*p) return set_err(err, PGHOST_E_SQL_REJECTED, "rejected SQL: empty statement");

  const char *semi = strchr(p, ';');
  if (semi) {
    for (const char *q = semi + 1; *q; q++)
      if (!is_space(*q))
        return set_err(err, PGHOST_E_SQL_REJECTED,
                       "rejected SQL: multiple statements (text after ';'); one statement per submit");
  }

  size_t n = 0;
  while (is_word(p[n])) n++;
  for (int i = 0; tx_keywords[i]; i++) {
    if (strlen(tx_keywords[i]) == n && strncasecmp(p, tx_keywords[i], n) == 0)
      return set_err(err, PGHOST_E_SQL_REJECTED,
                     "rejected SQL: transaction control keyword %s; use begin/commit/rollback",
                     tx_keywords[i]);
  }
  return PGHOST_OK;
}

/* ----------------------------------------------------------- buffers */

typedef struct { unsigned char *b; size_t n, cap; } buf_t;

static void buf_put(buf_t *b, const void *p, size_t n) {
  if (b->n + n > b->cap) {
    size_t cap = b->cap ? b->cap : 256;
    while (cap < b->n + n) cap *= 2;
    b->b = realloc(b->b, cap);
    if (!b->b) abort();
    b->cap = cap;
  }
  memcpy(b->b + b->n, p, n);
  b->n += n;
}
static void put_u8(buf_t *b, unsigned v) { unsigned char c = (unsigned char)v; buf_put(b, &c, 1); }
static void put_u16(buf_t *b, unsigned v) { uint16_t x = htons((uint16_t)v); buf_put(b, &x, 2); }
static void put_u32(buf_t *b, uint32_t v) { uint32_t x = htonl(v); buf_put(b, &x, 4); }
static void put_str(buf_t *b, const char *s) { buf_put(b, s, strlen(s) + 1); }
static void put_msg(buf_t *all, char tag, const buf_t *payload) {
  put_u8(all, (unsigned char)tag);
  put_u32(all, (uint32_t)(payload->n + 4));
  if (payload->n) buf_put(all, payload->b, payload->n);
}
static uint32_t be32(const unsigned char *p) { uint32_t v; memcpy(&v, p, 4); return ntohl(v); }
static uint16_t be16(const unsigned char *p) { uint16_t v; memcpy(&v, p, 2); return ntohs(v); }

/* ------------------------------------------------------------- types */

typedef enum { OP_SUBMIT, OP_BEGIN, OP_COMMIT, OP_ROLLBACK } op_kind;
typedef enum { R_PARKED, R_RUNNING, R_DONE } req_state;

typedef struct req {
  op_kind kind;
  int holder;           /* carries the live token; skips the queue */
  uint64_t token;
  const char *sql;
  int nparams;
  const char *const *params;
  pthread_t thread;
  req_state state;
  pthread_cond_t cv;
  int rc;
  pghost_error err;
  pghost_result *res;
  uint64_t out_token;
  uint64_t seq;
} req;

struct pghost {
  pthread_mutex_t mu;
  pthread_cond_t owner_cv;
  pthread_cond_t ready_cv;
  pthread_t owner;

  req *queue[PGHOST_QUEUE_CAPACITY];
  int nq;
  req *holder_slot;
  int busy;

  int has_live;
  uint64_t live_token;
  pthread_t live_thread;
  uint64_t issued;      /* highest token ever issued; tokens start at 1 */

  int failed;
  pghost_error failed_err;
  int closing;
  int started, start_rc;
  pghost_error start_err;

  /* observation */
  uint64_t guest_calls, dispatched;
  int in_guest, max_in_guest;
  char last_statement[4096];
  int fault_cleanup;

  /* configuration */
  char *module_path, *data_dir, *guest_log, *lock_path, *io_path;

  /* owner thread only */
  wasm_engine_t *engine;
  wasmtime_module_t *module;
  wasmtime_store_t *store;
  wasmtime_context_t *ctx;
  wasmtime_linker_t *linker;
  wasmtime_instance_t instance;
};

/* ------------------------------------------------------ guest access */

static const char *const pinned_exports[] = {
  "_start", "pg_initdb", "use_socketfile", "use_wire", "interactive_one", NULL,
};

static int wasm_failure(pghost_error *err, pghost_code code, const char *what,
                        wasmtime_error_t *e, wasm_trap_t *t) {
  wasm_byte_vec_t m = {0};
  if (e) { wasmtime_error_message(e, &m); wasmtime_error_delete(e); }
  else if (t) { wasm_trap_message(t, &m); wasm_trap_delete(t); }
  set_err(err, code, "%s: %.*s", what, (int)m.size, m.size ? m.data : "");
  wasm_byte_vec_delete(&m);
  return code;
}

/* Every entry into the guest goes through here, on the owner thread. */
static int guest_call(pghost *h, const char *name, int nargs, int arg, int *out,
                      pghost_error *err) {
  wasmtime_extern_t x;
  if (!wasmtime_instance_export_get(h->ctx, &h->instance, name, strlen(name), &x) ||
      x.kind != WASMTIME_EXTERN_FUNC)
    return set_err(err, PGHOST_E_MODULE, "guest export %s missing", name);
  wasm_functype_t *ft = wasmtime_func_type(h->ctx, &x.of.func);
  size_t nr = wasm_functype_results(ft)->size;
  size_t np = wasm_functype_params(ft)->size;
  wasm_functype_delete(ft);
  if (nr > 1 || np != (size_t)nargs)
    return set_err(err, PGHOST_E_MODULE, "guest export %s has an unexpected signature", name);

  pthread_mutex_lock(&h->mu);
  if (++h->in_guest > 1) abort(); /* never two entries into one Store */
  if (h->in_guest > h->max_in_guest) h->max_in_guest = h->in_guest;
  pthread_mutex_unlock(&h->mu);

  wasmtime_val_t a = {.kind = WASMTIME_I32, .of.i32 = arg}, r;
  wasm_trap_t *trap = NULL;
  wasmtime_error_t *e = wasmtime_func_call(h->ctx, &x.of.func, &a, (size_t)nargs, &r, nr, &trap);

  pthread_mutex_lock(&h->mu);
  h->in_guest--;
  pthread_mutex_unlock(&h->mu);

  if (e || trap) {
    char what[96];
    snprintf(what, sizeof what, "guest call %s failed", name);
    return wasm_failure(err, PGHOST_E_INTERNAL, what, e, trap);
  }
  if (out) *out = nr ? r.of.i32 : 0;
  return PGHOST_OK;
}

/* One wire round trip over the draft's file socket. */
static int exchange(pghost *h, const buf_t *in, buf_t *out, pghost_error *err) {
  size_t n = strlen(h->io_path) + 16;
  char *path = malloc(n), *lock = malloc(n);
  if (!path || !lock) abort();
  int rc = PGHOST_OK;
  snprintf(path, n, "%s.in", h->io_path);
  snprintf(lock, n, "%s.lock.in", h->io_path);
  FILE *f = fopen(lock, "wb");
  if (!f || fwrite(in->b, 1, in->n, f) != in->n || fclose(f) != 0 || rename(lock, path) != 0) {
    rc = set_err(err, PGHOST_E_INTERNAL, "cannot write guest input %s: %s", path, strerror(errno));
    goto done;
  }
  pthread_mutex_lock(&h->mu);
  h->guest_calls++;
  pthread_mutex_unlock(&h->mu);
  rc = guest_call(h, "interactive_one", 0, 0, NULL, err);
  if (rc) goto done;
  snprintf(path, n, "%s.out", h->io_path);
  f = fopen(path, "rb");
  if (f) {
    unsigned char chunk[16384];
    size_t k;
    while ((k = fread(chunk, 1, sizeof chunk, f)) > 0) buf_put(out, chunk, k);
    int bad = ferror(f);
    fclose(f);
    unlink(path);
    if (bad) rc = set_err(err, PGHOST_E_INTERNAL, "cannot read guest output %s", path);
  }
  snprintf(path, n, "%s.lock.out", h->io_path);
  unlink(path);
done:
  free(path);
  free(lock);
  return rc;
}

/* ------------------------------------------------- protocol messages */

typedef struct {
  pghost_result *res;
  char ready;            /* 0 when no ReadyForQuery arrived */
  int error;
  pghost_error err;
} reply_t;

static void result_reserve_row(pghost_result *r, size_t *cap) {
  size_t need = (size_t)(r->nrows + 1) * (size_t)r->ncols;
  if (need > *cap) {
    size_t c = *cap ? *cap * 2 : 64;
    while (c < need) c *= 2;
    r->cells = realloc(r->cells, c * sizeof *r->cells);
    if (!r->cells) abort();
    *cap = c;
  }
}

static int parse_reply(const buf_t *b, reply_t *rp, pghost_error *err) {
  pghost_result *r = calloc(1, sizeof *r);
  if (!r) abort();
  rp->res = r;
  size_t cells_cap = 0;
  for (size_t at = 0; at < b->n;) {
    if (at + 5 > b->n) return set_err(err, PGHOST_E_INTERNAL, "truncated guest reply");
    unsigned char tag = b->b[at];
    uint32_t len = be32(b->b + at + 1);
    if (len < 4 || at + 1 + len > b->n) return set_err(err, PGHOST_E_INTERNAL, "malformed guest reply");
    const unsigned char *p = b->b + at + 5, *end = p + (len - 4);
    switch (tag) {
    case 'T': { /* RowDescription */
      if (end - p < 2) return set_err(err, PGHOST_E_INTERNAL, "malformed RowDescription");
      int n = be16(p); p += 2;
      for (int i = 0; i < r->ncols; i++) free(r->names[i]);
      free(r->names);
      r->names = calloc((size_t)(n ? n : 1), sizeof *r->names);
      if (!r->names) abort();
      r->ncols = n;
      for (int i = 0; i < n; i++) {
        const unsigned char *z = memchr(p, 0, (size_t)(end - p));
        if (!z || end - (z + 1) < 18) return set_err(err, PGHOST_E_INTERNAL, "malformed RowDescription");
        r->names[i] = xstrdup((const char *)p);
        p = z + 1 + 18;
      }
      break;
    }
    case 'D': { /* DataRow */
      if (end - p < 2) return set_err(err, PGHOST_E_INTERNAL, "malformed DataRow");
      int n = be16(p); p += 2;
      if (r->ncols == 0 && r->nrows == 0) {
        r->ncols = n;
        r->names = calloc((size_t)(n ? n : 1), sizeof *r->names);
        if (!r->names) abort();
        for (int i = 0; i < n; i++) r->names[i] = xstrdup("?column?");
      }
      if (n != r->ncols) return set_err(err, PGHOST_E_INTERNAL, "DataRow width mismatch");
      result_reserve_row(r, &cells_cap);
      for (int i = 0; i < n; i++) {
        if (end - p < 4) return set_err(err, PGHOST_E_INTERNAL, "malformed DataRow");
        int32_t l = (int32_t)be32(p); p += 4;
        char *v = NULL;
        if (l >= 0) {
          if (end - p < l) return set_err(err, PGHOST_E_INTERNAL, "malformed DataRow");
          v = malloc((size_t)l + 1);
          if (!v) abort();
          memcpy(v, p, (size_t)l);
          v[l] = 0;
          p += l;
        }
        r->cells[(size_t)r->nrows * (size_t)r->ncols + (size_t)i] = v;
      }
      r->nrows++;
      break;
    }
    case 'C': /* CommandComplete */
      free(r->command);
      r->command = strndup((const char *)p, (size_t)(end - p));
      break;
    case 'E': { /* ErrorResponse */
      rp->error = 1;
      const char *sev = "", *msg = "", *code = "";
      while (p < end && *p) {
        unsigned char field = *p++;
        const unsigned char *z = memchr(p, 0, (size_t)(end - p));
        if (!z) break;
        if (field == 'S') sev = (const char *)p;
        if (field == 'M') msg = (const char *)p;
        if (field == 'C') code = (const char *)p;
        p = z + 1;
      }
      set_err(&rp->err, PGHOST_E_SQL, "%s: %s (SQLSTATE %s)", sev, msg, code);
      snprintf(rp->err.sqlstate, sizeof rp->err.sqlstate, "%s", code);
      break;
    }
    case 'Z':
      if (end - p != 1) return set_err(err, PGHOST_E_INTERNAL, "malformed ReadyForQuery");
      rp->ready = (char)p[0];
      break;
    default: /* ParseComplete, BindComplete, NoData, notices, parameter status */
      break;
    }
    at += 1 + len;
  }
  r->txn = rp->ready;
  return PGHOST_OK;
}

void pghost_result_free(pghost_result *r) {
  if (!r) return;
  for (int i = 0; i < r->ncols; i++) free(r->names ? r->names[i] : NULL);
  for (size_t i = 0; i < (size_t)r->nrows * (size_t)r->ncols; i++) free(r->cells[i]);
  free(r->names);
  free(r->cells);
  free(r->command);
  free(r);
}

/* Sends one message batch; fills rp. Returns non-zero only when the guest
 * round trip itself failed or the reply had no ReadyForQuery. */
static int round_trip(pghost *h, const buf_t *in, reply_t *rp, pghost_error *err) {
  buf_t out = {0};
  memset(rp, 0, sizeof *rp);
  int rc = exchange(h, in, &out, err);
  if (!rc) rc = parse_reply(&out, rp, err);
  free(out.b);
  if (!rc && !rp->ready)
    rc = set_err(err, PGHOST_E_INTERNAL, "guest reply had no ReadyForQuery");
  return rc;
}

static int simple_query(pghost *h, const char *sql, reply_t *rp, pghost_error *err) {
  buf_t all = {0}, p = {0};
  put_str(&p, sql);
  put_msg(&all, 'Q', &p);
  int rc = round_trip(h, &all, rp, err);
  free(all.b);
  free(p.b);
  return rc;
}

/* Parse + Bind + Describe + Execute + Sync. The statement text holds
 * placeholders only; values travel in Bind as text with unspecified types. */
static int bound_query(pghost *h, const char *sql, int nparams, const char *const *params,
                       reply_t *rp, pghost_error *err) {
  buf_t all = {0}, p = {0};
  put_str(&p, "");
  put_str(&p, sql);
  put_u16(&p, 0);
  put_msg(&all, 'P', &p);

  p.n = 0;
  put_str(&p, "");
  put_str(&p, "");
  put_u16(&p, 0); /* all parameters in text format */
  put_u16(&p, (unsigned)nparams);
  for (int i = 0; i < nparams; i++) {
    if (!params[i]) { put_u32(&p, 0xFFFFFFFFu); continue; }
    size_t l = strlen(params[i]);
    put_u32(&p, (uint32_t)l);
    buf_put(&p, params[i], l);
  }
  put_u16(&p, 0); /* all results in text format */
  put_msg(&all, 'B', &p);

  p.n = 0;
  put_u8(&p, 'P');
  put_str(&p, "");
  put_msg(&all, 'D', &p);

  p.n = 0;
  put_str(&p, "");
  put_u32(&p, 0);
  put_msg(&all, 'E', &p);

  p.n = 0;
  put_msg(&all, 'S', &p);

  pthread_mutex_lock(&h->mu);
  snprintf(h->last_statement, sizeof h->last_statement, "%s", sql);
  pthread_mutex_unlock(&h->mu);

  int rc = round_trip(h, &all, rp, err);
  free(all.b);
  free(p.b);
  return rc;
}

/* ------------------------------------------------------- owner state */

/* Caller holds h->mu. */
static void complete(req *r, int rc) {
  r->rc = rc;
  r->state = R_DONE;
  pthread_cond_signal(&r->cv);
}

/* Caller holds h->mu. The process refuses every later submission. */
static void fail_closed(pghost *h, const pghost_error *why) {
  if (h->failed) return;
  h->failed = 1;
  h->failed_err = *why;
  h->failed_err.code = PGHOST_E_FAILED_CLEANUP;
  h->has_live = 0; /* the token retires with the failed session */
  for (int i = 0; i < h->nq; i++) {
    h->queue[i]->err = h->failed_err;
    complete(h->queue[i], PGHOST_E_FAILED_CLEANUP);
  }
  h->nq = 0;
  if (h->holder_slot) {
    h->holder_slot->err = h->failed_err;
    complete(h->holder_slot, PGHOST_E_FAILED_CLEANUP);
    h->holder_slot = NULL;
  }
}

static void retire(pghost *h) {
  pthread_mutex_lock(&h->mu);
  h->has_live = 0;
  pthread_mutex_unlock(&h->mu);
}

static void owner_fail(pghost *h, const char *fmt, const pghost_error *cause) {
  pghost_error why;
  set_err(&why, PGHOST_E_FAILED_CLEANUP, fmt, cause ? cause->message : "");
  pthread_mutex_lock(&h->mu);
  fail_closed(h, &why);
  pthread_mutex_unlock(&h->mu);
}

/* Runs on the owner thread with h->mu released. */
static int execute(pghost *h, req *r) {
  reply_t rp;
  pghost_error *err = &r->err;
  int rc;
  switch (r->kind) {
  case OP_BEGIN:
    rc = simple_query(h, "BEGIN", &rp, err);
    if (rc) {
      pghost_result_free(rp.res);
      owner_fail(h, "failed cleanup: begin left no known session state (%s); "
                    "this process refuses later submissions; recover with a new process", err);
      *err = h->failed_err;
      return PGHOST_E_FAILED_CLEANUP;
    }
    pghost_result_free(rp.res);
    if (rp.error || rp.ready != 'T') {
      if (rp.ready != 'I') {
        owner_fail(h, "failed cleanup: begin did not leave an idle session%s; "
                      "this process refuses later submissions; recover with a new process", NULL);
        *err = h->failed_err;
        return PGHOST_E_FAILED_CLEANUP;
      }
      *err = rp.err;
      return rp.error ? PGHOST_E_SQL : set_err(err, PGHOST_E_INTERNAL, "BEGIN did not open a transaction");
    }
    pthread_mutex_lock(&h->mu);
    h->has_live = 1;
    h->live_token = ++h->issued;
    h->live_thread = r->thread;
    r->out_token = h->live_token;
    pthread_mutex_unlock(&h->mu);
    return PGHOST_OK;

  case OP_SUBMIT:
    rc = bound_query(h, r->sql, r->nparams, r->params, &rp, err);
    if (rc) {
      pghost_result_free(rp.res);
      if (r->holder) retire(h);
      owner_fail(h, "failed cleanup: guest call did not return a session state (%s); "
                    "this process refuses later submissions; recover with a new process", err);
      *err = h->failed_err;
      return PGHOST_E_FAILED_CLEANUP;
    }
    if (!r->holder && rp.ready != 'I') {
      pghost_result_free(rp.res);
      owner_fail(h, "failed cleanup: autocommit statement did not leave an idle session%s; "
                    "this process refuses later submissions; recover with a new process", NULL);
      *err = h->failed_err;
      return PGHOST_E_FAILED_CLEANUP;
    }
    if (r->holder && rp.ready == 'I') {
      /* The transaction ended without commit or rollback; the session is idle. */
      retire(h);
      if (!rp.error)
        set_err(&rp.err, PGHOST_E_TX_ABORTED, "transaction ended inside the guest; token %llu retired",
                (unsigned long long)r->token);
      rp.error = 1;
    }
    if (rp.error) {
      pghost_result_free(rp.res);
      *err = rp.err;
      return err->code;
    }
    r->res = rp.res;
    return PGHOST_OK;

  case OP_COMMIT:
  case OP_ROLLBACK: {
    int is_commit = r->kind == OP_COMMIT;
    rc = simple_query(h, is_commit ? "COMMIT" : "ROLLBACK", &rp, err);
    retire(h); /* commit, rollback, and failed cleanup all retire the token */
    pthread_mutex_lock(&h->mu);
    int fault = !is_commit && h->fault_cleanup;
    if (fault) h->fault_cleanup = 0;
    pthread_mutex_unlock(&h->mu);
    if (!rc && fault)
      rc = set_err(err, PGHOST_E_INTERNAL, "injected fault: guest rollback did not report an idle session");
    if (!rc && rp.ready != 'I')
      rc = set_err(err, PGHOST_E_INTERNAL, "session status '%c' after %s", rp.ready ? rp.ready : '?',
                   is_commit ? "COMMIT" : "ROLLBACK");
    if (rc) {
      if (rp.res) pghost_result_free(rp.res);
      owner_fail(h, "failed cleanup: transaction cleanup could not leave an idle session (%s); "
                    "this process refuses later submissions; recover with a new process", err);
      *err = h->failed_err;
      return PGHOST_E_FAILED_CLEANUP;
    }
    int aborted = is_commit && rp.res->command && strcmp(rp.res->command, "ROLLBACK") == 0;
    pghost_result_free(rp.res);
    if (rp.error) { *err = rp.err; return PGHOST_E_SQL; }
    if (aborted)
      return set_err(err, PGHOST_E_TX_ABORTED,
                     "commit found an aborted transaction; it was rolled back; token %llu retired",
                     (unsigned long long)r->token);
    return PGHOST_OK;
  }
  }
  return set_err(err, PGHOST_E_INTERNAL, "unknown request");
}

/* Caller holds h->mu. Holder work first, then the queue head when no token
 * is live. Returns NULL when nothing can run. */
static req *pick(pghost *h) {
  if (h->holder_slot) {
    req *r = h->holder_slot;
    h->holder_slot = NULL;
    return r;
  }
  if (!h->has_live && h->nq > 0) {
    req *r = h->queue[0];
    memmove(h->queue, h->queue + 1, (size_t)(h->nq - 1) * sizeof *h->queue);
    h->nq--;
    return r;
  }
  return NULL;
}

static int start_guest(pghost *h, pghost_error *err) {
  FILE *f = fopen(h->module_path, "rb");
  if (!f) return set_err(err, PGHOST_E_MODULE, "cannot open module %s: %s", h->module_path, strerror(errno));
  fseek(f, 0, SEEK_END);
  long size = ftell(f);
  rewind(f);
  unsigned char *wasm = size > 0 ? malloc((size_t)size) : NULL;
  if (!wasm || fread(wasm, 1, (size_t)size, f) != (size_t)size) {
    fclose(f);
    free(wasm);
    return set_err(err, PGHOST_E_MODULE, "cannot read module %s", h->module_path);
  }
  fclose(f);
  h->engine = wasm_engine_new();
  wasmtime_error_t *e = wasmtime_module_new(h->engine, wasm, (size_t)size, &h->module);
  free(wasm);
  if (e) return wasm_failure(err, PGHOST_E_MODULE, "module compile failed", e, NULL);

  /* Refuse a module whose exports differ from the pinned artifact. */
  wasm_exporttype_vec_t exports;
  wasmtime_module_exports(h->module, &exports);
  for (int i = 0; pinned_exports[i]; i++) {
    int found = 0;
    for (size_t j = 0; j < exports.size && !found; j++) {
      const wasm_name_t *n = wasm_exporttype_name(exports.data[j]);
      found = n->size == strlen(pinned_exports[i]) && !memcmp(n->data, pinned_exports[i], n->size);
    }
    if (!found) {
      wasm_exporttype_vec_delete(&exports);
      return set_err(err, PGHOST_E_MODULE, "module lacks pinned export %s", pinned_exports[i]);
    }
  }
  wasm_exporttype_vec_delete(&exports);

  h->store = wasmtime_store_new(h->engine, NULL, NULL);
  atomic_fetch_add(&stores_created, 1);
  h->ctx = wasmtime_store_context(h->store);

  wasi_config_t *w = wasi_config_new();
  if (h->guest_log) {
    if (!wasi_config_set_stdout_file(w, h->guest_log) || !wasi_config_set_stderr_file(w, h->guest_log)) {
      wasi_config_delete(w);
      return set_err(err, PGHOST_E_INTERNAL, "cannot open guest log %s", h->guest_log);
    }
  } else {
    wasi_config_inherit_stdout(w);
    wasi_config_inherit_stderr(w);
  }
  const char *args[] = {"/tmp/pglite/bin/postgres.wasi", "--single", "postgres"};
  const char *keys[] = {"ENVIRONMENT", "PREFIX", "PGDATA", "PGSYSCONFDIR", "PGUSER", "PGDATABASE",
                        "MODE", "REPL", "TZ", "PGTZ", "PATH"};
  const char *vals[] = {"wasi-embed", "/tmp/pglite", "/tmp/pglite/base", "/tmp/pglite", "postgres",
                        "template1", "REACT", "N", "UTC", "UTC", "/tmp/pglite/bin"};
  if (!wasi_config_set_argv(w, 3, args) || !wasi_config_set_env(w, 11, keys, vals) ||
      !wasi_config_preopen_dir(w, h->data_dir, "/", WASMTIME_WASI_DIR_PERMS_READ | WASMTIME_WASI_DIR_PERMS_WRITE,
                               WASMTIME_WASI_FILE_PERMS_READ | WASMTIME_WASI_FILE_PERMS_WRITE)) {
    wasi_config_delete(w);
    return set_err(err, PGHOST_E_INTERNAL, "cannot configure WASI for %s", h->data_dir);
  }
  e = wasmtime_context_set_wasi(h->ctx, w);
  if (e) return wasm_failure(err, PGHOST_E_INTERNAL, "WASI setup failed", e, NULL);
  h->linker = wasmtime_linker_new(h->engine);
  e = wasmtime_linker_define_wasi(h->linker);
  if (e) return wasm_failure(err, PGHOST_E_INTERNAL, "WASI link failed", e, NULL);
  wasm_trap_t *trap = NULL;
  e = wasmtime_linker_instantiate(h->linker, h->ctx, h->module, &h->instance, &trap);
  if (e || trap) return wasm_failure(err, PGHOST_E_INTERNAL, "instantiate failed", e, trap);

  /* pg_initdb opens the seeded cluster; the empty-directory check in
   * pghost_open guarantees it never initializes over missing data. */
  int rc;
  if ((rc = guest_call(h, "_start", 0, 0, NULL, err))) return rc;
  if ((rc = guest_call(h, "pg_initdb", 0, 0, NULL, err))) return rc;
  if ((rc = guest_call(h, "use_socketfile", 0, 0, NULL, err))) return rc;
  if ((rc = guest_call(h, "use_wire", 1, 1, NULL, err))) return rc;

  reply_t rp;
  if ((rc = simple_query(h, "SELECT current_database()", &rp, err))) return rc;
  int ok = !rp.error && rp.ready == 'I' && rp.res->nrows == 1 && rp.res->cells[0] &&
           !strcmp(rp.res->cells[0], "template1");
  pghost_result_free(rp.res);
  if (!ok) return set_err(err, PGHOST_E_INTERNAL, "guest did not open template1 idle");
  return PGHOST_OK;
}

static void stop_guest(pghost *h) {
  if (h->store) wasmtime_store_delete(h->store);
  if (h->linker) wasmtime_linker_delete(h->linker);
  if (h->module) wasmtime_module_delete(h->module);
  if (h->engine) wasm_engine_delete(h->engine);
  h->store = NULL; h->linker = NULL; h->module = NULL; h->engine = NULL;
}

static void *owner_main(void *arg) {
  pghost *h = arg;
  pghost_error err = {0};
  int rc = start_guest(h, &err);
  pthread_mutex_lock(&h->mu);
  h->started = 1;
  h->start_rc = rc;
  h->start_err = err;
  pthread_cond_broadcast(&h->ready_cv);
  if (rc) {
    pthread_mutex_unlock(&h->mu);
    stop_guest(h);
    return NULL;
  }
  h->guest_calls = 0;
  for (;;) {
    req *r = h->closing ? NULL : pick(h);
    if (!r) {
      if (h->closing) break;
      pthread_cond_wait(&h->owner_cv, &h->mu);
      continue;
    }
    if (h->failed) { r->err = h->failed_err; complete(r, PGHOST_E_FAILED_CLEANUP); continue; }
    if (r->holder && (!h->has_live || h->live_token != r->token)) {
      /* Retired while this submission waited: reject before any guest call. */
      set_err(&r->err, PGHOST_E_RETIRED_TOKEN, "retired token %llu: transaction already ended",
              (unsigned long long)r->token);
      complete(r, PGHOST_E_RETIRED_TOKEN);
      continue;
    }
    r->state = R_RUNNING;
    h->busy = 1;
    pthread_mutex_unlock(&h->mu);
    int code = execute(h, r);
    pthread_mutex_lock(&h->mu);
    h->busy = 0;
    r->seq = ++h->dispatched;
    complete(r, code);
  }
  pthread_mutex_unlock(&h->mu);
  stop_guest(h);
  return NULL;
}

/* ------------------------------------------------------------ public */

int pghost_open(const pghost_config *cfg, pghost **out, pghost_error *err) {
  *out = NULL;
  if (!cfg || !cfg->module_path || !cfg->data_dir)
    return set_err(err, PGHOST_E_INTERNAL, "module_path and data_dir are required");

  /* 1. The seeded cluster must already be there. Nothing is written yet. */
  char *base = path_join(cfg->data_dir, "tmp/pglite/base");
  char *ver = path_join(base, "PG_VERSION"), *ctl = path_join(base, "global/pg_control");
  int seeded = is_regular(ver) && is_regular(ctl);
  free(ver);
  free(ctl);
  if (!seeded) {
    set_err(err, PGHOST_E_MISSING_CLUSTER,
            "missing cluster: %s has no seeded PostgreSQL cluster (PG_VERSION, global/pg_control); "
            "the host does not run initdb; extract the pinned pglite-wasi archive there first", base);
    free(base);
    return PGHOST_E_MISSING_CLUSTER;
  }

  /* 2. One owner per directory. A present lock is never stolen. */
  char *lock = path_join(cfg->data_dir, PGHOST_LOCK_NAME);
  int fd = open(lock, O_WRONLY | O_CREAT | O_EXCL, 0644);
  if (fd < 0) {
    int en = errno;
    if (en == EEXIST)
      set_err(err, PGHOST_E_LOCKED,
              "lock present: %s; another host owns this directory or one crashed; "
              "the host does not steal a lock; remove it only when no host is running", lock);
    else
      set_err(err, PGHOST_E_LOCKED, "cannot create lock %s: %s", lock, strerror(en));
    free(lock);
    free(base);
    return PGHOST_E_LOCKED;
  }
  dprintf(fd, "%d\n", (int)getpid());
  close(fd);

  /* The guest reads /dev/urandom from the preopen; seed it if absent. */
  char *dev = path_join(cfg->data_dir, "dev"), *urandom = path_join(cfg->data_dir, "dev/urandom");
  if (!is_regular(urandom)) {
    mkdir(dev, 0755);
    FILE *f = fopen(urandom, "wb");
    if (f) {
      unsigned char seed[128];
      arc4random_buf(seed, sizeof seed);
      fwrite(seed, 1, sizeof seed, f);
      fclose(f);
    }
  }
  free(dev);
  free(urandom);

  pghost *h = calloc(1, sizeof *h);
  if (!h) abort();
  pthread_mutex_init(&h->mu, NULL);
  pthread_cond_init(&h->owner_cv, NULL);
  pthread_cond_init(&h->ready_cv, NULL);
  h->module_path = xstrdup(cfg->module_path);
  h->data_dir = xstrdup(cfg->data_dir);
  h->guest_log = cfg->guest_log ? xstrdup(cfg->guest_log) : NULL;
  h->lock_path = lock;
  h->io_path = path_join(base, ".s.PGSQL.5432");
  free(base);

  /* 3. The owner thread creates the only Store. Wasm runs on its stack. */
  pthread_attr_t attr;
  pthread_attr_init(&attr);
  pthread_attr_setstacksize(&attr, (size_t)64 << 20);
  int prc = pthread_create(&h->owner, &attr, owner_main, h);
  pthread_attr_destroy(&attr);
  if (prc) {
    unlink(h->lock_path);
    set_err(err, PGHOST_E_INTERNAL, "cannot start owner thread: %s", strerror(prc));
    free(h->module_path); free(h->data_dir); free(h->guest_log); free(h->lock_path); free(h->io_path);
    free(h);
    return PGHOST_E_INTERNAL;
  }
  pthread_mutex_lock(&h->mu);
  while (!h->started) pthread_cond_wait(&h->ready_cv, &h->mu);
  int rc = h->start_rc;
  if (rc && err) *err = h->start_err;
  pthread_mutex_unlock(&h->mu);
  if (rc) {
    pthread_join(h->owner, NULL);
    unlink(h->lock_path);
    free(h->module_path); free(h->data_dir); free(h->guest_log); free(h->lock_path); free(h->io_path);
    free(h);
    return rc;
  }
  *out = h;
  return PGHOST_OK;
}

static void deadline_in(struct timespec *ts, int ms) {
  clock_gettime(CLOCK_REALTIME, ts);
  ts->tv_sec += ms / 1000;
  ts->tv_nsec += (long)(ms % 1000) * 1000000L;
  if (ts->tv_nsec >= 1000000000L) { ts->tv_sec++; ts->tv_nsec -= 1000000000L; }
}

static void req_init(req *r, op_kind kind) {
  memset(r, 0, sizeof *r);
  r->kind = kind;
  r->thread = pthread_self();
  r->state = R_PARKED;
  pthread_cond_init(&r->cv, NULL);
}

/* Caller holds h->mu. */
static int refused(pghost *h, pghost_error *err) {
  if (h->failed) { if (err) *err = h->failed_err; return PGHOST_E_FAILED_CLEANUP; }
  if (h->closing) return set_err(err, PGHOST_E_CLOSED, "host is closing");
  return PGHOST_OK;
}

static int finish(req *r, pghost_result **res, pghost_error *err) {
  if (r->rc && err) *err = r->err;
  if (res) *res = r->res;
  else pghost_result_free(r->res);
  thread_last_seq = r->seq;
  pthread_cond_destroy(&r->cv);
  return r->rc;
}

/* Waiter path: autocommit submit and begin. */
static int park(pghost *h, req *r, pghost_result **res, pghost_error *err) {
  pthread_mutex_lock(&h->mu);
  int rc = refused(h, err);
  if (!rc && h->has_live && pthread_equal(h->live_thread, r->thread)) {
    if (r->kind == OP_BEGIN)
      rc = set_err(err, PGHOST_E_NESTED, "nested transaction: this thread already holds live token %llu",
                   (unsigned long long)h->live_token);
    else
      rc = set_err(err, PGHOST_E_AUTOCOMMIT_IN_TX,
                   "autocommit submit while this thread holds live token %llu; pass the token",
                   (unsigned long long)h->live_token);
  }
  if (!rc && h->nq >= PGHOST_QUEUE_CAPACITY)
    rc = set_err(err, PGHOST_E_QUEUE_FULL, "queue full: %d callers already parked; not parked",
                 PGHOST_QUEUE_CAPACITY);
  if (rc) {
    pthread_mutex_unlock(&h->mu);
    pthread_cond_destroy(&r->cv);
    return rc;
  }
  struct timespec deadline;
  deadline_in(&deadline, PGHOST_QUEUE_DEADLINE_MS); /* starts on entering the queue */
  h->queue[h->nq++] = r;
  pthread_cond_signal(&h->owner_cv);
  while (r->state != R_DONE) {
    if (r->state == R_PARKED) {
      int w = pthread_cond_timedwait(&r->cv, &h->mu, &deadline);
      if (w == ETIMEDOUT && r->state == R_PARKED) {
        for (int i = 0; i < h->nq; i++) {
          if (h->queue[i] != r) continue;
          memmove(h->queue + i, h->queue + i + 1, (size_t)(h->nq - i - 1) * sizeof *h->queue);
          h->nq--;
          break;
        }
        set_err(&r->err, PGHOST_E_TIMEOUT,
                "queue timeout: waited %d ms without dispatch; removed from the queue; not run",
                PGHOST_QUEUE_DEADLINE_MS);
        r->rc = PGHOST_E_TIMEOUT;
        r->state = R_DONE;
      }
    } else {
      pthread_cond_wait(&r->cv, &h->mu); /* dispatched: the deadline no longer applies */
    }
  }
  pthread_mutex_unlock(&h->mu);
  return finish(r, res, err);
}

/* Holder path: submit_tx, commit, rollback. */
static int hold(pghost *h, req *r, pghost_result **res, pghost_error *err) {
  pthread_mutex_lock(&h->mu);
  int rc = refused(h, err);
  if (!rc && (!h->has_live || h->live_token != r->token)) {
    if (r->token >= 1 && r->token <= h->issued)
      rc = set_err(err, PGHOST_E_RETIRED_TOKEN, "retired token %llu: transaction already ended",
                   (unsigned long long)r->token);
    else
      rc = set_err(err, PGHOST_E_UNKNOWN_TOKEN, "unknown token %llu", (unsigned long long)r->token);
  }
  if (!rc && h->holder_slot)
    rc = set_err(err, PGHOST_E_HOLDER_BACKLOG,
                 "holder backlog: one submission for token %llu already waits behind the guest call",
                 (unsigned long long)r->token);
  if (rc) {
    pthread_mutex_unlock(&h->mu);
    pthread_cond_destroy(&r->cv);
    return rc;
  }
  h->holder_slot = r;
  pthread_cond_signal(&h->owner_cv);
  while (r->state != R_DONE) pthread_cond_wait(&r->cv, &h->mu);
  pthread_mutex_unlock(&h->mu);
  return finish(r, res, err);
}

int pghost_submit(pghost *h, const char *sql, int nparams, const char *const *params,
                  pghost_result **res, pghost_error *err) {
  if (res) *res = NULL;
  int rc = pghost_check_sql(sql, err);
  if (rc) return rc;
  req r;
  req_init(&r, OP_SUBMIT);
  r.sql = sql;
  r.nparams = nparams;
  r.params = params;
  return park(h, &r, res, err);
}

int pghost_begin(pghost *h, uint64_t *token, pghost_error *err) {
  req r;
  req_init(&r, OP_BEGIN);
  int rc = park(h, &r, NULL, err);
  if (!rc && token) *token = r.out_token;
  return rc;
}

int pghost_submit_tx(pghost *h, uint64_t token, const char *sql, int nparams,
                     const char *const *params, pghost_result **res, pghost_error *err) {
  if (res) *res = NULL;
  /* Policy check first: a rejection leaves the token and transaction as they were. */
  pthread_mutex_lock(&h->mu);
  int rc = refused(h, err);
  pthread_mutex_unlock(&h->mu);
  if (rc) return rc;
  if ((rc = pghost_check_sql(sql, err))) return rc;
  req r;
  req_init(&r, OP_SUBMIT);
  r.holder = 1;
  r.token = token;
  r.sql = sql;
  r.nparams = nparams;
  r.params = params;
  return hold(h, &r, res, err);
}

int pghost_commit(pghost *h, uint64_t token, pghost_error *err) {
  req r;
  req_init(&r, OP_COMMIT);
  r.holder = 1;
  r.token = token;
  return hold(h, &r, NULL, err);
}

int pghost_rollback(pghost *h, uint64_t token, pghost_error *err) {
  req r;
  req_init(&r, OP_ROLLBACK);
  r.holder = 1;
  r.token = token;
  return hold(h, &r, NULL, err);
}

void pghost_close(pghost *h) {
  if (!h) return;
  pthread_mutex_lock(&h->mu);
  h->closing = 1;
  for (int i = 0; i < h->nq; i++) {
    set_err(&h->queue[i]->err, PGHOST_E_CLOSED, "host is closing");
    complete(h->queue[i], PGHOST_E_CLOSED);
  }
  h->nq = 0;
  if (h->holder_slot) {
    set_err(&h->holder_slot->err, PGHOST_E_CLOSED, "host is closing");
    complete(h->holder_slot, PGHOST_E_CLOSED);
    h->holder_slot = NULL;
  }
  pthread_cond_signal(&h->owner_cv);
  pthread_mutex_unlock(&h->mu);
  pthread_join(h->owner, NULL);
  unlink(h->lock_path);
  pthread_mutex_destroy(&h->mu);
  pthread_cond_destroy(&h->owner_cv);
  pthread_cond_destroy(&h->ready_cv);
  free(h->module_path); free(h->data_dir); free(h->guest_log); free(h->lock_path); free(h->io_path);
  free(h);
}

void pghost_get_stats(pghost *h, pghost_stats *s) {
  pthread_mutex_lock(&h->mu);
  s->guest_calls = h->guest_calls;
  s->dispatched = h->dispatched;
  s->parked = h->nq;
  s->holder_pending = h->holder_slot != NULL;
  s->in_flight = h->busy;
  s->max_in_guest = h->max_in_guest;
  s->token_live = h->has_live;
  s->failed = h->failed;
  pthread_mutex_unlock(&h->mu);
}

void pghost_last_statement(pghost *h, char *buf, size_t n) {
  pthread_mutex_lock(&h->mu);
  snprintf(buf, n, "%s", h->last_statement);
  pthread_mutex_unlock(&h->mu);
}

void pghost_inject_cleanup_failure(pghost *h, int armed) {
  pthread_mutex_lock(&h->mu);
  h->fault_cleanup = armed;
  pthread_mutex_unlock(&h->mu);
}

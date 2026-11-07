/* pghost: native Wasmtime host for one WASI Postgres.
 *
 * Contract: openspec/changes/add-wasmtime-process/specs/wasmtime-process/spec.md
 * Evidence: docs/spikes/wasmtime-reopen/finding.md
 *
 * One owner thread owns the only wasmtime Store and the only guest instance.
 * Callers on any other thread use the in-process operations below. SQL text and
 * parameter values cross separately: values travel in a Postgres Bind message,
 * never in the statement text. There is no network listener and no Node.
 */
#ifndef PGHOST_H
#define PGHOST_H

#include <stddef.h>
#include <stdint.h>

#define PGHOST_QUEUE_CAPACITY 8   /* parked waiters, not a hint */
#define PGHOST_QUEUE_DEADLINE_MS 5000 /* bounds the wait in the queue only */
#define PGHOST_LOCK_NAME "wasmtime-host.lock"

typedef enum {
  PGHOST_OK = 0,
  PGHOST_E_MISSING_CLUSTER,  /* directory has no seeded cluster; no Store created */
  PGHOST_E_LOCKED,           /* directory lock present; no Store created */
  PGHOST_E_MODULE,           /* module unreadable or missing a pinned export */
  PGHOST_E_QUEUE_FULL,       /* 8 waiters already parked; caller not parked */
  PGHOST_E_TIMEOUT,          /* waited 5 s in the queue; never dispatched */
  PGHOST_E_HOLDER_BACKLOG,   /* one holder submission already waiting */
  PGHOST_E_RETIRED_TOKEN,    /* token was retired; rejected before any guest call */
  PGHOST_E_UNKNOWN_TOKEN,    /* token was never issued */
  PGHOST_E_NESTED,           /* begin() from the thread that holds the live token */
  PGHOST_E_AUTOCOMMIT_IN_TX, /* autocommit submit from the thread holding the token */
  PGHOST_E_SQL_REJECTED,     /* statement policy rejected the text before dispatch */
  PGHOST_E_SQL,              /* Postgres ErrorResponse */
  PGHOST_E_TX_ABORTED,       /* commit found an aborted transaction; rolled back */
  PGHOST_E_FAILED_CLEANUP,   /* session could not be left idle; process refuses work */
  PGHOST_E_CLOSED,           /* host is closing */
  PGHOST_E_INTERNAL          /* host-side resource or startup failure */
} pghost_code;

typedef struct {
  pghost_code code;
  char sqlstate[6];
  char message[640];
} pghost_error;

typedef struct {
  int ncols;
  int nrows;
  char **names;     /* ncols column names (from RowDescription) */
  char **cells;     /* nrows * ncols text values, row-major; NULL is SQL NULL */
  char *command;    /* CommandComplete tag, e.g. "INSERT 0 1" */
  char txn;         /* ReadyForQuery status after the call: 'I', 'T', or 'E' */
} pghost_result;

typedef struct {
  const char *module_path; /* the pinned postgres.wasi */
  const char *data_dir;    /* seeded cluster root; preopened as "/" */
  const char *guest_log;   /* guest stdout+stderr file, or NULL to inherit */
} pghost_config;

typedef struct pghost pghost;

/* Checks the cluster, takes the lock, then starts the owner thread and its
 * Store. Fails before any Store when the cluster is missing or the lock is
 * present. Blocks until the guest is ready or startup failed. */
int pghost_open(const pghost_config *cfg, pghost **out, pghost_error *err);

/* Autocommit: one statement, parked on the queue, not run while a token is live. */
int pghost_submit(pghost *h, const char *sql, int nparams,
                  const char *const *params, pghost_result **res, pghost_error *err);

/* Parks on the queue; dispatched only when no token is live and the session is
 * idle. Returns a fresh token. Throws (PGHOST_E_NESTED) on the holder thread. */
int pghost_begin(pghost *h, uint64_t *token, pghost_error *err);

/* Holder work. Skips the queue; runs after the in-flight guest call returns. */
int pghost_submit_tx(pghost *h, uint64_t token, const char *sql, int nparams,
                     const char *const *params, pghost_result **res, pghost_error *err);
int pghost_commit(pghost *h, uint64_t token, pghost_error *err);
int pghost_rollback(pghost *h, uint64_t token, pghost_error *err);

/* Fails parked callers, waits for the in-flight call, deletes the Store, and
 * removes the lock this process created. */
void pghost_close(pghost *h);
void pghost_result_free(pghost_result *r);

/* Statement policy, exposed for tests. Returns PGHOST_OK or PGHOST_E_SQL_REJECTED. */
int pghost_check_sql(const char *sql, pghost_error *err);

/* ---- observation and fault injection (acceptance only) ---- */
typedef struct {
  uint64_t guest_calls;     /* interactive_one calls since start-up finished */
  uint64_t dispatched;      /* requests completed by the owner, in order */
  int parked;               /* waiters in the queue */
  int holder_pending;       /* holder submission waiting behind the owner */
  int in_flight;            /* owner is executing a request */
  int max_in_guest;         /* highest number of concurrent guest entries seen */
  int token_live;
  int failed;
} pghost_stats;

void pghost_get_stats(pghost *h, pghost_stats *s);
/* Copies the statement text of the last Parse sent to the guest. */
void pghost_last_statement(pghost *h, char *buf, size_t n);
/* When armed, the next rollback reports that guest cleanup failed. */
void pghost_inject_cleanup_failure(pghost *h, int armed);
/* Stores created by this process (0 proves a refusal happened before a Store). */
uint64_t pghost_stores_created(void);
/* Dispatch sequence number of the request most recently completed on this thread. */
uint64_t pghost_thread_last_seq(void);

#endif

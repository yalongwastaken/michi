// queue.js — serialize async writes so two quick edits can never overlap or race the
// server's optimistic-concurrency rev into a conflict. `enqueue(job)` runs `job` only
// after every previously-enqueued job has settled, and resolves to the job's result.
// `onBusyChange(bool)` fires when the in-flight count crosses 0↔1, for a global spinner.
export function createQueue(onBusyChange = () => {}) {
  let tail = Promise.resolve();
  let pending = 0;

  return function enqueue(job) {
    if (pending === 0) {
      onBusyChange(true);
    }
    pending += 1;

    // run `job` whether the previous one fulfilled or rejected, so one failure can't
    // wedge the chain; callers still see this job's own result/rejection via `run`.
    const run = tail.then(job, job);
    tail = run.then(
      () => {},
      () => {},
    );
    tail.finally(() => {
      pending -= 1;
      if (pending <= 0) {
        pending = 0;
        onBusyChange(false);
      }
    });
    return run;
  };
}

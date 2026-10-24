// Runs every state-changing action one at a time. Two phones tapping at once, or the admin
// double-tapping "next", can no longer read the same state and both write over it.
let tail: Promise<unknown> = Promise.resolve();

export const runExclusive = <T>(task: () => Promise<T>): Promise<T> => {
    const result = tail.then(task);
    // The chain continues whether this task failed or not
    tail = result.catch(() => undefined);
    return result;
};

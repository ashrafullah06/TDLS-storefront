// FILE: src/lib/timed-fetch.js

export async function timedFetch(
  url,
  init = {},
  timeoutMs = 35000
) {
  const controller = new AbortController();
  const externalSignal = init.signal;

  const abort = () => controller.abort();

  if (externalSignal?.aborted) {
    abort();
  } else {
    externalSignal?.addEventListener(
      "abort",
      abort,
      { once: true }
    );
  }

  const timer = setTimeout(
    abort,
    Math.max(1, timeoutMs)
  );

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    // Keep the timeout active until the response body
    // has finished downloading.
    const body = await response.arrayBuffer();

    return new Response(
      [204, 205, 304].includes(response.status)
        ? null
        : body,
      {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers,
      }
    );
  } finally {
    clearTimeout(timer);

    externalSignal?.removeEventListener(
      "abort",
      abort
    );
  }
}

// Bounds an optional database wait.
// It does not cancel the database query itself.
export async function waitWithin(
  promise,
  timeoutMs
) {
  let timer;

  try {
    return await Promise.race([
      promise,

      new Promise((_, reject) => {
        timer = setTimeout(
          () => {
            reject(
              new Error(
                "Optional data deadline exceeded"
              )
            );
          },
          Math.max(1, timeoutMs)
        );
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
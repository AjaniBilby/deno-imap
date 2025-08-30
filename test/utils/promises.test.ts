import { assertEquals, assertRejects } from '@std/assert';

import { CreateCancellablePromise } from '../../src/utils/promises.ts';
import { ImapTimeoutError } from '../../src/errors.ts';

Deno.test('CreateCancellablePromise - resolves with the result', async () => {
  const expected = 'test result';
  const cancellable = CreateCancellablePromise(
    async () => expected,
    1000,
    'Test timeout',
  );

  const result = await cancellable.promise;
  assertEquals(result, expected);
});

Deno.test('CreateCancellablePromise - rejects with the error from the promise', async () => {
  const expectedError = new Error('test error');
  const cancellable = CreateCancellablePromise<string>(
    async () => {
      throw expectedError;
    },
    1000,
    'Test timeout',
  );

  await assertRejects(
    () => cancellable.promise,
    Error,
    expectedError.message,
  );
});

Deno.test('CreateCancellablePromise - times out if promise takes too long', async () => {
  const timeoutMs = 100;
  let resolver: (() => void) | undefined;

  const cancellable = CreateCancellablePromise<string>(
    async () => {
      // Create a promise that we can resolve manually
      await new Promise<void>((resolve) => {
        resolver = resolve;
      });
      return 'should not resolve';
    },
    timeoutMs,
    'Test timeout',
  );

  try {
    await assertRejects(
      () => cancellable.promise,
      ImapTimeoutError,
    );
  } finally {
    // Resolve the inner promise to avoid leaking it
    if (resolver) resolver();
  }
});

Deno.test('CreateCancellablePromise - can be cancelled', async () => {
  let resolver: (() => void) | undefined;

  const cancellable = CreateCancellablePromise<string>(
    async () => {
      // Create a promise that we can resolve manually
      await new Promise<void>((resolve) => {
        resolver = resolve;
      });
      return 'should not resolve';
    },
    2000,
    'Test timeout',
  );

  // Cancel the promise
  cancellable.cancel('Cancelled for testing');

  try {
    await assertRejects(
      () => cancellable.promise,
      Error,
      'Cancelled for testing',
    );
  } finally {
    // Resolve the inner promise to avoid leaking it
    if (resolver) resolver();
  }
});

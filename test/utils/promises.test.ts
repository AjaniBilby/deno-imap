import { assertEquals, assertRejects } from '@std/assert';

import { CreateCancellablePromise } from '../../src/utils/promises.ts';

Deno.test('CreateCancellablePromise - resolves with the result', async () => {
  const expected = 'test result';
  const cancellable = CreateCancellablePromise(
    async () => expected,
    {
      message: 'Test timeout',
      ms: 1000,
    },
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
    {
      message: 'Test timeout',
      ms: 1000,
    },
  );

  await assertRejects(
    () => cancellable.promise,
    Error,
    expectedError.message,
  );
});

Deno.test('CreateCancellablePromise - times out if promise takes too long', async () => {
  let resolver: (() => void) | undefined;

  const cancellable = CreateCancellablePromise<string>(
    async () => {
      // Create a promise that we can resolve manually
      await new Promise<void>((resolve) => {
        resolver = resolve;
      });
      return 'should not resolve';
    },
    {
      message: 'Test timeout',
      ms: 100,
    },
  );

  try {
    await assertRejects(
      () => cancellable.promise,
      Error,
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
    {
      message: 'Test timeout',
      ms: 2000,
    },
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

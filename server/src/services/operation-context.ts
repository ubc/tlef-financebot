import { AsyncLocalStorage } from 'node:async_hooks';

/** Carries correlation only; never credentials or a mutable request object. */
export const operationContext = new AsyncLocalStorage<string>();

import { AsyncLocalStorage } from 'node:async_hooks';

export interface RequestAuthContext {
  accessToken?: string;
}

const requestAuthContextStorage = new AsyncLocalStorage<RequestAuthContext>();

export function runWithRequestAuthContext<T>(
  context: RequestAuthContext,
  fn: () => T
): T {
  return requestAuthContextStorage.run(context, fn);
}

export function getRequestAuthContext(): RequestAuthContext | undefined {
  return requestAuthContextStorage.getStore();
}

export function getRequestAccessToken(): string | undefined {
  const accessToken = getRequestAuthContext()?.accessToken;
  if (!accessToken) {
    return undefined;
  }

  const trimmed = accessToken.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

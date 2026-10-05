/**
 * An in-memory `localStorage` for the legend's jsdom suites. The persistence controller keys
 * real storage by a hash of the dataset, and every test in a file shares one jsdom environment,
 * so saved settings leak between tests whose fixtures hash the same. A stub scopes that state to
 * its file, and Node does not hand jsdom a usable `localStorage` without `--localstorage-file`,
 * which made `clear()` throw outright. Same shape as the mock in
 * `packages/utils/src/storage/storage-service.test.ts`.
 */
export function createLocalStorageMock(): Storage {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
    get length() {
      return Object.keys(store).length;
    },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
}

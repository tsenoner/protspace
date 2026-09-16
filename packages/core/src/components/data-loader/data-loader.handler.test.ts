/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, beforeEach } from 'vitest';
import './data-loader';
import type { DataErrorEventDetail } from './data-loader.events';

describe('data-loader loadFromFileHandler errors', () => {
  let dataLoader: HTMLElement & {
    loadFromFileHandler?: (
      file: File,
      options: unknown,
      next: (file: File, options: unknown) => Promise<void>,
    ) => Promise<void>;
    loadFromFile: (file: File) => Promise<void>;
    updateComplete?: Promise<unknown>;
  };

  beforeEach(async () => {
    document.body.innerHTML = '';
    dataLoader = document.createElement('protspace-data-loader') as typeof dataLoader;
    document.body.appendChild(dataLoader);
    await dataLoader.updateComplete;
  });

  it('dispatches data-error and exposes the message when the handler rejects', async () => {
    const errorEvents: DataErrorEventDetail[] = [];
    dataLoader.addEventListener('data-error', (event) => {
      errorEvents.push((event as CustomEvent<DataErrorEventDetail>).detail);
    });

    dataLoader.loadFromFileHandler = async () => {
      throw new Error('Bundle preparation failed: too few sequences.');
    };

    await dataLoader.loadFromFile(new File(['>x\nMK'], 'test.fasta'));
    await dataLoader.updateComplete;

    expect(errorEvents).toHaveLength(1);
    expect(errorEvents[0]?.message).toBe('Bundle preparation failed: too few sequences.');
    expect(errorEvents[0]?.severity).toBe('error');
  });
});

describe('data-loader file input reset', () => {
  it('clears the file input so re-picking the same file still loads it', async () => {
    document.body.innerHTML = '';
    const dataLoader = document.createElement('protspace-data-loader') as HTMLElement & {
      loadFromFileHandler?: (file: File) => Promise<void>;
      updateComplete: Promise<unknown>;
    };
    document.body.appendChild(dataLoader);
    await dataLoader.updateComplete;

    const input = dataLoader.shadowRoot?.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['x'], 'same.parquetbundle');
    // jsdom has no real file picker, so model the browser contract: the input keeps
    // the previous selection, and `change` only fires again once it is cleared.
    let value = 'C:\\fakepath\\same.parquetbundle';
    Object.defineProperty(input, 'value', {
      get: () => value,
      set: (next: string) => {
        value = next;
      },
      configurable: true,
    });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });

    const loaded: File[] = [];
    dataLoader.loadFromFileHandler = async (picked: File) => {
      loaded.push(picked);
    };

    input.dispatchEvent(new Event('change'));
    await dataLoader.updateComplete;

    expect(loaded).toEqual([file]);
    expect(input.value).toBe('');
  });
});

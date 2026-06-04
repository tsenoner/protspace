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

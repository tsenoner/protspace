import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getLayout, resetLayoutForTests, updateLayout } from '../explore/layout-state';
import { startProductTour } from './product-tour';

const drive = vi.hoisted(() => vi.fn());
vi.mock('driver.js', () => ({ driver: () => ({ drive, setConfig: vi.fn() }) }));
vi.mock('./product-tour.css', () => ({}));

const store = new Map<string, string>();

beforeEach(() => {
  store.clear();
  drive.mockClear();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      store.set(key, value);
    },
    removeItem: (key: string) => {
      store.delete(key);
    },
  });
  resetLayoutForTests();
});

describe('startProductTour', () => {
  it('opens a collapsed sidebar before driving, so the legend steps have a target', () => {
    updateLayout({ sidebarOpen: false });
    let openWhenDriven: boolean | undefined;
    drive.mockImplementation(() => (openWhenDriven = getLayout().sidebarOpen));

    startProductTour({ force: true });

    expect(drive).toHaveBeenCalledOnce();
    expect(openWhenDriven).toBe(true);
  });
});

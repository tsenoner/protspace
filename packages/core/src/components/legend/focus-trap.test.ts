/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getFocusableElements, createFocusTrap } from './focus-trap';

describe('focus-trap', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    container.remove();
    vi.restoreAllMocks();
  });

  // Helper to make elements visible to getFocusableElements
  // jsdom doesn't have a layout engine, so offsetParent is always null
  function makeElementsVisible(elements: HTMLElement[]) {
    elements.forEach((el) => {
      Object.defineProperty(el, 'offsetParent', { value: document.body, configurable: true });
    });
  }

  describe('getFocusableElements', () => {
    it('finds buttons', () => {
      container.innerHTML = '<button>Click me</button>';
      const button = container.querySelector('button')!;
      makeElementsVisible([button]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].tagName).toBe('BUTTON');
    });

    it('finds inputs', () => {
      container.innerHTML = '<input type="text" />';
      const input = container.querySelector('input')!;
      makeElementsVisible([input]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].tagName).toBe('INPUT');
    });

    it('finds selects', () => {
      container.innerHTML = '<select><option>A</option></select>';
      const select = container.querySelector('select')!;
      makeElementsVisible([select]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].tagName).toBe('SELECT');
    });

    it('finds textareas', () => {
      container.innerHTML = '<textarea></textarea>';
      const textarea = container.querySelector('textarea')!;
      makeElementsVisible([textarea]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].tagName).toBe('TEXTAREA');
    });

    it('finds elements with tabindex', () => {
      container.innerHTML = '<div tabindex="0">Focusable div</div>';
      const div = container.querySelector('div')!;
      makeElementsVisible([div]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
    });

    it('finds links with href', () => {
      container.innerHTML = '<a href="https://example.com">Link</a>';
      const link = container.querySelector('a')!;
      makeElementsVisible([link]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].tagName).toBe('A');
    });

    it('excludes disabled buttons', () => {
      container.innerHTML = '<button disabled>Disabled</button><button>Enabled</button>';
      const enabledButton = container.querySelectorAll('button')[1];
      makeElementsVisible([enabledButton]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].textContent).toBe('Enabled');
    });

    it('excludes disabled inputs', () => {
      container.innerHTML = '<input disabled /><input />';
      const enabledInput = container.querySelectorAll('input')[1];
      makeElementsVisible([enabledInput]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
    });

    it('excludes elements with tabindex=-1', () => {
      container.innerHTML = '<button tabindex="-1">Not focusable</button>';
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(0);
    });

    it('returns empty array for empty container', () => {
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(0);
    });

    it('returns elements in DOM order', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <input id="second" />
        <button id="third">Third</button>
      `;
      const first = container.querySelector('#first') as HTMLElement;
      const second = container.querySelector('#second') as HTMLElement;
      const third = container.querySelector('#third') as HTMLElement;
      makeElementsVisible([first, second, third]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(3);
      expect(elements[0].id).toBe('first');
      expect(elements[1].id).toBe('second');
      expect(elements[2].id).toBe('third');
    });

    it('excludes hidden elements (visibility)', () => {
      container.innerHTML =
        '<button id="visible">Visible</button><button id="hidden" style="visibility: hidden">Hidden</button>';
      const visible = container.querySelector('#visible') as HTMLElement;
      const hidden = container.querySelector('#hidden') as HTMLElement;
      makeElementsVisible([visible, hidden]);
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(1);
      expect(elements[0].id).toBe('visible');
    });

    it('excludes elements with no offsetParent (not in layout)', () => {
      container.innerHTML = '<button>Button</button>';
      // Don't call makeElementsVisible - offsetParent will be null
      const elements = getFocusableElements(container);
      expect(elements).toHaveLength(0);
    });
  });

  describe('createFocusTrap', () => {
    it('returns a cleanup function', () => {
      container.innerHTML = '<button>Click</button>';
      const cleanup = createFocusTrap(container);
      expect(typeof cleanup).toBe('function');
      cleanup();
    });

    it('stops wrapping focus after cleanup', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="last">Last</button>
      `;
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const lastBtn = container.querySelector('#last') as HTMLElement;
      makeElementsVisible([firstBtn, lastBtn]);

      const cleanup = createFocusTrap(container);
      cleanup();

      lastBtn.focus();
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
      container.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
      expect(document.activeElement).toBe(lastBtn);
    });

    it('focuses the first focusable element on the next frame', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="last">Last</button>
      `;
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const lastBtn = container.querySelector('#last') as HTMLElement;
      makeElementsVisible([firstBtn, lastBtn]);
      let frame: FrameRequestCallback | undefined;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
        frame = cb;
        return 1;
      });

      createFocusTrap(container);
      expect(document.activeElement).not.toBe(firstBtn);

      frame!(0);
      expect(document.activeElement).toBe(firstBtn);
    });

    it('does nothing on non-Tab keys', () => {
      container.innerHTML = '<button id="btn">Click</button>';
      createFocusTrap(container);

      const event = new KeyboardEvent('keydown', { key: 'Enter' });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);

      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });

    it('wraps focus from last to first on Tab', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="last">Last</button>
      `;
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const lastBtn = container.querySelector('#last') as HTMLElement;
      makeElementsVisible([firstBtn, lastBtn]);

      createFocusTrap(container);

      lastBtn.focus();

      const focusSpy = vi.spyOn(firstBtn, 'focus');
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      container.dispatchEvent(event);

      expect(focusSpy).toHaveBeenCalled();
    });

    it('wraps focus from first to last on Shift+Tab', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="last">Last</button>
      `;
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const lastBtn = container.querySelector('#last') as HTMLElement;
      makeElementsVisible([firstBtn, lastBtn]);

      createFocusTrap(container);

      firstBtn.focus();

      const focusSpy = vi.spyOn(lastBtn, 'focus');
      const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true });
      container.dispatchEvent(event);

      expect(focusSpy).toHaveBeenCalled();
    });

    it('handles container with no focusable elements', () => {
      container.innerHTML = '<div>No buttons here</div>';

      // Should not throw
      expect(() => {
        const cleanup = createFocusTrap(container);
        const event = new KeyboardEvent('keydown', { key: 'Tab' });
        container.dispatchEvent(event);
        cleanup();
      }).not.toThrow();
    });

    it('handles single focusable element', () => {
      container.innerHTML = '<button id="only">Only button</button>';
      const onlyBtn = container.querySelector('#only') as HTMLElement;
      makeElementsVisible([onlyBtn]);

      createFocusTrap(container);

      onlyBtn.focus();

      // Tab should wrap to the same element (first === last)
      const focusSpy = vi.spyOn(onlyBtn, 'focus');
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      container.dispatchEvent(event);

      expect(focusSpy).toHaveBeenCalled();
    });

    it('does not wrap focus when not at boundary', () => {
      container.innerHTML = `
        <button id="first">First</button>
        <button id="middle">Middle</button>
        <button id="last">Last</button>
      `;
      const firstBtn = container.querySelector('#first') as HTMLElement;
      const middleBtn = container.querySelector('#middle') as HTMLElement;
      const lastBtn = container.querySelector('#last') as HTMLElement;
      makeElementsVisible([firstBtn, middleBtn, lastBtn]);

      createFocusTrap(container);

      middleBtn.focus();

      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true });
      const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
      container.dispatchEvent(event);

      // Should not prevent default since we're not at boundary
      expect(preventDefaultSpy).not.toHaveBeenCalled();
    });
  });
});

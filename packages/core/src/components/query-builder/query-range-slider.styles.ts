import { css } from 'lit';

/** The range slider's track, fill and thumbs; a thumb is a 40 px target under a coarse pointer. */
export const rangeSliderStyles = css`
  :host {
    display: block;
    --thumb: 16px;
    --hit: 24px;
  }
  @media (pointer: coarse) {
    :host {
      --thumb: 22px;
      --hit: var(--ps-touch-target);
    }
  }
  .slider {
    position: relative;
    height: var(--hit);
    margin-inline: calc(var(--thumb) / 2);
  }
  .track,
  .fill {
    position: absolute;
    top: 50%;
    height: 2px;
    margin-top: -1px;
    border-radius: 1px;
    pointer-events: none;
  }
  .track {
    left: 0;
    right: 0;
    background: var(--ps-border-strong);
  }
  .fill {
    background: var(--ps-accent);
  }
  input {
    position: absolute;
    inset: 0;
    width: calc(100% + var(--thumb));
    height: 100%;
    margin: 0 0 0 calc(var(--thumb) / -2);
    padding: 0;
    background: none;
    appearance: none;
    -webkit-appearance: none;
    pointer-events: none;
  }
  input:focus {
    outline: none;
  }
  input::-webkit-slider-runnable-track {
    height: 100%;
    background: none;
  }
  input::-moz-range-track {
    background: none;
  }
  input::-webkit-slider-thumb {
    -webkit-appearance: none;
    box-sizing: border-box;
    width: var(--thumb);
    height: var(--thumb);
    margin-top: calc((var(--hit) - var(--thumb)) / 2);
    border: 2px solid var(--ps-accent);
    border-radius: 50%;
    background: var(--ps-surface);
    cursor: grab;
    pointer-events: auto;
    touch-action: none;
  }
  input::-moz-range-thumb {
    box-sizing: border-box;
    width: var(--thumb);
    height: var(--thumb);
    border: 2px solid var(--ps-accent);
    border-radius: 50%;
    background: var(--ps-surface);
    cursor: grab;
    pointer-events: auto;
  }
  input:active::-webkit-slider-thumb {
    cursor: grabbing;
  }
  input:focus-visible::-webkit-slider-thumb {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }
  input:focus-visible::-moz-range-thumb {
    outline: var(--ps-focus-width) solid var(--ps-focus);
    outline-offset: var(--ps-focus-offset);
  }
`;

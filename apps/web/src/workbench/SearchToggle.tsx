import type { Ref } from 'react';

interface SearchToggleProps {
  /** The button itself: the bar returns focus to it when search closes. */
  ref?: Ref<HTMLElement>;
  /** Search shows over the app bar. */
  open: boolean;
  onOpen(): void;
}

/**
 * The phone app bar's search button (design decision 17): below 641 px search does not fit beside
 * the wordmark and the dataset name, so this opens it over the bar. workbench.css shows it only in
 * the phone layout.
 */
export function SearchToggle({ ref, open, onOpen }: SearchToggleProps) {
  return (
    <ps-icon-button
      ref={ref}
      className="wb-search-toggle"
      icon="search"
      label="Search proteins"
      expanded={open ? 'true' : 'false'}
      onClick={onOpen}
    ></ps-icon-button>
  );
}

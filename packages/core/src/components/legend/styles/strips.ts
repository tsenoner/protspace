import { css } from 'lit';

/** The separation strips above the list, the note that replaces them while the view is filtered. */
export const stripStyles = css`
  .score-strips {
    display: flex;
    flex-direction: column;
    gap: var(--ps-space-2);
    padding: var(--ps-space-2) var(--ps-space-3);
    border-bottom: 1px solid var(--ps-border);
  }

  .score-strips-note {
    margin: 0;
    padding: var(--ps-space-2) var(--ps-space-3);
    /* The same size as .score-strips-caveat below: the two say the same kind of thing about
       the strips. */
    font-size: var(--ps-text-xs);
    color: var(--ps-text-muted);
    border-bottom: 1px solid var(--ps-border);
  }

  /* Sits inside .score-strips, which already owns the padding and bottom border. */
  .score-strips-caveat {
    margin: 0;
    font-size: var(--ps-text-xs);
    line-height: var(--ps-leading-tight);
    color: var(--ps-text-muted);
  }
`;

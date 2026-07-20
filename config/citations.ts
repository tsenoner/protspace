/**
 * Single source of truth for the ProtSpace publications, shared by the web app
 * (citation section + Resources nav). README / CITATION.cff / docs restate these
 * on their own (non-TS) surfaces and are kept in sync manually.
 */
export interface Publication {
  /** Bare DOI, e.g. "10.64898/2026.05.04.722720". */
  doi: string;
  /** Formatted human-readable citation. */
  citation: string;
  /** BibTeX entry. */
  bibtex: string;
}

/** Resolve a bare DOI to its doi.org URL. */
export const doiUrl = (doi: string): string => `https://doi.org/${doi}`;

/** Latest — the bioRxiv web-application preprint (preferred citation). */
export const PUBLICATION_WEB: Publication = {
  doi: '10.64898/2026.05.04.722720',
  citation:
    'Senoner, T., Vahidi, P., Olenyi, T., Senoner, F., Sisman, G., Kahl, E., Rost, B., & Koludarov, I. (2026). ProtSpace: Protein Universe in Your Browser. bioRxiv.',
  bibtex: `@article{senoner2026protspaceweb,
  title     = {ProtSpace: Protein Universe in Your Browser},
  author    = {Senoner, Tobias and Vahidi, Peyman and Olenyi, Tobias and Senoner, Florin and Sisman, G{\\"o}khan and Kahl, Elias and Rost, Burkhard and Koludarov, Ivan},
  journal   = {bioRxiv},
  year      = {2026},
  doi       = {10.64898/2026.05.04.722720},
  url       = {https://www.biorxiv.org/content/10.64898/2026.05.04.722720v1},
  publisher = {openRxiv}
}`,
};

/** Original — the peer-reviewed Journal of Molecular Biology paper. */
export const PUBLICATION_JMB: Publication = {
  doi: '10.1016/j.jmb.2025.168940',
  citation:
    'Senoner, T., Olenyi, T., Heinzinger, M., Spannagl, A., Bouras, G., Rost, B., & Koludarov, I. (2025). ProtSpace: A Tool for Visualizing Protein Space. Journal of Molecular Biology, 437(15), 168940.',
  bibtex: `@article{senoner2025protspace,
  title     = {ProtSpace: A Tool for Visualizing Protein Space},
  author    = {Senoner, Tobias and Olenyi, Tobias and Heinzinger, Michael and Spannagl, Anton and Bouras, George and Rost, Burkhard and Koludarov, Ivan},
  journal   = {Journal of Molecular Biology},
  volume    = {437},
  number    = {15},
  pages     = {168940},
  year      = {2025},
  doi       = {10.1016/j.jmb.2025.168940},
  publisher = {Elsevier}
}`,
};

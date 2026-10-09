import '@protspace/core';
import type { PsDialog, PsMenu, SegmentedOption, SelectOption } from '@protspace/core';
import { useEffect, useRef, useState, type ReactNode } from 'react';

const PALETTES: SelectOption[] = [
  { value: 'kelly', label: "Kelly's colours" },
  { value: 'okabe', label: 'Okabe-Ito' },
  { value: 'tableau', label: 'Tableau 10 (unavailable)', disabled: true },
];

const STRUCTURE_COLOURS: SegmentedOption[] = [
  { value: 'plddt', label: 'pLDDT' },
  { value: 'ted', label: 'TED domains' },
];

const PROJECTIONS: SegmentedOption[] = [
  { value: 'pca', label: 'PCA' },
  { value: 'umap', label: 'UMAP' },
  { value: 'tsne', label: 't-SNE' },
];

/** Every kit control and its states in one place, for review in both themes. Development only. */
export default function KitGallery() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [pressed, setPressed] = useState(true);
  const dialog = useRef<PsDialog>(null);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    return () => {
      delete document.documentElement.dataset.theme;
    };
  }, [theme]);

  return (
    <main className="min-h-screen bg-ps-surface p-8 font-ps text-ps-base text-ps-text">
      <header className="mb-8 flex items-center gap-4">
        <h1 className="text-ps-xl font-semibold">Kit</h1>
        <ps-button size="sm" onClick={() => setTheme('light')}>
          Light
        </ps-button>
        <ps-button size="sm" onClick={() => setTheme('dark')}>
          Dark
        </ps-button>
      </header>

      <Section title="Buttons">
        <ps-button variant="primary">Export figure</ps-button>
        <ps-button variant="secondary">Import</ps-button>
        <ps-button variant="ghost">Cancel</ps-button>
        <ps-button variant="danger">Reset</ps-button>
        <ps-button variant="primary" disabled>
          Disabled
        </ps-button>
        <ps-button variant="secondary" disabled>
          Disabled
        </ps-button>
      </Section>

      <Section title="Small buttons">
        <ps-button variant="primary" size="sm">
          Export figure
        </ps-button>
        <ps-button variant="secondary" size="sm">
          Import
        </ps-button>
        <ps-button variant="ghost" size="sm">
          Cancel
        </ps-button>
        <ps-button variant="danger" size="sm">
          Reset
        </ps-button>
        <ps-button variant="secondary" size="sm" disabled>
          Disabled
        </ps-button>
      </Section>

      <Section title="Icon buttons">
        <ps-icon-button icon="search" label="Search"></ps-icon-button>
        <ps-icon-button icon="x" label="Close" variant="secondary"></ps-icon-button>
        <ps-icon-button icon="check" label="Apply" variant="primary"></ps-icon-button>
        <ps-icon-button icon="x" label="Remove" variant="danger"></ps-icon-button>
        <ps-icon-button icon="search" label="Search (small)" size="sm"></ps-icon-button>
        <ps-icon-button
          icon="search"
          label="Find on plot"
          pressed={pressed}
          onClick={() => setPressed((on) => !on)}
        ></ps-icon-button>
        <ps-icon-button icon="minus" label="Zoom out" pressed={false}></ps-icon-button>
        <ps-icon-button icon="x" label="Close (disabled)" disabled></ps-icon-button>
      </Section>

      <Section title="Tooltip">
        <ps-button>Reset view</ps-button>
        <ps-tooltip text="Fit every point in view"></ps-tooltip>
        <ps-button variant="ghost">Bottom tooltip</ps-button>
        <ps-tooltip text="Placed below its target" placement="bottom"></ps-tooltip>
      </Section>

      <Section title="Inputs">
        <ps-input
          label="Search proteins"
          type="search"
          placeholder="Search proteins or paste IDs"
        ></ps-input>
        <ps-input label="Max legend items" type="number" value="13"></ps-input>
        <ps-input label="Shape size" value="abc" invalid></ps-input>
        <ps-input label="Dataset name" value="Read only here" disabled></ps-input>
      </Section>

      <Section title="Selects">
        <ps-select label="Palette" options={PALETTES} value="kelly"></ps-select>
        <ps-select label="Palette (disabled)" options={PALETTES} value="okabe" disabled></ps-select>
      </Section>

      <Section title="Checkboxes">
        <ps-checkbox>Show labels</ps-checkbox>
        <ps-checkbox checked>Show duplicate counts</ps-checkbox>
        <ps-checkbox indeterminate>Some categories</ps-checkbox>
        <ps-checkbox disabled>Disabled</ps-checkbox>
        <ps-checkbox checked disabled>
          Disabled and checked
        </ps-checkbox>
      </Section>

      <Section title="Switches">
        <ps-switch>Density</ps-switch>
        <ps-switch checked>Contours</ps-switch>
        <ps-switch disabled>Disabled</ps-switch>
        <ps-switch checked disabled>
          Disabled and on
        </ps-switch>
        <ps-switch label="Unlabelled switch, named by its label property"></ps-switch>
      </Section>

      <Section title="Segmented">
        <ps-segmented
          label="Structure colour"
          options={STRUCTURE_COLOURS}
          value="plddt"
        ></ps-segmented>
        <ps-segmented label="Projection" options={PROJECTIONS} value="umap"></ps-segmented>
      </Section>

      <Section title="Menus">
        <MenuDemo trigger="Open menu" label="Color by" searchable>
          <ps-menu-group label="UniProt">
            <ps-menu-item value="family" type="radio" checked>
              Protein family
            </ps-menu-item>
            <ps-menu-item value="species" type="radio">
              Species
            </ps-menu-item>
            <ps-menu-item value="ec" type="radio" disabled>
              EC number
            </ps-menu-item>
          </ps-menu-group>
          <ps-menu-group label="Predicted">
            <ps-menu-item value="long" type="radio">
              Subcellular location predicted from sequence embeddings with a calibrated probe
            </ps-menu-item>
          </ps-menu-group>
          <ps-menu-group label="Display">
            <ps-menu-item value="tooltip" type="checkbox" checked>
              Show in tooltip
            </ps-menu-item>
            <ps-menu-item value="legend" type="checkbox">
              Show in legend
            </ps-menu-item>
          </ps-menu-group>
        </MenuDemo>
        <MenuDemo trigger="Open actions menu" label="Actions">
          <ps-menu-label>Export</ps-menu-label>
          <ps-menu-item value="png">PNG image</ps-menu-item>
          <ps-menu-item value="svg">SVG image</ps-menu-item>
          <ps-menu-label>Selection</ps-menu-label>
          <ps-menu-item value="isolate">Isolate selection</ps-menu-item>
          <ps-menu-item value="clear" disabled>
            Clear selection
          </ps-menu-item>
        </MenuDemo>
      </Section>

      <Section title="Dialog">
        <ps-button onClick={() => dialog.current && (dialog.current.open = true)}>
          Open dialog
        </ps-button>
        <ps-dialog ref={dialog} heading="Legend settings">
          <div className="flex flex-col items-start gap-3">
            <p>Changes apply as you make them.</p>
            <ps-input label="Max legend items" type="number" value="13"></ps-input>
            <MenuDemo trigger="Sort by" label="Sort legend by">
              <ps-menu-item value="size" type="radio" checked>
                Size
              </ps-menu-item>
              <ps-menu-item value="name" type="radio">
                Name
              </ps-menu-item>
            </MenuDemo>
          </div>
          <ps-button slot="footer" variant="danger">
            Reset
          </ps-button>
          <ps-button
            slot="footer"
            variant="primary"
            onClick={() => dialog.current && (dialog.current.open = false)}
          >
            Done
          </ps-button>
        </ps-dialog>
      </Section>
    </main>
  );
}

/** A button that toggles a ps-menu anchored to it. */
function MenuDemo({
  trigger,
  label,
  searchable = false,
  children,
}: {
  trigger: string;
  label: string;
  searchable?: boolean;
  children: ReactNode;
}) {
  const anchor = useRef<HTMLElement>(null);
  const menu = useRef<PsMenu>(null);

  useEffect(() => {
    if (menu.current) menu.current.anchor = anchor.current;
  }, []);

  return (
    <>
      <ps-button
        ref={anchor}
        onClick={() => menu.current && (menu.current.open = !menu.current.open)}
      >
        {trigger}
      </ps-button>
      <ps-menu ref={menu} label={label} searchable={searchable}>
        {children}
      </ps-menu>
    </>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="mb-3 text-ps-sm font-semibold uppercase tracking-wide text-ps-text-muted">
        {title}
      </h2>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </section>
  );
}

/** One entry of the host app's example-dataset catalog, as shown in the Import menu. */
export interface ExampleDatasetSummary {
  id: string;
  label: string;
  /** What the dataset is; the first paragraph of the entry's info popover. */
  description: string;
  /** One line naming what the example's curated view shows; the popover's second paragraph. */
  insight?: string;
  /** The entry's documentation, linked as "Learn more ↗" from its info popover. */
  docsUrl?: string;
  /** Slow to download and decode: the item shows a "Large" badge. */
  large?: boolean;
}

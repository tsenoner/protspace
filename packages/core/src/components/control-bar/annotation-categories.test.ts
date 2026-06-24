import { describe, it, expect } from 'vitest';
import { groupAnnotations } from './annotation-categories';

describe('groupAnnotations', () => {
  it('groups computed cluster_/silhouette_ columns under a Statistics section', () => {
    const groups = groupAnnotations(['cluster_PCA_2', 'silhouette_PCA_2', 'cluster_UMAP_2']);
    const stats = groups.find((g) => g.category === 'Statistics');
    expect(stats).toBeDefined();
    expect(stats?.annotations).toEqual(['cluster_PCA_2', 'cluster_UMAP_2', 'silhouette_PCA_2']);
    // computed columns must not leak into the catch-all Other section
    expect(groups.find((g) => g.category === 'Other')).toBeUndefined();
  });

  it('keeps non-computed annotations out of the Statistics section', () => {
    const groups = groupAnnotations(['cluster_PCA_2', 'my_random_label']);
    const stats = groups.find((g) => g.category === 'Statistics');
    expect(stats?.annotations).toEqual(['cluster_PCA_2']);
    const other = groups.find((g) => g.category === 'Other');
    expect(other?.annotations).toEqual(['my_random_label']);
  });
});

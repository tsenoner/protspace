import { describe, it, expect } from 'vitest';
import { groupAnnotations } from './annotation-categories';

describe('groupAnnotations', () => {
  it('groups computed cluster_/silhouette_ columns under a Statistics section', () => {
    const groups = groupAnnotations(
      ['cluster_PCA_2', 'silhouette_PCA_2', 'cluster_UMAP_2'],
      ['PCA_2', 'UMAP_2'],
    );
    const stats = groups.find((g) => g.category === 'Statistics');
    expect(stats).toBeDefined();
    expect(stats?.annotations).toEqual(['cluster_PCA_2', 'cluster_UMAP_2', 'silhouette_PCA_2']);
    // computed columns must not leak into the catch-all Other section
    expect(groups.find((g) => g.category === 'Other')).toBeUndefined();
  });

  it('keeps non-computed annotations out of the Statistics section', () => {
    const groups = groupAnnotations(['cluster_PCA_2', 'my_random_label'], ['PCA_2']);
    const stats = groups.find((g) => g.category === 'Statistics');
    expect(stats?.annotations).toEqual(['cluster_PCA_2']);
    const other = groups.find((g) => g.category === 'Other');
    expect(other?.annotations).toEqual(['my_random_label']);
  });

  it('does not misclassify user columns that merely share the cluster_/silhouette_ prefix', () => {
    // cluster_id, cluster_size, silhouette_score are plausible user-uploaded annotation
    // names that start with the same prefixes as the computed cluster_<projection> /
    // silhouette_<projection> columns, but are not themselves computed columns for any
    // known projection — they must stay out of "Statistics".
    const groups = groupAnnotations(
      ['cluster_id', 'cluster_size', 'silhouette_score', 'cluster_PCA_2'],
      ['PCA_2'],
    );
    const stats = groups.find((g) => g.category === 'Statistics');
    expect(stats?.annotations).toEqual(['cluster_PCA_2']);
    const other = groups.find((g) => g.category === 'Other');
    expect(other?.annotations).toEqual(['cluster_id', 'cluster_size', 'silhouette_score']);
  });

  it('treats all columns as non-computed when no projection names are given', () => {
    const groups = groupAnnotations(['cluster_PCA_2', 'silhouette_PCA_2']);
    expect(groups.find((g) => g.category === 'Statistics')).toBeUndefined();
    const other = groups.find((g) => g.category === 'Other');
    expect(other?.annotations).toEqual(['cluster_PCA_2', 'silhouette_PCA_2']);
  });
});

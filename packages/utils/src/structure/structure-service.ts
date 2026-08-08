/**
 * AlphaFold API response interface
 */
interface AlphaFoldPrediction {
  bcifUrl?: string;
  cifUrl?: string;
  pdbUrl?: string;
  modelVersion: string;
}

interface TedDomainApiEntry {
  ted_domain_no?: number | string;
  segments?: unknown;
}

interface TedDomainApiSegment {
  af_start?: number | string;
  af_end?: number | string;
}

/**
 * Service for handling protein structure loading from various sources
 */
export class StructureService {
  private static readonly ALPHAFOLD_API_URL = 'https://www.alphafold.ebi.ac.uk/api/prediction';
  private static readonly TED_DOMAINS_API_URL = 'https://alphafold.ebi.ac.uk/api/domains';
  private static readonly TED_DOMAINS_TIMEOUT_MS = 5_000;
  private static readonly THREE_D_BEACONS_SUMMARY_URL =
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary';
  private static readonly alphaFoldModelPageCache: Map<string, string | null> = new Map();

  /**
   * Load protein structure from available sources
   * @param proteinId - The protein identifier
   * @returns Promise with structure data and metadata
   */
  public static async loadStructure(proteinId: string): Promise<StructureData> {
    const formattedId = this.formatProteinId(proteinId);
    const tedDomainsPromise = this.loadTedDomains(formattedId);

    // Fetch prediction data from AlphaFold API
    const apiUrl = `${this.ALPHAFOLD_API_URL}/${formattedId}`;

    try {
      const response = await fetch(apiUrl);

      if (!response.ok) {
        throw new Error(`AlphaFold API request failed: ${response.status}`);
      }

      const predictions: AlphaFoldPrediction[] = await response.json();

      if (!predictions || predictions.length === 0) {
        throw new Error(`No AlphaFold prediction found for ${formattedId}`);
      }

      const prediction = predictions[0];

      // Prefer mmCIF over PDB so Mol* can apply pLDDT confidence coloring (requires ma_qa_metric in mmCIF)
      let structureUrl = '';
      let format: 'pdb' | 'mmcif' = 'mmcif';
      let isBinary = false;

      if (prediction.cifUrl) {
        structureUrl = prediction.cifUrl;
      } else if (prediction.bcifUrl) {
        structureUrl = prediction.bcifUrl;
        isBinary = true;
      } else if (prediction.pdbUrl) {
        structureUrl = prediction.pdbUrl;
        format = 'pdb';
      } else {
        throw new Error(`No structure URL found for ${formattedId}`);
      }

      // Fetch the structure file data and create a blob URL
      // This avoids CORS issues and works better with Molstar
      const structureResponse = await fetch(structureUrl);
      if (!structureResponse.ok) {
        throw new Error(`Failed to fetch structure file: ${structureResponse.status}`);
      }

      const structureData = isBinary
        ? await structureResponse.arrayBuffer()
        : await structureResponse.text();

      // Create blob and blob URL
      const blob = new Blob([structureData], {
        type: isBinary ? 'application/octet-stream' : 'text/plain',
      });
      const blobUrl = URL.createObjectURL(blob);
      const tedDomains = await tedDomainsPromise;

      return {
        proteinId: formattedId,
        source: 'alphafold',
        url: blobUrl,
        format,
        isBinary,
        tedDomains,
        metadata: {
          confidence: 'high',
          method: 'predicted',
          version: prediction.modelVersion || 'unknown',
        },
      };
    } catch (error) {
      // Only log unexpected errors (not 404s, which are expected for proteins without structures)
      if (error instanceof Error && !error.message.includes('404')) {
        console.warn(
          `[StructureService] Failed to load AlphaFold structure for ${formattedId}:`,
          error.message,
        );
      }
      throw new Error(`AlphaFold structure not available for ${formattedId}`);
    }
  }

  private static async loadTedDomains(proteinId: string): Promise<TedDomain[]> {
    const abortController = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<TedDomain[]>((resolve) => {
      timeoutId = setTimeout(() => {
        abortController.abort();
        resolve([]);
      }, this.TED_DOMAINS_TIMEOUT_MS);
    });

    const requestPromise = this.requestTedDomains(proteinId, abortController.signal);
    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } finally {
      if (timeoutId !== undefined) clearTimeout(timeoutId);
    }
  }

  private static async requestTedDomains(
    proteinId: string,
    signal: AbortSignal,
  ): Promise<TedDomain[]> {
    try {
      const response = await fetch(`${this.TED_DOMAINS_API_URL}/${proteinId}`, { signal });
      if (!response.ok) return [];

      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return [];
      const annotations = (payload as { annotations?: unknown }).annotations;
      if (!Array.isArray(annotations)) return [];

      return annotations
        .map((entry) => this.parseTedDomain(entry))
        .filter((domain): domain is TedDomain => domain !== null)
        .sort((left, right) => left.domainNumber - right.domainNumber);
    } catch {
      return [];
    }
  }

  private static parseTedDomain(value: unknown): TedDomain | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const entry = value as TedDomainApiEntry;
    const domainNumber = Number(entry.ted_domain_no);
    if (!Number.isInteger(domainNumber) || domainNumber < 1 || !Array.isArray(entry.segments)) {
      return null;
    }

    const segments = entry.segments
      .filter(
        (segment): segment is TedDomainApiSegment =>
          !!segment && typeof segment === 'object' && !Array.isArray(segment),
      )
      .map((segment) => ({ start: Number(segment.af_start), end: Number(segment.af_end) }))
      .filter(({ start, end }) => start > 0 && start <= end);

    return segments.length > 0 ? { domainNumber, segments } : null;
  }

  /**
   * Check if structure is available from AlphaFold
   * @param proteinId - The protein identifier
   * @returns Promise<boolean> indicating availability
   */
  public static async isAlphaFoldAvailable(proteinId: string): Promise<boolean> {
    const url = await this.getAlphaFoldModelPageUrl(proteinId);
    return url !== null;
  }

  /**
   * Get AlphaFold model page URL via 3D Beacons summary
   * @param proteinId - UniProt accession (e.g., P04637)
   * @param signal - optional AbortSignal for cancellation
   */
  public static async getAlphaFoldModelPageUrl(
    proteinId: string,
    signal?: AbortSignal,
  ): Promise<string | null> {
    const formattedId = this.formatProteinId(proteinId);

    if (this.alphaFoldModelPageCache.has(formattedId)) {
      return this.alphaFoldModelPageCache.get(formattedId) ?? null;
    }

    const endpoint = `${this.THREE_D_BEACONS_SUMMARY_URL}/${encodeURIComponent(formattedId)}.json`;

    try {
      const res = await fetch(endpoint, { signal, headers: { Accept: 'application/json' } });
      if (!res.ok) {
        this.alphaFoldModelPageCache.set(formattedId, null);
        return null;
      }

      const data = await res.json();
      const root = Array.isArray(data) ? data[0] : data;
      // API returns dynamic JSON structure, use Record for flexible access
      const structures: Record<string, unknown>[] = root?.structures ?? [];

      let modelPageUrl: string | null = null;
      for (let i = 0; i < structures.length; i++) {
        const summary = (structures[i] as Record<string, unknown>)?.summary as
          | Record<string, unknown>
          | undefined;
        if (!summary) continue;
        const providerObj = summary?.provider as Record<string, unknown> | string | undefined;
        const provider =
          typeof providerObj === 'object' ? (providerObj?.name as string) : providerObj;
        if (provider === 'AlphaFold DB') {
          modelPageUrl = (summary?.model_page_url as string) ?? null;
          break;
        }
      }

      this.alphaFoldModelPageCache.set(formattedId, modelPageUrl);
      return modelPageUrl;
    } catch {
      this.alphaFoldModelPageCache.set(formattedId, null);
      return null;
    }
  }

  /**
   * Format protein ID by removing version numbers
   * @private
   */
  private static formatProteinId(proteinId: string): string {
    return proteinId.split('.')[0];
  }
}

/**
 * Structure data interface
 */
export interface StructureData {
  proteinId: string;
  source: 'alphafold';
  url: string | null;
  format: 'pdb' | 'mmcif';
  isBinary: boolean;
  tedDomains: TedDomain[];
  metadata: {
    confidence: 'high' | 'medium' | 'low' | 'experimental';
    method: 'predicted' | 'experimental';
    version: string;
  };
}

export interface TedDomainSegment {
  start: number;
  end: number;
}

export interface TedDomain {
  domainNumber: number;
  segments: TedDomainSegment[];
}

/**
 * Structure loading events
 */
export interface StructureLoadingEvent {
  proteinId: string;
  status: 'loading' | 'loaded' | 'error';
  error?: string;
  data?: StructureData;
}

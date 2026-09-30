/**
 * AlphaFold API response interface
 */
interface AlphaFoldPrediction {
  bcifUrl?: string;
  cifUrl?: string;
  pdbUrl?: string;
  modelVersion: string;
}

/**
 * Extract the base accession from a protein ID.
 * Strips any version suffix after the first dot (e.g., "P0DQE9.2" → "P0DQE9").
 */
export function getBaseAccession(proteinId: string): string {
  return proteinId.split('.')[0];
}

/**
 * Service for handling protein structure loading from various sources
 */
export class StructureService {
  private static readonly ALPHAFOLD_API_URL = 'https://www.alphafold.ebi.ac.uk/api/prediction';
  private static readonly THREE_D_BEACONS_SUMMARY_URL =
    'https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary';
  private static readonly alphaFoldModelPageCache: Map<string, string | null> = new Map();

  /**
   * Load protein structure from available sources
   * @param proteinId - The protein identifier
   * @returns Promise with structure data and metadata
   */
  public static async loadStructure(proteinId: string): Promise<StructureData> {
    const formattedId = getBaseAccession(proteinId);

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

      return {
        proteinId: formattedId,
        source: 'alphafold',
        url: blobUrl,
        format,
        isBinary,
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
    const formattedId = getBaseAccession(proteinId);

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
  metadata: {
    confidence: 'high' | 'medium' | 'low' | 'experimental';
    method: 'predicted' | 'experimental';
    version: string;
  };
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

import { LitElement, html, type TemplateResult } from 'lit';
import { property } from 'lit/decorators.js';
import { customElement } from '../../utils/safe-custom-element';
import { toDisplayValue, toInternalValue } from '@protspace/utils';
import type { AnnotationBlock, NumericAnnotationType, TooltipView } from '@protspace/utils';
import { proteinTooltipStyles } from './protein-tooltip.styles';
import {
  getAnnotationHeaderType,
  getGeneName,
  getProteinName,
  getUniprotKbId,
} from './protein-tooltip-helpers';

const ANNOTATION_HEADER_LABELS: Record<'bitscore' | 'evidence', string> = {
  bitscore: 'Bitscore',
  evidence: 'Evidence',
};

const SUPERSCRIPT_DIGITS: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};

const RAW_FLOAT_VALUE_FORMATTER = new Intl.NumberFormat('en-US', {
  useGrouping: true,
  minimumFractionDigits: 1,
  maximumFractionDigits: 6,
});

function shouldUseTinyFloatFormat(value: number): boolean {
  const abs = Math.abs(value);
  return abs > 0 && abs < 0.001;
}

export function formatRawNumericTooltipValue(
  value: number,
  numericType: NumericAnnotationType = 'float',
): string {
  if (!Number.isFinite(value)) return String(value);
  if (numericType === 'int') return String(Math.trunc(value));
  if (shouldUseTinyFloatFormat(value)) {
    return Number(value.toPrecision(6)).toString();
  }
  return RAW_FLOAT_VALUE_FORMATTER.format(value);
}

function formatScore(value: number): string {
  const abs = Math.abs(value);
  // Display as plain number when within 0.01 to 999 (or zero)
  if (abs === 0 || (abs >= 0.01 && abs < 1000)) {
    // Use up to 2 significant decimals, strip trailing zeros
    return Number(value.toPrecision(3)).toString();
  }
  const exp = value.toExponential(1);
  const [mantissa, exponent] = exp.split('e');
  // Strip the leading '+' from the exponent (e.g., e+2 → e2)
  const cleanExp = (exponent ?? '').replace(/^\+/, '');
  const superExp = cleanExp.replace(/[0-9\-]/g, (ch) => SUPERSCRIPT_DIGITS[ch] ?? ch);
  return `${mantissa}×10${superExp}`;
}

function renderAnnotationBlock(block: AnnotationBlock): TemplateResult {
  const headerType = getAnnotationHeaderType(block.scores, block.evidence);
  const numericType: NumericAnnotationType = block.numericType;
  return html`
    <div class="tooltip-annotations">
      <div class="tooltip-annotation-header">
        <span>${block.key}</span>
        ${headerType ? html`<span>${ANNOTATION_HEADER_LABELS[headerType]}</span>` : ''}
      </div>
      ${block.numericValue !== null
        ? html`<div class="tooltip-annotation tooltip-annotation-raw">
            <span class="label">Raw value:</span>
            <span class="tooltip-annotation-score"
              >${formatRawNumericTooltipValue(block.numericValue, numericType)}</span
            >
          </div>`
        : ''}
      ${block.displayValues.map((value, idx) => {
        const scores = block.scores[idx];
        const evidence = block.evidence[idx];
        const MAX_VISIBLE_SCORES = 3;
        let scoreText = '';
        if (Array.isArray(scores) && scores.length > 0) {
          const visible = scores.slice(0, MAX_VISIBLE_SCORES).map(formatScore);
          scoreText =
            scores.length > MAX_VISIBLE_SCORES ? visible.join(', ') + ', …' : visible.join(', ');
        }
        const displayValue = toDisplayValue(toInternalValue(value));
        return html`<div class="tooltip-annotation">
          <span class="tooltip-annotation-label" title="${displayValue}">${displayValue}</span
          >${scoreText
            ? html`<span class="tooltip-annotation-score">${scoreText}</span>`
            : evidence
              ? html`<span class="tooltip-annotation-evidence">${evidence}</span>`
              : ''}
        </div>`;
      })}
    </div>
  `;
}

@customElement('protspace-protein-tooltip')
class ProtspaceProteinTooltip extends LitElement {
  @property({ type: Object }) view: TooltipView | null = null;

  static styles = proteinTooltipStyles;

  render() {
    if (!this.view) {
      return html``;
    }

    const view = this.view;
    const geneName = getGeneName(view.geneName);
    const proteinName = getProteinName(view.proteinName);
    const uniprotKbId = getUniprotKbId(view.uniprotKbId);

    return html`
      <div class="tooltip">
        <div class="tooltip-header">
          <div class="tooltip-protein-id">
            <span class="tooltip-protein-id-main">${view.proteinId}</span>
            ${uniprotKbId
              ? html`<span class="tooltip-uniprot-separator"> · </span>
                  <span class="tooltip-uniprot-id">${uniprotKbId}</span>`
              : ''}
          </div>
        </div>
        <div class="tooltip-content">
          ${proteinName
            ? html`<div class="tooltip-protein-name">
                <span class="label">Protein:</span> ${proteinName}
              </div>`
            : ''}
          ${geneName
            ? html`<div class="tooltip-gene-name">
                <span class="label">Gene:</span> ${geneName}
              </div>`
            : ''}
          ${view.blocks.map((block) => renderAnnotationBlock(block))}
        </div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'protspace-protein-tooltip': ProtspaceProteinTooltip;
  }
}

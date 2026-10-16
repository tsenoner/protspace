/**
 * `rgb()`/`rgba()` (comma or space syntax, alpha after `,` or `/`) or Chrome's `color(srgb … / a)`
 * (a computed color-mix) as [r, g, b, alpha].
 */
export function colourChannels(value: string): [number, number, number, number] {
  const srgb = /^color\(srgb ([\d.]+) ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/.exec(value);
  if (srgb) {
    const [r, g, b] = srgb.slice(1, 4).map((channel) => Math.round(Number(channel) * 255));
    return [r, g, b, Number(srgb[4] ?? 1)];
  }
  const rgb = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[/,]\s*([\d.]+))?\s*\)$/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3]), Number(rgb[4] ?? 1)];
  throw new Error(`Unparsed colour: ${value}`);
}

import { describe, expect, it } from 'vitest';
import { PLUS_ARM_RATIO as SVG_PLUS_ARM_RATIO } from '@protspace/utils';
import {
  CAMERA_TO_CLIP_GLSL,
  GAMMA_FRAGMENT_SHADER,
  PLUS_ARM_RATIO,
  POINT_FRAGMENT_SHADER,
  POINT_VERTEX_SHADER,
} from './point-shaders';

describe('the plus glyph', () => {
  it("draws its arms as wide as the legend's and the export's SVG plus", () => {
    expect(PLUS_ARM_RATIO).toBe(SVG_PLUS_ARM_RATIO);
    expect(POINT_FRAGMENT_SHADER).toContain(`const float PLUS_ARM = ${PLUS_ARM_RATIO.toFixed(2)};`);
  });
});

describe('gamma correction shader', () => {
  it('un-premultiplies before handing the frame to the compositor', () => {
    expect(GAMMA_FRAGMENT_SHADER).toContain('linear.rgb / linear.a');
  });
});

describe('projection morph', () => {
  it('blends towards a_prevPosition by u_morph before the camera transform', () => {
    const [mix, transformed, ...rest] = CAMERA_TO_CLIP_GLSL.split('\n').map((l) => l.trim());
    expect(mix).toBe('vec2 position = mix(a_dataPosition, a_prevPosition, u_morph);');
    expect(transformed).toMatch(/^vec2 cssTransformed = position \* /);
    expect(rest.join('\n')).not.toContain('a_dataPosition');
  });

  it('pins a_dataPosition to location 0, so a disabled a_prevPosition never takes it', () => {
    expect(POINT_VERTEX_SHADER).toContain('layout(location = 0) in vec2 a_dataPosition;');
    expect(POINT_VERTEX_SHADER.match(/layout\(location/g)).toHaveLength(1);
  });
});

describe('point shaders', () => {
  it('passes the transferred-annotation flag through as a flat varying', () => {
    expect(POINT_VERTEX_SHADER).toContain('in float a_predicted;');
    expect(POINT_VERTEX_SHADER).toContain('flat out float v_predicted;');
    expect(POINT_VERTEX_SHADER).toContain('v_predicted = a_predicted;');
    expect(POINT_FRAGMENT_SHADER).toContain('flat in float v_predicted;');
  });

  it('cuts out glyph interiors only for transferred annotations', () => {
    expect(POINT_FRAGMENT_SHADER).toContain('if (v_predicted > 0.5)');
    expect(POINT_FRAGMENT_SHADER).toContain(
      'predictedInterior = smoothstep(ringWidth, ringWidth + interiorAa, edgeDist);',
    );
    expect(POINT_FRAGMENT_SHADER).toContain(
      'mix(finalColor * pointAlpha, u_knockoutColor * PREDICTED_INTERIOR_FILL, predictedInterior)',
    );
    expect(POINT_FRAGMENT_SHADER).toContain('uniform vec3 u_knockoutColor;');
    // The hollow interior is the only thing that distinguishes the two glyph classes; the
    // outline applies to both (#369, see the outline describe block).
  });

  it("clamps the sprite to the context's point-size range, not only to 1", () => {
    expect(POINT_VERTEX_SHADER).toContain(
      'gl_PointSize = clamp(pointSize * u_pointScale * u_dpr, 1.0, u_maxPointSize);',
    );
  });

  it('sizes the ring as a share of the diameter, a device-pixel floor and a depth cap', () => {
    expect(POINT_FRAGMENT_SHADER).toContain('const float HOLLOW_RING_DIAMETER_SHARE = 0.12;');
    expect(POINT_FRAGMENT_SHADER).toContain('const float HOLLOW_RING_DEPTH_SHARE = 0.6;');
    expect(POINT_FRAGMENT_SHADER).toContain(
      'fieldGradient * max(HOLLOW_RING_DIAMETER_SHARE * 2.0, pixelScale),',
    );
    expect(POINT_FRAGMENT_SHADER).toContain('HOLLOW_RING_DEPTH_SHARE * depth);');
    expect(POINT_FRAGMENT_SHADER).toContain(
      'min(fieldGradient * pixelScale, (depth - ringWidth) * 0.5)',
    );
  });

  it('gives each shape its depth and gradient, so the plus and triangles keep a hole', () => {
    expect(POINT_FRAGMENT_SHADER).toContain('const float PLUS_ARM = 0.42;');
    expect(POINT_FRAGMENT_SHADER).toContain('float thickness = PLUS_ARM;');
    expect(POINT_FRAGMENT_SHADER).toContain('depth = PLUS_ARM;');
    expect(POINT_FRAGMENT_SHADER.match(/depth = 2\.0 \/ 3\.0;/g)).toHaveLength(2);
    // The diamond's edgeDist has gradient 2.
    expect(POINT_FRAGMENT_SHADER).toContain('fieldGradient = 2.0;');
  });

  it('sizes the ring from an isotropic pixel scale so the hole stays round', () => {
    expect(POINT_FRAGMENT_SHADER).toContain(
      'float pixelScale = max(length(dFdx(coord)), length(dFdy(coord)));',
    );
    // fwidth() is the L1 norm of the partials, so on a radial distance field it reads ~41%
    // larger along the diagonals than along the axes. Any `aa` in the ring block makes the ring
    // width angle-dependent, which pinches the hole into a cross instead of a circle.
    const ringStart = POINT_FRAGMENT_SHADER.indexOf('if (v_predicted > 0.5)');
    const ringEnd = POINT_FRAGMENT_SHADER.indexOf('if (shapeAlpha < 0.001)');
    expect(ringStart).toBeGreaterThan(-1);
    expect(ringEnd).toBeGreaterThan(ringStart);
    expect(POINT_FRAGMENT_SHADER.slice(ringStart, ringEnd)).not.toMatch(/\baa\b/);
  });

  it('makes the predicted interior hollow via a single revertible flag', () => {
    expect(POINT_FRAGMENT_SHADER).toContain('const float PREDICTED_INTERIOR_FILL = 0.0;');
    expect(POINT_FRAGMENT_SHADER).toContain(
      'mix(pointAlpha, PREDICTED_INTERIOR_FILL, predictedInterior)',
    );
  });

  it('raises a faded hollow marker on a dark plot only, and keeps it under a shown point', () => {
    // The gain is worked out on the CPU (pointKnockoutUniforms): 1 on a light plot.
    expect(POINT_FRAGMENT_SHADER).toContain('uniform float u_hollowFadeGain;');
    expect(POINT_FRAGMENT_SHADER).toContain(
      'if (v_predicted > 0.5 && pointAlpha < HOLLOW_DARK_FADE_CEILING) {',
    );
    expect(POINT_FRAGMENT_SHADER).toContain(
      'pointAlpha = min(pointAlpha * u_hollowFadeGain, HOLLOW_DARK_FADE_CEILING);',
    );
    // No per-fragment pow or luminance of the background.
    expect(POINT_FRAGMENT_SHADER).not.toContain('pow(max(u_knockoutColor');
    expect(POINT_FRAGMENT_SHADER).toContain('const float HOLLOW_DARK_FADE_CEILING = 0.5;');
    // Both the alpha and the premultiplied colour take the raised alpha.
    expect(POINT_FRAGMENT_SHADER).toContain('mix(finalColor * pointAlpha,');
    expect(POINT_FRAGMENT_SHADER).not.toContain('finalColor * v_color.a');
  });

  describe('outline (#369)', () => {
    it('sizes the outline from a radius fraction, a device-pixel floor, and a budget', () => {
      // Why all three terms are needed is on the constants themselves.
      expect(POINT_FRAGMENT_SHADER).toContain(
        'min(max(OUTLINE_RADIUS_FRACTION, OUTLINE_DEVICE_PX * fieldPerPixel), outlineBudget)',
      );
    });

    it('converts device pixels through the edgeDist gradient, not the sprite pixel scale', () => {
      // The width floor must convert through the field's own gradient, not pixelScale — see
      // the fieldPerPixel comment for why the diamond makes the two differ.
      expect(POINT_FRAGMENT_SHADER).toContain(
        'length(vec2(dFdx(edgeDist), dFdy(edgeDist))), pixelScale, pixelScale * 2.0)',
      );
      // ...and it must be hoisted above the ring block, like pixelScale, so both share one origin.
      const scaleDecl = POINT_FRAGMENT_SHADER.indexOf(
        'float pixelScale = max(length(dFdx(coord)), length(dFdy(coord)));',
      );
      const fieldDecl = POINT_FRAGMENT_SHADER.indexOf('float fieldPerPixel = clamp(');
      const ringBlock = POINT_FRAGMENT_SHADER.indexOf('if (v_predicted > 0.5)');
      expect(scaleDecl).toBeGreaterThan(-1);
      expect(ringBlock).toBeGreaterThan(fieldDecl);
      expect(fieldDecl).toBeGreaterThan(scaleDecl);
    });

    it('applies one outline treatment to both glyph classes', () => {
      // The literal "reconcile" of #369. The outline code must not branch on the predicted flag
      // at all — everything class-specific is carried by outlineBudget, resolved up in the ring
      // block — so filled-vs-hollow stays the only thing telling the two classes apart.
      const outlineStart = POINT_FRAGMENT_SHADER.indexOf('float outlineWidth =');
      const outlineEnd = POINT_FRAGMENT_SHADER.indexOf('// Predicted interiors mix toward');
      expect(outlineStart).toBeGreaterThan(-1);
      expect(outlineEnd).toBeGreaterThan(outlineStart);
      expect(POINT_FRAGMENT_SHADER.slice(outlineStart, outlineEnd)).not.toContain('v_predicted');
    });

    it('budget-caps the outline against ring width so it cannot eat the annulus', () => {
      // An unbudgeted outer darken consumes 27-50% of the ring at every size, and specifically
      // the outer part, where shapeAlpha is already fading it out. Assert the cap is applied,
      // not merely that the constant is declared.
      expect(POINT_FRAGMENT_SHADER).toContain('outlineBudget = ringWidth * OUTLINE_RING_BUDGET;');
    });

    it('feathers the outline over pixelScale, so the ramp cannot outgrow the band', () => {
      // The width uses fieldPerPixel but the feather must not: on a ring outlineBudget caps the
      // band below one device pixel, so a fieldPerPixel-wide ramp is wider than the band it
      // softens and washes the rim out instead. On a diamond (gradient 2) that cost predicted
      // glyphs ~3x of their darkening at default point sizes.
      expect(POINT_FRAGMENT_SHADER).toContain(
        'smoothstep(outlineWidth - pixelScale, outlineWidth, edgeDist)',
      );
    });

    it('budget-caps the outline on filled dots too, so a small sprite keeps its hue', () => {
      // The device-pixel floor is unbounded as the sprite shrinks; without a cap a dense view
      // renders every dot up to 50% darker than the hue its legend swatch shows.
      expect(POINT_FRAGMENT_SHADER).toContain('const float OUTLINE_DOT_BUDGET = 0.35;');
      expect(POINT_FRAGMENT_SHADER).toContain('float outlineBudget = OUTLINE_DOT_BUDGET;');
    });

    it('anti-aliases the outline inner edge', () => {
      // The old inner edge was a hard `if` threshold on a field whose outer edge is smoothed.
      expect(POINT_FRAGMENT_SHADER).toMatch(/smoothstep\([^)]*outline/i);
    });
  });

  describe('multi-label atlas sampling', () => {
    it('declares highp int, so the atlas index is defined past 32767 points', () => {
      // ES 3.00 defaults fragment int to mediump (>= 16 bits). v_pointIndex and the
      // index derived from it exceed that at any dataset past ~32K points, so on a
      // driver honouring the minimum they were undefined — on exactly the low-end
      // hardware the atlas limits are about.
      expect(POINT_FRAGMENT_SHADER).toContain('precision highp int;');
    });

    it('refuses to sample beyond what the atlas covers', () => {
      // Zero capacity means "no atlas": every marker must fall through to its
      // dominant colour rather than sampling storage that was never allocated,
      // which rendered solid black discs.
      expect(POINT_FRAGMENT_SHADER).toContain('uniform int u_labelAtlasCapacity;');
      expect(POINT_FRAGMENT_SHADER).toContain(
        'if (v_labelCount > 1.5 && v_pointIndex < u_labelAtlasCapacity)',
      );
    });

    it('clamps the slice count to the reserved stride', () => {
      // Unclamped, a point with more colours than the stride indexed into the NEXT
      // point's texels and painted an unrelated protein's colours.
      expect(POINT_FRAGMENT_SHADER).toContain(
        'float count = min(floor(v_labelCount + 0.5), float(u_maxLabels));',
      );
    });

    it('clamps the slice index to the last slice of this point', () => {
      // atan(+0, x < 0) is exactly +PI, so the normalised sweep reaches 1.0 on the
      // middle pixel row of any odd-height sprite and sliceIndex reached `count`.
      expect(POINT_FRAGMENT_SHADER).toContain(
        'float sliceIndex = min(floor(normalizedAngle * count), count - 1.0);',
      );
    });
  });
});

import { focusRing, kitHost, reducedMotion, srOnly } from '../kit/kit-shared.styles';
import { layoutStyles } from './styles/layout';
import { headerStyles } from './styles/header';
import { rowStyles } from './styles/row';
import { pickerStyles } from './styles/picker';
import { eatStyles } from './styles/eat';
import { stripStyles } from './styles/strips';

/**
 * The legend's one stylesheet, on `--ps-*` tokens only: the kit's shared sheets (host font and
 * colour, the focus ring, reduced motion, the visually-hidden class), then one module per piece
 * of the element. The Other and settings popovers are child elements with their own sheets.
 *
 * @see /docs/developers/style-architecture.md
 */
export const legendStyles = [
  kitHost,
  focusRing,
  reducedMotion,
  srOnly,
  layoutStyles,
  headerStyles,
  rowStyles,
  pickerStyles,
  eatStyles,
  stripStyles,
];

import { DIFFS_TAG_NAME } from '../constants';
import styles from '../style.css';

const supportsConstructedStyleSheets = typeof CSSStyleSheet !== 'undefined';
const styledShadowRoots = new WeakSet<ShadowRoot>();
let sheet: CSSStyleSheet | undefined;

function getDiffsStyleSheet(): CSSStyleSheet | undefined {
  if (!supportsConstructedStyleSheets) {
    return undefined;
  }
  if (sheet == null) {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(styles);
  }
  return sheet;
}

export function ensureDiffsShadowRoot(
  element: HTMLElement,
  adoptStyles = true
): ShadowRoot {
  const shadowRoot =
    element.shadowRoot ?? element.attachShadow({ mode: 'open' });
  const styleSheet = adoptStyles ? getDiffsStyleSheet() : undefined;
  if (styleSheet != null && !styledShadowRoots.has(shadowRoot)) {
    shadowRoot.adoptedStyleSheets = [
      ...shadowRoot.adoptedStyleSheets,
      styleSheet,
    ];
    styledShadowRoots.add(shadowRoot);
  }
  return shadowRoot;
}

// If HTMLElement is undefined it usually means we are in a server environment
// so best to just not do anything
if (
  typeof HTMLElement !== 'undefined' &&
  customElements.get(DIFFS_TAG_NAME) == null
) {
  class FileDiffContainer extends HTMLElement {}

  customElements.define(DIFFS_TAG_NAME, FileDiffContainer);
}

export const DiffsContainerLoaded = true;

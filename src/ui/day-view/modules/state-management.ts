/**
 * State management functions for day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DOMRefs } from './renderers.js';

/**
 * Toggle between compact and expanded view
 */
export function toggleExpanded(
  appInstance: App | null,
  domRefs: DOMRefs,
  stateRefs: { isExpanded: { value: boolean } },
  onStateChange?: () => void
): void {
  stateRefs.isExpanded.value = !stateRefs.isExpanded.value;

  if (stateRefs.isExpanded.value) {
    domRefs.timeGrid.classList.remove('compact');
    domRefs.expandToggle.classList.add('expanded');
    domRefs.toggleText.textContent = 'Show less';
  } else {
    domRefs.timeGrid.classList.add('compact');
    domRefs.expandToggle.classList.remove('expanded');
    const hidden = Number(domRefs.expandToggle.dataset.hiddenCount || 0);
    domRefs.toggleText.textContent = hidden > 0 ? `Show more (${hidden})` : 'Show more';
    // Restore scroll position for compact mode
    const target = domRefs.expandToggle.dataset.scrollTarget;
    if (target) {
      void domRefs.timeGrid.offsetHeight;
      domRefs.timeGrid.scrollTop = parseFloat(target);
    }
  }

  // Notify host of size change
  if (appInstance) {
    // Let auto-resize handle it, or explicitly send size
    const height = document.documentElement.scrollHeight;
    appInstance.sendSizeChanged({ height }).catch(() => {
      // Ignore errors - host may not support this
    });
  }

  onStateChange?.();
}

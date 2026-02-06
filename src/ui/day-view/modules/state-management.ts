/**
 * State management functions for day view and multi-day view
 */

import type { App } from '@modelcontextprotocol/ext-apps';
import type { DOMRefs } from './renderers.js';

/**
 * Maximum number of expanded days to prevent unbounded memory growth
 */
export const MAX_EXPANDED_DAYS = 50;

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
    domRefs.toggleText.textContent = 'Show more';
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

/**
 * Toggle expanded state for a day in multi-day view
 */
export function toggleDayExpanded(
  dateStr: string,
  appInstance: App | null,
  expandedDays: Set<string>,
  onStateChange?: () => void
): void {
  const group = document.querySelector(`[data-date="${dateStr}"]`) as HTMLDivElement | null;
  if (!group) return;

  const header = group.querySelector('.date-header') as HTMLDivElement | null;
  const eventsContainer = group.querySelector('.date-events') as HTMLDivElement | null;

  if (!header || !eventsContainer) return;

  const isCurrentlyExpanded = expandedDays.has(dateStr);

  if (isCurrentlyExpanded) {
    expandedDays.delete(dateStr);
    header.classList.remove('expanded');
    header.setAttribute('aria-expanded', 'false');
    eventsContainer.classList.add('collapsed');
  } else {
    // Check if we're at the limit before adding
    if (expandedDays.size >= MAX_EXPANDED_DAYS) {
      // Remove the oldest entry (first item in Set iteration order)
      const oldest = Array.from(expandedDays)[0];
      expandedDays.delete(oldest);
      // Also collapse the oldest day's UI
      const oldestGroup = document.querySelector(`[data-date="${oldest}"]`) as HTMLDivElement | null;
      if (oldestGroup) {
        const oldestHeader = oldestGroup.querySelector('.date-header') as HTMLDivElement | null;
        const oldestContainer = oldestGroup.querySelector('.date-events') as HTMLDivElement | null;
        if (oldestHeader) {
          oldestHeader.classList.remove('expanded');
          oldestHeader.setAttribute('aria-expanded', 'false');
        }
        if (oldestContainer) {
          oldestContainer.classList.add('collapsed');
        }
      }
    }
    expandedDays.add(dateStr);
    header.classList.add('expanded');
    header.setAttribute('aria-expanded', 'true');
    eventsContainer.classList.remove('collapsed');
  }

  // Notify host of size change
  if (appInstance) {
    setTimeout(() => {
      const height = document.documentElement.scrollHeight;
      appInstance?.sendSizeChanged({ height }).catch(() => {});
    }, 50);
  }

  onStateChange?.();
}

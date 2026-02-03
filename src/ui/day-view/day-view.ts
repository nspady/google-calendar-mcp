import { App, applyHostStyleVariables, applyHostFonts, applyDocumentTheme } from '@modelcontextprotocol/ext-apps';

// Import formatting functions
import { setHostContext } from './modules/formatting.js';

// Import renderers
import {
  renderDayView,
  renderMultiDayView,
  showLoadingState,
  showCancelledState,
  type DOMRefs
} from './modules/renderers.js';

// Import state management
import { toggleExpanded, toggleDayExpanded } from './modules/state-management.js';

// Import context extraction
import { extractDayContext, extractMultiDayContext } from './modules/context-extraction.js';

// DOM element references - Day view
const dayViewContainer = document.getElementById('day-view-container') as HTMLDivElement;
const dayViewHeader = document.getElementById('day-view-header') as HTMLDivElement;
const dateHeading = document.getElementById('date-heading') as HTMLHeadingElement;
const dayLink = document.getElementById('day-link') as HTMLAnchorElement;
const calendarLegendContainer = document.getElementById('calendar-legend-container') as HTMLDivElement;
const allDaySection = document.getElementById('all-day-section') as HTMLDivElement;
const allDayEvents = document.getElementById('all-day-events') as HTMLDivElement;
const timeGrid = document.getElementById('time-grid') as HTMLDivElement;
const expandToggle = document.getElementById('expand-toggle') as HTMLButtonElement;
const toggleText = document.getElementById('toggle-text') as HTMLSpanElement;

// DOM element references - Multi-day view
const multiDayViewContainer = document.getElementById('multi-day-view-container') as HTMLDivElement;
const multiDayHeading = document.getElementById('multi-day-heading') as HTMLHeadingElement;
const multiDaySubheading = document.getElementById('multi-day-subheading') as HTMLDivElement;
const multiDayLink = document.getElementById('multi-day-link') as HTMLAnchorElement;
const multiDayEventsList = document.getElementById('multi-day-events-list') as HTMLDivElement;

// Global app instance for opening links (sandboxed iframe requires app.openLink)
let appInstance: App | null = null;

// State references
const stateRefs = {
  isExpanded: { value: false },
  expandedDays: new Set<string>(),
  hostLocale: undefined as string | undefined
};

// Host context for locale/timezone formatting (stored here, used by imported modules)
let hostLocale: string | undefined;
let hostTimeZone: string | undefined;

// Create DOM references object
const domRefs: DOMRefs = {
  // Day view
  dayViewContainer,
  dayViewHeader,
  dateHeading,
  dayLink,
  calendarLegendContainer,
  allDaySection,
  allDayEvents,
  timeGrid,
  expandToggle,
  toggleText,

  // Multi-day view
  multiDayViewContainer,
  multiDayHeading,
  multiDaySubheading,
  multiDayLink,
  multiDayEventsList
};

/**
 * Apply host styles and context if available
 */
function applyHostStyles(app: App): void {
  const context = app.getHostContext();
  if (!context) return;

  // Store locale and timezone for date/time formatting (in both local vars and formatting module)
  if (context.locale) {
    hostLocale = context.locale;
    stateRefs.hostLocale = context.locale;
  }
  if (context.timeZone) {
    hostTimeZone = context.timeZone;
  }
  setHostContext(hostLocale, hostTimeZone);

  // Apply style variables from host
  if (context.styles?.variables) {
    applyHostStyleVariables(context.styles.variables);
  }

  // Apply host fonts
  if (context.styles?.css?.fonts) {
    applyHostFonts(context.styles.css.fonts);
  }

  // Apply theme using the proper helper (sets data-theme and color-scheme)
  if (context.theme) {
    applyDocumentTheme(context.theme);
  }
}

/**
 * Initialize the app
 */
async function init(): Promise<void> {
  const app = new App(
    { name: 'DayView', version: '1.0.0' },
    {} // No special capabilities needed
  );

  // Store app instance globally for openLink calls
  appInstance = app;

  // Handle tool input - show loading state while tool executes
  app.ontoolinput = () => {
    showLoadingState(domRefs);
  };

  // Handle tool results
  app.ontoolresult = (params) => {
    // Check for multi-day context first (multi-day queries, search results)
    const multiDayContext = extractMultiDayContext(params);
    if (multiDayContext) {
      renderMultiDayView(
        multiDayContext,
        appInstance,
        domRefs,
        (dateStr: string) => toggleDayExpanded(dateStr, appInstance, stateRefs.expandedDays),
        stateRefs
      );
      return;
    }

    // Check for single-day context (single-day queries)
    const dayContext = extractDayContext(params);
    if (dayContext) {
      renderDayView(
        dayContext,
        appInstance,
        domRefs,
        () => toggleExpanded(appInstance, domRefs, stateRefs),
        stateRefs
      );
    }
  };

  // Handle tool cancellation
  app.ontoolcancelled = (params) => {
    showCancelledState(domRefs, params.reason);
  };

  // Handle host context changes (theme, locale, etc.)
  app.onhostcontextchanged = () => {
    applyHostStyles(app);
  };

  // Handle graceful teardown
  app.onteardown = async () => {
    // Clean up any resources if needed
    appInstance = null;
    return {};
  };

  try {
    await app.connect();
    applyHostStyles(app);
  } catch (error) {
    console.error('Failed to connect to host:', error);
    domRefs.dateHeading.textContent = 'Failed to connect';
  }
}

// Start the app
init();

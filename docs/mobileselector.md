# VelveraHub mobile location selector

## Purpose

This is the current implementation record for the delivery-location selector.
It is intended to be shared for faculty feedback and describes the styling and
interaction that is in the website now.

The website is a plain HTML, CSS, and JavaScript site. The selector does not
require a build step, framework, or package installation.

## Where it is implemented

- Markup source: `index.html` and the shared header markup in
  `assets/js/components/site-navigation.js`
- Interaction and generated options:
  `assets/js/components/custom-select.js`
- Styling: `assets/css/components/custom-select.css`
- Location data and persistence: `assets/js/services/region.js`

The existing native `#headerLocationSelect` remains the source of truth. The
custom trigger mirrors its value, while the native control is visually hidden
for progressive enhancement and existing JavaScript compatibility.

## Important positioning fix

The mobile panel is portaled directly to `document.body` when the custom
selector is created. It is not left inside the sticky `.navbar`.

The navbar has `backdrop-filter`. Browsers treat an element with that property
as a containing block and stacking context for fixed-position descendants.
When the panel was nested inside the navbar, `position: fixed` was calculated
from the header instead of the viewport. The panel therefore opened offset from
the top-left and could sit below the mobile bottom navigation.

The panel now:

- uses viewport coordinates on mobile: `top: 0`, `right: 0`, `bottom: 0`,
  `left: 0`;
- uses `z-index: 4000`, above the navbar and mobile bottom navigation;
- is explicitly opened with `.cs-location-panel.is-open`;
- is positioned from the trigger rectangle on desktop without changing the
  desktop visual treatment;
- closes when the back button, Escape key, an option, or an outside area is
  used.

This removes the dependency on CSS nesting and prevents the navbar's visual
effects from changing the mobile panel geometry.

On desktop, the same body-level panel uses `position: fixed` and is placed
against the trigger's viewport rectangle. Its width is at least `180px`, it
is clamped to an `8px` viewport edge inset, and it opens upward when the
available space below the trigger is too small. Scrolling and resizing
recalculate the placement, so the panel stays attached to the location trigger
without changing the desktop navbar layout.

## Mobile breakpoint and viewport range

The full-screen panel applies at:

```css
@media (max-width: 768px)
```

The design target is narrow mobile screens from 320px through 430px. The
layout also uses `100dvh` where supported so browser address-bar changes do
not leave a visible gap.

## Current visual design

| Element | Current value |
| --- | --- |
| Brand purple | `#6D28D9` |
| Primary text | `#374151` |
| Muted text | `#78909C` |
| Count/secondary muted text | `#9DB0BA` |
| Section background | `#EEF5F9` |
| Row border | `#E7EDF0` |
| Panel and row background | `#FFFFFF` |
| Mobile panel layer | `z-index: 4000` |
| Mobile header height | `84px + safe-area top inset` |
| Search field height | `56px` |
| Search field radius | `12px` |
| Search field horizontal padding | `12px` right, `76px` left |
| Search text | `16px`, normal weight, Inter/system sans |
| Back button | `18px` chevron and visible `13px` “Back” label, centered in the search field |
| Summary row minimum height | `72px` |
| Option row minimum height | `64px` |
| Option text | `16px`, normal weight, Inter/system sans |
| Section label minimum height | `30px` |
| Section label horizontal padding | `20px` |

## Generated mobile structure

The custom control keeps the trigger next to the hidden native select. The
location panel itself is attached to `body` so it can cover the complete
viewport:

```html
<div class="header-location-select">
  <i class="fas fa-location-dot"></i>
  <div class="cs-select">
    <select id="headerLocationSelect" class="cs-native">
      <!-- Existing RegionService options -->
    </select>
    <button class="cs-trigger" aria-haspopup="listbox" aria-expanded="false">
      <span class="cs-trigger-label">All States</span>
      <span class="cs-arrow"></span>
    </button>
  </div>
</div>

<!-- Appended to document.body, not nested inside .navbar -->
<div
  class="cs-panel cs-location-panel"
  role="dialog"
  aria-modal="true"
  aria-label="Search delivery location"
>
  <div class="cs-mobile-header">
    <div class="cs-mobile-search">
      <button class="cs-mobile-back" type="button">
        <span class="cs-mobile-chevron" aria-hidden="true">
          <svg viewBox="0 0 28 28"><path d="m17.5 5.5-8 8.5 8 8.5" /></svg>
        </span>
        <span class="cs-mobile-back-label">Back</span>
      </button>
      <input
        type="search"
        placeholder="Find state, city or district..."
        aria-label="Find state, city or district"
      />
    </div>
  </div>

  <ul class="cs-list" role="listbox">
    <li class="cs-location-summary">
      <span class="cs-location-name">All States</span>
    </li>
    <li class="cs-location-section">POPULAR</li>
    <li class="cs-option" role="option">
      <span class="cs-option-name">Abuja (FCT)</span>
      <i class="cs-option-chevron" aria-hidden="true"></i>
    </li>
    <li class="cs-location-section">OTHER</li>
    <!-- Remaining RegionService locations are generated dynamically -->
  </ul>

  <li class="cs-location-empty" hidden>No locations found</li>
</div>
```

The final empty-state element is appended by JavaScript alongside the list.
The simplified structure above shows its role; in the live DOM it is not a
child of the `ul`.

The summary label and options come from `RegionService`. Nigeria currently
uses the configured state list or locations returned by the existing location
endpoint. UK mode uses the configured UK regions.

## Current mobile CSS

This is the authoritative mobile styling. The source of truth is
`assets/css/components/custom-select.css`; this block is kept here for review:

```css
@media (max-width: 768px) {
  .cs-location-panel {
    position: fixed !important;
    inset: 0 !important;
    width: 100vw;
    width: 100dvw;
    min-width: 0;
    min-height: 100vh;
    min-height: 100dvh;
    height: 100vh;
    height: 100dvh;
    max-width: none;
    max-height: none;
    margin: 0 !important;
    box-sizing: border-box;
    z-index: 4000;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    padding: 0;
    border: 0;
    border-radius: 0;
    background: #FFFFFF;
    transform: translateX(100%);
  }

  .cs-location-panel.is-open {
    transform: translateX(0);
  }

  .cs-location-panel .cs-mobile-header {
    position: relative;
    display: block;
    flex: 0 0 calc(84px + env(safe-area-inset-top));
    min-height: calc(84px + env(safe-area-inset-top));
    height: calc(84px + env(safe-area-inset-top));
    padding: calc(12px + env(safe-area-inset-top)) 12px 16px;
    box-sizing: border-box;
    background: #6D28D9;
    z-index: 2;
  }

  .cs-location-panel .cs-mobile-search {
    display: flex;
    align-items: center;
    position: relative;
    width: 100%;
    height: 56px;
    padding: 0 12px 0 76px;
    box-sizing: border-box;
    border-radius: 12px;
    background: #FFFFFF;
    color: #78909C;
  }

  .cs-mobile-search input {
    width: 100%;
    border: 0;
    outline: 0;
    background: transparent;
    color: #374151;
    font: 400 16px/1.2 Inter, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .cs-mobile-back {
    display: flex;
    align-items: center;
    justify-content: flex-start;
    position: absolute;
    left: 12px;
    top: 50%;
    width: auto;
    height: 36px;
    padding: 0 4px;
    border: 0;
    background: transparent;
    color: #6D28D9;
    z-index: 3;
    transform: translateY(-50%);
    gap: 2px;
  }

  .cs-mobile-back-label {
    position: static;
    width: auto;
    height: auto;
    overflow: visible;
    clip: auto;
    white-space: nowrap;
    color: #6D28D9;
    font: 500 13px/1 Inter, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .cs-mobile-search input::placeholder {
    color: #78909C;
    opacity: 1;
  }

  .cs-location-panel .cs-list {
    flex: 1 1 auto;
    width: 100%;
    max-height: none;
    padding: 0 0 calc(5rem + env(safe-area-inset-bottom));
    overflow-y: auto;
    overflow-x: hidden;
  }

  .cs-location-summary {
    display: flex;
    align-items: baseline;
    min-height: 72px;
    padding: 20px;
    box-sizing: border-box;
    color: #374151;
    font: 400 18px/1.2 Inter, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .cs-location-section {
    display: flex;
    align-items: center;
    min-height: 30px;
    padding: 0 20px;
    box-sizing: border-box;
    background: #EEF5F9;
    color: #78909C;
    font: 400 16px/1 Inter, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .cs-location-panel .cs-option {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: 64px;
    padding: 0.75rem 20px;
    box-sizing: border-box;
    border-bottom: 1px solid #E7EDF0;
    color: #374151;
    font: 400 16px/1.25 Inter, -apple-system, BlinkMacSystemFont,
      "Segoe UI", sans-serif;
  }

  .cs-location-panel .cs-option span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .cs-location-panel .cs-option i {
    flex: 0 0 20px;
    color: #78909C;
    font-size: 20px;
  }

  .cs-location-empty {
    padding: 1.5rem;
    color: #6B7280;
    font-size: 0.95rem;
    text-align: center;
  }
}

@media (max-width: 768px) {
  body.location-search-open {
    overflow: hidden;
  }

  body.location-search-open .mobile-bottom-nav {
    visibility: hidden;
    pointer-events: none;
  }
}
```

The shared custom-select base rule also sets the open panel to
`visibility: visible`, `opacity: 1`, and `pointer-events: auto`. The mobile
state then supplies the horizontal slide transition.

## Interaction behavior

1. Tapping the header location trigger opens the panel.
2. The panel slides from right to left until it covers the viewport.
3. The page body cannot scroll while the panel is open.
4. The mobile bottom navigation is hidden and cannot receive pointer events.
5. The search field trims the query and filters case-insensitively.
6. The summary row is hidden while a search query is present.
7. `POPULAR` and `OTHER` are hidden when their visible option group is empty.
8. A `No locations found` message appears when no locations match.
9. Disabled options remain visible but cannot be selected.
10. Selecting a location updates the existing native select, local storage,
    header label, and any other location selector through `RegionService`.
11. The back button and Escape key close the panel and clear the search query.
12. Clicking outside the trigger or panel closes the panel.

## Verification targets

For faculty review, the intended mobile result is:

- at 320px, 390px, and 430px widths, the panel begins exactly at the viewport
  top-left corner and fills the viewport;
- the purple header is always 84px high before the list begins;
- the white search field is 56px high and remains inside the purple header;
- the visible Back label and the search placeholder share one centered row;
- option rows remain full width, separated by one-pixel borders, and scroll
  vertically;
- the bottom navigation is not visible above the location panel;
- filtering `lagos` leaves only the Lagos option and keeps the search field
  open;
- selecting Lagos closes the panel and changes the header pill to `Lagos`;
- desktop opening still places the options below the location trigger rather
  than changing the desktop header layout, and desktop scrolling keeps the
  panel aligned to that trigger.

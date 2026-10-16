# VelveraHub custom dropdown structure

This document describes the shared custom dropdown used by the root app,
`velverahub-ng/`, and `velverahub-uk/`. The implementation is intentionally
progressive: the original native `<select>` remains the source of truth, while
JavaScript adds a styled trigger and an accessible option panel around it.

## Source files

Each app tree has the same two files:

- `assets/js/components/custom-select.js` — enhancement, state, keyboard input,
  positioning, option rendering, and event synchronization.
- `assets/css/components/custom-select.css` — all `.cs-*` visual states and
  responsive rules.

Pages opt in by loading both files. The script enhances every
`select:not([data-cs-enhanced])` after `DOMContentLoaded`, and also watches for
new selects inserted later by page code.

## Original markup

The page should use a normal select. Do not hand-write `.cs-select`,
`.cs-trigger`, or `.cs-panel` markup in HTML:

```html
<div class="form-group">
  <label for="productCategory">Category</label>
  <select id="productCategory" name="category" required>
    <option value="">Choose a category</option>
    <option value="electronics">Electronics</option>
    <option value="fashion">Fashion</option>
  </select>
</div>
```

The native element must keep its real `id`, `name`, `value`, `required`,
`disabled`, and `<option>` values. Existing code should continue to read
`select.value` and listen for the native `change` event.

## Generated DOM structure

For each eligible select, `custom-select.js` creates this structure:

```html
<div class="cs-select">
  <select class="cs-native" data-cs-enhanced="true">
    <!-- original options remain here -->
  </select>

  <button
    type="button"
    class="cs-trigger [original-select-classes]"
    aria-haspopup="listbox"
    aria-expanded="false">
    <span class="cs-trigger-label">Choose a category</span>
    <span class="cs-arrow" aria-hidden="true">
      <!-- inline chevron SVG -->
    </span>
  </button>
</div>

<!-- appended directly to document.body, not inside the wrapper -->
<div class="cs-panel">
  <ul class="cs-list" role="listbox">
    <li class="cs-option" role="option" data-value="electronics">
      Electronics
    </li>
  </ul>
</div>
```

The real output includes generated IDs/attributes and may include
`aria-selected`, disabled option state, or location-specific elements. The
panel is appended to `body` on purpose. This prevents parent `overflow`,
transforms, backdrop filters, and sticky/mobile containers from clipping or
misplacing an open dropdown.

## Important class responsibilities

### `.cs-select`

Wrapper around the original select and trigger. It copies relevant layout
properties from the select, including width, flex sizing, and margins. The
wrapper receives `.is-open` while the panel is open.

### `.cs-native`

Visually hidden native select. It is not removed and should never be replaced
with a second application state. Code must update this element's value.

### `.cs-trigger`

Visible button. It receives the original select's classes so context-specific
rules can style search-bar, form, filter, checkout, and location controls.
`aria-expanded` is updated on open and close.

### `.cs-trigger-label`

Displays the selected option's text. It uses ellipsis for narrow controls.
`updateLabel()` reads the current native select value and updates this span.

### `.cs-arrow`

Decorative inline chevron. CSS rotates it when `.cs-select.is-open` is set.

### `.cs-panel`

Fixed-position floating panel. It is positioned from the trigger's viewport
rectangle by JavaScript and receives `.is-open` when visible. Do not move it
inside a card or form to “fix” a visual issue.

### `.cs-list` and `.cs-option`

The scrollable list and its individual options. `.is-selected` marks the
current option, `.is-disabled` marks an unavailable option, and `hidden`
options are used by the location search filter.

## Location dropdown special case

The header location select has `id="headerLocationSelect"`. It gets the
additional class `.cs-location-panel` and a mobile-only header containing:

```html
<div class="cs-mobile-header">
  <div class="cs-mobile-search">
    <button class="cs-mobile-back" type="button">Back</button>
    <input type="search"
      placeholder="Search state, city, campus or landmark..."
      aria-label="Search state, city, campus or landmark">
  </div>
</div>
```

Location options can be grouped into country/state/city/school sections.
`RegionService` and `CampusService` populate the original select; the custom
panel is refreshed with:

```js
window.CustomSelect.refresh(document.getElementById('headerLocationSelect'));
```

The location panel is hidden on desktop where the normal compact dropdown is
used, and becomes a full-width mobile surface according to the location rules
in `custom-select.css`.

## Interaction lifecycle

1. `buildCustomSelect(select)` wraps the native select and creates the trigger
   and body-level panel.
2. `renderOptions()` mirrors the current `<option>` list into `.cs-option`
   elements.
3. `updateLabel()` mirrors the selected option text into the trigger.
4. Clicking the trigger calls `openPanel()` and positions the fixed panel.
5. Clicking an option sets `select.value`, dispatches a bubbling native
   `change` event, refreshes the label, and closes the panel.
6. Escape, an outside click, resize, and scroll close or reposition the panel
   as appropriate.
7. A `MutationObserver` refreshes the option list when page code adds or
   disables options.

Keyboard support is on the trigger: Enter/Space toggles it, Escape closes it,
and Arrow Up/Down changes the native select value while dispatching `change`.

## Supported public API

```js
// Enhance selects in the document or a supplied root.
window.CustomSelect.enhanceAll(root);

// Refresh options and label after external code changes the select.
window.CustomSelect.refresh(selectElement);
```

Use `refresh()` after changing options through `innerHTML`, appending location
options, or changing the selected value programmatically. The MutationObserver
usually handles option changes automatically, but an explicit refresh is
clearer after a batch update.

## Rules that prevent recurring breakage

1. Keep the native select in the DOM; do not create a separate selected-value
   variable.
2. Change the native select first, then dispatch
   `new Event('change', { bubbles: true })`.
3. Do not target only `.cs-trigger` in application logic. The native select is
   the durable form value.
4. Do not add another click handler that manually toggles panel visibility.
5. Do not add `overflow: hidden`, transforms, or a new stacking context around
   `.cs-panel`; it is deliberately portaled to `document.body`.
6. Use `select.classList` for context-specific styling. The trigger inherits
   those classes when it is created.
7. When a select is dynamically inserted, call
   `window.CustomSelect.enhanceAll(container)` if the insertion occurs before
   the body observer is ready.
8. Never give generated panels duplicate IDs or move them into a modal without
   also rechecking fixed positioning and z-index behavior.

## Common failure symptoms

| Symptom | Check first |
| --- | --- |
| Label disappears after another page interaction | The code probably updates a separate label or changed `select.value` without calling `CustomSelect.refresh()`. |
| Option appears but does not save | The handler is listening to the generated `<li>` instead of the native select's `change` event. |
| Panel is clipped or appears behind a card | The panel was moved out of `body`, or a new stacking context/z-index rule was added. |
| Options are stale | The page changed the native options without a refresh or without allowing the observer to run. |
| Dropdown works only on one page | That page is missing `custom-select.js` or `custom-select.css`, or its select is already marked `data-cs-enhanced`. |
| Search/location list is empty | Check the original `headerLocationSelect` options and the `RegionService`/`CampusService` population event before changing CSS. |

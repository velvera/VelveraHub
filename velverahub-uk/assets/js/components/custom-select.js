/**
 * Global custom dropdown enhancer.
 * Progressively replaces every native <select> in the document with a
 * fully custom-styled glassy dropdown, while keeping the original
 * form control in the DOM (hidden) so existing code that reads `.value`
 * or listens for `change` events keeps working unmodified.
 */
(function () {
    var LAYOUT_PROPS = [
        'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf',
        'width', 'minWidth', 'maxWidth',
        'marginTop', 'marginRight', 'marginBottom', 'marginLeft'
    ];
    var RESPONSIVE_DIMENSION_PROPS = ['width', 'minWidth', 'maxWidth'];
    var nextListId = 0;

    function copyLayout(select, wrapper, preserveResponsiveDimensions) {
        var cs = window.getComputedStyle(select);
        LAYOUT_PROPS.forEach(function (prop) {
            if (preserveResponsiveDimensions && RESPONSIVE_DIMENSION_PROPS.includes(prop)) {
                /*
                 * Once enhanced, the native select is intentionally forced to
                 * 1px wide by .cs-native. Never copy those hidden dimensions
                 * back onto the visible wrapper during a viewport resize.
                 */
                wrapper.style[prop] = '';
                return;
            }
            wrapper.style[prop] = cs[prop];
        });
        if (cs.display === 'block') {
            wrapper.style.display = 'block';
        } else {
            wrapper.style.display = 'inline-block';
        }
        if (!preserveResponsiveDimensions && select.offsetWidth > 0 && !wrapper.style.width) {
            wrapper.style.width = cs.width;
        }
    }

    function buildCustomSelect(select) {
        if (select.dataset.csEnhanced) return;
        if (select.closest('.cs-select')) return;
        select.dataset.csEnhanced = 'true';

        var wrapper = document.createElement('div');
        wrapper.className = 'cs-select';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        copyLayout(select, wrapper);

        var trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'cs-trigger ' + select.className;
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (select.disabled) trigger.disabled = true;

        var label = document.createElement('span');
        label.className = 'cs-trigger-label';
        trigger.appendChild(label);

        var arrow = document.createElement('span');
        arrow.className = 'cs-arrow';
        arrow.innerHTML = '<svg width="11" height="7" viewBox="0 0 11 7" fill="none"><path d="M1 1.2L5.5 5.7L10 1.2" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
        trigger.appendChild(arrow);

        var panel = document.createElement('div');
        panel.className = 'cs-panel' +
            (select.id === 'headerLocationSelect' ? ' cs-location-panel' : '') +
            (select.dataset.categoryEnhanced === 'true' ? ' cs-panel--categories' : '') +
            (select.dataset.searchable === 'true' ? ' cs-panel--searchable' : '') +
            (select.closest('.modal') ? ' cs-panel--modal' : '');
        panel.dataset.selectId = select.id;
        if (select.id === 'headerLocationSelect') {
            panel.setAttribute('role', 'dialog');
            panel.setAttribute('aria-modal', 'true');
            panel.setAttribute('aria-label', 'Search delivery location');
        }
        if (select.id === 'headerLocationSelect') {
            var mobileHeader = document.createElement('div');
            mobileHeader.className = 'cs-mobile-header';
            mobileHeader.innerHTML = '<div class="cs-mobile-search"><button type="button" class="cs-mobile-back" data-no-processing aria-label="Back to locations"><span class="cs-mobile-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m17.5 5.5-8 8.5 8 8.5" /></svg></span><span class="cs-mobile-back-label">Back</span></button><input type="search" placeholder="Search state, city or district..." aria-label="Search state, city or district"></div>';
            panel.appendChild(mobileHeader);
        } else {
            var genericMobileHeader = document.createElement('div');
            genericMobileHeader.className = 'cs-mobile-header cs-generic-mobile-header';
            genericMobileHeader.innerHTML = '<button type="button" class="cs-mobile-back" data-no-processing aria-label="Close dropdown"><span class="cs-mobile-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m17.5 5.5-8 8.5 8 8.5" /></svg></span><span class="cs-mobile-back-label">Close</span></button><strong class="cs-mobile-panel-title"></strong>';
            genericMobileHeader.querySelector('.cs-mobile-panel-title').textContent =
                select.getAttribute('aria-label') || 'Choose an option';
            var genericHeaderRow = document.createElement('div');
            genericHeaderRow.className = 'cs-generic-header-row';
            genericHeaderRow.appendChild(genericMobileHeader.querySelector('.cs-mobile-back'));
            genericHeaderRow.appendChild(genericMobileHeader.querySelector('.cs-mobile-panel-title'));
            genericMobileHeader.appendChild(genericHeaderRow);
            if (select.dataset.searchable === 'true') {
                var categorySearch = document.createElement('label');
                categorySearch.className = 'cs-category-search';
                var searchPlaceholder = select.dataset.searchPlaceholder || 'Search categories...';
                var searchLabel = select.dataset.searchLabel || searchPlaceholder.replace(/\.\.\.$/, '');
                categorySearch.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i><input type="search" data-cs-search placeholder="' + escapeHtml(searchPlaceholder) + '" aria-label="' + escapeHtml(searchLabel) + '">';
                genericMobileHeader.appendChild(categorySearch);
            }
            panel.appendChild(genericMobileHeader);
        }
        var list = document.createElement('ul');
        list.className = 'cs-list';
        list.id = 'cs-listbox-' + (++nextListId);
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', select.getAttribute('aria-label') || 'Options');
        trigger.setAttribute('aria-controls', list.id);
        var listTitle = panel.querySelector('.cs-mobile-panel-title');
        if (listTitle) {
            listTitle.id = list.id + '-label';
            list.setAttribute('aria-labelledby', listTitle.id);
        }
        panel.appendChild(list);
        var emptyState = document.createElement('li');
        emptyState.className = 'cs-location-empty';
        emptyState.textContent = 'No locations found';
        emptyState.hidden = true;
        panel.appendChild(emptyState);
        var locationView = { mode: 'states', state: null };
        var categoryView = { parentId: null };
        var activeCategoryValue = null;
        select.classList.add('cs-native');
        select.tabIndex = -1;
        select.setAttribute('aria-hidden', 'true');
        panel.setAttribute('aria-hidden', 'true');

        function syncHeaderLocationOptions() {
            if (select.id !== 'headerLocationSelect') return;
            window.RegionService?.appendLocationOptions?.(select);
        }

        function escapeHtml(value) {
            return String(value ?? '').replace(/[&<>"']/g, function (character) {
                return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character];
            });
        }

        function findOption(value) {
            return Array.prototype.find.call(select.options, function (option) {
                return option.value === value;
            });
        }

        function selectLocation(value) {
            if (select.value !== value) {
                select.value = value;
                select.dispatchEvent(new Event('change', { bubbles: true }));
            }
            updateLabel();
        }

        /*
         * The native select is the only selection state. Panel rendering may
         * rebuild list items, but it must always reflect the value currently
         * held by the native control.
         */
        function getSelectedOption() {
            return findOption(select.value);
        }

        function appendLocationSummary(text, canGoBack) {
            var summary = document.createElement('li');
            summary.className = 'cs-location-summary';
            if (canGoBack) {
                var back = document.createElement('button');
                back.type = 'button';
                back.className = 'cs-location-inline-back';
                back.dataset.noProcessing = '';
                back.innerHTML = '<span aria-hidden="true">‹</span><span>All states</span>';
                back.addEventListener('click', function (event) {
                    event.stopPropagation();
                    restoreNavigationButton(back);
                    locationView.mode = 'states';
                    locationView.state = null;
                    renderOptions();
                });
                summary.appendChild(back);
                var title = document.createElement('strong');
                title.className = 'cs-location-summary-title';
                title.textContent = 'Whole ' + (text === 'FCT (Abuja)' ? 'Abuja (FCT)' : text);
                summary.appendChild(title);
            } else {
                var name = document.createElement('span');
                name.className = 'cs-location-name';
                name.textContent = text;
                summary.appendChild(name);
            }
            list.appendChild(summary);
        }

        function restoreNavigationButton(button) {
            if (!button) return;
            button.dataset.noProcessing = 'true';
            button.classList.remove('is-processing');
            button.removeAttribute('aria-busy');
            button.removeAttribute('data-processing-started');
            if (button.dataset.processingDisabled === 'true') {
                button.disabled = false;
                delete button.dataset.processingDisabled;
            }
        }

        function renderSchoolsForState(state) {
            var schools = window.CampusService?.getByState(state) || [];
            var places = (window.CampusService?.places?.() || [])
                .filter(function (place) { return place.state === state; });
            appendLocationSummary(state, true);

            var allInState = document.createElement('li');
            allInState.className = 'cs-option cs-school-all';
            allInState.setAttribute('role', 'option');
            allInState.dataset.value = state;
            allInState.innerHTML = '<span class="cs-option-name">All products in ' + escapeHtml(state === 'FCT (Abuja)' ? 'Abuja (FCT)' : state) + '</span><i class="cs-option-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg></i>';
            allInState.addEventListener('click', function () {
                window.RegionService?.setSchool?.(null);
                selectLocation(state);
                window.RegionService?.setPlace?.(null);
                closePanel();
            });
            list.appendChild(allInState);

            var popularPlaces = places.filter(function (place) { return place.popular; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
            var otherPlaces = places.filter(function (place) { return !place.popular; })
                .sort(function (a, b) { return a.name.localeCompare(b.name); });
            function appendPlaceSection(title, entries) {
                if (!entries.length) return;
                var section = document.createElement('li');
                section.className = 'cs-location-section';
                section.textContent = title;
                section.setAttribute('aria-hidden', 'true');
                list.appendChild(section);
                entries.forEach(function (place) {
                    var option = document.createElement('li');
                    option.className = 'cs-option cs-place-option';
                    option.setAttribute('role', 'option');
                    option.dataset.value = place.slug;
                    option.innerHTML = '<span class="cs-option-name">' + escapeHtml(place.name) +
                        '</span><i class="cs-option-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg></i>';
                    option.addEventListener('click', function () {
                        chooseLocationResult({ ...place, kind: 'place' });
                    });
                    list.appendChild(option);
                });
            }
            appendPlaceSection('POPULAR', popularPlaces);
            appendPlaceSection('OTHER', otherPlaces);

            if (schools.length && places.length) {
                var schoolSection = document.createElement('li');
                schoolSection.className = 'cs-location-section';
                schoolSection.textContent = 'SCHOOLS & CAMPUSES';
                schoolSection.setAttribute('aria-hidden', 'true');
                list.appendChild(schoolSection);
            }
            schools.forEach(function (school) {
                var li = document.createElement('li');
                li.className = 'cs-option cs-school-option' +
                    (window.RegionService?.school?.slug === school.slug ? ' is-selected' : '');
                li.setAttribute('role', 'option');
                li.dataset.value = school.slug;
                li.innerHTML = '<span class="cs-option-name"><strong>' + escapeHtml(school.name) + '</strong><small>' +
                    escapeHtml(school.type + ' · ' + school.city) + '</small></span>' +
                    '<i class="cs-option-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg></i>';
                li.addEventListener('click', function () {
                    selectLocation(state);
                    window.RegionService?.setSchool?.(school);
                    updateLabel();
                    closePanel();
                });
                list.appendChild(li);
            });
        }

        function renderStateOptions() {
            var options = Array.prototype.slice.call(select.options);
            var allOption = options.shift();
            appendLocationSummary(allOption ? allOption.textContent : 'All Nigeria', false);

            var popularNames = window.RegionService?.region === 'uk'
                ? []
                : ['FCT (Abuja)', 'Lagos', 'Ogun', 'Oyo', 'Rivers'];
            var popular = popularNames.map(function (name) {
                return options.find(function (option) { return option.value === name; });
            }).filter(Boolean);
            var popularValues = popular.map(function (option) { return option.value; });
            var other = options.filter(function (option) {
                return !popularValues.includes(option.value);
            }).sort(function (a, b) {
                return a.textContent.localeCompare(b.textContent);
            });
            options = popular.concat(other);

            options.forEach(function (opt, index) {
                if (index === 0) {
                    var popularLabel = document.createElement('li');
                    popularLabel.className = 'cs-location-section';
                    popularLabel.textContent = popular.length ? 'POPULAR' :
                        (window.RegionService?.region === 'uk' ? 'REGIONS' : 'LOCATIONS');
                    popularLabel.setAttribute('aria-hidden', 'true');
                    list.appendChild(popularLabel);
                }
                if (popular.length && index === popular.length) {
                    var otherLabel = document.createElement('li');
                    otherLabel.className = 'cs-location-section';
                    otherLabel.textContent = 'OTHER';
                    otherLabel.setAttribute('aria-hidden', 'true');
                    list.appendChild(otherLabel);
                }
                var li = document.createElement('li');
                li.className = 'cs-option' +
                    (opt.value === select.value ? ' is-selected' : '') +
                    (opt.disabled ? ' is-disabled' : '');
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                var optionName = opt.value === 'FCT (Abuja)' ? 'Abuja (FCT)' : opt.textContent;
                li.innerHTML = '<span class="cs-option-name">' + escapeHtml(optionName) + '</span>' +
                    '<i class="cs-option-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg></i>';
                if (!opt.disabled) {
                    li.addEventListener('click', function (event) {
                        var schools = window.CampusService?.getByState(opt.value) || [];
                        var places = (window.CampusService?.places?.() || [])
                            .filter(function (place) { return place.state === opt.value; });
                        if (schools.length || places.length) {
                            event.stopPropagation();
                            locationView.mode = 'schools';
                            locationView.state = opt.value;
                            renderOptions();
                            return;
                        }
                        window.RegionService?.setSchool?.(null);
                        selectLocation(opt.value);
                        closePanel();
                    });
                }
                list.appendChild(li);
            });
        }

        function chooseLocationResult(result) {
            if (!result) return;
            selectLocation(result.state);
            if (result.kind === 'campus') {
                window.RegionService?.setSchool?.(result);
            } else if (result.kind === 'state') {
                window.RegionService?.setSchool?.(null);
                window.RegionService?.setPlace?.(null);
            } else {
                window.RegionService?.setPlace?.(result);
            }
            updateLabel();
            closePanel();
        }

        function renderMobileSearchResults(query) {
            var results = window.RegionService?.searchLocations?.(query) || [];
            if (!results.length) {
                results = window.CampusService?.searchLocations?.(query) || [];
            }
            list.innerHTML = '';
            var heading = document.createElement('li');
            heading.className = 'cs-location-section';
            heading.textContent = results.length ? 'MATCHING LOCATIONS' : 'SEARCH';
            heading.setAttribute('aria-hidden', 'true');
            list.appendChild(heading);
            results.slice(0, 50).forEach(function (result) {
                var li = document.createElement('li');
                li.className = 'cs-option cs-location-search-result' +
                    (result.state === select.value && result.kind === 'state' ? ' is-selected' : '');
                li.setAttribute('role', 'option');
                li.dataset.value = result.state;
                var detail = result.kind === 'campus'
                    ? (result.type + ' · ' + (result.city || result.state))
                    : result.kind === 'state'
                        ? 'State-wide marketplace'
                        : ('Local area · ' + (result.city || result.state));
                    li.innerHTML = '<span class="cs-option-name"><strong>' + escapeHtml(result.name) +
                    '</strong><small>' + escapeHtml(detail + ' · ' + result.state) +
                    '</small></span><i class="cs-option-chevron" aria-hidden="true"><svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg></i>';
                li.addEventListener('click', function () {
                    chooseLocationResult(result);
                });
                list.appendChild(li);
            });
            emptyState.hidden = results.length > 0;
        }

        function updateCategoryHeader() {
            var back = panel.querySelector('.cs-mobile-back');
            var backLabel = panel.querySelector('.cs-mobile-back-label');
            var title = panel.querySelector('.cs-mobile-panel-title');
            var category = window.VelveraCategories?.getCategory?.(categoryView.parentId);
            if (back) {
                back.setAttribute('aria-label', category ? 'Back to all categories' : 'Close category selector');
                if (backLabel) backLabel.textContent = category ? 'Back' : 'Close';
            }
            if (title) title.textContent = category?.name || 'Categories';
            if (title) list.setAttribute('aria-labelledby', title.id);
        }

        function syncCategoryAccessibility() {
            if (select.dataset.categoryEnhanced === 'true') {
                trigger.setAttribute('role', 'combobox');
                trigger.setAttribute('aria-autocomplete', 'none');
                trigger.setAttribute('aria-controls', list.id);
                var title = panel.querySelector('.cs-mobile-panel-title');
                if (title) list.setAttribute('aria-labelledby', title.id);
            } else {
                trigger.removeAttribute('aria-autocomplete');
                if (trigger.getAttribute('role') === 'combobox') {
                    trigger.removeAttribute('role');
                }
                trigger.removeAttribute('aria-activedescendant');
            }
        }

        function setActiveCategoryRow(row) {
            var rows = Array.prototype.slice.call(list.querySelectorAll('.cs-category-row:not([hidden])'));
            rows.forEach(function (candidate) {
                candidate.classList.toggle('is-active', candidate === row);
            });
            if (!row || !rows.includes(row)) {
                activeCategoryValue = null;
                trigger.removeAttribute('aria-activedescendant');
                return;
            }
            var index = rows.indexOf(row);
            if (!row.id) row.id = list.id + '-option-' + index;
            activeCategoryValue = row.dataset.value || '';
            trigger.setAttribute('aria-activedescendant', row.id);

            var listRect = list.getBoundingClientRect();
            var rowRect = row.getBoundingClientRect();
            if (rowRect.top < listRect.top) {
                list.scrollTop -= listRect.top - rowRect.top;
            } else if (rowRect.bottom > listRect.bottom) {
                list.scrollTop += rowRect.bottom - listRect.bottom;
            }
        }

        function focusCategoryRow(target) {
            var rows = Array.prototype.slice.call(list.querySelectorAll('.cs-category-row:not([hidden])'));
            if (!rows.length) return;

            var currentIndex = rows.findIndex(function (row) {
                return row.classList.contains('is-active');
            });
            var nextIndex = 0;
            if (target === 'last') {
                nextIndex = rows.length - 1;
            } else if (target === 'next') {
                nextIndex = Math.min(currentIndex < 0 ? 0 : currentIndex + 1, rows.length - 1);
            } else if (target === 'previous') {
                nextIndex = currentIndex < 0 ? rows.length - 1 : Math.max(currentIndex - 1, 0);
            }

            var row = rows[nextIndex];
            trigger.focus({ preventScroll: true });
            setActiveCategoryRow(row);
        }

        function addCategoryRow(category, subcategory, options) {
            options = options || {};
            var categoryService = window.VelveraCategories;
            if (!category || !categoryService) return;
            var subcategoryImage = subcategory
                ? categoryService.getSubcategoryImage?.(category.id, subcategory)
                : null;
            var showSubcategoryImage = Boolean(subcategoryImage && !options.parentChoice && !options.omitIcon);

            var value = options.value || (subcategory
                ? categoryService.getCategoryValue(category.id, subcategory)
                : category.id);
            if (!value) return;

            var row = document.createElement('li');
            row.className = 'cs-option cs-category-row' +
                (subcategory ? ' cs-category-subcategory' : '') +
                (showSubcategoryImage ? ' has-image' : '') +
                (options.parentChoice ? ' cs-category-parent-option' : '') +
                (value === select.value ? ' is-selected' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', value === select.value ? 'true' : 'false');
            row.tabIndex = 0;
            row.dataset.value = value;

            if ((!subcategory || showSubcategoryImage) && !options.parentChoice && !options.omitIcon) {
                var icon = document.createElement('span');
                icon.className = 'cs-category-icon' +
                    (subcategory ? ' cs-category-icon--subcategory' : '');
                var imageSource = subcategory ? subcategoryImage : category.image;
                if (imageSource) {
                    var image = document.createElement('img');
                    image.src = imageSource;
                    image.alt = '';
                    image.loading = 'lazy';
                    image.addEventListener('error', function () {
                        image.remove();
                        icon.classList.add('has-fallback');
                    }, { once: true });
                    icon.appendChild(image);
                } else {
                    icon.classList.add('has-fallback');
                }
                var fallback = document.createElement('i');
                fallback.className = 'fas ' + (category.icon || 'fa-layer-group');
                fallback.setAttribute('aria-hidden', 'true');
                icon.appendChild(fallback);
                row.appendChild(icon);
            }
            if (!subcategory && !options.parentChoice && category.subcategories.length) {
                row.dataset.expandable = 'true';
            }

            var copy = document.createElement('span');
            copy.className = 'cs-category-copy';
            var name = document.createElement('span');
            name.className = 'cs-category-name';
            name.textContent = options.label || subcategory || category.name;
            copy.appendChild(name);

            var detailText = options.detail || (options.showParent ? category.name : '');
            if (detailText) {
                var detail = document.createElement('small');
                detail.className = 'cs-category-parent-name';
                detail.textContent = detailText;
                copy.appendChild(detail);
            }
            row.appendChild(copy);

            if (!subcategory && !options.parentChoice && category.subcategories.length) {
                var chevron = document.createElement('span');
                chevron.className = 'cs-category-chevron';
                chevron.setAttribute('aria-hidden', 'true');
                chevron.innerHTML = '<svg viewBox="0 0 28 28" focusable="false"><path d="m10.5 5.5 8 8.5-8 8.5" /></svg>';
                row.appendChild(chevron);
            } else if (value === select.value) {
                var selectedMark = document.createElement('span');
                selectedMark.className = 'cs-category-selected-mark';
                selectedMark.setAttribute('aria-hidden', 'true');
                selectedMark.innerHTML = '<i class="fas fa-check"></i>';
                row.appendChild(selectedMark);
            }

            function activate() {
                if (options.parentChoice || subcategory || !category.subcategories.length) {
                    selectLocation(value);
                    closePanel();
                    return;
                }
                categoryView.parentId = category.id;
                var search = panel.querySelector('[data-cs-search]');
                if (search) search.value = '';
                renderCategoryOptions();
                trigger.focus({ preventScroll: true });
                setActiveCategoryRow(list.querySelector('.cs-category-row'));
            }
            row.addEventListener('click', function (event) {
                event.stopPropagation();
                activate();
            });
            row.addEventListener('keydown', function (event) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
                    event.key === 'Home' || event.key === 'End') {
                    event.preventDefault();
                    event.stopPropagation();
                    focusCategoryRow(
                        event.key === 'ArrowDown' ? 'next' :
                            event.key === 'ArrowUp' ? 'previous' :
                                event.key === 'End' ? 'last' : 'first'
                    );
                    return;
                }
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                activate();
            });
            list.appendChild(row);
        }

        function addCategoryAllOption(option) {
            if (!option || option.disabled ||
                (!option.value && select.dataset.categoryMode !== 'filter')) return;
            var row = document.createElement('li');
            row.className = 'cs-option cs-category-row cs-category-all-option' +
                (option.value === select.value ? ' is-selected' : '');
            row.setAttribute('role', 'option');
            row.setAttribute('aria-selected', option.value === select.value ? 'true' : 'false');
            row.tabIndex = 0;
            row.dataset.value = option.value;
            row.textContent = option.textContent.trim();
            function choose() {
                selectLocation(option.value);
                closePanel();
            }
            row.addEventListener('click', function (event) {
                event.stopPropagation();
                choose();
            });
            row.addEventListener('keydown', function (event) {
                if (event.key !== 'Enter' && event.key !== ' ') return;
                event.preventDefault();
                choose();
            });
            list.appendChild(row);
        }

        function renderCategoryOptions() {
            var service = window.VelveraCategories;
            var categories = service?.categories || [];
            list.innerHTML = '';
            emptyState.hidden = true;
            if (!service || !categories.length) {
                emptyState.textContent = 'Categories are temporarily unavailable.';
                emptyState.hidden = false;
                updateCategoryHeader();
                syncCategoryAccessibility();
                return;
            }

            var query = panel.querySelector('[data-cs-search]')?.value.trim().toLocaleLowerCase() || '';
            var parent = service.getCategory(categoryView.parentId);
            if (query) {
                categories.forEach(function (category) {
                    var parentMatches = category.name.toLocaleLowerCase().includes(query);
                    if (parentMatches) {
                        addCategoryRow(category, null);
                    }
                    category.subcategories.forEach(function (subcategory) {
                        if (parentMatches || subcategory.toLocaleLowerCase().includes(query)) {
                            addCategoryRow(category, subcategory, { showParent: true });
                        }
                    });
                });
            } else if (parent) {
                addCategoryRow(parent, null, {
                    parentChoice: true,
                    omitIcon: true,
                    label: 'All ' + parent.name,
                    detail: 'Choose this category without a subcategory'
                });
                parent.subcategories.forEach(function (subcategory) {
                    addCategoryRow(parent, subcategory);
                });
            } else {
                var allOption = Array.prototype.find.call(select.options, function (option) {
                    return option.value === 'all' || option.value === '';
                });
                addCategoryAllOption(allOption);
                categories.forEach(function (category) {
                    addCategoryRow(category, null);
                });
            }

            emptyState.textContent = select.dataset.emptyLabel || 'No matching categories found';
            emptyState.hidden = list.querySelector('.cs-category-row') !== null;
            Array.prototype.forEach.call(list.querySelectorAll('.cs-category-row'), function (row, index) {
                row.id = list.id + '-option-' + index;
                row.tabIndex = index === 0 ? 0 : -1;
            });
            if (activeCategoryValue) {
                var activeRow = Array.prototype.find.call(
                    list.querySelectorAll('.cs-category-row:not([hidden])'),
                    function (row) { return row.dataset.value === activeCategoryValue; }
                );
                setActiveCategoryRow(activeRow || null);
            }
            updateCategoryHeader();
            syncCategoryAccessibility();
        }

        function renderOptions() {
            list.innerHTML = '';
            if (select.id === 'headerLocationSelect') {
                if (locationView.mode === 'schools' && locationView.state) {
                    renderSchoolsForState(locationView.state);
                } else {
                    renderStateOptions();
                }
                filterLocationOptions();
                return;
            }
            if (select.dataset.categoryEnhanced === 'true') {
                panel.classList.add('cs-panel--categories');
                renderCategoryOptions();
                return;
            }

            Array.prototype.forEach.call(select.options, function (opt) {
                var li = document.createElement('li');
                li.className = 'cs-option' +
                    (opt.value === select.value ? ' is-selected' : '') +
                    (opt.disabled ? ' is-disabled' : '');
                li.setAttribute('role', 'option');
                li.dataset.value = opt.value;
                li.textContent = opt.textContent;
                if (!opt.disabled) {
                    li.addEventListener('click', function () {
                        selectLocation(opt.value);
                        closePanel();
                    });
                }
                list.appendChild(li);
            });
            if (select.id === 'headerLocationSelect') filterLocationOptions();
            else if (select.dataset.searchable === 'true') filterSearchOptions();
        }

        function filterSearchOptions() {
            if (select.dataset.categoryEnhanced === 'true') {
                renderCategoryOptions();
                return;
            }
            var query = panel.querySelector('[data-cs-search]')?.value.trim().toLocaleLowerCase() || '';
            var visibleOptions = 0;
            list.querySelectorAll('.cs-option').forEach(function (option) {
                var visible = !query || option.textContent.toLocaleLowerCase().includes(query);
                option.hidden = !visible;
                if (visible) visibleOptions++;
            });
            emptyState.textContent = select.dataset.emptyLabel || 'No matching categories found';
            emptyState.hidden = visibleOptions > 0;
        }

        function filterLocationOptions() {
            var query = panel.querySelector('.cs-mobile-search input')?.value.trim() || '';
            if (select.id === 'headerLocationSelect' && query) {
                renderMobileSearchResults(query);
                return;
            }
            var visibleOptions = 0;
            var summary = list.querySelector('.cs-location-summary');
            if (summary) summary.hidden = Boolean(query);
            list.querySelectorAll('.cs-option').forEach(function (option) {
                var isVisible = !query || option.textContent.toLowerCase().includes(query.toLowerCase());
                option.hidden = !isVisible;
                if (isVisible) visibleOptions++;
            });

            list.querySelectorAll('.cs-location-section').forEach(function (section) {
                var hasVisibleOption = false;
                var sibling = section.nextElementSibling;
                while (sibling && !sibling.classList.contains('cs-location-section')) {
                    if (sibling.classList.contains('cs-option') && !sibling.hidden) {
                        hasVisibleOption = true;
                        break;
                    }
                    sibling = sibling.nextElementSibling;
                }
                section.hidden = !hasVisibleOption;
            });
            emptyState.hidden = visibleOptions > 0;
        }

        function updateLabel() {
            var selectedOption = getSelectedOption();
            var selectedText = selectedOption
                ? selectedOption.textContent.trim()
                : '';
            label.textContent = select.id === 'headerLocationSelect' && window.RegionService?.school
                ? window.RegionService.school.name
                : select.id === 'headerLocationSelect' && window.RegionService?.place
                    ? window.RegionService.place.label
                : selectedText || select.dataset.placeholder || select.getAttribute('aria-label') || '';
            label.dataset.empty = label.textContent ? 'false' : 'true';
            if (select.dataset.categoryEnhanced === 'true') {
                var associatedLabel = Array.prototype.map.call(select.labels || [], function (item) {
                    return item.textContent.trim().replace(/\s+/g, ' ');
                }).filter(Boolean)[0];
                trigger.setAttribute(
                    'aria-label',
                    (associatedLabel || 'Category') + ': ' + (selectedText || 'Choose a category')
                );
            }
            var opts = list.querySelectorAll('.cs-option');
            for (var i = 0; i < opts.length; i++) {
                var selected = opts[i].dataset.value === select.value;
                opts[i].classList.toggle('is-selected', selected);
                if (opts[i].classList.contains('cs-category-row')) {
                    opts[i].setAttribute('aria-selected', selected ? 'true' : 'false');
                }
            }
        }

        select.addEventListener('change', updateLabel);
        if (select.id === 'headerLocationSelect') {
            select.addEventListener('change', function () {
                window.RegionService?.setLocation?.(select.value);
            });
            window.addEventListener('velveraLocationChange', function () {
                syncHeaderLocationOptions();
                renderOptions();
                updateLabel();
            });
        }

        /*
         * A select's value property can change without emitting a change event
         * (for example during page initialization or after a filter is restored
         * from the URL). Keep the generated trigger in sync with those changes
         * so its inactive state never appears blank or stale.
         */
        var nativeValueDescriptor = Object.getOwnPropertyDescriptor(
            HTMLSelectElement.prototype,
            'value'
        );
        if (nativeValueDescriptor?.get && nativeValueDescriptor?.set) {
            Object.defineProperty(select, 'value', {
                configurable: true,
                enumerable: nativeValueDescriptor.enumerable,
                get: function () {
                    return nativeValueDescriptor.get.call(this);
                },
                set: function (nextValue) {
                    nativeValueDescriptor.set.call(this, nextValue);
                    updateLabel();
                }
            });
        }

        function openPanel() {
            if (trigger.disabled) return;
            document.querySelectorAll('.cs-panel.is-open').forEach(function (openPanel) {
                if (openPanel === panel) return;
                if (typeof openPanel._csClose === 'function') {
                    openPanel._csClose(false);
                    return;
                }
                openPanel.classList.remove('is-open');
                openPanel.setAttribute('aria-hidden', 'true');
                var previousSelect = openPanel.dataset.selectId
                    ? document.getElementById(openPanel.dataset.selectId)
                    : null;
                var previousWrapper = previousSelect?.closest('.cs-select');
                previousWrapper?.classList.remove('is-open');
                previousWrapper?.querySelector('.cs-trigger')?.setAttribute('aria-expanded', 'false');
            });
            document.body.classList.remove('location-search-open');
            var open = document.querySelectorAll('.cs-select.is-open');
            for (var i = 0; i < open.length; i++) {
                if (open[i] !== wrapper) {
                    open[i].classList.remove('is-open');
                    open[i].querySelector('.cs-trigger')?.setAttribute('aria-expanded', 'false');
                }
            }
            wrapper.classList.add('is-open');
            panel.classList.add('is-open');
            if (window.matchMedia('(max-width: 768px)').matches) {
                document.body.classList.add('custom-select-open');
            }
            if (select.id === 'headerLocationSelect') {
                if (window.matchMedia('(max-width: 768px)').matches) {
                    panel.style.transform = 'translateX(0)';
                }
                locationView.mode = 'states';
                locationView.state = null;
                renderOptions();
            } else if (select.dataset.categoryEnhanced === 'true') {
                categoryView.parentId = null;
                activeCategoryValue = null;
                trigger.removeAttribute('aria-activedescendant');
                var categorySearch = panel.querySelector('[data-cs-search]');
                if (categorySearch) categorySearch.value = '';
                renderOptions();
            }
            syncCategoryAccessibility();
            trigger.setAttribute('aria-expanded', 'true');
            panel.setAttribute('aria-hidden', 'false');
            window.VelveraFocusManager?.open(panel, {
                trigger: trigger,
                trap: select.id === 'headerLocationSelect'
                    && window.matchMedia('(max-width: 768px)').matches,
                initialFocus: select.id === 'headerLocationSelect'
                    ? (node) => node.querySelector('.cs-mobile-search input')
                    : null
            });
            if (select.id === 'headerLocationSelect' && window.matchMedia('(max-width: 768px)').matches) {
                document.body.classList.add('location-search-open');
            }
            positionPanel();
            if (select.id === 'headerLocationSelect' && window.matchMedia('(max-width: 768px)').matches) {
                window.setTimeout(function () {
                    panel.querySelector('.cs-mobile-search input')?.focus({ preventScroll: true });
                }, 30);
            }
        }

        function closePanel(restoreFocus) {
            if (!wrapper.classList.contains('is-open') && !panel.classList.contains('is-open')) {
                return;
            }
            wrapper.classList.remove('is-open');
            panel.classList.remove('is-open');
            document.body.classList.remove('custom-select-open');
            if (select.id === 'headerLocationSelect') {
                if (window.matchMedia('(max-width: 768px)').matches) {
                    panel.style.transform = 'translateX(100%)';
                }
            }
            trigger.setAttribute('aria-expanded', 'false');
            panel.setAttribute('aria-hidden', 'true');
            if (restoreFocus === false) {
                window.VelveraFocusManager?.close(panel, null, { restoreFocus: false });
            } else {
                window.VelveraFocusManager?.close(panel, trigger);
            }
            if (select.id === 'headerLocationSelect') {
                document.body.classList.remove('location-search-open');
                locationView.mode = 'states';
                locationView.state = null;
            }
            if (select.dataset.categoryEnhanced === 'true') {
                categoryView.parentId = null;
                activeCategoryValue = null;
                trigger.removeAttribute('aria-activedescendant');
                list.querySelectorAll('.cs-category-row.is-active').forEach(function (row) {
                    row.classList.remove('is-active');
                });
            }
            var search = panel.querySelector('.cs-mobile-search input');
            if (search) search.value = '';
            var genericSearch = panel.querySelector('[data-cs-search]');
            if (genericSearch) genericSearch.value = '';
            if (select.id === 'headerLocationSelect') filterLocationOptions();
        }
        panel._csClose = closePanel;

        function positionPanel() {
            if (select.id === 'headerLocationSelect' && window.matchMedia('(max-width: 768px)').matches) {
                panel.classList.remove('cs-panel--up');
                panel.style.top = '0px';
                panel.style.right = '0px';
                panel.style.bottom = '0px';
                panel.style.left = '0px';
                panel.style.width = '100vw';
                panel.style.transform = 'translateX(0)';
                return;
            }
            if (window.matchMedia('(max-width: 768px)').matches) {
                panel.classList.remove('cs-panel--up');
                panel.style.top = '0px';
                panel.style.right = '0px';
                panel.style.bottom = '0px';
                panel.style.left = '0px';
                panel.style.width = '100vw';
                panel.style.transform = 'translateY(0)';
                return;
            }
            panel.style.transform = '';
            var rect = trigger.getBoundingClientRect();
            /*
             * Every dropdown panel is portaled to body and positioned in
             * viewport coordinates. This avoids clipping from cards, grids,
             * sticky headers, transformed ancestors, and mobile scrollers.
             * The scroll listener below keeps the panel attached to its
             * trigger while the page moves.
             */
            var viewportPadding = 8;
            var panelWidth = Math.max(
                Math.round(rect.width),
                panel.classList.contains('cs-location-panel') ? 320 :
                    panel.classList.contains('cs-panel--categories') ? 340 : 180
            );
            var maxPanelHeight = Math.max(40, window.innerHeight - (viewportPadding * 2));
            var panelHeight = Math.min(
                Math.max(panel.scrollHeight, list.scrollHeight, 40),
                maxPanelHeight
            );
            var mobile = window.matchMedia('(max-width: 768px)').matches;
            var bottomInset = mobile
                ? (document.querySelector('.mobile-bottom-nav')?.getBoundingClientRect().height || 0)
                : 0;
            var availableBottom = Math.max(
                viewportPadding,
                window.innerHeight - bottomInset - viewportPadding
            );
            var spaceBelow = availableBottom - rect.bottom;
            var openUp = spaceBelow < panelHeight + viewportPadding &&
                rect.top > panelHeight + viewportPadding;
            var left = Math.min(
                Math.max(Math.round(rect.left), viewportPadding),
                Math.max(viewportPadding, window.innerWidth - panelWidth - viewportPadding)
            );
            var top = openUp
                ? Math.max(viewportPadding, Math.round(rect.top - panelHeight - viewportPadding))
                : Math.min(
                    Math.round(rect.bottom + viewportPadding),
                    Math.max(viewportPadding, availableBottom - panelHeight)
                );

            panel.classList.toggle('cs-panel--up', openUp);
            panel.style.top = top + 'px';
            panel.style.right = 'auto';
            panel.style.bottom = 'auto';
            panel.style.left = left + 'px';
            panel.style.width = Math.min(panelWidth, window.innerWidth - viewportPadding * 2) + 'px';
        }

        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            if (wrapper.classList.contains('is-open')) {
                closePanel();
            } else {
                openPanel();
            }
        });
        var mobileBack = panel.querySelector('.cs-mobile-back');
        if (mobileBack) {
            mobileBack.dataset.noProcessing = 'true';
            mobileBack.addEventListener('click', function () {
            restoreNavigationButton(mobileBack);
            window.setTimeout(function () { restoreNavigationButton(mobileBack); }, 0);
            if (select.dataset.categoryEnhanced === 'true') {
                if (categoryView.parentId) {
                    categoryView.parentId = null;
                    var categorySearch = panel.querySelector('[data-cs-search]');
                    if (categorySearch) categorySearch.value = '';
                    renderOptions();
                } else {
                    closePanel();
                }
                return;
            }
            if (select.id === 'headerLocationSelect' && locationView.mode === 'schools') {
                locationView.mode = 'states';
                locationView.state = null;
                renderOptions();
                return;
            }
            closePanel();
            });
        }
        panel.querySelector('.cs-mobile-search input')?.addEventListener('input', filterLocationOptions);
        panel.querySelector('[data-cs-search]')?.addEventListener('input', filterSearchOptions);
        panel.addEventListener('keydown', function (event) {
            if (select.dataset.categoryEnhanced !== 'true' ||
                !event.target.matches('[data-cs-search]')) return;
            if (event.key === 'Escape') {
                event.preventDefault();
                closePanel();
                return;
            }
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp' ||
                event.key === 'Home' || event.key === 'End') {
                event.preventDefault();
                focusCategoryRow(
                    event.key === 'ArrowDown' ? 'first' :
                        event.key === 'ArrowUp' ? 'last' :
                            event.key === 'End' ? 'last' : 'first'
                );
                return;
            }
            if (event.key === 'Enter') {
                var activeRow = list.querySelector('.cs-category-row.is-active');
                if (activeRow) {
                    event.preventDefault();
                    trigger.focus({ preventScroll: true });
                    activeRow.click();
                }
            }
        });

        trigger.addEventListener('keydown', function (e) {
            var opts = Array.prototype.filter.call(select.options, function (o) { return !o.disabled; });
            var idx = opts.findIndex(function (o) { return o.value === select.value; });
            var categoryPicker = select.dataset.categoryEnhanced === 'true';
            if (categoryPicker) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    closePanel();
                    return;
                }
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (!wrapper.classList.contains('is-open')) {
                        openPanel();
                        return;
                    }
                    var activeRow = list.querySelector('.cs-category-row.is-active');
                    if (activeRow) activeRow.click();
                    else focusCategoryRow('first');
                    return;
                }
                if (e.key === 'ArrowDown' || e.key === 'ArrowUp' ||
                    e.key === 'Home' || e.key === 'End') {
                    e.preventDefault();
                    if (!wrapper.classList.contains('is-open')) openPanel();
                    focusCategoryRow(
                        e.key === 'ArrowDown' ? 'next' :
                            e.key === 'ArrowUp' ? 'previous' :
                                e.key === 'End' ? 'last' : 'first'
                    );
                    return;
                }
                if (e.key === 'ArrowLeft' && wrapper.classList.contains('is-open') && categoryView.parentId) {
                    e.preventDefault();
                    categoryView.parentId = null;
                    var searchInput = panel.querySelector('[data-cs-search]');
                    if (searchInput) searchInput.value = '';
                    renderCategoryOptions();
                    return;
                }
                if (e.key === 'ArrowRight' && wrapper.classList.contains('is-open')) {
                    var expandableRow = list.querySelector('.cs-category-row.is-active[data-expandable="true"]');
                    if (expandableRow) {
                        e.preventDefault();
                        expandableRow.click();
                    }
                    return;
                }
                if (e.key === 'Tab' && wrapper.classList.contains('is-open')) {
                    if (e.shiftKey) {
                        closePanel();
                    } else {
                        var nextControl = panel.querySelector('.cs-mobile-back') ||
                            panel.querySelector('[data-cs-search]');
                        if (nextControl) {
                            e.preventDefault();
                            nextControl.focus();
                        }
                    }
                    return;
                }
            }
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                if (wrapper.classList.contains('is-open')) {
                    closePanel();
                } else {
                    openPanel();
                }
            } else if (e.key === 'Escape') {
                closePanel();
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                if (!wrapper.classList.contains('is-open')) { openPanel(); return; }
                idx = Math.min(idx + 1, opts.length - 1);
                if (opts[idx] && select.value !== opts[idx].value) {
                    select.value = opts[idx].value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    updateLabel();
                }
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                idx = Math.max(idx - 1, 0);
                if (opts[idx] && select.value !== opts[idx].value) {
                    select.value = opts[idx].value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    updateLabel();
                }
            }
        });

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && wrapper.classList.contains('is-open')) {
                closePanel();
            }
        });

        document.addEventListener('click', function (e) {
            if (!wrapper.contains(e.target) && !panel.contains(e.target)) closePanel();
        });
        window.addEventListener('resize', function () {
            if (wrapper.classList.contains('is-open')) positionPanel();
            copyLayout(select, wrapper, true);
        });
        window.addEventListener('scroll', function () {
            if (wrapper.classList.contains('is-open')) positionPanel();
        }, true);
        window.addEventListener('velveraCampusDirectoryReady', function () {
            if (select.id === 'headerLocationSelect' && wrapper.classList.contains('is-open')) {
                renderOptions();
            }
        });

        wrapper.appendChild(trigger);
        /*
         * Keep every panel outside page layout containers. Backdrop filters,
         * overflow rules, and transformed cards otherwise create containing
         * blocks that break fixed positioning during mobile scroll.
         */
        document.body.appendChild(panel);

        syncHeaderLocationOptions();
        renderOptions();
        updateLabel();

        var observer = new MutationObserver(function (mutations) {
            // Updating the generated list must never cause another enhancement
            // pass. Only the hidden form control is observed for option/disabled
            // changes, which keeps async location loading lightweight.
            if (!mutations.length) return;
            if (select.dataset.categoryEnhanced === 'true') {
                panel.classList.add('cs-panel--categories');
            }
            syncCategoryAccessibility();
            if (select.dataset.searchable === 'true' && !panel.classList.contains('cs-panel--searchable')) {
                panel.classList.add('cs-panel--searchable');
                if (!panel.querySelector('[data-cs-search]')) {
                    var searchLabel = document.createElement('label');
                    searchLabel.className = 'cs-category-search';
                    var searchPlaceholder = select.dataset.searchPlaceholder || 'Search categories...';
                    var searchAriaLabel = select.dataset.searchLabel || searchPlaceholder.replace(/\.\.\.$/, '');
                    searchLabel.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i><input type="search" data-cs-search placeholder="' + escapeHtml(searchPlaceholder) + '" aria-label="' + escapeHtml(searchAriaLabel) + '">';
                    panel.querySelector('.cs-generic-mobile-header')?.appendChild(searchLabel);
                    searchLabel.querySelector('input')?.addEventListener('input', filterSearchOptions);
                }
            }
            renderOptions();
            updateLabel();
            trigger.disabled = select.disabled;
        });
        observer.observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ['disabled'] });

        select._csRefresh = function () {
            if (select.dataset.categoryEnhanced === 'true') {
                panel.classList.add('cs-panel--categories');
            }
            syncCategoryAccessibility();
            if (select.dataset.searchable === 'true') {
                panel.classList.add('cs-panel--searchable');
                if (!panel.querySelector('[data-cs-search]')) {
                    var searchLabel = document.createElement('label');
                    searchLabel.className = 'cs-category-search';
                    var searchPlaceholder = select.dataset.searchPlaceholder || 'Search categories...';
                    var searchAriaLabel = select.dataset.searchLabel || searchPlaceholder.replace(/\.\.\.$/, '');
                    searchLabel.innerHTML = '<i class="fas fa-search" aria-hidden="true"></i><input type="search" data-cs-search placeholder="' + escapeHtml(searchPlaceholder) + '" aria-label="' + escapeHtml(searchAriaLabel) + '">';
                    panel.querySelector('.cs-generic-mobile-header')?.appendChild(searchLabel);
                    searchLabel.querySelector('input')?.addEventListener('input', filterSearchOptions);
                }
            }
            renderOptions();
            updateLabel();
        };
    }

    function enhanceAll(root) {
        var scope = root || document;
        var selects = scope.querySelectorAll ? scope.querySelectorAll('select:not([data-cs-enhanced])') : [];
        Array.prototype.forEach.call(selects, buildCustomSelect);
    }

    document.addEventListener('DOMContentLoaded', function () {
        enhanceAll();
    });

    var bodyObserver = new MutationObserver(function (mutations) {
        mutations.forEach(function (m) {
            m.addedNodes.forEach(function (node) {
                if (node.nodeType !== 1) return;
                if (node.closest && node.closest('.cs-select')) return;
                if (node.matches && node.matches('select') && !node.dataset.csEnhanced) {
                    buildCustomSelect(node);
                } else if (node.querySelectorAll) {
                    enhanceAll(node);
                }
            });
        });
    });

    document.addEventListener('DOMContentLoaded', function () {
        bodyObserver.observe(document.body, { childList: true, subtree: true });
    });

    window.CustomSelect = {
        enhanceAll: enhanceAll,
        refresh: function (select) {
            if (select && select._csRefresh) select._csRefresh();
        }
    };
})();

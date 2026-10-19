(function () {
    'use strict';

    const categories = [
        {
            id: 'baby-kids',
            name: 'Babies & Kids',
            image: '/img/home-category/babies-and-kids.png',
            subcategoryImageDirectory: '/img/subcategories/baby-kids',
            icon: 'fa-baby',
            subcategories: [
                "Baby & Kids' Accessories",
                'Baby Gear & Equipment',
                'Care & Feeding',
                "Children's Clothing",
                "Children's Furniture",
                "Children's Shoes",
                'Maternity & Pregnancy',
                'Playground Equipment',
                'Toys & Games',
                'Transport & Safety'
            ]
        },
        { id: 'books', name: 'Books', image: '/img/home-category/books.png', icon: 'fa-book', legacy: true, subcategories: [] },
        {
            id: 'beauty',
            name: 'Beauty & Personal Care',
            image: '/img/home-category/beauty-and-personal-care.png',
            subcategoryImageDirectory: '/img/subcategories/beauty',
            icon: 'fa-spa',
            subcategories: [
                'Body Care',
                'Face Care',
                'Fragrances',
                'Hair Care',
                'Makeup',
                'Oral Care',
                'Sexual Wellness',
                'Skincare',
                'Tools & Accessories',
                'Vitamins & Supplements'
            ],
            subcategoryValueOverrides: {
                'Hair Care': 'hair-beauty',
                Makeup: 'make-up'
            }
        },
        {
            id: 'business-industry',
            name: 'Business & Industry',
            image: '/img/home-category/business-and-industry.png',
            subcategoryImageDirectory: '/img/subcategories/business-industry',
            icon: 'fa-briefcase',
            subcategories: ['Business for Sale & Investment', 'Wholesale & Bulk']
        },
        {
            id: 'commercial-equipment-tools',
            name: 'Commercial Equipment & Tools',
            image: '/img/home-category/commercial-equipment-and-tools.png',
            subcategoryImageDirectory: '/img/subcategories/commercial-equipment-tools',
            icon: 'fa-toolbox',
            subcategories: [
                'Manufacturing Equipment',
                'Manufacturing Materials & Supplies',
                'Medical Equipment & Supplies',
                'Printing & Graphics Equipment',
                'Restaurant & Catering Equipment',
                'Retail & Store Equipment',
                'Safety Equipment & Protective Gear',
                'Salon & Beauty Equipment',
                'Stage & Event Equipment',
                'Stationery & Office Equipment'
            ]
        },
        {
            id: 'electronics',
            name: 'Electronics',
            image: '/img/home-category/electronics.png',
            subcategoryImageDirectory: '/img/subcategories/electronics',
            icon: 'fa-laptop',
            subcategories: [
                'Accessories & Supplies for Electronics',
                'Audio & Music Equipment',
                'Computer Accessories',
                'Computer Hardware',
                'Headphones',
                'Laptops & Computers',
                'Monitors',
                'Networking Products',
                'Photo & Video Cameras',
                'Printers & Scanners',
                'Security & Surveillance',
                'Software',
                'TV & DVD Equipment',
                'Video Game Consoles',
                'Video Games'
            ]
        },
        {
            id: 'fashion',
            name: 'Fashion',
            image: '/img/home-category/fashion.png',
            icon: 'fa-tshirt',
            subcategoryImageDirectory: '/img/subcategories/fashion',
            subcategoryImageSubcategories: [
                'Jewelry',
                'Shoes',
                'Watches',
                'Wedding Wear & Accessories'
            ],
            subcategories: [
                'Bags',
                'Clothing',
                'Clothing Accessories',
                'Jewelry',
                'Shoes',
                'Watches',
                'Wedding Wear & Accessories'
            ]
        },
        {
            id: 'food-agriculture-farming',
            name: 'Food, Agriculture & Farming',
            image: '/img/home-category/food-agriculture-and-farming.png',
            icon: 'fa-tractor',
            subcategoryImageDirectory: '/img/subcategories/food-agriculture-farming',
            subcategoryImageSubcategories: [
                'Farm Animal Feed & Supplements',
                'Farm Animals',
                'Farm Machinery & Equipment',
                'Food & Beverages',
                'Seeds & Fertilizers'
            ],
            subcategories: [
                'Farm Animal Feed & Supplements',
                'Farm Animals',
                'Farm Machinery & Equipment',
                'Food & Beverages',
                'Seeds & Fertilizers'
            ]
        },
        {
            id: 'home',
            name: 'Home, Furniture & Appliances',
            image: '/img/home-category/home-furniture-and-appliances.png',
            icon: 'fa-couch',
            subcategoryImageDirectory: '/img/subcategories/home',
            subcategoryImageSubcategories: [
                'Furniture',
                'Garden Supplies',
                'Home Accessories',
                'Home Appliances',
                'Household Chemicals',
                'Kitchen Appliances',
                'Kitchenware & Cookware'
            ],
            subcategories: [
                'Furniture',
                'Garden Supplies',
                'Home Accessories',
                'Home Appliances',
                'Household Chemicals',
                'Kitchen Appliances',
                'Kitchenware & Cookware',
                'Lighting',
                'Storage & Organization'
            ]
        },
        {
            id: 'jobs',
            name: 'Jobs',
            image: '/img/home-category/jobs.png',
            icon: 'fa-briefcase',
            subcategories: [
                'Accounting & Finance Jobs',
                'Advertising & Marketing Jobs',
                'Arts & Entertainment Jobs',
                'Childcare & Babysitting Jobs',
                'Clerical & Administrative Jobs',
                'Computing & IT Jobs',
                'Construction & Skilled Trade Jobs',
                'Consulting & Strategy Jobs',
                'Customer Services Jobs',
                'Driver Jobs',
                'Engineering & Architecture Jobs',
                'Farming & Veterinary Jobs',
                'Gardening & Landscaping Jobs',
                'Health & Beauty Jobs',
                'Healthcare & Nursing Jobs',
                'Hotel Jobs',
                'Housekeeping & Cleaning Jobs',
                'Human Resources Jobs',
                'Internship Jobs',
                'Legal Jobs',
                'Logistics & Transportation Jobs',
                'Management Jobs',
                'Manual Labour Jobs',
                'Manufacturing Jobs',
                'Mining Industry Jobs',
                'Office Jobs',
                'Other Jobs',
                'Part-Time & Weekend Jobs',
                'Quality Control & Assurance Jobs',
                'Research & Survey Jobs',
                'Restaurant & Bar Jobs',
                'Retail Jobs',
                'Sales & Telemarketing Jobs',
                'Security Jobs',
                'Sports Club Jobs',
                'Teaching Jobs',
                'Technology Jobs',
                'Travel & Tourism Jobs'
            ]
        },
        {
            id: 'leisure-activities',
            name: 'Leisure & Activities',
            image: '/img/home-category/leisure-and-activities.png',
            icon: 'fa-futbol',
            subcategoryImageDirectory: '/img/subcategories/leisure-activities',
            subcategoryImageSubcategories: [
                'Arts, Crafts & Awards',
                'Books & Table Games',
                'Massagers',
                'Music & Video',
                'Musical Instruments & Gear',
                'Outdoor Gear',
                'Personal Mobility',
                'Smoking Accessories',
                'Sports Equipment'
            ],
            subcategories: [
                'Arts, Crafts & Awards',
                'Books & Table Games',
                'Massagers',
                'Music & Video',
                'Musical Instruments & Gear',
                'Outdoor Gear',
                'Personal Mobility',
                'Smoking Accessories',
                'Sports Equipment'
            ]
        },
        {
            id: 'pets',
            name: 'Pets',
            image: '/img/home-category/animals-and-pets.png',
            icon: 'fa-paw',
            subcategories: [
                'Birds',
                'Cats & Kittens',
                'Dogs & Puppies',
                'Fish',
                'Other Animals',
                'Pet Accessories'
            ]
        },
        {
            id: 'phones-tablets',
            name: 'Phones & Tablets',
            image: '/img/home-category/phones-and-tablets.png',
            icon: 'fa-mobile-alt',
            subcategories: [
                'Accessories for Phones & Tablets',
                'Mobile Phones',
                'Smart Watches',
                'Tablets'
            ]
        },
        {
            id: 'property',
            name: 'Property',
            image: '/img/home-category/property.png',
            icon: 'fa-home',
            subcategories: [
                'Commercial Property for Rent',
                'Commercial Property for Sale',
                'Event Centres, Venues & Workstations',
                'Houses & Apartments for Rent',
                'Houses & Apartments for Sale',
                'Land & Plots for Rent',
                'Land & Plots for Sale',
                'New Builds',
                'Short Let Property'
            ]
        },
        {
            id: 'repair-construction',
            name: 'Repair & Construction',
            image: '/img/home-category/repair-and-construction.png',
            icon: 'fa-tools',
            subcategories: [
                'Building Materials & Supplies',
                'Doors & Security',
                'Electrical Equipment',
                'Electrical Hand Tools',
                'Hand Tools',
                'Hardware & Fasteners',
                'Measuring & Testing Tools',
                'Other Repair & Construction Items',
                'Plumbing & Water Systems',
                'Windows & Glass'
            ]
        },
        {
            id: 'services',
            name: 'Services',
            image: '/img/home-category/services.png',
            icon: 'fa-handshake',
            subcategories: [
                'Automotive Services',
                'Building & Trade Services',
                'Chauffeur & Airport Transfer Services',
                'Child Care & Education Services',
                'Classes & Courses',
                'Cleaning Services',
                'Computer & IT Services',
                'DJ & Entertainment Services',
                'Fitness & Personal Training Services',
                'Health & Beauty Services',
                'Landscaping & Gardening Services',
                'Legal Services',
                'Logistics Services',
                'Manufacturing Services',
                'Other Services',
                'Party, Catering & Event Services',
                'Pet Services',
                'Photography & Video Services',
                'Printing Services',
                'Recruitment Services',
                'Rental Services',
                'Repair Services',
                'Tax & Financial Services',
                'Travel Agents & Tours',
                'Wedding Venues & Services'
            ]
        },
        { id: 'sports', name: 'Sports', image: '/img/home-category/sports.png', icon: 'fa-futbol', legacy: true, subcategories: [] },
        { id: 'toys', name: 'Toys & Games', image: '/img/home-category/toys-and-games.png', icon: 'fa-gamepad', legacy: true, subcategories: [] },
        { id: 'other', name: 'Other', image: '/img/home-category/other.png', icon: 'fa-layer-group', legacy: true, subcategories: [] },
        {
            id: 'vehicles',
            name: 'Vehicles',
            image: '/img/home-category/vehicles.png',
            icon: 'fa-car',
            subcategories: [
                'Buses & Microbuses',
                'Cars',
                'Construction & Heavy Machinery',
                'Motorcycles & Scooters',
                'Trucks & Trailers',
                'Vehicle Parts & Accessories',
                'Watercraft & Boats'
            ]
        }
    ];

    const slugify = (value) => String(value).toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
    const categoryCollator = new Intl.Collator('en', { sensitivity: 'base' });
    const seenCategoryIds = new Set();
    categories.splice(0, categories.length, ...categories.filter((category) => {
        if (!category.id || !category.name || seenCategoryIds.has(category.id)) return false;
        seenCategoryIds.add(category.id);
        category.subcategories = Array.from(new Set(
            (category.subcategories || []).map((subcategory) => String(subcategory).trim()).filter(Boolean)
        ));
        return true;
    }));
    categories.sort((a, b) => categoryCollator.compare(a.name, b.name));
    const childValue = (category, subcategory) =>
        `${category.id}::${category.subcategoryValueOverrides?.[subcategory] || slugify(subcategory)}`;
    categories.forEach((category) => {
        const seenValues = new Set();
        category.subcategories = category.subcategories
            .filter((subcategory) => {
                const value = childValue(category, subcategory);
                if (seenValues.has(value)) return false;
                seenValues.add(value);
                return true;
            })
            .sort(categoryCollator.compare);
    });
    const byId = new Map(categories.map((category) => [category.id, category]));
    const labels = new Map();
    categories.forEach((category) => {
        labels.set(category.id, category.name);
        category.subcategories.forEach((subcategory) => {
            labels.set(childValue(category, subcategory), `${category.name} · ${subcategory}`);
        });
    });

    function getValues(value) {
        const category = byId.get(String(value || ''));
        if (!category) return value && value !== 'all' ? [String(value)] : [];
        return [category.id, ...category.subcategories.map((subcategory) => childValue(category, subcategory))];
    }

    function labelFor(value) {
        return labels.get(String(value || '')) || String(value || '');
    }

    function getCategory(categoryId) {
        return byId.get(String(categoryId || '')) || null;
    }

    function getCategoryValue(categoryId, subcategoryName) {
        const category = byId.get(String(categoryId || ''));
        if (!category || !category.subcategories.includes(subcategoryName)) return null;
        return childValue(category, subcategoryName);
    }

    function subcategoryImageSlug(value) {
        return String(value || '')
            .toLowerCase()
            .replace(/[’']/g, '')
            .replace(/&/g, ' and ')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-+|-+$/g, '');
    }

    function getSubcategoryImage(categoryId, subcategoryName) {
        const category = byId.get(String(categoryId || ''));
        if (!category?.subcategoryImageDirectory ||
            !category.subcategories.includes(subcategoryName) ||
            (category.subcategoryImageSubcategories &&
                !category.subcategoryImageSubcategories.includes(subcategoryName))) return null;
        return `${category.subcategoryImageDirectory}/${subcategoryImageSlug(subcategoryName)}.png`;
    }

    function populateSelect(select) {
        if (!select || select.dataset.categoryEnhanced === 'true') return;
        const currentValue = select.value;
        const originalOptions = Array.from(select.options);
        const first = originalOptions[0];
        const keepsAll = originalOptions.some((option) => option.value === 'all');
        const emptyText = first && first.value === ''
            ? first.textContent.trim()
            : (select.dataset.placeholder || 'Choose a category');

        select.replaceChildren();
        if (keepsAll) {
            const all = document.createElement('option');
            all.value = 'all';
            all.textContent = first?.value === 'all'
                ? first.textContent
                : (select.id === 'categoryFilter' ? 'All categories' : 'All Categories');
            select.appendChild(all);
        } else if (originalOptions.some((option) => option.value === '')) {
            const empty = document.createElement('option');
            empty.value = '';
            empty.textContent = emptyText;
            select.appendChild(empty);
        }

        categories.forEach((category) => {
            const parent = document.createElement('option');
            parent.value = category.id;
            parent.textContent = category.name;
            select.appendChild(parent);
            category.subcategories.forEach((subcategory) => {
                const child = document.createElement('option');
                child.value = childValue(category, subcategory);
                child.textContent = `${category.name} · ${subcategory}`;
                child.dataset.parentCategory = category.id;
                select.appendChild(child);
            });
        });

        if (Array.from(select.options).some((option) => option.value === currentValue)) {
            select.value = currentValue;
        }
        select.dataset.searchable = 'true';
        select.dataset.categoryEnhanced = 'true';
        select.dataset.categoryMode = select.id === 'categoryFilter' ||
            select.id === 'productCategoryFilter' ||
            select.hasAttribute('data-category-filter') ||
            select.id === 'searchCategory'
            ? 'filter'
            : 'listing';
        select.dataset.searchPlaceholder = select.dataset.searchPlaceholder || 'Find category...';
        select.dataset.searchLabel = select.dataset.searchLabel || 'Find category';
        select.dataset.emptyLabel = select.dataset.emptyLabel || 'No matching categories found';
        if (!select.hasAttribute('aria-label')) {
            select.setAttribute('aria-label', 'Search categories');
        }
        window.CustomSelect?.refresh(select);
    }

    function initialize(root = document) {
        root.querySelectorAll?.(
            '#searchCategory, #categoryFilter, #listingCategory, #productCategory, [data-category-filter], select[name="category"]'
        ).forEach(populateSelect);
        window.CustomSelect?.enhanceAll?.(root);
    }

    window.VelveraCategories = {
        categories,
        getCategory,
        getValues,
        getCategoryValue,
        getSubcategoryImage,
        labelFor,
        initialize
    };
    initialize();

    const observer = new MutationObserver((mutations) => {
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType !== 1) return;
                if (node.matches?.('select')) initialize(node.parentElement || document);
                else if (node.querySelector?.('#searchCategory, #categoryFilter, #listingCategory, #productCategory, [data-category-filter], select[name="category"]')) initialize(node);
            });
        });
    });
    if (document.body) observer.observe(document.body, { childList: true, subtree: true });
})();

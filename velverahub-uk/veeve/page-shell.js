(function () {
    'use strict';

    document.addEventListener('DOMContentLoaded', function () {
        const params = new URLSearchParams(window.location.search);
        const category = params.get('category');
        const categorySelect = document.getElementById('searchCategory');
        const categoryOption = Array.from(categorySelect?.options || [])
            .find((option) => option.value === category);
        if (category && categorySelect && categoryOption) {
            categorySelect.value = category;
            window.CustomSelect?.refresh(categorySelect);
        }
    });
})();
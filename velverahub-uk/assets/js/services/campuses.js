/*
 * Campus marketplace directory.
 *
 * This is the client-side bootstrap catalog used by the picker and listing
 * forms. The SQL schema also has a schools table so this directory can be
 * promoted to an admin-managed source of truth without changing product URLs.
 */
(function () {
    'use strict';

    const entries = [
        ['Abia', 'Abia State University', 'University', 'Uturu'],
        ['Abia', 'Michael Okpara University of Agriculture', 'University', 'Umudike'],
        ['Abia', 'Abia State Polytechnic', 'Polytechnic', 'Aba'],
        ['Abia', 'Aba South College of Education', 'College of Education', 'Aba'],
        ['Adamawa', 'Modibbo Adama University', 'University', 'Yola'],
        ['Adamawa', 'Federal Polytechnic Mubi', 'Polytechnic', 'Mubi'],
        ['Adamawa', 'Adamawa State Polytechnic', 'Polytechnic', 'Yola'],
        ['Adamawa', 'College of Education, Hong', 'College of Education', 'Hong'],
        ['Akwa Ibom', 'University of Uyo', 'University', 'Uyo'],
        ['Akwa Ibom', 'Akwa Ibom State University', 'University', 'Ikot Akpaden'],
        ['Akwa Ibom', 'Federal Polytechnic, Ukana', 'Polytechnic', 'Ikot Ekpene'],
        ['Akwa Ibom', 'College of Education, Afaha Nsit', 'College of Education', 'Afaha Nsit'],
        ['Anambra', 'Nnamdi Azikiwe University (UNIZIK)', 'University', 'Awka'],
        ['Anambra', 'Chukwuemeka Odumegwu Ojukwu University', 'University', 'Igbariam'],
        ['Anambra', 'University of Onitsha', 'University', 'Onitsha'],
        ['Anambra', 'Federal Polytechnic, Oko', 'Polytechnic', 'Oko'],
        ['Anambra', 'Nwafor Orizu College of Education', 'College of Education', 'Nsugbe'],
        ['Bauchi', 'Abubakar Tafawa Balewa University', 'University', 'Bauchi'],
        ['Bauchi', 'Bauchi State University, Gadau', 'University', 'Gadau'],
        ['Bauchi', 'Federal Polytechnic, Bauchi', 'Polytechnic', 'Bauchi'],
        ['Bauchi', 'Aminu Saleh College of Education, Azare', 'College of Education', 'Azare'],
        ['Bayelsa', 'Niger Delta University', 'University', 'Wilberforce Island'],
        ['Bayelsa', 'Federal University, Otuoke', 'University', 'Otuoke'],
        ['Bayelsa', 'Bayelsa State Polytechnic', 'Polytechnic', 'Yenagoa'],
        ['Bayelsa', 'Isaac Boro College of Education', 'College of Education', 'Sagbama'],
        ['Benue', 'University of Agriculture, Makurdi', 'University', 'Makurdi'],
        ['Benue', 'Benue State University', 'University', 'Makurdi'],
        ['Benue', 'Federal University of Health Sciences, Otukpo', 'University', 'Otukpo'],
        ['Benue', 'Federal Polytechnic, Idah', 'Polytechnic', 'Otukpo'],
        ['Benue', 'College of Education, Oju', 'College of Education', 'Oju'],
        ['Borno', 'University of Maiduguri', 'University', 'Maiduguri'],
        ['Borno', 'Borno State University', 'University', 'Maiduguri'],
        ['Borno', 'Ramat Polytechnic', 'Polytechnic', 'Maiduguri'],
        ['Borno', 'Kashim Ibrahim College of Education', 'College of Education', 'Maiduguri'],
        ['Cross River', 'University of Calabar (UNICAL)', 'University', 'Calabar'],
        ['Cross River', 'Cross River University of Technology', 'University', 'Calabar'],
        ['Cross River', 'Federal Polytechnic, Ugep', 'Polytechnic', 'Ugep'],
        ['Cross River', 'College of Education, Akamkpa', 'College of Education', 'Akamkpa'],
        ['Delta', 'Delta State University, Abraka', 'University', 'Abraka'],
        ['Delta', 'Federal University of Petroleum Resources, Effurun', 'University', 'Effurun'],
        ['Delta', 'Dennis Osadebay University', 'University', 'Asaba'],
        ['Delta', 'Federal Polytechnic, Orogun', 'Polytechnic', 'Orogun'],
        ['Delta', 'College of Education, Warri', 'College of Education', 'Warri'],
        ['Ebonyi', 'Alex Ekwueme Federal University, Ndufu-Alike', 'University', 'Ndufu-Alike'],
        ['Ebonyi', 'Ebonyi State University', 'University', 'Abakaliki'],
        ['Ebonyi', 'Federal University of Technology, Ikwo', 'University', 'Ikwo'],
        ['Ebonyi', 'Akanu Ibiam Federal Polytechnic', 'Polytechnic', 'Unwana'],
        ['Ebonyi', 'Federal College of Education, Eha-Amufu', 'College of Education', 'Eha-Amufu'],
        ['Edo', 'University of Benin (UNIBEN)', 'University', 'Benin City'],
        ['Edo', 'Ambrose Alli University', 'University', 'Ekpoma'],
        ['Edo', 'Edo State University Uzairue', 'University', 'Uzairue'],
        ['Edo', 'Federal Polytechnic, Auchi', 'Polytechnic', 'Auchi'],
        ['Edo', 'College of Education, Ekiadolor', 'College of Education', 'Ekiadolor'],
        ['Ekiti', 'University of Ado-Ekiti ( now EKSU )', 'University', 'Ado-Ekiti'],
        ['Ekiti', 'Federal University, Oye-Ekiti', 'University', 'Oye-Ekiti'],
        ['Ekiti', 'Afe Babalola University', 'University', 'Ado-Ekiti'],
        ['Ekiti', 'Federal Polytechnic, Ado-Ekiti', 'Polytechnic', 'Ado-Ekiti'],
        ['Ekiti', 'College of Education, Ikere-Ekiti', 'College of Education', 'Ikere-Ekiti'],
        ['Enugu', 'University of Nigeria, Nsukka (UNN)', 'University', 'Nsukka'],
        ['Enugu', 'Enugu State University of Science and Technology', 'University', 'Enugu'],
        ['Enugu', 'Institute of Management and Technology (IMT)', 'Polytechnic', 'Enugu'],
        ['Enugu', 'Enugu State Polytechnic', 'Polytechnic', 'Igbariam'],
        ['Enugu', 'Federal College of Education, Eha-Amufu', 'College of Education', 'Eha-Amufu'],
        ['FCT (Abuja)', 'University of Abuja', 'University', 'Gwagwalada'],
        ['FCT (Abuja)', 'Nile University of Nigeria', 'University', 'Abuja'],
        ['FCT (Abuja)', 'Baze University', 'University', 'Abuja'],
        ['FCT (Abuja)', 'Veritas University', 'University', 'Bwari'],
        ['FCT (Abuja)', 'National Open University of Nigeria, Abuja', 'University', 'Abuja'],
        ['FCT (Abuja)', 'Federal Polytechnic, Bida - Abuja Study Centre', 'Polytechnic', 'Abuja'],
        ['FCT (Abuja)', 'FCT College of Education, Zuba', 'College of Education', 'Zuba'],
        ['Gombe', 'Gombe State University', 'University', 'Gombe'],
        ['Gombe', 'Federal University of Kashere', 'University', 'Kashere'],
        ['Gombe', 'Gombe State Polytechnic', 'Polytechnic', 'Kumo'],
        ['Gombe', 'Federal College of Education (Technical), Gombe', 'College of Education', 'Gombe'],
        ['Imo', 'Imo State University (IMSU)', 'University', 'Owerri'],
        ['Imo', 'Federal University of Technology, Owerri (FUTO)', 'University', 'Owerri'],
        ['Imo', 'Hezekiah University', 'University', 'Umudi'],
        ['Imo', 'Federal Polytechnic, Nekede', 'Polytechnic', 'Owerri'],
        ['Imo', 'Alvan Ikoku Federal College of Education', 'College of Education', 'Owerri'],
        ['Jigawa', 'Federal University, Dutse', 'University', 'Dutse'],
        ['Jigawa', 'Jigawa State College of Education', 'College of Education', 'Gumel'],
        ['Jigawa', 'Hussaini Adamu Federal Polytechnic', 'Polytechnic', 'Kazaure'],
        ['Kaduna', 'Ahmadu Bello University (ABU)', 'University', 'Zaria'],
        ['Kaduna', 'Kaduna State University', 'University', 'Kaduna'],
        ['Kaduna', 'Nigerian Defence Academy', 'University', 'Kaduna'],
        ['Kaduna', 'Kaduna Polytechnic', 'Polytechnic', 'Kaduna'],
        ['Kaduna', 'Federal College of Education, Zaria', 'College of Education', 'Zaria'],
        ['Kano', 'Bayero University Kano (BUK)', 'University', 'Kano'],
        ['Kano', 'Kano University of Science and Technology', 'University', 'Wudil'],
        ['Kano', 'Northwest University, Kano', 'University', 'Kano'],
        ['Kano', 'Federal College of Education, Kano', 'College of Education', 'Kano'],
        ['Kano', 'Federal Polytechnic, Kazaure - Kano Campus', 'Polytechnic', 'Kano'],
        ['Katsina', 'Federal University, Dutsin-Ma', 'University', 'Dutsin-Ma'],
        ['Katsina', 'Umaru Musa Yar’Adua University', 'University', 'Katsina'],
        ['Katsina', 'Hassan Usman Katsina Polytechnic', 'Polytechnic', 'Katsina'],
        ['Katsina', 'Federal College of Education, Katsina', 'College of Education', 'Katsina'],
        ['Kebbi', 'Federal University, Birnin Kebbi', 'University', 'Birnin Kebbi'],
        ['Kebbi', 'Kebbi State University of Science and Technology', 'University', 'Aliero'],
        ['Kebbi', 'Federal Polytechnic, Birnin Kebbi', 'Polytechnic', 'Birnin Kebbi'],
        ['Kebbi', 'Adamu Augie College of Education', 'College of Education', 'Argungu'],
        ['Kogi', 'Federal University, Lokoja', 'University', 'Lokoja'],
        ['Kogi', 'Kogi State University', 'University', 'Anyigba'],
        ['Kogi', 'Federal Polytechnic, Idah', 'Polytechnic', 'Idah'],
        ['Kogi', 'College of Education, Ankpa', 'College of Education', 'Ankpa'],
        ['Kwara', 'University of Ilorin (UNILORIN)', 'University', 'Ilorin'],
        ['Kwara', 'Kwara State University', 'University', 'Malete'],
        ['Kwara', 'Al-Hikmah University', 'University', 'Ilorin'],
        ['Kwara', 'Kwara State Polytechnic', 'Polytechnic', 'Ilorin'],
        ['Kwara', 'College of Education, Ilorin', 'College of Education', 'Ilorin'],
        ['Lagos', 'University of Lagos (UNILAG)', 'University', 'Akoka'],
        ['Lagos', 'Lagos State University (LASU)', 'University', 'Ojo'],
        ['Lagos', 'Lagos State University of Science and Technology', 'University', 'Ikorodu'],
        ['Lagos', 'Yaba College of Technology (YABATECH)', 'Polytechnic', 'Yaba'],
        ['Lagos', 'Lagos City Polytechnic', 'Polytechnic', 'Mushin'],
        ['Lagos', 'Federal College of Education (Technical), Akoka', 'College of Education', 'Akoka'],
        ['Nasarawa', 'Federal University, Lafia', 'University', 'Lafia'],
        ['Nasarawa', 'Nasarawa State University', 'University', 'Keffi'],
        ['Nasarawa', 'Isa Mustapha Agwai Polytechnic', 'Polytechnic', 'Lafia'],
        ['Nasarawa', 'College of Education, Akwanga', 'College of Education', 'Akwanga'],
        ['Niger', 'Federal University of Technology, Minna (FUTMINNA)', 'University', 'Minna'],
        ['Niger', 'Ibrahim Badamasi Babangida University', 'University', 'Lapai'],
        ['Niger', 'Niger State Polytechnic', 'Polytechnic', 'Zungeru'],
        ['Niger', 'Federal College of Education, Kontagora', 'College of Education', 'Kontagora'],
        ['Ogun', 'Federal University of Agriculture, Abeokuta (FUNAAB)', 'University', 'Abeokuta'],
        ['Ogun', 'Olabisi Onabanjo University', 'University', 'Ago-Iwoye'],
        ['Ogun', 'Covenant University', 'University', 'Ota'],
        ['Ogun', 'Babcock University', 'University', 'Ilishan-Remo'],
        ['Ogun', 'Moshood Abiola Polytechnic', 'Polytechnic', 'Abeokuta'],
        ['Ogun', 'Tai Solarin University of Education', 'University', 'Ijagun'],
        ['Ogun', 'Federal College of Education, Osiele', 'College of Education', 'Abeokuta'],
        ['Ondo', 'Federal University of Technology, Akure (FUTA)', 'University', 'Akure'],
        ['Ondo', 'Adekunle Ajasin University', 'University', 'Akungba-Akoko'],
        ['Ondo', 'University of Medical Sciences, Ondo', 'University', 'Ondo'],
        ['Ondo', 'Federal Polytechnic, Ile-Oluji', 'Polytechnic', 'Ile-Oluji'],
        ['Ondo', 'Adeyemi College of Education', 'College of Education', 'Ondo'],
        ['Osun', 'Obafemi Awolowo University (OAU)', 'University', 'Ile-Ife'],
        ['Osun', 'Osun State University', 'University', 'Osogbo'],
        ['Osun', 'Redeemer’s University', 'University', 'Ede'],
        ['Osun', 'Federal Polytechnic, Ede', 'Polytechnic', 'Ede'],
        ['Osun', 'Osun State College of Education', 'College of Education', 'Ilesa'],
        ['Oyo', 'University of Ibadan (UI)', 'University', 'Ibadan'],
        ['Oyo', 'Ladoke Akintola University of Technology (LAUTECH)', 'University', 'Ogbomoso'],
        ['Oyo', 'Lead City University', 'University', 'Ibadan'],
        ['Oyo', 'The Polytechnic, Ibadan', 'Polytechnic', 'Ibadan'],
        ['Oyo', 'Federal College of Education (Special), Oyo', 'College of Education', 'Oyo'],
        ['Plateau', 'University of Jos (UNIJOS)', 'University', 'Jos'],
        ['Plateau', 'Plateau State University', 'University', 'Bokkos'],
        ['Plateau', 'Federal University of Education, Pankshin', 'College of Education', 'Pankshin'],
        ['Plateau', 'Plateau State Polytechnic', 'Polytechnic', 'Barkin Ladi'],
        ['Rivers', 'University of Port Harcourt (UNIPORT)', 'University', 'Choba'],
        ['Rivers', 'Rivers State University', 'University', 'Nkpolu-Oroworukwo'],
        ['Rivers', 'Federal University of Environment and Technology, Saakpenwa', 'University', 'Saakpenwa'],
        ['Rivers', 'Captain Elechi Amadi Polytechnic', 'Polytechnic', 'Port Harcourt'],
        ['Rivers', 'Federal College of Education (Technical), Omoku', 'College of Education', 'Omoku'],
        ['Sokoto', 'Usmanu Danfodiyo University', 'University', 'Sokoto'],
        ['Sokoto', 'Sokoto State University', 'University', 'Sokoto'],
        ['Sokoto', 'Sokoto State Polytechnic', 'Polytechnic', 'Sokoto'],
        ['Sokoto', 'Shehu Shagari College of Education', 'College of Education', 'Sokoto'],
        ['Taraba', 'Federal University, Wukari', 'University', 'Wukari'],
        ['Taraba', 'Taraba State University', 'University', 'Jalingo'],
        ['Taraba', 'Federal Polytechnic, Bali', 'Polytechnic', 'Bali'],
        ['Taraba', 'College of Education, Zing', 'College of Education', 'Zing'],
        ['Yobe', 'Yobe State University', 'University', 'Damaturu'],
        ['Yobe', 'Federal Polytechnic, Damaturu', 'Polytechnic', 'Damaturu'],
        ['Yobe', 'College of Education, Gashua', 'College of Education', 'Gashua'],
        ['Zamfara', 'Federal University, Gusau', 'University', 'Gusau'],
        ['Zamfara', 'Zamfara State University', 'University', 'Talata Mafara'],
        ['Zamfara', 'Federal Polytechnic, Kaura Namoda', 'Polytechnic', 'Kaura Namoda'],
        ['Zamfara', 'Federal College of Education, Gusau', 'College of Education', 'Gusau']
    ];

    function slugify(value) {
        return String(value)
            .toLowerCase()
            .replace(/[’']/g, '')
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    let institutions = entries.map(([state, name, type, city]) => ({
        state,
        name,
        type,
        city,
        slug: slugify(name),
        aliases: [name, slugify(name)]
    }));

    /*
     * Marketplace places are intentionally broader than schools. These
     * aliases cover the neighbourhood/landmark searches buyers commonly use
     * while keeping a canonical state for product filtering.
     */
    const popularPlaces = [
        ['FCT (Abuja)', 'Central Business District', 'Abuja', ['central business district', 'cbd'], true],
        ['FCT (Abuja)', 'Gwarinpa', 'Abuja', ['gwarinpa'], true],
        ['FCT (Abuja)', 'Kubwa', 'Abuja', ['kubwa'], true],
        ['FCT (Abuja)', 'Wuse', 'Abuja', ['wuse'], true],
        ['FCT (Abuja)', 'Wuse 2', 'Abuja', ['wuse 2', 'wuse two'], true],
        ['FCT (Abuja)', 'Abaji', 'Abuja', ['abaji']],
        ['FCT (Abuja)', 'Apo District', 'Abuja', ['apo district', 'apo']],
        ['FCT (Abuja)', 'Asokoro', 'Abuja', ['asokoro']],
        ['FCT (Abuja)', 'Bwari', 'Abuja', ['bwari']],
        ['FCT (Abuja)', 'Dakibiyu', 'Abuja', ['dakibiyu']],
        ['FCT (Abuja)', 'Dakwo District', 'Abuja', ['dakwo district', 'dakwo']],
        ['FCT (Abuja)', 'Dawaki', 'Abuja', ['dawaki']],
        ['Lagos', 'Bariga', 'Lagos', ['bariga', 'shomolu', 'somolu'], true],
        ['Lagos', 'Victoria Garden City (VGC)', 'Lagos', ['vgc', 'victoria garden city', 'victoria garden city estate'], true],
        ['Lagos', 'Apapa', 'Lagos', ['apapa'], true],
        ['Lagos', 'Badagry', 'Lagos', ['badagry'], true],
        ['Lagos', 'Ojo', 'Lagos', ['ojo', 'lasu ojo'], true],
        ['Lagos', 'Ikeja', 'Lagos', ['ikeja']],
        ['Lagos', 'Yaba', 'Lagos', ['yaba', 'yabatech']],
        ['Lagos', 'Lekki', 'Lagos', ['lekki', 'lekki phase 1']],
        ['Lagos', 'Ajah', 'Lagos', ['ajah']],
        ['Lagos', 'Ikorodu', 'Lagos', ['ikorodu']],
        ['Lagos', 'Surulere', 'Lagos', ['surulere']],
        ['Lagos', 'Festac Town', 'Lagos', ['festac', 'festac town']],
        ['Lagos', 'Mushin', 'Lagos', ['mushin']],
        ['Lagos', 'Agege', 'Lagos', ['agege']],
        ['Lagos', 'Alimosho', 'Lagos', ['alimosho']],
        ['Anambra', 'Awka', 'Awka', ['awka']],
        ['Enugu', 'Nsukka', 'Nsukka', ['nsukka']],
        ['Enugu', 'Enugu', 'Enugu', ['enugu']],
        ['Edo', 'Benin City', 'Benin City', ['benin', 'benin city']],
        ['Imo', 'Owerri', 'Owerri', ['owerri']],
        ['Kogi', 'Lokoja', 'Lokoja', ['lokoja']],
        ['Kogi', 'Kogi', 'Kogi', ['kogi']]
    ].map(([state, name, city, aliases, popular = false]) => ({
        state, name, city, area: name, type: 'Local area',
        slug: `place-${slugify(name)}`,
        popular,
        aliases: [name, city, ...aliases]
    }));

    const normalise = (value) => String(value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[’']/g, '')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();

    function editDistance(left, right) {
        if (!left || !right) return Math.max(left?.length || 0, right?.length || 0);
        if (Math.abs(left.length - right.length) > 3) return 4;
        const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
        for (let row = 1; row <= left.length; row++) {
            const current = [row];
            for (let column = 1; column <= right.length; column++) {
                current[column] = Math.min(
                    current[column - 1] + 1,
                    previous[column] + 1,
                    previous[column - 1] + (left[row - 1] === right[column - 1] ? 0 : 1)
                );
            }
            previous.splice(0, previous.length, ...current);
        }
        return previous[right.length];
    }

    function mergeRemoteInstitutions(remoteEntries) {
        // The uploaded directory is the source of truth once it is available.
        // Key by normalized state/name rather than only by id so aliases or
        // an older built-in record cannot create a conflicting duplicate.
        const merged = new Map();
        remoteEntries.forEach((entry) => {
            if (!entry?.name || !entry?.state) return;
            const school = {
                ...entry,
                state: entry.state === 'FCT Abuja' ? 'FCT (Abuja)' : entry.state,
                city: entry.city || entry.area || entry.state,
                type: entry.type || 'University',
                slug: entry.id || slugify(entry.name),
                aliases: [entry.name, entry.short_name, entry.id, entry.city, entry.area]
            };
            const key = `${school.state}|${normalise(school.name)}`;
            const existing = merged.get(key);
            merged.set(key, existing ? {
                ...existing,
                ...school,
                aliases: [...new Set([...(existing.aliases || []), ...(school.aliases || [])].filter(Boolean))]
            } : school);
        });
        institutions = [...merged.values()];
    }

    window.CampusService = {
        all() {
            return institutions.slice();
        },
        slugify,
        getByState(state) {
            return institutions.filter((school) => school.state === state);
        },
        find(slug) {
            return institutions.find((school) => school.slug === slug) || null;
        },
        getStateForSlug(slug) {
            return this.find(slug)?.state || null;
        },
        search(query, state) {
            const needle = normalise(query);
            return institutions.filter((school) => {
                if (state && school.state !== state) return false;
                return !needle || normalise([
                    school.name, school.short_name, school.city, school.area,
                    school.type, ...(school.aliases || [])
                ].join(' ')).includes(needle);
            });
        },
        searchLocations(query, state) {
            const needle = normalise(query);
            const tokens = needle.split(' ').filter(Boolean);
            const states = (window.RegionService?.getNigerianStates?.() || []).map((value) => ({
                state: value, name: value === 'FCT (Abuja)' ? 'Abuja (FCT)' : value,
                city: value === 'FCT (Abuja)' ? 'Abuja' : value, type: 'State',
                slug: `state-${slugify(value)}`, kind: 'state', aliases: [value]
            }));
            const places = [...popularPlaces, ...institutions.map((school) => ({ ...school, kind: 'campus' }))];
            return [...states, ...places]
                .filter((place) => !state || place.state === state)
                .filter((place) => {
                    if (!needle) return true;
                    const haystack = normalise([
                        place.name, place.short_name, place.city, place.area,
                        place.type, place.state, ...(place.aliases || [])
                    ].join(' '));
                    const haystackTokens = haystack.split(' ').filter(Boolean);
                    // Token matching makes searches resilient to punctuation
                    // and word order, while still requiring every search term.
                    // A small edit-distance allowance handles common mobile
                    // typos without returning unrelated campuses.
                    return haystack.includes(needle) || tokens.every((token) =>
                        haystackTokens.some((candidate) =>
                            candidate.includes(token) ||
                            (token.length >= 5 && candidate.length >= 5 &&
                                editDistance(token, candidate) <= 1)
                        )
                    );
                })
                .sort((left, right) => {
                    const score = (place) => {
                        if (!needle) return 0;
                        const name = normalise(place.name);
                        const aliases = normalise([place.short_name, ...(place.aliases || [])].join(' '));
                        const haystack = normalise([
                            place.name, place.short_name, place.city, place.area,
                            place.type, place.state, ...(place.aliases || [])
                        ].join(' '));
                        const tokenMatches = tokens.filter((token) => haystack.includes(token)).length;
                        const exactAlias = [place.short_name, ...(place.aliases || [])]
                            .map(normalise)
                            .filter(Boolean)
                            .some((alias) => alias === needle);
                        const fuzzyTokenMatches = tokens.filter((token) =>
                            haystack.split(' ').some((candidate) =>
                                token.length >= 5 && candidate.length >= 5 &&
                                editDistance(token, candidate) <= 1
                            )
                        ).length;
                        return (name === needle ? 1000 : 0)
                            + (name.startsWith(needle) ? 500 : 0)
                            + (exactAlias ? 450 : 0)
                            + (haystack.startsWith(needle) ? 200 : 0)
                            + (tokenMatches * 25)
                            + (fuzzyTokenMatches * 8)
                            - Math.min(needle.length, 30);
                    };
                    return score(right) - score(left) || left.name.localeCompare(right.name);
                });
        },
        places() {
            return popularPlaces.slice();
        },
        label(school) {
            return school ? `${school.name} · ${school.city}` : '';
        }
    };

    /*
     * Keep the embedded directory as the reliable baseline. The old optional
     * upload referenced a removed attached asset, which created a 404 on every
     * page load and made the location picker look unreliable. A future
     * Supabase-managed schools table can extend this directory explicitly.
     */
    window.CampusService.ready = Promise.resolve(window.CampusService.all());
})();
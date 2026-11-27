(() => {
    const service = () => window.LogisticsService;
    const state = {
        supabase: null,
        profiles: [],
        dashboard: null,
        shops: [],
        areaMap: null,
        dashboardRequestId: 0,
        selectedAreaPoint: null,
        editingAreaId: null,
        authUser: null
    };
    const byId = (id) => document.getElementById(id);
    const escapeHtml = (value) => service().escapeHtml(value);

    function setStatus(id, message, kind = '') {
        const node = byId(id);
        if (!node) return;
        node.textContent = message || '';
        node.classList.toggle('is-error', kind === 'error');
        node.classList.toggle('is-success', kind === 'success');
    }

    function reportError(id, error, fallback) {
        window.AsyncFeedback?.log('logistics-page', window.AsyncFeedback?.createRequestId('logistics'), error);
        const missingMigration = /function .* does not exist|schema cache|pgrst202|could not find the function/i.test(String(error?.message || error));
        setStatus(id, missingMigration
            ? 'Location services are not installed yet. An administrator must apply the location and logistics database migrations.'
            : fallback, 'error');
    }

    function providerLabel(profile) {
        return profile.provider_type === 'logistics_company' ? 'Logistics company' : 'Independent rider';
    }

    function requestActionButtons(request) {
        const actions = {
            requested: [['accepted', 'Accept'], ['rejected', 'Decline']],
            accepted: [['picked_up', 'Mark picked up'], ['cancelled', 'Cancel delivery']],
            picked_up: [['in_transit', 'In transit'], ['issue_reported', 'Report an issue']],
            in_transit: [['delivered', 'Delivered'], ['issue_reported', 'Report an issue']],
            issue_reported: [['in_transit', 'Resume delivery'], ['delivered', 'Delivered']]
        }[request.status] || [];
        return actions.map(([status, title]) =>
            `<button class="logistics-button ${status === 'rejected' || status === 'cancelled' ? 'logistics-button--danger' : 'logistics-button--secondary'}" type="button" data-request-status="${status}" data-request-id="${escapeHtml(request.id)}">${title}</button>`
        ).join('');
    }

    function renderProviderDashboard() {
        const data = state.dashboard;
        state.areaMap?.map?.remove?.();
        state.areaMap = null;
        state.selectedAreaPoint = null;
        const card = byId('providerProfileCard');
        const registrationCard = byId('providerRegistrationCard');
        const host = byId('providerDashboard');
        if (!data?.provider) {
            card.hidden = true;
            registrationCard.hidden = false;
            return;
        }
        card.hidden = false;
        registrationCard.hidden = false;
        const provider = data.provider;
        const verification = data.verification;
        const approved = provider.status === 'approved' && provider.is_verified === true;
        const areas = Array.isArray(data.service_areas) ? data.service_areas : [];
        const requests = Array.isArray(data.requests) ? data.requests : [];
        const engagements = Array.isArray(data.engagements) ? data.engagements : [];
        host.innerHTML = `
            <form id="providerProfileForm">
                <div class="logistics-form-grid">
                    <div class="logistics-field"><label for="profileDisplayName">Public name</label><input id="profileDisplayName" maxlength="120" value="${escapeHtml(provider.display_name)}" required></div>
                    <div class="logistics-field"><label for="profileVehicleType">Vehicle or fleet</label><select id="profileVehicleType">${['motorcycle','car','van','fleet','other'].map((item) => `<option value="${item}" ${item === provider.vehicle_type ? 'selected' : ''}>${item[0].toUpperCase()}${item.slice(1)}</option>`).join('')}</select></div>
                    <div class="logistics-field logistics-field--wide"><label for="profileDescription">Service description</label><textarea id="profileDescription" maxlength="1200">${escapeHtml(provider.description || '')}</textarea></div>
                </div>
                <div class="logistics-actions"><button class="logistics-button logistics-button--secondary" type="submit">Save public profile</button></div>
            </form>
            <p><span class="logistics-badge">${escapeHtml(provider.status)}${provider.is_verified ? ' · verified' : ''}</span> ${verification?.status ? `<span class="logistics-badge">Documents: ${escapeHtml(verification.status)}</span>` : ''}</p>
            <form id="providerVerificationForm">
                <h3>Identity and business verification</h3>
                <p class="logistics-help">Documents are stored in private storage. Administrators review them before the profile can be matched to buyers.</p>
                <div class="logistics-form-grid">
                    <div class="logistics-field"><label for="legalName">Legal name</label><input id="legalName" minlength="2" maxlength="160" value="${escapeHtml(verification?.legal_name || '')}" required></div>
                    <div class="logistics-field ${provider.provider_type === 'logistics_company' ? '' : 'logistics-hidden'}" id="companyRegistrationFields"><label for="businessName">Registered business name</label><input id="businessName" maxlength="160" value="${escapeHtml(verification?.registered_business_name || '')}"></div>
                    <div class="logistics-field ${provider.provider_type === 'logistics_company' ? '' : 'logistics-hidden'}" id="companyNumberField"><label for="registrationNumber">Business registration number</label><input id="registrationNumber" maxlength="120" value="${escapeHtml(verification?.registration_number || '')}"></div>
                    <div class="logistics-field ${provider.provider_type === 'independent_rider' ? '' : 'logistics-hidden'}" id="identityTypeField"><label for="identityDocumentType">Identity document</label><select id="identityDocumentType"><option value="">Choose one</option>${[['passport','Passport'],['national_id','National ID'],['drivers_license','Driver’s license'],['voters_card','Voter’s card']].map(([v,l]) => `<option value="${v}" ${verification?.identity_document_type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>
                    <div class="logistics-field logistics-field--wide"><label for="verificationFiles">Verification documents</label><input id="verificationFiles" type="file" accept="application/pdf,image/jpeg,image/png" multiple required><span class="logistics-help">Upload 1–5 PDF, JPEG, or PNG files, up to 5 MiB each.</span></div>
                </div>
                <div class="logistics-actions"><button class="logistics-button" type="submit">Submit for review</button></div>
            </form>
            <hr>
            <h3>Provider availability</h3>
            <p class="logistics-help">Order availability expires automatically. Buyers only see approved profiles that are currently available and whose service area covers both ends of the route.</p>
            <label class="logistics-checkline"><input type="checkbox" id="deliveryAvailable" ${provider.is_available ? 'checked' : ''} ${approved && areas.some((area) => area.is_active) ? '' : 'disabled'}><span>Available for new order deliveries for the next four hours</span></label>
            ${provider.status === 'approved' && areas.length === 0 ? '<p class="logistics-help">Add an active service area before turning on delivery availability.</p>' : ''}
            ${provider.provider_type === 'independent_rider' ? `<label class="logistics-checkline"><input type="checkbox" id="workforceInterest" ${provider.accepts_workforce_engagements ? 'checked' : ''} ${approved ? '' : 'disabled'}><span>Let sellers find me for temporary or permanent rider work (separate from order availability)</span></label>` : ''}
            <hr>
            <h3>Service areas</h3>
            <div class="logistics-results">${areas.length ? areas.map((area) => `
                <article class="logistics-result">
                    <header><strong>${escapeHtml(area.city)}, ${escapeHtml(area.state_or_region)}</strong><span class="logistics-badge">${area.is_active ? 'Active coverage' : 'Inactive'}</span></header>
                    <p>${escapeHtml(area.coverage_radius_km)} km radius · ${escapeHtml((area.service_types || []).join(', '))} · ${service().formatFee(Number(area.base_fee) || 0, area.currency_code)} base + ${service().formatFee(Number(area.per_km_fee) || 0, area.currency_code)}/km</p>
                    <p class="logistics-help">${escapeHtml(area.eta_min_minutes)}–${escapeHtml(area.eta_max_minutes)} minutes · ${escapeHtml(area.coverage_radius_km)} km coverage</p>
                    <div class="logistics-actions"><button class="logistics-button logistics-button--secondary" type="button" data-edit-area="${escapeHtml(area.id)}">Edit area</button><button class="logistics-button logistics-button--danger" type="button" data-delete-area="${escapeHtml(area.id)}">Remove area</button></div>
                </article>`).join('') : '<p>No service areas yet. Add a real operating point and coverage radius.</p>'}</div>
            <form id="serviceAreaForm">
                <h3 id="serviceAreaFormTitle">Add service area</h3>
                <div class="logistics-form-grid">
                    <div class="logistics-field"><label for="areaCountry">Market</label><select id="areaCountry"><option value="NG" ${provider.country_code === 'NG' ? 'selected' : ''}>Nigeria</option><option value="GB" ${provider.country_code === 'GB' ? 'selected' : ''}>United Kingdom</option></select></div>
                    <div class="logistics-field"><label for="areaRegion">State or region</label><input id="areaRegion" maxlength="120" required></div>
                    <div class="logistics-field"><label for="areaCity">City</label><input id="areaCity" maxlength="120" required></div>
                    <div class="logistics-field"><label for="areaRadius">Coverage radius (km)</label><input id="areaRadius" type="number" min="1" max="200" step="0.5" value="15" required></div>
                    <div class="logistics-field"><label for="areaBaseFee" id="areaBaseFeeLabel">Base fee (${service().marketCurrency(provider.country_code)})</label><input id="areaBaseFee" type="number" min="0" step="0.01" required></div>
                    <div class="logistics-field"><label for="areaPerKmFee" id="areaPerKmFeeLabel">Fee per km (${service().marketCurrency(provider.country_code)})</label><input id="areaPerKmFee" type="number" min="0" step="0.01" required></div>
                    <div class="logistics-field"><label for="areaEtaMin">Fastest estimate (minutes)</label><input id="areaEtaMin" type="number" min="5" max="10080" value="60" required></div>
                    <div class="logistics-field"><label for="areaEtaMax">Longest estimate (minutes)</label><input id="areaEtaMax" type="number" min="5" max="10080" value="180" required></div>
                    <div class="logistics-field logistics-field--wide"><label>Service types</label><div>${[['standard','Standard'],['same_day','Same day'],['next_day','Next day'],['express','Express'],['scheduled','Scheduled']].map(([value,label]) => `<label class="logistics-checkline"><input type="checkbox" name="areaServiceType" value="${value}" ${value === 'standard' ? 'checked' : ''}><span>${label}</span></label>`).join('')}</div></div>
                </div>
                <div class="logistics-search">
                    <input id="areaAddress" maxlength="180" placeholder="Search a real city or operating address" aria-label="Service area address">
                    <button class="logistics-button logistics-button--secondary" type="button" id="geocodeAreaAddress">Find address</button>
                </div>
                <div class="logistics-map" id="serviceAreaMap" aria-label="Service area center map; click to place the center pin"></div>
                <p class="logistics-help">Click the map to set the service-area center. The coverage radius is measured from this real point.</p>
                <div class="logistics-actions"><button class="logistics-button" type="submit" id="saveServiceAreaButton">Save service area</button><button class="logistics-button logistics-button--secondary logistics-hidden" type="button" id="cancelAreaEdit">Cancel editing</button></div>
            </form>
            <hr>
            <h3>Delivery requests</h3>
            <div class="logistics-results">${requests.length ? requests.map((request) => `
                <article class="logistics-result">
                    <header><strong>Order ${escapeHtml(request.order_number || request.order_id)}</strong><span class="logistics-badge">${escapeHtml(request.status)}</span></header>
                    <p>${escapeHtml(request.distance_km)} km · ${service().formatFee(request.total_fee_amount, request.currency_code)} · ${escapeHtml(request.eta_min_minutes)}–${escapeHtml(request.eta_max_minutes)} minutes</p>
                    <p class="logistics-help">${escapeHtml(request.shipping_address?.city || '')} ${escapeHtml(request.shipping_address?.state || '')}</p>
                    ${request.response_note ? `<p>${escapeHtml(request.response_note)}</p>` : ''}
                    <div class="logistics-actions">${requestActionButtons(request)}</div>
                </article>`).join('') : '<p>No active order delivery requests.</p>'}</div>
            <hr>
            <h3>Rider work invitations</h3>
            <div class="logistics-results">${engagements.length ? engagements.map((engagement) => `
                <article class="logistics-result">
                    <header><strong>${escapeHtml(engagement.shop_name)} · ${escapeHtml(engagement.engagement_type)}</strong><span class="logistics-badge">${escapeHtml(engagement.status)}</span></header>
                    <p>${escapeHtml(engagement.start_date)}${engagement.end_date ? ` to ${escapeHtml(engagement.end_date)}` : ''}</p>
                    <p>${escapeHtml(engagement.terms?.summary || 'No additional terms provided.')}</p>
                    ${engagement.status === 'invited' ? `<div class="logistics-actions"><button class="logistics-button" type="button" data-engagement-id="${escapeHtml(engagement.id)}" data-engagement-decision="accepted">Accept</button><button class="logistics-button logistics-button--danger" type="button" data-engagement-id="${escapeHtml(engagement.id)}" data-engagement-decision="rejected">Decline</button></div>` : ''}
                </article>`).join('') : '<p>No rider work invitations.</p>'}</div>
        `;
        state.selectedAreaPoint = null;
        initializeProviderControls(provider);
    }

    async function initializeProviderControls(provider) {
        const dashboardRequestId = state.dashboardRequestId;
        const mapContainer = byId('serviceAreaMap');
        const country = byId('areaCountry')?.value || provider.country_code;
        try {
            const map = await service().createMap(mapContainer, null, {
                draggable: true,
                countryCode: country,
                onSelect: (latitude, longitude) => {
                    state.selectedAreaPoint = { latitude, longitude };
                }
            });
            if (dashboardRequestId !== state.dashboardRequestId || !mapContainer?.isConnected) {
                map.map?.remove?.();
                return;
            }
            state.areaMap = map;
        } catch (error) {
            if (dashboardRequestId !== state.dashboardRequestId) return;
            setStatus('providerRegistrationStatus', error.message, 'error');
        }
        syncServiceAreaCurrency();
        byId('areaCountry')?.addEventListener('change', () => {
            state.selectedAreaPoint = null;
            state.editingAreaId = null;
            byId('areaRegion').value = '';
            byId('areaCity').value = '';
            byId('areaAddress').value = '';
            byId('areaBaseFee').value = '';
            byId('areaPerKmFee').value = '';
            byId('serviceAreaFormTitle').textContent = 'Add service area';
            byId('saveServiceAreaButton').textContent = 'Save service area';
            byId('cancelAreaEdit').classList.add('logistics-hidden');
            syncServiceAreaCurrency();
            state.areaMap?.clearLocation(byId('areaCountry').value);
            const isSupportedMarket = byId('areaCountry').value === provider.country_code;
            setStatus(
                'providerRegistrationStatus',
                isSupportedMarket
                    ? 'Market changed. Re-enter the location and fees, then place a new map pin.'
                    : `This profile is registered for ${provider.country_code === 'GB' ? 'the United Kingdom' : 'Nigeria'}. Service areas must use that market.`,
                isSupportedMarket ? '' : 'error'
            );
        });
        byId('cancelAreaEdit')?.addEventListener('click', cancelAreaEdit);
        byId('geocodeAreaAddress')?.addEventListener('click', async () => {
            try {
                const found = await service().geocodeAddress(byId('areaAddress').value, byId('areaCountry').value);
                state.selectedAreaPoint = { latitude: found.latitude, longitude: found.longitude };
                state.areaMap?.setLocation(found.latitude, found.longitude);
                setStatus('providerRegistrationStatus', `Found ${found.displayName}. Adjust the pin if needed.`, 'success');
            } catch (error) {
                setStatus('providerRegistrationStatus', error.message, 'error');
            }
        });
        byId('providerProfileForm')?.addEventListener('submit', saveProviderProfile);
        byId('providerVerificationForm')?.addEventListener('submit', submitVerification);
        byId('serviceAreaForm')?.addEventListener('submit', saveServiceArea);
        byId('deliveryAvailable')?.addEventListener('change', updateAvailability);
        byId('workforceInterest')?.addEventListener('change', updateWorkforceInterest);
        byId('providerDashboard')?.addEventListener('click', handleProviderDashboardClick);
    }

    function syncServiceAreaCurrency() {
        const countryCode = byId('areaCountry')?.value || state.dashboard?.provider?.country_code;
        if (!countryCode) return;
        const currency = service().marketCurrency(countryCode);
        const baseLabel = byId('areaBaseFeeLabel');
        const perKmLabel = byId('areaPerKmFeeLabel');
        if (baseLabel) baseLabel.textContent = `Base fee (${currency})`;
        if (perKmLabel) perKmLabel.textContent = `Fee per km (${currency})`;
    }

    function syncProviderRegistrationFields() {
        const company = byId('providerType')?.value === 'logistics_company';
        const vehicleLabel = byId('providerVehicleLabel');
        const vehicleHelp = byId('providerVehicleHelp');
        if (vehicleLabel) vehicleLabel.textContent = company ? 'Primary fleet vehicle' : 'Primary vehicle';
        if (vehicleHelp) {
            vehicleHelp.textContent = company
                ? 'Choose the vehicle type that best represents your delivery fleet.'
                : 'Choose the vehicle you use for rider deliveries.';
        }
    }

    async function refreshProfiles(chooseId) {
        state.profiles = await service().rpc('delivery_provider_list_my_profiles');
        const select = byId('providerProfileSelect');
        const preferredId = chooseId || select.value;
        select.innerHTML = state.profiles.map((profile) =>
            `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.display_name)} · ${escapeHtml(providerLabel(profile))}</option>`
        ).join('');
        if (state.profiles.some((profile) => profile.id === preferredId)) select.value = preferredId;
        if (state.profiles.length) await loadDashboard(select.value);
        else renderProviderDashboard();
    }

    async function loadDashboard(providerId) {
        const requestId = ++state.dashboardRequestId;
        const dashboard = await service().rpc('delivery_provider_get_dashboard', { p_provider_id: providerId });
        if (requestId !== state.dashboardRequestId || byId('providerProfileSelect')?.value !== providerId) return;
        state.dashboard = dashboard;
        renderProviderDashboard();
    }

    async function registerProvider(event) {
        event.preventDefault();
        const form = event.currentTarget;
        const selectedRegistrationValues = ['providerType', 'providerCountry', 'providerVehicle']
            .map((id) => [id, byId(id).value]);
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const id = await service().rpc('delivery_provider_register', {
                p_provider_type: byId('providerType').value,
                p_display_name: byId('providerDisplayName').value.trim(),
                p_country_code: byId('providerCountry').value,
                p_description: byId('providerDescription').value.trim(),
                p_vehicle_type: byId('providerVehicle').value
            });
            form.reset();
            selectedRegistrationValues.forEach(([id, value]) => { byId(id).value = value; });
            syncProviderRegistrationFields();
            await refreshProfiles(id);
            setStatus('providerRegistrationStatus', 'Profile created. Submit verification documents before you can become available to buyers.', 'success');
        } catch (error) {
            reportError('providerRegistrationStatus', error, 'Provider profile could not be saved. Check your details and try again.');
        } finally {
            button.disabled = false;
        }
    }

    async function saveProviderProfile(event) {
        event.preventDefault();
        const providerId = byId('providerProfileSelect').value;
        try {
            await service().rpc('delivery_provider_save_profile', {
                p_provider_id: providerId,
                p_display_name: byId('profileDisplayName').value.trim(),
                p_description: byId('profileDescription').value.trim(),
                p_vehicle_type: byId('profileVehicleType').value
            });
            await refreshProfiles(providerId);
            setStatus('providerRegistrationStatus', 'Public profile saved.', 'success');
        } catch (error) {
            reportError('providerRegistrationStatus', error, 'Profile could not be saved. Please try again.');
        }
    }

    async function submitVerification(event) {
        event.preventDefault();
        const provider = state.dashboard?.provider;
        const files = Array.from(byId('verificationFiles').files || []);
        if (!provider?.id) return;
        if (files.length < 1 || files.length > 5 || files.some((file) => file.size > 5 * 1024 * 1024 || !['application/pdf', 'image/jpeg', 'image/png'].includes(file.type))) {
            setStatus('providerRegistrationStatus', 'Choose 1–5 PDF, JPEG, or PNG documents, each no larger than 5 MiB.', 'error');
            return;
        }
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const storage = state.supabase.storage.from(service().TABLES.verificationBucket);
            const paths = [];
            for (const file of files) {
                const extension = file.type === 'application/pdf' ? 'pdf' : file.type === 'image/png' ? 'png' : 'jpg';
                const path = `${provider.id}/${crypto.randomUUID()}.${extension}`;
                const { error } = await storage.upload(path, file, { upsert: false, contentType: file.type });
                if (error) throw error;
                paths.push(path);
            }
            await service().rpc('delivery_provider_submit_verification', {
                p_provider_id: provider.id,
                p_legal_name: byId('legalName').value.trim(),
                p_registered_business_name: byId('businessName')?.value.trim() || '',
                p_registration_number: byId('registrationNumber')?.value.trim() || '',
                p_identity_document_type: byId('identityDocumentType')?.value || '',
                p_document_paths: paths
            });
            await refreshProfiles(provider.id);
            setStatus('providerRegistrationStatus', 'Documents submitted privately for administrator review.', 'success');
        } catch (error) {
            reportError('providerRegistrationStatus', error, 'Verification could not be submitted. Confirm the files are valid and retry.');
        } finally {
            button.disabled = false;
        }
    }

    async function saveServiceArea(event) {
        event.preventDefault();
        const provider = state.dashboard?.provider;
        const point = state.selectedAreaPoint;
        if (provider?.country_code && byId('areaCountry').value !== provider.country_code) {
            setStatus(
                'providerRegistrationStatus',
                `Service areas must use this profile’s registered market (${provider.country_code === 'GB' ? 'United Kingdom' : 'Nigeria'}).`,
                'error'
            );
            return;
        }
        if (!provider?.id || !point) {
            setStatus('providerRegistrationStatus', 'Place a service-area pin on the map before saving.', 'error');
            return;
        }
        const button = event.currentTarget.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            const serviceTypes = Array.from(document.querySelectorAll('[name="areaServiceType"]:checked')).map((input) => input.value);
            await service().rpc('delivery_provider_save_service_area', {
                p_provider_id: provider.id,
                p_area_id: state.editingAreaId,
                p_country_code: byId('areaCountry').value,
                p_state_or_region: byId('areaRegion').value.trim(),
                p_city: byId('areaCity').value.trim(),
                p_latitude: point.latitude,
                p_longitude: point.longitude,
                p_coverage_radius_km: Number(byId('areaRadius').value),
                p_service_types: serviceTypes,
                p_base_fee: Number(byId('areaBaseFee').value),
                p_per_km_fee: Number(byId('areaPerKmFee').value),
                p_eta_min_minutes: Number(byId('areaEtaMin').value),
                p_eta_max_minutes: Number(byId('areaEtaMax').value),
                p_is_active: true
            });
            state.editingAreaId = null;
            await refreshProfiles(provider.id);
            setStatus('providerRegistrationStatus', 'Service area saved. It becomes matchable after provider approval.', 'success');
        } catch (error) {
            reportError('providerRegistrationStatus', error, 'Service area could not be saved. Check coverage, fees, and timing.');
        } finally {
            button.disabled = false;
        }
    }

    async function updateAvailability(event) {
        const providerId = byId('providerProfileSelect').value;
        const enabled = event.currentTarget.checked;
        try {
            await service().rpc('delivery_provider_set_availability', {
                p_provider_id: providerId,
                p_is_available: enabled,
                p_available_until: enabled ? new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString() : null
            });
            await refreshProfiles(providerId);
            setStatus('providerRegistrationStatus', enabled ? 'You are available for order deliveries for four hours.' : 'Delivery availability is off.', 'success');
        } catch (error) {
            event.currentTarget.checked = !enabled;
            reportError('providerRegistrationStatus', error, 'Availability could not be updated. Providers must be approved and have active coverage.');
        }
    }

    async function updateWorkforceInterest(event) {
        const providerId = byId('providerProfileSelect').value;
        try {
            await service().rpc('delivery_provider_set_workforce_interest', {
                p_provider_id: providerId,
                p_accepts_engagements: event.currentTarget.checked
            });
            await refreshProfiles(providerId);
            setStatus('providerRegistrationStatus', 'Rider work preference saved separately from delivery availability.', 'success');
        } catch (error) {
            event.currentTarget.checked = !event.currentTarget.checked;
            reportError('providerRegistrationStatus', error, 'Work preference could not be saved.');
        }
    }

    async function handleProviderDashboardClick(event) {
        const editArea = event.target.closest('[data-edit-area]');
        const area = event.target.closest('[data-delete-area]');
        const request = event.target.closest('[data-request-status]');
        const engagement = event.target.closest('[data-engagement-decision]');
        const providerId = byId('providerProfileSelect').value;
        try {
            if (editArea) {
                const current = state.dashboard?.service_areas?.find((item) => item.id === editArea.dataset.editArea);
                if (!current) throw new Error('That service area is no longer available. Refresh and try again.');
                state.editingAreaId = current.id;
                byId('areaCountry').value = current.country_code;
                byId('areaRegion').value = current.state_or_region;
                byId('areaCity').value = current.city;
                byId('areaRadius').value = current.coverage_radius_km;
                byId('areaBaseFee').value = current.base_fee;
                byId('areaPerKmFee').value = current.per_km_fee;
                byId('areaEtaMin').value = current.eta_min_minutes;
                byId('areaEtaMax').value = current.eta_max_minutes;
                document.querySelectorAll('[name="areaServiceType"]').forEach((input) => {
                    input.checked = current.service_types.includes(input.value);
                });
                state.selectedAreaPoint = {
                    latitude: Number(current.latitude),
                    longitude: Number(current.longitude)
                };
                state.areaMap?.setLocation(current.latitude, current.longitude);
                byId('serviceAreaFormTitle').textContent = 'Edit service area';
                byId('saveServiceAreaButton').textContent = 'Save area changes';
                byId('cancelAreaEdit').classList.remove('logistics-hidden');
                byId('serviceAreaForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
            } else if (area) {
                await service().rpc('delivery_provider_delete_service_area', {
                    p_provider_id: providerId,
                    p_area_id: area.dataset.deleteArea
                });
            } else if (request) {
                const note = ['rejected', 'issue_reported'].includes(request.dataset.requestStatus)
                    ? (window.prompt('Add a short note for this delivery update:') || '').trim()
                    : null;
                if (['rejected', 'issue_reported'].includes(request.dataset.requestStatus) && note.length < 3) return;
                await service().rpc('delivery_provider_update_request', {
                    p_provider_id: providerId,
                    p_request_id: request.dataset.requestId,
                    p_status: request.dataset.requestStatus,
                    p_note: note
                });
            } else if (engagement) {
                await service().rpc('delivery_provider_respond_to_engagement', {
                    p_engagement_id: engagement.dataset.engagementId,
                    p_decision: engagement.dataset.engagementDecision
                });
            } else return;
            await loadDashboard(providerId);
            setStatus('providerRegistrationStatus', 'Your logistics update was saved.', 'success');
        } catch (error) {
            reportError('providerRegistrationStatus', error, 'The update could not be saved. Refresh and try again.');
        }
    }

    function cancelAreaEdit() {
        state.editingAreaId = null;
        state.selectedAreaPoint = null;
        byId('serviceAreaForm')?.reset();
        byId('serviceAreaFormTitle').textContent = 'Add service area';
        byId('saveServiceAreaButton').textContent = 'Save service area';
        byId('cancelAreaEdit').classList.add('logistics-hidden');
        state.areaMap?.clearLocation(byId('areaCountry').value);
    }

    async function loadSellerShops() {
        const { data, error } = await state.supabase.from('shops')
            .select('id,name,status,verified')
            .order('name', { ascending: true })
            .limit(20);
        if (error) throw error;
        state.shops = data || [];
        const select = byId('hiringShopSelect');
        const preferredId = select.value;
        select.innerHTML = state.shops.map((shop) => `<option value="${escapeHtml(shop.id)}">${escapeHtml(shop.name)}</option>`).join('');
        if (state.shops.some((shop) => shop.id === preferredId)) select.value = preferredId;
        byId('sellerHiringCard').hidden = state.shops.length === 0;
        if (state.shops.length) {
            await loadRiderMatches();
            await loadSellerDeliveryProviderMatches();
        }
    }

    async function loadBuyerDeliveryRequests() {
        const host = byId('buyerDeliveryRequests');
        if (!state.authUser) {
            host.innerHTML = '<p>Sign in to view delivery requests linked to your orders.</p>';
            return;
        }
        host.innerHTML = '<p>Loading delivery updates…</p>';
        try {
            const requests = await service().rpc('buyer_list_my_delivery_requests', { p_limit: 50 });
            host.innerHTML = requests.length ? requests.map((request) => `
                <article class="logistics-result">
                    <header><strong>Order ${escapeHtml(request.order_number || request.order_id)}</strong><span class="logistics-badge">${escapeHtml(request.status)}</span></header>
                    <p>${escapeHtml(request.provider_name)} · ${escapeHtml(request.provider_type === 'independent_rider' ? 'Independent rider' : 'Logistics company')}</p>
                    <p>${escapeHtml([request.destination_city, request.destination_region].filter(Boolean).join(', ') || 'Delivery address')} · ${service().formatFee(request.total_fee_amount, request.currency_code)} · ${escapeHtml(request.eta_min_minutes)}–${escapeHtml(request.eta_max_minutes)} minutes</p>
                    ${request.response_note ? `<p>${escapeHtml(request.response_note)}</p>` : ''}
                    <details><summary>Delivery updates</summary><ol>${(request.events || []).map((item) => `<li><strong>${escapeHtml(item.status)}</strong> · ${escapeHtml(new Date(item.created_at).toLocaleString())}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</li>`).join('')}</ol></details>
                    <form data-report-delivery="${escapeHtml(request.request_id)}" data-provider-id="${escapeHtml(request.provider_id)}">
                        <div class="logistics-form-grid">
                            <div class="logistics-field"><label>Report reason</label><select name="reason" required><option value="safety">Safety</option><option value="late_delivery">Late delivery</option><option value="misconduct">Misconduct</option><option value="fraud">Fraud</option><option value="other">Other</option></select></div>
                            <div class="logistics-field logistics-field--wide"><label>Details</label><textarea name="details" minlength="10" maxlength="2000" required placeholder="Describe the delivery issue."></textarea></div>
                        </div>
                        <div class="logistics-actions"><button class="logistics-button logistics-button--secondary" type="submit">Report this delivery</button></div>
                    </form>
                </article>`).join('') : '<p>No delivery requests are linked to your orders yet.</p>';
            setStatus('buyerDeliveryStatus', requests.length ? `${requests.length} delivery request${requests.length === 1 ? '' : 's'} loaded.` : '');
        } catch (error) {
            reportError('buyerDeliveryStatus', error, 'Delivery status could not be loaded. Refresh and try again.');
            host.innerHTML = '<p>Delivery updates are temporarily unavailable.</p>';
        }
    }

    async function loadShopDeliveryTracking(shopId) {
        const host = byId('shopDeliveryRequests');
        if (!shopId) return;
        host.innerHTML = '<p>Loading order-delivery status…</p>';
        try {
            const requests = await service().rpc('shop_owner_list_delivery_requests', {
                p_shop_id: shopId,
                p_limit: 50
            });
            host.innerHTML = requests.length ? requests.map((request) => `
                <article class="logistics-result">
                    <header><strong>Order ${escapeHtml(request.order_number || request.order_id)}</strong><span class="logistics-badge">${escapeHtml(request.status)}</span></header>
                    <p>${escapeHtml(request.provider_name)} · ${escapeHtml(request.provider_type === 'independent_rider' ? 'Independent rider' : 'Logistics company')}</p>
                    <p>${escapeHtml([request.destination_city, request.destination_region].filter(Boolean).join(', ') || 'Delivery address')} · ${service().formatFee(request.total_fee_amount, request.currency_code)} · ${escapeHtml(request.eta_min_minutes)}–${escapeHtml(request.eta_max_minutes)} minutes</p>
                    <details><summary>Delivery updates</summary><ol>${(request.events || []).map((item) => `<li><strong>${escapeHtml(item.status)}</strong> · ${escapeHtml(new Date(item.created_at).toLocaleString())}${item.note ? ` — ${escapeHtml(item.note)}` : ''}</li>`).join('')}</ol></details>
                </article>`).join('') : '<p>No provider delivery requests for this shop yet.</p>';
        } catch (error) {
            window.AsyncFeedback?.log('seller-delivery-tracking', window.AsyncFeedback?.createRequestId('seller-delivery-tracking'), error);
            host.innerHTML = '<p>Order-delivery tracking is temporarily unavailable. Confirm the location and logistics migrations are installed.</p>';
        }
    }

    async function loadSellerDeliveryProviderMatches() {
        const shopId = byId('hiringShopSelect').value;
        const host = byId('sellerDeliveryProviderMatches');
        if (!shopId || !host) return;
        host.innerHTML = '<p>Checking provider approval, current availability, and coverage for your shop…</p>';
        try {
            const providers = await service().rpc('shop_owner_find_available_delivery_providers', {
                p_shop_id: shopId,
                p_limit: 30
            });
            host.innerHTML = providers.length ? providers.map((provider) => {
                const availableUntil = new Date(provider.available_until);
                const availabilityText = Number.isNaN(availableUntil.getTime())
                    ? 'Available now'
                    : `Available until ${availableUntil.toLocaleString()}`;
                const sampleFee = service().formatFee(provider.total_fee_amount, provider.currency_code);
                const serviceTypes = Array.isArray(provider.service_types) ? provider.service_types.join(', ') : 'Standard';
                return `<article class="logistics-result">
                    <header><strong>${escapeHtml(provider.display_name)}</strong><span class="logistics-badge">${provider.provider_type === 'independent_rider' ? 'Independent rider' : 'Logistics company'}</span></header>
                    <p>${escapeHtml(provider.vehicle_type)} · ${escapeHtml(provider.service_city)}, ${escapeHtml(provider.service_region)} · ${escapeHtml(provider.distance_to_shop_km)} km from your shop</p>
                    <p>${escapeHtml(serviceTypes)} · ${escapeHtml(provider.coverage_radius_km)} km service radius · ${escapeHtml(provider.eta_min_minutes)}–${escapeHtml(provider.eta_max_minutes)} minutes</p>
                    <p><strong>Sample fee to shop area: ${escapeHtml(sampleFee)}</strong> · ${escapeHtml(availabilityText)}</p>
                    <p class="logistics-help">${escapeHtml(provider.description || 'Verified delivery provider.')}</p>
                </article>`;
            }).join('') : '<p>No approved provider is currently available for your approved shop location. You can still arrange delivery with customers through your existing workflow.</p>';
        } catch (error) {
            reportError('sellerHiringStatus', error, 'Delivery providers could not be matched to this shop. Confirm its physical location has been approved.');
            host.replaceChildren();
        }
    }

    async function loadRiderMatches() {
        const shopId = byId('hiringShopSelect').value;
        if (!shopId) return;
        const container = byId('riderMatches');
        container.innerHTML = '<p>Looking for verified riders in your approved shop area…</p>';
        try {
            const matches = await service().rpc('get_available_riders_for_workforce', {
                p_shop_id: shopId,
                p_limit: 30
            });
            container.innerHTML = matches.length ? matches.map((rider) => `
                <article class="logistics-result">
                    <header><strong>${escapeHtml(rider.display_name)}</strong><span class="logistics-badge">Verified independent rider</span></header>
                    <p>${escapeHtml(rider.service_city)}, ${escapeHtml(rider.service_region)} · ${escapeHtml(rider.distance_to_shop_km)} km from your shop · ${escapeHtml(rider.vehicle_type)}</p>
                    <p>${escapeHtml(rider.description || 'No additional service details.')}</p>
                    <form data-invite-rider="${escapeHtml(rider.provider_id)}">
                        <div class="logistics-form-grid">
                            <div class="logistics-field"><label>Arrangement</label><select name="type"><option value="temporary">Temporary</option><option value="permanent">Permanent</option></select></div>
                            <div class="logistics-field"><label>Start date</label><input name="start" type="date" required></div>
                            <div class="logistics-field"><label>End date (temporary only)</label><input name="end" type="date"></div>
                            <div class="logistics-field logistics-field--wide"><label>Engagement terms</label><textarea name="summary" maxlength="1000" required placeholder="Describe schedule, pay arrangement, and delivery duties"></textarea></div>
                        </div>
                        <div class="logistics-actions"><button class="logistics-button" type="submit">Send invitation</button></div>
                    </form>
                </article>`).join('') : '<p>No verified riders who accept work currently cover this approved shop location.</p>';
            const engagements = await service().rpc('shop_owner_list_rider_engagements', { p_shop_id: shopId });
            byId('shopEngagements').innerHTML = `<h3>Existing work arrangements</h3>${engagements.length ? engagements.map((item) => `
                <article class="logistics-result"><header><strong>${escapeHtml(item.rider_name)} · ${escapeHtml(item.engagement_type)}</strong><span class="logistics-badge">${escapeHtml(item.status)}</span></header>
                <p>${escapeHtml(item.start_date)}${item.end_date ? ` to ${escapeHtml(item.end_date)}` : ''} · ${escapeHtml(item.terms?.summary || '')}</p>
                ${['invited','accepted'].includes(item.status) ? `<button class="logistics-button logistics-button--danger" type="button" data-shop-engagement="${escapeHtml(item.id)}" data-action="${item.status === 'accepted' ? 'end' : 'cancel'}">${item.status === 'accepted' ? 'End arrangement' : 'Cancel invitation'}</button>` : ''}</article>`).join('') : '<p>No rider work arrangements yet.</p>'}`;
            await loadShopDeliveryTracking(shopId);
        } catch (error) {
            reportError('sellerHiringStatus', error, 'Rider matching is unavailable. Confirm the shop has an approved physical location.');
            container.replaceChildren();
        }
    }

    async function handleSellerHiring(event) {
        const form = event.target.closest('[data-invite-rider]');
        const update = event.target.closest('[data-shop-engagement]');
        const shopId = byId('hiringShopSelect').value;
        try {
            if (form) {
                event.preventDefault();
                const data = new FormData(form);
                const type = String(data.get('type'));
                const start = String(data.get('start'));
                const end = String(data.get('end') || '');
                if (type === 'temporary' && !end) throw new Error('Temporary arrangements need an end date.');
                if (type === 'permanent' && end) throw new Error('Permanent arrangements do not have an end date.');
                await service().rpc('shop_owner_invite_rider', {
                    p_shop_id: shopId,
                    p_provider_id: form.dataset.inviteRider,
                    p_engagement_type: type,
                    p_terms: { summary: String(data.get('summary') || '').trim() },
                    p_start_date: start,
                    p_end_date: end || null
                });
            } else if (update) {
                await service().rpc('shop_owner_update_rider_engagement', {
                    p_engagement_id: update.dataset.shopEngagement,
                    p_action: update.dataset.action
                });
            } else return;
            await loadRiderMatches();
            setStatus('sellerHiringStatus', 'Rider arrangement updated. Order delivery records are unchanged.', 'success');
        } catch (error) {
            reportError('sellerHiringStatus', error, error.message || 'The rider arrangement could not be saved.');
        }
    }

    async function handleBuyerReport(event) {
        const form = event.target.closest('[data-report-delivery]');
        if (!form) return;
        event.preventDefault();
        const data = new FormData(form);
        const details = String(data.get('details') || '').trim();
        if (details.length < 10) {
            setStatus('buyerDeliveryStatus', 'Describe the issue in at least 10 characters.', 'error');
            return;
        }
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await service().rpc('delivery_provider_report', {
                p_provider_id: form.dataset.providerId,
                p_request_id: form.dataset.reportDelivery,
                p_reason: String(data.get('reason')),
                p_details: details
            });
            setStatus('buyerDeliveryStatus', 'Your delivery report was sent to the VelveraHub admin team.', 'success');
            form.replaceWith(document.createTextNode('Report submitted for administrator review.'));
        } catch (error) {
            reportError('buyerDeliveryStatus', error, 'Your report could not be submitted. Please try again.');
            button.disabled = false;
        }
    }

    async function initialize() {
        if (window.supabaseConfigReady) await window.supabaseConfigReady;
        state.supabase = service().client();
        if (!state.supabase) {
            setStatus('logisticsAuthStatus', 'Live account services are unavailable. Try again later.', 'error');
            return;
        }
        if (window.AuthService) await window.AuthService.init();
        const { data: { user } } = await state.supabase.auth.getUser();
        state.authUser = user;
        byId('providerCountry').value = service().marketCountry();
        syncProviderRegistrationFields();
        byId('providerType').addEventListener('change', syncProviderRegistrationFields);
        byId('providerRegistrationForm').addEventListener('submit', registerProvider);
        byId('providerProfileSelect').addEventListener('change', (event) => loadDashboard(event.target.value).catch((error) =>
            reportError('providerRegistrationStatus', error, 'Provider profile could not be loaded.')
        ));
        byId('refreshRiderMatches').addEventListener('click', loadRiderMatches);
        byId('refreshSellerDeliveryProviders').addEventListener('click', loadSellerDeliveryProviderMatches);
        byId('hiringShopSelect').addEventListener('change', () => {
            loadRiderMatches();
            loadSellerDeliveryProviderMatches();
        });
        byId('sellerHiringCard').addEventListener('submit', handleSellerHiring);
        byId('sellerHiringCard').addEventListener('click', handleSellerHiring);
        byId('buyerDeliveryRequests').addEventListener('submit', handleBuyerReport);
        byId('refreshBuyerDeliveries').addEventListener('click', loadBuyerDeliveryRequests);
        if (!user) {
            setStatus('logisticsAuthStatus', 'Sign in or create a VelveraHub account to register as a provider or manage a shop.');
            byId('providerRegistrationForm').querySelectorAll('input,select,textarea,button').forEach((element) => element.disabled = true);
            return;
        }
        setStatus('logisticsAuthStatus', `Signed in as ${user.email || 'your VelveraHub account'}.`);
        try {
            await refreshProfiles();
            await loadSellerShops();
            await loadBuyerDeliveryRequests();
        } catch (error) {
            reportError('logisticsAuthStatus', error, 'Your logistics workspace could not load. Refresh and try again.');
        }
    }

    document.addEventListener('DOMContentLoaded', () => initialize().catch((error) =>
        reportError('logisticsAuthStatus', error, 'Location and logistics services could not start.')
    ));
})();

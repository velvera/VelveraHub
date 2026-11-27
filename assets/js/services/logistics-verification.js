(function () {
    const MAX_FILE_BYTES = 5 * 1024 * 1024;
    const DOCUMENT_TYPES = Object.freeze({
        NG: new Set(['national_id', 'passport', 'drivers_license', 'voters_card']),
        GB: new Set(['passport', 'drivers_license', 'residence_permit', 'other'])
    });
    const ALLOWED_MIME_TYPES = new Set(['application/pdf', 'image/jpeg', 'image/png']);

    function checkedFile(file, label, imageOnly = false) {
        if (!file) return `${label} is required.`;
        if (file.size < 8 || file.size > MAX_FILE_BYTES) {
            return `${label} must be no larger than 5 MiB.`;
        }
        if (!ALLOWED_MIME_TYPES.has(String(file.type || '').toLowerCase())) {
            return `${label} must be a PDF, JPEG, or PNG file.`;
        }
        if (imageOnly && !['image/jpeg', 'image/png'].includes(String(file.type || '').toLowerCase())) {
            return `${label} must be a JPEG or PNG image.`;
        }
        return '';
    }

    function buildDocumentManifest(input = {}) {
        const providerType = String(input.providerType || '');
        const countryCode = String(input.countryCode || '').toUpperCase();
        const identityDocumentType = String(input.identityDocumentType || '');
        const businessName = String(input.businessName || '').trim();
        const registrationNumber = String(input.registrationNumber || '').trim();
        const identityFile = input.identityFile || null;
        const selfieFile = input.selfieFile || null;
        const driversLicenseFile = input.driversLicenseFile || null;
        const businessFiles = Array.from(input.businessFiles || []);
        const supportingFiles = Array.from(input.supportingFiles || []);

        if (!['logistics_company', 'independent_rider'].includes(providerType)) {
            return { error: 'Choose a valid logistics provider type.', documents: [] };
        }
        if (!DOCUMENT_TYPES[countryCode]?.has(identityDocumentType)) {
            return { error: 'Choose an identity document accepted for your country.', documents: [] };
        }
        if (providerType === 'independent_rider' && countryCode === 'NG'
            && identityDocumentType !== 'national_id') {
            return { error: 'Nigerian dispatch riders must provide a National ID/NIN document.', documents: [] };
        }
        const identityError = checkedFile(identityFile, 'Identity document');
        if (identityError) return { error: identityError, documents: [] };

        if (providerType === 'logistics_company') {
            if (businessName.length < 2 || registrationNumber.length < 2) {
                return { error: 'Enter the registered business name and registration number.', documents: [] };
            }
            if (businessFiles.length < 1 || businessFiles.length > 5) {
                return { error: 'Add 1–5 business registration or supporting files.', documents: [] };
            }
        } else {
            const selfieError = checkedFile(selfieFile, 'Representative selfie', true);
            if (selfieError) return { error: selfieError, documents: [] };
            if (businessFiles.length) {
                return { error: 'Business registration files are not required for independent riders.', documents: [] };
            }
        }

        if (supportingFiles.length > 2) {
            return { error: 'Add no more than two additional supporting files.', documents: [] };
        }

        const files = [
            { document_kind: 'representative_identity', file: identityFile },
            ...businessFiles.map((file) => ({ document_kind: 'business_registration', file })),
            ...(selfieFile ? [{ document_kind: 'representative_selfie', file: selfieFile }] : []),
            ...(driversLicenseFile ? [{ document_kind: 'drivers_license', file: driversLicenseFile }] : []),
            ...supportingFiles.map((file) => ({ document_kind: 'supporting', file }))
        ];
        if (files.length > 8) {
            return { error: 'Upload no more than eight files in one submission.', documents: [] };
        }

        for (const document of files) {
            const error = checkedFile(
                document.file,
                document.document_kind === 'representative_selfie'
                    ? 'Representative selfie'
                    : document.document_kind === 'representative_identity'
                        ? 'Identity document'
                        : 'Verification document',
                document.document_kind === 'representative_selfie'
            );
            if (error) return { error, documents: [] };
        }

        return {
            error: '',
            identityDocumentType,
            businessName: providerType === 'logistics_company' ? businessName : '',
            registrationNumber: providerType === 'logistics_company' ? registrationNumber : '',
            documents: files
        };
    }

    window.LogisticsVerification = Object.freeze({ buildDocumentManifest });
})();

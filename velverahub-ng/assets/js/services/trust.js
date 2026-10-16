const TrustService = {
    weights: {
        identity: 25,
        ratings: 25,
        sales: 20,
        coverage: 15,
        returns: 7,
        response: 4,
        disputes: 4
    },

    clamp(value, min = 0, max = 1) {
        return Math.min(max, Math.max(min, value));
    },

    asRate(value) {
        const number = Number(value);
        if (!Number.isFinite(number)) return null;
        return this.clamp(number > 1 ? number / 100 : number);
    },

    escape(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    },

    calculate(shop = {}) {
        const signals = [];
        const addSignal = (key, label, available, value, detail, icon) => {
            const weight = this.weights[key];
            signals.push({
                key,
                label,
                available,
                value: available ? this.clamp(value) : null,
                detail,
                icon,
                weight
            });
        };

        const identityVerified = shop.identity_verified ?? shop.verified;
        addSignal(
            'identity',
            'Verified identity',
            identityVerified === true,
            identityVerified === true ? 1 : null,
            identityVerified === true ? 'Marketplace verification completed' : 'Verification has not been completed',
            'fa-user-check'
        );

        const rating = Number(shop.rating);
        const reviewsAvailable = Number.isFinite(rating) && rating > 0;
        const reviewsCount = Number(shop.reviews_count ?? shop.review_count ?? 0);
        addSignal(
            'ratings',
            'Ratings',
            reviewsAvailable,
            reviewsAvailable ? rating / 5 : null,
            reviewsAvailable
                ? `${rating.toFixed(1)} / 5 from ${reviewsCount.toLocaleString()} review${reviewsCount === 1 ? '' : 's'}`
                : 'Customer rating is not measured yet',
            'fa-star'
        );

        const totalSales = Number(shop.total_sales);
        addSignal(
            'sales',
            'Sales history',
            Number.isFinite(totalSales),
            Number.isFinite(totalSales) ? (totalSales > 0 ? 1 : 0) : null,
            Number.isFinite(totalSales)
                ? `${totalSales.toLocaleString()} completed sale${totalSales === 1 ? '' : 's'} recorded`
                : 'Sales history is not measured yet',
            'fa-bag-shopping'
        );

        const coverageAreas = Array.isArray(shop.coverage_areas) ? shop.coverage_areas.filter(Boolean) : null;
        addSignal(
            'coverage',
            'Delivery coverage',
            coverageAreas !== null,
            coverageAreas !== null ? (coverageAreas.length > 0 ? 1 : 0) : null,
            coverageAreas !== null
                ? coverageAreas.length > 0
                    ? `${coverageAreas.length} delivery area${coverageAreas.length === 1 ? '' : 's'} listed`
                    : 'No delivery areas listed'
                : 'Delivery coverage is not measured yet',
            'fa-location-dot'
        );

        const returnRate = this.asRate(shop.return_rate ?? shop.returns_rate);
        addSignal(
            'returns',
            'Return experience',
            returnRate !== null,
            returnRate === null ? null : 1 - returnRate,
            returnRate === null ? 'Return rate is not measured yet' : `${Math.round(returnRate * 100)}% return rate`,
            'fa-rotate-left'
        );

        const responseHours = Number(shop.response_time_hours ?? shop.average_response_hours);
        const responseAvailable = Number.isFinite(responseHours) && responseHours >= 0;
        addSignal(
            'response',
            'Response time',
            responseAvailable,
            responseAvailable ? 1 - this.clamp(responseHours / 48) : null,
            responseAvailable ? `Usually replies within ${responseHours} hours` : 'Response time is not measured yet',
            'fa-comments'
        );

        const disputeRate = this.asRate(shop.dispute_rate ?? shop.disputes_rate);
        addSignal(
            'disputes',
            'Dispute outcomes',
            disputeRate !== null,
            disputeRate === null ? null : 1 - disputeRate,
            disputeRate === null ? 'Dispute outcomes are not measured yet' : `${Math.round(disputeRate * 100)}% dispute rate`,
            'fa-shield-halved'
        );

        const availableSignals = signals.filter((signal) => signal.available);
        const availableWeight = availableSignals.reduce((sum, signal) => sum + signal.weight, 0);
        const earnedWeight = availableSignals.reduce((sum, signal) => sum + signal.value * signal.weight, 0);
        const confidenceLevel = availableSignals.length >= 6
            ? 'High confidence'
            : availableSignals.length >= 4
                ? 'Moderate confidence'
                : availableSignals.length >= 2
                    ? 'Low confidence'
                    : 'Very low confidence';

        return {
            score: availableWeight ? Math.round((earnedWeight / availableWeight) * 100) : null,
            signals,
            availableCount: availableSignals.length,
            totalCount: signals.length,
            confidence: confidenceLevel,
            confidenceLevel
        };
    },

    renderBadge(shop, { compact = false } = {}) {
        const trust = this.calculate(shop);
        const score = trust.score === null ? '—' : trust.score;
        const label = trust.score === null ? 'Collecting data' : 'Buyer protection';
        const note = trust.score === null
            ? 'No trust signals measured yet'
            : `${trust.confidence} · ${trust.availableCount}/${trust.totalCount} signals`;

        return `
            <div class="trust-score-badge${compact ? ' trust-score-badge--compact' : ''}" title="Based on the evidence shown below">
                <span class="trust-score-value">${score}</span>
                <span class="trust-score-copy">
                    <strong>${label}</strong>
                    <small>${this.escape(note)}</small>
                </span>
            </div>
        `;
    },

    renderEvidencePanel(shop) {
        const trust = this.calculate(shop);
        return `
            <section class="trust-panel" aria-labelledby="trustPanelTitle">
                <div class="trust-panel-header">
                    <div>
                        <span class="trust-eyebrow"><i class="fas fa-shield-halved"></i> Transparent seller signal</span>
                        <h2 id="trustPanelTitle">Buyer protection score</h2>
                    </div>
                    ${this.renderBadge(shop)}
                </div>
                <p class="trust-panel-intro">A normalized 0–100 score based only on measured marketplace evidence. Missing signals are shown instead of estimated.</p>
                <div class="trust-evidence-list">
                    ${trust.signals.map((signal) => `
                        <div class="trust-evidence-row${signal.available ? '' : ' is-unavailable'}">
                            <span class="trust-evidence-icon"><i class="fas ${signal.icon}"></i></span>
                            <span class="trust-evidence-copy">
                                <strong>${signal.label}</strong>
                                <small>${this.escape(signal.detail)}</small>
                            </span>
                            <span class="trust-evidence-score">${signal.available ? `${Math.round(signal.value * 100)}/100` : '—'}</span>
                            <span class="trust-evidence-status">${signal.available ? 'Measured' : 'Not measured'}</span>
                        </div>
                    `).join('')}
                </div>
            </section>
        `;
    }
};

window.TrustService = TrustService;
/**
 * Shared governance navigation bar
 * Used by all governance route pages.
 */

const NAV_LINKS = [
    { path: '/governance', label: 'Overview' },
    { path: '/governance/proposals', label: 'Proposals' },
    { path: '/governance/apply', label: 'Apply' },
    { path: '/governance/member', label: 'Member' },
    { path: '/governance/treasury', label: 'Treasury' },
    { path: '/governance/shares', label: 'Shares' },
];

export function renderGovernanceNav(activePath) {
    return `
        <nav class="governance-nav">
            <a href="/" class="governance-nav-home">&larr; ms2.fun</a>
            <div class="governance-nav-links">
                ${NAV_LINKS.map(l => `
                    <a href="${l.path}" class="governance-nav-link ${activePath === l.path ? 'active' : ''}">${l.label}</a>
                `).join('')}
            </div>
        </nav>
    `;
}

import stylesheetLoader from '../utils/stylesheetLoader.js';

/**
 * Documentation/About page route handler (v2)
 *
 * Fetches the demo HTML and injects it directly, then attaches
 * event delegation for tab-style section switching.
 * Pure DOM, no microact component.
 */
export async function renderDocumentation(appContainer) {
    await stylesheetLoader.load('/src/core/route-documentation-v2.css', 'route:documentation');

    // Fetch the demo HTML and extract just the .content div
    let contentHTML = '';
    try {
        const res = await fetch('/docs/examples/documentation-demo.html');
        const html = await res.text();
        // Extract everything between <!-- Content --> and the footer/script
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const contentEl = doc.querySelector('.content');
        if (contentEl) {
            // Strip inline onclick attributes — we use event delegation
            contentEl.querySelectorAll('[onclick]').forEach(el => el.removeAttribute('onclick'));
            contentHTML = contentEl.outerHTML;
        }
    } catch (err) {
        console.error('[Documentation] Failed to load demo HTML:', err);
        contentHTML = '<div class="content"><h1>Documentation</h1><p>Failed to load documentation content.</p></div>';
    }

    appContainer.innerHTML = contentHTML;

    // ── Inject mobile nav (toggle + panel) before the .docs-layout ──
    const docsLayout = appContainer.querySelector('.docs-layout');
    const sidebar = appContainer.querySelector('.docs-sidebar');
    if (docsLayout && sidebar) {
        // Build mobile nav panel by cloning sidebar content
        const mobileNav = document.createElement('div');
        mobileNav.className = 'docs-mobile-nav';
        mobileNav.innerHTML = sidebar.innerHTML;

        const toggle = document.createElement('button');
        toggle.className = 'docs-mobile-toggle';
        toggle.innerHTML = '<span class="hamburger-icon"></span> Navigate Docs';

        docsLayout.parentNode.insertBefore(toggle, docsLayout);
        docsLayout.parentNode.insertBefore(mobileNav, docsLayout);
    }

    // ── Event delegation for section switching ──
    function showSection(sectionId) {
        const sections = appContainer.querySelectorAll('.docs-section');
        sections.forEach(s => s.classList.toggle('active', s.id === sectionId));

        // Update all nav links (desktop sidebar + mobile panel)
        const links = appContainer.querySelectorAll('.docs-nav-link');
        links.forEach(l => {
            const href = l.getAttribute('href');
            l.classList.toggle('active', href === `#${sectionId}`);
        });

        // Close mobile nav on selection
        const mobilePanel = appContainer.querySelector('.docs-mobile-nav');
        if (mobilePanel) mobilePanel.classList.remove('is-open');

        window.scrollTo(0, 0);
    }

    appContainer.addEventListener('click', (e) => {
        // Mobile nav toggle
        const toggleBtn = e.target.closest('.docs-mobile-toggle');
        if (toggleBtn) {
            const panel = appContainer.querySelector('.docs-mobile-nav');
            if (panel) panel.classList.toggle('is-open');
            return;
        }

        // Sidebar + mobile nav links
        const navLink = e.target.closest('.docs-nav-link');
        if (navLink) {
            e.preventDefault();
            const href = navLink.getAttribute('href');
            if (href && href.startsWith('#')) {
                showSection(href.slice(1));
            }
            return;
        }

        // Article cards
        const card = e.target.closest('.article-card');
        if (card && card.dataset.section) {
            showSection(card.dataset.section);
            return;
        }
    });

    // Re-tag article cards with data-section from the demo's structure
    const ARTICLE_CARD_MAP = [
        { text: 'For Collectors', section: 'for-collectors' },
        { text: 'For Creators', section: 'for-creators' },
        { text: 'For Developers', section: 'contract-architecture' },
        { text: 'For DAO Members', section: 'dao-overview' },
    ];
    appContainer.querySelectorAll('.article-card').forEach(card => {
        const title = card.querySelector('.article-title')?.textContent?.trim();
        const mapping = ARTICLE_CARD_MAP.find(m => m.text === title);
        if (mapping) card.dataset.section = mapping.section;
    });

    // Handle initial hash
    const hash = window.location.hash?.slice(1);
    if (hash) showSection(hash);

    return {
        cleanup: () => {
            document.body.classList.remove('v2-route', 'hide-wallet');
            stylesheetLoader.unload('route:documentation');
            document.body.classList.add('marble-bg');
            appContainer.innerHTML = '';
        }
    };
}

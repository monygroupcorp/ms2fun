/**
 * StyleBuilder - Shared style builder component
 *
 * Reusable UI for building/applying style URIs to on-chain contracts.
 * Produces a data:application/json URI containing CSS overrides only.
 * Presentation fields (project_photo, project_banner, description) are
 * managed separately via metadataURI in MasterRegistry.
 *
 * Used by ERC1155AdminPanel, SetEditionStyleModal, and ERC404AdminModal.
 *
 * Props:
 *   onSetStyle(uri)      - Required. Called with data URI or raw URL. Returns Promise.
 *   onGetStyle()         - Optional. Loads current style on mount. Returns Promise<string>.
 *   onClearStyle()       - Optional. If provided, shows "Clear Style" button. Returns Promise.
 *   prefix               - Optional string (default ''). Prepends to data-* attrs to avoid conflicts.
 *   inputClass           - Optional CSS class for text inputs (default 'form-input').
 */

import { Component, h } from '../../core/microact-setup.js';

export const STYLE_TOKENS = [
    { key: '--bg-primary', label: 'Background', type: 'color', default: '#ffffff' },
    { key: '--bg-secondary', label: 'Surface', type: 'color', default: '#fafafa' },
    { key: '--bg-tertiary', label: 'Surface Alt', type: 'color', default: '#f5f5f5' },
    { key: '--text-primary', label: 'Text', type: 'color', default: '#000000' },
    { key: '--text-secondary', label: 'Text Muted', type: 'color', default: '#666666' },
    { key: '--text-tertiary', label: 'Text Faint', type: 'color', default: '#999999' },
    { key: '--border-primary', label: 'Border', type: 'color', default: '#000000' },
    { key: '--border-secondary', label: 'Border Light', type: 'color', default: '#e0e0e0' },
    { key: '--state-hover-bg', label: 'Hover', type: 'color', default: '#f5f5f5' },
    { key: '--font-primary', label: 'Font', type: 'text', default: '' },
];

export class StyleBuilder extends Component {
    get prefix() { return this.props.prefix || ''; }
    get inputClass() { return this.props.inputClass || 'form-input'; }

    // Data attribute selectors with prefix
    _sel(base, val) {
        return `[data-${this.prefix}${base}="${val}"]`;
    }
    _selBare(base) {
        return `[data-${this.prefix}${base}]`;
    }

    async didMount() {
        this._loadCurrentStyle();
    }

    shouldUpdate() {
        return false;
    }

    // ── Style Builder Logic ──

    _parseDataUri(uri) {
        if (!uri) return null;
        try {
            if (uri.startsWith('data:application/json,')) {
                return JSON.parse(decodeURIComponent(uri.replace('data:application/json,', '')));
            }
            if (uri.startsWith('data:application/json;base64,')) {
                return JSON.parse(atob(uri.replace('data:application/json;base64,', '')));
            }
        } catch (e) { /* ignore */ }
        return null;
    }

    async _loadCurrentStyle() {
        if (!this.props.onGetStyle) return;
        try {
            const currentUri = await this.props.onGetStyle();
            if (!currentUri || !this._el) return;

            const display = this._el.querySelector(this._selBare('current-style'));
            if (display) {
                display.textContent = currentUri.length > 60
                    ? currentUri.slice(0, 60) + '...'
                    : currentUri;
                display.title = currentUri;
            }

        } catch (e) { /* ignore */ }
    }

    _switchMode(mode) {
        if (!this._el) return;
        const urlTab = this._el.querySelector(this._sel('style-tab', 'url'));
        const builderTab = this._el.querySelector(this._sel('style-tab', 'builder'));
        const urlPanel = this._el.querySelector(this._sel('style-panel', 'url'));
        const builderPanel = this._el.querySelector(this._sel('style-panel', 'builder'));

        if (mode === 'url') {
            urlTab?.classList.add('active');
            builderTab?.classList.remove('active');
            if (urlPanel) urlPanel.style.display = '';
            if (builderPanel) builderPanel.style.display = 'none';
        } else {
            builderTab?.classList.add('active');
            urlTab?.classList.remove('active');
            if (builderPanel) builderPanel.style.display = '';
            if (urlPanel) urlPanel.style.display = 'none';
        }
    }

    _generateCSS() {
        if (!this._el) return '';
        const p = this.prefix;
        const parts = [];

        // Font import
        const fontUrl = this._el.querySelector(`[data-${p}ext="font-url"]`)?.value?.trim();
        if (fontUrl) {
            parts.push(`@import url('${fontUrl}');`);
        }

        // Token overrides
        const overrides = [];
        for (const token of STYLE_TOKENS) {
            let val;
            if (token.type === 'color') {
                const textInput = this._el.querySelector(`[data-${p}token-text="${token.key}"]`);
                const colorInput = this._el.querySelector(`[data-${p}token="${token.key}"]`);
                val = textInput?.value?.trim() || colorInput?.value?.trim();
            } else {
                const input = this._el.querySelector(`[data-${p}token="${token.key}"]`);
                val = input?.value?.trim();
            }
            if (val && val !== token.default) {
                overrides.push(`  ${token.key}: ${val};`);
            }
        }

        // Font family from import
        const fontFamily = this._el.querySelector(`[data-${p}ext="font-family"]`)?.value?.trim();
        if (fontFamily) {
            overrides.push(`  --font-primary: ${fontFamily};`);
        }

        if (overrides.length > 0) {
            parts.push(`:root {\n${overrides.join('\n')}\n}`);
        }

        // Background image
        const bgImage = this._el.querySelector(`[data-${p}ext="bg-image"]`)?.value?.trim();
        if (bgImage) {
            const bgOverlay = this._el.querySelector(`[data-${p}ext="bg-overlay"]`)?.value?.trim() || '';
            const bgRules = [
                `  background-image: url('${bgImage}');`,
                '  background-size: cover;',
                '  background-position: center;',
                '  background-attachment: fixed;',
                '  background-repeat: no-repeat;'
            ];
            if (bgOverlay) {
                bgRules[0] = `  background-image: linear-gradient(${bgOverlay}, ${bgOverlay}), url('${bgImage}');`;
            }
            parts.push(`body {\n${bgRules.join('\n')}\n}`);
        }

        // Custom CSS
        const customCSS = this._el.querySelector(`[data-${p}ext="custom-css"]`)?.value?.trim();
        if (customCSS) {
            parts.push(customCSS);
        }

        return parts.join('\n\n');
    }

    _updatePreview() {
        if (!this._el) return;
        const p = this.prefix;
        const css = this._generateCSS();
        const preview = this._el.querySelector(`[data-${p}style-preview]`);
        const submitBtn = this._el.querySelector(`[data-${p}action="set-style-builder-submit"]`);

        if (preview) {
            preview.textContent = css || '/* No CSS overrides \u2014 only presentation fields will be saved */';
        }

        if (submitBtn) {
            submitBtn.disabled = !css;
        }
    }

    _generateJSON() {
        if (!this._el) return '{}';
        const p = this.prefix;
        const obj = {};

        for (const token of STYLE_TOKENS) {
            let val;
            if (token.type === 'color') {
                const textInput = this._el.querySelector(`[data-${p}token-text="${token.key}"]`);
                const colorInput = this._el.querySelector(`[data-${p}token="${token.key}"]`);
                val = textInput?.value?.trim() || colorInput?.value?.trim();
            } else {
                const input = this._el.querySelector(`[data-${p}token="${token.key}"]`);
                val = input?.value?.trim();
            }
            if (val && val !== token.default) {
                obj[token.key] = val;
            }
        }

        return JSON.stringify(obj, null, 2);
    }

    _importJSON() {
        if (!this._el) return;
        const p = this.prefix;
        const textarea = this._el.querySelector(`[data-${p}json-import]`);
        if (!textarea) return;
        const raw = textarea.value?.trim();
        if (!raw) return;

        try {
            const obj = JSON.parse(raw);
            for (const token of STYLE_TOKENS) {
                if (obj[token.key]) {
                    const colorInput = this._el.querySelector(`[data-${p}token="${token.key}"]`);
                    const textInput = this._el.querySelector(`[data-${p}token-text="${token.key}"]`);
                    if (colorInput && obj[token.key].match(/^#[0-9a-fA-F]{6}$/)) {
                        colorInput.value = obj[token.key];
                    }
                    if (textInput) textInput.value = obj[token.key];
                }
            }
            textarea.value = '';
            this._updatePreview();
        } catch (e) {
            console.error('[StyleBuilder] Invalid JSON:', e);
        }
    }

    // ── Submit Handlers ──

    async _handleSetURL() {
        const p = this.prefix;
        const input = this._el?.querySelector(`[data-${p}input="style-uri"]`);
        const btn = this._el?.querySelector(`[data-${p}action="set-style-url-submit"]`);
        const uri = input?.value?.trim();
        if (!uri) return;

        try {
            if (btn) btn.textContent = 'Setting...';
            const tx = await this.props.onSetStyle(uri);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (btn) btn.textContent = 'Apply URL';
            this._loadCurrentStyle();
        } catch (error) {
            console.error('[StyleBuilder] Set style URL failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Apply URL'; }, 3000);
        }
    }

    async _handleSetBuilder() {
        const p = this.prefix;
        const btn = this._el?.querySelector(`[data-${p}action="set-style-builder-submit"]`);

        const css = this._generateCSS();
        const envelope = {};

        if (css) envelope.css = css;

        if (Object.keys(envelope).length === 0) return;

        const dataUri = 'data:application/json,' + encodeURIComponent(JSON.stringify(envelope));

        try {
            if (btn) btn.textContent = 'Setting...';
            const tx = await this.props.onSetStyle(dataUri);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Apply Style';
            this._loadCurrentStyle();
        } catch (error) {
            console.error('[StyleBuilder] Set style (builder) failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Apply Style'; }, 3000);
        }
    }

    async _handleClear() {
        const p = this.prefix;
        const btn = this._el?.querySelector(`[data-${p}action="clear-style"]`);

        try {
            if (btn) btn.textContent = 'Clearing...';
            const tx = await this.props.onClearStyle();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Clear Style';
            this._loadCurrentStyle();
        } catch (error) {
            console.error('[StyleBuilder] Clear style failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Clear Style'; }, 3000);
        }
    }

    // ── Render ──

    render() {
        const p = this.prefix;
        const ic = this.inputClass;

        return h('div', { className: 'style-builder' },
            // Current style display (only if onGetStyle provided)
            this.props.onGetStyle && h('div', { className: 'style-builder-current' },
                h('span', { className: 'stat-label' }, 'Current: '),
                h('span', {
                    className: 'admin-stat-value',
                    [`data-${p}current-style`]: true,
                    style: { fontSize: 'var(--font-size-caption)' }
                }, 'None')
            ),

            // Tab switcher
            h('div', { className: 'style-builder-tabs' },
                h('button', {
                    className: 'style-builder-tab active',
                    [`data-${p}style-tab`]: 'builder',
                    onClick: () => this._switchMode('builder')
                }, 'Token Builder'),
                h('button', {
                    className: 'style-builder-tab',
                    [`data-${p}style-tab`]: 'url',
                    onClick: () => this._switchMode('url')
                }, 'CSS URL'),
                this.props.onClearStyle && h('button', {
                    className: 'btn btn-secondary btn-sm',
                    [`data-${p}action`]: 'clear-style',
                    onClick: this.bind(this._handleClear),
                    style: { marginLeft: 'auto' }
                }, 'Clear Style')
            ),

            // Panel: URL mode
            h('div', { [`data-${p}style-panel`]: 'url', style: { display: 'none' } },
                h('div', { className: 'style-builder-hint' },
                    'Paste a URL to a .css file. Supports IPFS (ipfs://...), HTTPS, or local paths (/styles/...).'
                ),
                h('div', { className: 'admin-inline-form-row' },
                    h('input', {
                        type: 'text',
                        [`data-${p}input`]: 'style-uri',
                        placeholder: 'ipfs://... or https://... or /styles/my-theme.css',
                        className: ic
                    }),
                    h('button', {
                        className: 'btn btn-primary btn-sm',
                        [`data-${p}action`]: 'set-style-url-submit',
                        onClick: this.bind(this._handleSetURL)
                    }, 'Apply URL')
                )
            ),

            // Panel: Builder mode
            h('div', { [`data-${p}style-panel`]: 'builder' },

                h('div', { className: 'style-builder-hint' },
                    'Override design tokens below. Only changed values are stored.'
                ),

                // Token grid
                h('div', { className: 'style-token-grid' },
                    ...STYLE_TOKENS.map(token =>
                        h('div', { className: 'style-token-row' },
                            h('label', {
                                className: 'style-token-label',
                                title: token.key
                            }, token.label),
                            h('code', { className: 'style-token-key' }, token.key),
                            token.type === 'color'
                                ? h('div', { className: 'style-token-input-group' },
                                    h('input', {
                                        type: 'color',
                                        [`data-${p}token`]: token.key,
                                        value: token.default,
                                        className: 'style-token-color',
                                        onInput: (e) => {
                                            const textInput = this._el?.querySelector(`[data-${p}token-text="${token.key}"]`);
                                            if (textInput) textInput.value = e.target.value;
                                            this._updatePreview();
                                        }
                                    }),
                                    h('input', {
                                        type: 'text',
                                        [`data-${p}token-text`]: token.key,
                                        value: token.default,
                                        className: 'style-token-text',
                                        placeholder: token.default,
                                        onInput: (e) => {
                                            const colorInput = this._el?.querySelector(`[data-${p}token="${token.key}"]`);
                                            if (colorInput && e.target.value.match(/^#[0-9a-fA-F]{6}$/)) {
                                                colorInput.value = e.target.value;
                                            }
                                            this._updatePreview();
                                        }
                                    })
                                )
                                : h('input', {
                                    type: 'text',
                                    [`data-${p}token`]: token.key,
                                    placeholder: token.default || 'e.g. "Inter", sans-serif',
                                    className: ic,
                                    onInput: () => this._updatePreview()
                                })
                        )
                    )
                ),

                // Extended: Font Import
                h('div', { className: 'style-extended-section' },
                    h('div', { className: 'style-extended-title' }, 'Font'),
                    h('div', { className: 'style-builder-hint' },
                        'Import a web font. Paste the URL from Google Fonts or a self-hosted source. ',
                        'Then set the font family name to apply it.'
                    ),
                    h('div', { className: 'style-extended-row' },
                        h('label', { className: 'style-token-label' }, 'Import URL'),
                        h('input', {
                            type: 'text',
                            [`data-${p}ext`]: 'font-url',
                            className: ic,
                            placeholder: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;700',
                            onInput: () => this._updatePreview()
                        })
                    ),
                    h('div', { className: 'style-extended-row' },
                        h('label', { className: 'style-token-label' }, 'Family'),
                        h('input', {
                            type: 'text',
                            [`data-${p}ext`]: 'font-family',
                            className: ic,
                            placeholder: "'Inter', sans-serif",
                            onInput: () => this._updatePreview()
                        })
                    )
                ),

                // Extended: Background Image
                h('div', { className: 'style-extended-section' },
                    h('div', { className: 'style-extended-title' }, 'Background Image'),
                    h('div', { className: 'style-builder-hint' },
                        'Set a background image on the page. Add an overlay color (e.g. rgba(0,0,0,0.7)) to keep text readable over busy images.'
                    ),
                    h('div', { className: 'style-extended-row' },
                        h('label', { className: 'style-token-label' }, 'Image URL'),
                        h('input', {
                            type: 'text',
                            [`data-${p}ext`]: 'bg-image',
                            className: ic,
                            placeholder: 'https://... or ipfs://... or /images/bg.jpg',
                            onInput: () => this._updatePreview()
                        })
                    ),
                    h('div', { className: 'style-extended-row' },
                        h('label', { className: 'style-token-label' }, 'Overlay'),
                        h('input', {
                            type: 'text',
                            [`data-${p}ext`]: 'bg-overlay',
                            className: ic,
                            placeholder: 'rgba(0, 0, 0, 0.7)',
                            onInput: () => this._updatePreview()
                        })
                    )
                ),

                // Extended: Custom CSS
                h('div', { className: 'style-extended-section' },
                    h('div', { className: 'style-extended-title' }, 'Custom CSS'),
                    h('div', { className: 'style-builder-hint' },
                        'Write any CSS rules. This is appended after the generated token overrides. Full CSS supported.'
                    ),
                    h('textarea', {
                        [`data-${p}ext`]: 'custom-css',
                        className: 'style-custom-css-input',
                        rows: '4',
                        placeholder: '.edition-card { border-radius: 8px; }\n.project-title { font-style: italic; }',
                        onInput: () => this._updatePreview()
                    })
                ),

                // JSON import/export
                h('details', { className: 'style-json-section' },
                    h('summary', { className: 'stat-label' }, 'JSON Import / Export'),
                    h('div', { className: 'style-json-content' },
                        h('div', { className: 'style-builder-hint' },
                            'Paste a JSON object of token overrides to bulk-set values, or copy the current config.'
                        ),
                        h('div', { className: 'style-json-example' },
                            h('code', null, '{ "--bg-primary": "#0a0a0f", "--text-primary": "#e0e0e0" }')
                        ),
                        h('div', { className: 'admin-inline-form-row' },
                            h('textarea', {
                                [`data-${p}json-import`]: true,
                                className: ic,
                                rows: '3',
                                placeholder: 'Paste JSON here...',
                                style: { fontFamily: 'var(--font-mono)', fontSize: 'var(--font-size-caption)', minWidth: '200px' }
                            }),
                            h('div', { style: { display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' } },
                                h('button', {
                                    className: 'btn btn-secondary btn-sm',
                                    onClick: this.bind(this._importJSON)
                                }, 'Import'),
                                h('button', {
                                    className: 'btn btn-secondary btn-sm',
                                    onClick: () => {
                                        const ta = this._el?.querySelector(`[data-${p}json-import]`);
                                        if (ta) ta.value = this._generateJSON();
                                    }
                                }, 'Export')
                            )
                        )
                    )
                ),

                // Preview
                h('div', { className: 'style-preview-section' },
                    h('div', { className: 'stat-label' }, 'Generated CSS'),
                    h('pre', {
                        className: 'style-preview',
                        [`data-${p}style-preview`]: true
                    }, '/* No overrides set \u2014 using defaults */')
                ),

                // Submit
                h('div', { className: 'admin-inline-form-row', style: { marginTop: 'var(--space-2)' } },
                    h('button', {
                        className: 'btn btn-primary btn-sm',
                        [`data-${p}action`]: 'set-style-builder-submit',
                        disabled: true,
                        onClick: this.bind(this._handleSetBuilder)
                    }, 'Apply Style')
                )
            )
        );
    }
}

export default StyleBuilder;

/**
 * ProjectSearch - Microact Version
 *
 * Search input with debouncing for project discovery.
 * Handles focus preservation during updates.
 */

import { Component, h } from '../../core/microact-setup.js';

export class ProjectSearch extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            query: props.initialQuery || ''
        };
        this.debounceTimer = null;
        this._inputRef = null;
    }

    willUnmount() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }

    handleInput(e) {
        const query = e.target.value;
        this._inputRef = e.target;

        // Update state without triggering re-render for minor changes
        const previousQuery = this.state.query;
        this.state.query = query;

        // Only re-render if clear button needs to appear/disappear
        const wasEmpty = previousQuery.length === 0;
        const isEmpty = query.length === 0;
        if (wasEmpty !== isEmpty) {
            this.setState({ query });
        }

        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
        }

        // Debounce the search callback
        this.debounceTimer = this.setTimeout(() => {
            const { onSearch } = this.props;
            if (onSearch) {
                onSearch(query);
            }
            this.debounceTimer = null;
        }, 300);
    }

    handleKeyDown(e) {
        if (e.key === 'Escape') {
            this.clearSearch();
        }
    }

    handleClear() {
        this.clearSearch();
    }

    clearSearch() {
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        this.setState({ query: '' });

        const { onSearch } = this.props;
        if (onSearch) {
            onSearch('');
        }
    }

    setQuery(query) {
        this.setState({ query: query || '' });
    }

    getQuery() {
        return this.state.query;
    }

    render() {
        const { query } = this.state;

        return h('div', { className: 'project-search' },
            h('div', { className: 'search-input-wrapper' },
                h('input', {
                    type: 'text',
                    className: 'search-input',
                    placeholder: 'Search projects...',
                    value: query,
                    onInput: this.bind(this.handleInput),
                    onKeyDown: this.bind(this.handleKeyDown)
                }),
                query && h('button', {
                    className: 'search-clear',
                    'aria-label': 'Clear search',
                    onClick: this.bind(this.handleClear)
                }, '×')
            ),
            query && h('div', { className: 'search-results-count' }, 'Searching...')
        );
    }
}

export default ProjectSearch;

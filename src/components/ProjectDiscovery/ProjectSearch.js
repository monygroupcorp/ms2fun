import { Component } from '../../core/Component.js';

/**
 * ProjectSearch component
 * Handles search input with debouncing
 */
export class ProjectSearch extends Component {
    constructor(onSearch) {
        super();
        this.onSearch = onSearch;
        this.debounceTimer = null; // Store timer as instance variable, not in state
        this.state = {
            query: ''
        };
    }

    render() {
        return `
            <div class="project-search">
                <div class="search-input-wrapper">
                    <input 
                        type="text" 
                        class="search-input" 
                        placeholder="Search projects..." 
                        value="${this.state.query}"
                        data-ref="search-input"
                    />
                    ${this.state.query ? `
                        <button class="search-clear" data-ref="clear-button" aria-label="Clear search">
                            ×
                        </button>
                    ` : ''}
                </div>
                ${this.state.query ? `
                    <div class="search-results-count" data-ref="results-count">
                        Searching...
                    </div>
                ` : ''}
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    /**
     * Override update to preserve focus on input
     */
    update() {
        // Store focus state before update
        const searchInput = this.getRef('search-input', '.search-input');
        const wasFocused = searchInput && document.activeElement === searchInput;
        const cursorPosition = searchInput ? searchInput.selectionStart : null;
        const inputValue = searchInput ? searchInput.value : null;
        
        // Call parent update
        super.update();
        
        // Restore focus and cursor position after update
        if (wasFocused) {
            this.setTimeout(() => {
                const newInput = this.getRef('search-input', '.search-input');
                if (newInput) {
                    // Restore value if it was changed
                    if (inputValue !== null && newInput.value !== inputValue) {
                        newInput.value = inputValue;
                    }
                    // Restore focus
                    newInput.focus();
                    // Restore cursor position
                    if (cursorPosition !== null) {
                        const position = Math.min(cursorPosition, newInput.value.length);
                        newInput.setSelectionRange(position, position);
                    }
                }
            }, 0);
        }
    }

    setupDOMEventListeners() {
        const searchInput = this.getRef('search-input', '.search-input');
        const clearButton = this.getRef('clear-button', '.search-clear');

        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.handleSearch(e.target.value);
            });

            searchInput.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    this.clearSearch();
                }
            });
        }

        if (clearButton) {
            clearButton.addEventListener('click', () => {
                this.clearSearch();
            });
        }
    }

    handleSearch(query) {
        // Update the input value directly without triggering re-render
        const searchInput = this.getRef('search-input', '.search-input');
        if (searchInput) {
            // Store cursor position and focus state BEFORE any changes
            const cursorPosition = searchInput.selectionStart || query.length;
            const wasFocused = document.activeElement === searchInput;
            const previousQuery = this.state.query || '';
            
            // Update state directly (avoid setState to prevent re-render during typing)
            this.state.query = query;
            
            // Update input value directly (the browser handles cursor positioning)
            // Don't update if value is already correct to avoid cursor jumping
            if (searchInput.value !== query) {
                searchInput.value = query;
            }
            
            // Only trigger DOM update if we need to show/hide clear button or results count
            // (when query goes from empty to non-empty or vice versa)
            const wasEmpty = previousQuery.length === 0;
            const isEmpty = query.length === 0;
            const needsDOMUpdate = wasEmpty !== isEmpty;
            
            if (needsDOMUpdate) {
                // Save focus state before update
                this._domUpdater.saveState(this.element);
                
                // Need to show/hide clear button or results count - must update DOM
                this.update();
                
                // Restore focus state after update
                this._domUpdater.restoreState(this.element);
                
                // Re-attach listeners and restore focus after update
                this.setTimeout(() => {
                    const newInput = this.getRef('search-input', '.search-input');
                    if (newInput && wasFocused) {
                        newInput.focus();
                        // Restore cursor to end of input (most natural position after typing)
                        const newPosition = query.length;
                        newInput.setSelectionRange(newPosition, newPosition);
                    }
                    // Re-attach event listeners
                    this.setupDOMEventListeners();
                }, 0);
            } else if (wasFocused) {
                // No DOM update needed, just ensure focus is maintained
                // The browser already positioned the cursor correctly
                searchInput.focus();
            }
        } else {
            // Fallback: update state normally if input not found
            this.setState({ query });
        }

        // Clear existing timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }

        // Debounce the actual search callback
        this.debounceTimer = this.setTimeout(() => {
            // Store focus state before calling callback (which may trigger parent re-render)
            const searchInput = this.getRef('search-input', '.search-input');
            const wasFocused = searchInput && document.activeElement === searchInput;
            const cursorPosition = searchInput ? searchInput.selectionStart : null;
            
            // Save focus state before parent callback
            if (this.element) {
                this._domUpdater.saveState(this.element);
            }
            
            if (this.onSearch) {
                this.onSearch(query);
            }
            
            // Restore focus after callback (parent may have re-rendered)
            // Use a slightly longer delay to ensure parent update completed
            this.setTimeout(() => {
                if (this.element) {
                    this._domUpdater.restoreState(this.element);
                }
                
                // Also manually restore focus as backup
                if (wasFocused) {
                    const input = this.getRef('search-input', '.search-input');
                    if (input) {
                        input.focus();
                        if (cursorPosition !== null) {
                            // Ensure cursor position is within bounds
                            const maxPos = input.value.length;
                            const pos = Math.min(cursorPosition, maxPos);
                            input.setSelectionRange(pos, pos);
                        }
                    }
                }
            }, 50); // Slightly longer delay to ensure parent update completed
            
            this.debounceTimer = null;
        }, 300);
    }

    clearSearch() {
        // Clear the debounce timer
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
        
        // Update UI immediately
        this.setState({ query: '' });
        
        // Call search callback immediately with empty query (no debounce for clear)
        if (this.onSearch) {
            this.onSearch('');
        }
    }

    /**
     * Set initial search query (used when component is recreated)
     * @param {string} query - Initial search query
     */
    setInitialQuery(query) {
        if (query) {
            // Set state directly and update UI
            this.state = { ...this.state, query };
            this.update();
        }
    }

    onUnmount() {
        // Clear debounce timer on unmount
        if (this.debounceTimer) {
            clearTimeout(this.debounceTimer);
            this.debounceTimer = null;
        }
    }
}


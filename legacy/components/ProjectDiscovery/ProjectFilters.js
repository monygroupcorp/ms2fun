import { Component } from '../../core/Component.js';

/**
 * ProjectFilters component
 * Handles filtering and sorting of projects
 */
export class ProjectFilters extends Component {
    constructor(onFilterChange) {
        super();
        this.onFilterChange = onFilterChange;
        this.state = {
            selectedType: 'all',
            selectedFactory: 'all',
            sortBy: 'date',
            viewMode: 'grid',
            factories: []
        };
    }

    setFactories(factories) {
        this.setState({ factories });
    }

    /**
     * Set initial filter state (used when component is recreated)
     * @param {object} filters - Filter state { type, factory, sortBy, viewMode }
     */
    setInitialState(filters) {
        if (filters) {
            // Set state directly to avoid triggering change callbacks
            this.state = {
                ...this.state,
                selectedType: filters.type || 'all',
                selectedFactory: filters.factory || 'all',
                sortBy: filters.sortBy || 'date',
                viewMode: filters.viewMode || 'grid'
            };
            // Trigger update to reflect state in UI
            this.update();
        }
    }

    render() {
        return `
            <div class="project-filters">
                <div class="filter-group">
                    <label for="type-filter">Type:</label>
                    <select id="type-filter" class="filter-select" data-ref="type-filter">
                        <option value="all" ${this.state.selectedType === 'all' ? 'selected' : ''}>All Types</option>
                        <option value="ERC404" ${this.state.selectedType === 'ERC404' ? 'selected' : ''}>ERC404</option>
                        <option value="ERC1155" ${this.state.selectedType === 'ERC1155' ? 'selected' : ''}>ERC1155</option>
                    </select>
                </div>

                <div class="filter-group">
                    <label for="factory-filter">Factory:</label>
                    <select id="factory-filter" class="filter-select" data-ref="factory-filter">
                        <option value="all" ${this.state.selectedFactory === 'all' ? 'selected' : ''}>All Factories</option>
                        ${this.state.factories.map(factory => `
                            <option value="${factory.address}" ${this.state.selectedFactory === factory.address ? 'selected' : ''}>
                                ${factory.type} - ${factory.address.slice(0, 10)}...
                            </option>
                        `).join('')}
                    </select>
                </div>

                <div class="filter-group">
                    <label for="sort-filter">Sort:</label>
                    <select id="sort-filter" class="filter-select" data-ref="sort-filter">
                        <option value="date" ${this.state.sortBy === 'date' ? 'selected' : ''}>Newest First</option>
                        <option value="volume" ${this.state.sortBy === 'volume' ? 'selected' : ''}>Highest Volume</option>
                        <option value="name" ${this.state.sortBy === 'name' ? 'selected' : ''}>Name (A-Z)</option>
                    </select>
                </div>

                <div class="filter-group view-toggle">
                    <button 
                        class="view-button ${this.state.viewMode === 'grid' ? 'active' : ''}" 
                        data-view="grid"
                        data-ref="grid-button"
                        aria-label="Grid view"
                    >
                        ⊞
                    </button>
                    <button 
                        class="view-button ${this.state.viewMode === 'list' ? 'active' : ''}" 
                        data-view="list"
                        data-ref="list-button"
                        aria-label="List view"
                    >
                        ☰
                    </button>
                </div>

                <button class="clear-filters" data-ref="clear-filters">Clear Filters</button>
            </div>
        `;
    }

    mount(element) {
        super.mount(element);
        this.setupDOMEventListeners();
    }

    setupDOMEventListeners() {
        const typeFilter = this.getRef('type-filter', '#type-filter');
        const factoryFilter = this.getRef('factory-filter', '#factory-filter');
        const sortFilter = this.getRef('sort-filter', '#sort-filter');
        const gridButton = this.getRef('grid-button', '[data-view="grid"]');
        const listButton = this.getRef('list-button', '[data-view="list"]');
        const clearFilters = this.getRef('clear-filters', '.clear-filters');

        if (typeFilter) {
            typeFilter.addEventListener('change', (e) => {
                this.setState({ selectedType: e.target.value });
                this.notifyChange();
            });
        }

        if (factoryFilter) {
            factoryFilter.addEventListener('change', (e) => {
                this.setState({ selectedFactory: e.target.value });
                this.notifyChange();
            });
        }

        if (sortFilter) {
            sortFilter.addEventListener('change', (e) => {
                this.setState({ sortBy: e.target.value });
                this.notifyChange();
            });
        }

        if (gridButton) {
            gridButton.addEventListener('click', () => {
                this.setState({ viewMode: 'grid' });
                this.notifyChange();
            });
        }

        if (listButton) {
            listButton.addEventListener('click', () => {
                this.setState({ viewMode: 'list' });
                this.notifyChange();
            });
        }

        if (clearFilters) {
            clearFilters.addEventListener('click', () => {
                this.setState({
                    selectedType: 'all',
                    selectedFactory: 'all',
                    sortBy: 'date'
                });
                this.notifyChange();
            });
        }
    }

    notifyChange() {
        if (this.onFilterChange) {
            this.onFilterChange({
                type: this.state.selectedType,
                factory: this.state.selectedFactory,
                sortBy: this.state.sortBy,
                viewMode: this.state.viewMode
            });
        }
    }

    getFilters() {
        return {
            type: this.state.selectedType,
            factory: this.state.selectedFactory,
            sortBy: this.state.sortBy,
            viewMode: this.state.viewMode
        };
    }
}


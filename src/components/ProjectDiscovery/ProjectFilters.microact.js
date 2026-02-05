/**
 * ProjectFilters - Microact Version
 *
 * Handles filtering and sorting of projects with type, factory, sort options.
 * Emits filter changes via callback prop.
 */

import { Component, h } from '../../core/microact-setup.js';

export class ProjectFilters extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            selectedType: props.initialType || 'all',
            selectedFactory: props.initialFactory || 'all',
            sortBy: props.initialSort || 'date',
            viewMode: props.initialViewMode || 'grid'
        };
    }

    get factories() {
        return this.props.factories || [];
    }

    handleTypeChange(e) {
        this.setState({ selectedType: e.target.value });
        this.notifyChange();
    }

    handleFactoryChange(e) {
        this.setState({ selectedFactory: e.target.value });
        this.notifyChange();
    }

    handleSortChange(e) {
        this.setState({ sortBy: e.target.value });
        this.notifyChange();
    }

    handleViewModeGrid() {
        this.setState({ viewMode: 'grid' });
        this.notifyChange();
    }

    handleViewModeList() {
        this.setState({ viewMode: 'list' });
        this.notifyChange();
    }

    handleClearFilters() {
        this.setState({
            selectedType: 'all',
            selectedFactory: 'all',
            sortBy: 'date'
        });
        this.notifyChange();
    }

    notifyChange() {
        const { onFilterChange } = this.props;
        if (onFilterChange) {
            onFilterChange({
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

    setFilters(filters) {
        if (filters) {
            this.setState({
                selectedType: filters.type || 'all',
                selectedFactory: filters.factory || 'all',
                sortBy: filters.sortBy || 'date',
                viewMode: filters.viewMode || 'grid'
            });
        }
    }

    render() {
        const { selectedType, selectedFactory, sortBy, viewMode } = this.state;
        const factories = this.factories;

        return h('div', { className: 'project-filters' },
            // Type filter
            h('div', { className: 'filter-group' },
                h('label', { htmlFor: 'type-filter' }, 'Type:'),
                h('select', {
                    id: 'type-filter',
                    className: 'filter-select',
                    value: selectedType,
                    onChange: this.bind(this.handleTypeChange)
                },
                    h('option', { value: 'all' }, 'All Types'),
                    h('option', { value: 'ERC404' }, 'ERC404'),
                    h('option', { value: 'ERC1155' }, 'ERC1155')
                )
            ),

            // Factory filter
            h('div', { className: 'filter-group' },
                h('label', { htmlFor: 'factory-filter' }, 'Factory:'),
                h('select', {
                    id: 'factory-filter',
                    className: 'filter-select',
                    value: selectedFactory,
                    onChange: this.bind(this.handleFactoryChange)
                },
                    h('option', { value: 'all' }, 'All Factories'),
                    ...factories.map(factory =>
                        h('option', {
                            value: factory.address,
                            key: factory.address
                        }, `${factory.type} - ${factory.address.slice(0, 10)}...`)
                    )
                )
            ),

            // Sort filter
            h('div', { className: 'filter-group' },
                h('label', { htmlFor: 'sort-filter' }, 'Sort:'),
                h('select', {
                    id: 'sort-filter',
                    className: 'filter-select',
                    value: sortBy,
                    onChange: this.bind(this.handleSortChange)
                },
                    h('option', { value: 'date' }, 'Newest First'),
                    h('option', { value: 'volume' }, 'Highest Volume'),
                    h('option', { value: 'name' }, 'Name (A-Z)')
                )
            ),

            // View toggle
            h('div', { className: 'filter-group view-toggle' },
                h('button', {
                    className: `view-button ${viewMode === 'grid' ? 'active' : ''}`,
                    'aria-label': 'Grid view',
                    onClick: this.bind(this.handleViewModeGrid)
                }, '⊞'),
                h('button', {
                    className: `view-button ${viewMode === 'list' ? 'active' : ''}`,
                    'aria-label': 'List view',
                    onClick: this.bind(this.handleViewModeList)
                }, '☰')
            ),

            // Clear filters
            h('button', {
                className: 'clear-filters',
                onClick: this.bind(this.handleClearFilters)
            }, 'Clear Filters')
        );
    }
}

export default ProjectFilters;

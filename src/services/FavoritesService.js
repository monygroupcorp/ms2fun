/**
 * FavoritesService
 * Manages user's favorite/starred projects in localStorage
 */

const STORAGE_KEY = 'ms2fun_favorites';

class FavoritesService {
    constructor() {
        this._favorites = this._load();
    }

    _load() {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            return stored ? JSON.parse(stored) : [];
        } catch (e) {
            console.warn('[FavoritesService] Failed to load favorites:', e);
            return [];
        }
    }

    _save() {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(this._favorites));
        } catch (e) {
            console.warn('[FavoritesService] Failed to save favorites:', e);
        }
    }

    isFavorite(projectId) {
        return this._favorites.includes(projectId.toLowerCase());
    }

    addFavorite(projectId) {
        const id = projectId.toLowerCase();
        if (!this._favorites.includes(id)) {
            this._favorites.push(id);
            this._save();
        }
    }

    removeFavorite(projectId) {
        const id = projectId.toLowerCase();
        this._favorites = this._favorites.filter(f => f !== id);
        this._save();
    }

    toggleFavorite(projectId) {
        if (this.isFavorite(projectId)) {
            this.removeFavorite(projectId);
            return false;
        } else {
            this.addFavorite(projectId);
            return true;
        }
    }

    getFavorites() {
        return [...this._favorites];
    }
}

export const favoritesService = new FavoritesService();
export default favoritesService;

/**
 * DOMUpdater - Utility for granular DOM updates
 * Preserves focus state, scroll position, and form input values during updates
 */
export class DOMUpdater {
    constructor() {
        this._activeElement = null;
        this._activeElementPath = null;
        this._scrollPositions = new Map();
    }

    /**
     * Save the currently focused element and scroll positions
     * @param {HTMLElement} rootElement - Root element to save state from
     */
    saveState(rootElement) {
        // Guard against null rootElement (component not mounted)
        if (!rootElement) {
            this._activeElement = null;
            this._activeElementPath = null;
            this._scrollPositions.clear();
            return;
        }

        // Save active element
        const activeElement = document.activeElement;
        if (activeElement && rootElement.contains(activeElement)) {
            this._activeElement = activeElement;
            this._activeElementPath = this._getElementPath(activeElement, rootElement);
        } else {
            this._activeElement = null;
            this._activeElementPath = null;
        }

        // Save scroll positions for all scrollable containers
        this._scrollPositions.clear();
        const scrollableElements = rootElement.querySelectorAll('[data-scroll-container], [style*="overflow"]');
        scrollableElements.forEach(el => {
            if (el.scrollTop !== undefined || el.scrollLeft !== undefined) {
                const path = this._getElementPath(el, rootElement);
                this._scrollPositions.set(path, {
                    scrollTop: el.scrollTop,
                    scrollLeft: el.scrollLeft
                });
            }
        });
    }

    /**
     * Restore focus and scroll positions after DOM update
     * @param {HTMLElement} rootElement - Root element to restore state in
     */
    restoreState(rootElement) {
        // Guard against null rootElement (component not mounted)
        if (!rootElement) {
            return;
        }

        // Restore focus
        if (this._activeElementPath) {
            const element = this._getElementByPath(rootElement, this._activeElementPath);
            if (element && element.focus) {
                try {
                    // Restore cursor position if it's an input/textarea
                    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
                        const selectionStart = element.selectionStart || 0;
                        element.focus();
                        if (element.setSelectionRange) {
                            element.setSelectionRange(selectionStart, selectionStart);
                        }
                    } else {
                        element.focus();
                    }
                } catch (e) {
                    // Focus may fail if element is not focusable, ignore
                }
            }
        }

        // Restore scroll positions
        this._scrollPositions.forEach((position, path) => {
            const element = this._getElementByPath(rootElement, path);
            if (element) {
                element.scrollTop = position.scrollTop;
                element.scrollLeft = position.scrollLeft;
            }
        });
    }

    /**
     * Get a path string to identify an element within its root
     * @private
     */
    _getElementPath(element, root) {
        const path = [];
        let current = element;
        
        while (current && current !== root && current.parentNode) {
            const parent = current.parentNode;
            const index = Array.from(parent.children).indexOf(current);
            path.unshift(index);
            current = parent;
        }
        
        return path.join('/');
    }

    /**
     * Get an element by its path within root
     * @private
     */
    _getElementByPath(root, path) {
        const indices = path.split('/').map(Number);
        let current = root;
        
        for (const index of indices) {
            if (!current.children || !current.children[index]) {
                return null;
            }
            current = current.children[index];
        }
        
        return current;
    }

    /**
     * Compare two HTML strings and determine if they're structurally different
     * @param {string} oldHTML - Previous HTML
     * @param {string} newHTML - New HTML
     * @returns {boolean} - True if structure is significantly different
     */
    diffHTML(oldHTML, newHTML) {
        if (oldHTML === newHTML) return false;
        
        // Simple heuristic: if length difference is > 50%, likely structural change
        const lengthDiff = Math.abs(oldHTML.length - newHTML.length);
        const avgLength = (oldHTML.length + newHTML.length) / 2;
        if (lengthDiff / avgLength > 0.5) {
            return true;
        }
        
        // Check for tag changes (simplified)
        const oldTags = oldHTML.match(/<[^>]+>/g) || [];
        const newTags = newHTML.match(/<[^>]+>/g) || [];
        if (oldTags.length !== newTags.length) {
            return true;
        }
        
        return false;
    }

    /**
     * Update text content of a node
     * @param {Node} node - Node to update
     * @param {string} newText - New text content
     */
    updateText(node, newText) {
        if (node.nodeType === Node.TEXT_NODE) {
            node.textContent = newText;
        } else if (node.nodeType === Node.ELEMENT_NODE) {
            // For elements, update only if it's a text-only element
            if (node.children.length === 0) {
                node.textContent = newText;
            }
        }
    }

    /**
     * Update attributes of an element
     * @param {HTMLElement} element - Element to update
     * @param {Object} newAttrs - New attributes object
     */
    updateAttributes(element, newAttrs) {
        if (!element || element.nodeType !== Node.ELEMENT_NODE) return;
        
        // Get current attributes
        const currentAttrs = {};
        Array.from(element.attributes).forEach(attr => {
            currentAttrs[attr.name] = attr.value;
        });
        
        // Update changed attributes
        Object.keys(newAttrs).forEach(name => {
            const newValue = newAttrs[name];
            if (currentAttrs[name] !== newValue) {
                if (newValue === null || newValue === undefined) {
                    element.removeAttribute(name);
                } else {
                    element.setAttribute(name, newValue);
                }
            }
        });
        
        // Remove attributes that are no longer present
        Object.keys(currentAttrs).forEach(name => {
            if (!(name in newAttrs)) {
                element.removeAttribute(name);
            }
        });
    }

    /**
     * Update children of a parent element using a simple reconciliation algorithm
     * @param {HTMLElement} parent - Parent element
     * @param {NodeList|Array} oldChildren - Current children
     * @param {DocumentFragment|HTMLElement} newChildrenContainer - Container with new children
     */
    updateChildren(parent, oldChildren, newChildrenContainer) {
        const oldArray = Array.from(oldChildren);
        const newArray = Array.from(newChildrenContainer.children || []);
        
        // If structure is too different, replace entirely
        if (Math.abs(oldArray.length - newArray.length) > oldArray.length * 0.3) {
            return false; // Signal to fall back to full replacement
        }
        
        // Simple reconciliation: update in place where possible
        const maxLength = Math.max(oldArray.length, newArray.length);
        
        for (let i = 0; i < maxLength; i++) {
            const oldChild = oldArray[i];
            const newChild = newArray[i];
            
            if (!oldChild && newChild) {
                // New child - append
                parent.appendChild(newChild);
            } else if (oldChild && !newChild) {
                // Old child removed
                oldChild.remove();
            } else if (oldChild && newChild) {
                // Both exist - try to update in place
                if (this._canUpdateInPlace(oldChild, newChild)) {
                    this._updateNodeInPlace(oldChild, newChild);
                } else {
                    // Replace
                    parent.replaceChild(newChild, oldChild);
                }
            }
        }
        
        return true; // Successfully updated
    }

    /**
     * Check if two nodes can be updated in place
     * @private
     */
    _canUpdateInPlace(oldNode, newNode) {
        if (oldNode.nodeType !== newNode.nodeType) return false;
        if (oldNode.nodeType === Node.TEXT_NODE) return true;
        if (oldNode.nodeType === Node.ELEMENT_NODE) {
            return oldNode.tagName === newNode.tagName;
        }
        return false;
    }

    /**
     * Update a node in place with new content
     * @private
     */
    _updateNodeInPlace(oldNode, newNode) {
        if (oldNode.nodeType === Node.TEXT_NODE) {
            oldNode.textContent = newNode.textContent;
            return;
        }
        
        if (oldNode.nodeType === Node.ELEMENT_NODE) {
            // Update attributes
            const newAttrs = {};
            Array.from(newNode.attributes).forEach(attr => {
                newAttrs[attr.name] = attr.value;
            });
            this.updateAttributes(oldNode, newAttrs);
            
            // Update children recursively
            const oldChildren = oldNode.childNodes;
            const newChildren = newNode.childNodes;
            
            // For simple text-only updates
            if (oldChildren.length === 1 && newChildren.length === 1 &&
                oldChildren[0].nodeType === Node.TEXT_NODE &&
                newChildren[0].nodeType === Node.TEXT_NODE) {
                oldChildren[0].textContent = newChildren[0].textContent;
                return;
            }
            
            // For more complex structures, try to reconcile
            if (!this.updateChildren(oldNode, oldChildren, newNode)) {
                // Fall back to replacing content
                oldNode.innerHTML = newNode.innerHTML;
            }
        }
    }

    /**
     * Perform a granular update of an element's content
     * @param {HTMLElement} element - Element to update
     * @param {string} newHTML - New HTML content
     * @returns {boolean} - True if granular update succeeded, false if fallback needed
     */
    updateGranular(element, newHTML) {
        // Save state before update
        this.saveState(element);
        
        // Create temporary container for new HTML
        const temp = document.createElement('div');
        temp.innerHTML = newHTML;
        
        // Try to update children granularly
        const oldHTML = element.innerHTML;
        const isStructuralChange = this.diffHTML(oldHTML, newHTML);
        
        if (isStructuralChange) {
            // Structural change detected - fall back to full replacement
            return false;
        }
        
        // Try granular update
        try {
            const success = this.updateChildren(element, element.childNodes, temp);
            if (success) {
                // Restore state after successful update
                this.restoreState(element);
                return true;
            }
        } catch (e) {
            console.warn('[DOMUpdater] Granular update failed, falling back:', e);
        }
        
        return false;
    }
}


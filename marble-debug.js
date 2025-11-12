/**
 * Marble Texture Debug & Experimentation Tool
 * Drop this into the browser console to inspect and adjust marble configurations
 * 
 * Usage:
 *   marbleDebug.inspect()           - Show all marble configs
 *   marbleDebug.edit(selector)      - Edit a specific element
 *   marbleDebug.test()              - Show test panel with controls
 *   marbleDebug.reset()             - Reset all to defaults
 */

(function() {
    'use strict';
    
    const marbleDebug = {
        // Get all marble-bg elements and their configs
        inspect: function() {
            const elements = document.querySelectorAll('.marble-bg');
            console.group('🔍 Marble Texture Configurations');
            console.log(`Found ${elements.length} marble-bg elements\n`);
            
            const configs = [];
            elements.forEach((el, index) => {
                const config = {
                    index: index,
                    element: el,
                    selector: this._getSelector(el),
                    classes: Array.from(el.classList).filter(c => c.startsWith('marble-')),
                    stretchX: el.style.getPropertyValue('--marble-stretch-x') || '100',
                    stretchY: el.style.getPropertyValue('--marble-stretch-y') || '100',
                    blur: el.style.getPropertyValue('--marble-blur') || '0px',
                    configured: el.dataset.marbleConfigured === 'true',
                    rawConfig: el.dataset.marbleConfig ? JSON.parse(el.dataset.marbleConfig) : null
                };
                
                configs.push(config);
                
                console.group(`📦 Element ${index + 1}: ${config.selector}`);
                console.log('Classes:', config.classes);
                console.log('Stretch X:', config.stretchX + '%');
                console.log('Stretch Y:', config.stretchY + '%');
                console.log('Blur:', config.blur);
                console.log('Configured:', config.configured);
                if (config.rawConfig) {
                    console.log('Raw Config:', config.rawConfig);
                }
                console.log('Element:', el);
                console.groupEnd();
            });
            
            console.log('\n📊 Summary:');
            const stretchXValues = configs.map(c => parseInt(c.stretchX));
            const stretchYValues = configs.map(c => parseInt(c.stretchY));
            const blurValues = configs.map(c => parseFloat(c.blur) || 0);
            
            console.log(`Stretch X: min=${Math.min(...stretchXValues)}%, max=${Math.max(...stretchXValues)}%, avg=${Math.round(stretchXValues.reduce((a,b)=>a+b,0)/stretchXValues.length)}%`);
            console.log(`Stretch Y: min=${Math.min(...stretchYValues)}%, max=${Math.max(...stretchYValues)}%, avg=${Math.round(stretchYValues.reduce((a,b)=>a+b,0)/stretchYValues.length)}%`);
            console.log(`Blur: min=${Math.min(...blurValues).toFixed(2)}px, max=${Math.max(...blurValues).toFixed(2)}px, avg=${(blurValues.reduce((a,b)=>a+b,0)/blurValues.length).toFixed(2)}px`);
            
            console.groupEnd();
            
            // Store for later use
            window._marbleConfigs = configs;
            return configs;
        },
        
        // Edit a specific element's marble config
        edit: function(selector, options = {}) {
            const el = typeof selector === 'string' 
                ? document.querySelector(selector) 
                : selector;
            
            if (!el || !el.classList.contains('marble-bg')) {
                console.error('❌ Element not found or not a marble-bg element');
                return;
            }
            
            console.group('✏️ Editing Marble Config');
            console.log('Element:', el);
            console.log('Current values:');
            console.log('  Stretch X:', el.style.getPropertyValue('--marble-stretch-x') || '100');
            console.log('  Stretch Y:', el.style.getPropertyValue('--marble-stretch-y') || '100');
            console.log('  Blur:', el.style.getPropertyValue('--marble-blur') || '0px');
            
            // Apply new values
            if (options.stretchX !== undefined) {
                el.style.setProperty('--marble-stretch-x', options.stretchX);
                console.log(`✅ Set stretchX to ${options.stretchX}%`);
            }
            if (options.stretchY !== undefined) {
                el.style.setProperty('--marble-stretch-y', options.stretchY);
                console.log(`✅ Set stretchY to ${options.stretchY}%`);
            }
            if (options.blur !== undefined) {
                el.style.setProperty('--marble-blur', `${options.blur}px`);
                console.log(`✅ Set blur to ${options.blur}px`);
            }
            
            // Update smooth rendering class
            const currentBlur = parseFloat(el.style.getPropertyValue('--marble-blur')) || 0;
            if (currentBlur >= 1) {
                el.classList.add('marble-smooth-render');
            } else {
                el.classList.remove('marble-smooth-render');
            }
            
            console.log('\nNew values:');
            console.log('  Stretch X:', el.style.getPropertyValue('--marble-stretch-x'));
            console.log('  Stretch Y:', el.style.getPropertyValue('--marble-stretch-y'));
            console.log('  Blur:', el.style.getPropertyValue('--marble-blur'));
            console.groupEnd();
            
            return el;
        },
        
        // Create interactive test panel
        test: function(selector = '.marble-bg') {
            const elements = document.querySelectorAll(selector);
            if (elements.length === 0) {
                console.error('❌ No elements found with selector:', selector);
                return;
            }
            
            // Remove existing panel if any
            const existing = document.getElementById('marble-debug-panel');
            if (existing) existing.remove();
            
            // Create panel
            const panel = document.createElement('div');
            panel.id = 'marble-debug-panel';
            panel.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                width: 400px;
                max-height: 80vh;
                overflow-y: auto;
                background: rgba(0, 0, 0, 0.95);
                color: #fff;
                padding: 20px;
                border: 2px solid #d4af37;
                border-radius: 8px;
                font-family: monospace;
                font-size: 12px;
                z-index: 99999;
                box-shadow: 0 4px 20px rgba(0,0,0,0.5);
            `;
            
            panel.innerHTML = `
                <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px;">
                    <h3 style="margin: 0; color: #d4af37;">🎨 Marble Debug Panel</h3>
                    <button id="marble-debug-close" style="background: #f44336; color: white; border: none; padding: 5px 10px; cursor: pointer; border-radius: 4px;">✕</button>
                </div>
                <div style="margin-bottom: 15px;">
                    <label style="display: block; margin-bottom: 5px;">Element Selector:</label>
                    <input type="text" id="marble-debug-selector" value="${selector}" style="width: 100%; padding: 5px; background: #333; color: #fff; border: 1px solid #555;">
                    <button id="marble-debug-load" style="margin-top: 5px; width: 100%; padding: 5px; background: #4CAF50; color: white; border: none; cursor: pointer; border-radius: 4px;">Load Element</button>
                </div>
                <div id="marble-debug-controls"></div>
                <div style="margin-top: 15px; padding-top: 15px; border-top: 1px solid #555;">
                    <button id="marble-debug-reset" style="width: 100%; padding: 8px; background: #ff9800; color: white; border: none; cursor: pointer; border-radius: 4px; margin-bottom: 5px;">Reset to Defaults</button>
                    <button id="marble-debug-export" style="width: 100%; padding: 8px; background: #2196F3; color: white; border: none; cursor: pointer; border-radius: 4px;">Export Config</button>
                </div>
            `;
            
            document.body.appendChild(panel);
            
            let currentElement = elements[0];
            let currentIndex = 0;
            
            const updateControls = (el) => {
                const controls = document.getElementById('marble-debug-controls');
                const stretchX = parseFloat(el.style.getPropertyValue('--marble-stretch-x')) || 100;
                const stretchY = parseFloat(el.style.getPropertyValue('--marble-stretch-y')) || 100;
                const blur = parseFloat(el.style.getPropertyValue('--marble-blur')) || 0;
                
                controls.innerHTML = `
                    <div style="margin-bottom: 10px; padding: 10px; background: #222; border-radius: 4px;">
                        <strong>Element ${currentIndex + 1} of ${elements.length}</strong><br>
                        <code style="font-size: 10px; color: #aaa;">${this._getSelector(el)}</code>
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;">Stretch X: <span id="marble-stretch-x-value">${stretchX}</span>%</label>
                        <input type="range" id="marble-stretch-x" min="100" max="250" value="${stretchX}" step="1" style="width: 100%;">
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;">Stretch Y: <span id="marble-stretch-y-value">${stretchY}</span>%</label>
                        <input type="range" id="marble-stretch-y" min="100" max="200" value="${stretchY}" step="1" style="width: 100%;">
                    </div>
                    <div style="margin-bottom: 10px;">
                        <label style="display: block; margin-bottom: 5px;">Blur: <span id="marble-blur-value">${blur.toFixed(2)}</span>px</label>
                        <input type="range" id="marble-blur" min="0" max="5" value="${blur}" step="0.1" style="width: 100%;">
                    </div>
                    <div style="display: flex; gap: 5px; margin-bottom: 10px;">
                        <button id="marble-prev" style="flex: 1; padding: 5px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px;">◀ Prev</button>
                        <button id="marble-next" style="flex: 1; padding: 5px; background: #555; color: white; border: none; cursor: pointer; border-radius: 4px;">Next ▶</button>
                    </div>
                    <div style="padding: 10px; background: #1a1a1a; border-radius: 4px; font-size: 10px;">
                        <strong>Current Values:</strong><br>
                        Stretch X: ${stretchX}%<br>
                        Stretch Y: ${stretchY}%<br>
                        Blur: ${blur.toFixed(2)}px<br>
                        Smooth Render: ${el.classList.contains('marble-smooth-render') ? 'Yes' : 'No'}
                    </div>
                `;
                
                // Add event listeners
                const stretchXInput = document.getElementById('marble-stretch-x');
                const stretchYInput = document.getElementById('marble-stretch-y');
                const blurInput = document.getElementById('marble-blur');
                
                stretchXInput.addEventListener('input', (e) => {
                    const val = e.target.value;
                    document.getElementById('marble-stretch-x-value').textContent = val;
                    this.edit(el, { stretchX: val });
                });
                
                stretchYInput.addEventListener('input', (e) => {
                    const val = e.target.value;
                    document.getElementById('marble-stretch-y-value').textContent = val;
                    this.edit(el, { stretchY: val });
                });
                
                blurInput.addEventListener('input', (e) => {
                    const val = parseFloat(e.target.value);
                    document.getElementById('marble-blur-value').textContent = val.toFixed(2);
                    this.edit(el, { blur: val });
                });
                
                document.getElementById('marble-prev').addEventListener('click', () => {
                    currentIndex = (currentIndex - 1 + elements.length) % elements.length;
                    currentElement = elements[currentIndex];
                    updateControls(currentElement);
                });
                
                document.getElementById('marble-next').addEventListener('click', () => {
                    currentIndex = (currentIndex + 1) % elements.length;
                    currentElement = elements[currentIndex];
                    updateControls(currentElement);
                });
            };
            
            updateControls(currentElement);
            
            // Close button
            document.getElementById('marble-debug-close').addEventListener('click', () => {
                panel.remove();
            });
            
            // Load button
            document.getElementById('marble-debug-load').addEventListener('click', () => {
                const selector = document.getElementById('marble-debug-selector').value;
                const newElements = document.querySelectorAll(selector);
                if (newElements.length > 0) {
                    elements = newElements;
                    currentIndex = 0;
                    currentElement = elements[0];
                    updateControls(currentElement);
                } else {
                    alert('No elements found with that selector');
                }
            });
            
            // Reset button
            document.getElementById('marble-debug-reset').addEventListener('click', () => {
                this.reset();
                updateControls(currentElement);
            });
            
            // Export button
            document.getElementById('marble-debug-export').addEventListener('click', () => {
                const config = {
                    stretchX: parseFloat(currentElement.style.getPropertyValue('--marble-stretch-x')) || 100,
                    stretchY: parseFloat(currentElement.style.getPropertyValue('--marble-stretch-y')) || 100,
                    blur: parseFloat(currentElement.style.getPropertyValue('--marble-blur')) || 0
                };
                console.log('📋 Export Config:', config);
                console.log('💡 Use this in marbleConfig.js:');
                console.log(`thresholdX: ${config.stretchX}, thresholdY: ${config.stretchY}`);
                console.log(`blur formula: ${config.blur}px`);
            });
        },
        
        // Reset all marble configs to defaults
        reset: function() {
            const elements = document.querySelectorAll('.marble-bg');
            elements.forEach(el => {
                el.style.removeProperty('--marble-stretch-x');
                el.style.removeProperty('--marble-stretch-y');
                el.style.removeProperty('--marble-blur');
                el.classList.remove('marble-smooth-render');
            });
            console.log('✅ Reset all marble configs to defaults');
        },
        
        // Helper to get a useful selector for an element
        _getSelector: function(el) {
            if (el.id) return `#${el.id}`;
            if (el.className) {
                const classes = Array.from(el.classList).filter(c => !c.startsWith('marble-')).join('.');
                if (classes) return `.${classes}`;
            }
            return el.tagName.toLowerCase();
        }
    };
    
    // Make it globally available
    window.marbleDebug = marbleDebug;
    
    console.log('🎨 Marble Debug Tool loaded!');
    console.log('Available commands:');
    console.log('  marbleDebug.inspect()  - Show all marble configs');
    console.log('  marbleDebug.edit(selector, {stretchX, stretchY, blur})  - Edit an element');
    console.log('  marbleDebug.test()     - Open interactive test panel');
    console.log('  marbleDebug.reset()    - Reset all to defaults');
    console.log('\n💡 Try: marbleDebug.test() to open the interactive panel');
    
})();


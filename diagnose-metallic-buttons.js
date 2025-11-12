/**
 * Metallic Button Diagnostic Script
 * 
 * Run this in the browser console to diagnose why metallic button styles aren't applying.
 * Copy and paste the entire script into the console and press Enter.
 */

(function() {
    console.log('%c🔍 METALLIC BUTTON DIAGNOSTIC REPORT', 'font-size: 16px; font-weight: bold; color: #d4af37;');
    console.log('='.repeat(60));
    
    // 1. Find all buttons with btn-primary class
    const primaryButtons = document.querySelectorAll('.btn-primary, .btn.btn-primary, button.btn-primary');
    console.log(`\n📊 Found ${primaryButtons.length} button(s) with .btn-primary class`);
    
    if (primaryButtons.length === 0) {
        console.warn('⚠️  No buttons found with .btn-primary class!');
        console.log('Searching for any buttons with "btn" in class name...');
        const allButtons = document.querySelectorAll('button, .btn, [class*="btn"]');
        console.log(`Found ${allButtons.length} potential button elements:`);
        allButtons.forEach((btn, idx) => {
            console.log(`  ${idx + 1}. ${btn.tagName} with classes: ${btn.className || '(none)'}`);
        });
    }
    
    // 2. Check each button's computed styles
    primaryButtons.forEach((btn, idx) => {
        console.log(`\n${'='.repeat(60)}`);
        console.log(`🔘 BUTTON #${idx + 1}:`);
        console.log(`   Element:`, btn);
        console.log(`   Classes:`, btn.className);
        console.log(`   Tag:`, btn.tagName);
        console.log(`   HTML:`, btn.outerHTML.substring(0, 200));
        
        const computed = window.getComputedStyle(btn);
        
        // Check critical styles
        const criticalStyles = {
            'background': computed.background || computed.backgroundColor,
            'backgroundImage': computed.backgroundImage,
            'color': computed.color,
            'border': computed.border || computed.borderColor,
            'boxShadow': computed.boxShadow,
            'textShadow': computed.textShadow,
        };
        
        console.log(`\n   📋 COMPUTED STYLES:`);
        Object.entries(criticalStyles).forEach(([prop, value]) => {
            const isMetallic = 
                (prop === 'background' && (value.includes('gradient') || value.includes('linear-gradient'))) ||
                (prop === 'backgroundImage' && value.includes('gradient')) ||
                (prop === 'boxShadow' && value.includes('inset')) ||
                (prop === 'textShadow' && value !== 'none');
            
            const icon = isMetallic ? '✅' : '❌';
            console.log(`   ${icon} ${prop}:`, value);
        });
        
        // Check if CSS variables are resolving
        console.log(`\n   🎨 CSS VARIABLE VALUES:`);
        const root = document.documentElement;
        const vars = {
            '--gradient-metallic-raised': getComputedStyle(root).getPropertyValue('--gradient-metallic-raised'),
            '--gold-metallic-sheen': getComputedStyle(root).getPropertyValue('--gold-metallic-sheen'),
            '--gold-metallic-base': getComputedStyle(root).getPropertyValue('--gold-metallic-base'),
            '--gold-metallic-dark': getComputedStyle(root).getPropertyValue('--gold-metallic-dark'),
            '--shadow-metallic-raised': getComputedStyle(root).getPropertyValue('--shadow-metallic-raised'),
        };
        
        Object.entries(vars).forEach(([varName, value]) => {
            const exists = value && value.trim() !== '';
            const icon = exists ? '✅' : '❌';
            console.log(`   ${icon} ${varName}:`, exists ? value.substring(0, 100) : 'NOT DEFINED');
        });
        
        // Check for inline styles
        if (btn.style.cssText) {
            console.warn(`\n   ⚠️  INLINE STYLES DETECTED:`, btn.style.cssText);
        }
        
        // Check for style attribute
        if (btn.getAttribute('style')) {
            console.warn(`\n   ⚠️  STYLE ATTRIBUTE:`, btn.getAttribute('style'));
        }
    });
    
    // 3. Check if CSS rules are loaded
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📄 CSS FILE LOADING CHECK:`);
    
    const stylesheets = Array.from(document.styleSheets);
    let foundComponentsCSS = false;
    let foundGlobalCSS = false;
    
    stylesheets.forEach((sheet, idx) => {
        try {
            const href = sheet.href || 'inline';
            const isComponents = href.includes('components.css');
            const isGlobal = href.includes('global.css');
            
            if (isComponents) {
                foundComponentsCSS = true;
                console.log(`   ✅ Found components.css:`, href);
                
                // Try to find .btn-primary rule
                try {
                    const rules = Array.from(sheet.cssRules || sheet.rules || []);
                    const btnPrimaryRules = rules.filter(rule => 
                        rule.selectorText && rule.selectorText.includes('.btn-primary')
                    );
                    console.log(`      Found ${btnPrimaryRules.length} .btn-primary rule(s)`);
                    btnPrimaryRules.forEach((rule, rIdx) => {
                        console.log(`         Rule ${rIdx + 1}:`, rule.selectorText);
                        console.log(`         Styles:`, rule.style.cssText.substring(0, 150));
                    });
                } catch (e) {
                    console.warn(`      Could not read rules (CORS?):`, e.message);
                }
            }
            
            if (isGlobal) {
                foundGlobalCSS = true;
                console.log(`   ✅ Found global.css:`, href);
            }
        } catch (e) {
            // CORS error, skip
        }
    });
    
    if (!foundComponentsCSS) {
        console.error(`   ❌ components.css NOT FOUND in loaded stylesheets!`);
    }
    if (!foundGlobalCSS) {
        console.error(`   ❌ global.css NOT FOUND in loaded stylesheets!`);
    }
    
    // 4. Check CSS variable definitions in :root
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🎨 ROOT CSS VARIABLES CHECK:`);
    
    const root = document.documentElement;
    const rootStyles = getComputedStyle(root);
    
    const requiredVars = [
        '--gold-metallic-base',
        '--gold-metallic-light',
        '--gold-metallic-dark',
        '--gold-metallic-sheen',
        '--gold-metallic-gradient-light',
        '--gold-metallic-gradient-mid',
        '--gold-metallic-gradient-dark',
        '--gradient-metallic-raised',
        '--shadow-metallic-raised',
    ];
    
    requiredVars.forEach(varName => {
        const value = rootStyles.getPropertyValue(varName);
        const exists = value && value.trim() !== '';
        const icon = exists ? '✅' : '❌';
        const preview = exists ? value.substring(0, 80).replace(/\n/g, ' ') : 'MISSING';
        console.log(`   ${icon} ${varName}:`, preview);
    });
    
    // 5. Check for style overrides
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔍 CHECKING FOR STYLE OVERRIDES:`);
    
    primaryButtons.forEach((btn, idx) => {
        console.log(`\n   Button #${idx + 1}:`);
        
        // Check all matching rules
        const matchingRules = [];
        try {
            stylesheets.forEach(sheet => {
                try {
                    const rules = Array.from(sheet.cssRules || sheet.rules || []);
                    rules.forEach(rule => {
                        if (rule.selectorText) {
                            try {
                                if (btn.matches(rule.selectorText)) {
                                    matchingRules.push({
                                        selector: rule.selectorText,
                                        styles: rule.style.cssText,
                                        sheet: sheet.href || 'inline'
                                    });
                                }
                            } catch (e) {
                                // Invalid selector, skip
                            }
                        }
                    });
                } catch (e) {
                    // CORS or other error
                }
            });
            
            console.log(`      Found ${matchingRules.length} matching CSS rules`);
            matchingRules.slice(-5).forEach((rule, rIdx) => {
                console.log(`         ${rIdx + 1}. ${rule.selector} (from ${rule.sheet.split('/').pop()})`);
                if (rule.styles.includes('background') || rule.styles.includes('gradient')) {
                    console.log(`            ⚠️  Contains background/gradient rules`);
                }
            });
        } catch (e) {
            console.warn(`      Could not check rules:`, e.message);
        }
    });
    
    // 6. Test if we can manually apply styles
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🧪 MANUAL STYLE TEST:`);
    
    if (primaryButtons.length > 0) {
        const testBtn = primaryButtons[0];
        const originalStyle = testBtn.style.cssText;
        
        console.log(`   Testing on first button...`);
        testBtn.style.background = 'linear-gradient(160deg, #f8e7b9 0%, #c9a442 50%, #7d6221 100%)';
        testBtn.style.boxShadow = 'inset 0 2px 3px rgba(255,255,255,0.25), inset 0 -2px 3px rgba(0,0,0,0.3)';
        testBtn.style.textShadow = '0 1px 0 #7d6221, 0 2px 2px rgba(0,0,0,0.25)';
        
        console.log(`   ✅ Applied test styles - does the button look metallic now?`);
        console.log(`   (Original styles saved, will restore on next check)`);
        
        // Restore after 3 seconds
        setTimeout(() => {
            testBtn.style.cssText = originalStyle;
            console.log(`   🔄 Restored original styles`);
        }, 3000);
    }
    
    // 7. Summary
    console.log(`\n${'='.repeat(60)}`);
    console.log(`📊 SUMMARY:`);
    
    const issues = [];
    
    if (primaryButtons.length === 0) {
        issues.push('❌ No buttons with .btn-primary class found');
    }
    
    if (!foundComponentsCSS) {
        issues.push('❌ components.css not loaded');
    }
    
    if (!foundGlobalCSS) {
        issues.push('❌ global.css not loaded');
    }
    
    const missingVars = requiredVars.filter(varName => {
        const value = rootStyles.getPropertyValue(varName);
        return !value || value.trim() === '';
    });
    
    if (missingVars.length > 0) {
        issues.push(`❌ Missing CSS variables: ${missingVars.join(', ')}`);
    }
    
    if (issues.length === 0) {
        console.log(`   ✅ All checks passed!`);
        console.log(`   If buttons still don't look metallic, check:`);
        console.log(`      1. Browser cache (hard refresh: Ctrl+Shift+R)`);
        console.log(`      2. CSS specificity conflicts`);
        console.log(`      3. Inline styles on button elements`);
    } else {
        console.log(`   ⚠️  Issues found:`);
        issues.forEach(issue => console.log(`      ${issue}`));
    }
    
    console.log(`\n${'='.repeat(60)}`);
    console.log(`💡 TIP: Copy this entire output and share it for debugging.`);
    
    // Return data for programmatic access
    return {
        buttonCount: primaryButtons.length,
        buttons: Array.from(primaryButtons).map(btn => ({
            element: btn,
            classes: btn.className,
            computedStyles: {
                background: getComputedStyle(btn).background,
                boxShadow: getComputedStyle(btn).boxShadow,
                textShadow: getComputedStyle(btn).textShadow,
            }
        })),
        cssVariables: requiredVars.reduce((acc, varName) => {
            acc[varName] = rootStyles.getPropertyValue(varName);
            return acc;
        }, {}),
        stylesheetsLoaded: {
            components: foundComponentsCSS,
            global: foundGlobalCSS
        }
    };
})();


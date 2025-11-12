/**
 * Horizontal Scroll Diagnostic Script
 * 
 * Run this in the browser console to identify what's causing horizontal scrolling.
 * Copy and paste the entire script into the console and press Enter.
 */

(function() {
    console.log('%c🔍 HORIZONTAL SCROLL DIAGNOSTIC', 'font-size: 16px; font-weight: bold; color: #ff6b6b;');
    console.log('='.repeat(60));
    
    const results = {
        viewport: {},
        document: {},
        problematicElements: [],
        fixedElements: [],
        themeToggle: null,
        recommendations: []
    };
    
    // 1. Viewport vs Document dimensions
    results.viewport = {
        width: window.innerWidth,
        height: window.innerHeight,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        clientWidth: document.documentElement.clientWidth,
        clientHeight: document.documentElement.clientHeight
    };
    
    results.document = {
        bodyWidth: document.body.offsetWidth,
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        htmlWidth: document.documentElement.offsetWidth,
        htmlScrollWidth: document.documentElement.scrollWidth
    };
    
    // 2. Check for horizontal overflow
    const hasHorizontalScroll = document.documentElement.scrollWidth > window.innerWidth;
    const overflowAmount = document.documentElement.scrollWidth - window.innerWidth;
    
    console.log('\n📐 VIEWPORT vs DOCUMENT:');
    console.log(`  Viewport Width: ${results.viewport.width}px`);
    console.log(`  Document Scroll Width: ${results.viewport.scrollWidth}px`);
    console.log(`  Overflow: ${hasHorizontalScroll ? `⚠️ ${overflowAmount}px` : '✅ None'}`);
    
    // 3. Find elements that exceed viewport width
    const allElements = document.querySelectorAll('*');
    allElements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const styles = window.getComputedStyle(el);
        const rightEdge = rect.right;
        const leftEdge = rect.left;
        const width = rect.width;
        
        // Check if element extends beyond viewport
        if (rightEdge > window.innerWidth || leftEdge < 0) {
            const info = {
                element: el,
                tag: el.tagName,
                id: el.id || '(no id)',
                classes: el.className || '(no classes)',
                rightEdge: Math.round(rightEdge),
                leftEdge: Math.round(leftEdge),
                width: Math.round(width),
                overflow: rightEdge > window.innerWidth ? Math.round(rightEdge - window.innerWidth) : 0,
                position: styles.position,
                display: styles.display,
                widthStyle: styles.width,
                maxWidth: styles.maxWidth,
                minWidth: styles.minWidth,
                right: styles.right,
                left: styles.left,
                marginRight: styles.marginRight,
                paddingRight: styles.paddingRight
            };
            
            results.problematicElements.push(info);
        }
        
        // Check fixed positioned elements
        if (styles.position === 'fixed') {
            const fixedInfo = {
                element: el,
                tag: el.tagName,
                id: el.id || '(no id)',
                classes: el.className || '(no classes)',
                right: styles.right,
                left: styles.left,
                top: styles.top,
                bottom: styles.bottom,
                width: styles.width,
                maxWidth: styles.maxWidth,
                rightEdge: Math.round(rect.right),
                viewportWidth: window.innerWidth,
                exceedsViewport: rect.right > window.innerWidth
            };
            
            results.fixedElements.push(fixedInfo);
        }
    });
    
    // 4. Check theme toggle specifically
    const themeToggle = document.querySelector('.theme-toggle-wrapper');
    if (themeToggle) {
        const toggleRect = themeToggle.getBoundingClientRect();
        const toggleStyles = window.getComputedStyle(themeToggle);
        results.themeToggle = {
            exists: true,
            rightEdge: Math.round(toggleRect.right),
            leftEdge: Math.round(toggleRect.left),
            width: Math.round(toggleRect.width),
            height: Math.round(toggleRect.height),
            position: toggleStyles.position,
            right: toggleStyles.right,
            left: toggleStyles.left,
            widthStyle: toggleStyles.width,
            maxWidth: toggleStyles.maxWidth,
            exceedsViewport: toggleRect.right > window.innerWidth,
            overflow: toggleRect.right > window.innerWidth ? Math.round(toggleRect.right - window.innerWidth) : 0
        };
    } else {
        results.themeToggle = { exists: false };
    }
    
    // 5. Check for elements with explicit widths that might be problematic
    const wideElements = [];
    allElements.forEach(el => {
        const styles = window.getComputedStyle(el);
        const width = styles.width;
        const maxWidth = styles.maxWidth;
        const minWidth = styles.minWidth;
        
        // Check for viewport units or large fixed widths
        if (width.includes('vw') || width.includes('px') && parseInt(width) > window.innerWidth) {
            const rect = el.getBoundingClientRect();
            wideElements.push({
                element: el,
                tag: el.tagName,
                id: el.id || '(no id)',
                classes: el.className || '(no classes)',
                width: width,
                maxWidth: maxWidth,
                minWidth: minWidth,
                actualWidth: Math.round(rect.width),
                rightEdge: Math.round(rect.right)
            });
        }
    });
    
    // 6. Generate recommendations
    if (hasHorizontalScroll) {
        results.recommendations.push(`Document is ${overflowAmount}px wider than viewport`);
    }
    
    if (results.problematicElements.length > 0) {
        results.recommendations.push(`Found ${results.problematicElements.length} elements extending beyond viewport`);
    }
    
    if (results.themeToggle && results.themeToggle.exceedsViewport) {
        results.recommendations.push(`Theme toggle extends ${results.themeToggle.overflow}px beyond viewport`);
    }
    
    // OUTPUT RESULTS
    console.log('\n🎯 THEME TOGGLE ANALYSIS:');
    if (results.themeToggle.exists) {
        console.log(`  Position: ${results.themeToggle.position}`);
        console.log(`  Right: ${results.themeToggle.right}`);
        console.log(`  Width: ${results.themeToggle.widthStyle} (actual: ${results.themeToggle.width}px)`);
        console.log(`  Max-Width: ${results.themeToggle.maxWidth}`);
        console.log(`  Right Edge: ${results.themeToggle.rightEdge}px`);
        console.log(`  Viewport Width: ${window.innerWidth}px`);
        console.log(`  ${results.themeToggle.exceedsViewport ? `⚠️ EXCEEDS by ${results.themeToggle.overflow}px` : '✅ Within viewport'}`);
    } else {
        console.log('  ❌ Theme toggle not found');
    }
    
    console.log('\n📌 FIXED POSITIONED ELEMENTS:');
    if (results.fixedElements.length > 0) {
        results.fixedElements.forEach((fixed, idx) => {
            console.log(`\n  ${idx + 1}. ${fixed.tag}${fixed.id ? '#' + fixed.id : ''}${fixed.classes ? '.' + fixed.classes.split(' ').join('.') : ''}`);
            console.log(`     Right: ${fixed.right}, Left: ${fixed.left}`);
            console.log(`     Width: ${fixed.width}, Max-Width: ${fixed.maxWidth}`);
            console.log(`     Right Edge: ${fixed.rightEdge}px`);
            console.log(`     ${fixed.exceedsViewport ? '⚠️ EXCEEDS VIEWPORT' : '✅ OK'}`);
        });
    } else {
        console.log('  ✅ No fixed elements found');
    }
    
    console.log('\n🚨 PROBLEMATIC ELEMENTS (extending beyond viewport):');
    if (results.problematicElements.length > 0) {
        // Sort by overflow amount (largest first)
        results.problematicElements.sort((a, b) => b.overflow - a.overflow);
        
        results.problematicElements.slice(0, 10).forEach((el, idx) => {
            console.log(`\n  ${idx + 1}. ${el.tag}${el.id ? '#' + el.id : ''}${el.classes ? '.' + el.classes.split(' ').slice(0, 2).join('.') : ''}`);
            console.log(`     Position: ${el.position}, Display: ${el.display}`);
            console.log(`     Width: ${el.width}px, Right Edge: ${el.rightEdge}px`);
            console.log(`     CSS Width: ${el.widthStyle}, Max-Width: ${el.maxWidth}`);
            console.log(`     CSS Right: ${el.right}, Margin-Right: ${el.marginRight}`);
            console.log(`     ⚠️ Overflows by: ${el.overflow}px`);
        });
        
        if (results.problematicElements.length > 10) {
            console.log(`\n  ... and ${results.problematicElements.length - 10} more elements`);
        }
    } else {
        console.log('  ✅ No elements extending beyond viewport found');
    }
    
    console.log('\n💡 RECOMMENDATIONS:');
    if (results.recommendations.length > 0) {
        results.recommendations.forEach((rec, idx) => {
            console.log(`  ${idx + 1}. ${rec}`);
        });
    } else {
        console.log('  ✅ No issues detected');
    }
    
    // 7. Quick fix suggestions
    console.log('\n🔧 QUICK FIXES TO TRY:');
    console.log('  1. Add to body: overflow-x: hidden; width: 100%; max-width: 100%;');
    console.log('  2. Add to html: overflow-x: hidden; width: 100%; max-width: 100%;');
    console.log('  3. Check theme toggle: right should be small value (0.75rem), not calc()');
    console.log('  4. Ensure all fixed elements have right/left values that keep them within viewport');
    
    console.log('\n' + '='.repeat(60));
    console.log('✅ Diagnostic complete! Check the output above for issues.');
    
    // Return results object for further inspection
    return results;
})();


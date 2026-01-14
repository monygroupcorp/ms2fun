#!/usr/bin/env node

/**
 * Analyze Missing Functions by Category
 *
 * Categorizes missing ABI functions to identify which ones are
 * critical for frontend functionality vs low-priority.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// Load the coverage report
const reportPath = path.join(ROOT_DIR, 'ABI_COVERAGE_REPORT.json');
const report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));

// Function categories
const CATEGORIES = {
    OWNERSHIP: {
        name: 'Ownership/Admin',
        priority: 'LOW',
        patterns: [
            /^(transfer|renounce|request|cancel|complete)Ownership/i,
            /^ownershipHandover/i,
            /^owner$/i
        ]
    },
    TOKEN_OPERATIONS: {
        name: 'Direct Token Operations',
        priority: 'LOW',
        patterns: [
            /^(approve|transfer|transferFrom|allowance|balanceOf)$/i,
            /^setApprovalForAll$/i,
            /^isApprovedForAll$/i
        ]
    },
    INITIALIZATION: {
        name: 'Initialization/Upgrade',
        priority: 'LOW',
        patterns: [
            /^initialize$/i,
            /^upgradeToAndCall$/i,
            /^proxiableUUID$/i
        ]
    },
    PUBLIC_CONSTANTS: {
        name: 'Public Constants/Variables',
        priority: 'MEDIUM',
        patterns: [
            /^[A-Z_]+$/,  // All caps (constants)
            /^(master|global|factory|vault|weth|exec|pool|router)$/i,
            /Registry$/i,
            /Manager$/i,
            /Template$/i
        ]
    },
    VIEW_FUNCTIONS: {
        name: 'View/Query Functions',
        priority: 'HIGH',
        patterns: [
            /^get[A-Z]/,
            /^is[A-Z]/,
            /^has[A-Z]/,
            /^calculate[A-Z]/,
            /^validate[A-Z]/,
            /Info$/,
            /Count$/,
            /List$/,
            /Balance$/,
            /Status$/
        ]
    },
    WRITE_FUNCTIONS: {
        name: 'State-Changing Functions',
        priority: 'HIGH',
        patterns: [
            /^(set|add|remove|update|register|deactivate|enable|disable)[A-Z]/,
            /^(buy|sell|mint|burn|stake|unstake|claim|deposit|withdraw)[A-Z]?/i,
            /^(apply|submit|vote|challenge|finalize)[A-Z]/
        ]
    },
    CALLBACK_HOOKS: {
        name: 'Callbacks/Hooks',
        priority: 'LOW',
        patterns: [
            /Callback$/i,
            /Hook$/i,
            /^receive[A-Z]/,
            /^on[A-Z]/
        ]
    }
};

/**
 * Categorize a function
 */
function categorizeFunction(funcName) {
    for (const [key, category] of Object.entries(CATEGORIES)) {
        for (const pattern of category.patterns) {
            if (pattern.test(funcName)) {
                return {
                    category: category.name,
                    priority: category.priority,
                    key
                };
            }
        }
    }

    // Default: business logic
    return {
        category: 'Business Logic',
        priority: 'HIGH',
        key: 'BUSINESS_LOGIC'
    };
}

/**
 * Analyze missing functions for a contract
 */
function analyzeMissingFunctions(contractResult) {
    const analysis = {
        contractName: contractResult.abiFile.replace('.json', ''),
        totalMissing: contractResult.missing.length,
        byCategory: {},
        byPriority: {
            HIGH: [],
            MEDIUM: [],
            LOW: []
        }
    };

    // Categorize each missing function
    for (const funcName of contractResult.missing) {
        const categorization = categorizeFunction(funcName);

        // Add to category
        if (!analysis.byCategory[categorization.category]) {
            analysis.byCategory[categorization.category] = [];
        }
        analysis.byCategory[categorization.category].push(funcName);

        // Add to priority
        analysis.byPriority[categorization.priority].push({
            name: funcName,
            category: categorization.category
        });
    }

    return analysis;
}

/**
 * Generate priority report
 */
function generatePriorityReport() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         Missing Functions Priority Analysis                   ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const allAnalysis = [];
    let totalHigh = 0;
    let totalMedium = 0;
    let totalLow = 0;

    // Analyze each contract
    for (const result of report.results) {
        if (result.missing.length > 0) {
            const analysis = analyzeMissingFunctions(result);
            allAnalysis.push(analysis);

            totalHigh += analysis.byPriority.HIGH.length;
            totalMedium += analysis.byPriority.MEDIUM.length;
            totalLow += analysis.byPriority.LOW.length;
        }
    }

    // Summary table
    console.log('┌─────────────────────────────────────────────┬──────┬───────┬────────┬─────┐');
    console.log('│ Contract                                    │ Total│  HIGH │ MEDIUM │ LOW │');
    console.log('├─────────────────────────────────────────────┼──────┼───────┼────────┼─────┤');

    for (const analysis of allAnalysis) {
        const name = analysis.contractName.padEnd(43);
        const total = String(analysis.totalMissing).padStart(5);
        const high = String(analysis.byPriority.HIGH.length).padStart(6);
        const medium = String(analysis.byPriority.MEDIUM.length).padStart(7);
        const low = String(analysis.byPriority.LOW.length).padStart(4);

        console.log(`│ ${name} │ ${total} │ ${high} │ ${medium} │ ${low} │`);
    }

    console.log('├─────────────────────────────────────────────┼──────┼───────┼────────┼─────┤');
    const totalLine = 'TOTAL'.padEnd(43);
    const totalAll = String(totalHigh + totalMedium + totalLow).padStart(5);
    const highStr = String(totalHigh).padStart(6);
    const mediumStr = String(totalMedium).padStart(7);
    const lowStr = String(totalLow).padStart(4);
    console.log(`│ ${totalLine} │ ${totalAll} │ ${highStr} │ ${mediumStr} │ ${lowStr} │`);
    console.log('└─────────────────────────────────────────────┴──────┴───────┴────────┴─────┘\n');

    // Detailed breakdown by contract
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log('DETAILED BREAKDOWN BY PRIORITY\n');

    for (const analysis of allAnalysis) {
        console.log(`\n━━━ ${analysis.contractName} ━━━\n`);

        // HIGH priority
        if (analysis.byPriority.HIGH.length > 0) {
            console.log(`  🔴 HIGH PRIORITY (${analysis.byPriority.HIGH.length}):`);
            const grouped = {};
            for (const func of analysis.byPriority.HIGH) {
                if (!grouped[func.category]) grouped[func.category] = [];
                grouped[func.category].push(func.name);
            }
            for (const [category, funcs] of Object.entries(grouped)) {
                console.log(`    ${category}:`);
                for (const func of funcs) {
                    console.log(`      - ${func}`);
                }
            }
        }

        // MEDIUM priority
        if (analysis.byPriority.MEDIUM.length > 0) {
            console.log(`\n  🟡 MEDIUM PRIORITY (${analysis.byPriority.MEDIUM.length}):`);
            for (const func of analysis.byPriority.MEDIUM) {
                console.log(`      - ${func.name}`);
            }
        }

        // LOW priority
        if (analysis.byPriority.LOW.length > 0) {
            console.log(`\n  🟢 LOW PRIORITY (${analysis.byPriority.LOW.length}):`);
            const lowCats = {};
            for (const func of analysis.byPriority.LOW) {
                if (!lowCats[func.category]) lowCats[func.category] = [];
                lowCats[func.category].push(func.name);
            }
            for (const [category, funcs] of Object.entries(lowCats)) {
                console.log(`    ${category}: ${funcs.length} functions`);
            }
        }
    }

    // Recommendations
    console.log('\n═══════════════════════════════════════════════════════════════════\n');
    console.log('RECOMMENDATIONS\n');

    console.log(`📊 Total Missing: ${totalHigh + totalMedium + totalLow} functions\n`);
    console.log(`   🔴 HIGH Priority:   ${totalHigh} functions (${((totalHigh / (totalHigh + totalMedium + totalLow)) * 100).toFixed(1)}%)`);
    console.log(`      → Core business logic, view functions, state-changing operations`);
    console.log(`      → These are CRITICAL for frontend functionality\n`);

    console.log(`   🟡 MEDIUM Priority: ${totalMedium} functions (${((totalMedium / (totalHigh + totalMedium + totalLow)) * 100).toFixed(1)}%)`);
    console.log(`      → Public constants and configuration getters`);
    console.log(`      → Useful but can be accessed directly via contract reads\n`);

    console.log(`   🟢 LOW Priority:    ${totalLow} functions (${((totalLow / (totalHigh + totalMedium + totalLow)) * 100).toFixed(1)}%)`);
    console.log(`      → Ownership, initialization, token operations, callbacks`);
    console.log(`      → Can be skipped (handled by wallets/admin tools)\n`);

    console.log('💡 Suggested Approach:\n');
    console.log('   1. Focus on HIGH priority functions first (critical for user features)');
    console.log('   2. Add MEDIUM priority as needed for specific UI requirements');
    console.log('   3. Skip LOW priority unless specifically required\n');

    console.log('📝 Next Steps:\n');
    console.log('   1. Review HIGH priority functions in detail');
    console.log('   2. Prioritize by user role (Visitor, Creator, Benefactor, Admin)');
    console.log('   3. Implement adapters batch by batch with testing\n');

    // Save detailed analysis
    const analysisPath = path.join(ROOT_DIR, 'MISSING_FUNCTIONS_ANALYSIS.json');
    fs.writeFileSync(analysisPath, JSON.stringify({
        summary: {
            totalMissing: totalHigh + totalMedium + totalLow,
            high: totalHigh,
            medium: totalMedium,
            low: totalLow
        },
        contracts: allAnalysis
    }, null, 2));

    console.log(`📄 Detailed analysis saved to: ${analysisPath}\n`);
}

// Run analysis
try {
    generatePriorityReport();
} catch (error) {
    console.error('Error generating priority report:', error);
    process.exit(1);
}

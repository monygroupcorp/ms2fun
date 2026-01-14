#!/usr/bin/env node

/**
 * ABI Coverage Verification Script
 *
 * Analyzes all contract ABIs and their corresponding adapters to verify
 * that all contract functions are properly exposed through adapter methods.
 *
 * Usage: node scripts/verify-abi-coverage.js
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');

// ABI to Adapter mapping
const ABI_ADAPTER_MAP = {
    'MasterRegistryV1.json': 'MasterRegistryAdapter.js',
    'GlobalMessageRegistry.json': 'GlobalMessageRegistryAdapter.js',
    'ERC404BondingInstance.json': 'ERC404BondingInstanceAdapter.js',
    'ERC404Factory.json': 'ERC404FactoryAdapter.js',
    'ERC1155Instance.json': 'ERC1155Adapter.js',
    'ERC1155Factory.json': 'ERC1155FactoryAdapter.js',
    'UltraAlignmentVault.json': 'UltraAlignmentVaultAdapter.js',
    'FactoryApprovalGovernance.json': 'GovernanceAdapter.js',
    'VaultApprovalGovernance.json': 'GovernanceAdapter.js'
};

/**
 * Extract all function names from an ABI
 * @param {Array} abi - Contract ABI
 * @returns {Object} Categorized functions
 */
function extractABIFunctions(abi) {
    const functions = {
        view: [],
        pure: [],
        write: [],
        payable: []
    };

    for (const item of abi) {
        if (item.type === 'function') {
            const funcName = item.name;
            const stateMutability = item.stateMutability;

            if (stateMutability === 'view') {
                functions.view.push(funcName);
            } else if (stateMutability === 'pure') {
                functions.pure.push(funcName);
            } else if (stateMutability === 'payable') {
                functions.payable.push(funcName);
            } else {
                functions.write.push(funcName);
            }
        }
    }

    return functions;
}

/**
 * Extract all method names from an adapter file
 * @param {string} adapterPath - Path to adapter file
 * @returns {Array<string>} Array of method names
 */
function extractAdapterMethods(adapterPath) {
    const content = fs.readFileSync(adapterPath, 'utf-8');
    const methods = [];

    // Match async methods: async methodName(
    const asyncMethodRegex = /async\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\(/g;
    let match;
    while ((match = asyncMethodRegex.exec(content)) !== null) {
        const methodName = match[1];
        // Exclude constructor, initialize, and private methods (starting with _)
        if (methodName !== 'constructor' && methodName !== 'initialize' && !methodName.startsWith('_')) {
            methods.push(methodName);
        }
    }

    // Match regular methods: methodName(
    // But be careful not to match function calls
    const methodRegex = /^\s+([a-zA-Z_$][a-zA-Z0-9_$]*)\s*\([^)]*\)\s*\{/gm;
    while ((match = methodRegex.exec(content)) !== null) {
        const methodName = match[1];
        if (methodName !== 'constructor' && !methodName.startsWith('_') && !methods.includes(methodName)) {
            methods.push(methodName);
        }
    }

    return [...new Set(methods)].sort();
}

/**
 * Convert ABI function name to expected adapter method name
 * @param {string} functionName - ABI function name
 * @returns {string} Expected adapter method name
 */
function toAdapterMethodName(functionName) {
    // Most ABI functions are already camelCase
    // But handle some special cases if needed
    return functionName;
}

/**
 * Analyze coverage for a single contract
 * @param {string} abiFile - ABI filename
 * @param {string} adapterFile - Adapter filename
 * @returns {Object} Coverage analysis
 */
function analyzeCoverage(abiFile, adapterFile) {
    const abiPath = path.join(ROOT_DIR, 'contracts', 'abi', abiFile);
    const adapterPath = path.join(ROOT_DIR, 'src', 'services', 'contracts', adapterFile);

    // Load ABI
    const abi = JSON.parse(fs.readFileSync(abiPath, 'utf-8'));
    const abiFunctions = extractABIFunctions(abi);

    // Load adapter methods
    const adapterMethods = extractAdapterMethods(adapterPath);

    // Calculate coverage
    const allAbiFunctions = [
        ...abiFunctions.view,
        ...abiFunctions.pure,
        ...abiFunctions.write,
        ...abiFunctions.payable
    ];

    const covered = [];
    const missing = [];

    for (const funcName of allAbiFunctions) {
        const expectedMethodName = toAdapterMethodName(funcName);
        if (adapterMethods.includes(expectedMethodName)) {
            covered.push(funcName);
        } else {
            missing.push(funcName);
        }
    }

    return {
        abiFile,
        adapterFile,
        functions: abiFunctions,
        adapterMethods,
        totalFunctions: allAbiFunctions.length,
        coveredFunctions: covered.length,
        missingFunctions: missing.length,
        covered,
        missing,
        coveragePercent: allAbiFunctions.length > 0
            ? ((covered.length / allAbiFunctions.length) * 100).toFixed(2)
            : 0
    };
}

/**
 * Generate coverage report
 */
function generateReport() {
    console.log('╔════════════════════════════════════════════════════════════════╗');
    console.log('║         ABI Coverage Verification Report                      ║');
    console.log('╚════════════════════════════════════════════════════════════════╝\n');

    const results = [];
    let totalFunctions = 0;
    let totalCovered = 0;
    let totalMissing = 0;

    // Analyze each ABI-Adapter pair
    for (const [abiFile, adapterFile] of Object.entries(ABI_ADAPTER_MAP)) {
        const analysis = analyzeCoverage(abiFile, adapterFile);
        results.push(analysis);

        totalFunctions += analysis.totalFunctions;
        totalCovered += analysis.coveredFunctions;
        totalMissing += analysis.missingFunctions;
    }

    // Print summary table
    console.log('┌─────────────────────────────────────────────┬──────┬──────┬──────┬─────────┐');
    console.log('│ Contract                                    │ Total│ Cover│ Miss │ Coverage│');
    console.log('├─────────────────────────────────────────────┼──────┼──────┼──────┼─────────┤');

    for (const result of results) {
        const contractName = result.abiFile.replace('.json', '').padEnd(43);
        const total = String(result.totalFunctions).padStart(5);
        const covered = String(result.coveredFunctions).padStart(5);
        const missing = String(result.missingFunctions).padStart(5);
        const percent = String(result.coveragePercent + '%').padStart(8);

        console.log(`│ ${contractName} │ ${total} │ ${covered} │ ${missing} │ ${percent} │`);
    }

    console.log('├─────────────────────────────────────────────┼──────┼──────┼──────┼─────────┤');
    const totalPercent = totalFunctions > 0
        ? ((totalCovered / totalFunctions) * 100).toFixed(2)
        : 0;
    console.log(`│ ${'TOTAL'.padEnd(43)} │ ${String(totalFunctions).padStart(5)} │ ${String(totalCovered).padStart(5)} │ ${String(totalMissing).padStart(5)} │ ${String(totalPercent + '%').padStart(8)} │`);
    console.log('└─────────────────────────────────────────────┴──────┴──────┴──────┴─────────┘\n');

    // Detailed breakdown
    console.log('═══════════════════════════════════════════════════════════════════\n');
    console.log('DETAILED BREAKDOWN\n');

    for (const result of results) {
        console.log(`\n━━━ ${result.abiFile.replace('.json', '')} ━━━`);
        console.log(`Adapter: ${result.adapterFile}`);
        console.log(`Coverage: ${result.coveragePercent}% (${result.coveredFunctions}/${result.totalFunctions})`);

        console.log(`\n  Functions by Type:`);
        console.log(`    View:    ${result.functions.view.length}`);
        console.log(`    Pure:    ${result.functions.pure.length}`);
        console.log(`    Write:   ${result.functions.write.length}`);
        console.log(`    Payable: ${result.functions.payable.length}`);

        if (result.missing.length > 0) {
            console.log(`\n  ⚠️  Missing Functions (${result.missing.length}):`);
            for (const func of result.missing) {
                console.log(`    - ${func}`);
            }
        } else {
            console.log(`\n  ✅ All functions covered!`);
        }

        console.log(`\n  Adapter Methods (${result.adapterMethods.length}):`);
        const methodsPreview = result.adapterMethods.slice(0, 10);
        for (const method of methodsPreview) {
            const isCovered = result.covered.includes(method);
            const marker = isCovered ? '✓' : ' ';
            console.log(`    ${marker} ${method}`);
        }
        if (result.adapterMethods.length > 10) {
            console.log(`    ... and ${result.adapterMethods.length - 10} more`);
        }
    }

    console.log('\n═══════════════════════════════════════════════════════════════════\n');

    // Final summary
    if (totalMissing === 0) {
        console.log('🎉 SUCCESS: All ABI functions are covered by adapters!');
        console.log(`   Total: ${totalFunctions} functions across ${results.length} contracts`);
    } else {
        console.log(`⚠️  GAPS FOUND: ${totalMissing} functions are not covered`);
        console.log(`   Covered: ${totalCovered}/${totalFunctions} (${totalPercent}%)`);
    }

    console.log('\n');

    return {
        results,
        summary: {
            totalContracts: results.length,
            totalFunctions,
            totalCovered,
            totalMissing,
            coveragePercent: totalPercent
        }
    };
}

// Run the report
try {
    const report = generateReport();

    // Write detailed JSON report
    const reportPath = path.join(ROOT_DIR, 'ABI_COVERAGE_REPORT.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`📄 Detailed report saved to: ${reportPath}\n`);
} catch (error) {
    console.error('Error generating coverage report:', error);
    process.exit(1);
}

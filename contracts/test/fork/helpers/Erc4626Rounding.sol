// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// The most a single real ERC-4626 conversion can round away, in wei.
//
// One wei, and it always rounds DOWN, toward the vault. Aave's static aToken is an ERC-4626 wrapper, so
// every deposit, redeem and `convertToAssets` on a path through it floors once. The mocks these suites
// were originally written against returned round numbers and hid that entirely.
//
// Count the conversions a figure passed through and multiply: a tolerance that does not say which
// conversions it covers is indistinguishable from one picked to make a test green. A deposit read back
// through `maxWithdraw` or `convertToAssets` has crossed TWO — the mint and the valuation — and so bounds
// at `2 * ERC4626_FLOOR_WEI`.
//
// A bound is only safe in the direction the rounding goes, so every use asserts that direction separately
// from this magnitude. The direction is what carries the safety — a position reading ABOVE what was put in
// is value that never arrived — while the magnitude only keeps a test from passing on a figure that
// collapsed to nothing.
//
// File-level, and plain comments rather than natspec, which solc rejects on a file-level variable. It lives
// here so the suites that share this token share ONE spelling of the bound: widening it here widens it
// everywhere, whereas a second copy drifts from the first and then means nothing.
uint256 constant ERC4626_FLOOR_WEI = 1;

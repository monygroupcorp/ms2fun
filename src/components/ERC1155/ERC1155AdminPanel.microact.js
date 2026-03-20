/**
 * ERC1155AdminPanel - Microact Version
 *
 * Admin controls panel for project owners.
 * Exposes ALL owner-facing contract operations:
 *   - createEdition, withdraw, claimVaultFees, setStyle,
 *     setEditionStyle (via per-edition controls), transferOwnership, renounceOwnership
 * Hidden by default, revealed via DOM when ownership is confirmed.
 */

import { Component, h, eventBus } from '../../core/microact-setup.js';
import { ethers } from 'https://cdnjs.cloudflare.com/ajax/libs/ethers/5.2.0/ethers.esm.js';
import { StyleBuilder } from '../shared/StyleBuilder.microact.js';

export class ERC1155AdminPanel extends Component {
    constructor(props = {}) {
        super(props);
        this.state = {
            totalRevenue: '0',
            withdrawable: '0',
            vaultContributed: '0',
            withdrawing: false,
            error: null
        };
    }

    get adapter() {
        return this.props.adapter;
    }

    async didMount() {
        await this.loadStats();

        const unsub1 = eventBus.on('erc1155:withdraw', () => this.loadStats());
        const unsub2 = eventBus.on('erc1155:edition:created', () => this.loadStats());
        const unsub3 = eventBus.on('erc1155:mint:success', () => this.loadStats());
        this.registerCleanup(() => { unsub1(); unsub2(); unsub3(); });
    }

    shouldUpdate() {
        return false;
    }

    // ── Stats ──

    async loadStats() {
        if (!this.adapter) return;

        try {
            const [totalProceedsWei, withdrawableWei] = await Promise.all([
                this.adapter.getTotalProceeds(),
                this.adapter.getWithdrawableBalance()
            ]);

            const totalRevenue = parseFloat(ethers.utils.formatEther(totalProceedsWei));
            const withdrawable = parseFloat(ethers.utils.formatEther(withdrawableWei));
            const vaultContributed = totalRevenue * 0.19;

            this.updateStatsDOM({
                totalRevenue: totalRevenue < 0.01 && totalRevenue > 0
                    ? totalRevenue.toFixed(4) : totalRevenue.toFixed(2),
                withdrawable: withdrawable < 0.01 && withdrawable > 0
                    ? withdrawable.toFixed(4) : withdrawable.toFixed(2),
                vaultContributed: vaultContributed < 0.01 && vaultContributed > 0
                    ? vaultContributed.toFixed(4) : vaultContributed.toFixed(2)
            });
        } catch (error) {
            console.warn('[ERC1155AdminPanel] Failed to load stats:', error);
        }
    }

    updateStatsDOM(stats) {
        if (!this._el) return;
        const setValue = (sel, val) => {
            const n = this._el.querySelector(sel);
            if (n) n.textContent = `${val} ETH`;
        };
        setValue('[data-admin-stat="revenue"]', stats.totalRevenue);
        setValue('[data-admin-stat="withdrawable"]', stats.withdrawable);
        setValue('[data-admin-stat="vault"]', stats.vaultContributed);
    }

    // ── Actions ──

    handleCreateEdition() {
        eventBus.emit('erc1155:admin:create-edition');
    }

    async handleWithdraw() {
        if (!this.adapter || this.state.withdrawing) return;
        const btn = this._el?.querySelector('[data-action="withdraw"]');

        try {
            this.state.withdrawing = true;
            if (btn) btn.textContent = 'Withdrawing...';

            const withdrawableWei = await this.adapter.getWithdrawableBalance();
            if (withdrawableWei === '0') {
                if (btn) btn.textContent = 'Nothing to withdraw';
                setTimeout(() => { if (btn) btn.textContent = 'Withdraw Earnings'; }, 2000);
                this.state.withdrawing = false;
                return;
            }

            const tx = await this.adapter.withdraw(withdrawableWei);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            await this.loadStats();
            if (btn) btn.textContent = 'Withdraw Earnings';
        } catch (error) {
            console.error('[ERC1155AdminPanel] Withdraw failed:', error);
            if (btn) btn.textContent = 'Withdraw Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Withdraw Earnings'; }, 3000);
        } finally {
            this.state.withdrawing = false;
        }
    }

    async handleClaimVaultFees() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="claim-vault"]');

        try {
            if (btn) btn.textContent = 'Claiming...';
            const tx = await this.adapter.claimVaultFees();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            await this.loadStats();
            if (btn) btn.textContent = 'Claim Vault Fees';
        } catch (error) {
            console.error('[ERC1155AdminPanel] Claim vault fees failed:', error);
            if (btn) btn.textContent = 'Claim Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Claim Vault Fees'; }, 3000);
        }
    }

    async handleTransferOwnership() {
        if (!this.adapter) return;
        const input = this._el?.querySelector('[data-input="new-owner"]');
        const btn = this._el?.querySelector('[data-action="transfer-submit"]');
        const newOwner = input?.value?.trim();
        if (!newOwner) return;

        try {
            if (btn) btn.textContent = 'Transferring...';
            const tx = await this.adapter.transferOwnership(newOwner);
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (input) input.value = '';
            if (btn) btn.textContent = 'Transfer';
            this.toggleInlineForm('transfer-ownership');
        } catch (error) {
            console.error('[ERC1155AdminPanel] Transfer ownership failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Transfer'; }, 3000);
        }
    }

    async handleRenounceOwnership() {
        if (!this.adapter) return;
        const btn = this._el?.querySelector('[data-action="renounce-submit"]');

        try {
            if (btn) btn.textContent = 'Renouncing...';
            const tx = await this.adapter.renounceOwnership();
            if (tx && typeof tx.wait === 'function') await tx.wait();
            if (btn) btn.textContent = 'Renounced';
            this.toggleInlineForm('renounce-ownership');
        } catch (error) {
            console.error('[ERC1155AdminPanel] Renounce ownership failed:', error);
            if (btn) btn.textContent = 'Failed';
            setTimeout(() => { if (btn) btn.textContent = 'Renounce'; }, 3000);
        }
    }

    // ── Inline Forms ──

    toggleInlineForm(formName) {
        if (!this._el) return;
        const form = this._el.querySelector(`[data-form="${formName}"]`);
        if (!form) return;

        const isVisible = form.style.display !== 'none';
        this._el.querySelectorAll('.admin-inline-form').forEach(f => f.style.display = 'none');
        if (!isVisible) form.style.display = '';
    }

    // ── Render ──

    render() {
        return h('div', { className: 'admin-panel', style: { display: 'none' } },
            h('div', { className: 'admin-panel-header' },
                h('div', { className: 'admin-panel-title' }, 'Project Settings'),
                h('div', { className: 'admin-panel-actions' },
                    h('button', {
                        className: 'btn btn-primary btn-sm',
                        onClick: this.bind(this.handleCreateEdition)
                    }, 'Create New Edition'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        'data-action': 'withdraw',
                        onClick: this.bind(this.handleWithdraw)
                    }, 'Withdraw Earnings'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        'data-action': 'claim-vault',
                        onClick: this.bind(this.handleClaimVaultFees)
                    }, 'Claim Vault Fees'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        onClick: () => this.toggleInlineForm('set-style')
                    }, 'Set Style'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        onClick: () => this.toggleInlineForm('transfer-ownership')
                    }, 'Transfer Ownership'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        onClick: () => this.toggleInlineForm('renounce-ownership')
                    }, 'Renounce Ownership')
                )
            ),

            // ── Style Builder ──
            h('div', {
                className: 'admin-inline-form',
                'data-form': 'set-style',
                style: { display: 'none' }
            },
                h('div', { className: 'style-builder-guide' },
                    h('div', { className: 'style-builder-guide-title' }, 'Project Style'),
                    h('div', { className: 'style-builder-guide-text' },
                        'Customize how your project page looks. The style is stored on-chain as a CSS URI. ',
                        'You can paste a hosted CSS file URL, or use the builder to override design tokens and generate inline CSS automatically.'
                    )
                ),
                h(StyleBuilder, {
                    onSetStyle: (uri) => this.adapter.setStyle(uri),
                    onGetStyle: () => this.adapter.getStyle(),
                    onClearStyle: () => this.adapter.setStyle(''),
                    inputClass: 'admin-inline-input'
                })
            ),

            // ── Transfer Ownership ──
            h('div', {
                className: 'admin-inline-form',
                'data-form': 'transfer-ownership',
                style: { display: 'none' }
            },
                h('div', { className: 'admin-inline-form-warning' },
                    'This transfers full control of this contract to a new address. You will lose all admin access.'
                ),
                h('div', { className: 'admin-inline-form-row' },
                    h('label', { className: 'stat-label' }, 'New Owner Address'),
                    h('input', {
                        type: 'text',
                        'data-input': 'new-owner',
                        placeholder: '0x...',
                        className: 'admin-inline-input'
                    }),
                    h('button', {
                        className: 'btn btn-primary btn-sm',
                        'data-action': 'transfer-submit',
                        onClick: this.bind(this.handleTransferOwnership)
                    }, 'Transfer'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        onClick: () => this.toggleInlineForm('transfer-ownership')
                    }, 'Cancel')
                )
            ),

            // ── Renounce Ownership ──
            h('div', {
                className: 'admin-inline-form',
                'data-form': 'renounce-ownership',
                style: { display: 'none' }
            },
                h('div', { className: 'admin-inline-form-warning admin-inline-form-danger' },
                    'PERMANENT: This removes the owner from the contract entirely. ',
                    'No one will be able to withdraw, create editions, update metadata, or change styles. ',
                    'This cannot be undone.'
                ),
                h('div', { className: 'admin-inline-form-row' },
                    h('button', {
                        className: 'btn btn-primary btn-sm',
                        'data-action': 'renounce-submit',
                        onClick: this.bind(this.handleRenounceOwnership)
                    }, 'Renounce'),
                    h('button', {
                        className: 'btn btn-secondary btn-sm',
                        onClick: () => this.toggleInlineForm('renounce-ownership')
                    }, 'Cancel')
                )
            ),

            // ── Stats Grid ──
            h('div', { className: 'admin-panel-stats' },
                h('div', null,
                    h('div', { className: 'stat-label' }, 'Total Revenue'),
                    h('div', {
                        className: 'admin-stat-value',
                        'data-admin-stat': 'revenue'
                    }, '\u2014 ETH')
                ),
                h('div', null,
                    h('div', { className: 'stat-label' }, 'Withdrawable'),
                    h('div', {
                        className: 'admin-stat-value',
                        'data-admin-stat': 'withdrawable'
                    }, '\u2014 ETH')
                ),
                h('div', null,
                    h('div', { className: 'stat-label' }, 'Vault Contributed'),
                    h('div', {
                        className: 'admin-stat-value',
                        'data-admin-stat': 'vault'
                    }, '\u2014 ETH')
                )
            )
        );
    }
}

export default ERC1155AdminPanel;

# Technical Documentation

This document contains technical details for developers working on ms2.fun.

## Architecture Overview

ms2.fun is a decentralized launchpad built with:
- **Frontend**: Static site (GitHub Pages, IPFS-ready)
- **Master Contract**: On-chain registry for factories
- **Factories**: Templates that create project instances
- **Instances**: Individual projects created from factories

## System Design

### Multi-Project System

The launchpad supports multiple project types through a factory system:
- **ERC404**: Bonding curve tokens with automatic NFT minting
- **ERC1155**: Multi-edition NFT collections

### Routing System

- **New Format**: `/:chainId/:factoryTitle/:instanceName`
- **Legacy Format**: `/project/:id` (address-based, for backward compatibility)

### Component Architecture

- Custom component system (`Component.js`)
- Event-driven state management (`EventBus.js`)
- Service factory pattern for dependency injection
- Route-based stylesheet loading

### Key Services

- **ProjectService**: Manages project loading and contract adapters
- **ProjectRegistry**: Handles project discovery and metadata
- **ContractAdapters**: ERC404Adapter, ERC1155Adapter for contract interactions
- **WalletService**: Web3 wallet connection management

## Contract Requirements

See `CONTRACT_REQUIREMENTS.md` for detailed on-chain requirements.

Key requirements:
- Factory authorization system
- Instance indexing
- Metadata handling
- Feature matrix support

## Development Setup

```bash
npm install
npm start
```

## Styling System

- Global CSS variables in `src/core/global.css`
- Route-specific stylesheets loaded dynamically
- CULT EXEC page uses black background (scoped to `body.cultexecs-active`)
- Launchpad pages use white/light backgrounds

## CULT EXEC Integration

The CULT EXEC trading interface is integrated as a special project:
- Uses `BlockchainService` (not ProjectService)
- Has its own routing (`/cultexecs`)
- Uses `WalletConnector` (not WalletDisplay)
- Maintains backward compatibility

## Migration Notes

The codebase has been migrated from a single-project system to a multi-project launchpad:
- Old address-based routing still supported
- Legacy services maintained for CULT EXEC
- New factory/instance system for launchpad projects

## Planning Documents

The following planning documents contain historical context and detailed specifications:
- `CONTRACT_REQUIREMENTS.md` - On-chain contract specifications
- `LAUNCHPAD_TRANSITION.md` - Migration details
- `MOCK_SYSTEM_DESIGN.md` - Mock system architecture
- `ARCHITECTURE_IMPROVEMENTS.md` - Architecture decisions

These documents are preserved for reference but the current implementation may differ.


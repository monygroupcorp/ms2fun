# ms2.fun Launchpad

A fully decentralized launchpad for Web3 projects. Built for the community, by the community, especially for our cult executives.

## Overview

ms2.fun is a permissionless, multi-project launchpad that enables anyone to create and deploy Web3 projects through a factory system. The platform is designed to be as decentralized as possible while maintaining quality curation through community governance.

## Features

- **Multi-Project Support**: Browse, discover, and interact with multiple projects from a single interface
- **Factory System**: Authorized factories enable project creation with different contract types
- **Contract Type Support**: Currently supports ERC404 and ERC1155, with extensibility for future types
- **Decentralized Architecture**: Statically hosted frontend (GitHub, IPFS coming soon), on-chain master contract
- **Project Discovery**: Search, filter, and browse projects by type, factory, and features
- **Quality Curation**: Cult executives control master contract to ensure quality and protect users

## Contract Types

### ERC404
- Bonding curve pricing mechanism
- Automatic NFT minting from token balance
- Merkle tree whitelist support
- Phase transitions (presale → live)
- On-chain messaging/chat
- Liquidity pool integration

### ERC1155
- Multiple editions in one contract
- Per-edition pricing
- Creator royalties
- Open mint functionality
- Batch operations
- Metadata URI support (IPFS)

## Getting Started

### For Users

1. **Connect Your Wallet**: Use MetaMask, Rabby, Rainbow, or Phantom
2. **Browse Projects**: Explore available projects on the home page
3. **Discover Factories**: Check out available factories to create your own project
4. **Interact**: Trade, mint, and engage with projects

### For Creators

1. **Browse Factories**: Explore available factories that match your needs
2. **Create Project**: Use a factory to deploy your project instance
3. **Configure**: Set up your project parameters (name, metadata, pricing, etc.)
4. **Deploy**: Deploy your project on-chain
5. **Share**: Your project is automatically indexed and discoverable

### For Factory Developers

1. **Review Requirements**: Check the [About page](/about) for factory requirements
2. **Submit Application**: Apply for factory approval (application fee required)
3. **Get Approved**: Cult executives review and approve quality factories
4. **Deploy**: Your factory becomes available for project creation

## Architecture

- **Frontend**: Vanilla JavaScript, component-based architecture
- **State Management**: Custom store system with project isolation
- **Services**: Modular service layer with mock/real service switching
- **Routing**: Client-side routing with title-based navigation
- **Contracts**: Master contract → Factory contracts → Instance contracts

## Development

### Prerequisites

- Node.js v14+
- npm or yarn
- Web3 wallet (MetaMask, Rabby, Rainbow, Phantom)

### Setup

```bash
npm install
npm start
```

The application will run on `http://localhost:3000`

### Project Structure

```
src/
├── components/       # UI components
├── services/         # Service layer (mock/real)
├── store/           # State management
├── routes/           # Route handlers
├── core/            # Core utilities (Router, Component, etc.)
└── utils/           # Utility functions
```

## CULT EXEC

CULT EXEC is the flagship project that inspired this launchpad. It's a standalone ERC404 project (not created via factory) that demonstrates the platform's capabilities. Visit `/cultexecs` to see it in action.

## Documentation

### Current Development Focus 🚀

**Frontend Architecture Overhaul** - We're implementing complete coverage of 200+ contract functions with a clean three-pathway user architecture.

**Key Documents:**
1. **[FRONTEND_COVERAGE_CHECKLIST.md](./FRONTEND_COVERAGE_CHECKLIST.md)** - Contract methods organized by user role
2. **[FRONTEND_ARCHITECTURE.md](./docs/FRONTEND_ARCHITECTURE.md)** - Complete implementation blueprint
3. **[FRONTEND_CURRENT_STATE_AUDIT.md](./docs/FRONTEND_CURRENT_STATE_AUDIT.md)** - Current state analysis
4. **[DESIGN_CHANGES.md](./docs/DESIGN_CHANGES.md)** - Pending UX improvements
5. **[Local Dev System Design](./docs/plans/2026-01-08-local-development-system-design.md)** - Anvil fork integration

**User Documentation:**
- **About Page**: Visit `/about` for end-user documentation
- **Factory Requirements**: See the About page for factory submission requirements

**Archived Docs:** Legacy documentation has been moved to `docs/archive/`

## Contributing

This is a community-driven project. Contributions are welcome! Please ensure your code follows the existing patterns and architecture.

## License

VPL

## Community

Built for the people at stationthisbot and especially for our cult executives.

---

**Status**: Active Development  
**Version**: Launchpad v1.0


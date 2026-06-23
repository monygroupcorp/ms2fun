import {
  createUseReadContract,
  createUseWriteContract,
  createUseSimulateContract,
  createUseWatchContractEvent,
} from 'wagmi/codegen'

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// AlignmentRegistryV1
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const alignmentRegistryV1Abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'ambassador', internalType: 'address', type: 'address' },
    ],
    name: 'addAmbassador',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'uint256', type: 'uint256' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'alignmentTargetAmbassadors',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'alignmentTargets',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'approvedAt', internalType: 'uint256', type: 'uint256' },
      { name: 'active', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'communityPayout',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'deactivateAlignmentTarget',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAlignmentTarget',
    outputs: [
      {
        name: '',
        internalType: 'struct IAlignmentRegistry.AlignmentTarget',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'description', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'approvedAt', internalType: 'uint256', type: 'uint256' },
          { name: 'active', internalType: 'bool', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAlignmentTargetAssets',
    outputs: [
      {
        name: '',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getAmbassadors',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCommunityPayout',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'targetId', internalType: 'uint256', type: 'uint256' }],
    name: 'isAlignmentTargetActive',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'account', internalType: 'address', type: 'address' },
    ],
    name: 'isAmbassador',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'token', internalType: 'address', type: 'address' },
    ],
    name: 'isTokenInTarget',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextAlignmentTargetId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'assets',
        internalType: 'struct IAlignmentRegistry.AlignmentAsset[]',
        type: 'tuple[]',
        components: [
          { name: 'token', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'info', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'registerAlignmentTarget',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'ambassador', internalType: 'address', type: 'address' },
    ],
    name: 'removeAmbassador',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'payout', internalType: 'address', type: 'address' },
    ],
    name: 'setCommunityPayout',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'tokenToTargetIds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
      { name: 'description', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'updateAlignmentTarget',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'AlignmentTargetDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      { name: 'title', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'AlignmentTargetRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'AlignmentTargetUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'ambassador',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AmbassadorAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'ambassador',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AmbassadorRemoved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'payout',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CommunityPayoutSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmbassadorAlreadyAssigned' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoAssets' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAmbassador' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TargetNotFound' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ComponentRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const componentRegistryAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'allComponents',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'component', internalType: 'address', type: 'address' },
      { name: 'tag', internalType: 'bytes32', type: 'bytes32' },
      { name: 'name', internalType: 'string', type: 'string' },
    ],
    name: 'approveComponent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'componentName',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'componentTag',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getApprovedComponents',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'tag', internalType: 'bytes32', type: 'bytes32' }],
    name: 'getApprovedComponentsByTag',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'isApproved',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'component', internalType: 'address', type: 'address' }],
    name: 'isApprovedComponent',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'component', internalType: 'address', type: 'address' }],
    name: 'revokeComponent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'component',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'tag', internalType: 'bytes32', type: 'bytes32', indexed: true },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'ComponentApproved',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'component',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ComponentRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyApproved' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotApproved' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Factory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155FactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_componentRegistry', internalType: 'address', type: 'address' },
      { name: '_weth', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'salt', internalType: 'bytes32', type: 'bytes32' }],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      {
        name: 'params',
        internalType: 'struct ERC1155Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'gatingModule', internalType: 'address', type: 'address' },
          {
            name: 'freeMint',
            internalType: 'struct FreeMintParams',
            type: 'tuple',
            components: [
              { name: 'allocation', internalType: 'uint256', type: 'uint256' },
              {
                name: 'scope',
                internalType: 'enum GatingScope',
                type: 'uint8',
              },
            ],
          },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dynamicPricingModule',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: 'module', internalType: 'address', type: 'address' }],
    name: 'setDynamicPricingModule',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'UnapprovedComponent' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC1155Instance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc1155InstanceAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_name', internalType: 'string', type: 'string' },
      { name: '_creator', internalType: 'address', type: 'address' },
      { name: '_factory', internalType: 'address', type: 'address' },
      { name: '_vault', internalType: 'address', type: 'address' },
      { name: '_styleUri', internalType: 'string', type: 'string' },
      {
        name: '_init',
        internalType: 'struct ERC1155Instance.InstanceInit',
        type: 'tuple',
        components: [
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          {
            name: 'protocolTreasury',
            internalType: 'address',
            type: 'address',
          },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'gatingModule', internalType: 'address', type: 'address' },
          {
            name: 'dynamicPricingModule',
            internalType: 'address',
            type: 'address',
          },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
      { name: '_agentCreated', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pieceTitle', internalType: 'string', type: 'string' },
      { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
      { name: 'supply', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
      },
      { name: 'priceIncreaseRate', internalType: 'uint256', type: 'uint256' },
      { name: 'openTime', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'addEdition',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'agentDelegationEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'calculateMintCost',
    outputs: [{ name: 'totalCost', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimAllFees',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'gatingData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'claimFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'claimVaultFees',
    outputs: [
      { name: 'totalClaimed', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'creator',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dynamicPricingModule',
    outputs: [
      {
        name: '',
        internalType: 'contract IDynamicPricingModule',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'editions',
    outputs: [
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'pieceTitle', internalType: 'string', type: 'string' },
      { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
      { name: 'supply', internalType: 'uint256', type: 'uint256' },
      { name: 'minted', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
      },
      { name: 'priceIncreaseRate', internalType: 'uint256', type: 'uint256' },
      { name: 'openTime', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'factory',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintAllocation',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'freeMintClaimed',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'freeMintsClaimed',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingModule',
    outputs: [
      { name: '', internalType: 'contract IGatingModule', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'gatingScope',
    outputs: [{ name: '', internalType: 'enum GatingScope', type: 'uint8' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getAllEditionIds',
    outputs: [
      { name: 'editionIds', internalType: 'uint256[]', type: 'uint256[]' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCurrentPrice',
    outputs: [{ name: 'price', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getEdition',
    outputs: [
      {
        name: '',
        internalType: 'struct ERC1155Instance.Edition',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum ERC1155Instance.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'openTime', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getEditionCount',
    outputs: [{ name: 'count', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getGlobalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'allocation', internalType: 'uint256', type: 'uint256' },
      { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
    ],
    name: 'initializeFreeMint',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'instanceType',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: '', internalType: 'address', type: 'address' },
      { name: '', internalType: 'address', type: 'address' },
    ],
    name: 'isApprovedForAll',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newVault', internalType: 'address', type: 'address' }],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'gatingData', internalType: 'bytes32', type: 'bytes32' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
      { name: 'maxCost', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'mint',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'name',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextEditionId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'pendingVaultCut',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'retryVaultContribution',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'amounts', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeBatchTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'safeTransferFrom',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'enabled', internalType: 'bool', type: 'bool' }],
    name: 'setAgentDelegation',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'approved', internalType: 'bool', type: 'bool' },
    ],
    name: 'setApprovalForAll',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setStyle',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'styleUri',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalProceeds',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'totalWithdrawn',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'editionId', internalType: 'uint256', type: 'uint256' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
    ],
    name: 'updateEditionMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'vault',
    outputs: [
      { name: '', internalType: 'contract IAlignmentVault', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'amount', internalType: 'uint256', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'approved', internalType: 'bool', type: 'bool', indexed: false },
    ],
    name: 'ApprovalForAll',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'pieceTitle',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'basePrice',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'supply',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'pricingModel',
        internalType: 'enum ERC1155Instance.PricingModel',
        type: 'uint8',
        indexed: false,
      },
    ],
    name: 'EditionAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'metadataURI',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'EditionMetadataUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'FreeMintClaimed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'editionId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'totalCost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Minted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newState',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'StateChanged',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'ids',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
      {
        name: 'values',
        internalType: 'uint256[]',
        type: 'uint256[]',
        indexed: false,
      },
    ],
    name: 'TransferBatch',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'operator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'from', internalType: 'address', type: 'address', indexed: true },
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      { name: 'id', internalType: 'uint256', type: 'uint256', indexed: false },
      {
        name: 'value',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'TransferSingle',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultContributionFailed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'VaultContributionRetried',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'artistAmount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'vaultCut',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'protocolCut',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'Withdrawn',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AmountMustBePositive' },
  { type: 'error', inputs: [], name: 'DynamicPricingRequiresIncreaseRate' },
  { type: 'error', inputs: [], name: 'ERC1155RejectedTokens' },
  { type: 'error', inputs: [], name: 'EditionLimitReached' },
  { type: 'error', inputs: [], name: 'EditionNotFound' },
  { type: 'error', inputs: [], name: 'EditionNotOpen' },
  { type: 'error', inputs: [], name: 'EditionSoldOut' },
  { type: 'error', inputs: [], name: 'ExceedsMaxCost' },
  { type: 'error', inputs: [], name: 'ExceedsSupply' },
  { type: 'error', inputs: [], name: 'FreeMintAlreadyClaimed' },
  { type: 'error', inputs: [], name: 'FreeMintDisabled' },
  { type: 'error', inputs: [], name: 'FreeMintExhausted' },
  { type: 'error', inputs: [], name: 'GatingCheckFailed' },
  { type: 'error', inputs: [], name: 'InsufficientBalance' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidPrice' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'LengthMismatch' },
  { type: 'error', inputs: [], name: 'LimitedMustHavePositiveSupply' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoDynamicPricingModule' },
  { type: 'error', inputs: [], name: 'NoFeesToClaim' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoPendingVaultCut' },
  { type: 'error', inputs: [], name: 'OnlyFactory' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnlimitedMustHaveZeroSupply' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC404Factory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc404FactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      {
        name: 'core',
        internalType: 'struct ERC404Factory.CoreConfig',
        type: 'tuple',
        components: [
          { name: 'implementation', internalType: 'address', type: 'address' },
          { name: 'masterRegistry', internalType: 'address', type: 'address' },
          { name: 'protocol', internalType: 'address', type: 'address' },
          { name: 'weth', internalType: 'address', type: 'address' },
        ],
      },
      {
        name: 'modules',
        internalType: 'struct ERC404Factory.ModuleConfig',
        type: 'tuple',
        components: [
          {
            name: 'globalMessageRegistry',
            internalType: 'address',
            type: 'address',
          },
          {
            name: 'componentRegistry',
            internalType: 'address',
            type: 'address',
          },
          { name: 'launchManager', internalType: 'address', type: 'address' },
        ],
      },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'PROTOCOL_ROLE',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'bondingFeeBps',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
    ],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'params',
        internalType: 'struct ERC404Factory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'styleUri', internalType: 'string', type: 'string' },
          { name: 'tokenBaseURI', internalType: 'string', type: 'string' },
          { name: 'owner', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'nftCount', internalType: 'uint256', type: 'uint256' },
          { name: 'presetId', internalType: 'uint8', type: 'uint8' },
          { name: 'stakingModule', internalType: 'address', type: 'address' },
        ],
      },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'liquidityDeployer', internalType: 'address', type: 'address' },
      { name: 'gatingModule', internalType: 'address', type: 'address' },
      {
        name: 'freeMint',
        internalType: 'struct FreeMintParams',
        type: 'tuple',
        components: [
          { name: 'allocation', internalType: 'uint256', type: 'uint256' },
          { name: 'scope', internalType: 'enum GatingScope', type: 'uint8' },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'grantRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'hasAllRoles',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'hasAnyRole',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'implementation',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'launchManager',
    outputs: [
      { name: '', internalType: 'contract LaunchManager', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'roles', internalType: 'uint256', type: 'uint256' }],
    name: 'renounceRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'roles', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'revokeRoles',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'rolesOf',
    outputs: [{ name: 'roles', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_bps', internalType: 'uint256', type: 'uint256' }],
    name: 'setBondingFeeBps',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newProtocol', internalType: 'address', type: 'address' }],
    name: 'transferProtocolRole',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'newBps',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'BondingFeeUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'symbol',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'user', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'roles',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'RolesUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'capability',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'VaultCapabilityWarning',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'FreeMintAllocationExceedsNftCount' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidComponentRegistry' },
  { type: 'error', inputs: [], name: 'InvalidGlobalMessageRegistry' },
  { type: 'error', inputs: [], name: 'InvalidImplementation' },
  { type: 'error', inputs: [], name: 'InvalidLaunchManager' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidNftCount' },
  { type: 'error', inputs: [], name: 'InvalidOwner' },
  { type: 'error', inputs: [], name: 'InvalidSymbol' },
  { type: 'error', inputs: [], name: 'MaxBondingFeeExceeded' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'ProtocolRoleNotTransferable' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'UnapprovedCurveComputer' },
  { type: 'error', inputs: [], name: 'UnapprovedGatingModule' },
  { type: 'error', inputs: [], name: 'UnapprovedLiquidityDeployer' },
  { type: 'error', inputs: [], name: 'UnapprovedStakingModule' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
  { type: 'error', inputs: [], name: 'VaultRequired' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ERC721AuctionFactory
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const erc721AuctionFactoryAbi = [
  {
    type: 'constructor',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_weth', internalType: 'address', type: 'address' },
    ],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'salt', internalType: 'bytes32', type: 'bytes32' }],
    name: 'computeInstanceAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'salt', internalType: 'bytes32', type: 'bytes32' },
      {
        name: 'params',
        internalType: 'struct ERC721AuctionFactory.CreateParams',
        type: 'tuple',
        components: [
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'symbol', internalType: 'string', type: 'string' },
          { name: 'lines', internalType: 'uint8', type: 'uint8' },
          { name: 'baseDuration', internalType: 'uint40', type: 'uint40' },
          { name: 'timeBuffer', internalType: 'uint40', type: 'uint40' },
          { name: 'bidIncrement', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    name: 'createInstance',
    outputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'features',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocol',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requiredFeatures',
    outputs: [{ name: '', internalType: 'bytes32[]', type: 'bytes32[]' }],
    stateMutability: 'pure',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'newOwner', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceCreated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'capability',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: true,
      },
    ],
    name: 'VaultCapabilityWarning',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotAuthorizedAgent' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// FeaturedQueueManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const featuredQueueManagerAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'boostRank',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dailyDecayRate',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'dailyRate',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getEffectiveRank',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getFeaturedInstances',
    outputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'total', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getRentalInfo',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'effectiveRank', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      { name: '_owner', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxDuration',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'maxFeaturedSize',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'minDuration',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'protocolTreasury',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'pruneExpired',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'queueLength',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'duration', internalType: 'uint256', type: 'uint256' }],
    name: 'quoteDurationCost',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'additionalDuration', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'renewDuration',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'duration', internalType: 'uint256', type: 'uint256' },
      { name: 'rankBoost', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'rentFeatured',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_dailyDecayRate', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setDailyDecayRate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_dailyRate', internalType: 'uint256', type: 'uint256' }],
    name: 'setDailyRate',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_min', internalType: 'uint256', type: 'uint256' },
      { name: '_max', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'setDurationBounds',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setMasterRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_max', internalType: 'uint256', type: 'uint256' }],
    name: 'setMaxFeaturedSize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_treasury', internalType: 'address', type: 'address' }],
    name: 'setProtocolTreasury',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_weth', internalType: 'address', type: 'address' }],
    name: 'setWeth',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'slots',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'rankScore', internalType: 'uint256', type: 'uint256' },
      { name: 'lastBoostTime', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'weth',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'renewer',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'additionalDuration',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'cost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newExpiresAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'DurationRenewed',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHTransferFallbackToWETH',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'renter',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'duration',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'durationCost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'rankBoost',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'expiresAt',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'FeaturedRented',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'registry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'MasterRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newTreasury',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ProtocolTreasuryUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'booster',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'newEffectiveRank',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'RankBoosted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyFeatured' },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'DurationTooLong' },
  { type: 'error', inputs: [], name: 'DurationTooShort' },
  { type: 'error', inputs: [], name: 'InstanceNotRegistered' },
  { type: 'error', inputs: [], name: 'InsufficientPayment' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidBounds' },
  { type: 'error', inputs: [], name: 'InvalidDuration' },
  { type: 'error', inputs: [], name: 'InvalidSize' },
  { type: 'error', inputs: [], name: 'MustSendETH' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'QueueFull' },
  { type: 'error', inputs: [], name: 'Reentrancy' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'SlotExpired' },
  { type: 'error', inputs: [], name: 'SlotNotActive' },
  { type: 'error', inputs: [], name: 'SlotStillActive' },
  {
    type: 'error',
    inputs: [
      { name: 'to', internalType: 'address', type: 'address' },
      { name: 'amount', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'SmartTransferFailed',
  },
  { type: 'error', inputs: [], name: 'TreasuryNotSet' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// GlobalMessageRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const globalMessageRegistryAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_owner', internalType: 'address', type: 'address' },
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'messageCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'messageType', internalType: 'uint8', type: 'uint8' },
      { name: 'refId', internalType: 'uint256', type: 'uint256' },
      { name: 'actionRef', internalType: 'bytes32', type: 'bytes32' },
      { name: 'metadata', internalType: 'bytes32', type: 'bytes32' },
      { name: 'content', internalType: 'string', type: 'string' },
    ],
    name: 'post',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      {
        name: 'posts',
        internalType: 'struct GlobalMessageRegistry.PostParams[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'messageType', internalType: 'uint8', type: 'uint8' },
          { name: 'refId', internalType: 'uint256', type: 'uint256' },
          { name: 'actionRef', internalType: 'bytes32', type: 'bytes32' },
          { name: 'metadata', internalType: 'bytes32', type: 'bytes32' },
          { name: 'content', internalType: 'string', type: 'string' },
        ],
      },
    ],
    name: 'postBatch',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'sender', internalType: 'address', type: 'address' },
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'messageData', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'postForAction',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setMasterRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'withdrawETH',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      { name: 'to', internalType: 'address', type: 'address', indexed: true },
      {
        name: 'amount',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'ETHWithdrawn',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'masterRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'MasterRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'messageId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'sender',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'messageType',
        internalType: 'uint8',
        type: 'uint8',
        indexed: false,
      },
      {
        name: 'refId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
      {
        name: 'actionRef',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'metadata',
        internalType: 'bytes32',
        type: 'bytes32',
        indexed: false,
      },
      {
        name: 'content',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'MessagePosted',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'EmptyBatch' },
  { type: 'error', inputs: [], name: 'InstanceMustBeCaller' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoETHToWithdraw' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NotFromApprovedFactory' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Balance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155BalanceAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'account', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getAllEditionIds',
    outputs: [{ name: '', internalType: 'uint256[]', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getEditionCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155EditionReader
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155EditionReaderAbi = [
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getCurrentPrice',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'editionId', internalType: 'uint256', type: 'uint256' }],
    name: 'getEdition',
    outputs: [
      {
        name: '',
        internalType: 'struct IERC1155EditionReader.Edition',
        type: 'tuple',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum IERC1155EditionReader.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
          { name: 'openTime', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextEditionId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC1155Receiver
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc1155ReceiverAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'ids', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'values', internalType: 'uint256[]', type: 'uint256[]' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155BatchReceived',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'operator', internalType: 'address', type: 'address' },
      { name: 'from', internalType: 'address', type: 'address' },
      { name: 'id', internalType: 'uint256', type: 'uint256' },
      { name: 'value', internalType: 'uint256', type: 'uint256' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'onERC1155Received',
    outputs: [{ name: '', internalType: 'bytes4', type: 'bytes4' }],
    stateMutability: 'nonpayable',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC404Balance
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc404BalanceAbi = [
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IERC404Staking
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const ierc404StakingAbi = [
  {
    type: 'function',
    inputs: [{ name: 'staker', internalType: 'address', type: 'address' }],
    name: 'calculatePendingRewards',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'user', internalType: 'address', type: 'address' }],
    name: 'stakedBalance',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'stakingEnabled',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IFeaturedQueueManager
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iFeaturedQueueManagerAbi = [
  {
    type: 'function',
    inputs: [
      { name: 'startIndex', internalType: 'uint256', type: 'uint256' },
      { name: 'endIndex', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getFeaturedInstances',
    outputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'total', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getRentalInfo',
    outputs: [
      { name: 'renter', internalType: 'address', type: 'address' },
      { name: 'effectiveRank', internalType: 'uint256', type: 'uint256' },
      { name: 'expiresAt', internalType: 'uint256', type: 'uint256' },
      { name: 'isActive', internalType: 'bool', type: 'bool' },
    ],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// IGlobalMessageRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const iGlobalMessageRegistryAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'messageCount',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// MasterRegistryV1
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const masterRegistryV1Abi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'alignmentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IAlignmentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'componentRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IComponentRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
    ],
    name: 'deactivateFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'deactivateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'emergencyRevoker',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    name: 'factoryIdToAddress',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'factoryInfo',
    outputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
      { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
      { name: 'contractType', internalType: 'string', type: 'string' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'displayTitle', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getActiveVault',
    outputs: [{ name: '', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'factoryId', internalType: 'uint256', type: 'uint256' }],
    name: 'getFactoryInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.FactoryInfo',
        type: 'tuple',
        components: [
          { name: 'factoryAddress', internalType: 'address', type: 'address' },
          { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'displayTitle', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
    ],
    name: 'getFactoryInfoByAddress',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.FactoryInfo',
        type: 'tuple',
        components: [
          { name: 'factoryAddress', internalType: 'address', type: 'address' },
          { name: 'factoryId', internalType: 'uint256', type: 'uint256' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'title', internalType: 'string', type: 'string' },
          { name: 'displayTitle', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getInstanceInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.InstanceInfo',
        type: 'tuple',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'vaults', internalType: 'address[]', type: 'address[]' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'nameHash', internalType: 'bytes32', type: 'bytes32' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'getInstanceVaults',
    outputs: [{ name: '', internalType: 'address[]', type: 'address[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'getTotalFactories',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'getVaultInfo',
    outputs: [
      {
        name: '',
        internalType: 'struct IMasterRegistry.VaultInfo',
        type: 'tuple',
        components: [
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'active', internalType: 'bool', type: 'bool' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'targetId', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '_owner', internalType: 'address', type: 'address' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'instanceInfo',
    outputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'factory', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'nameHash', internalType: 'bytes32', type: 'bytes32' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'isAgent',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'factory', internalType: 'address', type: 'address' }],
    name: 'isFactoryRegistered',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'isInstanceFromApprovedFactory',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'name', internalType: 'string', type: 'string' }],
    name: 'isNameTaken',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'isRegisteredInstance',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'vault', internalType: 'address', type: 'address' }],
    name: 'isVaultRegistered',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'newVault', internalType: 'address', type: 'address' },
    ],
    name: 'migrateVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    name: 'nameHashes',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'nextFactoryId',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'factoryAddress', internalType: 'address', type: 'address' },
      { name: 'contractType', internalType: 'string', type: 'string' },
      { name: 'title', internalType: 'string', type: 'string' },
      { name: 'displayTitle', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'features', internalType: 'bytes32[]', type: 'bytes32[]' },
    ],
    name: 'registerFactory',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'factory', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'vault', internalType: 'address', type: 'address' },
    ],
    name: 'registerInstance',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'vault', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'registerVault',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'registeredFactories',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'registeredVaults',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: 'agent', internalType: 'address', type: 'address' }],
    name: 'revokeAgent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'instance', internalType: 'address', type: 'address' }],
    name: 'revokeInstance',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'revokedInstances',
    outputs: [{ name: '', internalType: 'bool', type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'agent', internalType: 'address', type: 'address' },
      { name: 'authorized', internalType: 'bool', type: 'bool' },
    ],
    name: 'setAgent',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_alignmentRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setAlignmentRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_componentRegistry', internalType: 'address', type: 'address' },
    ],
    name: 'setComponentRegistry',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '_revoker', internalType: 'address', type: 'address' }],
    name: 'setEmergencyRevoker',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'uri', internalType: 'string', type: 'string' },
    ],
    name: 'updateInstanceMetadata',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'vaultInfo',
    outputs: [
      { name: 'vault', internalType: 'address', type: 'address' },
      { name: 'creator', internalType: 'address', type: 'address' },
      { name: 'name', internalType: 'string', type: 'string' },
      { name: 'metadataURI', internalType: 'string', type: 'string' },
      { name: 'active', internalType: 'bool', type: 'bool' },
      { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
      { name: 'targetId', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'agent',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'authorized',
        internalType: 'bool',
        type: 'bool',
        indexed: false,
      },
    ],
    name: 'AgentUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'AlignmentRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'componentRegistry',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'ComponentRegistrySet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'CreatorInstanceAdded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldRevoker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newRevoker',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'EmergencyRevokerSet',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'factoryAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factoryId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'FactoryDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'factoryAddress',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factoryId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
      {
        name: 'contractType',
        internalType: 'string',
        type: 'string',
        indexed: false,
      },
    ],
    name: 'FactoryRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'uri', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'InstanceMetadataUpdated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'factory',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'InstanceRegistered',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'InstanceRevoked',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'instance',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newVault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'vaultIndex',
        internalType: 'uint256',
        type: 'uint256',
        indexed: false,
      },
    ],
    name: 'InstanceVaultMigrated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'VaultDeactivated',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'vault',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'creator',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'name', internalType: 'string', type: 'string', indexed: false },
      {
        name: 'targetId',
        internalType: 'uint256',
        type: 'uint256',
        indexed: true,
      },
    ],
    name: 'VaultRegistered',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'AlreadyRegistered' },
  { type: 'error', inputs: [], name: 'FactoryHasNoProtocol' },
  { type: 'error', inputs: [], name: 'FactoryNotActive' },
  { type: 'error', inputs: [], name: 'InstanceHasNoTreasury' },
  { type: 'error', inputs: [], name: 'InstanceHasNoVault' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'InvalidContractType' },
  { type: 'error', inputs: [], name: 'InvalidMetadataURI' },
  { type: 'error', inputs: [], name: 'InvalidName' },
  { type: 'error', inputs: [], name: 'InvalidTitle' },
  { type: 'error', inputs: [], name: 'MissingInstanceType' },
  { type: 'error', inputs: [], name: 'NameAlreadyTaken' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoAlignmentToken' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'NoVaults' },
  { type: 'error', inputs: [], name: 'NotEmergencyRevoker' },
  { type: 'error', inputs: [], name: 'NotRegistered' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TargetNotActive' },
  { type: 'error', inputs: [], name: 'TokenNotInTarget' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
  { type: 'error', inputs: [], name: 'VaultAlreadyInArray' },
  { type: 'error', inputs: [], name: 'VaultMismatch' },
  { type: 'error', inputs: [], name: 'VaultMustBeContract' },
  { type: 'error', inputs: [], name: 'VaultNotDeployed' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// ProfileRegistry
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const profileRegistryAbi = [
  {
    type: 'function',
    inputs: [],
    name: 'clearProfile',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: 'account', internalType: 'address', type: 'address' }],
    name: 'profileURI',
    outputs: [{ name: '', internalType: 'string', type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [{ name: 'uri', internalType: 'string', type: 'string' }],
    name: 'setProfile',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'account',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      { name: 'uri', internalType: 'string', type: 'string', indexed: false },
    ],
    name: 'ProfileUpdated',
  },
  { type: 'error', inputs: [], name: 'InvalidURI' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// QueryAggregator
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

export const queryAggregatorAbi = [
  { type: 'constructor', inputs: [], stateMutability: 'nonpayable' },
  {
    type: 'function',
    inputs: [],
    name: 'MAX_QUERY_LIMIT',
    outputs: [{ name: '', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'cancelOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'completeOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'featuredQueueManager',
    outputs: [
      {
        name: '',
        internalType: 'contract IFeaturedQueueManager',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instance', internalType: 'address', type: 'address' },
      { name: 'startId', internalType: 'uint256', type: 'uint256' },
      { name: 'endId', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getERC1155EditionsBatch',
    outputs: [
      {
        name: 'result',
        internalType: 'struct QueryAggregator.EditionView[]',
        type: 'tuple[]',
        components: [
          { name: 'id', internalType: 'uint256', type: 'uint256' },
          { name: 'pieceTitle', internalType: 'string', type: 'string' },
          { name: 'basePrice', internalType: 'uint256', type: 'uint256' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'supply', internalType: 'uint256', type: 'uint256' },
          { name: 'minted', internalType: 'uint256', type: 'uint256' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          {
            name: 'pricingModel',
            internalType: 'enum IERC1155EditionReader.PricingModel',
            type: 'uint8',
          },
          {
            name: 'priceIncreaseRate',
            internalType: 'uint256',
            type: 'uint256',
          },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'offset', internalType: 'uint256', type: 'uint256' },
      { name: 'limit', internalType: 'uint256', type: 'uint256' },
    ],
    name: 'getHomePageData',
    outputs: [
      {
        name: 'projects',
        internalType: 'struct QueryAggregator.ProjectCard[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'factoryTitle', internalType: 'string', type: 'string' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'vaultName', internalType: 'string', type: 'string' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'totalSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'extraData', internalType: 'bytes', type: 'bytes' },
          { name: 'featuredRank', internalType: 'uint256', type: 'uint256' },
          { name: 'featuredExpires', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'totalFeatured', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'user', internalType: 'address', type: 'address' },
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
      { name: 'vaultAddrs', internalType: 'address[]', type: 'address[]' },
    ],
    name: 'getPortfolioData',
    outputs: [
      {
        name: 'erc404Holdings',
        internalType: 'struct QueryAggregator.ERC404Holding[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'tokenBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'nftBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'stakedBalance', internalType: 'uint256', type: 'uint256' },
          { name: 'pendingRewards', internalType: 'uint256', type: 'uint256' },
        ],
      },
      {
        name: 'erc1155Holdings',
        internalType: 'struct QueryAggregator.ERC1155Holding[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'editionIds', internalType: 'uint256[]', type: 'uint256[]' },
          { name: 'balances', internalType: 'uint256[]', type: 'uint256[]' },
        ],
      },
      {
        name: 'vaultPositions',
        internalType: 'struct QueryAggregator.VaultPosition[]',
        type: 'tuple[]',
        components: [
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'contribution', internalType: 'uint256', type: 'uint256' },
          { name: 'shares', internalType: 'uint256', type: 'uint256' },
          { name: 'claimable', internalType: 'uint256', type: 'uint256' },
        ],
      },
      { name: 'totalClaimable', internalType: 'uint256', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'instances', internalType: 'address[]', type: 'address[]' },
    ],
    name: 'getProjectCardsBatch',
    outputs: [
      {
        name: 'cards',
        internalType: 'struct QueryAggregator.ProjectCard[]',
        type: 'tuple[]',
        components: [
          { name: 'instance', internalType: 'address', type: 'address' },
          { name: 'name', internalType: 'string', type: 'string' },
          { name: 'metadataURI', internalType: 'string', type: 'string' },
          { name: 'creator', internalType: 'address', type: 'address' },
          { name: 'registeredAt', internalType: 'uint256', type: 'uint256' },
          { name: 'factory', internalType: 'address', type: 'address' },
          { name: 'contractType', internalType: 'string', type: 'string' },
          { name: 'factoryTitle', internalType: 'string', type: 'string' },
          { name: 'vault', internalType: 'address', type: 'address' },
          { name: 'vaultName', internalType: 'string', type: 'string' },
          { name: 'currentPrice', internalType: 'uint256', type: 'uint256' },
          { name: 'totalSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'maxSupply', internalType: 'uint256', type: 'uint256' },
          { name: 'isActive', internalType: 'bool', type: 'bool' },
          { name: 'extraData', internalType: 'bytes', type: 'bytes' },
          { name: 'featuredRank', internalType: 'uint256', type: 'uint256' },
          { name: 'featuredExpires', internalType: 'uint256', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'globalMessageRegistry',
    outputs: [
      {
        name: '',
        internalType: 'contract IGlobalMessageRegistry',
        type: 'address',
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_featuredQueueManager',
        internalType: 'address',
        type: 'address',
      },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
      { name: '_owner', internalType: 'address', type: 'address' },
    ],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'masterRegistry',
    outputs: [
      { name: '', internalType: 'contract IMasterRegistry', type: 'address' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'owner',
    outputs: [{ name: 'result', internalType: 'address', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [
      { name: 'pendingOwner', internalType: 'address', type: 'address' },
    ],
    name: 'ownershipHandoverExpiresAt',
    outputs: [{ name: 'result', internalType: 'uint256', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'proxiableUUID',
    outputs: [{ name: '', internalType: 'bytes32', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    inputs: [],
    name: 'renounceOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [],
    name: 'requestOwnershipHandover',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: '_masterRegistry', internalType: 'address', type: 'address' },
      {
        name: '_featuredQueueManager',
        internalType: 'address',
        type: 'address',
      },
      {
        name: '_globalMessageRegistry',
        internalType: 'address',
        type: 'address',
      },
    ],
    name: 'setRegistries',
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    inputs: [{ name: '', internalType: 'address', type: 'address' }],
    name: 'transferOwnership',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'function',
    inputs: [
      { name: 'newImplementation', internalType: 'address', type: 'address' },
      { name: 'data', internalType: 'bytes', type: 'bytes' },
    ],
    name: 'upgradeToAndCall',
    outputs: [],
    stateMutability: 'payable',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'masterRegistry',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'featuredQueueManager',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
      {
        name: 'globalMessageRegistry',
        internalType: 'address',
        type: 'address',
        indexed: false,
      },
    ],
    name: 'Initialized',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverCanceled',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'pendingOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipHandoverRequested',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'oldOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
      {
        name: 'newOwner',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'OwnershipTransferred',
  },
  {
    type: 'event',
    anonymous: false,
    inputs: [
      {
        name: 'implementation',
        internalType: 'address',
        type: 'address',
        indexed: true,
      },
    ],
    name: 'Upgraded',
  },
  { type: 'error', inputs: [], name: 'AlreadyInitialized' },
  { type: 'error', inputs: [], name: 'InvalidAddress' },
  { type: 'error', inputs: [], name: 'LimitTooHigh' },
  { type: 'error', inputs: [], name: 'NewOwnerIsZeroAddress' },
  { type: 'error', inputs: [], name: 'NoHandoverRequest' },
  { type: 'error', inputs: [], name: 'RenounceDisabled' },
  { type: 'error', inputs: [], name: 'TooManyInstances' },
  { type: 'error', inputs: [], name: 'Unauthorized' },
  { type: 'error', inputs: [], name: 'UnauthorizedCallContext' },
  { type: 'error', inputs: [], name: 'UpgradeFailed' },
  { type: 'error', inputs: [], name: 'UseRequestOwnershipHandover' },
] as const

//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
// React
//////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useReadAlignmentRegistryV1 = /*#__PURE__*/ createUseReadContract({
  abi: alignmentRegistryV1Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"alignmentTargetAmbassadors"`
 */
export const useReadAlignmentRegistryV1AlignmentTargetAmbassadors =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'alignmentTargetAmbassadors',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"alignmentTargets"`
 */
export const useReadAlignmentRegistryV1AlignmentTargets =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'alignmentTargets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"communityPayout"`
 */
export const useReadAlignmentRegistryV1CommunityPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'communityPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAlignmentTarget"`
 */
export const useReadAlignmentRegistryV1GetAlignmentTarget =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAlignmentTarget',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAlignmentTargetAssets"`
 */
export const useReadAlignmentRegistryV1GetAlignmentTargetAssets =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAlignmentTargetAssets',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getAmbassadors"`
 */
export const useReadAlignmentRegistryV1GetAmbassadors =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getAmbassadors',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"getCommunityPayout"`
 */
export const useReadAlignmentRegistryV1GetCommunityPayout =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'getCommunityPayout',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isAlignmentTargetActive"`
 */
export const useReadAlignmentRegistryV1IsAlignmentTargetActive =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isAlignmentTargetActive',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isAmbassador"`
 */
export const useReadAlignmentRegistryV1IsAmbassador =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isAmbassador',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"isTokenInTarget"`
 */
export const useReadAlignmentRegistryV1IsTokenInTarget =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'isTokenInTarget',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"nextAlignmentTargetId"`
 */
export const useReadAlignmentRegistryV1NextAlignmentTargetId =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'nextAlignmentTargetId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"owner"`
 */
export const useReadAlignmentRegistryV1Owner =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadAlignmentRegistryV1OwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadAlignmentRegistryV1ProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"tokenToTargetIds"`
 */
export const useReadAlignmentRegistryV1TokenToTargetIds =
  /*#__PURE__*/ createUseReadContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'tokenToTargetIds',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useWriteAlignmentRegistryV1 = /*#__PURE__*/ createUseWriteContract(
  { abi: alignmentRegistryV1Abi },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"addAmbassador"`
 */
export const useWriteAlignmentRegistryV1AddAmbassador =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'addAmbassador',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"deactivateAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1DeactivateAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'deactivateAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useWriteAlignmentRegistryV1Initialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"registerAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1RegisterAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'registerAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"removeAmbassador"`
 */
export const useWriteAlignmentRegistryV1RemoveAmbassador =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'removeAmbassador',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteAlignmentRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteAlignmentRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useWriteAlignmentRegistryV1SetCommunityPayout =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteAlignmentRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"updateAlignmentTarget"`
 */
export const useWriteAlignmentRegistryV1UpdateAlignmentTarget =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'updateAlignmentTarget',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteAlignmentRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useSimulateAlignmentRegistryV1 =
  /*#__PURE__*/ createUseSimulateContract({ abi: alignmentRegistryV1Abi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"addAmbassador"`
 */
export const useSimulateAlignmentRegistryV1AddAmbassador =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'addAmbassador',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"deactivateAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1DeactivateAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'deactivateAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateAlignmentRegistryV1Initialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"registerAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1RegisterAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'registerAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"removeAmbassador"`
 */
export const useSimulateAlignmentRegistryV1RemoveAmbassador =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'removeAmbassador',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateAlignmentRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateAlignmentRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"setCommunityPayout"`
 */
export const useSimulateAlignmentRegistryV1SetCommunityPayout =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'setCommunityPayout',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateAlignmentRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"updateAlignmentTarget"`
 */
export const useSimulateAlignmentRegistryV1UpdateAlignmentTarget =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'updateAlignmentTarget',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateAlignmentRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: alignmentRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__
 */
export const useWatchAlignmentRegistryV1Event =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: alignmentRegistryV1Abi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetDeactivated"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetRegistered"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AlignmentTargetUpdated"`
 */
export const useWatchAlignmentRegistryV1AlignmentTargetUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AlignmentTargetUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AmbassadorAdded"`
 */
export const useWatchAlignmentRegistryV1AmbassadorAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AmbassadorAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"AmbassadorRemoved"`
 */
export const useWatchAlignmentRegistryV1AmbassadorRemovedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'AmbassadorRemoved',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"CommunityPayoutSet"`
 */
export const useWatchAlignmentRegistryV1CommunityPayoutSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'CommunityPayoutSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchAlignmentRegistryV1OwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchAlignmentRegistryV1OwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchAlignmentRegistryV1OwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link alignmentRegistryV1Abi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchAlignmentRegistryV1UpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: alignmentRegistryV1Abi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useReadComponentRegistry = /*#__PURE__*/ createUseReadContract({
  abi: componentRegistryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"allComponents"`
 */
export const useReadComponentRegistryAllComponents =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'allComponents',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"componentName"`
 */
export const useReadComponentRegistryComponentName =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'componentName',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"componentTag"`
 */
export const useReadComponentRegistryComponentTag =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'componentTag',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"getApprovedComponents"`
 */
export const useReadComponentRegistryGetApprovedComponents =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'getApprovedComponents',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"getApprovedComponentsByTag"`
 */
export const useReadComponentRegistryGetApprovedComponentsByTag =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'getApprovedComponentsByTag',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"isApproved"`
 */
export const useReadComponentRegistryIsApproved =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'isApproved',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"isApprovedComponent"`
 */
export const useReadComponentRegistryIsApprovedComponent =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'isApprovedComponent',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadComponentRegistryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadComponentRegistryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadComponentRegistryProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: componentRegistryAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useWriteComponentRegistry = /*#__PURE__*/ createUseWriteContract({
  abi: componentRegistryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"approveComponent"`
 */
export const useWriteComponentRegistryApproveComponent =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'approveComponent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteComponentRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteComponentRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteComponentRegistryInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteComponentRegistryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteComponentRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"revokeComponent"`
 */
export const useWriteComponentRegistryRevokeComponent =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'revokeComponent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteComponentRegistryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteComponentRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: componentRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useSimulateComponentRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: componentRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"approveComponent"`
 */
export const useSimulateComponentRegistryApproveComponent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'approveComponent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateComponentRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateComponentRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateComponentRegistryInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateComponentRegistryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateComponentRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"revokeComponent"`
 */
export const useSimulateComponentRegistryRevokeComponent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'revokeComponent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateComponentRegistryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link componentRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateComponentRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: componentRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__
 */
export const useWatchComponentRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: componentRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"ComponentApproved"`
 */
export const useWatchComponentRegistryComponentApprovedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'ComponentApproved',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"ComponentRevoked"`
 */
export const useWatchComponentRegistryComponentRevokedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'ComponentRevoked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchComponentRegistryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchComponentRegistryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchComponentRegistryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link componentRegistryAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchComponentRegistryUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: componentRegistryAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useReadErc1155Factory = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadErc1155FactoryComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc1155FactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"dynamicPricingModule"`
 */
export const useReadErc1155FactoryDynamicPricingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'dynamicPricingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc1155FactoryFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'features',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc1155FactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc1155FactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc1155FactoryOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc1155FactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc1155FactoryProtocol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'protocol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc1155FactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc1155FactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155FactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc1155FactoryWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc1155FactoryAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useWriteErc1155Factory = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155FactoryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc1155FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc1155FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc1155FactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc1155FactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc1155FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setDynamicPricingModule"`
 */
export const useWriteErc1155FactorySetDynamicPricingModule =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setDynamicPricingModule',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc1155FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc1155FactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc1155FactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useSimulateErc1155Factory =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc1155FactoryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc1155FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc1155FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc1155FactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc1155FactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc1155FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setDynamicPricingModule"`
 */
export const useSimulateErc1155FactorySetDynamicPricingModule =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setDynamicPricingModule',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc1155FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc1155FactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc1155FactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__
 */
export const useWatchErc1155FactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc1155FactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc1155FactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc1155FactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc1155FactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc1155FactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155FactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc1155FactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155FactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useReadErc1155Instance = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"agentDelegationEnabled"`
 */
export const useReadErc1155InstanceAgentDelegationEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'agentDelegationEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadErc1155InstanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"calculateMintCost"`
 */
export const useReadErc1155InstanceCalculateMintCost =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'calculateMintCost',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"creator"`
 */
export const useReadErc1155InstanceCreator =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'creator',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"dynamicPricingModule"`
 */
export const useReadErc1155InstanceDynamicPricingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'dynamicPricingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"editions"`
 */
export const useReadErc1155InstanceEditions =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'editions',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"factory"`
 */
export const useReadErc1155InstanceFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'factory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintAllocation"`
 */
export const useReadErc1155InstanceFreeMintAllocation =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintAllocation',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintClaimed"`
 */
export const useReadErc1155InstanceFreeMintClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"freeMintsClaimed"`
 */
export const useReadErc1155InstanceFreeMintsClaimed =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'freeMintsClaimed',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"gatingModule"`
 */
export const useReadErc1155InstanceGatingModule =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'gatingModule',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"gatingScope"`
 */
export const useReadErc1155InstanceGatingScope =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'gatingScope',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getAllEditionIds"`
 */
export const useReadErc1155InstanceGetAllEditionIds =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getAllEditionIds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getCurrentPrice"`
 */
export const useReadErc1155InstanceGetCurrentPrice =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getCurrentPrice',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getEdition"`
 */
export const useReadErc1155InstanceGetEdition =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getEdition',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getEditionCount"`
 */
export const useReadErc1155InstanceGetEditionCount =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getEditionCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"getGlobalMessageRegistry"`
 */
export const useReadErc1155InstanceGetGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'getGlobalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc1155InstanceGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"instanceType"`
 */
export const useReadErc1155InstanceInstanceType =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'instanceType',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"isApprovedForAll"`
 */
export const useReadErc1155InstanceIsApprovedForAll =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'isApprovedForAll',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc1155InstanceMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"name"`
 */
export const useReadErc1155InstanceName = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'name',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"nextEditionId"`
 */
export const useReadErc1155InstanceNextEditionId =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'nextEditionId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc1155InstanceOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc1155InstanceOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"pendingVaultCut"`
 */
export const useReadErc1155InstancePendingVaultCut =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'pendingVaultCut',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc1155InstanceProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"styleUri"`
 */
export const useReadErc1155InstanceStyleUri =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'styleUri',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"totalProceeds"`
 */
export const useReadErc1155InstanceTotalProceeds =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'totalProceeds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"totalWithdrawn"`
 */
export const useReadErc1155InstanceTotalWithdrawn =
  /*#__PURE__*/ createUseReadContract({
    abi: erc1155InstanceAbi,
    functionName: 'totalWithdrawn',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"vault"`
 */
export const useReadErc1155InstanceVault = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'vault',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc1155InstanceWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc1155InstanceAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useWriteErc1155Instance = /*#__PURE__*/ createUseWriteContract({
  abi: erc1155InstanceAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"addEdition"`
 */
export const useWriteErc1155InstanceAddEdition =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'addEdition',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc1155InstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useWriteErc1155InstanceClaimAllFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useWriteErc1155InstanceClaimFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useWriteErc1155InstanceClaimVaultFees =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc1155InstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useWriteErc1155InstanceInitializeFreeMint =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteErc1155InstanceMigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"mint"`
 */
export const useWriteErc1155InstanceMint = /*#__PURE__*/ createUseWriteContract(
  { abi: erc1155InstanceAbi, functionName: 'mint' },
)

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc1155InstanceRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc1155InstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"retryVaultContribution"`
 */
export const useWriteErc1155InstanceRetryVaultContribution =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'retryVaultContribution',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useWriteErc1155InstanceSafeBatchTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useWriteErc1155InstanceSafeTransferFrom =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useWriteErc1155InstanceSetAgentDelegation =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useWriteErc1155InstanceSetApprovalForAll =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useWriteErc1155InstanceSetStyle =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc1155InstanceTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"updateEditionMetadata"`
 */
export const useWriteErc1155InstanceUpdateEditionMetadata =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'updateEditionMetadata',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"withdraw"`
 */
export const useWriteErc1155InstanceWithdraw =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc1155InstanceAbi,
    functionName: 'withdraw',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useSimulateErc1155Instance =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc1155InstanceAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"addEdition"`
 */
export const useSimulateErc1155InstanceAddEdition =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'addEdition',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc1155InstanceCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimAllFees"`
 */
export const useSimulateErc1155InstanceClaimAllFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimAllFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimFreeMint"`
 */
export const useSimulateErc1155InstanceClaimFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"claimVaultFees"`
 */
export const useSimulateErc1155InstanceClaimVaultFees =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'claimVaultFees',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc1155InstanceCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"initializeFreeMint"`
 */
export const useSimulateErc1155InstanceInitializeFreeMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'initializeFreeMint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateErc1155InstanceMigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"mint"`
 */
export const useSimulateErc1155InstanceMint =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'mint',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc1155InstanceRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc1155InstanceRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"retryVaultContribution"`
 */
export const useSimulateErc1155InstanceRetryVaultContribution =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'retryVaultContribution',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeBatchTransferFrom"`
 */
export const useSimulateErc1155InstanceSafeBatchTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeBatchTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"safeTransferFrom"`
 */
export const useSimulateErc1155InstanceSafeTransferFrom =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'safeTransferFrom',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setAgentDelegation"`
 */
export const useSimulateErc1155InstanceSetAgentDelegation =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setAgentDelegation',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setApprovalForAll"`
 */
export const useSimulateErc1155InstanceSetApprovalForAll =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setApprovalForAll',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"setStyle"`
 */
export const useSimulateErc1155InstanceSetStyle =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'setStyle',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc1155InstanceTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"updateEditionMetadata"`
 */
export const useSimulateErc1155InstanceUpdateEditionMetadata =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'updateEditionMetadata',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `functionName` set to `"withdraw"`
 */
export const useSimulateErc1155InstanceWithdraw =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc1155InstanceAbi,
    functionName: 'withdraw',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__
 */
export const useWatchErc1155InstanceEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc1155InstanceAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"ApprovalForAll"`
 */
export const useWatchErc1155InstanceApprovalForAllEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'ApprovalForAll',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchErc1155InstanceEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"EditionAdded"`
 */
export const useWatchErc1155InstanceEditionAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'EditionAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"EditionMetadataUpdated"`
 */
export const useWatchErc1155InstanceEditionMetadataUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'EditionMetadataUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"FreeMintClaimed"`
 */
export const useWatchErc1155InstanceFreeMintClaimedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'FreeMintClaimed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"Minted"`
 */
export const useWatchErc1155InstanceMintedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'Minted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc1155InstanceOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc1155InstanceOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc1155InstanceOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"StateChanged"`
 */
export const useWatchErc1155InstanceStateChangedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'StateChanged',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"TransferBatch"`
 */
export const useWatchErc1155InstanceTransferBatchEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'TransferBatch',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"TransferSingle"`
 */
export const useWatchErc1155InstanceTransferSingleEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'TransferSingle',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"VaultContributionFailed"`
 */
export const useWatchErc1155InstanceVaultContributionFailedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'VaultContributionFailed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"VaultContributionRetried"`
 */
export const useWatchErc1155InstanceVaultContributionRetriedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'VaultContributionRetried',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc1155InstanceAbi}__ and `eventName` set to `"Withdrawn"`
 */
export const useWatchErc1155InstanceWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc1155InstanceAbi,
    eventName: 'Withdrawn',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useReadErc404Factory = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"PROTOCOL_ROLE"`
 */
export const useReadErc404FactoryProtocolRole =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'PROTOCOL_ROLE',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"bondingFeeBps"`
 */
export const useReadErc404FactoryBondingFeeBps =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'bondingFeeBps',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadErc404FactoryComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc404FactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc404FactoryFeatures = /*#__PURE__*/ createUseReadContract(
  { abi: erc404FactoryAbi, functionName: 'features' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc404FactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"hasAllRoles"`
 */
export const useReadErc404FactoryHasAllRoles =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'hasAllRoles',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"hasAnyRole"`
 */
export const useReadErc404FactoryHasAnyRole =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'hasAnyRole',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"implementation"`
 */
export const useReadErc404FactoryImplementation =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'implementation',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"launchManager"`
 */
export const useReadErc404FactoryLaunchManager =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'launchManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc404FactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc404FactoryOwner = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc404FactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc404FactoryProtocol = /*#__PURE__*/ createUseReadContract(
  { abi: erc404FactoryAbi, functionName: 'protocol' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc404FactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc404FactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc404FactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"rolesOf"`
 */
export const useReadErc404FactoryRolesOf = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'rolesOf',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc404FactoryWeth = /*#__PURE__*/ createUseReadContract({
  abi: erc404FactoryAbi,
  functionName: 'weth',
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useWriteErc404Factory = /*#__PURE__*/ createUseWriteContract({
  abi: erc404FactoryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc404FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc404FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc404FactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"grantRoles"`
 */
export const useWriteErc404FactoryGrantRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'grantRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc404FactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceRoles"`
 */
export const useWriteErc404FactoryRenounceRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc404FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"revokeRoles"`
 */
export const useWriteErc404FactoryRevokeRoles =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'revokeRoles',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setBondingFeeBps"`
 */
export const useWriteErc404FactorySetBondingFeeBps =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setBondingFeeBps',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc404FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc404FactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc404FactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferProtocolRole"`
 */
export const useWriteErc404FactoryTransferProtocolRole =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc404FactoryAbi,
    functionName: 'transferProtocolRole',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useSimulateErc404Factory = /*#__PURE__*/ createUseSimulateContract(
  { abi: erc404FactoryAbi },
)

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc404FactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc404FactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc404FactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"grantRoles"`
 */
export const useSimulateErc404FactoryGrantRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'grantRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc404FactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"renounceRoles"`
 */
export const useSimulateErc404FactoryRenounceRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'renounceRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc404FactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"revokeRoles"`
 */
export const useSimulateErc404FactoryRevokeRoles =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'revokeRoles',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setBondingFeeBps"`
 */
export const useSimulateErc404FactorySetBondingFeeBps =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setBondingFeeBps',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc404FactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc404FactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc404FactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc404FactoryAbi}__ and `functionName` set to `"transferProtocolRole"`
 */
export const useSimulateErc404FactoryTransferProtocolRole =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc404FactoryAbi,
    functionName: 'transferProtocolRole',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__
 */
export const useWatchErc404FactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc404FactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"BondingFeeUpdated"`
 */
export const useWatchErc404FactoryBondingFeeUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'BondingFeeUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc404FactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc404FactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc404FactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc404FactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc404FactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"RolesUpdated"`
 */
export const useWatchErc404FactoryRolesUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'RolesUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc404FactoryAbi}__ and `eventName` set to `"VaultCapabilityWarning"`
 */
export const useWatchErc404FactoryVaultCapabilityWarningEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc404FactoryAbi,
    eventName: 'VaultCapabilityWarning',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useReadErc721AuctionFactory = /*#__PURE__*/ createUseReadContract({
  abi: erc721AuctionFactoryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"computeInstanceAddress"`
 */
export const useReadErc721AuctionFactoryComputeInstanceAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'computeInstanceAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"features"`
 */
export const useReadErc721AuctionFactoryFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'features',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadErc721AuctionFactoryGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadErc721AuctionFactoryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadErc721AuctionFactoryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadErc721AuctionFactoryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"protocol"`
 */
export const useReadErc721AuctionFactoryProtocol =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'protocol',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadErc721AuctionFactoryProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requiredFeatures"`
 */
export const useReadErc721AuctionFactoryRequiredFeatures =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requiredFeatures',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"weth"`
 */
export const useReadErc721AuctionFactoryWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useWriteErc721AuctionFactory =
  /*#__PURE__*/ createUseWriteContract({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useWriteErc721AuctionFactoryCreateInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteErc721AuctionFactoryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteErc721AuctionFactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteErc721AuctionFactorySetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteErc721AuctionFactorySetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteErc721AuctionFactoryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useSimulateErc721AuctionFactory =
  /*#__PURE__*/ createUseSimulateContract({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"createInstance"`
 */
export const useSimulateErc721AuctionFactoryCreateInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'createInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateErc721AuctionFactoryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateErc721AuctionFactoryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateErc721AuctionFactorySetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateErc721AuctionFactorySetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateErc721AuctionFactoryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: erc721AuctionFactoryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__
 */
export const useWatchErc721AuctionFactoryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: erc721AuctionFactoryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"InstanceCreated"`
 */
export const useWatchErc721AuctionFactoryInstanceCreatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'InstanceCreated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchErc721AuctionFactoryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchErc721AuctionFactoryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchErc721AuctionFactoryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchErc721AuctionFactoryProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link erc721AuctionFactoryAbi}__ and `eventName` set to `"VaultCapabilityWarning"`
 */
export const useWatchErc721AuctionFactoryVaultCapabilityWarningEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: erc721AuctionFactoryAbi,
    eventName: 'VaultCapabilityWarning',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useReadFeaturedQueueManager = /*#__PURE__*/ createUseReadContract({
  abi: featuredQueueManagerAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"dailyDecayRate"`
 */
export const useReadFeaturedQueueManagerDailyDecayRate =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'dailyDecayRate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"dailyRate"`
 */
export const useReadFeaturedQueueManagerDailyRate =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'dailyRate',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getEffectiveRank"`
 */
export const useReadFeaturedQueueManagerGetEffectiveRank =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getEffectiveRank',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getFeaturedInstances"`
 */
export const useReadFeaturedQueueManagerGetFeaturedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getFeaturedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"getRentalInfo"`
 */
export const useReadFeaturedQueueManagerGetRentalInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'getRentalInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadFeaturedQueueManagerMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"maxDuration"`
 */
export const useReadFeaturedQueueManagerMaxDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'maxDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"maxFeaturedSize"`
 */
export const useReadFeaturedQueueManagerMaxFeaturedSize =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'maxFeaturedSize',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"minDuration"`
 */
export const useReadFeaturedQueueManagerMinDuration =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'minDuration',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"owner"`
 */
export const useReadFeaturedQueueManagerOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadFeaturedQueueManagerOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"protocolTreasury"`
 */
export const useReadFeaturedQueueManagerProtocolTreasury =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'protocolTreasury',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadFeaturedQueueManagerProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"queueLength"`
 */
export const useReadFeaturedQueueManagerQueueLength =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'queueLength',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"quoteDurationCost"`
 */
export const useReadFeaturedQueueManagerQuoteDurationCost =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'quoteDurationCost',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"slots"`
 */
export const useReadFeaturedQueueManagerSlots =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'slots',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"weth"`
 */
export const useReadFeaturedQueueManagerWeth =
  /*#__PURE__*/ createUseReadContract({
    abi: featuredQueueManagerAbi,
    functionName: 'weth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useWriteFeaturedQueueManager =
  /*#__PURE__*/ createUseWriteContract({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"boostRank"`
 */
export const useWriteFeaturedQueueManagerBoostRank =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'boostRank',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteFeaturedQueueManagerInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useWriteFeaturedQueueManagerPruneExpired =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renewDuration"`
 */
export const useWriteFeaturedQueueManagerRenewDuration =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renewDuration',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteFeaturedQueueManagerRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"rentFeatured"`
 */
export const useWriteFeaturedQueueManagerRentFeatured =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'rentFeatured',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteFeaturedQueueManagerRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyDecayRate"`
 */
export const useWriteFeaturedQueueManagerSetDailyDecayRate =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyDecayRate',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyRate"`
 */
export const useWriteFeaturedQueueManagerSetDailyRate =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyRate',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDurationBounds"`
 */
export const useWriteFeaturedQueueManagerSetDurationBounds =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDurationBounds',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useWriteFeaturedQueueManagerSetMasterRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMaxFeaturedSize"`
 */
export const useWriteFeaturedQueueManagerSetMaxFeaturedSize =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMaxFeaturedSize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useWriteFeaturedQueueManagerSetProtocolTreasury =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setWeth"`
 */
export const useWriteFeaturedQueueManagerSetWeth =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteFeaturedQueueManagerTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteFeaturedQueueManagerUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: featuredQueueManagerAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useSimulateFeaturedQueueManager =
  /*#__PURE__*/ createUseSimulateContract({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"boostRank"`
 */
export const useSimulateFeaturedQueueManagerBoostRank =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'boostRank',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateFeaturedQueueManagerInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"pruneExpired"`
 */
export const useSimulateFeaturedQueueManagerPruneExpired =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'pruneExpired',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renewDuration"`
 */
export const useSimulateFeaturedQueueManagerRenewDuration =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renewDuration',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateFeaturedQueueManagerRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"rentFeatured"`
 */
export const useSimulateFeaturedQueueManagerRentFeatured =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'rentFeatured',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateFeaturedQueueManagerRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyDecayRate"`
 */
export const useSimulateFeaturedQueueManagerSetDailyDecayRate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyDecayRate',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDailyRate"`
 */
export const useSimulateFeaturedQueueManagerSetDailyRate =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDailyRate',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setDurationBounds"`
 */
export const useSimulateFeaturedQueueManagerSetDurationBounds =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setDurationBounds',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useSimulateFeaturedQueueManagerSetMasterRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setMaxFeaturedSize"`
 */
export const useSimulateFeaturedQueueManagerSetMaxFeaturedSize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setMaxFeaturedSize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setProtocolTreasury"`
 */
export const useSimulateFeaturedQueueManagerSetProtocolTreasury =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setProtocolTreasury',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"setWeth"`
 */
export const useSimulateFeaturedQueueManagerSetWeth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'setWeth',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateFeaturedQueueManagerTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateFeaturedQueueManagerUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: featuredQueueManagerAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__
 */
export const useWatchFeaturedQueueManagerEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: featuredQueueManagerAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"DurationRenewed"`
 */
export const useWatchFeaturedQueueManagerDurationRenewedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'DurationRenewed',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"ETHTransferFallbackToWETH"`
 */
export const useWatchFeaturedQueueManagerEthTransferFallbackToWethEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'ETHTransferFallbackToWETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"FeaturedRented"`
 */
export const useWatchFeaturedQueueManagerFeaturedRentedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'FeaturedRented',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"MasterRegistrySet"`
 */
export const useWatchFeaturedQueueManagerMasterRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'MasterRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchFeaturedQueueManagerOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchFeaturedQueueManagerOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchFeaturedQueueManagerOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"ProtocolTreasuryUpdated"`
 */
export const useWatchFeaturedQueueManagerProtocolTreasuryUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'ProtocolTreasuryUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"RankBoosted"`
 */
export const useWatchFeaturedQueueManagerRankBoostedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'RankBoosted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link featuredQueueManagerAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchFeaturedQueueManagerUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: featuredQueueManagerAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useReadGlobalMessageRegistry = /*#__PURE__*/ createUseReadContract(
  { abi: globalMessageRegistryAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadGlobalMessageRegistryMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"messageCount"`
 */
export const useReadGlobalMessageRegistryMessageCount =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'messageCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"owner"`
 */
export const useReadGlobalMessageRegistryOwner =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'owner',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadGlobalMessageRegistryOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadGlobalMessageRegistryProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: globalMessageRegistryAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useWriteGlobalMessageRegistry =
  /*#__PURE__*/ createUseWriteContract({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteGlobalMessageRegistryInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"post"`
 */
export const useWriteGlobalMessageRegistryPost =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'post',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postBatch"`
 */
export const useWriteGlobalMessageRegistryPostBatch =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postBatch',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postForAction"`
 */
export const useWriteGlobalMessageRegistryPostForAction =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postForAction',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteGlobalMessageRegistryRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteGlobalMessageRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useWriteGlobalMessageRegistrySetMasterRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteGlobalMessageRegistryTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteGlobalMessageRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useWriteGlobalMessageRegistryWithdrawEth =
  /*#__PURE__*/ createUseWriteContract({
    abi: globalMessageRegistryAbi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useSimulateGlobalMessageRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateGlobalMessageRegistryInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"post"`
 */
export const useSimulateGlobalMessageRegistryPost =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'post',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postBatch"`
 */
export const useSimulateGlobalMessageRegistryPostBatch =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postBatch',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"postForAction"`
 */
export const useSimulateGlobalMessageRegistryPostForAction =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'postForAction',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateGlobalMessageRegistryRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateGlobalMessageRegistryRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"setMasterRegistry"`
 */
export const useSimulateGlobalMessageRegistrySetMasterRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'setMasterRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateGlobalMessageRegistryTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateGlobalMessageRegistryUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `functionName` set to `"withdrawETH"`
 */
export const useSimulateGlobalMessageRegistryWithdrawEth =
  /*#__PURE__*/ createUseSimulateContract({
    abi: globalMessageRegistryAbi,
    functionName: 'withdrawETH',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__
 */
export const useWatchGlobalMessageRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: globalMessageRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"ETHWithdrawn"`
 */
export const useWatchGlobalMessageRegistryEthWithdrawnEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'ETHWithdrawn',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"MasterRegistrySet"`
 */
export const useWatchGlobalMessageRegistryMasterRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'MasterRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"MessagePosted"`
 */
export const useWatchGlobalMessageRegistryMessagePostedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'MessagePosted',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchGlobalMessageRegistryOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchGlobalMessageRegistryOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchGlobalMessageRegistryOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link globalMessageRegistryAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchGlobalMessageRegistryUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: globalMessageRegistryAbi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__
 */
export const useReadIerc1155Balance = /*#__PURE__*/ createUseReadContract({
  abi: ierc1155BalanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc1155BalanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"getAllEditionIds"`
 */
export const useReadIerc1155BalanceGetAllEditionIds =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'getAllEditionIds',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155BalanceAbi}__ and `functionName` set to `"getEditionCount"`
 */
export const useReadIerc1155BalanceGetEditionCount =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155BalanceAbi,
    functionName: 'getEditionCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__
 */
export const useReadIerc1155EditionReader = /*#__PURE__*/ createUseReadContract(
  { abi: ierc1155EditionReaderAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"getCurrentPrice"`
 */
export const useReadIerc1155EditionReaderGetCurrentPrice =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'getCurrentPrice',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"getEdition"`
 */
export const useReadIerc1155EditionReaderGetEdition =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'getEdition',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc1155EditionReaderAbi}__ and `functionName` set to `"nextEditionId"`
 */
export const useReadIerc1155EditionReaderNextEditionId =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc1155EditionReaderAbi,
    functionName: 'nextEditionId',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useWriteIerc1155Receiver = /*#__PURE__*/ createUseWriteContract({
  abi: ierc1155ReceiverAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useWriteIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useWriteIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseWriteContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__
 */
export const useSimulateIerc1155Receiver =
  /*#__PURE__*/ createUseSimulateContract({ abi: ierc1155ReceiverAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155BatchReceived"`
 */
export const useSimulateIerc1155ReceiverOnErc1155BatchReceived =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155BatchReceived',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link ierc1155ReceiverAbi}__ and `functionName` set to `"onERC1155Received"`
 */
export const useSimulateIerc1155ReceiverOnErc1155Received =
  /*#__PURE__*/ createUseSimulateContract({
    abi: ierc1155ReceiverAbi,
    functionName: 'onERC1155Received',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404BalanceAbi}__
 */
export const useReadIerc404Balance = /*#__PURE__*/ createUseReadContract({
  abi: ierc404BalanceAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404BalanceAbi}__ and `functionName` set to `"balanceOf"`
 */
export const useReadIerc404BalanceBalanceOf =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404BalanceAbi,
    functionName: 'balanceOf',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__
 */
export const useReadIerc404Staking = /*#__PURE__*/ createUseReadContract({
  abi: ierc404StakingAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"calculatePendingRewards"`
 */
export const useReadIerc404StakingCalculatePendingRewards =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'calculatePendingRewards',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"stakedBalance"`
 */
export const useReadIerc404StakingStakedBalance =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'stakedBalance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link ierc404StakingAbi}__ and `functionName` set to `"stakingEnabled"`
 */
export const useReadIerc404StakingStakingEnabled =
  /*#__PURE__*/ createUseReadContract({
    abi: ierc404StakingAbi,
    functionName: 'stakingEnabled',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__
 */
export const useReadIFeaturedQueueManager = /*#__PURE__*/ createUseReadContract(
  { abi: iFeaturedQueueManagerAbi },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__ and `functionName` set to `"getFeaturedInstances"`
 */
export const useReadIFeaturedQueueManagerGetFeaturedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: iFeaturedQueueManagerAbi,
    functionName: 'getFeaturedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iFeaturedQueueManagerAbi}__ and `functionName` set to `"getRentalInfo"`
 */
export const useReadIFeaturedQueueManagerGetRentalInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: iFeaturedQueueManagerAbi,
    functionName: 'getRentalInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iGlobalMessageRegistryAbi}__
 */
export const useReadIGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({ abi: iGlobalMessageRegistryAbi })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link iGlobalMessageRegistryAbi}__ and `functionName` set to `"messageCount"`
 */
export const useReadIGlobalMessageRegistryMessageCount =
  /*#__PURE__*/ createUseReadContract({
    abi: iGlobalMessageRegistryAbi,
    functionName: 'messageCount',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useReadMasterRegistryV1 = /*#__PURE__*/ createUseReadContract({
  abi: masterRegistryV1Abi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"alignmentRegistry"`
 */
export const useReadMasterRegistryV1AlignmentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'alignmentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"componentRegistry"`
 */
export const useReadMasterRegistryV1ComponentRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'componentRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"emergencyRevoker"`
 */
export const useReadMasterRegistryV1EmergencyRevoker =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'emergencyRevoker',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"factoryIdToAddress"`
 */
export const useReadMasterRegistryV1FactoryIdToAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'factoryIdToAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"factoryInfo"`
 */
export const useReadMasterRegistryV1FactoryInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'factoryInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getActiveVault"`
 */
export const useReadMasterRegistryV1GetActiveVault =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getActiveVault',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getFactoryInfo"`
 */
export const useReadMasterRegistryV1GetFactoryInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getFactoryInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getFactoryInfoByAddress"`
 */
export const useReadMasterRegistryV1GetFactoryInfoByAddress =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getFactoryInfoByAddress',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getInstanceInfo"`
 */
export const useReadMasterRegistryV1GetInstanceInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getInstanceInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getInstanceVaults"`
 */
export const useReadMasterRegistryV1GetInstanceVaults =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getInstanceVaults',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getTotalFactories"`
 */
export const useReadMasterRegistryV1GetTotalFactories =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getTotalFactories',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"getVaultInfo"`
 */
export const useReadMasterRegistryV1GetVaultInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'getVaultInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"instanceInfo"`
 */
export const useReadMasterRegistryV1InstanceInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'instanceInfo',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isAgent"`
 */
export const useReadMasterRegistryV1IsAgent =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isAgent',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isFactoryRegistered"`
 */
export const useReadMasterRegistryV1IsFactoryRegistered =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isFactoryRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isInstanceFromApprovedFactory"`
 */
export const useReadMasterRegistryV1IsInstanceFromApprovedFactory =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isInstanceFromApprovedFactory',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isNameTaken"`
 */
export const useReadMasterRegistryV1IsNameTaken =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isNameTaken',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isRegisteredInstance"`
 */
export const useReadMasterRegistryV1IsRegisteredInstance =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isRegisteredInstance',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"isVaultRegistered"`
 */
export const useReadMasterRegistryV1IsVaultRegistered =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'isVaultRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"nameHashes"`
 */
export const useReadMasterRegistryV1NameHashes =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'nameHashes',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"nextFactoryId"`
 */
export const useReadMasterRegistryV1NextFactoryId =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'nextFactoryId',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"owner"`
 */
export const useReadMasterRegistryV1Owner = /*#__PURE__*/ createUseReadContract(
  { abi: masterRegistryV1Abi, functionName: 'owner' },
)

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadMasterRegistryV1OwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadMasterRegistryV1ProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registeredFactories"`
 */
export const useReadMasterRegistryV1RegisteredFactories =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'registeredFactories',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registeredVaults"`
 */
export const useReadMasterRegistryV1RegisteredVaults =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'registeredVaults',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokedInstances"`
 */
export const useReadMasterRegistryV1RevokedInstances =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokedInstances',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"vaultInfo"`
 */
export const useReadMasterRegistryV1VaultInfo =
  /*#__PURE__*/ createUseReadContract({
    abi: masterRegistryV1Abi,
    functionName: 'vaultInfo',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useWriteMasterRegistryV1 = /*#__PURE__*/ createUseWriteContract({
  abi: masterRegistryV1Abi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteMasterRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteMasterRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateFactory"`
 */
export const useWriteMasterRegistryV1DeactivateFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateVault"`
 */
export const useWriteMasterRegistryV1DeactivateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useWriteMasterRegistryV1Initialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"migrateVault"`
 */
export const useWriteMasterRegistryV1MigrateVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerFactory"`
 */
export const useWriteMasterRegistryV1RegisterFactory =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerFactory',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerInstance"`
 */
export const useWriteMasterRegistryV1RegisterInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerVault"`
 */
export const useWriteMasterRegistryV1RegisterVault =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerVault',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteMasterRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteMasterRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeAgent"`
 */
export const useWriteMasterRegistryV1RevokeAgent =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeAgent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeInstance"`
 */
export const useWriteMasterRegistryV1RevokeInstance =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeInstance',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAgent"`
 */
export const useWriteMasterRegistryV1SetAgent =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAgent',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAlignmentRegistry"`
 */
export const useWriteMasterRegistryV1SetAlignmentRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAlignmentRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setComponentRegistry"`
 */
export const useWriteMasterRegistryV1SetComponentRegistry =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setComponentRegistry',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setEmergencyRevoker"`
 */
export const useWriteMasterRegistryV1SetEmergencyRevoker =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'setEmergencyRevoker',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteMasterRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"updateInstanceMetadata"`
 */
export const useWriteMasterRegistryV1UpdateInstanceMetadata =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'updateInstanceMetadata',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteMasterRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: masterRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useSimulateMasterRegistryV1 =
  /*#__PURE__*/ createUseSimulateContract({ abi: masterRegistryV1Abi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1CancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1CompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateFactory"`
 */
export const useSimulateMasterRegistryV1DeactivateFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"deactivateVault"`
 */
export const useSimulateMasterRegistryV1DeactivateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'deactivateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateMasterRegistryV1Initialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"migrateVault"`
 */
export const useSimulateMasterRegistryV1MigrateVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'migrateVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerFactory"`
 */
export const useSimulateMasterRegistryV1RegisterFactory =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerFactory',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerInstance"`
 */
export const useSimulateMasterRegistryV1RegisterInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"registerVault"`
 */
export const useSimulateMasterRegistryV1RegisterVault =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'registerVault',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateMasterRegistryV1RenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateMasterRegistryV1RequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeAgent"`
 */
export const useSimulateMasterRegistryV1RevokeAgent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeAgent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"revokeInstance"`
 */
export const useSimulateMasterRegistryV1RevokeInstance =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'revokeInstance',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAgent"`
 */
export const useSimulateMasterRegistryV1SetAgent =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAgent',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setAlignmentRegistry"`
 */
export const useSimulateMasterRegistryV1SetAlignmentRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setAlignmentRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setComponentRegistry"`
 */
export const useSimulateMasterRegistryV1SetComponentRegistry =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setComponentRegistry',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"setEmergencyRevoker"`
 */
export const useSimulateMasterRegistryV1SetEmergencyRevoker =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'setEmergencyRevoker',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateMasterRegistryV1TransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"updateInstanceMetadata"`
 */
export const useSimulateMasterRegistryV1UpdateInstanceMetadata =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'updateInstanceMetadata',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateMasterRegistryV1UpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: masterRegistryV1Abi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__
 */
export const useWatchMasterRegistryV1Event =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: masterRegistryV1Abi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"AgentUpdated"`
 */
export const useWatchMasterRegistryV1AgentUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'AgentUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"AlignmentRegistrySet"`
 */
export const useWatchMasterRegistryV1AlignmentRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'AlignmentRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"ComponentRegistrySet"`
 */
export const useWatchMasterRegistryV1ComponentRegistrySetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'ComponentRegistrySet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"CreatorInstanceAdded"`
 */
export const useWatchMasterRegistryV1CreatorInstanceAddedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'CreatorInstanceAdded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"EmergencyRevokerSet"`
 */
export const useWatchMasterRegistryV1EmergencyRevokerSetEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'EmergencyRevokerSet',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"FactoryDeactivated"`
 */
export const useWatchMasterRegistryV1FactoryDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'FactoryDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"FactoryRegistered"`
 */
export const useWatchMasterRegistryV1FactoryRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'FactoryRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceMetadataUpdated"`
 */
export const useWatchMasterRegistryV1InstanceMetadataUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceMetadataUpdated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceRegistered"`
 */
export const useWatchMasterRegistryV1InstanceRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceRegistered',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceRevoked"`
 */
export const useWatchMasterRegistryV1InstanceRevokedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceRevoked',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"InstanceVaultMigrated"`
 */
export const useWatchMasterRegistryV1InstanceVaultMigratedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'InstanceVaultMigrated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchMasterRegistryV1OwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchMasterRegistryV1OwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchMasterRegistryV1OwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchMasterRegistryV1UpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'Upgraded',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"VaultDeactivated"`
 */
export const useWatchMasterRegistryV1VaultDeactivatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'VaultDeactivated',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link masterRegistryV1Abi}__ and `eventName` set to `"VaultRegistered"`
 */
export const useWatchMasterRegistryV1VaultRegisteredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: masterRegistryV1Abi,
    eventName: 'VaultRegistered',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useReadProfileRegistry = /*#__PURE__*/ createUseReadContract({
  abi: profileRegistryAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"profileURI"`
 */
export const useReadProfileRegistryProfileUri =
  /*#__PURE__*/ createUseReadContract({
    abi: profileRegistryAbi,
    functionName: 'profileURI',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useWriteProfileRegistry = /*#__PURE__*/ createUseWriteContract({
  abi: profileRegistryAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"clearProfile"`
 */
export const useWriteProfileRegistryClearProfile =
  /*#__PURE__*/ createUseWriteContract({
    abi: profileRegistryAbi,
    functionName: 'clearProfile',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"setProfile"`
 */
export const useWriteProfileRegistrySetProfile =
  /*#__PURE__*/ createUseWriteContract({
    abi: profileRegistryAbi,
    functionName: 'setProfile',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useSimulateProfileRegistry =
  /*#__PURE__*/ createUseSimulateContract({ abi: profileRegistryAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"clearProfile"`
 */
export const useSimulateProfileRegistryClearProfile =
  /*#__PURE__*/ createUseSimulateContract({
    abi: profileRegistryAbi,
    functionName: 'clearProfile',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link profileRegistryAbi}__ and `functionName` set to `"setProfile"`
 */
export const useSimulateProfileRegistrySetProfile =
  /*#__PURE__*/ createUseSimulateContract({
    abi: profileRegistryAbi,
    functionName: 'setProfile',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link profileRegistryAbi}__
 */
export const useWatchProfileRegistryEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: profileRegistryAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link profileRegistryAbi}__ and `eventName` set to `"ProfileUpdated"`
 */
export const useWatchProfileRegistryProfileUpdatedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: profileRegistryAbi,
    eventName: 'ProfileUpdated',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useReadQueryAggregator = /*#__PURE__*/ createUseReadContract({
  abi: queryAggregatorAbi,
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"MAX_QUERY_LIMIT"`
 */
export const useReadQueryAggregatorMaxQueryLimit =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'MAX_QUERY_LIMIT',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"featuredQueueManager"`
 */
export const useReadQueryAggregatorFeaturedQueueManager =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'featuredQueueManager',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getERC1155EditionsBatch"`
 */
export const useReadQueryAggregatorGetErc1155EditionsBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getERC1155EditionsBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getHomePageData"`
 */
export const useReadQueryAggregatorGetHomePageData =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getHomePageData',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getPortfolioData"`
 */
export const useReadQueryAggregatorGetPortfolioData =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getPortfolioData',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"getProjectCardsBatch"`
 */
export const useReadQueryAggregatorGetProjectCardsBatch =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'getProjectCardsBatch',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"globalMessageRegistry"`
 */
export const useReadQueryAggregatorGlobalMessageRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'globalMessageRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"masterRegistry"`
 */
export const useReadQueryAggregatorMasterRegistry =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'masterRegistry',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"owner"`
 */
export const useReadQueryAggregatorOwner = /*#__PURE__*/ createUseReadContract({
  abi: queryAggregatorAbi,
  functionName: 'owner',
})

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"ownershipHandoverExpiresAt"`
 */
export const useReadQueryAggregatorOwnershipHandoverExpiresAt =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'ownershipHandoverExpiresAt',
  })

/**
 * Wraps __{@link useReadContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"proxiableUUID"`
 */
export const useReadQueryAggregatorProxiableUuid =
  /*#__PURE__*/ createUseReadContract({
    abi: queryAggregatorAbi,
    functionName: 'proxiableUUID',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useWriteQueryAggregator = /*#__PURE__*/ createUseWriteContract({
  abi: queryAggregatorAbi,
})

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useWriteQueryAggregatorCancelOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useWriteQueryAggregatorCompleteOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"initialize"`
 */
export const useWriteQueryAggregatorInitialize =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useWriteQueryAggregatorRenounceOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useWriteQueryAggregatorRequestOwnershipHandover =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"setRegistries"`
 */
export const useWriteQueryAggregatorSetRegistries =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'setRegistries',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useWriteQueryAggregatorTransferOwnership =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useWriteContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useWriteQueryAggregatorUpgradeToAndCall =
  /*#__PURE__*/ createUseWriteContract({
    abi: queryAggregatorAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useSimulateQueryAggregator =
  /*#__PURE__*/ createUseSimulateContract({ abi: queryAggregatorAbi })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"cancelOwnershipHandover"`
 */
export const useSimulateQueryAggregatorCancelOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'cancelOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"completeOwnershipHandover"`
 */
export const useSimulateQueryAggregatorCompleteOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'completeOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"initialize"`
 */
export const useSimulateQueryAggregatorInitialize =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'initialize',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"renounceOwnership"`
 */
export const useSimulateQueryAggregatorRenounceOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'renounceOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"requestOwnershipHandover"`
 */
export const useSimulateQueryAggregatorRequestOwnershipHandover =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'requestOwnershipHandover',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"setRegistries"`
 */
export const useSimulateQueryAggregatorSetRegistries =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'setRegistries',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"transferOwnership"`
 */
export const useSimulateQueryAggregatorTransferOwnership =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'transferOwnership',
  })

/**
 * Wraps __{@link useSimulateContract}__ with `abi` set to __{@link queryAggregatorAbi}__ and `functionName` set to `"upgradeToAndCall"`
 */
export const useSimulateQueryAggregatorUpgradeToAndCall =
  /*#__PURE__*/ createUseSimulateContract({
    abi: queryAggregatorAbi,
    functionName: 'upgradeToAndCall',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__
 */
export const useWatchQueryAggregatorEvent =
  /*#__PURE__*/ createUseWatchContractEvent({ abi: queryAggregatorAbi })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"Initialized"`
 */
export const useWatchQueryAggregatorInitializedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'Initialized',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipHandoverCanceled"`
 */
export const useWatchQueryAggregatorOwnershipHandoverCanceledEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipHandoverCanceled',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipHandoverRequested"`
 */
export const useWatchQueryAggregatorOwnershipHandoverRequestedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipHandoverRequested',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"OwnershipTransferred"`
 */
export const useWatchQueryAggregatorOwnershipTransferredEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'OwnershipTransferred',
  })

/**
 * Wraps __{@link useWatchContractEvent}__ with `abi` set to __{@link queryAggregatorAbi}__ and `eventName` set to `"Upgraded"`
 */
export const useWatchQueryAggregatorUpgradedEvent =
  /*#__PURE__*/ createUseWatchContractEvent({
    abi: queryAggregatorAbi,
    eventName: 'Upgraded',
  })

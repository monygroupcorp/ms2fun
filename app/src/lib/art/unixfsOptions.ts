/**
 * The UnixFS import parameters, in a file that imports nothing.
 *
 * Every CID hosting deals in is built with these: the wizard's upload, the release packer, the
 * regenerated metadata a creator moves to IPFS, and the art service when it works out which CID a
 * migrated collection should point at. The service cannot import the app's dependencies, so the
 * numbers live here, dependency-free, the way `hostingLimits.ts` and `metadata/gateways.ts` do.
 *
 * UnixFS import parameters, pinned rather than defaulted — CIDv1 with raw leaves, wrapped in a
 * directory, which is the shape `ipfs add --recursive --cid-version=1` produces and what a gateway
 * expects to serve a directory from. Pinned because a library default that moves in a minor release
 * would silently move every CID built with it; `pack.test.ts` records the resulting CID for a
 * fixture so such a move fails a test instead of shipping a different identity.
 */
export const UNIXFS_OPTIONS = {
  cidVersion: 1,
  rawLeaves: true,
  wrapWithDirectory: true,
} as const

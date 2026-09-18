import { hshBuffer } from '@rljson/hash';

/**
 * The id a blob store of `@rljson/bs` gives these bytes: the content hash
 * `setBlob` computes itself, the 22-character base64url prefix of their
 * SHA-256 (`docs/findings/blobs.md`). Computed here when a row must name
 * a blob before a store has seen it (the seed's `speciesImageBlobId`),
 * and when bytes another node served for an id are checked against that
 * id (the blob synchronisation of slice D5).
 */
export const blobIdOf = (bytes: Uint8Array): string => hshBuffer(bytes);

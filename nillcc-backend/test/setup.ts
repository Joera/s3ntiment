// vitest setup — runs before each test file's module graph is imported.
//
// The nillcc-backend modules read environment variables at *module load* time:
//   - NilDBBuilderService reads VITE_NIL_BUILDER_PRIVATE_KEY and VITE_NILDB_NODES
//     in a top-level const for its config, and `new NilDBBuilderService()` calls
//     `Signer.fromPrivateKey(...)` in the constructor. Without a valid key this
//     can throw at construction, so we guarantee a deterministic dev key here.
//
// We set explicit, benign values so no real .env / credentials are required and
// imports never touch the network. Tests may further stub process.env per-case.

process.env.VITE_NIL_BUILDER_PRIVATE_KEY =
  process.env.VITE_NIL_BUILDER_PRIVATE_KEY ||
  '0000000000000000000000000000000000000000000000000000000000000001';

process.env.VITE_NILDB_NODES =
  process.env.VITE_NILDB_NODES || 'https://nildb-stg-n1.nillion.network';

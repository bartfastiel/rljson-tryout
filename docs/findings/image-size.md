# Container image size

## What we tried

- Built the image from `packages/node-service/Dockerfile` with the repository
  root as context:
  `docker build -f packages/node-service/Dockerfile --build-arg
GIT_COMMIT=<sha> -t node-service:local .` (Docker 28.1.1, BuildKit, on a
  Windows host with the containerd image store).
- Measured the reported size with `docker image inspect node-service:local
--format '{{.Size}}'`, then compared it against `docker image inspect
node:24-alpine --format '{{.Size}}'` for the untouched base image.
- Measured the layer that BuildKit attributes to each instruction with
  `docker history node-service:local --no-trunc --format '{{.Size}}\t

{{.CreatedBy}}'`.

- Because the two numbers above did not add up (see below), also measured
  the real on-disk footprint from inside a running container with `docker
run --rm node-service:local sh -c "du -sx /"` and the same command against
  a bare `docker run --rm node:24-alpine sh -c "du -sx /"` for comparison.
- Measured the esbuild output directly with `ls -la` inside the container
  (`/app/dist/main.mjs`) and on the host after `pnpm --filter
@rljson-tryout/node-service run bundle`.
- Confirmed the runtime stage carries no build tooling with `docker run
--rm node-service:local sh -c "find / -maxdepth 2 -iname node_modules -o
-iname '*.pnpm*'"`.

## What happened

- `docker image inspect --format '{{.Size}}'` reports **58,843,910 bytes**
  (58.8 MB) for `node-service:local`, only 250,986 bytes more than the
  untouched `node:24-alpine` base (58,592,924 bytes). That delta is far
  smaller than the 1,453,228 byte bundle the image actually contains, so
  this number is not the uncompressed size the roadmap asks for. `docker
info` shows why: this installation runs `driver-type:
io.containerd.snapshotter.v1`, and under that backend `docker image
inspect` sums the compressed blob sizes of the manifest (the size that
  would be transferred to or from a registry), not the uncompressed
  filesystem size that a classic overlay2 graph driver reports. JavaScript
  text compresses well, which is consistent with a ~1.4 MB source file
  adding only ~250 KB of compressed delta.
- The uncompressed size, measured with `du -sx /` inside the running
  container, is **173,832 KiB (169.8 MiB, 178.0 MB decimal)**. The same
  measurement against the bare `node:24-alpine` base alone is 172,400 KiB
  (168.4 MiB). The application therefore adds about 1,432 KiB
  (1.4 MB) on top of the base image, which matches the bundle size almost
  exactly.
- `docker history` attributes 1.47 MB to the `COPY … ./dist/main.mjs` layer
  and 12.3 kB to the generated `./package.json` (the `name`/`version` pair
  the runtime reads); every other instruction (`ENV`, `ARG`, `USER`,
  `EXPOSE`, `HEALTHCHECK`, `CMD`) is 0 B, as expected for metadata-only
  instructions. Unlike the aggregate `docker image inspect` value, these
  per-layer numbers for locally built layers match the real file sizes.
- `packages/node-service/dist/main.mjs` is 1,453,228 bytes (1.4 MB)
  uncompressed, built with `esbuild --bundle --platform=node --format=esm
--target=node24 --sourcemap`. The companion source map
  (`dist/main.mjs.map`, 2.1 MB) is produced by the `bundle` script for local
  debugging but is not copied into the runtime stage, per the Dockerfile's
  `COPY --from=build … dist/main.mjs` (the map is never referenced, so
  leaving it out costs nothing at runtime).
- The runtime image has no `node_modules` directory and no pnpm store: the
  esbuild bundle inlines every dependency (`fastify` and its transitive
  dependencies), so nothing beyond the bundle and the two-field
  `package.json` needs to be copied from the `build` stage.
- Both acceptance-criterion figures — the misleading 58.8 MB from `docker
image inspect` and the verified 178.0 MB uncompressed footprint — are
  under the roadmap's 200 MB budget, but only the second one is the correct
  reading of "uncompressed": it leaves about 22 MB (11 percent) of headroom,
  not 141 MB.

## What it means for rljson users

- `docker image inspect --format '{{.Size}}'` is not a reliable way to check
  an "under N MB uncompressed" budget on a machine using the containerd
  image store (Docker Desktop's default since several releases). Measuring
  the size a user's laptop actually stores it at requires `du -sx /` inside
  a running container, or an image tool that reads the OCI manifest's
  uncompressed layer sizes (`docker manifest inspect` gives compressed
  sizes too; `docker buildx imagetools inspect --raw` and reading `diffIds`
  against locally cached blobs is the closest built-in equivalent, but is
  more involved than a one-line command).
- The `node:24-alpine` base is responsible for essentially the entire
  footprint (168.4 of 169.8 MiB, 99.2 percent). Shrinking the bundle further
  will not move the needle; only a smaller or absent Node runtime will
  (see candidates below).
- The multi-stage split (`base` → `deps` → `build` → `runtime`) works as
  intended: no pnpm store, no TypeScript sources, no dev dependencies and no
  `node_modules` reach the runtime stage, and esbuild bundling means the
  `dependencies` field in `packages/node-service/package.json` (currently
  just `fastify`) never has to be installed in the final image either.

## Candidates for upstream issues

- None found in `@rljson/*` packages; this finding is about Docker/BuildKit
  and the esbuild bundle, not the rljson libraries.
- Recorded here as the starting point for slice E2 ("Single executable
  image", depends on A4): with the base image at ~168 MiB and the
  application at ~1.4 MiB, a Node SEA on a `scratch` base with only the musl
  libraries the SEA binary needs is the only way to meaningfully shrink
  below the current ~170 MiB, since the alpine base itself is already the
  dominant cost.

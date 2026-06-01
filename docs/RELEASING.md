# Releasing claudeline

`claudeline` publishes to npm with **OIDC trusted publishing** — there is
**no `NPM_TOKEN`** to create, store, or rotate. Each publish authenticates with a
short-lived, workflow-scoped credential minted by GitHub Actions' OIDC. The
pipeline mirrors the hardened `arcasilesgroup/ai-engineering` release pattern.

## Security properties

| Control | How |
|---|---|
| No long-lived secret | OIDC trusted publishing — nothing to leak or expire |
| Supply-chain pinning | every action pinned to a full commit SHA |
| Least privilege | `contents: read` by default; `id-token`/`attestations`/`contents: write` granted per job |
| Build once | one `build` job packs the tarball; `publish-npm` ships that exact artifact |
| Provenance | npm registry provenance (auto via OIDC) for the package; GitHub build-provenance attestations for the binaries |
| No concurrent releases | `concurrency` group keyed on the tag |
| Gated publish | the `npm` GitHub Environment carries deployment protection rules |

## One-time setup

`@arcasilesgroup/claudeline` already exists on npm, so there is **no bootstrap
publish** — only the trusted-publisher wiring. After this, the expiring
`NPM_TOKEN` can be deleted from the repo secrets.

### 1. Configure the trusted publisher on npmjs.com

1. Open `https://www.npmjs.com/package/@arcasilesgroup/claudeline/access`.
2. Under **Trusted Publisher**, choose **GitHub Actions** and set:
   - Organization / user: `arcasilesgroup`
   - Repository: `claudeline`
   - Workflow filename: `release.yml`
   - Environment: `npm`
3. Save.

### 2. Create the `npm` GitHub Environment

Repo **Settings → Environments → New environment → `npm`**. Optionally add
required reviewers or restrict it to release tags. The `publish-npm` job targets
this environment, so its protection rules gate every publish.

### 3. Remove the stale secret

Once a release has published successfully via OIDC, delete the old token:
`Settings → Secrets and variables → Actions → NPM_TOKEN → Remove`.

## Cutting a release

1. Bump `version` in `package.json` (the `VERSION` constant is sourced from it).
2. Move the `[Unreleased]` CHANGELOG section under the new `[x.y.z]` heading.
3. Merge to `main`.
4. Publish a GitHub Release with tag `vX.Y.Z` (must equal `package.json`).

The release event triggers `release.yml`:

- **build** — tests, typecheck, bundle, `npm pack`, SHA256, upload artifact.
- **publish-npm** — OIDC publish of the packed tarball (provenance automatic).
- **binaries** — cross-compiled binaries (darwin/linux/windows), each with a
  build-provenance attestation and a `.sha256`, uploaded to the Release.

### Recovery / re-publish

Use **Run workflow** (`workflow_dispatch`) on the Release workflow and pass the
tag (e.g. `v0.4.5`) to re-run a release without re-cutting the GitHub Release.

## Verifying a published release

```bash
npm view @arcasilesgroup/claudeline version
npm view @arcasilesgroup/claudeline dist.attestations   # provenance present
gh attestation verify claudeline-linux-x64 --repo arcasilesgroup/claudeline
```

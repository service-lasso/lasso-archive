# lasso-archive

Release-backed optional archive utility provider for Service Lasso.

`lasso-archive` packages the official 7-Zip console tools as the `@archive` provider. Service Lasso core does not need this provider for normal release artifacts that use `zip`, `tar.gz`, or `tgz`; those are handled by the runtime's built-in extraction path. Use `@archive` only when a consuming service needs external archive tooling for formats such as `7z`, `rar`, `xz`, split archives, or legacy install flows.

Service Lasso-created archive artifacts default to `.7z`. The packaged provider includes `SERVICE-LASSO-PROVIDER-CONTRACT.json`, a machine-readable contract that names the supported archive operations, default argument shapes, success metadata fields, and deterministic failure codes for core backup, export, and restore flows.

## Service Contract

- Service id: `@archive`
- Role: `provider`
- Upstream: 7-Zip `26.01`
- Default command: `7za.exe` on Windows, `7zz` on Linux/macOS
- No daemon is started; installing/configuring the provider makes the tool path available through global env.

Exported global env:

| Name | Value |
| --- | --- |
| `ARCHIVE_HOME` | installed artifact root |
| `ARCHIVE_TOOL` | installed platform command |
| `ARCHIVE_PROVIDER_CONTRACT` | path to `SERVICE-LASSO-PROVIDER-CONTRACT.json` in the installed artifact root |
| `SEVENZIP_HOME` | installed artifact root |
| `SEVENZIP` | installed platform command |

## Provider Operations

Core resolves `@archive`, reads `ARCHIVE_TOOL`, and invokes the installed command only after Service Lasso has validated source and destination workspace boundaries. The provider contract documents these operations:

| Operation | Default argv shape | Notes |
| --- | --- | --- |
| `create` | `a <archivePath> <sourcePath...> -t7z -y` | Creates a `.7z` archive from validated files/folders and returns format, size, checksum, and provider version metadata where practical. |
| `extract` | `x <archivePath> -o<targetDirectory> -y` | Extracts into a validated target folder for restore or validation flows. |
| `list` | `l <archivePath>` | Lists archive entries where the format supports it. |
| `test` | `t <archivePath>` | Verifies archive readability/integrity where the format supports it. |

Deterministic failure codes exposed by the contract are `archive.source_not_found`, `archive.invalid_or_unreadable`, `archive.unsupported_platform`, and `archive.provider_unavailable`. Core owns host path policy and redaction; archive encryption/password features are not authorization.

## Release Artifacts

Pushes to `main` create a timestamped `yyyy.m.d-<shortsha>` release with:

| Platform | Asset |
| --- | --- |
| Windows x64 | `lasso-archive-7zip-26.01-win32.zip` |
| Linux x64 | `lasso-archive-7zip-26.01-linux.tar.gz` |
| macOS universal console package | `lasso-archive-7zip-26.01-darwin.tar.gz` |

The release also includes `service.json` and `SHA256SUMS.txt`.

## Local Verification

```powershell
npm install
npm test
```

`npm test` packages the provider, extracts the package, verifies the package metadata, runs the 7-Zip command on the current platform, creates a `.7z` archive, extracts it, and confirms the extracted content.

## Source Notes

The package script downloads official 7-Zip release assets from `ip7z/7zip` release `26.01`, which is linked from the official 7-Zip download page.

# Archive Provider Contract

`@archive` exposes a release-backed 7-Zip command plus a packaged contract file:

```text
SERVICE-LASSO-PROVIDER-CONTRACT.json
```

Service Lasso core should resolve `@archive`, read `ARCHIVE_TOOL`, and use the contract file to keep backup, export, and restore/archive flows on a stable provider boundary. Core remains responsible for workspace-boundary validation, action permissions, audit, and redaction before invoking the provider.

## Contract Summary

- Contract version: `service-lasso.archive-provider.v1`
- Service id: `@archive`
- Provider: `lasso-archive`
- Default Service Lasso-created archive format: `7z`
- Command env: `ARCHIVE_TOOL`
- Contract env: `ARCHIVE_PROVIDER_CONTRACT`

## Operations

| Operation | Argv shape | Success metadata |
| --- | --- | --- |
| `create` | `a <archivePath> <sourcePath...> -t7z -y` | `archivePath`, `format`, `sizeBytes`, `sha256`, `providerVersion` |
| `extract` | `x <archivePath> -o<targetDirectory> -y` | `targetDirectory`, `format`, `providerVersion` |
| `list` | `l <archivePath>` | `entries`, `format`, `providerVersion` |
| `test` | `t <archivePath>` | `ok`, `format`, `providerVersion` |

`create` defaults to `.7z` through `-t7z`. Consumers may request another supported format only when the action contract allows it and the selected 7-Zip package supports it.

## Failure Codes

| Code | Meaning |
| --- | --- |
| `archive.source_not_found` | A requested source path is missing after core validation. |
| `archive.invalid_or_unreadable` | The archive cannot be read, extracted, listed, or tested. |
| `archive.unsupported_platform` | No packaged artifact/command exists for the current platform. |
| `archive.provider_unavailable` | The provider is not installed, configured, or executable. |

## Safety

`lasso-archive` is not a host path policy engine. Service Lasso core validates source and destination paths first, avoids logging raw secret values, and records action/audit metadata. 7-Zip password or encryption options must not be used as a substitute for Service Lasso permissions, broker controls, or audit.

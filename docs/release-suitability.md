# Release Suitability

`@archive` is an optional provider. It is not part of the Service Lasso baseline because core extraction already handles `zip`, `tar.gz`, and `tgz` release artifacts without an external service.

Use this provider when a service manifest or install flow needs an external archive tool for formats outside the built-in path, for example:

- `.7z`
- `.rar`
- `.xz`
- split archives such as `.7z.001`
- legacy install flows that shell out to 7-Zip-compatible commands

The first release packages official 7-Zip `26.01` console tools for Windows x64, Linux x64, and macOS. Verification proves:

- package metadata identity
- released command path layout
- `7za` / `7zz` command execution
- real `.7z` create and extract roundtrip on the current platform

Future consumer proof should install `@archive` through Service Lasso and run a real service that depends on `ARCHIVE_TOOL` or `SEVENZIP`.

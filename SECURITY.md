# Security policy

## Supported versions

Only the `main` branch is maintained. Fixes are not backported.

## Reporting a vulnerability

Please report vulnerabilities privately through GitHub:
**Security → Report a vulnerability** on this repository
([direct link](https://github.com/a-3isa/school-system/security/advisories/new)).

Please do not open a public issue for a security problem.

Include what you can of:
- the part affected (API, staff dashboard, parent app or gateway firmware) and the route or file;
- steps to reproduce, or a proof of concept;
- the impact you expect.

I aim to acknowledge reports within a week. Once an issue is confirmed, a fix is
prepared on a private branch and you are credited in the advisory unless you prefer not to be.

## Scope

In scope: the code in this repository.

Out of scope: findings that need a compromised device or a stolen account, denial of
service by volume, and the Firebase web/Android/iOS API keys in `apps/parent`. Those keys
identify the Firebase project to the app and are public by design; access is governed by
Firebase and Google Cloud settings, not by keeping them secret.

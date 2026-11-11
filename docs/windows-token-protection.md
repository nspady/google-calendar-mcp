# Windows token-at-rest protection

## Selecting the format

`GOOGLE_CALENDAR_MCP_TOKEN_PROTECTION` accepts `plaintext` (the compatibility
default) or `dpapi` (Windows only). Set the same value in every process that
reads or writes the token file, including the standalone authentication command.
OAuth scope selection is unchanged by this feature.

DPAPI mode stores a versioned JSON envelope containing Windows DPAPI CurrentUser
ciphertext. Plaintext records, unsupported envelopes, tampering, and protection
failures are rejected without plaintext fallback. There is no automatic
plaintext-token migration.

When opting in, move an existing plaintext token file out of the configured
token location and re-authenticate with this build and `dpapi` enabled.
Keep any backup protected and remove it when no longer needed. Do not switch
the setting back to plaintext to read an encrypted file: the formats are not
interchangeable.

## Protection boundaries

DPAPI protects data at rest, not against malicious programs running as the same
Windows user. It is tied to the user's Windows protection context; moving tokens
to another user or computer requires re-authentication.

The helper uses the OS's Windows PowerShell executable in a hidden subprocess.
Sensitive data travels through stdin/stdout, not command-line arguments or
temporary plaintext files. Execution and output are bounded; process errors
are sanitized.

OAuth client JSON is not encrypted by this feature. Keep it outside Git and
shared storage, in a directory with appropriate ACLs.

## Optional directory ACL helper

Create a dedicated directory, then explicitly select it:

```powershell
.\scripts\protect-token-directory.ps1 -Path 'C:\CalendarCredentials'
```

The helper disables inherited directory ACLs and grants full access only to the
current user, SYSTEM, and Administrators. It rejects links/reparse-point
directories. New files inherit the restrictive ACL.

It does not rewrite explicit ACLs on existing files. Review those separately
before placing real credentials or tokens in the directory. The helper changes
only the named directory and is not run automatically.

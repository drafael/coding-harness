# Environment Discovery and Installation Guidance

Discover what is available before asking the user to install anything or declaring a claim unverified. Keep discovery local, read-only, and relevant to the task unless remote access is already approved.

## Establish the execution platform

Use host-provided metadata first, then native read-only queries where available to identify:

- OS family and version, including distribution when installation steps depend on it;
- CPU architecture and any relevant emulation;
- current shell or execution interface and its quoting/path conventions;
- whether commands run on the workstation, inside a sandbox/container, or on another host.

Do not infer the OS from a path alone, assume a Unix shell, or use the workstation's package manager to provision a different execution host. If platform details cannot be observed, ask only for the missing information needed to proceed. Distinguish agent permissions from capabilities the user may have outside the agent's sandbox.

## Discover capabilities, not an inventory of everything

1. Map the claim to required capabilities: a language runtime, database client, service runtime, HTTP client, document parser, or CI integration, for example.
2. Inspect repository wrappers, runtime pins, existing test commands, and setup documentation. These are starting points, not proof that tools are installed or usable.
3. Resolve relevant executables through the actual shell/interface and inspect their supported version/help output. Distinguish real executables from aliases or wrappers. Do not use a package runner that may download or install a missing tool as an availability probe.
4. Check the needed capability, not merely presence. A client may exist while its service is stopped, its version is incompatible, its target is remote, or access is denied. Establish the target before connecting; remote checks still require approval.
5. Prefer a working installed tool, standard-library client, or host-provided integration over a new dependency. An HTTP claim need not require a specific HTTP CLI; a database claim need not require containers if another isolated instance can exercise it.

Summarize material observations as: capability → detected tool/interface and version → execution target → usable/missing/blocked → claim it can test. Include the concrete reason for a blocked capability. Avoid broad filesystem scans, complete environment dumps, credential-store enumeration, or probing unrelated network services.

Reuse these observations within the task. Recheck when the target/configuration changes or a failed command contradicts them; do not treat an old machine snapshot as current evidence.

## Explain and provide installation instructions

When no existing capability suffices, provide a small, actionable recommendation rather than only saying “install a runtime”:

- **Claim and gap:** what remains uncertain, what capability is missing, and why inspection or available substitutes do not establish it.
- **Recommended tool:** why this tool and compatible version fit the detected OS/architecture and repository. Offer a simpler existing alternative when one actually works.
- **Installation steps:** ready-to-run commands for the detected shell and existing package manager, or official installer steps when appropriate. Consult official documentation for the relevant platform/version. Do not invent package names, URLs, flags, or assume a package manager is installed. If instructions cannot be checked, label them unverified rather than presenting them as tested.
- **Effects and prerequisites:** downloads, permissions/elevation, service startup, configuration changes, disk/cost implications, or a restart when material. Prefer the least invasive supported installation; do not change global defaults unnecessarily.
- **Post-install check:** the version/capability/readiness checks that will establish whether the tool is usable. Identify which environment must run them.
- **Verification use:** the planned operations, fixtures, assertions, and expected evidence. Explain what the tool will not prove and how disposable resources will be removed.

Use explicit placeholders for user-supplied values, never credentials. Do not suggest disabling security controls or executing an unreviewed downloaded script merely to bypass an installation failure.

Providing instructions does not install the tool. Let the user perform the steps, or obtain explicit permission before executing them. Existing approval can cover specified installations but not unrelated upgrades or host repairs. After installation, recheck actual availability and run the planned verification within its approved scope; do not assume installation itself verifies the claim.

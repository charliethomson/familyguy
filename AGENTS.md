# AGENTS

A small Discord bot (see README.md). It has no `standards/` submodule; the fleet rules it
follows live in `charliethomson/standards`, chiefly `docs/ci-cd.md` and `docs/versioning.md`.

Deployed by the homelab repo's `bullshit` Komodo stack, which runs
`ghcr.io/charliethomson/familyguyfunnymomentsbot:main`.

## CI (Woodpecker)

CI is Woodpecker at `woodpecker.dev.thmsn.dev`; there is no `.github/workflows/`.

| Pipeline | Does | Publishes |
|---|---|---|
| `.woodpecker/bot.build.yml` | `docker build` of `Dockerfile` (root context) | from `main`: `:main` and `:<version>`; from any push/manual run: `:sha-<commit>`. PRs build only. |

Version is `scripts/ci/version.sh`: `<tag MAJOR.MINOR>.<commit count>`, `0.0.<count>` while
the repo has no `vN.N` tag.

None of the following is representable in a file here, so it is written down because
nothing else will record it:

| Thing | Where | Why it matters |
|---|---|---|
| **Repo enabled** | Woodpecker → Add repository | Nothing runs until it is. |
| **Trusted flag** | Repo → Settings → Project → Trusted | The `/var/run/docker.sock` mount needs it. |
| **Fork PR approval** | Repo → Settings → Project → approval for forked PRs | The repo is **public**. Fork PRs must not run on the agents unapproved. |
| **Agent label** | `platform: linux/amd64` (auto-advertised by the Linux docker agents) | A label no agent carries never schedules, and fails silently rather than red. |
| **Crons** | none | |
| **Required checks** | GitHub branch protection | `ci/woodpecker/pr/bot.build`, if protection is turned on. |

Secrets, **org-level** (`charliethomson`), provisioned by hand in the UI:

| Secret | Events it is exposed to | Used by |
|---|---|---|
| `ghcr_token` | manual, push | the `publish` step only (`write:packages`) |

The PR step names no secret at all. Keep it that way: a public repo's PR pipeline runs code
from strangers, and Woodpecker fails to compile a step that names a secret its event can't
see anyway. That's why `build` (PRs) and `publish` (push/manual) are separate steps running
the same commands.

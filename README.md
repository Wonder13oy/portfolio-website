# Portfolio website

A static site on GitHub Pages that refreshes itself from GitHub. A workflow runs daily and on every push: it generates `site/data/portfolio.json` from the GitHub API, then deploys `site/`.

## Privacy model

The generated JSON, the source of this repo and the Actions logs are all public. Organisation repos are private, so:

- Only repos listed in `content/org-projects.json` are published. A new org repo stays hidden until it is added.
- That file refers to repos by numeric ID and gives each one a public title and summary, so real repo names are not stored here.
- For each listed repo, the output holds the curated text, languages, your commit counts and your first and last commit months. Commit messages, READMEs, file names and repo links are never fetched into the output.
- The build fails if the organisation slug, a real org repo name or an entry in the optional `PORTFOLIO_DENYLIST` secret appears in anything published. Use that secret, comma-separated, for client names.

## Everyday edits

| To change | Edit |
| --- | --- |
| Bio, skills, links, journey descriptions | `content/profile.json` |
| Banner title, journey roles and dates | `content/Positions.csv` (see below) |
| Featured or hidden personal repos | `content/personal.json` |
| Published org projects | `content/org-projects.json` |

Role labels are derived from commit share. To override one, add `"role": "..."` to its entry in `content/org-projects.json`.

To see org repo IDs and which are published (this prints private names, so run it locally only):

```bash
GH_TOKEN=$(gh auth token) npm run org:list
```

## Updating from LinkedIn

LinkedIn has no API for reading your own work history, so this step is manual.

1. On LinkedIn, go to Settings & Privacy > Data privacy > Get a copy of your data, and request an archive that includes your positions.
2. When LinkedIn emails you, extract `Positions.csv` from the archive and replace `content/Positions.csv` with it. Commit only that file, because this repo is public and the rest of the archive is private.
3. Push. The banner uses your latest current title, and new employers appear in the journey automatically.

To add a description or a different display name for an employer, add an entry to `experience` in `content/profile.json` with `linkedinCompany` set to the company name exactly as it appears in the CSV.

## Run locally

Requires Node 22 or newer.

```bash
GH_TOKEN=$(gh auth token) npm run data
```

```bash
npm run serve
```

Then open <http://localhost:4321>.

## Deployment setup

1. Create a fine-grained token with Nielsen-Sports-South-Africa as resource owner, access to all repositories, and read-only Contents and Metadata permissions.
2. Save it as the repository secret `PORTFOLIO_GH_TOKEN`.
3. Set Settings > Pages > Source to **GitHub Actions** before pushing.

If the token expires, the workflow fails and the last good deployment stays live.

// Builds site/data/portfolio.json from the GitHub GraphQL API.
//
// Everything written to that file is public, and so are the Actions logs of
// this repo. Organisation repo names must therefore never reach the output
// or the console when running in CI: org repos are matched by numeric ID, the
// output is assembled field by field, and a leak check fails the build.

import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const LOGIN = 'Wonder13oy';
const ORG = 'Nielsen-Sports-South-Africa';
const OUTPUT = 'site/data/portfolio.json';
const POSITIONS = 'content/Positions.csv';
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const IS_CI = Boolean(process.env.CI);
const LIST_ONLY = process.argv.includes('--list');

const token = process.env.GH_TOKEN;
if (!token) {
	console.error('GH_TOKEN is not set. Locally, run: GH_TOKEN=$(gh auth token) npm run data');
	process.exit(1);
}
if (LIST_ONLY && IS_CI) {
	console.error('--list prints private repo names and must not run in CI.');
	process.exit(1);
}

async function graphql(query, variables) {
	const response = await fetch('https://api.github.com/graphql', {
		method: 'POST',
		headers: { Authorization: `Bearer ${token}`, 'User-Agent': LOGIN },
		body: JSON.stringify({ query, variables }),
	});
	if (!response.ok) throw new Error(`GitHub API returned HTTP ${response.status}`);
	const { data, errors } = await response.json();
	if (errors?.length) {
		// GraphQL error messages can quote repo names.
		const detail = IS_CI ? errors.map((e) => e.type).join(', ') : JSON.stringify(errors);
		throw new Error(`GitHub GraphQL error: ${detail}`);
	}
	return data;
}

const REPO_FIELDS = `
	databaseId name description url homepageUrl createdAt pushedAt stargazerCount
	primaryLanguage { name }
	repositoryTopics(first: 10) { nodes { topic { name } } }
	languages(first: 5, orderBy: { field: SIZE, direction: DESC }) { nodes { name } }
	defaultBranchRef { target { ... on Commit { history { totalCount } } } }
`;

async function paginate(query, variables, pick) {
	const items = [];
	let after = null;
	do {
		const connection = pick(await graphql(query, { ...variables, after }));
		items.push(...connection.nodes);
		after = connection.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null;
	} while (after);
	return items;
}

const fetchPersonalRepos = () =>
	paginate(
		`query($login: String!, $after: String) {
			user(login: $login) {
				repositories(first: 100, after: $after, privacy: PUBLIC, isFork: false, ownerAffiliations: OWNER) {
					pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} }
				}
			}
		}`,
		{ login: LOGIN },
		(data) => data.user.repositories,
	);

const fetchOrgRepos = () =>
	paginate(
		`query($org: String!, $after: String) {
			organization(login: $org) {
				repositories(first: 100, after: $after) {
					pageInfo { hasNextPage endCursor } nodes { ${REPO_FIELDS} }
				}
			}
		}`,
		{ org: ORG },
		(data) => data.organization.repositories,
	);

// Only commit dates are requested. Commit messages are never fetched.
async function fetchMyCommitDates(owner, name, authorId) {
	const dates = [];
	let after = null;
	do {
		const data = await graphql(
			`query($owner: String!, $name: String!, $authorId: ID!, $after: String) {
				repository(owner: $owner, name: $name) {
					defaultBranchRef { target { ... on Commit {
						history(first: 100, after: $after, author: { id: $authorId }) {
							pageInfo { hasNextPage endCursor } nodes { committedDate }
						}
					} } }
				}
			}`,
			{ owner, name, authorId, after },
		);
		const history = data.repository.defaultBranchRef?.target.history;
		if (!history) break;
		dates.push(...history.nodes.map((node) => node.committedDate));
		after = history.pageInfo.hasNextPage ? history.pageInfo.endCursor : null;
	} while (after);
	return dates.sort();
}

async function mapLimit(items, limit, task) {
	const results = new Array(items.length);
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;
			results[index] = await task(items[index], index);
		}
	};
	await Promise.all(Array.from({ length: limit }, worker));
	return results;
}

const totalCommits = (repo) => repo.defaultBranchRef?.target.history.totalCount ?? 0;
const toMonth = (date) => (date ? date.slice(0, 7) : null);
const readJson = async (path) => JSON.parse(await readFile(path, 'utf8'));

function roleFor(mine, total) {
	if (total > 0 && mine === total) return 'Sole contributor';
	return mine / total >= 0.5 ? 'Lead contributor' : 'Contributor';
}

function addToYears(years, dates, key) {
	for (const date of dates) {
		const year = date.slice(0, 4);
		years[year] ??= { year: Number(year), org: 0, personal: 0 };
		years[year][key] += 1;
	}
}

function parseCsv(text) {
	const rows = [[]];
	let field = '';
	let quoted = false;
	for (let i = 0; i < text.length; i += 1) {
		const char = text[i];
		if (quoted) {
			if (char === '"' && text[i + 1] === '"') {
				field += '"';
				i += 1;
			} else if (char === '"') {
				quoted = false;
			} else {
				field += char;
			}
		} else if (char === '"') {
			quoted = true;
		} else if (char === ',' || char === '\n') {
			rows.at(-1).push(field);
			field = '';
			if (char === '\n') rows.push([]);
		} else if (char !== '\r') {
			field += char;
		}
	}
	rows.at(-1).push(field);
	return rows.filter((row) => row.some(Boolean));
}

async function readPositions() {
	const rows = parseCsv((await readFile(POSITIONS, 'utf8')).replace(/^﻿/, ''));
	const headerIndex = rows.findIndex((row) => row.includes('Company Name') && row.includes('Title'));
	const header = rows[headerIndex];
	if (headerIndex < 0 || !header.includes('Started On') || !header.includes('Finished On')) {
		throw new Error(`${POSITIONS} is missing the Company Name, Title, Started On or Finished On column.`);
	}
	const column = (row, name) => (row[header.indexOf(name)] ?? '').trim();
	const positions = rows.slice(headerIndex + 1).map((row) => ({
		company: column(row, 'Company Name'),
		title: column(row, 'Title'),
		started: column(row, 'Started On'),
		finished: column(row, 'Finished On'),
	}));
	if (!positions.length) throw new Error(`${POSITIONS} has no positions.`);
	return positions;
}

// LinkedIn dates look like "Jan 2023", or just "2023".
function dateKey(date) {
	const [, month, year] = date.match(/^(?:([A-Za-z]{3})[a-z]*\s+)?(\d{4})$/) ?? [];
	if (!year) throw new Error(`Unrecognised date in ${POSITIONS}: "${date}"`);
	return Number(year) * 12 + (month ? MONTHS.indexOf(month.toLowerCase()) : 0);
}

const newestFirst = (a, b) => Boolean(a.finished) - Boolean(b.finished) || dateKey(b.started) - dateKey(a.started);

// Roles and dates come from LinkedIn. Display names and descriptions come from
// profile.json, matched on linkedinCompany; entries without one are kept as they are.
function buildExperience(positions, experience) {
	const details = new Map(experience.filter((e) => e.linkedinCompany).map((e) => [e.linkedinCompany.toLowerCase(), e]));
	const groups = Map.groupBy([...positions].sort(newestFirst), (position) => position.company.toLowerCase());
	for (const [company, entry] of details) {
		if (!groups.has(company)) console.warn(`No LinkedIn positions match "${entry.linkedinCompany}" in profile.json.`);
	}
	const fromLinkedIn = [...groups].map(([company, jobs]) => ({
		place: details.get(company)?.place ?? jobs[0].company,
		roles: jobs.map((job) => ({ title: job.title, period: `${job.started} – ${job.finished || 'Present'}` })),
		body: details.get(company)?.body,
	}));
	const manual = experience.filter((e) => !e.linkedinCompany).map(({ place, body }) => ({ place, roles: [], body }));
	return [...fromLinkedIn, ...manual];
}

function printOrgList(orgRepos, curated) {
	const listed = new Set(curated.map((entry) => entry.id));
	for (const repo of [...orgRepos].sort((a, b) => b.pushedAt.localeCompare(a.pushedAt))) {
		const status = listed.has(repo.databaseId) ? 'published' : 'hidden   ';
		console.log(`${status}  ${repo.databaseId}  ${repo.name}`);
	}
}

// Fails on real org repo names anywhere in what gets published. The report
// names repo IDs only, because the log of a failed run is public too.
async function assertNoLeaks(output, orgRepos) {
	const sources = new Map([[OUTPUT, output]]);
	for (const directory of ['content', 'site']) {
		for (const entry of await readdir(directory, { recursive: true, withFileTypes: true })) {
			const path = join(entry.parentPath, entry.name);
			if (entry.isFile() && path !== OUTPUT && /\.(json|html|css|js|csv)$/.test(path)) {
				sources.set(path, await readFile(path, 'utf8'));
			}
		}
	}

	const forbidden = [
		{ label: 'the organisation slug', term: ORG },
		...orgRepos.map((repo) => ({ label: `org repo ${repo.databaseId}`, term: repo.name })),
		...(process.env.PORTFOLIO_DENYLIST ?? '')
			.split(',')
			.map((term) => term.trim())
			.filter(Boolean)
			.map((term, index) => ({ label: `denylist entry ${index + 1}`, term })),
	];

	const leaks = [];
	for (const [path, text] of sources) {
		const haystack = text.toLowerCase();
		for (const { label, term } of forbidden) {
			if (haystack.includes(term.toLowerCase())) leaks.push(`${path}: ${label}`);
		}
	}
	if (leaks.length) {
		console.error(`Leak check failed:\n${leaks.join('\n')}`);
		process.exit(1);
	}
}

const [profile, positions, personalConfig, curated, personalRepos, orgRepos, { user }] = await Promise.all([
	readJson('content/profile.json'),
	readPositions(),
	readJson('content/personal.json'),
	readJson('content/org-projects.json'),
	fetchPersonalRepos(),
	fetchOrgRepos(),
	graphql('query($login: String!) { user(login: $login) { id } }', { login: LOGIN }),
]);

if (LIST_ONLY) {
	printOrgList(orgRepos, curated);
	process.exit(0);
}

const orgById = new Map(orgRepos.map((repo) => [repo.databaseId, repo]));
const missing = curated.filter((entry) => !orgById.has(entry.id));
if (missing.length) {
	throw new Error(`Curated IDs not found in the organisation: ${missing.map((e) => e.id).join(', ')}`);
}

const years = {};
const languageCommits = new Map();
const addLanguage = (language, commits) => {
	if (!language) return;
	const current = languageCommits.get(language.name) ?? { name: language.name, commits: 0 };
	current.commits += commits;
	languageCommits.set(language.name, current);
};

const orgProjects = await mapLimit(curated, 4, async (entry) => {
	const repo = orgById.get(entry.id);
	const dates = await fetchMyCommitDates(ORG, repo.name, user.id);
	const total = totalCommits(repo);
	addToYears(years, dates, 'org');
	addLanguage(repo.languages.nodes[0], dates.length);

	// Allowlist: only these fields are published for an organisation repo.
	return {
		title: entry.title,
		summary: entry.summary,
		category: entry.category,
		languages: repo.languages.nodes.map((language) => language.name),
		firstCommit: toMonth(dates[0]),
		lastCommit: toMonth(dates.at(-1)),
		commits: { mine: dates.length, total, share: total ? Math.round((dates.length / total) * 100) : 0 },
		role: entry.role ?? roleFor(dates.length, total),
	};
});

const hidden = new Set(personalConfig.hidden);
const visibleRepos = personalRepos.filter((repo) => !hidden.has(repo.name));
const personal = await mapLimit(visibleRepos, 6, async (repo) => {
	const dates = await fetchMyCommitDates(LOGIN, repo.name, user.id);
	addToYears(years, dates, 'personal');
	addLanguage(repo.primaryLanguage, dates.length);
	return {
		name: repo.name,
		title: repo.name.replace(/[-_]+/g, ' '),
		description: repo.description,
		url: repo.url,
		homepage: repo.homepageUrl || null,
		stars: repo.stargazerCount,
		language: repo.primaryLanguage?.name ?? null,
		topics: repo.repositoryTopics.nodes.map((node) => node.topic.name),
		lastPushed: repo.pushedAt.slice(0, 10),
		commits: dates.length,
	};
});
personal.sort((a, b) => b.lastPushed.localeCompare(a.lastPushed));

const featured = personalConfig.featured.flatMap((name) => personal.filter((repo) => repo.name === name));

const portfolio = {
	generatedAt: new Date().toISOString(),
	profile: {
		...profile,
		headline: [...positions].sort(newestFirst)[0].title,
		experience: buildExperience(positions, profile.experience),
	},
	stats: {
		orgProjects: orgProjects.length,
		orgCommits: orgProjects.reduce((sum, project) => sum + project.commits.mine, 0),
		personalRepos: personal.length,
		personalCommits: personal.reduce((sum, repo) => sum + repo.commits, 0),
		activity: Object.values(years).sort((a, b) => a.year - b.year),
		languages: [...languageCommits.values()].sort((a, b) => b.commits - a.commits).slice(0, 8),
	},
	orgProjects,
	featured,
	archive: personal,
};

const output = `${JSON.stringify(portfolio, null, '\t')}\n`;
await assertNoLeaks(output, orgRepos);
await mkdir(dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, output);
console.log(`Wrote ${OUTPUT}: ${orgProjects.length} organisation projects, ${personal.length} personal repos.`);

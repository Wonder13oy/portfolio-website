// Renders the page from data/portfolio.json, which the deploy workflow regenerates daily.
// All values go in through textContent, because repo descriptions are free text.

const $ = (selector) => document.querySelector(selector);

function el(tag, props = {}, ...children) {
	const node = document.createElement(tag);
	for (const [key, value] of Object.entries(props)) {
		if (key === 'style') node.style.cssText = value;
		else if (key.startsWith('aria-') || key === 'role') node.setAttribute(key, value);
		else node[key] = value;
	}
	node.append(...children.filter((child) => child !== null && child !== undefined));
	return node;
}

const number = new Intl.NumberFormat('en-ZA');
const monthFormat = new Intl.DateTimeFormat('en-ZA', { month: 'short', year: 'numeric', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
const formatMonth = (month) => monthFormat.format(new Date(`${month}-01T00:00:00Z`));
const formatDay = (date) => dayFormat.format(new Date(date));

function formatRange(first, last) {
	if (!first) return '';
	return first === last ? formatMonth(first) : `${formatMonth(first)} – ${formatMonth(last)}`;
}

function renderProfile({ profile, stats, orgProjects }) {
	document.title = `${profile.name} | ${profile.headline}`;
	$('#headline').textContent = profile.headline;
	$('#name').textContent = profile.name;
	$('#intro').textContent = profile.intro;

	const allCommits = stats.orgCommits + stats.personalCommits;
	const tiles = [
		[number.format(allCommits), 'commits shipped'],
		[number.format(orgProjects.length), 'professional projects'],
		[number.format(stats.personalRepos), 'public repositories'],
		[stats.languages[0]?.name ?? '', 'most-used language'],
	];
	$('#stats').append(
		...tiles.map(([value, label]) => el('div', {}, el('dd', { textContent: value }), el('dt', { textContent: label }))),
	);

	$('#about-body').append(...profile.about.map((text) => el('p', { textContent: text })));
	$('#skills').append(
		...profile.skills.map((skill) =>
			el('article', {}, el('h3', { textContent: skill.title }), el('p', { textContent: skill.body })),
		),
	);

	$('#experience').append(
		...profile.experience.map((item) =>
			el(
				'li',
				{},
				el('h4', { textContent: item.place }),
				...item.roles.map((role) =>
					el(
						'p',
						{ className: 'job' },
						el('span', { className: 'job-title', textContent: role.title }),
						el('span', { className: 'when', textContent: role.period }),
					),
				),
				item.body ? el('p', { textContent: item.body }) : null,
			),
		),
	);

	const { email, linkedin, github } = profile.links;
	Object.assign($('#email'), { href: `mailto:${email}`, textContent: email });
	$('#linkedin').href = linkedin;
	$('#github').href = github;
}

const SERIES = [
	{ key: 'org', label: 'Professional', className: 'series-org' },
	{ key: 'personal', label: 'Personal', className: 'series-personal' },
];

function fillYears(activity) {
	const byYear = new Map(activity.map((row) => [row.year, row]));
	const years = [];
	for (let year = activity[0].year; year <= activity.at(-1).year; year += 1) {
		years.push(byYear.get(year) ?? { year, org: 0, personal: 0 });
	}
	return years;
}

function renderChart(activity) {
	const years = fillYears(activity);
	const totals = years.map((row) => row.org + row.personal);
	const max = Math.max(...totals);
	const labelled = new Set([0, years.length - 1, totals.indexOf(max)]);

	$('#legend').append(
		...SERIES.map((series) =>
			el('li', {}, el('span', { className: `swatch ${series.className}` }), series.label),
		),
	);

	const tooltip = el('div', { className: 'tooltip', role: 'status', hidden: true });
	const columns = years.map((row, index) => {
		const total = totals[index];
		const segments = SERIES.filter((series) => row[series.key] > 0).map((series) =>
			el('span', {
				className: `segment ${series.className}`,
				style: `flex-grow: ${row[series.key]}`,
			}),
		);
		const description = `${row.year}: ${SERIES.map((s) => `${number.format(row[s.key])} ${s.label.toLowerCase()}`).join(', ')}`;
		const column = el(
			'button',
			{ type: 'button', className: 'column', 'aria-label': `${description} commits` },
			el(
				'span',
				{ className: 'bar-area' },
				labelled.has(index) && total > 0 ? el('span', { className: 'bar-value', textContent: number.format(total) }) : null,
				el('span', { className: 'bar', style: `height: ${(total / max) * 100}%` }, ...segments),
			),
			el('span', { className: 'bar-year', textContent: String(row.year) }),
		);

		const show = () => {
			tooltip.replaceChildren(
				el('strong', { textContent: String(row.year) }),
				...SERIES.map((series) =>
					el(
						'span',
						{ className: 'tooltip-row' },
						el('span', { className: `swatch ${series.className}` }),
						`${series.label}: ${number.format(row[series.key])}`,
					),
				),
			);
			tooltip.hidden = false;
			const left = column.offsetLeft + column.offsetWidth / 2;
			const limit = Math.min(left, column.parentElement.offsetWidth - tooltip.offsetWidth / 2);
			tooltip.style.left = `${Math.max(tooltip.offsetWidth / 2, limit)}px`;
		};
		const hide = () => {
			tooltip.hidden = true;
		};
		column.addEventListener('pointerenter', show);
		column.addEventListener('pointerleave', hide);
		column.addEventListener('focus', show);
		column.addEventListener('blur', hide);
		return column;
	});
	$('#chart').append(...columns, tooltip);

	const header = el('tr', {}, ...['Year', ...SERIES.map((s) => s.label)].map((text) => el('th', { scope: 'col', textContent: text })));
	const rows = years.map((row) =>
		el('tr', {}, el('th', { scope: 'row', textContent: String(row.year) }), ...SERIES.map((s) => el('td', { textContent: number.format(row[s.key]) }))),
	);
	$('#chart-table').append(el('table', {}, el('thead', {}, header), el('tbody', {}, ...rows)));
}

function renderOrgProjects(projects) {
	$('#org-projects').append(
		...projects.map((project) =>
			el(
				'li',
				{ className: 'ledger-row' },
				el(
					'div',
					{ className: 'ledger-main' },
					el('p', { className: 'tag', textContent: project.category }),
					el('h3', { textContent: project.title }),
					el('p', { className: 'summary', textContent: project.summary }),
					el('p', { className: 'mono-line', textContent: project.languages.join('  ·  ') }),
				),
				el(
					'div',
					{ className: 'ledger-meta' },
					el('p', { className: 'role', textContent: project.role }),
					el('p', { className: 'when', textContent: formatRange(project.firstCommit, project.lastCommit) }),
					el(
						'div',
						{
							className: 'meter',
							role: 'img',
							'aria-label': `${project.commits.share}% of commits`,
						},
						el('span', { style: `width: ${project.commits.share}%` }),
					),
					el('p', {
						className: 'mono-line',
						textContent: `${number.format(project.commits.mine)} of ${number.format(project.commits.total)} commits`,
					}),
				),
			),
		),
	);
}

function renderFeatured(repos) {
	$('#featured').append(
		...repos.map((repo) =>
			el(
				'a',
				{ className: 'card', href: repo.url, rel: 'noopener' },
				el('p', { className: 'tag', textContent: repo.language ?? 'Code' }),
				el('h3', { textContent: repo.title }),
				el('p', { className: 'summary', textContent: repo.description ?? '' }),
				el('p', { className: 'mono-line', textContent: `Updated ${formatDay(repo.lastPushed)}` }),
			),
		),
	);
}

function setupArchive(repos) {
	const search = $('#search');
	const language = $('#language');
	const sort = $('#sort');
	const languages = [...new Set(repos.map((repo) => repo.language).filter(Boolean))].sort();
	language.append(...languages.map((name) => el('option', { value: name, textContent: name })));

	const sorters = {
		recent: (a, b) => b.lastPushed.localeCompare(a.lastPushed),
		commits: (a, b) => b.commits - a.commits,
		name: (a, b) => a.title.localeCompare(b.title),
	};

	const update = () => {
		const query = search.value.trim().toLowerCase();
		const visible = repos
			.filter((repo) => !language.value || repo.language === language.value)
			.filter((repo) => `${repo.title} ${repo.name} ${repo.description ?? ''}`.toLowerCase().includes(query))
			.sort(sorters[sort.value]);

		$('#archive-rows').replaceChildren(
			...visible.map((repo) =>
				el(
					'tr',
					{},
					el(
						'td',
						{ className: 'repo-cell' },
						el('a', { href: repo.url, rel: 'noopener', textContent: repo.title }),
						repo.description ? el('p', { textContent: repo.description }) : null,
					),
					el('td', { className: 'mono-line', textContent: repo.language ?? '–' }),
					el('td', { className: 'mono-line num', textContent: number.format(repo.commits) }),
					el('td', { className: 'mono-line', textContent: formatDay(repo.lastPushed) }),
				),
			),
		);
		$('#result-count').textContent = `Showing ${visible.length} of ${repos.length} repositories`;
	};

	$('#filters').addEventListener('submit', (event) => event.preventDefault());
	search.addEventListener('input', update);
	language.addEventListener('change', update);
	sort.addEventListener('change', update);
	update();
}

function renderLanguages(languages) {
	const max = languages[0]?.commits ?? 1;
	$('#languages').append(
		...languages.map((language) =>
			el(
				'li',
				{},
				el('span', { className: 'language-name', textContent: language.name }),
				el('span', { className: 'language-track' }, el('span', { style: `width: ${(language.commits / max) * 100}%` })),
				el('span', { className: 'mono-line num', textContent: number.format(language.commits) }),
			),
		),
	);
}

async function main() {
	$('#year').textContent = String(new Date().getFullYear());
	const loadState = $('#load-state');
	try {
		const response = await fetch('data/portfolio.json', { cache: 'no-cache' });
		if (!response.ok) throw new Error(`HTTP ${response.status}`);
		const data = await response.json();

		renderProfile(data);
		renderChart(data.stats.activity);
		renderOrgProjects(data.orgProjects);
		renderFeatured(data.featured);
		setupArchive(data.archive);
		renderLanguages(data.stats.languages);
		$('#synced').textContent = `Synced from GitHub on ${formatDay(data.generatedAt)}`;
		loadState.remove();
	} catch (error) {
		console.error(error);
		loadState.replaceChildren(
			'Projects could not be loaded right now. ',
			el('a', { href: 'https://github.com/Wonder13oy', textContent: 'See them on GitHub instead.' }),
		);
	}
}

main();

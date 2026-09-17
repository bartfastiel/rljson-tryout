// @ts-check
import './components/animal-detail.js';
import './components/animals-list.js';
import './components/species-list.js';
import { fetchJson } from './api.js';
import { requiredElement } from './dom.js';
import { pathSegmentsFromHash } from './hash-route.js';
import { notFoundView } from './not-found-view.js';

const applicationName = 'Duckburg Pet Shop';
const defaultViewName = 'animals';

/** @type {Record<string, { title: string, render: () => HTMLElement }>} */
const views = {
  animals: {
    title: 'Animals',
    render: () => document.createElement('animals-list'),
  },
  species: {
    title: 'Species',
    render: () => document.createElement('species-list'),
  },
};

const main = requiredElement('main');
const navigationLinks = /** @type {NodeListOf<HTMLAnchorElement>} */ (
  document.querySelectorAll('nav a[data-view]')
);

const render = () => {
  const segments = pathSegmentsFromHash(location.hash);
  if (segments.length === 0) {
    location.replace(`#/${defaultViewName}`);
    return;
  }

  const [sectionName, animalId] = segments;
  const isAnimalDetail = sectionName === 'animals' && animalId !== undefined;
  const view = isAnimalDetail ? undefined : views[sectionName];

  document.title = isAnimalDetail
    ? `${views.animals.title} · ${applicationName}`
    : `${view?.title ?? 'Page not found'} · ${applicationName}`;
  for (const link of navigationLinks) {
    if (link.dataset.view === sectionName) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }

  if (isAnimalDetail) {
    const detail = document.createElement('animal-detail');
    detail.setAttribute('animal-id', animalId);
    main.replaceChildren(detail);
    return;
  }

  main.replaceChildren(
    view
      ? view.render()
      : notFoundView(`There is no page called "${sectionName}".`, {
          href: `#/${defaultViewName}`,
          text: `Back to ${views[defaultViewName].title}`,
        }),
  );
};

const showNodeName = async () => {
  const nodeName = requiredElement('#node-name');
  try {
    const health = /** @type {{ name: string }} */ (await fetchJson('/health'));
    nodeName.textContent = health.name;
  } catch {
    nodeName.textContent = 'unknown node';
  }
};

window.addEventListener('hashchange', render);
render();
await showNodeName();

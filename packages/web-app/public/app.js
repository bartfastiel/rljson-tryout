// @ts-check
import './components/species-list.js';
import { fetchJson } from './api.js';
import { element, requiredElement } from './dom.js';

const applicationName = 'Duckburg Pet Shop';
const defaultViewName = 'species';

/** @type {Record<string, { title: string, render: () => HTMLElement }>} */
const views = {
  species: {
    title: 'Species',
    render: () => document.createElement('species-list'),
  },
};

const main = requiredElement('main');
const navigationLinks = document.querySelectorAll('nav a[data-view]');

/**
 * Reads the view name from a hash such as `#/species` or `#/species/duck`.
 * Returns an empty string for a missing or bare hash.
 *
 * @param {string} hash
 */
const viewNameFromHash = (hash) =>
  hash.startsWith('#/') ? hash.slice(2).split('/')[0] : '';

/**
 * @param {string} viewName
 */
const notFoundView = (viewName) => {
  const view = element('section', 'not-found');
  const backLink = element(
    'a',
    'button',
    `Back to ${views[defaultViewName].title}`,
  );
  backLink.href = `#/${defaultViewName}`;
  view.append(
    element('h1', 'view-title', 'Page not found'),
    element('p', '', `There is no page called "${viewName}".`),
    backLink,
  );
  return view;
};

const render = () => {
  const viewName = viewNameFromHash(location.hash);
  if (viewName === '') {
    location.replace(`#/${defaultViewName}`);
    return;
  }

  const view = views[viewName];
  document.title = `${view?.title ?? 'Page not found'} · ${applicationName}`;
  for (const link of navigationLinks) {
    if (link.getAttribute('data-view') === viewName) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
  main.replaceChildren(view ? view.render() : notFoundView(viewName));
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
void showNodeName();

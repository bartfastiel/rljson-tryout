// @ts-check
import './components/animal-detail.js';
import './components/animals-list.js';
import './components/breeders-list.js';
import './components/invoice-detail.js';
import './components/invoice-form.js';
import './components/invoices-list.js';
import './components/network-view.js';
import './components/node-bar.js';
import './components/species-list.js';
import { requiredElement } from './dom.js';
import { pathSegmentsFromHash } from './hash-route.js';
import { notFoundView } from './not-found-view.js';
import { applicationName } from './view-helpers.js';

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
  breeders: {
    title: 'Breeders',
    render: () => document.createElement('breeders-list'),
  },
  invoices: {
    title: 'Invoices',
    render: () => document.createElement('invoices-list'),
  },
  network: {
    title: 'Network',
    render: () => document.createElement('network-view'),
  },
};

/**
 * Creates the element of a view that shows one entity, handing it the id
 * from the hash through the given attribute.
 *
 * @param {string} tagName
 * @param {string} attributeName
 * @param {string} id
 */
const entityView = (tagName, attributeName, id) => {
  const view = document.createElement(tagName);
  view.setAttribute(attributeName, id);
  return view;
};

/**
 * The page a hash's path segments select: a title for the tab and the
 * element to show. A section's second segment addresses one entity
 * (`#/animals/<id>`, `#/invoices/<id>`), except `#/invoices/new`, which is
 * the form for a new invoice. An unknown section gets the not-found page.
 *
 * @param {string[]} segments
 * @returns {{ title: string, element: HTMLElement }}
 */
const pageFor = (segments) => {
  const [sectionName, entityId] = segments;
  const addressesEntity = segments.length > 1;
  if (sectionName === 'animals' && addressesEntity) {
    return {
      title: views.animals.title,
      element: entityView('animal-detail', 'animal-id', entityId),
    };
  }
  if (sectionName === 'invoices' && entityId === 'new') {
    return {
      title: 'New invoice',
      element: document.createElement('invoice-form'),
    };
  }
  if (sectionName === 'invoices' && addressesEntity) {
    return {
      title: views.invoices.title,
      element: entityView('invoice-detail', 'invoice-id', entityId),
    };
  }
  if (!Object.hasOwn(views, sectionName)) {
    return {
      title: 'Page not found',
      element: notFoundView(`There is no page called "${sectionName}".`, {
        href: `#/${defaultViewName}`,
        text: `Back to ${views[defaultViewName].title}`,
      }),
    };
  }
  const view = views[sectionName];
  return { title: view.title, element: view.render() };
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

  const sectionName = segments[0];
  const page = pageFor(segments);
  document.title = `${page.title} · ${applicationName}`;
  for (const link of navigationLinks) {
    if (link.dataset.view === sectionName) {
      link.setAttribute('aria-current', 'page');
    } else {
      link.removeAttribute('aria-current');
    }
  }
  main.replaceChildren(page.element);
};

window.addEventListener('hashchange', render);
render();

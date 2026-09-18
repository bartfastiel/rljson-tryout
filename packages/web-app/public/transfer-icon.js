// @ts-check
import { element } from './dom.js';
import { transferActivity } from './transfer-activity.js';

const svgNamespace = 'http://www.w3.org/2000/svg';

/**
 * One loop of the fill rising from bottom to top, the `transfer-fill`
 * animation of the stylesheet. Icons that are created while a transfer
 * runs start with the phase the loop has at that moment, so an icon the
 * node bar rebuilds after a status refresh continues where the old one
 * was instead of restarting.
 */
const loopMs = 700;

/**
 * An arrow pointing up (upstream: data arriving from the partner) or
 * down (downstream: data going to the partner), in a 16 by 16 box.
 */
const arrowPaths = {
  upstream: 'M8 1.5 14 8h-3.5v6.5h-5V8H2z',
  downstream: 'M8 14.5 2 8h3.5V1.5h5V8H14z',
};

/**
 * The class an icon carries per state, on top of `transfer-icon`: the
 * running state is named by its side, so that a test and the stylesheet
 * can tell receiving from sending.
 */
const stateClasses = {
  upstream: {
    active: 'is-receiving',
    trailing: 'is-trailing',
    failed: 'is-failed',
  },
  downstream: {
    active: 'is-sending',
    trailing: 'is-trailing',
    failed: 'is-failed',
  },
};

/**
 * What assistive technology reads for an icon in a state.
 *
 * @param {import('./transfer-activity.js').TransferSide} side
 * @param {import('./transfer-activity.js').ActivityState} state
 * @param {string} nodeName
 */
const iconLabel = (side, state, nodeName) => {
  if (side === 'upstream') {
    return {
      idle: `upstream from ${nodeName}: idle`,
      active: `receiving from ${nodeName}`,
      trailing: `received from ${nodeName}`,
      failed: `receiving from ${nodeName} failed`,
    }[state];
  }
  return {
    idle: `downstream to ${nodeName}: idle`,
    active: `sending to ${nodeName}`,
    trailing: `sent to ${nodeName}`,
    failed: `sending to ${nodeName} failed`,
  }[state];
};

/**
 * The upstream or downstream icon of a partner node: an outlined arrow
 * with a fill on top that the stylesheet clips and animates while the
 * side is active. Carries the partner's id and name so that
 * `applyActivityTo` can find and label it; created idle, the caller
 * applies the current state once the icon is in the document.
 *
 * @param {import('./transfer-activity.js').TransferSide} side
 * @param {string} nodeId
 * @param {string} nodeName
 */
export const transferIcon = (side, nodeId, nodeName) => {
  const icon = element('span', `transfer-icon transfer-icon-${side}`);
  icon.setAttribute('role', 'img');
  icon.setAttribute('aria-label', iconLabel(side, 'idle', nodeName));
  icon.dataset.side = side;
  icon.dataset.nodeId = nodeId;
  icon.dataset.nodeName = nodeName;
  icon.dataset.state = 'idle';

  const svg = document.createElementNS(svgNamespace, 'svg');
  svg.setAttribute('viewBox', '0 0 16 16');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  for (const className of ['transfer-icon-outline', 'transfer-icon-fill']) {
    const path = document.createElementNS(svgNamespace, 'path');
    path.setAttribute('d', arrowPaths[side]);
    path.setAttribute('class', className);
    svg.append(path);
  }
  icon.append(svg);
  return icon;
};

/**
 * Whether the fill loop runs in a state: while a transfer runs and for
 * the trailing second after it completed.
 *
 * @param {string | undefined} state
 */
const isAnimating = (state) => state === 'active' || state === 'trailing';

/**
 * Brings every transfer icon below `root` to the state the activity
 * tracker has for its partner and side: the state class, the label, and
 * for an icon that starts animating the phase of the shared loop.
 *
 * @param {ParentNode} root
 */
export const applyActivityTo = (root) => {
  for (const icon of root.querySelectorAll('.transfer-icon')) {
    if (!(icon instanceof HTMLElement)) {
      continue;
    }
    const side = /** @type {import('./transfer-activity.js').TransferSide} */ (
      icon.dataset.side
    );
    const state = transferActivity.stateOf(icon.dataset.nodeId ?? '', side);
    const previous = icon.dataset.state;
    if (previous === state) {
      continue;
    }
    icon.dataset.state = state;
    icon.className = `transfer-icon transfer-icon-${side}`;
    if (state !== 'idle') {
      icon.classList.add(stateClasses[side][state]);
    }
    if (isAnimating(state) && !isAnimating(previous)) {
      icon.style.setProperty(
        '--transfer-phase',
        `${-Math.round(performance.now() % loopMs)}ms`,
      );
    }
    icon.setAttribute(
      'aria-label',
      iconLabel(side, state, icon.dataset.nodeName ?? ''),
    );
  }
};

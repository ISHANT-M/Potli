/** #/search: text search, time window, bags, list view and a lazy map. State lives in the URL. */
import type { ListingSummary, Paginated } from '../../../../shared/types';
import { API_BASE } from '../../lib/api';
import { formatDate, formatINR, formatTime } from '../../lib/format';
import { html, mount, type SafeHtml } from '../../lib/html';
import type { RouteDef } from '../../lib/router';
import { api } from '../../lib/session';
import { icon } from '../../ui/icons';
import {
  clampBags, daysLabel, defaultWindow, errorBox, hoursLabel, onLeave, publicPage, qs, skeleton, stars, toLocalInput, validDate,
} from './common';
import { showMap } from './map';

interface State {
  q: string;
  lat: string;
  lng: string;
  start: string;
  end: string;
  bags: number;
  view: 'list' | 'map';
}

const card = (item: ListingSummary, query: string): SafeHtml => html`<article class="cx-card" id="l-${item.id}" data-id="${item.id}">
  ${item.coverUrl ? html`<img class="cx-cover" loading="lazy" alt="" src="${API_BASE}${item.coverUrl}" />` : ''}
  <div class="cx-card-body">
    <h3><a href="#/listing/${item.id}${query}">${item.name}</a></h3>
    <p class="cx-muted">${[item.area, item.city].filter(Boolean).join(', ')}${item.distanceKm !== null ? ` · ${item.distanceKm} km away` : ''}</p>
    <p><strong>${formatINR(item.hourlyRatePaise)}</strong> /bag/hour · max ${formatINR(item.dailyCapPaise)}/day</p>
    <p class="cx-muted">${daysLabel(item.openDays)}, ${hoursLabel(item.openTime, item.closeTime)}</p>
    <p>${stars(item.ratingAverage, item.ratingCount)}${item.available !== null ? html` · <span class="${item.available > 0 ? 'cx-ok' : 'cx-bad'}">${item.available} ${item.available === 1 ? 'space' : 'spaces'} free</span>` : ''}</p>
  </div></article>`;

export const searchRoute: RouteDef = {
  path: '/search',
  title: 'Find storage',
  mount(el, ctx) {
    const defaults = defaultWindow();
    const state: State = {
      q: ctx.query.get('q')?.slice(0, 80) ?? '',
      lat: Number.isFinite(Number(ctx.query.get('lat'))) && ctx.query.get('lat') ? (ctx.query.get('lat') as string) : '',
      lng: Number.isFinite(Number(ctx.query.get('lng'))) && ctx.query.get('lng') ? (ctx.query.get('lng') as string) : '',
      start: validDate(ctx.query.get('start')) ?? defaults.start,
      end: validDate(ctx.query.get('end')) ?? defaults.end,
      bags: clampBags(ctx.query.get('bags')),
      view: ctx.query.get('view') === 'map' ? 'map' : 'list',
    };
    if (!state.lat || !state.lng) {
      state.lat = '';
      state.lng = '';
    }
    const usingLocation = state.lat !== '';
    const leave = onLeave();
    let alive = true;
    leave.add(() => (alive = false));

    const main = publicPage(
      el,
      html`<h1 class="cx-title">Find storage</h1>
      <form class="cx-search card" id="search-form" novalidate>
        <label class="cx-grow">Where<input name="q" type="search" maxlength="80" placeholder="Railway station, landmark or city" value="${state.q}" autocomplete="off" /></label>
        <label>From<input name="start" type="datetime-local" value="${toLocalInput(new Date(state.start))}" required /></label>
        <label>Until<input name="end" type="datetime-local" value="${toLocalInput(new Date(state.end))}" required /></label>
        <label>Bags
          <span class="cx-stepper"><button type="button" data-step="-1" aria-label="Fewer bags">−</button><output name="bagsOut" aria-live="polite">${state.bags}</output><button type="button" data-step="1" aria-label="More bags">+</button></span>
        </label>
        <div class="cx-search-actions"><button class="button" type="submit">${icon('search')} Search</button>
          <button class="button button-secondary" type="button" id="locate">${icon('location')} ${usingLocation ? 'Using your location' : 'Use my location'}</button></div>
        <p class="form-message" role="status"></p>
      </form>
      <div class="cx-toolbar"><p id="count" class="cx-muted" role="status"></p>
        <div class="cx-toggle" role="group" aria-label="View"><button type="button" data-view="list" aria-pressed="${state.view === 'list'}">${icon('list')} List</button><button type="button" data-view="map" aria-pressed="${state.view === 'map'}">${icon('map')} Map</button></div></div>
      <div id="map" class="cx-map" hidden></div>
      <div id="results">${skeleton()}</div>`,
    );

    const form = main.querySelector<HTMLFormElement>('#search-form')!;
    const message = form.querySelector<HTMLElement>('.form-message')!;
    const results = main.querySelector<HTMLElement>('#results')!;
    const count = main.querySelector<HTMLElement>('#count')!;
    const mapEl = main.querySelector<HTMLElement>('#map')!;
    let bags = state.bags;
    let items: ListingSummary[] = [];
    let destroyMap: (() => void) | null = null;
    leave.add(() => destroyMap?.());

    const windowQuery = (s: State) => ({ start: s.start, end: s.end, bags: s.bags });
    const urlFor = (s: State) => `#/search${qs({ q: s.q, lat: s.lat, lng: s.lng, ...windowQuery(s), view: s.view === 'map' ? 'map' : '' })}`;

    function readForm(): State | null {
      const data = new FormData(form);
      const start = validDate(String(data.get('start')));
      const end = validDate(String(data.get('end')));
      if (!start || !end || new Date(end) <= new Date(start)) {
        message.textContent = 'Choose a valid From and Until time (Until must be later).';
        message.dataset.tone = 'error';
        return null;
      }
      return { ...state, q: String(data.get('q') ?? '').trim().slice(0, 80), start, end, bags };
    }

    form.addEventListener('click', (event) => {
      const step = (event.target as HTMLElement).closest<HTMLElement>('[data-step]');
      if (!step) return;
      bags = clampBags(bags + Number(step.dataset.step));
      form.querySelector('output')!.textContent = String(bags);
    });
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const next = readForm();
      if (!next) return;
      try {
        sessionStorage.setItem('potli.searchStartedAt', new Date().toISOString());
      } catch {
        /* optional measurement */
      }
      window.location.hash = urlFor(next);
    });
    main.querySelector('#locate')!.addEventListener('click', () => {
      if (!navigator.geolocation) {
        message.textContent = 'Your browser cannot share its location. Search by place name instead.';
        message.dataset.tone = 'error';
        return;
      }
      message.textContent = 'Finding your location…';
      message.dataset.tone = 'info';
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const next = readForm();
          if (next) window.location.hash = urlFor({ ...next, lat: pos.coords.latitude.toFixed(5), lng: pos.coords.longitude.toFixed(5) });
        },
        () => {
          message.textContent = 'Location is off for this site. Search by place name, or allow location and try again.';
          message.dataset.tone = 'error';
        },
        { timeout: 10_000, maximumAge: 60_000 },
      );
    });

    function select(id: string): void {
      main.querySelectorAll('.cx-card.is-selected').forEach((n) => n.classList.remove('is-selected'));
      const target = main.querySelector<HTMLElement>(`#l-${CSS.escape(id)}`);
      target?.classList.add('is-selected');
      target?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }

    async function applyView(): Promise<void> {
      main.querySelectorAll<HTMLElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === state.view)));
      mapEl.hidden = state.view !== 'map';
      destroyMap?.();
      destroyMap = null;
      if (state.view === 'map' && items.length > 0) {
        try {
          const stop = await showMap(
            mapEl,
            items.map((i) => ({ id: i.id, lat: i.latitude, lng: i.longitude, label: formatINR(i.hourlyRatePaise) })),
            { onSelect: select },
          );
          if (alive && state.view === 'map') destroyMap = stop;
          else stop();
        } catch {
          mapEl.hidden = true;
          mount(mapEl, html``);
        }
      } else if (state.view === 'map') {
        mapEl.hidden = true;
      }
    }

    main.querySelector('.cx-toggle')!.addEventListener('click', (event) => {
      const button = (event.target as HTMLElement).closest<HTMLElement>('[data-view]');
      if (!button) return;
      state.view = button.dataset.view === 'map' ? 'map' : 'list';
      history.replaceState(null, '', urlFor(state));
      void applyView();
    });

    void (async () => {
      try {
        const data = await api<Paginated<ListingSummary>>('GET', '/listings', {
          query: { q: state.q, lat: state.lat, lng: state.lng, start: state.start, end: state.end, bags: state.bags, pageSize: 50, sort: state.lat ? 'distance' : 'rating' },
          auth: 'none',
        });
        if (!alive) return;
        items = data.items;
        const link = qs({ start: state.start, end: state.end, bags: state.bags });
        count.textContent = `${data.total} ${data.total === 1 ? 'place' : 'places'} · ${formatDate(state.start)} ${formatTime(state.start)} to ${formatDate(state.end)} ${formatTime(state.end)}`;
        mount(
          results,
          items.length === 0
            ? html`<div class="card cx-empty"><h2>No storage found${state.q ? ` near ${state.q}` : ''}</h2><p>Try a nearby landmark, or change the time window: most places are only open in the daytime.</p></div>`
            : html`<div class="cx-list">${items.map((i) => card(i, link))}</div>`,
        );
        await applyView();
      } catch (err) {
        if (alive) mount(results, errorBox(err));
      }
    })();

    return leave.run;
  },
};

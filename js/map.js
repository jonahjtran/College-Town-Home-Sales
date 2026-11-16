/* The campus map.
 *
 * Loads data/derived/manifest.json first (small), then only the points file for the
 * campus being viewed. Every number shown comes from those files, which
 * scripts/build_map_data.py computes from the dataset.
 */
(function () {
  'use strict';

  var DATA_DIR = 'data/derived/';
  var DEFAULT_CAMPUS = 'illinois';

  // One-hue ramps, low to high. On the dark map the ramp runs dark to light instead,
  // so the lowest group still recedes into the background.
  var RAMP = {
    light: ['#9ec5f4', '#6da7ec', '#2a78d6', '#1c5cab', '#0d366b'],
    dark: ['#184f95', '#256abf', '#3987e5', '#86b6ef', '#cde2fb']
  };
  var RING = { light: 'rgba(13,54,107,0.55)', dark: 'rgba(13,13,13,0.7)' };
  var TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  // Upper edges, in miles, of the first four distance groups. The fifth has no upper edge.
  var MILE_BREAKS = [1, 2, 3, 5];

  var darkQuery = window.matchMedia('(prefers-color-scheme: dark)');
  var fmtInt = new Intl.NumberFormat('en-US');
  var fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

  var el = {
    campus: document.getElementById('campus'),
    legend: document.getElementById('legend'),
    status: document.getElementById('map-status'),
    mapTitle: document.getElementById('map-title'),
    mapNote: document.getElementById('map-note'),
    notes: document.getElementById('notes-list'),
    sales: document.getElementById('stat-sales'),
    cities: document.getElementById('stat-cities'),
    price: document.getElementById('stat-price'),
    ppsf: document.getElementById('stat-ppsf'),
    ppsfNote: document.getElementById('stat-ppsf-note'),
    miles: document.getElementById('stat-miles'),
    milesNote: document.getElementById('stat-miles-note')
  };

  var state = {
    manifest: null,
    campus: null,   // the manifest entry being viewed
    points: null,   // its points file
    mode: 'price',
    cache: {},      // slug -> promise of a points file
    request: 0      // guards against a slow file arriving after a newer choice
  };

  var map, renderer, dotLayer, campusMarker, tooltip, hovered;

  function theme() { return darkQuery.matches ? 'dark' : 'light'; }

  function getJson(file) {
    return fetch(DATA_DIR + file).then(function (res) {
      if (!res.ok) throw new Error(file + ' returned ' + res.status);
      return res.json();
    });
  }

  function showStatus(text, isError) {
    el.status.textContent = text;
    el.status.hidden = !text;
    el.status.classList.toggle('error', !!isError);
  }

  /* ---------- color groups ---------- */

  function priceBreaks(campus) {
    var q = campus.price_quantiles;
    return [q.p20, q.p40, q.p60, q.p80];
  }

  function groupOf(value, breaks) {
    var i = 0;
    while (i < breaks.length && value >= breaks[i]) i++;
    return i;
  }

  function legendItems() {
    var breaks, fmt, items = [];
    if (state.mode === 'price') {
      breaks = priceBreaks(state.campus);
      fmt = function (v) { return fmtUsd.format(v); };
      items.push('Under ' + fmt(breaks[0]));
      for (var i = 1; i < breaks.length; i++) items.push(fmt(breaks[i - 1]) + ' to ' + fmt(breaks[i] - 1));
      items.push(fmt(breaks[breaks.length - 1]) + ' or more');
    } else {
      breaks = MILE_BREAKS;
      items.push('Under ' + breaks[0] + ' mi');
      for (var j = 1; j < breaks.length; j++) items.push(breaks[j - 1] + ' to ' + breaks[j] + ' mi');
      items.push(breaks[breaks.length - 1] + ' mi or more');
    }
    return items;
  }

  function drawLegend() {
    var ramp = RAMP[theme()];
    var html = '<span class="legend-title">' +
      (state.mode === 'price' ? 'Sale price' : 'Distance to campus') + '</span>';
    legendItems().forEach(function (text, i) {
      html += '<span class="legend-item"><span class="swatch" style="background:' + ramp[i] +
        ';--dot-ring:' + RING[theme()] + '"></span>' + text + '</span>';
    });
    html += '<span class="legend-item"><span class="swatch campus"></span>Campus landmark</span>';
    el.legend.innerHTML = html;
  }

  /* ---------- map ---------- */

  function initMap() {
    map = L.map('map', { preferCanvas: true, zoomSnap: 0.5, scrollWheelZoom: false });
    // Scrolling the page shouldn't hijack into zooming the map until the map is clicked.
    map.on('focus click', function () { map.scrollWheelZoom.enable(); });
    map.on('blur', function () { map.scrollWheelZoom.disable(); });
    renderer = L.canvas({ padding: 0.3 });
    tooltip = L.tooltip({ className: 'sale-tip', direction: 'top', offset: [0, -6], opacity: 1 });
    // The street map is toned down with CSS (see .leaflet-tile-pane) so the dots stand out.
    L.tileLayer(TILES, {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);
  }

  function saleHtml(i) {
    var p = state.points;
    var facts = [];
    if (p.beds[i] !== null) facts.push(p.beds[i] + ' bd');
    if (p.sqft[i] !== null) {
      facts.push(fmtInt.format(p.sqft[i]) + ' sq ft');
      facts.push(fmtUsd.format(p.price[i] / p.sqft[i]) + '/sq ft');
    }
    var where = p.miles[i].toFixed(1) + ' mi from campus';
    if (p.year[i] !== null) where += ' · sold ' + p.year[i];
    return '<div class="tip-price">' + fmtUsd.format(p.price[i]) + '</div>' +
      (facts.length ? '<div class="tip-line">' + facts.join(' · ') + '</div>' : '') +
      '<div class="tip-line">' + where + '</div>';
  }

  function unhover() {
    if (hovered) {
      hovered.setStyle({ color: RING[theme()], weight: 0.75 });
      hovered = null;
    }
    map.closeTooltip(tooltip);
  }

  function drawDots() {
    var p = state.points;
    var ramp = RAMP[theme()];
    var ring = RING[theme()];
    var values = state.mode === 'price' ? p.price : p.miles;
    var breaks = state.mode === 'price' ? priceBreaks(state.campus) : MILE_BREAKS;
    var markers = new Array(p.count);

    for (var i = 0; i < p.count; i++) {
      var m = L.circleMarker([p.lat[i], p.lon[i]], {
        renderer: renderer,
        radius: 4.5,
        color: ring,
        weight: 0.75,
        fillColor: ramp[groupOf(values[i], breaks)],
        fillOpacity: 0.9
      });
      m.saleIndex = i;
      markers[i] = m;
    }

    hovered = null;
    if (dotLayer) dotLayer.remove();
    dotLayer = L.featureGroup(markers)
      .on('mouseover', function (e) {
        unhover();
        hovered = e.layer;
        hovered.setStyle({ color: theme() === 'dark' ? '#ffffff' : '#0b0b0b', weight: 2 }).bringToFront();
        tooltip.setLatLng(e.layer.getLatLng()).setContent(saleHtml(e.layer.saleIndex));
        map.openTooltip(tooltip);
      })
      .on('mouseout', unhover)
      .on('click', function (e) {
        // A popup stays open, which is what touch screens need.
        L.popup({ offset: [0, -2] })
          .setLatLng(e.layer.getLatLng())
          .setContent(saleHtml(e.layer.saleIndex))
          .openOn(map);
      })
      .addTo(map);
  }

  function drawCampus(fit) {
    var c = state.campus;
    var at = [c.campus_location.lat, c.campus_location.lon];
    if (campusMarker) campusMarker.remove();
    campusMarker = L.marker(at, {
      icon: L.divIcon({ className: '', html: '<div class="campus-pin"></div>', iconSize: [16, 16], iconAnchor: [8, 8] }),
      keyboard: false,
      zIndexOffset: 1000
    }).bindTooltip(c.university + ' (campus landmark)', { className: 'sale-tip', direction: 'top', offset: [0, -10] })
      .addTo(map);
    if (fit) {
      map.fitBounds([[c.bounds.south, c.bounds.west], [c.bounds.north, c.bounds.east]], { padding: [16, 16], animate: false });
    }
  }

  /* ---------- text around the map ---------- */

  function drawSummary() {
    var c = state.campus;
    var f = state.manifest.filters;
    el.sales.textContent = fmtInt.format(c.sales);
    el.cities.textContent = c.cities.map(function (x) { return x.city + ', ' + x.state; }).join(' · ');
    el.price.textContent = fmtUsd.format(c.price_median);
    el.ppsf.textContent = '$' + c.ppsf_median.toFixed(0);
    el.ppsfNote.textContent = 'From ' + fmtInt.format(c.ppsf_sales) + ' sales with a living area';
    el.miles.textContent = c.miles_median.toFixed(1) + ' mi';
    el.milesNote.textContent = 'Farthest sale: ' + c.miles_max.toFixed(1) + ' mi';
    el.mapTitle.textContent = 'Homes sold near ' + c.university;

    var left = c.rows_in_source - c.sales;
    el.mapNote.textContent = fmtInt.format(c.sales) + ' of this campus’s ' + fmtInt.format(c.rows_in_source) +
      ' sales are shown' + (left ? '; ' + left + ' priced outside ' + fmtUsd.format(f.price_min) + ' to ' +
      fmtUsd.format(f.price_max) + (left === 1 ? ' is' : ' are') + ' left out.' : '.');
  }

  function drawNotes() {
    var f = state.manifest.filters;
    var notes = [
      'Each dot is one completed sale. Hover over or tap a dot for its details.',
      'Sales priced under ' + fmtUsd.format(f.price_min) + ' or over ' + fmtUsd.format(f.price_max) +
        ' are left out because the dataset contains some impossible prices. That removes ' +
        (f.removed_price_below_min + f.removed_price_above_max) + ' of ' + fmtInt.format(f.rows_in_source) +
        ' sales across all campuses (' + f.removed_price_below_min + ' under, ' + f.removed_price_above_max + ' over).',
      'The five price colors split each campus’s sales into fifths, so the price ranges change from campus to campus.',
      'Price per square foot uses only sales with a living area above 0.',
      'Distance is the straight-line distance to one landmark on each campus, not driving distance. The dataset lists ' +
        'each home’s distance but not the landmark’s position, so the campus marker is worked out from those distances.',
      'Each sale belongs to its nearest campus, whatever city is in its address.'
    ];
    el.notes.innerHTML = notes.map(function (n) { return '<li>' + n + '</li>'; }).join('');
  }

  /* ---------- choosing a campus ---------- */

  function loadPoints(campus) {
    if (!state.cache[campus.slug]) {
      state.cache[campus.slug] = getJson(campus.points_file).catch(function (err) {
        delete state.cache[campus.slug];
        throw err;
      });
    }
    return state.cache[campus.slug];
  }

  function selectCampus(slug) {
    var campus = state.manifest.campuses.filter(function (c) { return c.slug === slug; })[0];
    if (!campus) return;
    var request = ++state.request;
    state.campus = campus;
    el.campus.value = slug;
    if (location.hash !== '#' + slug) history.replaceState(null, '', '#' + slug);

    drawSummary();
    drawLegend();
    map.closePopup();
    if (dotLayer) { dotLayer.remove(); dotLayer = null; }
    drawCampus(true);
    showStatus('Loading sales…');

    loadPoints(campus).then(function (points) {
      if (request !== state.request) return;
      state.points = points;
      drawDots();
      showStatus('');
    }).catch(function () {
      if (request !== state.request) return;
      showStatus('The sales for this campus could not be loaded. Check your connection and reload the page.', true);
    });
  }

  function start() {
    initMap();
    getJson('manifest.json').then(function (manifest) {
      state.manifest = manifest;
      var campuses = manifest.campuses.slice().sort(function (a, b) {
        return a.short_name.localeCompare(b.short_name);
      });
      el.campus.innerHTML = campuses.map(function (c) {
        return '<option value="' + c.slug + '">' + c.university + '</option>';
      }).join('');
      el.campus.disabled = false;
      drawNotes();

      var fromHash = location.hash.slice(1);
      var known = campuses.some(function (c) { return c.slug === fromHash; });
      selectCampus(known ? fromHash : DEFAULT_CAMPUS);
    }).catch(function () {
      showStatus('The site’s data could not be loaded. Check your connection and reload the page.', true);
    });

    el.campus.addEventListener('change', function () { selectCampus(el.campus.value); });
    document.querySelectorAll('input[name="mode"]').forEach(function (input) {
      input.addEventListener('change', function () {
        if (!input.checked) return;
        state.mode = input.value;
        if (!state.campus) return;
        drawLegend();
        map.closePopup();
        if (state.points && state.points.campus === state.campus.slug) drawDots();
      });
    });
    window.addEventListener('hashchange', function () {
      var slug = location.hash.slice(1);
      if (state.manifest && state.campus && slug !== state.campus.slug) selectCampus(slug);
    });
    darkQuery.addEventListener('change', function () {
      if (!state.campus) return;
      drawLegend();
      if (state.points && state.points.campus === state.campus.slug) drawDots();
    });
  }

  start();
})();

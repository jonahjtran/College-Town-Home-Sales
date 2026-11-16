/* The price-by-distance chart.
 *
 * Draws one campus's distance bands from data/derived/distance_bands.json as an SVG:
 * a dot at each band's median and a bar across the middle half of its sales
 * (25th to 75th percentile). Bands with too few sales get a dash, not a median.
 *
 * js/map.js owns the data and the selection; this file only draws and reports
 * what the reader points at or picks.
 */
(function () {
  'use strict';

  var fmtInt = new Intl.NumberFormat('en-US');
  var fmtUsd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
  var fmtCompact = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1
  });

  var METRICS = {
    price: { p25: 'price_p25', median: 'price_median', p75: 'price_p75', count: 'sales',
             name: 'sale price', countNote: 'sales' },
    ppsf: { p25: 'ppsf_p25', median: 'ppsf_median', p75: 'ppsf_p75', count: 'ppsf_sales',
            name: 'price per sq ft', countNote: 'sales with a living area' }
  };

  function money(v) { return fmtUsd.format(Math.round(v)); }

  /* The band's numbers for one metric, with `ok` false when there are too few sales. */
  function read(band, metric, thinBelow) {
    var m = METRICS[metric];
    var count = band[m.count];
    return {
      count: count,
      ok: count >= thinBelow && band[m.median] !== null,
      p25: band[m.p25], median: band[m.median], p75: band[m.p75]
    };
  }

  function shortLabel(band) { return band.label.replace(' mi', ''); }

  /* A round step (1, 2 or 5 times a power of ten) giving about four gridlines. */
  function niceStep(max) {
    var rough = max / 4;
    var pow = Math.pow(10, Math.floor(Math.log10(rough)));
    var n = rough / pow;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
  }

  function describe(band, metric, thinBelow) {
    var m = METRICS[metric];
    var d = read(band, metric, thinBelow);
    var head = band.label + ' from campus: ';
    if (d.count === 0) return head + 'no ' + m.countNote + '.';
    if (!d.ok) {
      return head + fmtInt.format(d.count) + ' ' + (d.count === 1 ? m.countNote.replace('sales', 'sale') : m.countNote) +
        ', too few to summarize.';
    }
    return head + 'median ' + m.name + ' ' + money(d.median) + ', middle half ' + money(d.p25) + ' to ' +
      money(d.p75) + ', from ' + fmtInt.format(d.count) + ' ' + m.countNote + '.';
  }

  function tipHtml(band, metric, thinBelow) {
    var m = METRICS[metric];
    var d = read(band, metric, thinBelow);
    var html = '<div class="tip-title">' + band.label + ' from campus</div>';
    if (d.count === 0) return html + '<div class="tip-line">No ' + m.countNote + '</div>';
    html += '<div class="tip-line">' + fmtInt.format(d.count) + ' ' +
      (d.count === 1 ? m.countNote.replace('sales', 'sale') : m.countNote) + '</div>';
    if (!d.ok) return html + '<div class="tip-line">Too few to summarize (fewer than ' + thinBelow + ')</div>';
    return html +
      '<div class="tip-row"><span>Median</span><strong>' + money(d.median) + '</strong></div>' +
      '<div class="tip-row"><span>Middle half</span><strong>' + money(d.p25) + ' to ' + money(d.p75) + '</strong></div>';
  }

  /* A sentence naming the dearest and cheapest bands, or '' when fewer than two can be compared. */
  function headline(bands, metric, thinBelow) {
    var usable = bands.filter(function (b) { return read(b, metric, thinBelow).ok; });
    if (usable.length < 2) return '';
    var key = METRICS[metric].median;
    var hi = usable.reduce(function (a, b) { return b[key] > a[key] ? b : a; });
    var lo = usable.reduce(function (a, b) { return b[key] < a[key] ? b : a; });
    if (hi[key] === lo[key]) return '';
    return 'Median ' + METRICS[metric].name + ' is highest ' + hi.label + ' from campus (' + money(hi[key]) +
      ') and lowest ' + lo.label + ' from campus (' + money(lo[key]) + ').';
  }

  function tableHtml(bands, metric, thinBelow) {
    var m = METRICS[metric];
    var rows = bands.map(function (b) {
      var d = read(b, metric, thinBelow);
      var cells = d.ok
        ? '<td>' + money(d.p25) + '</td><td>' + money(d.median) + '</td><td>' + money(d.p75) + '</td>'
        : '<td colspan="3" class="muted">' + (d.count === 0 ? 'No sales' : 'Too few sales to summarize') + '</td>';
      return '<tr><th scope="row">' + b.label + '</th><td>' + fmtInt.format(d.count) + '</td>' + cells + '</tr>';
    }).join('');
    return '<table><thead><tr><th scope="col">Distance from campus</th><th scope="col">' +
      (metric === 'price' ? 'Sales' : 'Sales with a living area') + '</th><th scope="col">25th percentile</th>' +
      '<th scope="col">Median ' + m.name + '</th><th scope="col">75th percentile</th></tr></thead><tbody>' +
      rows + '</tbody></table>';
  }

  /* opts: host, tip, bands, metric, thinBelow, pinned (index or null), onPreview(index|null), onPin(index) */
  function render(opts) {
    var host = opts.host, bands = opts.bands, metric = opts.metric, thinBelow = opts.thinBelow;
    var W = Math.max(280, Math.floor(host.clientWidth));
    var H = W < 520 ? 280 : 320;
    var M = { top: 30, right: 8, bottom: 62, left: 50 };
    var innerW = W - M.left - M.right, innerH = H - M.top - M.bottom;
    var slot = innerW / bands.length;
    var roomy = slot >= 84;

    var data = bands.map(function (b) { return read(b, metric, thinBelow); });
    var top = Math.max.apply(null, data.map(function (d) { return d.ok ? d.p75 : 0; }));
    var step = top > 0 ? niceStep(top) : 1;
    var yMax = top > 0 ? Math.ceil(top / step) * step : 1;
    function y(v) { return M.top + innerH - (v / yMax) * innerH; }

    var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H +
      '" role="group" aria-label="Median ' + METRICS[metric].name + ' by distance from campus">';

    // Gridlines and value axis
    for (var v = 0; v <= yMax + step / 2; v += step) {
      s += '<line class="' + (v === 0 ? 'axis' : 'grid') + '" x1="' + M.left + '" x2="' + (W - M.right) +
        '" y1="' + y(v) + '" y2="' + y(v) + '"/>' +
        '<text class="tick" x="' + (M.left - 8) + '" y="' + (y(v) + 4) + '" text-anchor="end">' +
        (v === 0 ? '$0' : fmtCompact.format(v)) + '</text>';
    }

    bands.forEach(function (b, i) {
      var d = data[i];
      var x0 = M.left + i * slot, cx = x0 + slot / 2;
      var barW = Math.min(24, slot * 0.5);
      var pinned = opts.pinned === i;

      s += '<g class="band' + (pinned ? ' pinned' : '') + '" data-i="' + i + '" tabindex="0" role="button" aria-pressed="' +
        pinned + '" aria-label="' + describe(b, metric, thinBelow) + ' Press to ' +
        (pinned ? 'stop highlighting' : 'highlight') + ' these homes on the map.">' +
        '<rect class="slot" x="' + (x0 + 2) + '" y="' + (M.top - 22) + '" width="' + (slot - 4) + '" height="' +
        (innerH + 22 + M.bottom - 20) + '" rx="6"/>';

      if (d.ok) {
        s += '<rect class="range" x="' + (cx - barW / 2) + '" y="' + y(d.p75) + '" width="' + barW +
          '" height="' + Math.max(2, y(d.p25) - y(d.p75)) + '" rx="4"/>' +
          '<circle class="median" cx="' + cx + '" cy="' + y(d.median) + '" r="5"/>' +
          '<text class="value" x="' + cx + '" y="' + (y(d.p75) - 8) + '" text-anchor="middle">' +
          (roomy || d.median < 1000 ? money(d.median) : fmtCompact.format(d.median)) + '</text>';
      } else {
        s += '<line class="none" x1="' + (cx - 6) + '" x2="' + (cx + 6) + '" y1="' + y(yMax / 2) + '" y2="' + y(yMax / 2) + '"/>';
      }

      s += '<text class="tick band-name" x="' + cx + '" y="' + (M.top + innerH + 18) + '" text-anchor="middle">' +
        shortLabel(b) + '</text>' +
        '<text class="tick count" x="' + cx + '" y="' + (M.top + innerH + 34) + '" text-anchor="middle">' +
        fmtInt.format(d.count) + (roomy ? (d.count === 1 ? ' sale' : ' sales') : '') + '</text></g>';
    });

    s += '<text class="tick axis-title" x="' + (M.left + innerW / 2) + '" y="' + (H - 6) +
      '" text-anchor="middle">Miles from campus' + (roomy ? '' : ' (number of sales below each band)') + '</text></svg>';
    host.innerHTML = s;

    var tip = opts.tip;
    function show(g) {
      var i = +g.getAttribute('data-i');
      tip.innerHTML = tipHtml(bands[i], metric, thinBelow);
      tip.hidden = false;
      var cx = M.left + (i + 0.5) * slot;
      var half = tip.offsetWidth / 2;
      tip.style.left = Math.min(Math.max(cx, half + 4), W - half - 4) + 'px';
      var d = data[i];
      tip.style.top = (d.ok ? y(d.p75) - 30 : y(yMax / 2) - 12) + 'px';
      opts.onPreview(i);
    }
    function hide() { tip.hidden = true; opts.onPreview(null); }

    Array.prototype.forEach.call(host.querySelectorAll('.band'), function (g) {
      g.addEventListener('mouseenter', function () { show(g); });
      g.addEventListener('mouseleave', hide);
      g.addEventListener('focus', function () { show(g); });
      g.addEventListener('blur', hide);
      g.addEventListener('click', function () { opts.onPin(+g.getAttribute('data-i')); });
      g.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); opts.onPin(+g.getAttribute('data-i')); }
      });
    });
  }

  window.BandChart = { render: render, headline: headline, tableHtml: tableHtml };
})();

const TABLE_STATE_CARD_VERSION = "0.0.9";

class TableStateCard extends HTMLElement {
  static getConfigElement() {
    return document.createElement("table-state-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:table-state-card",
      title: "Table State",
      hours_to_show: 6,
      columns: ["toggle", "name", "value", "sparkline"],
      entities: ["sun.sun"],
    };
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = undefined;
    this._hass = undefined;
    this._history = new Map();
    this._loading = false;
    this._error = "";
    this._lastFetchKey = "";
    this._pendingToggle = undefined;
    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
    this.shadowRoot.addEventListener("keydown", (event) => this._handleKeyDown(event));
    this.shadowRoot.addEventListener("pointerdown", (event) => this._handlePointerDown(event));
    this.shadowRoot.addEventListener("pointerup", (event) => this._handlePointerUp(event));
    this.shadowRoot.addEventListener("pointercancel", () => this._handlePointerCancel());
    this.shadowRoot.addEventListener("pointermove", (event) => this._handleSparklinePointerMove(event));
    this.shadowRoot.addEventListener("pointerleave", () => this._hideTooltip());
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.entities)) {
      throw new Error("entities is required");
    }

    this._config = {
      hours_to_show: 6,
      refresh_interval: 300,
      row_height: 28,
      decimals: undefined,
      sparkline_decimals: undefined,
      resolution_minutes: 0,
      columns: ["toggle", "name", "value", "sparkline"],
      ...config,
    };
    this._lastFetchKey = "";
    this._render();
  }

  getGridOptions() {
    const span = Number(this._config?.column_span);
    return Number.isFinite(span) && span > 0 ? { columns: Math.round(span) } : {};
  }

  set hass(hass) {
    this._hass = hass;
    if (!this._config) return;

    const now = Date.now();
    const fetchKey = [
      this._historyEntityIds().join(","),
      this._maxHoursToShow(),
      Math.floor(now / (this._config.refresh_interval * 1000)),
    ].join("|");

    if (fetchKey !== this._lastFetchKey && !this._loading) {
      this._lastFetchKey = fetchKey;
      this._fetchHistory();
      return;
    }

    this._render();
  }

  getCardSize() {
    return Math.max(1, Math.ceil(this._entityConfigs().length / 3));
  }

  _entityConfigs() {
    return (this._config?.entities || []).map((entry) => (typeof entry === "string" ? { entity: entry } : entry));
  }

  _columns() {
    return (this._config?.columns || ["toggle", "name", "value", "sparkline"]).map((column) =>
      typeof column === "string" ? { type: column } : column
    );
  }

  _historyEntityIds() {
    return [
      ...new Set(
        this._entityConfigs().flatMap((entry) =>
          this._columns()
            .filter((column) => this._columnType(column) === "sparkline" || this._columnType(column) === "history")
            .map((column) => this._resolveEntity(entry, column, "history"))
            .filter(Boolean)
        )
      ),
    ];
  }

  _maxHoursToShow() {
    const hours = this._entityConfigs().flatMap((entry) =>
      this._columns()
        .filter((column) => this._columnType(column) === "sparkline" || this._columnType(column) === "history")
        .map((column) => this._hoursToShow(column, entry))
    );
    return Math.max(1, ...hours);
  }

  async _fetchHistory() {
    if (!this._hass || !this._config) return;

    const entityIds = this._historyEntityIds();
    if (entityIds.length === 0) return;

    this._loading = true;
    this._error = "";

    const end = new Date();
    end.setSeconds(0, 0);
    const start = new Date(end.getTime() - this._maxHoursToShow() * 60 * 60 * 1000);
    const params = new URLSearchParams({
      filter_entity_id: entityIds.join(","),
      end_time: end.toISOString(),
    });
    params.set("minimal_response", "");
    params.set("no_attributes", "");

    try {
      const response = await this._hass.callApi(
        "GET",
        `history/period/${encodeURIComponent(start.toISOString())}?${params.toString()}`
      );
      const nextHistory = new Map();
      for (const series of response || []) {
        if (!series.length) continue;
        const entityId = series.find((item) => item.entity_id)?.entity_id;
        if (entityId) nextHistory.set(entityId, series);
      }
      this._history = nextHistory;
    } catch (err) {
      this._error = err?.message || String(err);
    } finally {
      this._loading = false;
      this._render();
    }
  }

  _render() {
    if (!this._config) return;

    const columns = this._columns();
    const rows = this._entityConfigs().filter((entry) => this._rowHasContent(entry, columns));
    const rowHeight = this._cssSize(this._config.row_height, "28px");

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
          width: 100%;
        }

        ha-card {
          position: relative;
          overflow: hidden;
          width: 100%;
        }

        .header {
          padding: 10px 12px 4px;
          color: var(--ha-card-header-color, var(--primary-text-color));
          font-family: var(--ha-card-header-font-family, inherit);
          font-size: var(--ha-card-header-font-size, 18px);
          line-height: 1.2;
        }

        .status {
          position: absolute;
          top: 8px;
          right: 12px;
          z-index: 2;
          max-width: calc(100% - 24px);
          box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--mdc-theme-surface, var(--ha-card-background, var(--card-background-color)));
          color: var(--secondary-text-color);
          box-shadow: var(--ha-card-box-shadow, 0 3px 10px rgb(0 0 0 / 16%));
          font-size: 12px;
          line-height: 1.3;
          padding: 4px 8px;
          pointer-events: none;
        }

        .status.error {
          color: var(--error-color);
        }

        .table {
          display: flex;
          flex-direction: column;
          padding: 6px 8px 8px;
        }

        .row {
          display: flex;
          min-width: 0;
          min-height: var(--row-height);
          align-items: center;
          gap: 8px;
          border-top: 1px solid var(--divider-color);
        }

        .row:first-child {
          border-top: 0;
        }

        .cell {
          min-width: 0;
          overflow: hidden;
          color: var(--primary-text-color);
          font-size: 13px;
          line-height: var(--row-height);
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .cell.value {
          min-width: 44px;
          text-align: right;
          font-variant-numeric: tabular-nums;
        }

        .cell.sparkline {
          min-width: 60px;
        }

        .cell[data-empty="true"] {
          color: var(--secondary-text-color);
        }

        .toggle {
          width: 22px;
          height: 22px;
          box-sizing: border-box;
          border: 1px solid var(--divider-color);
          border-radius: 999px;
          background: var(--disabled-color, #9e9e9e);
          color: transparent;
          cursor: pointer;
          display: block;
          padding: 0;
        }

        .toggle-cell {
          cursor: pointer;
          display: flex;
          align-items: center;
        }

        .toggle-cell .toggle {
          pointer-events: none;
        }

        .toggle-cell:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
        }

        .toggle[data-state="on"],
        .toggle[data-state="home"] {
          background: var(--state-active-color, #fdd835);
          border-color: var(--state-active-color, #fdd835);
        }

        .spark {
          display: block;
          width: 100%;
          height: calc(var(--row-height) - 8px);
          overflow: visible;
        }

        .spark path.line {
          fill: none;
          stroke: var(--sparkline-color, var(--primary-color));
          stroke-width: 1.5;
          vector-effect: non-scaling-stroke;
        }

        .spark path.fill {
          fill: var(--sparkline-fill-color, color-mix(in srgb, var(--primary-color) 18%, transparent));
        }

        .tooltip {
          position: fixed;
          z-index: 10;
          display: none;
          max-width: min(220px, calc(100vw - 24px));
          padding: 6px 8px;
          border-radius: 4px;
          background: var(--ha-card-background, var(--card-background-color));
          border: 1px solid var(--divider-color);
          box-shadow: var(--ha-card-box-shadow, 0 2px 8px rgba(0, 0, 0, 0.24));
          color: var(--primary-text-color);
          font-size: 12px;
          line-height: 1.35;
          pointer-events: none;
          white-space: nowrap;
        }

        .tooltip .time {
          color: var(--secondary-text-color);
        }
      </style>
      <ha-card style="--row-height:${this._escapeAttr(rowHeight)};${this._viewLayoutStyle()}">
        ${this._config.title ? `<div class="header">${this._escape(this._config.title)}</div>` : ""}
        ${this._loading || this._error ? `<div class="status ${this._error ? "error" : ""}">${this._escape(this._error || "Loading history...")}</div>` : ""}
        <div class="table">
          ${
            rows.length
              ? rows
                  .map(
                    (entry) =>
                      `<div class="row">${columns
                        .map((column) => this._cellHtml(column, entry))
                        .join("")}</div>`
                  )
                  .join("")
              : `<div class="row"><div class="cell">No entities configured</div></div>`
          }
        </div>
        <div class="tooltip" role="tooltip"></div>
      </ha-card>
    `;
  }

  _columnWidth(column) {
    const type = this._columnType(column);
    if (column.width) return String(column.width);
    if (type === "toggle") return "24px";
    if (type === "value" || type === "state") return "minmax(48px, max-content)";
    if (type === "sparkline" || type === "history") return "minmax(80px, 1fr)";
    return "minmax(0, 1fr)";
  }

  _viewLayoutStyle() {
    const layout = this._config?.view_layout;
    if (!layout || typeof layout !== "object") return "";

    return Object.entries(layout)
      .filter(([key, value]) => key.startsWith("grid-") && value !== undefined && value !== null && value !== "")
      .map(([key, value]) => `${key}:${this._escapeAttr(value)}`)
      .join(";");
  }

  _cellHtml(column, entry) {
    const type = this._columnType(column);
    if (type === "toggle") return this._toggleCell(entry, column);
    if (type === "name") {
      return `<div class="cell name" style="${this._cellStyle(column)}" title="${this._escapeAttr(this._name(entry))}">${this._escape(
        this._name(entry)
      )}</div>`;
    }
    if (type === "sparkline" || type === "history") return this._sparklineCell(entry, column);
    return this._valueCell(entry, column);
  }

  _toggleCell(entry, column) {
    const entityId = this._resolveEntity(entry, column, "toggle");
    const stateObj = this._hass?.states?.[entityId];
    const state = String(stateObj?.state || "").toLowerCase();
    const disabled = entityId ? "false" : "true";
    const tabindex = entityId ? "0" : "-1";
    return `<div class="cell toggle-cell" data-action="toggle" data-entity-id="${this._escapeAttr(
      entityId || ""
    )}" aria-disabled="${disabled}" role="button" tabindex="${tabindex}" style="${this._cellStyle(column)}"><button class="toggle" data-state="${this._escapeAttr(
      state
    )}" title="${this._escapeAttr(entityId || "")}" type="button" tabindex="-1">toggle</button></div>`;
  }

  _valueCell(entry, column) {
    const entityId = this._resolveEntity(entry, column, "value");
    const value = this._formatState(entityId, column, entry);
    return `<div class="cell value" data-empty="${value ? "false" : "true"}" style="${this._cellStyle(column)}" title="${this._escapeAttr(
      entityId || ""
    )}">${this._escape(value)}</div>`;
  }

  _sparklineCell(entry, column) {
    const entityId = this._resolveEntity(entry, column, "history");
    const series = this._history.get(entityId) || [];
    const color = column.color || entry.color || "var(--primary-color)";
    const fill = column.fill || entry.fill || "color-mix(in srgb, var(--primary-color) 18%, transparent)";
    const decimals = this._sparklineDecimals(column, entry);
    const hours = this._hoursToShow(column, entry);
    const resolution = this._resolutionMinutes(column, entry);
    const points = this._pointsFromSeries(series, hours, resolution);
    return `<div class="cell sparkline" data-history-entity-id="${this._escapeAttr(entityId || "")}" data-decimals="${this._escapeAttr(
      decimals ?? ""
    )}" data-hours="${this._escapeAttr(hours)}" data-resolution="${this._escapeAttr(
      resolution
    )}" style="${this._cellStyle(column)};--sparkline-color:${this._escapeAttr(color)};--sparkline-fill-color:${this._escapeAttr(
      fill
    )}">${this._sparklineSvg(points, column)}</div>`;
  }

  _cellStyle(column) {
    return `flex:${this._escapeAttr(this._columnFlex(column))}`;
  }

  _columnFlex(column) {
    const width = String(this._columnWidth(column)).trim();
    const minmax = width.match(/^minmax\(([^,]+),\s*([0-9.]+)fr\)$/);
    if (minmax) return `${Number(minmax[2]) || 1} 1 ${minmax[1].trim()}`;

    const fr = width.match(/^([0-9.]+)fr$/);
    if (fr) return `${Number(fr[1]) || 1} 1 0px`;

    if (width === "max-content" || width === "min-content" || width === "auto") return "0 0 auto";
    return `0 0 ${width}`;
  }

  _sparklineSvg(points, column = {}) {
    if (points.length < 2) {
      return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    }

    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const autoMinValue = Math.min(...points.map((point) => point.value));
    const autoMaxValue = Math.max(...points.map((point) => point.value));
    const configuredMin = this._numberOrUndefined(column.min ?? column.min_value);
    const configuredMax = this._numberOrUndefined(column.max ?? column.max_value);
    const minValue = configuredMin ?? autoMinValue;
    const maxValue = configuredMax ?? autoMaxValue;
    const timeSpan = Math.max(1, maxTime - minTime);
    const valueSpan = Math.max(1, maxValue - minValue);
    const coords = points.map((point) => {
      const x = ((point.time - minTime) / timeSpan) * 100;
      const normalized = Math.min(1, Math.max(0, (point.value - minValue) / valueSpan));
      const y = 22 - normalized * 20;
      return [x, y];
    });
    const line = coords.map(([x, y], index) => `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`).join(" ");
    const fill = `${line} L 100 24 L 0 24 Z`;

    return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"><path class="fill" d="${fill}"></path><path class="line" d="${line}"></path></svg>`;
  }

  _columnType(column) {
    return column.type || "value";
  }

  _rowHasContent(entry, columns) {
    if (entry.name || entry.entity || entry.toggle_entity || entry.value_entity || entry.history_entity) return true;

    return columns.some((column) => {
      const type = this._columnType(column);
      const role = type === "toggle" ? "toggle" : type === "sparkline" || type === "history" ? "history" : "value";
      return Boolean(this._resolveEntity(entry, column, role));
    });
  }

  _resolveEntity(entry, column, role) {
    if (column.entity) return column.entity;
    if (column[`${role}_entity`]) return column[`${role}_entity`];

    const columnName = column.name || column.key || column.id;
    if (columnName && entry[columnName]) return entry[columnName];

    if (role === "toggle") return entry.toggle_entity || entry.entity;
    if (role === "value") return entry.value_entity || entry.entity;
    if (role === "history") return entry.history_entity || entry.value_entity || entry.entity;
    return entry.entity;
  }

  _name(entry) {
    if (entry.name) return entry.name;
    const entityId = entry.value_entity || entry.entity || entry.history_entity;
    return this._hass?.states?.[entityId]?.attributes?.friendly_name || entityId || "";
  }

  _formatState(entityId, column = {}, entry = {}) {
    const stateObj = this._hass?.states?.[entityId];
    if (!stateObj) return entityId ? column.placeholder || "--" : "";

    const state = this._formatValue(stateObj.state, this._decimals(column, entry));
    const unit = stateObj.attributes?.unit_of_measurement;
    return unit ? `${state} ${unit}` : String(state);
  }

  _formatValue(value, decimals) {
    if (decimals === undefined) return String(value);

    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);

    return numeric.toFixed(decimals);
  }

  _decimals(column = {}, entry = {}, inheritMatchingValueColumn = false) {
    const value =
      column.decimals ??
      (inheritMatchingValueColumn ? this._matchingValueColumn(column)?.decimals : undefined) ??
      entry.decimals ??
      this._config?.decimals;
    if (value === undefined || value === null || value === "") return undefined;

    const decimals = Number(value);
    if (!Number.isFinite(decimals)) return undefined;

    return Math.max(0, Math.trunc(decimals));
  }

  _sparklineDecimals(column = {}, entry = {}) {
    const key = column.key || column.name || column.id;
    const keyedDecimals = key ? entry[`${key}_decimals`] : undefined;
    const value =
      column.decimals ??
      column.sparkline_decimals ??
      keyedDecimals ??
      entry.sparkline_decimals ??
      entry.decimals ??
      this._matchingValueColumn(column)?.decimals ??
      this._config?.sparkline_decimals ??
      this._config?.decimals;
    if (value === undefined || value === null || value === "") return undefined;

    const decimals = Number(value);
    if (!Number.isFinite(decimals)) return undefined;

    return Math.max(0, Math.trunc(decimals));
  }

  _matchingValueColumn(column) {
    const key = column.key || column.name || column.id;
    if (!key) return undefined;

    return this._columns().find((candidate) => {
      const type = this._columnType(candidate);
      const candidateKey = candidate.key || candidate.name || candidate.id;
      return (type === "value" || type === "state") && candidateKey === key;
    });
  }

  _hoursToShow(column = {}, entry = {}) {
    const value =
      column.hours_to_show ??
      column.sparkline_hours_to_show ??
      entry.hours_to_show ??
      entry.sparkline_hours_to_show ??
      this._config?.sparkline_hours_to_show ??
      this._config?.hours_to_show ??
      6;
    const hours = Number(value);
    return Number.isFinite(hours) && hours > 0 ? hours : 6;
  }

  _resolutionMinutes(column = {}, entry = {}) {
    const value =
      column.resolution_minutes ??
      column.bucket_minutes ??
      entry.resolution_minutes ??
      entry.bucket_minutes ??
      this._config?.resolution_minutes ??
      this._config?.bucket_minutes ??
      0;
    const minutes = Number(value);
    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  _numberOrUndefined(value) {
    if (value === undefined || value === null || value === "") return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  _pointsFromSeries(series, hoursToShow, resolutionMinutes) {
    const cutoff = Date.now() - hoursToShow * 60 * 60 * 1000;
    const points = (series || [])
      .map((item) => ({
        item,
        time: Date.parse(item.last_changed || item.last_updated),
        value: Number(item.state),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value) && point.time >= cutoff)
      .sort((a, b) => a.time - b.time);

    if (!resolutionMinutes || points.length < 2) return points;

    return this._bucketPoints(points, resolutionMinutes);
  }

  _bucketPoints(points, resolutionMinutes) {
    const bucketMs = resolutionMinutes * 60 * 1000;
    const buckets = new Map();

    for (const point of points) {
      const bucketTime = Math.floor(point.time / bucketMs) * bucketMs;
      const bucket = buckets.get(bucketTime) || { time: bucketTime, sum: 0, count: 0, item: point.item };
      bucket.sum += point.value;
      bucket.count += 1;
      bucket.item = point.item;
      buckets.set(bucketTime, bucket);
    }

    return [...buckets.values()]
      .map((bucket) => ({
        item: { ...bucket.item, state: String(bucket.sum / bucket.count) },
        time: bucket.time,
        value: bucket.sum / bucket.count,
      }))
      .sort((a, b) => a.time - b.time);
  }

  async _handleClick(event) {
    const target = event.target.closest?.('[data-action="toggle"]');
    if (!target || target.getAttribute("aria-disabled") === "true") return;

    event.preventDefault();
    event.stopPropagation();
  }

  _handlePointerDown(event) {
    const target = event.target.closest?.('[data-action="toggle"]');
    if (!target || target.getAttribute("aria-disabled") === "true") return;

    this._pendingToggle = {
      entityId: target.dataset.entityId,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    };
  }

  _handlePointerUp(event) {
    const pending = this._pendingToggle;
    this._pendingToggle = undefined;
    if (!pending || pending.pointerId !== event.pointerId) return;

    const moved = Math.hypot(event.clientX - pending.x, event.clientY - pending.y);
    if (moved > 8) return;

    event.preventDefault();
    event.stopPropagation();
    this._toggleEntity(pending.entityId);
  }

  _handlePointerCancel() {
    this._pendingToggle = undefined;
  }

  async _toggleEntity(entityId) {
    if (!entityId || !this._hass) return;

    try {
      await this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
    } catch (err) {
      this._error = err?.message || String(err);
      this._render();
    }
  }

  _handleKeyDown(event) {
    if (event.key !== "Enter" && event.key !== " ") return;

    const target = event.target.closest?.('[data-action="toggle"]');
    if (!target || target.getAttribute("aria-disabled") === "true") return;

    event.preventDefault();
    event.stopPropagation();
    this._toggleEntity(target.dataset.entityId);
  }

  _handleSparklinePointerMove(event) {
    const cell = event.target.closest?.(".cell.sparkline");
    if (!cell) {
      this._hideTooltip();
      return;
    }

    const entityId = cell.dataset.historyEntityId;
    const series = this._history.get(entityId) || [];
    const hours = Number(cell.dataset.hours) || Number(this._config?.hours_to_show) || 6;
    const resolution = Number(cell.dataset.resolution) || 0;
    const points = this._pointsFromSeries(series, hours, resolution);

    if (points.length === 0) {
      this._hideTooltip();
      return;
    }

    const rect = cell.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const targetTime = minTime + ratio * Math.max(1, maxTime - minTime);
    const point = this._nearestPoint(points, targetTime);
    const decimals = cell.dataset.decimals === "" ? undefined : Number(cell.dataset.decimals);

    this._showTooltip(event.clientX, event.clientY, {
      time: point.time,
      value: this._formatHistoryValue(entityId, point.item.state, decimals),
    });
  }

  _nearestPoint(points, targetTime) {
    let best = points[0];
    let bestDistance = Math.abs(best.time - targetTime);
    for (let index = 1; index < points.length; index += 1) {
      const distance = Math.abs(points[index].time - targetTime);
      if (distance > bestDistance) break;
      best = points[index];
      bestDistance = distance;
    }
    return best;
  }

  _formatHistoryValue(entityId, value, decimals) {
    const unit = this._hass?.states?.[entityId]?.attributes?.unit_of_measurement;
    const formatted = this._formatValue(value, Number.isFinite(decimals) ? decimals : undefined);
    return unit ? `${formatted} ${unit}` : formatted;
  }

  _showTooltip(x, y, detail) {
    const tooltip = this.shadowRoot.querySelector(".tooltip");
    if (!tooltip) return;

    tooltip.innerHTML = `<div>${this._escape(detail.value)}</div><div class="time">${this._escape(
      this._formatTime(detail.time)
    )}</div>`;
    tooltip.style.display = "block";

    const offset = 12;
    const rect = tooltip.getBoundingClientRect();
    const left = Math.min(window.innerWidth - rect.width - 8, x + offset);
    const top = Math.min(window.innerHeight - rect.height - 8, y + offset);
    tooltip.style.left = `${Math.max(8, left)}px`;
    tooltip.style.top = `${Math.max(8, top)}px`;
  }

  _hideTooltip() {
    const tooltip = this.shadowRoot?.querySelector(".tooltip");
    if (tooltip) tooltip.style.display = "none";
  }

  _formatTime(time) {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(time));
  }

  _cssSize(value, fallback) {
    if (value === undefined || value === null || value === "") return fallback;
    if (typeof value === "number") return `${value}px`;
    return String(value);
  }

  _escape(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  _escapeAttr(value) {
    return this._escape(value).replaceAll(";", "");
  }
}

class TableStateCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config || {};
    this._render();
  }

  set hass(hass) {
    this._hass = hass;
  }

  _render() {
    if (this.shadowRoot) return;
    this.attachShadow({ mode: "open" });
    this.shadowRoot.innerHTML = `
      <ha-alert alert-type="info">
        Configure this card in YAML.
      </ha-alert>
    `;
  }
}

if (!customElements.get("table-state-card-editor")) {
  customElements.define("table-state-card-editor", TableStateCardEditor);
}

if (!customElements.get("table-state-card")) {
  customElements.define("table-state-card", TableStateCard);
}

window.customCards = window.customCards || [];
if (!window.customCards.some((card) => card.type === "table-state-card")) {
  window.customCards.push({
    type: "table-state-card",
    name: "Table State Card",
    preview: true,
    description: "Compact table rows with toggles, values, and history sparklines.",
    documentationURL: "https://github.com/stewartoallen/table-state-card",
  });
}

console.info(
  `%cTABLE-STATE-CARD%c ${TABLE_STATE_CARD_VERSION} loaded`,
  "color:#06b6d4;font-weight:700",
  "color:inherit"
);

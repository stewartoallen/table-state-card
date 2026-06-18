class TableStateCard extends HTMLElement {
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
    this.shadowRoot.addEventListener("click", (event) => this._handleClick(event));
  }

  setConfig(config) {
    if (!config || !Array.isArray(config.entities)) {
      throw new Error("entities is required");
    }

    this._config = {
      hours_to_show: 6,
      refresh_interval: 300,
      row_height: 28,
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
      this._config.hours_to_show,
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

  async _fetchHistory() {
    if (!this._hass || !this._config) return;

    const entityIds = this._historyEntityIds();
    if (entityIds.length === 0) return;

    this._loading = true;
    this._error = "";
    this._render();

    const end = new Date();
    end.setSeconds(0, 0);
    const start = new Date(end.getTime() - Number(this._config.hours_to_show || 6) * 60 * 60 * 1000);
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
          padding: 4px 12px;
          color: var(--secondary-text-color);
          font-size: 12px;
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

        .toggle[data-state="on"],
        .toggle[data-state="home"] {
          background: var(--state-active-color, #fdd835);
          border-color: var(--state-active-color, #fdd835);
        }

        .toggle:focus-visible {
          outline: 2px solid var(--primary-color);
          outline-offset: 2px;
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
    const disabled = entityId ? "" : " disabled";
    return `<div class="cell" style="${this._cellStyle(column)}"><button class="toggle" data-action="toggle" data-entity-id="${this._escapeAttr(
      entityId || ""
    )}" data-state="${this._escapeAttr(state)}" title="${this._escapeAttr(entityId || "")}" type="button"${disabled}>toggle</button></div>`;
  }

  _valueCell(entry, column) {
    const entityId = this._resolveEntity(entry, column, "value");
    const value = this._formatState(entityId, column);
    return `<div class="cell value" data-empty="${value ? "false" : "true"}" style="${this._cellStyle(column)}" title="${this._escapeAttr(
      entityId || ""
    )}">${this._escape(value)}</div>`;
  }

  _sparklineCell(entry, column) {
    const entityId = this._resolveEntity(entry, column, "history");
    const series = this._history.get(entityId) || [];
    const color = column.color || entry.color || "var(--primary-color)";
    const fill = column.fill || entry.fill || "color-mix(in srgb, var(--primary-color) 18%, transparent)";
    return `<div class="cell sparkline" style="${this._cellStyle(column)};--sparkline-color:${this._escapeAttr(color)};--sparkline-fill-color:${this._escapeAttr(
      fill
    )}">${this._sparklineSvg(series)}</div>`;
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

  _sparklineSvg(series) {
    const points = (series || [])
      .map((item) => ({
        time: Date.parse(item.last_changed || item.last_updated),
        value: Number(item.state),
      }))
      .filter((point) => Number.isFinite(point.time) && Number.isFinite(point.value))
      .sort((a, b) => a.time - b.time);

    if (points.length < 2) {
      return `<svg class="spark" viewBox="0 0 100 24" preserveAspectRatio="none" aria-hidden="true"></svg>`;
    }

    const minTime = points[0].time;
    const maxTime = points[points.length - 1].time;
    const minValue = Math.min(...points.map((point) => point.value));
    const maxValue = Math.max(...points.map((point) => point.value));
    const timeSpan = Math.max(1, maxTime - minTime);
    const valueSpan = Math.max(1, maxValue - minValue);
    const coords = points.map((point) => {
      const x = ((point.time - minTime) / timeSpan) * 100;
      const y = 22 - ((point.value - minValue) / valueSpan) * 20;
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

  _formatState(entityId, column = {}) {
    const stateObj = this._hass?.states?.[entityId];
    if (!stateObj) return entityId ? column.placeholder || "--" : "";

    const state = stateObj.state;
    const unit = stateObj.attributes?.unit_of_measurement;
    return unit ? `${state} ${unit}` : String(state);
  }

  async _handleClick(event) {
    const button = event.target.closest?.('button[data-action="toggle"]');
    if (!button) return;

    event.preventDefault();
    event.stopPropagation();
    const entityId = button.dataset.entityId;
    if (!entityId || !this._hass) return;

    try {
      await this._hass.callService("homeassistant", "toggle", { entity_id: entityId });
    } catch (err) {
      this._error = err?.message || String(err);
      this._render();
    }
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

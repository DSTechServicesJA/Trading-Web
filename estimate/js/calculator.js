/**
 * D&S IT Services Limited — Estimate System
 *
 * Multi-item estimate calculator with dual GCT and IndexedDB persistence.
 *
 * Formulas per item:
 *   1. JMD Price            = USD Price × Exchange Rate
 *   2. Profit               = JMD Price × Profit Rate
 *   3. Supplier GCT (15%)   = JMD Price × Supplier GCT Rate
 *   4. Subtotal             = JMD Price + Profit + Supplier GCT
 *   5. Gov. GCT (15%)       = Subtotal × Gov GCT Rate
 *   6. Customs              = JMD Price × Customs Rate  (only if USD > threshold)
 *   7. Line Total           = Subtotal + Gov GCT + Customs
 *   8. Final USD Cost       = Line Total / Exchange Rate
 */

"use strict";

// ── Default Settings ────────────────────────────────────────────────
const DEFAULTS = Object.freeze({
  exchangeRate: 158.66,
  customsPercent: 0.35,
  customsThreshold: 100.0,
  profitMargin: 0.40,
  supplierGctRate: 0.15,
  govGctRate: 0.15,
});

// ── State ───────────────────────────────────────────────────────────
let lineItems = []; // { name, qty, unitPrice }

// ── DOM References ──────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const els = {
  // Settings
  exchangeRate: $("exchangeRate"),
  customsPercent: $("customsPercent"),
  customsThreshold: $("customsThreshold"),
  profitMargin: $("profitMargin"),
  supplierGctRate: $("supplierGctRate"),
  govGctRate: $("govGctRate"),

  // Item input
  itemName: $("itemName"),
  itemQty: $("itemQty"),
  itemPrice: $("itemPrice"),

  // Tables
  itemsTableWrap: $("itemsTableWrap"),
  itemsBody: $("itemsBody"),

  // Buttons
  addItemBtn: $("addItemBtn"),
  calculateBtn: $("calculateBtn"),
  clearBtn: $("clearBtn"),
  printBtn: $("printBtn"),
  saveEstimateBtn: $("saveEstimateBtn"),
  toggleSettingsBtn: $("toggleSettingsBtn"),

  // Panels
  resultsCard: $("resultsCard"),
  settingsPanel: $("settingsPanel"),
  perItemResults: $("perItemResults"),
  savedEstimatesList: $("savedEstimatesList"),

  // Grand totals
  resTotalUSD: $("resTotalUSD"),
  resTotalJMD: $("resTotalJMD"),
  resTotalProfit: $("resTotalProfit"),
  resTotalSupplierGCT: $("resTotalSupplierGCT"),
  resTotalSubtotal: $("resTotalSubtotal"),
  resTotalGovGCT: $("resTotalGovGCT"),
  resTotalCustoms: $("resTotalCustoms"),
  resGrandTotal: $("resGrandTotal"),
  resGrandUSD: $("resGrandUSD"),
};

// ── Formatting ──────────────────────────────────────────────────────
function fmtJMD(value) {
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

function fmtUSD(value) {
  return (
    "$" +
    value.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  );
}

// ── Items Management ────────────────────────────────────────────────
function addItem() {
  const name = els.itemName.value.trim() || "Unnamed Item";
  const qty = parseInt(els.itemQty.value, 10);
  const unitPrice = parseFloat(els.itemPrice.value);

  if (isNaN(qty) || qty < 1) {
    els.itemQty.focus();
    return;
  }
  if (isNaN(unitPrice) || unitPrice <= 0) {
    els.itemPrice.focus();
    return;
  }

  lineItems.push({ name, qty, unitPrice });
  renderItemsTable();

  // Reset inputs
  els.itemName.value = "";
  els.itemQty.value = "1";
  els.itemPrice.value = "";
  els.itemName.focus();
}

function removeItem(index) {
  lineItems.splice(index, 1);
  renderItemsTable();
  // Hide results if items changed
  els.resultsCard.classList.add("hidden");
}

function renderItemsTable() {
  if (lineItems.length === 0) {
    els.itemsTableWrap.classList.add("hidden");
    return;
  }
  els.itemsTableWrap.classList.remove("hidden");

  els.itemsBody.innerHTML = lineItems
    .map(
      (item, i) => `
      <tr>
        <td>${escapeHtml(item.name)}</td>
        <td style="text-align:center;">${item.qty}</td>
        <td style="text-align:right;">${fmtUSD(item.unitPrice)}</td>
        <td style="text-align:right;">${fmtUSD(item.unitPrice * item.qty)}</td>
        <td class="no-print" style="text-align:center;">
          <button class="btn-remove" data-index="${i}" title="Remove item">✕</button>
        </td>
      </tr>`
    )
    .join("");

  // Attach remove handlers
  els.itemsBody.querySelectorAll(".btn-remove").forEach((btn) => {
    btn.addEventListener("click", function () {
      removeItem(parseInt(this.dataset.index, 10));
    });
  });
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

// ── Calculation ─────────────────────────────────────────────────────
let lastCalculation = null;

function calculate() {
  if (lineItems.length === 0) {
    els.itemPrice.focus();
    return;
  }

  // Read settings
  const exchangeRate = parseFloat(els.exchangeRate.value);
  const customsPercent = parseFloat(els.customsPercent.value) / 100;
  const customsThreshold = parseFloat(els.customsThreshold.value);
  const profitMargin = parseFloat(els.profitMargin.value) / 100;
  const supplierGctRate = parseFloat(els.supplierGctRate.value) / 100;
  const govGctRate = parseFloat(els.govGctRate.value) / 100;

  if (isNaN(exchangeRate) || exchangeRate <= 0) {
    els.exchangeRate.focus();
    return;
  }

  const itemResults = [];
  let grandTotalUSD = 0;
  let grandTotalJMD = 0;
  let grandProfit = 0;
  let grandSupplierGCT = 0;
  let grandSubtotal = 0;
  let grandGovGCT = 0;
  let grandCustoms = 0;
  let grandFinal = 0;

  for (const item of lineItems) {
    const totalUSD = item.unitPrice * item.qty;
    const jmdPrice = totalUSD * exchangeRate;
    const profit = jmdPrice * profitMargin;
    const supplierGct = jmdPrice * supplierGctRate;
    const subtotal = jmdPrice + profit + supplierGct;
    const govGct = subtotal * govGctRate;
    const customsApplies = item.unitPrice > customsThreshold;
    const customs = customsApplies ? jmdPrice * customsPercent : 0;
    const lineTotal = subtotal + govGct + customs;
    const lineUSD = lineTotal / exchangeRate;

    const result = {
      name: item.name,
      qty: item.qty,
      unitPrice: item.unitPrice,
      totalUSD,
      jmdPrice,
      profit,
      supplierGct,
      subtotal,
      govGct,
      customsApplies,
      customs,
      lineTotal,
      lineUSD,
    };
    itemResults.push(result);

    grandTotalUSD += totalUSD;
    grandTotalJMD += jmdPrice;
    grandProfit += profit;
    grandSupplierGCT += supplierGct;
    grandSubtotal += subtotal;
    grandGovGCT += govGct;
    grandCustoms += customs;
    grandFinal += lineTotal;
  }

  const grandFinalUSD = grandFinal / exchangeRate;

  // Store last calculation for saving
  lastCalculation = {
    date: new Date().toISOString(),
    settings: {
      exchangeRate,
      customsPercent,
      customsThreshold,
      profitMargin,
      supplierGctRate,
      govGctRate,
    },
    items: lineItems.map((item) => ({ ...item })),
    itemResults,
    grandTotals: {
      totalUSD: grandTotalUSD,
      totalJMD: grandTotalJMD,
      profit: grandProfit,
      supplierGCT: grandSupplierGCT,
      subtotal: grandSubtotal,
      govGCT: grandGovGCT,
      customs: grandCustoms,
      finalJMD: grandFinal,
      finalUSD: grandFinalUSD,
    },
  };

  // ── Render per-item results ─────────────────────────────────────
  els.perItemResults.innerHTML = itemResults
    .map(
      (r, i) => `
      <table class="results-table item-result-table">
        <thead>
          <tr>
            <th colspan="2" style="text-align:left;">
              Item ${i + 1}: ${escapeHtml(r.name)}
              <span style="font-weight:400;opacity:0.7;margin-left:0.5rem;">×${r.qty}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Original Price (USD)</td>
            <td>${fmtUSD(r.totalUSD)}</td>
          </tr>
          <tr>
            <td>JMD Price <span style="color:var(--text-muted);font-size:0.8em;">(USD × Rate)</span></td>
            <td>${fmtJMD(r.jmdPrice)}</td>
          </tr>
          <tr>
            <td>Profit <span style="color:var(--text-muted);font-size:0.8em;">(${(profitMargin * 100).toFixed(0)}%)</span></td>
            <td>${fmtJMD(r.profit)}</td>
          </tr>
          <tr>
            <td>Supplier GCT <span style="color:var(--text-muted);font-size:0.8em;">(${(supplierGctRate * 100).toFixed(0)}% — added by supplier)</span></td>
            <td>${fmtJMD(r.supplierGct)}</td>
          </tr>
          <tr class="row-highlight">
            <td>Subtotal (JMD)</td>
            <td>${fmtJMD(r.subtotal)}</td>
          </tr>
          <tr>
            <td>Gov. GCT <span style="color:var(--text-muted);font-size:0.8em;">(${(govGctRate * 100).toFixed(0)}% of subtotal)</span></td>
            <td>${fmtJMD(r.govGct)}</td>
          </tr>
          <tr>
            <td>Customs Status</td>
            <td>${
              r.customsApplies
                ? '<span class="badge badge-warning">Customs Applied</span>'
                : '<span class="badge badge-success">No Customs</span>'
            }</td>
          </tr>
          ${
            r.customsApplies
              ? `<tr class="row-customs"><td>Customs Duty <span style="color:var(--text-muted);font-size:0.8em;">(${(customsPercent * 100).toFixed(0)}% of JMD Price)</span></td><td>${fmtJMD(r.customs)}</td></tr>`
              : ""
          }
          <tr class="row-final">
            <td>Line Total (JMD)</td>
            <td>${fmtJMD(r.lineTotal)}</td>
          </tr>
        </tbody>
      </table>`
    )
    .join("");

  // ── Render grand totals ─────────────────────────────────────────
  els.resTotalUSD.textContent = fmtUSD(grandTotalUSD);
  els.resTotalJMD.textContent = fmtJMD(grandTotalJMD);
  els.resTotalProfit.textContent = fmtJMD(grandProfit);
  els.resTotalSupplierGCT.textContent = fmtJMD(grandSupplierGCT);
  els.resTotalSubtotal.textContent = fmtJMD(grandSubtotal);
  els.resTotalGovGCT.textContent = fmtJMD(grandGovGCT);
  els.resTotalCustoms.textContent = fmtJMD(grandCustoms);
  els.resGrandTotal.textContent = fmtJMD(grandFinal);
  els.resGrandUSD.textContent = fmtUSD(grandFinalUSD);

  // Show results card
  els.resultsCard.classList.remove("hidden");
  els.resultsCard.scrollIntoView({ behavior: "smooth", block: "start" });
}

// ── Save Estimate ───────────────────────────────────────────────────
async function saveEstimate() {
  if (!lastCalculation) return;
  try {
    await EstimateDB.save(lastCalculation);
    loadSavedEstimates();
  } catch (err) {
    console.error("Failed to save estimate:", err);
  }
}

// ── Load Saved Estimates ────────────────────────────────────────────
async function loadSavedEstimates() {
  try {
    const estimates = await EstimateDB.getAll();
    if (estimates.length === 0) {
      els.savedEstimatesList.innerHTML =
        '<p class="empty-msg">No saved estimates yet.</p>';
      return;
    }

    // Sort newest first
    estimates.sort((a, b) => new Date(b.date) - new Date(a.date));

    els.savedEstimatesList.innerHTML = estimates
      .map(
        (est) => `
        <div class="saved-estimate-card" data-id="${est.id}">
          <div class="saved-estimate-header">
            <div>
              <strong>${formatDate(est.date)}</strong>
              <span class="saved-items-count">${est.items.length} item${est.items.length !== 1 ? "s" : ""}</span>
            </div>
            <div class="saved-estimate-actions">
              <button class="btn-view-est" data-id="${est.id}" title="View estimate">👁 View</button>
              <button class="btn-delete-est" data-id="${est.id}" title="Delete estimate">🗑 Delete</button>
            </div>
          </div>
          <div class="saved-estimate-summary">
            <span>${est.items.map((it) => escapeHtml(it.name)).join(", ")}</span>
            <span class="saved-total">${fmtJMD(est.grandTotals.finalJMD)}</span>
          </div>
        </div>`
      )
      .join("");

    // Attach handlers
    els.savedEstimatesList.querySelectorAll(".btn-delete-est").forEach((btn) => {
      btn.addEventListener("click", async function () {
        const id = parseInt(this.dataset.id, 10);
        if (confirm("Delete this estimate?")) {
          await EstimateDB.remove(id);
          loadSavedEstimates();
        }
      });
    });

    els.savedEstimatesList.querySelectorAll(".btn-view-est").forEach((btn) => {
      btn.addEventListener("click", function () {
        const id = parseInt(this.dataset.id, 10);
        const est = estimates.find((e) => e.id === id);
        if (est) viewSavedEstimate(est);
      });
    });
  } catch (err) {
    console.error("Failed to load estimates:", err);
  }
}

function viewSavedEstimate(est) {
  // Restore items and settings, then recalculate
  lineItems = est.items.map((item) => ({ ...item }));
  renderItemsTable();

  els.exchangeRate.value = est.settings.exchangeRate;
  els.customsPercent.value = (est.settings.customsPercent * 100).toFixed(0);
  els.customsThreshold.value = est.settings.customsThreshold.toFixed(2);
  els.profitMargin.value = (est.settings.profitMargin * 100).toFixed(0);
  els.supplierGctRate.value = (est.settings.supplierGctRate * 100).toFixed(0);
  els.govGctRate.value = (est.settings.govGctRate * 100).toFixed(0);

  calculate();
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── Clear ───────────────────────────────────────────────────────────
function clearForm() {
  lineItems = [];
  lastCalculation = null;
  renderItemsTable();
  els.resultsCard.classList.add("hidden");
  els.itemName.value = "";
  els.itemQty.value = "1";
  els.itemPrice.value = "";
  els.itemName.focus();
}

// ── Reset Settings ──────────────────────────────────────────────────
function resetSettings() {
  els.exchangeRate.value = DEFAULTS.exchangeRate;
  els.customsPercent.value = (DEFAULTS.customsPercent * 100).toFixed(0);
  els.customsThreshold.value = DEFAULTS.customsThreshold.toFixed(2);
  els.profitMargin.value = (DEFAULTS.profitMargin * 100).toFixed(0);
  els.supplierGctRate.value = (DEFAULTS.supplierGctRate * 100).toFixed(0);
  els.govGctRate.value = (DEFAULTS.govGctRate * 100).toFixed(0);
}

// ── Toggle Settings Panel ───────────────────────────────────────────
function toggleSettings() {
  const panel = els.settingsPanel;
  const btn = els.toggleSettingsBtn;
  const isHidden = panel.classList.toggle("hidden");
  btn.textContent = isHidden ? "⚙ Show Settings" : "⚙ Hide Settings";
}

// ── Event Listeners ─────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  resetSettings();
  loadSavedEstimates();

  els.addItemBtn.addEventListener("click", addItem);
  els.calculateBtn.addEventListener("click", calculate);
  els.clearBtn.addEventListener("click", clearForm);
  els.printBtn.addEventListener("click", function () {
    window.print();
  });
  els.saveEstimateBtn.addEventListener("click", saveEstimate);
  els.toggleSettingsBtn.addEventListener("click", toggleSettings);

  // Allow Enter key on price field to add item
  els.itemPrice.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      addItem();
    }
  });

  // Allow Enter key on name field to move to price
  els.itemName.addEventListener("keydown", function (e) {
    if (e.key === "Enter") {
      e.preventDefault();
      els.itemPrice.focus();
    }
  });
});

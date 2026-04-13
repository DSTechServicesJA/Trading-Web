# D&S IT Services — Price Calculator

A web-based price estimation system for D&S IT Services Limited that calculates final retail prices (JMD) for products sourced from international vendors (Amazon, eBay, etc.), including all applicable taxes, duties, and profit margins.

## Features

- **Instant price calculation** — enter a USD price and get a full JMD breakdown
- **Configurable settings** — exchange rate, tax rates, profit margin, and customs threshold
- **Customs handling** — automatically applies customs duty for items above the USD threshold
- **Print-friendly** — clean printable estimate for customers
- **Responsive** — works on desktop, tablet, and mobile
- **No build step** — plain HTML, CSS, and JavaScript; deploy to any hosting server

## Calculation Formula

1. **JMD Price** = USD Price × Exchange Rate
2. **Profit** = JMD Price × Profit Rate (default 40%)
3. **Vendor Tax (GCT)** = JMD Price × Vendor Tax Rate (default 15%)
4. **Subtotal** = JMD Price + Profit + Vendor Tax
5. **Additional GCT** = Subtotal × GCT Rate (default 15%)
6. **Customs** = JMD Price × Customs Rate (default 35%) — only if USD > threshold ($100)
7. **Final Balance** = Subtotal + GCT + Customs
8. **Final USD Cost** = Final Balance ÷ Exchange Rate

## Default Settings

| Parameter             | Default Value    |
|-----------------------|------------------|
| USD Exchange Rate     | $158.66 JMD/USD |
| Customs Rate          | 35%              |
| Customs USD Threshold | $100.00 USD      |
| Profit Margin         | 40%              |
| Vendor Tax (GCT)      | 15%              |
| Additional GCT        | 15%              |

## Deployment

Upload all files to any web hosting server:

```
index.html
css/style.css
js/calculator.js
```

No server-side language, database, or build tool is required. Works on any static hosting provider.

## Usage

1. Open `index.html` in a browser
2. Enter the product's USD price
3. Click **Calculate** to see the full JMD breakdown
4. Click **⚙ Show Settings** to adjust exchange rate, tax rates, or profit margins
5. Click **🖨 Print** for a printer-friendly estimate